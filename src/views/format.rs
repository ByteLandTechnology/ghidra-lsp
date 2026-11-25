// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Shared formatting, decoding, storage, and batch response helpers for views.

use std::collections::HashMap;

use serde_json::Value;

use super::ListingBlockHeader;
use crate::address::{MemoryBlockInfo, format_type_ref, parse_address, permissions_label};
use crate::document::brief_templates;

/// Extracts a compact string from a JSON string or number scalar.
pub(super) fn value_str(value: &Value) -> String {
  match value {
    Value::String(s) => s.clone(),
    Value::Number(n) => n.to_string(),
    _ => String::new(),
  }
}

/// Returns `Some(String)` only when `value` holds a non-empty JSON string.
pub(super) fn opt_nonempty_str(value: Option<&Value>) -> Option<String> {
  value
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .map(str::to_owned)
}

/// Formats `name` with full template arguments when `show_template_arguments` is true.
pub(super) fn display_templates_str(name: &str, show_template_arguments: bool) -> String {
  if show_template_arguments {
    name.to_owned()
  } else {
    brief_templates(name)
  }
}

/// Resolves the full uncollapsed symbol name from demangled text or namespace plus name.
pub(super) fn full_symbol_name(
  name: &str,
  namespace: &str,
  demangled_name: Option<&str>,
  qualified: bool,
) -> String {
  if let Some(demangled) = demangled_name.filter(|s| !s.is_empty()) {
    return demangled.to_owned();
  }
  if qualified && !namespace.is_empty() && namespace != "Global" {
    format!("{namespace}::{name}")
  } else {
    name.to_owned()
  }
}

/// Formats a symbol name for listing display, applying template collapsing if configured.
pub(crate) fn symbol_display_name(
  name: &str,
  namespace: &str,
  demangled_name: Option<&str>,
  qualified: bool,
  show_template_arguments: bool,
) -> String {
  let full = full_symbol_name(name, namespace, demangled_name, qualified);
  display_templates_str(&full, show_template_arguments)
}

/// Formats hover tooltip text including the raw mangled symbol name when demangled.
pub(super) fn symbol_tooltip(name: &str, namespace: &str, demangled_name: Option<&str>) -> String {
  let full = full_symbol_name(name, namespace, demangled_name, true);
  if demangled_name.is_some_and(|s| !s.is_empty()) {
    format!("{full}\nMangled: {name}")
  } else {
    full
  }
}

/// Computes a lowercase canonical lookup key without zero padding for an address string.
pub(super) fn canonical_key(address: &str, default_space: &str) -> String {
  if let Some(parsed) = parse_address(address, default_space) {
    format!("{}:{:x}", parsed.space.to_ascii_lowercase(), parsed.offset)
  } else {
    address.to_ascii_lowercase()
  }
}

/// Extracts a readable type string from structured or plain JSON data-type values.
pub(crate) fn normalize_type_ref(value: &Value) -> String {
  if let Some(s) = value.as_str() {
    return s.to_owned();
  }
  let Some(obj) = value.as_object() else {
    return String::new();
  };
  match obj.get("kind").and_then(Value::as_str) {
    Some("named" | "pointer" | "untyped_pointer" | "array") => format_type_ref(value),
    _ => obj
      .get("name")
      .or_else(|| obj.get("path"))
      .map(value_str)
      .unwrap_or_default(),
  }
}

/// Strips leading Ghidra category segments from `full` while keeping pointer and array suffixes.
pub(super) fn short_type_name(full: &str) -> String {
  if full.is_empty() {
    return String::new();
  }
  let mut split = full.len();
  loop {
    let prefix = &full[..split];
    if let Some(without_star) = prefix.strip_suffix('*') {
      split = without_star.trim_end().len();
      continue;
    }
    if let Some(without_close) = prefix.strip_suffix(']')
      && let Some(open) = without_close.rfind('[')
    {
      let digits = &without_close[open + 1..];
      if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        split = open;
        continue;
      }
    }
    break;
  }
  let base = &full[..split];
  let suffix = &full[split..];
  let leaf = base.rsplit_once('/').map_or(base, |(_, r)| r);
  format!("{leaf}{suffix}")
}

