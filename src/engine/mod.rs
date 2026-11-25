// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Session selection, virtual document generation, and code intelligence engine.

/// Completion, signature help, and type-definition lookups.
mod assist;
/// Highlights, inlay hints, code lenses, folding ranges, and document links.
mod decorations;
/// Standalone read-only MCP fetch helpers.
mod fetch;
/// Incoming and outgoing call hierarchy builders.
mod hierarchy;
/// Symbol resolution, definitions, and cross-reference lookups.
mod navigation;
/// Scoped rename preview, origin save persistence, and document refresh.
mod rename;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use serde_json::Value;
use tokio::sync::Mutex;
use tower_lsp_server::ls_types::Uri;

pub(crate) use assist::{
  completion, fetch_signature_help, fetch_type_definition, goto_type_definition,
};
pub(crate) use fetch::{
  GeneratedFunction, fetch_function_document, fetch_snapshot_text, fetch_symbols,
  verify_session_ready,
};
pub(crate) use hierarchy::{incoming_calls, outgoing_calls, prepare_call_hierarchy};
pub(crate) use navigation::{goto_definition, references, symbol_location};
pub(crate) use rename::refresh_document;

use crate::backend::McpBackend;
use crate::document::{Document, Symbol, canonical_virtual_uri, data_type_name, same_address};

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

/// Uninstalled client editor buffer state recorded while `did_open` awaits `ghidra-mcp`.
#[derive(Clone)]
pub(crate) struct OpenBuffer {
  /// Lowercase 32-character MD5 session hash parsed from the virtual URI.
  pub(crate) md5: String,
  /// Latest LSP document version received from `didOpen` or `didChange`.
  pub(crate) version: i32,
  /// Latest full text received from `didOpen` or `didChange`.
  pub(crate) text: String,
}

