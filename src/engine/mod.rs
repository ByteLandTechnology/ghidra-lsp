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

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::Uri;

use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Symbol, Token, align, canonical_virtual_uri, data_type_name, extract_label_address,
  is_label_token, resolve, resolve_locals, same_address, virtual_uri,
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

/// Manages active Ghidra sessions, opened virtual buffers, and cached analysis state.
pub(crate) struct Engine {
  /// Connected MCP child-process backend.
  pub(crate) backend: Arc<McpBackend>,
  /// Currently selected 32-character lowercase MD5 session hash.
  pub(crate) active: Option<String>,
  /// Virtual documents indexed by their canonical `ghidra://` URI.
  pub(crate) docs: HashMap<Uri, Document>,
  /// Cached symbol tables keyed by lowercase session MD5.
  pub(crate) symbols: HashMap<String, Vec<Symbol>>,
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
      symbols: HashMap::new(),
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

  /// Removes clean document `uri` when no uncommitted local edits remain.
  pub(crate) fn close_document(&mut self, uri: &Uri) {
    let canon = canonical_virtual_uri(uri);
    let keep = self.docs.get(&canon).is_some_and(|doc| !doc.clean());
    if !keep {
      self.docs.remove(&canon);
    }
  }

  /// Builds synthetic read-only snapshot text for `type`, `symbol`, or `references` URIs.
  pub(crate) async fn snapshot_text(&self, md5: &str, kind: &str, id: &str) -> Result<String> {
    if kind == "type" {
      let path = id.strip_suffix(".md").unwrap_or(id);
      let type_data = if path.starts_with('/') {
        self
          .backend
          .call(
            "data_type",
            "get",
            Some(md5),
            json!({"selector": {"path": path}}),
          )
          .await?
      } else {
        let types = list_all(
          self.backend.as_ref(),
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
        self
          .backend
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
      self
        .backend
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
      self.backend.as_ref(),
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