/// Decodes a single base64 sextet alphabet byte.
fn base64_val(b: u8) -> Option<u8> {
  match b {
    b'A'..=b'Z' => Some(b - b'A'),
    b'a'..=b'z' => Some(b - b'a' + 26),
    b'0'..=b'9' => Some(b - b'0' + 52),
    b'+' => Some(62),
    b'/' => Some(63),
    _ => None,
  }
}

/// Decodes base64-encoded bytes while ignoring ASCII whitespace and padding.
fn decode_base64(input: &str) -> Vec<u8> {
  let mut clean: Vec<u8> = Vec::with_capacity(input.len());
  for b in input.bytes() {
    if b.is_ascii_whitespace() {
      continue;
    }
    clean.push(b);
  }
  let mut out = Vec::with_capacity((clean.len() * 3) / 4);
  for chunk in clean.chunks(4) {
    if chunk.len() < 2 {
      break;
    }
    let Some(a) = base64_val(chunk[0]) else { break };
    let Some(b) = base64_val(chunk[1]) else { break };
    out.push((a << 2) | (b >> 4));
    if chunk.len() > 2 && chunk[2] != b'=' {
      let Some(c) = base64_val(chunk[2]) else { break };
      out.push((b << 4) | (c >> 2));
      if chunk.len() > 3 && chunk[3] != b'=' {
        let Some(d) = base64_val(chunk[3]) else { break };
        out.push((c << 6) | d);
      }
    }
  }
  out
}

/// Parses hexadecimal byte pairs while ignoring ASCII whitespace.
fn parse_hex_bytes(hex_data: &str) -> Vec<u8> {
  let clean: Vec<u8> = hex_data
    .bytes()
    .filter(|b| !b.is_ascii_whitespace())
    .collect();
  let mut out = Vec::with_capacity(clean.len() / 2);
  for pair in clean.as_chunks::<2>().0 {
    if let Ok(s) = std::str::from_utf8(pair) {
      out.push(u8::from_str_radix(s, 16).unwrap_or(0));
    }
  }
  out
}

/// Decodes an MCP encoded `{encoding, data}` byte payload into raw bytes.
pub(crate) fn decode_bytes_vec(value: &Value) -> Vec<u8> {
  let Some(obj) = value.as_object() else {
    return Vec::new();
  };
  let data = obj.get("data").and_then(Value::as_str).unwrap_or("");
  if data.is_empty() {
    return Vec::new();
  }
  if obj.get("encoding").and_then(Value::as_str) == Some("base64") {
    decode_base64(data)
  } else {
    parse_hex_bytes(data)
  }
}

/// Formats an MCP encoded `{encoding, data}` byte payload as lowercase spaced hex bytes.
pub(super) fn format_byte_hex(value: &Value) -> String {
  let Some(obj) = value.as_object() else {
    return String::new();
  };
  let data = obj.get("data").and_then(Value::as_str).unwrap_or("");
  if data.is_empty() {
    return String::new();
  }
  if obj.get("encoding").and_then(Value::as_str) == Some("base64") {
    let raw = decode_base64(data);
    raw
      .iter()
      .map(|b| format!("{b:02x}"))
      .collect::<Vec<_>>()
      .join(" ")
  } else {
    let clean: String = data
      .chars()
      .filter(|c| !c.is_whitespace())
      .flat_map(char::to_lowercase)
      .collect();
    let bytes = clean.as_bytes();
    bytes
      .chunks(2)
      .filter_map(|c| std::str::from_utf8(c).ok())
      .collect::<Vec<_>>()
      .join(" ")
  }
}

/// Truncates a space-delimited hex byte string to eight bytes with an ellipsis.
pub(super) fn short_bytes(bytes_text: &str) -> String {
  if bytes_text.is_empty() {
    return String::new();
  }
  let parts: Vec<&str> = bytes_text.split(' ').filter(|p| !p.is_empty()).collect();
  if parts.len() <= 8 {
    parts.join(" ")
  } else {
    format!("{} \u{2026}", parts[..8].join(" "))
  }
}

