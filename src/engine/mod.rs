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
/// Read-only `type`, `symbol`, and `references` snapshot builders.
mod snapshots;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::Uri;

pub(crate) use snapshots::format_type_markdown;

use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Symbol, Token, align, canonical_virtual_uri, extract_label_address, is_label_token,
  resolve, resolve_locals, same_address, virtual_uri,
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

/// Manages active Ghidra sessions, opened virtual buffers, and cached analysis state.
pub(crate) struct Engine {
  /// Connected MCP child-process backend.
  pub(crate) backend: Arc<McpBackend>,
  /// Currently selected 32-character lowercase MD5 session hash.
  pub(crate) active: Option<String>,
  /// Virtual documents indexed by their canonical `ghidra://` URI.
  pub(crate) docs: HashMap<Uri, Document>,
  /// Pending scoped rename plan keyed by lowercase session MD5.
  pub(crate) pending: HashMap<String, Pending>,
  /// Cached symbol tables keyed by lowercase session MD5.
  pub(crate) symbols: HashMap<String, Vec<Symbol>>,
  /// Pre-accepted document text after a confirmed backend save, keyed by URI.
  pub(crate) refresh_allowed: HashMap<Uri, String>,
  /// Cached function JSON payloads indexed by session MD5 and entry address.
  pub(crate) functions: HashMap<(String, String), Value>,
  /// Cached local variable and parameter metadata keyed by synthetic symbol ID.
  local_details: HashMap<String, Value>,
}

impl Engine {
  /// Creates a new engine backed by `backend`.
  pub(crate) fn new(backend: Arc<McpBackend>) -> Self {
    Self {
      backend,
      active: None,
      docs: HashMap::new(),
      pending: HashMap::new(),
      symbols: HashMap::new(),
      refresh_allowed: HashMap::new(),
      functions: HashMap::new(),
      local_details: HashMap::new(),
    }
  }

  /// Returns the selected session MD5 or an error when no session is active.
  pub(crate) fn session(&self) -> Result<&str> {
    self
      .active
      .as_deref()
      .context("Select a Ghidra session first")
  }

  /// Fetches and caches all symbols for session `md5`.
  pub(crate) async fn symbols(&mut self, md5: &str) -> Result<Vec<Symbol>> {
    if let Some(symbols) = self.symbols.get(md5) {
      return Ok(symbols.clone());
    }
    let items = list_all(
      self.backend.as_ref(),
      "symbol",
      md5,
      json!({"page": {"limit": 1000}, "scan": {"timeout_ms": 60000}}),
    )
    .await?;
    let symbols = items
      .into_iter()
      .map(serde_json::from_value)
      .collect::<std::result::Result<Vec<Symbol>, _>>()?;
    self.symbols.insert(md5.into(), symbols.clone());
    Ok(symbols)
  }

  /// Returns cached parameter or local variable detail for `symbol` when present.
  pub(crate) fn local_detail(&self, symbol: &Symbol) -> Option<Value> {
    symbol
      .local()
      .then(|| self.local_details.get(&symbol.id).cloned())
      .flatten()
  }

  /// Verifies that session `md5` is ready and marks it as active.
  pub(crate) async fn select(&mut self, md5: &str) -> Result<()> {
    ensure!(
      md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
      "invalid session MD5"
    );
    let result = self
      .backend
      .call("session", "get", Some(md5), json!({}))
      .await?;
    let status = result
      .pointer("/session/status")
      .or_else(|| result.get("status"))
      .and_then(Value::as_str);
    ensure!(status == Some("ready"), "session is not ready: {result}");
    self.active = Some(md5.to_lowercase());
    Ok(())
  }

  /// Decompiles `entry` in session `md5`, aligns GUI spans and comments, and resolves symbols.
  async fn generate(&mut self, md5: &str, entry: &str) -> Result<Document> {
    self.generate_inner(md5, entry, None).await
  }

