// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Canonical address parsing, structured type references, and defined string queries.

use std::collections::HashSet;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use crate::backend::McpBackend;

/// Canonical parsed address components with explicit address space and 64-bit offset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedAddress {
  /// Normalized address space name such as `ram` or `EXTERNAL`.
  pub(crate) space: String,
  /// Unsigned 64-bit byte offset within `space`.
  pub(crate) offset: u64,
}

/// Returns true when `trimmed` starts with a synthetic non-memory Ghidra prefix.
fn is_non_memory_prefix(trimmed: &str) -> bool {
  let Some((prefix, _)) = trimmed.split_once(':') else {
    return false;
  };
  matches!(
    prefix.to_ascii_lowercase().as_str(),
    "stack" | "register" | "const" | "unique" | "variable" | "hash"
  )
}

/// Validates characters permitted in a Ghidra address space name.
fn is_valid_space_name(space: &str) -> bool {
  let mut bytes = space.bytes();
  let Some(first) = bytes.next() else {
    return false;
  };
  (first.is_ascii_alphabetic() || first == b'_')
    && bytes.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

/// Parses a `space:hex` or bare hexadecimal address using `default_space` and checked `u64` math.
pub(crate) fn parse_address(raw: &str, default_space: &str) -> Option<ParsedAddress> {
  let trimmed = raw.trim();
  if trimmed.is_empty()
    || is_non_memory_prefix(trimmed)
    || (trimmed.ends_with(']')
      && trimmed
        .rfind('[')
        .is_some_and(|idx| !trimmed[idx..].contains(['\n', '\r'])))
  {
    return None;
  }

  let (space, hex_part) = match trimmed.find(':') {
    Some(0) => return None,
    Some(colon) => {
      let prefix = trimmed[..colon].trim();
      if !is_valid_space_name(prefix) {
        return None;
      }
      (prefix, trimmed[colon + 1..].trim())
    }
    None => (default_space, trimmed),
  };

  let hex_part = hex_part
    .strip_prefix("0x")
    .or_else(|| hex_part.strip_prefix("0X"))
    .unwrap_or(hex_part);

  if hex_part.is_empty() || !hex_part.bytes().all(|b| b.is_ascii_hexdigit()) {
    return None;
  }

  let offset = u64::from_str_radix(hex_part, 16).ok()?;
  Some(ParsedAddress {
    space: space.to_owned(),
    offset,
  })
}

/// Formats `raw` for UI display by stripping a leading `ram:` hex prefix only.
pub(crate) fn display_address(raw: &str) -> String {
  if raw.len() > 4
    && raw[..4].eq_ignore_ascii_case("ram:")
    && raw[4..].bytes().all(|b| b.is_ascii_hexdigit())
  {
    raw[4..].to_owned()
  } else {
    raw.to_owned()
  }
}

/// Compares two address strings canonically with `"ram"` as default space, unlike [`crate::document::same_address`].
pub(crate) fn same_address(a: &str, b: &str) -> bool {
  match (parse_address(a, "ram"), parse_address(b, "ram")) {
    (Some(left), Some(right)) => {
      left.space.eq_ignore_ascii_case(&right.space) && left.offset == right.offset
    }
    _ => false,
  }
}

/// Parses C-like type notation (`int`, `/pkg/Type`, `char *`, `int[4]`, `pointer`) into bridge JSON.
pub(crate) fn parse_type_ref(raw: &str) -> Result<Value> {
  let name = raw.trim();
  if name.is_empty() {
    bail!("Choose a data type.");
  }
  if name == "pointer" {
    return Ok(json!({ "kind": "untyped_pointer" }));
  }
  if let Some(without_close) = name.strip_suffix(']')
    && let Some(open) = without_close.rfind('[')
  {
    let count_str = &without_close[open + 1..];
    if !count_str.is_empty() && count_str.bytes().all(|b| b.is_ascii_digit()) {
      let element = parse_type_ref(&without_close[..open])?;
      let count = count_str
        .parse::<i64>()
        .ok()
        .filter(|&n| (1..=2_147_483_647).contains(&n))
        .context("Array length must be an integer between 1 and 2147483647.")?;
      return Ok(json!({
        "kind": "array",
        "element": element,
        "count": count,
      }));
    }
  }
  if let Some(target_raw) = name.strip_suffix('*') {
    let target = parse_type_ref(target_raw)?;
    return Ok(json!({
      "kind": "pointer",
      "target": target,
    }));
  }
  Ok(json!({
    "kind": "named",
    "name": name,
  }))
}

/// Extracts scalar text from string or number JSON values, falling back to an em dash.
fn scalar_text(value: Option<&Value>) -> String {
  match value {
    Some(Value::String(s)) => s.clone(),
    Some(Value::Number(n)) => n.to_string(),
    _ => "\u{2014}".to_owned(),
  }
}

/// Formats structured bridge data-type reference JSON back into readable C notation.
pub(crate) fn format_type_ref(value: &Value) -> String {
  if let Some(s) = value.as_str() {
    return s.to_owned();
  }
  match value.get("kind").and_then(Value::as_str) {
    Some("named") => scalar_text(value.get("name")),
    Some("pointer") => {
      let target = value.get("target").unwrap_or(&Value::Null);
      format!("{} *", format_type_ref(target))
    }
    Some("untyped_pointer") => "pointer".to_owned(),
    Some("array") => {
      let element = value.get("element").unwrap_or(&Value::Null);
      format!(
        "{}[{}]",
        format_type_ref(element),
        scalar_text(value.get("count"))
      )
    }
    _ => scalar_text(value.get("name")),
  }
}

/// Paginates an MCP list operation (`domain`, `operation`) and enforces scan completion.
pub(crate) async fn paginate_operation(
  backend: &McpBackend,
  domain: &str,
  operation: &str,
  md5: &str,
  mut params: Value,
) -> Result<Vec<Value>> {
  let mut items = Vec::new();
  let mut seen = HashSet::new();
  loop {
    let page = backend
      .call(domain, operation, Some(md5), params.clone())
      .await?;
    items.extend(
      page
        .get("items")
        .and_then(Value::as_array)
        .context("list response lacks items")?
        .iter()
        .cloned(),
    );
    if let Some(cursor) = page
      .get("next_cursor")
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty())
    {
      ensure!(
        seen.insert(cursor.to_owned()),
        "backend repeated a pagination cursor"
      );
      params["page"] = json!({ "cursor": cursor, "limit": 1000 });
    } else {
      ensure!(
        page.pointer("/scan/complete").and_then(Value::as_bool) != Some(false),
        "backend scan is incomplete; refresh after analysis finishes"
      );
      return Ok(items);
    }
  }
}