/// Maps a Ghidra cross-reference type string into a short annotation tag.
pub(super) fn format_xref_suffix(kind: &str) -> &'static str {
  let upper = kind.to_ascii_uppercase();
  if upper.contains("CALL") {
    "(c)"
  } else if upper.contains("JUMP") || upper.contains("BRANCH") || upper.contains("FLOW") {
    "(j)"
  } else if upper.contains("READ") {
    "(R)"
  } else if upper.contains("WRITE") {
    "(W)"
  } else {
    "(*)"
  }
}

/// Normalizes a variable storage value into `(display, raw)` strings.
pub(super) fn format_storage(value: &Value) -> (String, String) {
  let raw = if let Some(s) = value.as_str() {
    s.to_owned()
  } else if let Some(obj) = value.as_object() {
    obj
      .get("serialization")
      .or_else(|| obj.get("register"))
      .or_else(|| obj.get("storage"))
      .map(value_str)
      .unwrap_or_default()
  } else {
    String::new()
  };
  if raw.is_empty() {
    return (String::new(), String::new());
  }
  if raw
    .get(..9)
    .is_some_and(|p| p.eq_ignore_ascii_case("register:"))
    && let Some((hex_part, size_part)) = raw[9..].split_once(':')
    && !hex_part.is_empty()
    && hex_part.bytes().all(|b| b.is_ascii_hexdigit())
    && !size_part.is_empty()
    && size_part.bytes().all(|b| b.is_ascii_digit())
  {
    let stripped = hex_part.trim_start_matches('0');
    let hex_norm = if stripped.is_empty() {
      "0".to_owned()
    } else {
      stripped.to_ascii_lowercase()
    };
    return (format!("reg:0x{hex_norm}:{size_part}"), raw);
  }
  (raw.clone(), raw)
}

/// Strips a trailing `[0xSTART-0xEND]` address range from a Ghidra block comment.
fn clean_block_comment(raw: &str) -> Option<String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return None;
  }
  let cleaned = if trimmed.ends_with(']')
    && let Some(open) = trimmed.rfind('[')
  {
    let inside = trimmed[open + 1..trimmed.len() - 1].trim();
    let is_range = inside.split_once('-').is_some_and(|(left, right)| {
      let is_hex = |part: &str| {
        part
          .trim()
          .strip_prefix("0x")
          .or_else(|| part.trim().strip_prefix("0X"))
          .is_some_and(|h| !h.is_empty() && h.bytes().all(|b| b.is_ascii_hexdigit()))
      };
      is_hex(left) && is_hex(right)
    });
    if is_range {
      trimmed[..open].trim()
    } else {
      trimmed
    }
  } else {
    trimmed
  };
  (!cleaned.is_empty()).then(|| cleaned.to_owned())
}

/// Converts a [`MemoryBlockInfo`] record into a banner header for listing output.
pub(super) fn make_block_header(block: &MemoryBlockInfo) -> ListingBlockHeader {
  let kind = (!block.kind.is_empty() && !block.kind.eq_ignore_ascii_case("default"))
    .then(|| block.kind.clone());
  ListingBlockHeader {
    name: block.name.clone(),
    start: block.start.clone(),
    end: block.end.clone(),
    permissions: permissions_label(block),
    initialized: block.initialized,
    kind,
    comment: clean_block_comment(&block.comment),
  }
}

/// Indexes non-null batch item results by item identifier.
pub(super) fn extract_batch_items(batch_res: &Value) -> HashMap<String, Value> {
  let mut map = HashMap::new();
  let Some(items) = batch_res.get("items").and_then(Value::as_array) else {
    return map;
  };
  for item in items {
    let Some(id) = item.get("id").and_then(Value::as_str) else {
      continue;
    };
    if let Some(result) = item.get("result").filter(|v| !v.is_null()) {
      map.insert(id.to_owned(), result.clone());
    }
  }
  map
}