  /// Decompiles `entry` and drops cached symbols if `previous_base` differs from the new code.
  pub(super) async fn generate_inner(
    &mut self,
    md5: &str,
    entry: &str,
    previous_base: Option<&str>,
  ) -> Result<Document> {
    let params = json!({
      "selector": {"entry": entry},
      "scan": {"timeout_ms": 30000},
      "format": "document",
      "include_comments": true,
    });
    let text =
      match self
        .backend
        .call("decompilation", "get", Some(md5), params)
        .await
      {
        Ok(value) => value,
        Err(error) if legacy_format_error(&error) => self
          .backend
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
      self.symbols.remove(md5);
    }
    let function = self
      .backend
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
        let tokens = self
          .backend
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
      let entry_str = doc.entry.as_deref().unwrap_or(entry);
      let param_prefix = format!("Parameter:{md5}:{entry_str}:");
      let local_prefix = format!("Local:{md5}:{entry_str}:");
      self
        .local_details
        .retain(|k, _| !k.starts_with(&param_prefix) && !k.starts_with(&local_prefix));
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
          let id = format!(
            "{kind}:{md5}:{}:{identity}",
            doc.entry.as_deref().unwrap_or(entry)
          );
          let mut detail = variable.clone();
          detail["entry"] = json!(doc.entry.as_deref().unwrap_or(entry));
          detail["kind"] = json!(kind);
          self.local_details.insert(id.clone(), detail);
          local_symbols.push(Symbol {
            demangled_name: None,
            id,
            name: name.into(),
            address: doc.entry.clone().unwrap_or_else(|| entry.into()),
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
        if !self.local_details.contains_key(&scoped_id) {
          let target_name = if native.name.is_empty() {
            span.token.text.as_str()
          } else {
            native.name.as_str()
          };
          if let Some(matched) = local_symbols
            .iter()
            .find(|sym| sym.kind == kind && sym.name == target_name)
            .and_then(|sym| self.local_details.get(&sym.id).cloned())
          {
            self.local_details.insert(scoped_id.clone(), matched);
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
          let entry_str = doc.entry.as_deref().unwrap_or(entry);
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
          let entry_str = doc.entry.as_deref().unwrap_or(entry);
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
        let entry_addr = doc.entry.as_deref().unwrap_or(entry);
        if let Some(sym) = find_function_symbol(&symbols, Some(entry_addr), &decl_span.token.text) {
          decl_span.symbol = Some(sym.clone());
        } else {
          decl_span.symbol = Some(Symbol {
            demangled_name: None,
            id: format!("Function:{md5}:{entry_addr}"),
            name: decl_span.token.text.clone(),
            address: entry_addr.to_owned(),
            namespace: String::new(),
            kind: "Function".into(),
          });
        }
      }
      self.functions.insert(
        (
          md5.into(),
          doc.entry.clone().unwrap_or_else(|| entry.into()),
        ),
        function.clone(),
      );
      Ok::<_, anyhow::Error>(spans)
    }
    .await;
    match semantic {
      Ok(spans) => doc.spans = spans,
      Err(e) => append_warning(&mut doc, &format!("Navigation disabled: {e:#}")),
    }
    if let Some(error) = comment_err {
      append_warning(&mut doc, &format!("Ghidra comments unavailable: {error:#}"));
    }
    Ok(doc)
  }

  /// Opens an already cached function document or generates and installs it.
  pub(crate) async fn open(&mut self, md5: &str, entry: &str) -> Result<Uri> {
    ensure!(
      md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
      "invalid session MD5"
    );
    let md5 = md5.to_ascii_lowercase();
    let decoded_entry = percent_encoding::percent_decode_str(entry)
      .decode_utf8()
      .unwrap_or(std::borrow::Cow::Borrowed(entry));
    if let Some(doc) = self.docs.values().find(|d| {
      d.md5 == md5
        && d.entry.as_deref().is_some_and(|e| {
          e == entry || e == decoded_entry.as_ref() || same_address(e, &decoded_entry)
        })
    }) {
      return Ok(doc.uri.clone());
    }
    let doc = self.generate(&md5, &decoded_entry).await?;
    self.install(doc)
  }

  /// Stores `doc` under its canonical URI while preserving client version and unsaved text.
  pub(crate) fn install(&mut self, mut doc: Document) -> Result<Uri> {
    doc.uri = canonical_virtual_uri(&doc.uri);
    let uri = doc.uri.clone();
    if doc.version.is_none()
      && let Some(old) = self.docs.get(&uri)
      && old.version.is_some()
    {
      doc.version = old.version;
      if !old.clean() {
        doc.current = old.current.clone();
      }
      if old.saved != old.base {
        doc.saved = old.saved.clone();
      }
    }
    self.docs.insert(uri.clone(), doc);
    Ok(uri)
  }

  /// Removes clean document `uri` when no uncommitted local edits or rename previews remain.
  pub(crate) fn close_document(&mut self, uri: &Uri) {
    let canon = canonical_virtual_uri(uri);
    let keep = self.docs.get(&canon).is_some_and(|doc| {
      !doc.clean()
        || self
          .pending
          .get(&doc.md5)
          .is_some_and(|p| p.expected.contains_key(&canon))
    });
    if !keep {
      self.docs.remove(&canon);
      self.refresh_allowed.remove(&canon);
    }
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