/// Manages active Ghidra sessions, opened virtual buffers, and cached analysis state.
pub(crate) struct Engine {
  /// Connected MCP child-process backend used by serialized write and refresh paths.
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
  /// Monotonic per-session generation counter incremented on write, refresh, or close.
  generations: HashMap<String, u64>,
  /// Client buffer state captured while an initial `did_open` fetch is in flight.
  open_buffers: HashMap<Uri, OpenBuffer>,
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
      generations: HashMap::new(),
      open_buffers: HashMap::new(),
    }
  }

  /// Returns the selected session MD5 or an error when no session is active.
  pub(crate) fn session(&self) -> Result<&str> {
    self
      .active
      .as_deref()
      .context("Select a Ghidra session first")
  }

  /// Returns the current cache generation counter for session `md5`.
  pub(crate) fn generation(&self, md5: &str) -> u64 {
    self
      .generations
      .get(&md5.to_ascii_lowercase())
      .copied()
      .unwrap_or(0)
  }

  /// Increments the cache generation counter for session `md5` to reject stale reads.
  pub(crate) fn bump_generation(&mut self, md5: &str) -> u64 {
    let entry = self
      .generations
      .entry(md5.to_ascii_lowercase())
      .or_insert(0);
    *entry = entry.wrapping_add(1);
    *entry
  }

  /// Stores `symbols` for `md5` when `generation` matches the current session counter.
  pub(crate) fn store_symbols(&mut self, md5: &str, generation: u64, symbols: Vec<Symbol>) {
    let key = md5.to_ascii_lowercase();
    if self.generation(&key) == generation {
      self.symbols.insert(key, symbols);
    }
  }

  /// Records an in-flight `did_open` client buffer unless a newer version is already stored.
  pub(crate) fn record_open_buffer(&mut self, uri: &Uri, md5: &str, version: i32, text: String) {
    let canon = canonical_virtual_uri(uri);
    match self.open_buffers.get_mut(&canon) {
      Some(existing) if version < existing.version => {}
      Some(existing) => {
        existing.version = version;
        existing.text = text;
      }
      None => {
        self.open_buffers.insert(
          canon,
          OpenBuffer {
            md5: md5.to_ascii_lowercase(),
            version,
            text,
          },
        );
      }
    }
  }

  /// Applies a `did_change` update to an in-flight `did_open` buffer when `version` is monotonic.
  pub(crate) fn update_open_buffer(&mut self, uri: &Uri, version: i32, text: String) -> bool {
    let canon = canonical_virtual_uri(uri);
    let Some(existing) = self.open_buffers.get_mut(&canon) else {
      return false;
    };
    if version >= existing.version {
      existing.version = version;
      existing.text = text;
    }
    true
  }

  /// Takes any pending `did_open` buffer entry recorded for `uri`.
  pub(crate) fn take_open_buffer(&mut self, uri: &Uri) -> Option<OpenBuffer> {
    let canon = canonical_virtual_uri(uri);
    self.open_buffers.remove(&canon)
  }

  /// Removes all in-flight `did_open` buffer entries belonging to session `md5`.
  pub(super) fn clear_open_buffers_for_session(&mut self, md5: &str) {
    let key = md5.to_ascii_lowercase();
    self.open_buffers.retain(|_, buf| buf.md5 != key);
  }

  /// Drops all cached parameter and local variable details for `(md5, entry)`.
  pub(super) fn clear_local_details_for_entry(&mut self, md5: &str, entry: &str) {
    let param_prefix = format!("Parameter:{md5}:{entry}:");
    let local_prefix = format!("Local:{md5}:{entry}:");
    self
      .local_details
      .retain(|k, _| !k.starts_with(&param_prefix) && !k.starts_with(&local_prefix));
  }

  /// Drops all cached parameter and local variable details for session `md5`.
  pub(super) fn clear_local_details_for_session(&mut self, md5: &str) {
    let local_prefix = format!("Local:{md5}:");
    let parameter_prefix = format!("Parameter:{md5}:");
    self
      .local_details
      .retain(|id, _| !id.starts_with(&local_prefix) && !id.starts_with(&parameter_prefix));
  }

  /// Returns cached parameter or local variable detail for `symbol` when present.
  pub(crate) fn local_detail(&self, symbol: &Symbol) -> Option<Value> {
    symbol
      .local()
      .then(|| self.local_details.get(&symbol.id).cloned())
      .flatten()
  }

  /// Finds an already opened function document matching `(md5, entry)`.
  pub(crate) fn find_function_doc(&self, md5: &str, entry: &str) -> Option<&Document> {
    let md5 = md5.to_ascii_lowercase();
    let decoded_entry = percent_encoding::percent_decode_str(entry)
      .decode_utf8()
      .unwrap_or(std::borrow::Cow::Borrowed(entry));
    self.docs.values().find(|d| {
      d.md5 == md5
        && d.entry.as_deref().is_some_and(|e| {
          e == entry || e == decoded_entry.as_ref() || same_address(e, &decoded_entry)
        })
    })
  }

  /// Applies symbol, local variable, and function caches from `generated` without installing `doc`.
  pub(super) fn apply_generated_caches(&mut self, generated: &mut GeneratedFunction) {
    if generated.clear_symbols {
      self.symbols.remove(&generated.md5);
    }
    if let Some(symbols) = generated.fetched_symbols.take() {
      self.symbols.insert(generated.md5.clone(), symbols);
    }
    if let Some(entry_str) = generated.local_entry.take() {
      self.clear_local_details_for_entry(&generated.md5, &entry_str);
      self
        .local_details
        .extend(std::mem::take(&mut generated.local_details));
    }
    if let Some((entry_key, function)) = generated.cached_function.take() {
      self
        .functions
        .insert((generated.md5.clone(), entry_key), function);
    }
  }

  /// Commits `generated` into caches and installs its document when `generation` still matches.
  pub(crate) fn commit_generated(
    &mut self,
    generation: u64,
    mut generated: GeneratedFunction,
  ) -> Result<Option<Uri>> {
    if self.generation(&generated.md5) != generation {
      return Ok(None);
    }
    self.apply_generated_caches(&mut generated);
    let uri = self.install(generated.doc)?;
    Ok(Some(uri))
  }

  /// Decompiles `entry` in session `md5` while holding `&mut Engine` during serialized refresh.
  pub(super) async fn generate(&mut self, md5: &str, entry: &str) -> Result<Document> {
    let cached_symbols = self.symbols.get(md5).cloned();
    let mut generated =
      fetch_function_document(self.backend.as_ref(), md5, entry, None, cached_symbols).await?;
    self.apply_generated_caches(&mut generated);
    Ok(generated.doc)
  }

  /// Stores `doc` under its canonical URI while preserving newer client versions and edits.
  pub(crate) fn install(&mut self, mut doc: Document) -> Result<Uri> {
    doc.uri = canonical_virtual_uri(&doc.uri);
    let uri = doc.uri.clone();
    if let Some(buf) = self.open_buffers.remove(&uri)
      && doc.version.is_none_or(|new_ver| buf.version >= new_ver)
    {
      doc.version = Some(buf.version);
      doc.current = buf.text;
    }
    if let Some(old) = self.docs.get(&uri) {
      match (doc.version, old.version) {
        (None, Some(old_ver)) => {
          doc.version = Some(old_ver);
          if !old.clean() {
            doc.current = old.current.clone();
          }
          if old.saved != old.base {
            doc.saved = old.saved.clone();
          }
        }
        (Some(new_ver), Some(old_ver)) if old_ver > new_ver => {
          doc.version = Some(old_ver);
          doc.current = old.current.clone();
          if old.saved != old.base {
            doc.saved = old.saved.clone();
          }
        }
        (_, Some(_)) => {
          if old.saved != old.base {
            doc.saved = old.saved.clone();
          }
        }
        (_, None) => {}
      }
    }
    self.docs.insert(uri.clone(), doc);
    Ok(uri)
  }

  /// Removes clean document `uri` when no uncommitted local edits or rename previews remain.
  pub(crate) fn close_document(&mut self, uri: &Uri) {
    let canon = canonical_virtual_uri(uri);
    self.open_buffers.remove(&canon);
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

/// Returns cached symbols for `md5` or fetches them without holding `engine` across MCP I/O.
pub(crate) async fn ensure_symbols(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  md5: &str,
) -> Result<Vec<Symbol>> {
  let key = md5.to_ascii_lowercase();
  let generation = {
    let e = engine.lock().await;
    if let Some(symbols) = e.symbols.get(&key) {
      return Ok(symbols.clone());
    }
    e.generation(&key)
  };
  let symbols = fetch_symbols(backend, &key).await?;
  {
    let mut e = engine.lock().await;
    e.store_symbols(&key, generation, symbols.clone());
  }
  Ok(symbols)
}

/// Verifies that session `md5` is ready without holding `engine` and marks it active.
pub(crate) async fn select_session(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  md5: &str,
) -> Result<()> {
  ensure!(
    md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
    "invalid session MD5"
  );
  let key = md5.to_ascii_lowercase();
  let generation = engine.lock().await.generation(&key);
  verify_session_ready(backend, &key).await?;
  let mut e = engine.lock().await;
  ensure!(
    e.generation(&key) == generation,
    "session state changed while selecting session; retry"
  );
  e.active = Some(key);
  Ok(())
}

/// Opens a cached function document or fetches and installs it without holding `engine` across I/O.
pub(crate) async fn open_function(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  md5: &str,
  entry: &str,
) -> Result<(Uri, Document)> {
  ensure!(
    md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
    "invalid session MD5"
  );
  let md5 = md5.to_ascii_lowercase();
  let decoded_entry = percent_encoding::percent_decode_str(entry)
    .decode_utf8()
    .unwrap_or(std::borrow::Cow::Borrowed(entry))
    .into_owned();
  let (cached_symbols, generation) = {
    let e = engine.lock().await;
    if let Some(doc) = e.find_function_doc(&md5, &decoded_entry) {
      return Ok((doc.uri.clone(), doc.clone()));
    }
    (e.symbols.get(&md5).cloned(), e.generation(&md5))
  };
  let generated =
    fetch_function_document(backend, &md5, &decoded_entry, None, cached_symbols).await?;
  let fallback = generated.doc.clone();
  let mut e = engine.lock().await;
  if let Some(uri) = e.commit_generated(generation, generated)?
    && let Some(doc) = e.docs.get(&uri)
  {
    return Ok((uri, doc.clone()));
  }
  if let Some(doc) = e.find_function_doc(&md5, &decoded_entry) {
    return Ok((doc.uri.clone(), doc.clone()));
  }
  let uri = canonical_virtual_uri(&fallback.uri);
  Ok((uri, fallback))
}

/// Opens or updates virtual document `uri` on `didOpen` without holding `engine` across MCP I/O.
pub(crate) async fn did_open_document(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  uri: &Uri,
  version: i32,
  text: String,
) {
  let canon = canonical_virtual_uri(uri);
  let fetch_plan = {
    let mut e = engine.lock().await;
    if let Some(doc) = e.docs.get_mut(&canon) {
      if doc.version.is_none_or(|old_ver| version >= old_ver) {
        doc.current = text;
        doc.version = Some(version);
      }
      return;
    }
    let Ok(parsed) = url::Url::parse(canon.as_str()) else {
      return;
    };
    if parsed.scheme() != "ghidra" {
      return;
    }
    let Some(md5_str) = parsed.host_str() else {
      return;
    };
    let path = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
    let Some((kind_str, raw_key)) = path.split_once('/') else {
      return;
    };
    let Ok(decoded) = percent_encoding::percent_decode_str(raw_key).decode_utf8() else {
      return;
    };
    let md5 = md5_str.to_ascii_lowercase();
    let kind = kind_str.to_owned();
    let key = decoded.into_owned();
    if kind == "function"
      && let Some(existing_uri) = e.find_function_doc(&md5, &key).map(|d| d.uri.clone())
    {
      if let Some(doc) = e.docs.get_mut(&existing_uri)
        && doc.version.is_none_or(|old_ver| version >= old_ver)
      {
        doc.current = text;
        doc.version = Some(version);
      }
      return;
    }
    if !matches!(kind.as_str(), "function" | "symbol" | "references" | "type") {
      return;
    }
    e.record_open_buffer(&canon, &md5, version, text);
    let cached_symbols = (kind == "function")
      .then(|| e.symbols.get(&md5).cloned())
      .flatten();
    let generation = e.generation(&md5);
    (md5, kind, key, cached_symbols, generation)
  };

  let (md5, kind, key, cached_symbols, generation) = fetch_plan;
  if kind == "function" {
    let Ok(mut generated) =
      fetch_function_document(backend, &md5, &key, None, cached_symbols).await
    else {
      engine.lock().await.take_open_buffer(&canon);
      return;
    };
    let mut e = engine.lock().await;
    let buf = e.take_open_buffer(&canon);
    let gen_uri = canonical_virtual_uri(&generated.doc.uri);
    if e.generation(&md5) != generation {
      return;
    }
    if let Some(buf) = buf {
      generated.doc.version = Some(buf.version);
      generated.doc.current = buf.text;
      let _ = e.commit_generated(generation, generated);
    } else if e.docs.contains_key(&gen_uri) {
      let _ = e.commit_generated(generation, generated);
    }
  } else {
    let Ok(snap_text) = fetch_snapshot_text(backend, &md5, &kind, &key).await else {
      engine.lock().await.take_open_buffer(&canon);
      return;
    };
    let mut e = engine.lock().await;
    let buf = e.take_open_buffer(&canon);
    if e.generation(&md5) != generation {
      return;
    }
    if let Some(buf) = buf {
      let _ = e.install(Document {
        uri: canon,
        md5,
        entry: None,
        base: snap_text.clone(),
        current: buf.text,
        saved: snap_text,
        version: Some(buf.version),
        spans: vec![],
        warning: None,
      });
    } else if e.docs.contains_key(&canon) {
      let _ = e.install(Document {
        uri: canon,
        md5,
        entry: None,
        base: snap_text.clone(),
        current: snap_text.clone(),
        saved: snap_text,
        version: None,
        spans: vec![],
        warning: None,
      });
    }
  }
}

/// Formats structured data-type JSON returned by `ghidra-mcp` into Markdown documentation.
pub(crate) fn format_type_markdown(data: &Value) -> String {
  let name = data
    .get("name")
    .and_then(Value::as_str)
    .unwrap_or("Unknown");
  let kind = data.get("kind").and_then(Value::as_str).unwrap_or("type");
  let length = data
    .get("length")
    .or_else(|| data.get("size"))
    .and_then(Value::as_u64)
    .map(|s| format!("{s} bytes (`0x{s:x}`)"))
    .unwrap_or_else(|| "Unknown / variable".into());
  let category = data
    .get("category_path")
    .and_then(Value::as_str)
    .unwrap_or("/");
  let path = data.get("path").and_then(Value::as_str).unwrap_or("");

  let mut md = format!("# {kind} {name}\n\n");
  md.push_str(&format!("- **Kind**: `{kind}`\n"));
  md.push_str(&format!("- **Path**: `{path}`\n"));
  md.push_str(&format!("- **Category**: `{category}`\n"));
  md.push_str(&format!("- **Size**: {length}\n"));

  if let Some(desc) = data.get("description").and_then(Value::as_str)
    && !desc.trim().is_empty()
  {
    md.push_str(&format!("- **Description**: {desc}\n"));
  }
  if let Some(base) = data.get("base_type") {
    let base_name = data_type_name(base);
    if !base_name.is_empty() && base_name != "unknown" {
      md.push_str(&format!("- **Base Type**: `{base_name}`\n"));
    }
  }

  if let Some(fields) = data
    .get("fields")
    .and_then(Value::as_array)
    .filter(|f| !f.is_empty())
  {
    md.push_str("\n## Fields\n\n");
    md.push_str("| Offset | Size | Name | Type | Notes |\n");
    md.push_str("| :--- | :--- | :--- | :--- | :--- |\n");
    for f in fields {
      let offset = f
        .get("offset")
        .and_then(Value::as_u64)
        .map(|o| format!("`+0x{o:04x}`"))
        .unwrap_or_else(|| "-".into());
      let size = f
        .get("length")
        .and_then(Value::as_u64)
        .map(|s| s.to_string())
        .unwrap_or_else(|| "-".into());
      let fname = f.get("name").and_then(Value::as_str).unwrap_or("(unnamed)");
      let ftype = data_type_name(&f["data_type"]);
      let notes = f.get("comment").and_then(Value::as_str).unwrap_or("");
      md.push_str(&format!(
        "| {offset} | {size} | `{fname}` | `{ftype}` | {notes} |\n"
      ));
    }
  }

  if let Some(values) = data
    .get("values")
    .and_then(Value::as_array)
    .filter(|v| !v.is_empty())
  {
    md.push_str("\n## Enum Values\n\n");
    md.push_str("| Name | Value | Comment |\n");
    md.push_str("| :--- | :--- | :--- |\n");
    for v in values {
      let vname = v.get("name").and_then(Value::as_str).unwrap_or("");
      let val = v
        .get("value")
        .map(|val| {
          val
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| val.to_string())
        })
        .unwrap_or_default();
      let comm = v.get("comment").and_then(Value::as_str).unwrap_or("");
      md.push_str(&format!("| `{vname}` | `{val}` | {comm} |\n"));
    }
  }

  if let Some(sig) = data.get("signature") {
    md.push_str("\n## Function Signature\n\n");
    if let Some(sig_str) = sig.as_str() {
      md.push_str(&format!("`{sig_str}`\n"));
    } else if let Some(sig_obj) = sig.as_object() {
      if let Some(ret) = sig_obj.get("return_type") {
        md.push_str(&format!("- **Return Type**: `{}`\n", data_type_name(ret)));
      }
      if let Some(conv) = sig_obj.get("calling_convention").and_then(Value::as_str) {
        md.push_str(&format!("- **Calling Convention**: `{conv}`\n"));
      }
      if let Some(params) = sig_obj
        .get("parameters")
        .and_then(Value::as_array)
        .filter(|p| !p.is_empty())
      {
        md.push_str("\n### Parameters\n\n");
        md.push_str("| Ordinal | Name | Type |\n");
        md.push_str("| :--- | :--- | :--- |\n");
        for (idx, p) in params.iter().enumerate() {
          let pname = p.get("name").and_then(Value::as_str).unwrap_or("(unnamed)");
          let ptype = data_type_name(&p["data_type"]);
          md.push_str(&format!("| {idx} | `{pname}` | `{ptype}` |\n"));
        }
      }
    }
  }

  md
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
