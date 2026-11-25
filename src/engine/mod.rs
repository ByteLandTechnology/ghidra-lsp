// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Session selection, virtual document generation, and code intelligence engine.

/// Completion, signature help, and type-definition lookups.
mod assist;
/// Highlights, inlay hints, code lenses, folding ranges, and document links.
mod decorations;
/// Incoming and outgoing call hierarchy builders.
mod hierarchy;
/// Symbol resolution, definitions, and cross-reference lookups.
mod navigation;
/// Scoped rename preview, origin save persistence, and document refresh.
mod rename;
/// Singleflight coordinators for concurrent decompilations and symbol loads.
mod singleflight;
/// Synchronous in-memory document, symbol, pending-rename, and epoch state.
mod state;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tokio::sync::OwnedMutexGuard;
use tower_lsp_server::ls_types::Uri;

pub(crate) use assist::format_type_markdown;
pub(crate) use state::{ClientBuffer, EngineState};

use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Symbol, Token, align, extract_label_address, is_label_token, resolve, resolve_locals,
  same_address, virtual_uri,
};

/// Finds a function symbol by address first and by name or qualified name second.
fn find_function_symbol<'a>(
  symbols: &'a [Symbol],
  entry_or_addr: Option<&str>,
  name: &str,
) -> Option<&'a Symbol> {
  if let Some(addr) = entry_or_addr
    && let Some(sym) = symbols
      .iter()
      .find(|s| s.kind.eq_ignore_ascii_case("function") && same_address(&s.address, addr))
  {
    return Some(sym);
  }
  symbols
    .iter()
    .find(|s| s.kind.eq_ignore_ascii_case("function") && (s.name == name || s.qualified() == name))
}

/// Planned symbol rename held in memory until the origin buffer saves to Ghidra.
#[derive(Clone)]
pub(crate) struct Pending {
  /// Canonical URI of the virtual document where the rename started.
  pub(crate) origin: Uri,
  /// Resolved symbol identity snapshot captured when the rename began.
  pub(crate) symbol: Symbol,
  /// Validated replacement identifier requested by the user.
  pub(crate) new_name: String,
  /// Expected post-rename text per affected canonical document URI.
  pub(crate) expected: HashMap<Uri, String>,
  /// Whether a backend rename write has been sent or confirmed in this session.
  pub(crate) patched: bool,
}

/// Regenerated virtual document text delta to push back to the editor client.
#[derive(Clone)]
pub(crate) struct Refresh {
  /// Canonical URI of the virtual document to update.
  pub(crate) uri: Uri,
  /// Previous synchronized text replaced in the editor buffer.
  pub(crate) old: String,
  /// Newly generated text from the updated backend state.
  pub(crate) new: String,
  /// Last known LSP version of the client document.
  pub(crate) version: Option<i32>,
}

/// Generated function document paired with resolved function and local metadata.
pub(super) struct GeneratedFunction {
  /// Decompiled virtual C document with aligned token spans and warnings.
  pub(super) doc: Document,
  /// Optional `(entry, function_json, local_details)` produced when semantic resolution succeeds.
  pub(super) metadata: Option<(String, Value, HashMap<String, Value>)>,
}

/// Coordinates active Ghidra sessions, singleflight RPCs, and isolated [`EngineState`].
pub(crate) struct Engine {
  /// Connected MCP child-process backend behind a synchronous lock.
  backend: RwLock<Arc<McpBackend>>,
  /// Synchronous in-memory session, document, and symbol caches.
  state: RwLock<EngineState>,
  /// Per-session mutation locks keyed by lowercase 32-hex MD5 hash.
  session_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
  /// Singleflight coordinator for `(md5, entry)` decompilations.
  open_flights: singleflight::OpenFlights,
  /// Singleflight coordinator for `md5` symbol-table loads.
  symbol_flights: singleflight::SymbolFlights,
}

impl Engine {
  /// Creates a new engine backed by `backend`.
  pub(crate) fn new(backend: Arc<McpBackend>) -> Self {
    Self {
      backend: RwLock::new(backend),
      state: RwLock::new(EngineState::default()),
      session_locks: Mutex::new(HashMap::new()),
      open_flights: singleflight::OpenFlights::new(),
      symbol_flights: singleflight::SymbolFlights::new(),
    }
  }

