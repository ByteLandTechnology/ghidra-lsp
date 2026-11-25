// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Read-only `type`, `symbol`, and `references` snapshot builders for `ghidra://` documents.

use std::sync::Arc;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use super::Engine;
use crate::backend::{McpBackend, list_all};
use crate::document::{Symbol, SymbolIndex, data_type_name};
use crate::views::{decode_bytes_vec, normalize_type_ref};

/// Default byte window read when a symbol has no explicit defined data length.
const DEFAULT_SYMBOL_BYTES: u64 = 32;
/// Maximum byte window read for a symbol snapshot hex preview.
const MAX_SYMBOL_BYTES: u64 = 256;
/// Maximum incoming cross-references listed directly in a symbol snapshot.
const MAX_SNAPSHOT_REFS: usize = 64;

impl Engine {
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

    let symbol = self.resolve_snapshot_symbol(md5, id).await?;
    if kind == "symbol" {
      let cached_symbols = self.symbols.get(md5).map(Arc::as_ref);
      return Ok(render_symbol_snapshot(self.backend.as_ref(), md5, &symbol, cached_symbols).await);
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

  /// Resolves `id` as a symbol identifier first and as an in-memory address second.
  async fn resolve_snapshot_symbol(&self, md5: &str, id: &str) -> Result<Symbol> {
    let direct_err = match self
      .backend
      .call("symbol", "get", Some(md5), json!({"selector": {"id": id}}))
      .await
    {
      Ok(val) => return serde_json::from_value(val).map_err(Into::into),
      Err(err) => err,
    };

    if let Some(cached) = self
      .symbols
      .get(md5)
      .and_then(|syms| syms.by_id(id).or_else(|| syms.by_address(id)))
    {
      return Ok(cached.clone());
    }

    let Ok(resolved) = self
      .backend
      .call(
        "address",
        "resolve",
        Some(md5),
        json!({"selector": {"address": id}}),
      )
      .await
    else {
      return Err(direct_err);
    };
    if resolved.get("valid").and_then(Value::as_bool) == Some(false)
      || resolved.get("in_memory").and_then(Value::as_bool) == Some(false)
    {
      bail!("{direct_err}");
    }
    let address = resolved
      .get("address")
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty())
      .unwrap_or(id)
      .to_owned();
    if let Ok(sym_page) = self
      .backend
      .call(
        "symbol",
        "list",
        Some(md5),
        json!({
          "page": {"limit": 16},
          "scan": {"range": {"start": address, "end": address}, "timeout_ms": 5000}
        }),
      )
      .await
      && let Some(found) = sym_page
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| {
          items
            .iter()
            .find_map(|item| serde_json::from_value::<Symbol>(item.clone()).ok())
        })
    {
      return Ok(found);
    }

    let plain = address
      .rsplit_once(':')
      .map_or(address.as_str(), |(_, hex)| hex);
    Ok(Symbol {
      id: address.clone(),
      name: format!("DAT_{plain}"),
      address,
      namespace: "Global".into(),
      kind: "data".into(),
      demangled_name: None,
    })
  }
}

/// Converts a scalar JSON value into a printable single-line summary string.
fn scalar_text(value: &Value) -> Option<String> {
  match value {
    Value::Null => None,
    Value::String(s) if s.is_empty() => None,
    Value::String(s) => Some(s.replace(['\r', '\n'], " ")),
    Value::Number(n) => Some(n.to_string()),
    Value::Bool(b) => Some(b.to_string()),
    _ => None,
  }
}

/// Returns `name` when it is a valid ASCII C identifier, or `None` otherwise.
fn c_identifier(name: &str) -> Option<&str> {
  let mut chars = name.chars();
  let first = chars.next()?;
  if !(first.is_ascii_alphabetic() || first == '_') {
    return None;
  }
  if chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
    Some(name)
  } else {
    None
  }
}

/// Appends formatted 16-byte hexadecimal and ASCII rows for `bytes` to `out`.
fn append_hex_rows(out: &mut String, bytes: &[u8]) {
  for (row_idx, chunk) in bytes.chunks(16).enumerate() {
    let offset = row_idx * 16;
    let mut hex_col = String::with_capacity(48);
    let mut ascii_col = String::with_capacity(16);
    for (i, &b) in chunk.iter().enumerate() {
      if i == 8 {
        hex_col.push(' ');
      }
      hex_col.push_str(&format!("{b:02x} "));
      let ch = if b.is_ascii_graphic() || b == b' ' {
        char::from(b)
      } else {
        '.'
      };
      ascii_col.push(ch);
    }
    let target_hex_width = if chunk.len() > 8 { 49 } else { 48 };
    while hex_col.len() < target_hex_width {
      hex_col.push(' ');
    }
    out.push_str(&format!("//   +0x{offset:04x}: {hex_col}|{ascii_col}|\n"));
  }
}

