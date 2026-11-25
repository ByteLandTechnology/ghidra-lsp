// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Completion, signature help, and data-type resolution handlers on [`Engine`].

use std::collections::HashSet;

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tower_lsp_server::ls_types::{
  CompletionItem, CompletionItemKind, Location, ParameterInformation, ParameterLabel, Position,
  Range, SignatureHelp, SignatureInformation, Uri,
};

use super::{Engine, ensure_symbols, find_function_symbol, format_type_markdown};
use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Symbol, canonical_virtual_uri, data_type_name, offset, virtual_uri,
};

/// Built-in decompiler type names offered alongside program and local symbols.
const COMMON_TYPES: &[&str] = &[
  "void",
  "int",
  "char",
  "short",
  "long",
  "float",
  "double",
  "byte",
  "word",
  "dword",
  "qword",
  "uint",
  "uchar",
  "ulong",
  "ushort",
  "size_t",
  "int8_t",
  "int16_t",
  "int32_t",
  "int64_t",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "uint64_t",
  "undefined",
  "undefined1",
  "undefined2",
  "undefined4",
  "undefined8",
  "pointer",
  "bool",
  "string",
];

/// Owned document state extracted before fetching completion symbols.
struct CompletionSnapshot {
  /// Lowercase 32-character MD5 session hash owning the document.
  md5: String,
  /// Lowercase identifier prefix preceding the cursor.
  prefix_lower: String,
  /// Local and parameter symbols paired with their optional formatted detail text.
  locals: Vec<(Symbol, Option<String>)>,
}

/// Owned call-site target extracted before fetching signature help metadata.
pub(crate) struct SignatureTarget {
  /// Lowercase 32-character MD5 session hash owning the document.
  pub(crate) md5: String,
  /// Resolved callee function symbol.
  pub(crate) symbol: Symbol,
  /// Zero-based active argument index at the cursor position.
  pub(crate) argument: u32,
}

/// Source kind of a data-type lookup extracted from a clean document span.
pub(crate) enum TypeSource {
  /// Structured type reference from a `type` token or cached local variable detail.
  Reference(Value),
  /// Function symbol whose `return_type` is loaded via `function.get`.
  FunctionReturn {
    /// Canonical entry address of the function.
    address: String,
  },
  /// Label symbol whose `data_type` is loaded via `global_variable.get`.
  GlobalLabel {
    /// Canonical address of the global variable or label.
    address: String,
  },
}

/// Owned span and symbol state extracted before fetching a Ghidra data-type definition.
pub(crate) struct TypeTargetSnapshot {
  /// Lowercase 32-character MD5 session hash owning the document.
  pub(crate) md5: String,
  /// UTF-16 range of the inspected token in the document.
  pub(crate) range: Range,
  /// Origin used to resolve the target type reference.
  pub(crate) source: TypeSource,
}

impl Engine {
  /// Snapshots cursor prefix and local variable state for completion without MCP I/O.
  fn prepare_completion(&self, uri: &Uri, pos: Position) -> Result<CompletionSnapshot> {
    let canon = canonical_virtual_uri(uri);
    let doc = self.docs.get(&canon).context("Unknown virtual document")?;
    ensure!(
      doc.clean(),
      "Refresh modified decompilation before requesting semantic completion"
    );
    let cursor = offset(&doc.base, pos).context("Invalid completion position")?;
    let prefix: String = doc.base[..cursor]
      .chars()
      .rev()
      .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
      .collect::<String>()
      .chars()
      .rev()
      .collect();
    let locals = doc
      .spans
      .iter()
      .filter_map(|s| s.symbol.as_ref())
      .filter(|s| s.local())
      .map(|sym| {
        let detail = self
          .local_detail(sym)
          .map(|v| format!("{} · {}", data_type_name(&v["data_type"]), sym.kind));
        (sym.clone(), detail)
      })
      .collect();
    Ok(CompletionSnapshot {
      md5: doc.md5.clone(),
      prefix_lower: prefix.to_lowercase(),
      locals,
    })
  }

