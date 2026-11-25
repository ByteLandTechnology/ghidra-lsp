// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Standalone read-only MCP fetch helpers that run without locking [`crate::engine::Engine`].

use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use super::{append_warning, find_function_symbol, format_type_markdown, legacy_format_error};
use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Span, Symbol, Token, align, extract_label_address, is_label_token, resolve,
  resolve_locals, virtual_uri,
};

/// Decompiled function document and semantic metadata ready to store in [`crate::engine::Engine`].
pub(crate) struct GeneratedFunction {
  /// Lowercase 32-character MD5 session hash that owns this function.
  pub(crate) md5: String,
  /// Generated virtual C document with aligned spans and diagnostic warnings.
  pub(crate) doc: Document,
  /// Whether refreshed C text differed from `previous_base`, invalidating cached symbols.
  pub(crate) clear_symbols: bool,
  /// Freshly fetched session symbol list when `cached_symbols` was absent or invalidated.
  pub(crate) fetched_symbols: Option<Vec<Symbol>>,
  /// Canonical entry address whose parameter and local variable metadata was rebuilt.
  pub(crate) local_entry: Option<String>,
  /// Rebuilt parameter and local variable details indexed by synthetic symbol ID.
  pub(crate) local_details: HashMap<String, Value>,
  /// Optional `(entry, function_json)` pair to insert into `Engine::functions`.
  pub(crate) cached_function: Option<(String, Value)>,
}

/// Fetches all symbols for session `md5` from `backend`.
pub(crate) async fn fetch_symbols(backend: &McpBackend, md5: &str) -> Result<Vec<Symbol>> {
  let items = list_all(
    backend,
    "symbol",
    md5,
    json!({"page": {"limit": 1000}, "scan": {"timeout_ms": 60000}}),
  )
  .await?;
  items
    .into_iter()
    .map(serde_json::from_value)
    .collect::<std::result::Result<Vec<Symbol>, _>>()
    .map_err(Into::into)
}

/// Checks that `md5` has 32 hexadecimal digits and `session.get` reports status `ready`.
pub(crate) async fn verify_session_ready(backend: &McpBackend, md5: &str) -> Result<()> {
  ensure!(
    md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
    "invalid session MD5"
  );
  let result = backend.call("session", "get", Some(md5), json!({})).await?;
  let status = result
    .pointer("/session/status")
    .or_else(|| result.get("status"))
    .and_then(Value::as_str);
  ensure!(status == Some("ready"), "session is not ready: {result}");
  Ok(())
}

/// Decompiles `entry` in session `md5`, aligns GUI spans and comments, and resolves symbols.
pub(crate) async fn fetch_function_document(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
  previous_base: Option<&str>,
  cached_symbols: Option<Vec<Symbol>>,
) -> Result<GeneratedFunction> {
  let params = json!({
    "selector": {"entry": entry},
    "scan": {"timeout_ms": 30000},
    "format": "document",
    "include_comments": true,
  });
  let text = match backend
    .call("decompilation", "get", Some(md5), params)
    .await
  {
    Ok(value) => value,
    Err(error) if legacy_format_error(&error) => {
      backend
        .call(
          "decompilation",
          "get",
          Some(md5),
          json!({"selector": {"entry": entry}, "scan": {"timeout_ms": 30000}, "format": "text"}),
        )
        .await?
    }
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
  let clear_symbols = previous_base.is_some_and(|old| old != doc.base);
  let usable_symbols = if clear_symbols { None } else { cached_symbols };
  let function = backend
    .call(
      "function",
      "get",
      Some(md5),
      json!({"selector": {"entry": doc.entry}}),
    )
    .await;

  let mut fetched_symbols = None;
  let mut local_entry = None;
  let mut local_details = HashMap::new();
  let mut cached_function = None;

  let semantic: Result<Vec<Span>> = async {
    let symbols = match usable_symbols {
      Some(existing) => existing,
      None => {
        let loaded = fetch_symbols(backend, md5).await?;
        fetched_symbols = Some(loaded.clone());
        loaded
      }
    };
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
    let entry_str = doc.entry.as_deref().unwrap_or(entry);
    local_entry = Some(entry_str.to_owned());
    let local_symbols = build_local_symbols(md5, entry_str, function, &mut local_details);
    bind_native_local_spans(
      md5,
      entry_str,
      &mut spans,
      &local_symbols,
      &mut local_details,
    );
    resolve_locals(&mut spans, &local_symbols);
    fill_fallback_spans(md5, entry_str, &doc.base, &symbols, &mut spans);
    cached_function = Some((
      doc.entry.clone().unwrap_or_else(|| entry.into()),
      function.clone(),
    ));
    Ok(spans)
  }
  .await;

  match semantic {
    Ok(spans) => doc.spans = spans,
    Err(e) => append_warning(&mut doc, &format!("Navigation disabled: {e:#}")),
  }
  if let Some(error) = comment_err {
    append_warning(&mut doc, &format!("Ghidra comments unavailable: {error:#}"));
  }
  Ok(GeneratedFunction {
    md5: md5.to_ascii_lowercase(),
    doc,
    clear_symbols,
    fetched_symbols,
    local_entry,
    local_details,
    cached_function,
  })
}

/// Extracts parameter and local variable [`Symbol`] records and populates `local_details`.
fn build_local_symbols(
  md5: &str,
  entry_str: &str,
  function: &Value,
  local_details: &mut HashMap<String, Value>,
) -> Vec<Symbol> {
  let mut local_symbols = Vec::new();
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
  local_symbols
}

/// Normalizes native GUI local variable and parameter symbols and links their details.
fn bind_native_local_spans(
  md5: &str,
  entry_str: &str,
  spans: &mut [Span],
  local_symbols: &[Symbol],
  local_details: &mut HashMap<String, Value>,
) {
  for span in spans {
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
}

/// Synthesizes fallback local, parameter, label, and header symbols for unresolved spans.
fn fill_fallback_spans(
  md5: &str,
  entry_str: &str,
  base: &str,
  symbols: &[Symbol],
  spans: &mut [Span],
) {
  for span in spans.iter_mut() {
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
        || is_label_token(&span.token.text, span.start, span.end, base))
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
    .map_or(base.len(), |span| span.start);
  if let Some(decl_span) = spans
    .iter_mut()
    .find(|s| s.token.kind == "function" && s.start < body_start)
    && decl_span.symbol.is_none()
  {
    if let Some(sym) = find_function_symbol(symbols, Some(entry_str), &decl_span.token.text) {
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
}

/// Builds synthetic read-only snapshot text for `type`, `symbol`, or `references` URIs.
pub(crate) async fn fetch_snapshot_text(
  backend: &McpBackend,
  md5: &str,
  kind: &str,
  id: &str,
) -> Result<String> {
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
        backend,
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
    backend,
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
