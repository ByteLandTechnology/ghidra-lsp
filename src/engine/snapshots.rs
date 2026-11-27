// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Read-only `type`, `symbol`, and `references` snapshot builders for `ghidra://` documents.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use super::Engine;
use super::assist::format_type_markdown;
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

    let symbol = self
      .resolve_snapshot_symbol(backend.as_ref(), md5, id)
      .await?;
    if kind == "symbol" {
      let md5_key = md5.to_ascii_lowercase();
      let cached_symbols = self.read_state().symbols.get(&md5_key).cloned();
      return Ok(
        render_symbol_snapshot(backend.as_ref(), md5, &symbol, cached_symbols.as_deref()).await,
      );
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

  /// Resolves `id` as a symbol identifier first and as an in-memory address second.
  async fn resolve_snapshot_symbol(
    &self,
    backend: &McpBackend,
    md5: &str,
    id: &str,
  ) -> Result<Symbol> {
    let direct_err = match backend
      .call("symbol", "get", Some(md5), json!({"selector": {"id": id}}))
      .await
    {
      Ok(val) => return serde_json::from_value(val).map_err(Into::into),
      Err(err) => err,
    };

    let md5_key = md5.to_ascii_lowercase();
    if let Some(cached) = self
      .read_state()
      .symbols
      .get(&md5_key)
      .and_then(|syms| syms.by_id(id).or_else(|| syms.by_address(id)).cloned())
    {
      return Ok(cached);
    }

    let Ok(resolved) = backend
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
    if let Ok(sym_page) = backend
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