/// Returns true when lowercase `lower` contains `utf` followed by an optional separator and digit.
fn has_utf_digit(lower: &str) -> bool {
  let bytes = lower.as_bytes();
  let mut i = 0;
  while i + 3 < bytes.len() {
    if &bytes[i..i + 3] == b"utf" {
      let next = bytes[i + 3];
      if next.is_ascii_digit() {
        return true;
      }
      if matches!(next, b'-' | b'_' | b' ') && i + 4 < bytes.len() && bytes[i + 4].is_ascii_digit()
      {
        return true;
      }
    }
    i += 1;
  }
  false
}

/// Returns true when a Ghidra data-type name denotes string data.
fn is_string_type_name(type_name: &str) -> bool {
  let lower = type_name.to_ascii_lowercase();
  lower.contains("string") || lower.contains("unicode") || has_utf_digit(&lower)
}

/// Returns true when a data-unit representation renders as a string literal.
fn is_string_representation(representation: &str) -> bool {
  representation.starts_with('"')
    || representation.starts_with("u8\"")
    || representation.starts_with("u\"")
    || representation.starts_with("U\"")
    || representation.starts_with("L\"")
}

/// Extracts scalar JSON content as a string, returning an empty string for null or composite types.
fn json_string_or_empty(value: Option<&Value>) -> String {
  match value {
    Some(Value::String(s)) => s.clone(),
    Some(Value::Number(n)) => n.to_string(),
    Some(Value::Bool(b)) => b.to_string(),
    _ => String::new(),
  }
}

/// Paginates `listing.data_unit.list` for session `md5` and extracts defined string items.
pub(crate) async fn defined_strings(backend: &McpBackend, md5: &str) -> Result<Value> {
  let params = json!({
    "page": { "limit": 1000 },
    "scan": { "timeout_ms": 60000 }
  });
  let units = paginate_operation(backend, "listing", "data_unit.list", md5, params).await?;
  let scanned = units.len();
  let mut items = Vec::new();
  for unit in &units {
    let Some(address) = unit
      .get("address")
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty())
    else {
      continue;
    };
    let type_name = unit
      .pointer("/data_type/name")
      .and_then(Value::as_str)
      .unwrap_or("");
    let representation = unit
      .get("representation")
      .and_then(Value::as_str)
      .unwrap_or("");
    if !is_string_type_name(type_name) && !is_string_representation(representation) {
      continue;
    }
    let value = json_string_or_empty(
      unit
        .get("value")
        .filter(|v| !v.is_null())
        .or_else(|| unit.get("representation").filter(|v| !v.is_null())),
    );
    let length = json_string_or_empty(unit.get("length").filter(|v| !v.is_null()));
    items.push(json!({
      "address": address,
      "displayAddress": display_address(address),
      "value": value,
      "length": length,
      "type": type_name,
    }));
  }

  Ok(json!({
    "md5": md5,
    "scanned": scanned,
    "items": items,
  }))
}