/// Queries `global_variable.get`, `memory.read`, and `reference.list` to render a symbol snapshot.
async fn render_symbol_snapshot(
  backend: &McpBackend,
  md5: &str,
  symbol: &Symbol,
  cached_symbols: Option<&SymbolIndex>,
) -> String {
  let (global_res, refs_res) = tokio::join!(
    backend.call(
      "global_variable",
      "get",
      Some(md5),
      json!({"selector": {"address": symbol.address}}),
    ),
    backend.call(
      "reference",
      "list",
      Some(md5),
      json!({"filter": {"direction": "to", "to": symbol.address}, "page": {"limit": 200}}),
    ),
  );

  let global = global_res.ok();
  let data_type = global
    .as_ref()
    .and_then(|g| g.get("data_type"))
    .map(|dt| {
      let normalized = normalize_type_ref(dt);
      if normalized.is_empty() {
        data_type_name(dt)
      } else {
        normalized
      }
    })
    .filter(|s| !s.is_empty() && s != "unknown");
  let defined_length = global
    .as_ref()
    .and_then(|g| g.get("length"))
    .and_then(Value::as_u64);
  let value_str = global
    .as_ref()
    .and_then(|g| g.get("value"))
    .and_then(scalar_text);
  let repr_str = global
    .as_ref()
    .and_then(|g| g.get("representation"))
    .and_then(scalar_text);

  let read_len = defined_length
    .unwrap_or(DEFAULT_SYMBOL_BYTES)
    .clamp(1, MAX_SYMBOL_BYTES);
  let mem_bytes = backend
    .call(
      "memory",
      "read",
      Some(md5),
      json!({
        "selector": {"address": symbol.address},
        "length": read_len,
        "encoding": "hex",
      }),
    )
    .await
    .ok()
    .map(|res| decode_bytes_vec(&res["bytes"]))
    .unwrap_or_default();

  let display_name = symbol.display_name();
  let mut out = format!("// {display_name}\n");
  if symbol
    .demangled_name
    .as_deref()
    .is_some_and(|d| !d.is_empty() && d != symbol.name)
  {
    out.push_str(&format!("// Mangled: {}\n", symbol.name));
  }
  if !symbol.namespace.is_empty() && symbol.namespace != "Global" {
    out.push_str(&format!("// Namespace: {}\n", symbol.namespace));
  }
  out.push_str(&format!("// Address: {}\n", symbol.address));
  out.push_str(&format!("// Kind: {}\n", symbol.kind));

  if let Some(dtype) = &data_type {
    out.push_str(&format!("// Data type: {dtype}\n"));
  }
  if let Some(len) = defined_length {
    out.push_str(&format!("// Size: {len} bytes\n"));
  }
  if let Some(val) = &value_str {
    out.push_str(&format!("// Value: {val}\n"));
  }
  if let Some(repr) = &repr_str
    && value_str.as_deref() != Some(repr.as_str())
  {
    out.push_str(&format!("// Representation: {repr}\n"));
  }

  if !mem_bytes.is_empty() {
    let partial_note = match defined_length {
      Some(total) if total > mem_bytes.len() as u64 => {
        format!(" (first {} of {total} bytes)", mem_bytes.len())
      }
      _ => format!(" ({} bytes)", mem_bytes.len()),
    };
    out.push_str(&format!("//\n// Memory bytes{partial_note}:\n"));
    append_hex_rows(&mut out, &mem_bytes);
  }

  if let Ok(ref_page) = refs_res {
    let refs = ref_page
      .get("items")
      .and_then(Value::as_array)
      .map(Vec::as_slice)
      .unwrap_or(&[]);
    let has_more = ref_page
      .get("next_cursor")
      .and_then(Value::as_str)
      .is_some_and(|c| !c.is_empty());
    if refs.is_empty() {
      out.push_str("//\n// Incoming references: none\n");
    } else {
      let count_label = if has_more {
        format!("{}+", refs.len())
      } else {
        refs.len().to_string()
      };
      out.push_str(&format!("//\n// Incoming references ({count_label}):\n"));
      for reference in refs.iter().take(MAX_SNAPSHOT_REFS) {
        let from = reference
          .get("from")
          .and_then(Value::as_str)
          .unwrap_or("unknown");
        let kind = reference
          .get("type")
          .and_then(Value::as_str)
          .unwrap_or("reference");
        let caller = reference
          .pointer("/from_function/name")
          .and_then(Value::as_str)
          .filter(|s| !s.is_empty())
          .or_else(|| {
            let entry = reference
              .pointer("/from_function/entry")
              .and_then(Value::as_str)?;
            cached_symbols?.function_at(entry).map(|s| s.name.as_str())
          });
        if let Some(fn_name) = caller {
          out.push_str(&format!("//   {from} in {fn_name} ({kind})\n"));
        } else {
          out.push_str(&format!("//   {from} ({kind})\n"));
        }
      }
      if refs.len() > MAX_SNAPSHOT_REFS || has_more {
        let remaining = if has_more {
          format!("{}+", refs.len().saturating_sub(MAX_SNAPSHOT_REFS))
        } else {
          (refs.len() - MAX_SNAPSHOT_REFS).to_string()
        };
        out.push_str(&format!("//   ... and {remaining} more\n"));
      }
    }
  }

  if let Some(dtype) = &data_type
    && let Some(ident) = c_identifier(&symbol.name)
  {
    let short_dtype = dtype
      .rsplit_once('/')
      .map_or(dtype.as_str(), |(_, leaf)| leaf);
    out.push_str(&format!("\nextern {short_dtype} {ident};\n"));
  }

  out
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