  /// Snapshots the enclosing call expression and argument index at `pos` without MCP I/O.
  pub(crate) fn prepare_signature_help(
    &self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<SignatureTarget>> {
    let canon = canonical_virtual_uri(uri);
    let doc = self.docs.get(&canon).context("Unknown virtual document")?;
    if !doc.clean() {
      return Ok(None);
    }
    let cursor = offset(&doc.base, pos).context("Invalid signature position")?;
    let mut stack: Vec<Option<(Symbol, u32)>> = vec![];
    let mut previous = None;
    for span in doc.spans.iter().take_while(|s| s.start < cursor) {
      let token = span.token.text.trim();
      // Native GUI layout includes whitespace and zero-width separators.
      // They do not interrupt a callee followed by its argument list.
      if token.is_empty() || span.token.kind == "comment" {
        continue;
      }
      match token {
        "(" => stack.push(previous.take().map(|s| (s, 0))),
        ")" => {
          stack.pop();
          previous = None;
        }
        "," => {
          if let Some(Some((_, argument))) = stack.last_mut() {
            *argument += 1;
          }
          previous = None;
        }
        _ => {
          if let Some(sym) = &span.symbol {
            if sym.kind.eq_ignore_ascii_case("function") {
              previous = Some(sym.clone());
            } else {
              previous = None;
            }
          } else if span.token.kind == "function" {
            let sym = self
              .symbols
              .get(&doc.md5)
              .and_then(|syms| {
                find_function_symbol(syms, span.token.address.as_deref(), &span.token.text)
              })
              .cloned()
              .or_else(|| {
                span.token.address.as_ref().map(|addr| Symbol {
                  demangled_name: None,
                  id: format!("Function:{}:{}", doc.md5, addr),
                  name: span.token.text.clone(),
                  address: addr.clone(),
                  namespace: String::new(),
                  kind: "Function".into(),
                })
              });
            previous = sym;
          } else {
            previous = None;
          }
        }
      }
    }
    let Some((symbol, argument)) = stack.into_iter().rev().flatten().next() else {
      return Ok(None);
    };
    // The function header is a declaration, not a call expression.
    if doc.entry.as_deref() == Some(symbol.address.as_str())
      && doc
        .spans
        .iter()
        .find(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
        .is_some_and(|s| s.start < doc.body_start())
    {
      // Recursive calls in the body remain eligible.
      let body_start = doc.body_start();
      if cursor < body_start {
        return Ok(None);
      }
    }
    Ok(Some(SignatureTarget {
      md5: doc.md5.clone(),
      symbol,
      argument,
    }))
  }

  /// Snapshots the token or symbol at `pos` needed to query a Ghidra data-type definition.
  pub(crate) fn prepare_type_definition(
    &self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<TypeTargetSnapshot>> {
    let canon = canonical_virtual_uri(uri);
    let doc = self.docs.get(&canon).context("Unknown virtual document")?;
    if !doc.clean() {
      return Ok(None);
    }
    let Some(span) = doc.span_at(pos) else {
      return Ok(None);
    };
    let range = doc.range(span);
    let source = if span.token.kind == "type" {
      TypeSource::Reference(json!({"kind": "named", "name": span.token.text}))
    } else if let Some(symbol) = &span.symbol {
      if let Some(detail) = self.local_detail(symbol) {
        TypeSource::Reference(detail["data_type"].clone())
      } else if symbol.kind.eq_ignore_ascii_case("function") {
        TypeSource::FunctionReturn {
          address: symbol.address.clone(),
        }
      } else if symbol.kind.eq_ignore_ascii_case("label") {
        TypeSource::GlobalLabel {
          address: symbol.address.clone(),
        }
      } else {
        return Ok(None);
      }
    } else {
      return Ok(None);
    };
    Ok(Some(TypeTargetSnapshot {
      md5: doc.md5.clone(),
      range,
      source,
    }))
  }
}

/// Returns semantic completion items without holding `engine` across `McpBackend::call`.
pub(crate) async fn completion(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  uri: &Uri,
  pos: Position,
) -> Result<Vec<CompletionItem>> {
  let snapshot = engine.lock().await.prepare_completion(uri, pos)?;
  let global_symbols = ensure_symbols(engine, backend, &snapshot.md5).await?;
  Ok(build_completion_items(snapshot, global_symbols))
}

/// Formats and sorts local, global, and built-in C type completion items.
fn build_completion_items(
  snapshot: CompletionSnapshot,
  global_symbols: Vec<Symbol>,
) -> Vec<CompletionItem> {
  let mut seen = HashSet::new();
  let mut items = vec![];
  let candidates = snapshot.locals.into_iter().chain(
    global_symbols
      .into_iter()
      .filter(Symbol::eligible)
      .map(|sym| (sym, None)),
  );
  for (symbol, local_detail) in candidates {
    let display = symbol.display_name();
    if !(symbol
      .name
      .to_lowercase()
      .starts_with(&snapshot.prefix_lower)
      || symbol
        .full_name()
        .to_lowercase()
        .contains(&snapshot.prefix_lower))
      || !seen.insert(symbol.id.clone())
    {
      continue;
    }
    let detail = local_detail.unwrap_or_else(|| format!("{} · {}", symbol.kind, symbol.address));
    items.push(CompletionItem {
      label: display,
      insert_text: Some(symbol.name.clone()),
      kind: Some(if symbol.kind.eq_ignore_ascii_case("function") {
        CompletionItemKind::FUNCTION
      } else {
        CompletionItemKind::VARIABLE
      }),
      detail: Some(detail),
      sort_text: Some(format!(
        "{}_{}",
        if symbol.local() { "0" } else { "1" },
        symbol.name
      )),
      ..Default::default()
    });
  }
  for t in COMMON_TYPES {
    if t.to_lowercase().starts_with(&snapshot.prefix_lower) && seen.insert((*t).to_owned()) {
      items.push(CompletionItem {
        label: (*t).to_owned(),
        kind: Some(CompletionItemKind::TYPE_PARAMETER),
        detail: Some("built-in type".into()),
        sort_text: Some(format!("2_{t}")),
        ..Default::default()
      });
    }
  }
  items.sort_by(|a, b| a.sort_text.cmp(&b.sort_text));
  items
}

/// Fetches parameter signature help for `target` from `backend` without locking [`Engine`].
pub(crate) async fn fetch_signature_help(
  backend: &McpBackend,
  target: SignatureTarget,
) -> Option<SignatureHelp> {
  let function = backend
    .call(
      "function",
      "get",
      Some(&target.md5),
      json!({"selector": {"entry": target.symbol.address}}),
    )
    .await
    .ok()?;
  let parameters: Vec<_> = function
    .get("parameters")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .map(|p| ParameterInformation {
      label: ParameterLabel::Simple(format!(
        "{} {}",
        data_type_name(&p["data_type"]),
        p.get("name").and_then(Value::as_str).unwrap_or("")
      )),
      documentation: None,
    })
    .collect();
  let fallback = format!(
    "{} {}({})",
    data_type_name(&function["return_type"]),
    target.symbol.name,
    parameters
      .iter()
      .map(|p| match &p.label {
        ParameterLabel::Simple(s) => s.as_str(),
        ParameterLabel::LabelOffsets(_) => "",
      })
      .collect::<Vec<_>>()
      .join(", ")
  );
  let label = function
    .get("signature")
    .and_then(Value::as_str)
    .unwrap_or(&fallback)
    .to_owned();
  let active = if parameters.is_empty() {
    None
  } else {
    Some(target.argument.min(parameters.len() as u32 - 1))
  };
  Some(SignatureHelp {
    signatures: vec![SignatureInformation {
      label,
      documentation: None,
      parameters: Some(parameters),
      active_parameter: active,
    }],
    active_signature: Some(0),
    active_parameter: active,
  })
}

/// Resolves the underlying Ghidra data-type JSON for `snapshot` without locking [`Engine`].
pub(crate) async fn fetch_type_definition(
  backend: &McpBackend,
  snapshot: TypeTargetSnapshot,
) -> Result<Option<Value>> {
  let md5 = &snapshot.md5;
  let mut reference = match snapshot.source {
    TypeSource::Reference(value) => value,
    TypeSource::FunctionReturn { address } => backend
      .call(
        "function",
        "get",
        Some(md5),
        json!({"selector": {"entry": address}}),
      )
      .await?["return_type"]
      .clone(),
    TypeSource::GlobalLabel { address } => {
      let Ok(global) = backend
        .call(
          "global_variable",
          "get",
          Some(md5),
          json!({"selector": {"address": address}}),
        )
        .await
      else {
        return Ok(None);
      };
      global["data_type"].clone()
    }
  };
  loop {
    reference = match reference.get("kind").and_then(Value::as_str) {
      Some("pointer") => reference["target"].clone(),
      Some("array") => reference["element"].clone(),
      _ => break,
    };
  }
  let Some(name) = reference.get("name").and_then(Value::as_str) else {
    return Ok(None);
  };
  if name.starts_with('/') {
    return Ok(
      backend
        .call(
          "data_type",
          "get",
          Some(md5),
          json!({"selector": {"path": name}}),
        )
        .await
        .ok(),
    );
  }
  let types = list_all(
    backend,
    "data_type",
    md5,
    json!({"filter": {"query": name}, "page": {"limit": 1000}}),
  )
  .await?;
  let candidates: Vec<_> = types
    .iter()
    .filter(|v| {
      v.get("name").and_then(Value::as_str) == Some(name)
        || v.get("path").and_then(Value::as_str) == Some(name)
    })
    .collect();
  let selected = if let Some(first) = candidates
    .iter()
    .find(|v| v.get("name").and_then(Value::as_str) == Some(name))
  {
    first
  } else if let Some(first) = candidates.first() {
    first
  } else {
    if let Ok(builtin) = backend
      .call(
        "data_type",
        "get",
        Some(md5),
        json!({"selector": {"path": format!("/{name}")}}),
      )
      .await
    {
      return Ok(Some(builtin));
    }
    return Ok(None);
  };
  let path = selected
    .get("path")
    .and_then(Value::as_str)
    .context("Type lacks its full path")?;
  Ok(Some(
    backend
      .call(
        "data_type",
        "get",
        Some(md5),
        json!({"selector": {"path": path}}),
      )
      .await?,
  ))
}

/// Opens a virtual Markdown document describing the resolved data type at `pos`.
pub(crate) async fn goto_type_definition(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  uri: &Uri,
  pos: Position,
) -> Result<Option<Location>> {
  let (snapshot, generation) = {
    let e = engine.lock().await;
    let Some(snap) = e.prepare_type_definition(uri, pos)? else {
      return Ok(None);
    };
    let generation = e.generation(&snap.md5);
    (snap, generation)
  };
  let md5 = snapshot.md5.clone();
  let Some(type_data) = fetch_type_definition(backend, snapshot).await? else {
    return Ok(None);
  };
  let path = type_data
    .get("path")
    .and_then(Value::as_str)
    .context("Type lacks full path")?;
  let name = type_data
    .get("name")
    .and_then(Value::as_str)
    .unwrap_or("type");
  let key = format!("{path}.md");
  let type_uri = virtual_uri(&md5, "type", &key)?;
  let md = format_type_markdown(&type_data);
  {
    let mut e = engine.lock().await;
    if e.generation(&md5) == generation {
      e.install(Document {
        uri: type_uri.clone(),
        md5,
        entry: None,
        base: md.clone(),
        current: md.clone(),
        saved: md,
        version: None,
        spans: vec![],
        warning: None,
      })?;
    }
  }
  let range = Range::new(
    Position::new(0, 0),
    Position::new(0, (2 + name.encode_utf16().count()) as u32),
  );
  Ok(Some(Location::new(type_uri, range)))
}
