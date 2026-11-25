// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Completion, signature help, and data-type resolution handlers on [`Engine`].

use std::collections::HashSet;

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  CompletionItem, CompletionItemKind, Location, ParameterInformation, ParameterLabel, Position,
  Range, SignatureHelp, SignatureInformation, Uri,
};

use super::{Engine, find_function_symbol, format_type_markdown};
use crate::backend::list_all;
use crate::document::{
  Document, Symbol, canonical_virtual_uri, contains_case_insensitive, data_type_name, offset,
  same_storage, starts_with_case_insensitive, virtual_uri,
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

impl Engine {
  /// Returns semantic completion items for locals, program symbols, and built-in C types.
  pub(crate) async fn completion(
    &mut self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Vec<CompletionItem>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let doc = self.docs.get(uri).context("Unknown virtual document")?;
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
    let prefix_lower = prefix.to_lowercase();
    let md5 = doc.md5.clone();
    let locals: Vec<_> = doc
      .spans
      .iter()
      .filter_map(|s| s.symbol.as_ref())
      .filter(|s| s.local())
      .cloned()
      .collect();
    let session_symbols = self.symbols(&md5).await?;
    let local_qualified: Vec<String> = locals.iter().map(Symbol::qualified).collect();
    let mut seen = HashSet::new();
    let mut items = vec![];
    for (symbol, qualified) in locals
      .iter()
      .zip(local_qualified.iter().map(String::as_str))
      .chain(
        session_symbols
          .iter_with_qualified()
          .filter(|(s, _)| s.eligible()),
      )
    {
      let full = symbol
        .demangled_name
        .as_deref()
        .filter(|name| !name.is_empty())
        .unwrap_or(qualified);
      if !(starts_with_case_insensitive(&symbol.name, &prefix_lower)
        || contains_case_insensitive(full, &prefix_lower))
        || !seen.insert(symbol.id.clone())
      {
        continue;
      }
      let display = symbol.display_name();
      let detail = self
        .local_detail(symbol)
        .and_then(|v| {
          v.get("data_type")
            .filter(|dt| !dt.is_null())
            .map(|dt| format!("{} · {}", data_type_name(dt), symbol.kind))
        })
        .unwrap_or_else(|| format!("{} · {}", symbol.kind, symbol.address));
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
      if t.to_lowercase().starts_with(&prefix_lower) && seen.insert((*t).to_owned()) {
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
    Ok(items)
  }

  /// Resolves active parameter signature help when the cursor sits inside a function call.
  pub(crate) async fn signature_help(
    &mut self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<SignatureHelp>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let doc = self.docs.get(uri).context("Unknown virtual document")?;
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
    let md5 = doc.md5.clone();
    // The function header is a declaration, not a call expression.
    if doc.entry.as_deref() == Some(symbol.address.as_str())
      && doc
        .spans
        .iter()
        .find(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
        .is_some_and(|s| s.start < doc.body_start())
    {
      // Recursive calls in the body are still eligible.
      let body_start = doc.body_start();
      if cursor < body_start {
        return Ok(None);
      }
    }
    let Ok(function) = self
      .backend
      .call(
        "function",
        "get",
        Some(&md5),
        json!({"selector": {"entry": symbol.address}}),
      )
      .await
    else {
      return Ok(None);
    };
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
      symbol.name,
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
      Some(argument.min(parameters.len() as u32 - 1))
    };
    Ok(Some(SignatureHelp {
      signatures: vec![SignatureInformation {
        label,
        documentation: None,
        parameters: Some(parameters),
        active_parameter: active,
      }],
      active_signature: Some(0),
      active_parameter: active,
    }))
  }

  /// Resolves the underlying Ghidra data-type record at `pos` for graphical or hover display.
  pub(crate) async fn type_definition(
    &mut self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Value>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let doc = self.docs.get(uri).context("Unknown virtual document")?;
    if !doc.clean() {
      return Ok(None);
    }
    let Some(span) = doc.span_at(pos) else {
      return Ok(None);
    };
    let md5 = doc.md5.clone();
    let mut reference = if span.token.kind == "type" {
      json!({"kind": "named", "name": span.token.text})
    } else if let Some(symbol) = &span.symbol {
      if let Some(dt) = self
        .local_detail(symbol)
        .and_then(|d| d.get("data_type").cloned())
        .filter(|v| !v.is_null())
      {
        dt
      } else if symbol.local() {
        let cached = self
          .functions
          .get(&(md5.clone(), symbol.address.clone()))
          .cloned();
        let function = match cached {
          Some(f) => f,
          None => {
            self
              .backend
              .call(
                "function",
                "get",
                Some(&md5),
                json!({"selector": {"entry": symbol.address}}),
              )
              .await?
          }
        };
        let local_info = self.local_detail(symbol);
        let expected_ord = local_info
          .as_ref()
          .and_then(|d| d.get("ordinal").and_then(Value::as_u64));
        let expected_storage = local_info
          .as_ref()
          .and_then(|d| d.get("storage"))
          .filter(|s| !s.is_null());
        let key = if symbol.kind == "Parameter" {
          "parameters"
        } else {
          "local_variables"
        };
        let Some(dt) = function
          .get(key)
          .and_then(Value::as_array)
          .and_then(|items| {
            expected_ord
              .and_then(|ord| {
                items
                  .iter()
                  .find(|v| v.get("ordinal").and_then(Value::as_u64) == Some(ord))
              })
              .or_else(|| {
                expected_storage.and_then(|st| {
                  items
                    .iter()
                    .find(|v| same_storage(v.get("storage"), Some(st)))
                })
              })
              .or_else(|| {
                items
                  .iter()
                  .find(|v| v.get("name").and_then(Value::as_str) == Some(&symbol.name))
              })
          })
          .and_then(|v| v.get("data_type"))
          .filter(|v| !v.is_null())
          .cloned()
        else {
          return Ok(None);
        };
        dt
      } else if symbol.kind.eq_ignore_ascii_case("function") {
        self
          .backend
          .call(
            "function",
            "get",
            Some(&md5),
            json!({"selector": {"entry": symbol.address}}),
          )
          .await?["return_type"]
          .clone()
      } else if symbol.kind.eq_ignore_ascii_case("label") {
        let Ok(global) = self
          .backend
          .call(
            "global_variable",
            "get",
            Some(&md5),
            json!({"selector": {"address": symbol.address}}),
          )
          .await
        else {
          return Ok(None);
        };
        global["data_type"].clone()
      } else {
        return Ok(None);
      }
    } else {
      return Ok(None);
    };
    loop {
      reference = match reference.get("kind").and_then(Value::as_str) {
        Some("pointer") => reference["target"].clone(),
        Some("array") => reference["element"].clone(),
        Some("untyped_pointer") => json!({"kind": "named", "name": "/pointer"}),
        _ => break,
      };
    }
    let Some(name) = reference.get("name").and_then(Value::as_str) else {
      return Ok(None);
    };
    if name.starts_with('/') {
      return Ok(
        self
          .backend
          .call(
            "data_type",
            "get",
            Some(&md5),
            json!({"selector": {"path": name}}),
          )
          .await
          .ok(),
      );
    }
    let types = list_all(
      self.backend.as_ref(),
      "data_type",
      &md5,
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
      if let Ok(builtin) = self
        .backend
        .call(
          "data_type",
          "get",
          Some(&md5),
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
      self
        .backend
        .call(
          "data_type",
          "get",
          Some(&md5),
          json!({"selector": {"path": path}}),
        )
        .await?,
    ))
  }

  /// Opens a virtual Markdown document describing the resolved data type at `pos`.
  pub(crate) async fn goto_type_definition(
    &mut self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Location>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let Some(type_data) = self.type_definition(uri, pos).await? else {
      return Ok(None);
    };
    let md5 = self
      .docs
      .get(uri)
      .context("Unknown virtual document")?
      .md5
      .clone();
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
    self.install(Document {
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
    let range = Range::new(
      Position::new(0, 0),
      Position::new(0, (2 + name.encode_utf16().count()) as u32),
    );
    Ok(Some(Location::new(type_uri, range)))
  }
}