  /// Replaces the backend transport and clears cached engine state during `initialize`.
  pub(crate) fn reset(&self, backend: Arc<McpBackend>) {
    *self.backend.write().unwrap_or_else(PoisonError::into_inner) = backend;
    self.open_flights.clear();
    self.symbol_flights.clear();
    self
      .session_locks
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .clear();
    self.write_state().reset();
  }

  /// Clones the active [`McpBackend`] handle without locking [`EngineState`].
  pub(crate) fn backend(&self) -> Arc<McpBackend> {
    self
      .backend
      .read()
      .unwrap_or_else(PoisonError::into_inner)
      .clone()
  }

  /// Acquires a shared synchronous read guard on [`EngineState`].
  pub(crate) fn read_state(&self) -> RwLockReadGuard<'_, EngineState> {
    self.state.read().unwrap_or_else(PoisonError::into_inner)
  }

  /// Acquires an exclusive synchronous write guard on [`EngineState`].
  pub(crate) fn write_state(&self) -> RwLockWriteGuard<'_, EngineState> {
    self.state.write().unwrap_or_else(PoisonError::into_inner)
  }

  /// Acquires the per-session async mutation lock for `md5` before any [`EngineState`] guard.
  pub(crate) async fn lock_session(&self, md5: &str) -> OwnedMutexGuard<()> {
    let key = md5.to_ascii_lowercase();
    let mutex = {
      let mut locks = self
        .session_locks
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
      Arc::clone(
        locks
          .entry(key)
          .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
      )
    };
    mutex.lock_owned().await
  }

  /// Increments and returns the mutation and close epoch for session `md5`.
  pub(crate) fn bump_epoch(&self, md5: &str) -> u64 {
    self.write_state().bump_epoch(md5)
  }

  /// Evicts cached state and active singleflight slots for closed session `md5`.
  pub(crate) fn forget_session(&self, md5: &str) {
    let key = md5.to_ascii_lowercase();
    self.open_flights.forget_session(&key);
    self.symbol_flights.forget_session(&key);
    self.write_state().forget_session(&key);
  }

  /// Fetches and caches all symbols for session `md5` with singleflight deduplication.
  pub(crate) async fn symbols(&self, md5: &str) -> Result<Vec<Symbol>> {
    let md5_key = md5.to_ascii_lowercase();
    let (initial_gen, initial_epoch) = {
      let state = self.read_state();
      if let Some(symbols) = state.symbols.get(&md5_key) {
        return Ok(symbols.clone());
      }
      (state.generation, state.epoch(&md5_key))
    };
    loop {
      match self.symbol_flights.acquire(&md5_key) {
        singleflight::Registration::Follower(receiver) => {
          if let Some(symbols) = singleflight::wait_flight(receiver).await? {
            let state = self.read_state();
            ensure!(
              !state.is_closed_since(&md5_key, initial_epoch, initial_gen),
              "Session was closed"
            );
            return Ok(symbols);
          }
        }
        singleflight::Registration::Leader(leader) => {
          let result = self
            .load_symbols_leader(&md5_key, initial_epoch, initial_gen)
            .await;
          leader.complete(&result);
          return result;
        }
      }
    }
  }

  /// Executes the leader symbol-table RPC load and epoch-checked cache insertion.
  async fn load_symbols_leader(
    &self,
    md5_key: &str,
    initial_epoch: u64,
    initial_gen: u64,
  ) -> Result<Vec<Symbol>> {
    let backend = self.backend();
    loop {
      let (generation, epoch) = {
        let state = self.read_state();
        ensure!(
          !state.is_closed_since(md5_key, initial_epoch, initial_gen),
          "Session was closed"
        );
        if let Some(cached) = state.symbols.get(md5_key) {
          return Ok(cached.clone());
        }
        (state.generation, state.epoch(md5_key))
      };
      let items = list_all(
        backend.as_ref(),
        "symbol",
        md5_key,
        json!({"page": {"limit": 1000}, "scan": {"timeout_ms": 60000}}),
      )
      .await?;
      let symbols = items
        .into_iter()
        .map(serde_json::from_value)
        .collect::<std::result::Result<Vec<Symbol>, _>>()?;
      let mut state = self.write_state();
      ensure!(
        !state.is_closed_since(md5_key, initial_epoch, initial_gen)
          && !state.is_closed_since(md5_key, epoch, generation),
        "Session was closed"
      );
      if state.epoch(md5_key) == epoch {
        state.symbols.insert(md5_key.to_owned(), symbols.clone());
        return Ok(symbols);
      }
      if let Some(cached) = state.symbols.get(md5_key) {
        return Ok(cached.clone());
      }
    }
  }

  /// Verifies that session `md5` is ready and marks it as active.
  pub(crate) async fn select(&self, md5: &str) -> Result<()> {
    ensure!(
      md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
      "invalid session MD5"
    );
    let md5_key = md5.to_ascii_lowercase();
    let (start_gen, start_epoch) = {
      let state = self.read_state();
      (state.generation, state.epoch(&md5_key))
    };
    let backend = self.backend();
    let result = backend
      .call("session", "get", Some(&md5_key), json!({}))
      .await?;
    let status = result
      .pointer("/session/status")
      .or_else(|| result.get("status"))
      .and_then(Value::as_str);
    ensure!(status == Some("ready"), "session is not ready: {result}");
    let mut state = self.write_state();
    ensure!(
      !state.is_closed_since(&md5_key, start_epoch, start_gen),
      "Session was closed"
    );
    state.active = Some(md5_key);
    Ok(())
  }

  /// Decompiles `entry` outside [`EngineState`] and drops cached symbols if `previous_base` differs.
  pub(super) async fn generate_function(
    &self,
    md5: &str,
    entry: &str,
    previous_base: Option<&str>,
  ) -> Result<GeneratedFunction> {
    let backend = self.backend();
    let params = json!({
      "selector": {"entry": entry},
      "scan": {"timeout_ms": 30000},
      "format": "document",
      "include_comments": true,
    });
    let text =
      match backend
        .call("decompilation", "get", Some(md5), params)
        .await
      {
        Ok(value) => value,
        Err(error) if legacy_format_error(&error) => backend
          .call(
            "decompilation",
            "get",
            Some(md5),
            json!({"selector": {"entry": entry}, "scan": {"timeout_ms": 30000}, "format": "text"}),
          )
          .await?,
        Err(error) => return Err(error),
      };
    ensure!(
      text.get("completed").and_then(Value::as_bool) == Some(true),
      "decompilation incomplete: {text}"
    );
    let code = text
      .get("c")
      .and_then(Value::as_str)
      .context("decompilation lacks C text")?
      .to_owned();
    let canonical = text
      .get("entry")
      .and_then(Value::as_str)
      .unwrap_or(entry)
      .to_owned();
    let uri = virtual_uri(md5, "function", &canonical)?;
    let mut doc = Document {
      uri,
      md5: md5.into(),
      entry: Some(canonical),
      base: code.clone(),
      current: code.clone(),
      saved: code,
      version: None,
      spans: vec![],
      warning: None,
    };
    let native = text.get("lines").filter(|value| value.is_array());
    if let Some(lines) = native {
      match crate::gui::spans(&doc.base, lines) {
        Ok(spans) => doc.spans = spans,
        Err(error) => doc.warning = Some(format!("Native GUI layout unavailable: {error:#}")),
      }
    } else {
      doc.warning = Some(
        "Upgrade ghidra-mcp for native GUI layout and comments. Cursor locations and full comment display are unavailable."
          .into(),
      );
    }
    if let Some(warnings) = text.get("warnings").and_then(Value::as_array) {
      for warning in warnings
        .iter()
        .filter_map(Value::as_str)
        .filter(|s| !s.is_empty())
      {
        append_warning(&mut doc, warning);
      }
    }
    let comment_err = if native.is_some() {
      crate::comments::include(&mut doc, &text).err()
    } else {
      None
    };
    // Clear stale symbol caches before semantic resolution when refreshed C text changed.
    if previous_base.is_some_and(|old| old != doc.base) {
      let mut state = self.write_state();
      state.symbols.remove(md5);
      state.bump_epoch(md5);
    }
    let function = backend
      .call(
        "function",
        "get",
        Some(md5),
        json!({"selector": {"entry": doc.entry}}),
      )
      .await;
    let semantic = async {
      let symbols = self.symbols(md5).await?;
      let mut spans = if native.is_some() {
        ensure!(!doc.spans.is_empty(), "native GUI layout is unavailable");
        doc.spans.clone()
      } else {
        let tokens = backend
          .call(
            "decompilation",
            "get",
            Some(md5),
            json!({"selector": {"entry": entry}, "scan": {"timeout_ms": 30000}, "format": "tokens"}),
          )
          .await?;
        ensure!(
          tokens.get("completed").and_then(Value::as_bool) == Some(true),
          "token decompilation incomplete"
        );
        let tokens: Vec<Token> =
          serde_json::from_value(tokens.get("tokens").context("missing tokens")?.clone())?;
        align(&doc.base, tokens)?
      };
      let function = function
        .as_ref()
        .map_err(|error| anyhow::anyhow!("{error:#}"))?;
      let locals: HashSet<String> = ["parameters", "local_variables"]
        .iter()
        .flat_map(|key| {
          function
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        })
        .filter_map(|v| v.get("name").and_then(Value::as_str).map(str::to_owned))
        .collect();
      resolve(&mut spans, &symbols, &locals);
      let mut local_symbols = vec![];
      let mut local_details = HashMap::new();
      let entry_str = doc.entry.as_deref().unwrap_or(entry);
      for (key, kind) in [("parameters", "Parameter"), ("local_variables", "Local")] {
        for variable in function
          .get(key)
          .and_then(Value::as_array)
          .into_iter()
          .flatten()
        {
          let Some(name) = variable.get("name").and_then(Value::as_str) else {
            continue;
          };
          if name.is_empty() {
            continue;
          }
          let identity = if kind == "Parameter" {
            let Some(ordinal) = variable.get("ordinal").and_then(Value::as_u64) else {
              continue;
            };
            json!({"ordinal": ordinal})
          } else if let Some(storage) = variable.get("storage").filter(|s| !s.is_null()) {
            json!({"storage": storage, "name": name})
          } else {
            json!({"name": name})
          };
          let id = format!("{kind}:{md5}:{entry_str}:{identity}");
          let mut detail = variable.clone();
          detail["entry"] = json!(entry_str);
          detail["kind"] = json!(kind);
          local_details.insert(id.clone(), detail);
          local_symbols.push(Symbol {
            demangled_name: None,
            id,
            name: name.into(),
            address: entry_str.to_owned(),
            namespace: String::new(),
            kind: kind.into(),
          });
        }
      }
      for span in &mut spans {
        if !matches!(span.token.kind.as_str(), "variable" | "parameter") {
          continue;
        }
        let Some(native) = &mut span.symbol else {
          continue;
        };
        if !native.local() {
          continue;
        }
        let kind = if native.kind == "Parameter" || span.token.kind == "parameter" {
          "Parameter"
        } else {
          "Local"
        };
        let prefix = format!("{kind}:{md5}:{entry_str}:");
        let scoped_id = if native.id.starts_with(&prefix) {
          native.id.clone()
        } else {
          format!("{prefix}symbol={}", native.id)
        };
        if !local_details.contains_key(&scoped_id) {
          let target_name = if native.name.is_empty() {
            span.token.text.as_str()
          } else {
            native.name.as_str()
          };
          if let Some(matched) = local_symbols
            .iter()
            .find(|sym| sym.kind == kind && sym.name == target_name)
            .and_then(|sym| local_details.get(&sym.id).cloned())
          {
            local_details.insert(scoped_id.clone(), matched);
          }
        }
        if native.name.is_empty() {
          native.name = span.token.text.clone();
        }
        native.id = scoped_id;
        native.address = entry_str.to_owned();
        native.namespace = String::new();
        native.kind = kind.into();
      }
      resolve_locals(&mut spans, &local_symbols);
      for span in &mut spans {
        if span.symbol.is_none() && matches!(span.token.kind.as_str(), "variable" | "parameter") {
          let kind = if span.token.kind == "parameter" {
            "Parameter"
          } else {
            "Local"
          };
          span.symbol = Some(Symbol {
            demangled_name: None,
            id: format!("{kind}:{md5}:{entry_str}:name={}", span.token.text),
            name: span.token.text.clone(),
            address: entry_str.to_owned(),
            namespace: String::new(),
            kind: kind.into(),
          });
        } else if span.symbol.is_none()
          && (span.token.kind == "label"
            || is_label_token(&span.token.text, span.start, span.end, &doc.base))
        {
          let addr = span
            .token
            .address
            .as_deref()
            .map(str::to_string)
            .or_else(|| extract_label_address(&span.token.text))
            .unwrap_or_else(|| entry_str.to_owned());
          span.symbol = Some(Symbol {
            demangled_name: None,
            id: format!("Label:{md5}:{addr}"),
            name: span.token.text.clone(),
            address: addr,
            namespace: String::new(),
            kind: "Label".into(),
          });
        }
      }
      let body_start = spans
        .iter()
        .find(|span| span.token.kind != "comment" && span.token.text == "{")
        .map_or(doc.base.len(), |span| span.start);
      if let Some(decl_span) = spans
        .iter_mut()
        .find(|s| s.token.kind == "function" && s.start < body_start)
        && decl_span.symbol.is_none()
      {
        if let Some(sym) = find_function_symbol(&symbols, Some(entry_str), &decl_span.token.text) {
          decl_span.symbol = Some(sym.clone());
        } else {
          decl_span.symbol = Some(Symbol {
            demangled_name: None,
            id: format!("Function:{md5}:{entry_str}"),
            name: decl_span.token.text.clone(),
            address: entry_str.to_owned(),
            namespace: String::new(),
            kind: "Function".into(),
          });
        }
      }
      Ok::<_, anyhow::Error>((spans, entry_str.to_owned(), function.clone(), local_details))
    }
    .await;
    let metadata = match semantic {
      Ok((spans, entry_key, function_val, local_details)) => {
        doc.spans = spans;
        Some((entry_key, function_val, local_details))
      }
      Err(e) => {
        append_warning(&mut doc, &format!("Navigation disabled: {e:#}"));
        None
      }
    };
    if let Some(error) = comment_err {
      append_warning(&mut doc, &format!("Ghidra comments unavailable: {error:#}"));
    }
    Ok(GeneratedFunction { doc, metadata })
  }

  /// Opens an already cached function document or generates and installs it via singleflight.
  pub(crate) async fn open(&self, md5: &str, entry: &str) -> Result<Uri> {
    ensure!(
      md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
      "invalid session MD5"
    );
    let md5 = md5.to_ascii_lowercase();
    let decoded_entry = percent_encoding::percent_decode_str(entry)
      .decode_utf8()
      .unwrap_or(std::borrow::Cow::Borrowed(entry));
    let (initial_gen, initial_epoch) = {
      let state = self.read_state();
      if let Some(doc) = state.find_function_doc(&md5, entry, &decoded_entry) {
        return Ok(doc.uri.clone());
      }
      (state.generation, state.epoch(&md5))
    };
    loop {
      match self.open_flights.acquire(&md5, &decoded_entry) {
        singleflight::Registration::Follower(receiver) => {
          if let Some(uri) = singleflight::wait_flight(receiver).await? {
            let state = self.read_state();
            ensure!(
              !state.is_closed_since(&md5, initial_epoch, initial_gen),
              "Session was closed"
            );
            return Ok(uri);
          }
        }
        singleflight::Registration::Leader(leader) => {
          let result = self
            .open_leader(&md5, entry, &decoded_entry, initial_epoch, initial_gen)
            .await;
          leader.complete(&result);
          return result;
        }
      }
    }
  }

  /// Executes the leader `(md5, entry)` decompilation and epoch-checked document installation.
  async fn open_leader(
    &self,
    md5: &str,
    entry: &str,
    decoded_entry: &str,
    initial_epoch: u64,
    initial_gen: u64,
  ) -> Result<Uri> {
    loop {
      let (generation, epoch) = {
        let state = self.read_state();
        ensure!(
          !state.is_closed_since(md5, initial_epoch, initial_gen),
          "Session was closed"
        );
        if let Some(doc) = state.find_function_doc(md5, entry, decoded_entry) {
          return Ok(doc.uri.clone());
        }
        (state.generation, state.epoch(md5))
      };
      let generated = self.generate_function(md5, decoded_entry, None).await?;
      let mut state = self.write_state();
      ensure!(
        !state.is_closed_since(md5, initial_epoch, initial_gen)
          && !state.is_closed_since(md5, epoch, generation),
        "Session was closed"
      );
      if state.epoch(md5) != epoch {
        if let Some(doc) = state.find_function_doc(md5, entry, decoded_entry) {
          return Ok(doc.uri.clone());
        }
        continue;
      }
      if let Some((entry_key, function_val, local_details)) = generated.metadata {
        state.apply_generated_metadata(md5, entry_key, function_val, local_details);
      }
      return state.install(generated.doc);
    }
  }

  /// Builds synthetic read-only snapshot text for `type`, `symbol`, or `references` URIs.
  pub(crate) async fn snapshot_text(&self, md5: &str, kind: &str, id: &str) -> Result<String> {
    let backend = self.backend();
    if kind == "type" {
      let path = id.strip_suffix(".md").unwrap_or(id);
      let type_data = if path.starts_with('/') {
        backend
          .call(
            "data_type",
            "get",
            Some(md5),
            json!({"selector": {"path": path}}),
          )
          .await?
      } else {
        let types = list_all(
          backend.as_ref(),
          "data_type",
          md5,
          json!({"filter": {"query": path}, "page": {"limit": 1000}}),
        )
        .await?;
        let candidate = types.into_iter().find(|v| {
          v.get("name").and_then(Value::as_str) == Some(path)
            || v.get("path").and_then(Value::as_str) == Some(path)
        });
        let full_path = if let Some(cand) = &candidate {
          cand.get("path").and_then(Value::as_str).unwrap_or(path)
        } else {
          path
        };
        let lookup_path = if full_path.starts_with('/') {
          full_path.to_owned()
        } else {
          format!("/{full_path}")
        };
        backend
          .call(
            "data_type",
            "get",
            Some(md5),
            json!({"selector": {"path": lookup_path}}),
          )
          .await?
      };
      return Ok(format_type_markdown(&type_data));
    }
    let symbol: Symbol = serde_json::from_value(
      backend
        .call("symbol", "get", Some(md5), json!({"selector": {"id": id}}))
        .await?,
    )?;
    if kind == "symbol" {
      return Ok(format!(
        "// {}\n// Address: {}\n// Kind: {}\n",
        symbol.display_name(),
        symbol.address,
        symbol.kind
      ));
    }
    let refs = list_all(
      backend.as_ref(),
      "reference",
      md5,
      json!({"filter": {"direction": "to", "to": symbol.address}, "page": {"limit": 1000}}),
    )
    .await?;
    let mut code = format!(
      "// References to {} at {}\n",
      symbol.display_name(),
      symbol.address
    );
    for reference in refs {
      code.push_str(&format!(
        "// {} -> {} ({})\n",
        reference
          .get("from")
          .and_then(Value::as_str)
          .context("reference lacks from address")?,
        reference
          .get("to")
          .and_then(Value::as_str)
          .unwrap_or(&symbol.address),
        reference
          .get("type")
          .and_then(Value::as_str)
          .unwrap_or("reference")
      ));
    }
    Ok(code)
  }
}

/// Appends `message` to `doc.warning`, joining multiple warnings with semicolons.
fn append_warning(doc: &mut Document, message: &str) {
  doc.warning = Some(doc.warning.take().map_or_else(
    || message.into(),
    |previous| format!("{previous}; {message}"),
  ));
}

/// Returns true when an error indicates `ghidra-mcp` does not support document decompile format.
fn legacy_format_error(error: &anyhow::Error) -> bool {
  let message = format!("{error:#}").to_ascii_lowercase();
  (message.contains("format") || message.contains("include_comments"))
    && [
      "invalid",
      "unsupported",
      "unknown",
      "enum",
      "not allowed",
      "unexpected",
      "does not accept",
    ]
    .iter()
    .any(|word| message.contains(word))
}
