// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Canonical address parsing, structured type references, and defined string queries.

use std::cmp::Ordering;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::backend::{McpBackend, list_operation};

/// Canonical parsed address components with explicit address space and 64-bit offset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedAddress {
  /// Normalized address space name such as `ram` or `EXTERNAL`.
  pub(crate) space: String,
  /// Unsigned 64-bit byte offset within `space`.
  pub(crate) offset: u64,
  /// Minimum hexadecimal digit width preserved from the source address.
  pub(crate) width: usize,
  /// Normalized `space:offset` hexadecimal representation.
  pub(crate) canonical: String,
}

/// Metadata describing a single Ghidra program memory block.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryBlockInfo {
  /// Block name such as `.text` or `.data`.
  pub(crate) name: String,
  /// Inclusive canonical start address of the block.
  pub(crate) start: String,
  /// Inclusive canonical end address of the block.
  pub(crate) end: String,
  /// Total size of the block in bytes.
  pub(crate) length: u64,
  /// Whether read access is enabled on this block.
  pub(crate) read: bool,
  /// Whether write access is enabled on this block.
  pub(crate) write: bool,
  /// Whether execute permission is enabled on this block.
  pub(crate) execute: bool,
  /// Whether bytes in this block are initialized in the program image.
  pub(crate) initialized: bool,
  /// Whether this block is marked volatile.
  pub(crate) volatile: bool,
  /// Whether this block is an overlay memory block.
  pub(crate) overlay: bool,
  /// Backend block kind classification string.
  pub(crate) kind: String,
  /// Optional user or loader block comment.
  pub(crate) comment: String,
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
  let width = hex_part.len().max(1);
  let canonical = format_address(space, offset, width);
  Some(ParsedAddress {
    space: space.to_owned(),
    offset,
    width,
    canonical,
  })
}

/// Formats an address space and 64-bit offset into zero-padded `space:hex` form.
pub(crate) fn format_address(space: &str, offset: u64, width: usize) -> String {
  let w = width.max(1);
  format!("{space}:{offset:0w$x}")
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

/// Adds signed `delta` bytes to `raw` using checked 64-bit address arithmetic.
pub(crate) fn add_address_offset(raw: &str, delta: i128) -> Option<String> {
  let parsed = parse_address(raw, "ram")?;
  let next = (parsed.offset as i128).checked_add(delta)?;
  if next < 0 || next > u64::MAX as i128 {
    return None;
  }
  Some(format_address(&parsed.space, next as u64, parsed.width))
}

/// Orders two addresses with `ram` first and unsigned 64-bit offsets ascending.
pub(crate) fn compare_addresses(a: &str, b: &str) -> Ordering {
  match (parse_address(a, "ram"), parse_address(b, "ram")) {
    (None, None) => a.cmp(b),
    (None, Some(_)) => Ordering::Greater,
    (Some(_), None) => Ordering::Less,
    (Some(left), Some(right)) => {
      if left.space != right.space {
        if left.space == "ram" {
          Ordering::Less
        } else if right.space == "ram" {
          Ordering::Greater
        } else {
          left.space.cmp(&right.space)
        }
      } else {
        left.offset.cmp(&right.offset)
      }
    }
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

/// Checks whether `address` falls inside inclusive bounds `[start, end]` in the same space.
pub(crate) fn address_in_range(address: &str, start: &str, end: &str) -> bool {
  match (
    parse_address(address, "ram"),
    parse_address(start, "ram"),
    parse_address(end, "ram"),
  ) {
    (Some(target), Some(lo), Some(hi)) => {
      target.space.eq_ignore_ascii_case(&lo.space)
        && target.space.eq_ignore_ascii_case(&hi.space)
        && target.offset >= lo.offset
        && target.offset <= hi.offset
    }
    _ => false,
  }
}

/// Aligns `address` down to a multiple of `bytes_per_row`.
pub(crate) fn align_row_address(address: &str, bytes_per_row: u64) -> String {
  let Some(parsed) = parse_address(address, "ram") else {
    return address.to_owned();
  };
  if bytes_per_row <= 1 {
    return parsed.canonical;
  }
  let aligned = parsed.offset - (parsed.offset % bytes_per_row);
  format_address(&parsed.space, aligned, parsed.width)
}

/// Clamps `candidate` to inclusive `[min, max]` when all three share the same space.
pub(crate) fn clamp_address(candidate: &str, min: &str, max: &str) -> String {
  let (Some(c), Some(lo), Some(hi)) = (
    parse_address(candidate, "ram"),
    parse_address(min, "ram"),
    parse_address(max, "ram"),
  ) else {
    return candidate.to_owned();
  };
  if !c.space.eq_ignore_ascii_case(&lo.space) || !c.space.eq_ignore_ascii_case(&hi.space) {
    return candidate.to_owned();
  }
  if c.offset < lo.offset {
    format_address(&lo.space, lo.offset, c.width.max(lo.width))
  } else if c.offset > hi.offset {
    format_address(&hi.space, hi.offset, c.width.max(hi.width))
  } else {
    format_address(&c.space, c.offset, c.width.max(lo.width))
  }
}

/// Extracts or derives a memory block byte length from JSON or `[start, end]` addresses.
fn as_u64_length(value: Option<&Value>, start: &str, end: &str) -> u64 {
  if let Some(val) = value {
    if let Some(n) = val.as_u64() {
      return n;
    }
    if let Some(s) = val.as_str()
      && let Ok(n) = s.trim().parse::<u64>()
    {
      return n;
    }
  }
  if let (Some(lo), Some(hi)) = (parse_address(start, "ram"), parse_address(end, "ram"))
    && hi.offset >= lo.offset
  {
    return (hi.offset - lo.offset).saturating_add(1);
  }
  0
}

/// Parses and sorts backend `memory_block.list` records by start address.
pub(crate) fn parse_memory_blocks(raw: &[Value]) -> Vec<MemoryBlockInfo> {
  let mut blocks = Vec::new();
  for item in raw {
    let start = item
      .get("start")
      .and_then(Value::as_str)
      .unwrap_or("")
      .to_owned();
    let end = item
      .get("end")
      .and_then(Value::as_str)
      .unwrap_or("")
      .to_owned();
    if start.is_empty() || end.is_empty() {
      continue;
    }
    let name = item
      .get("name")
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty())
      .unwrap_or("block")
      .to_owned();
    let length = as_u64_length(item.get("length"), &start, &end);
    blocks.push(MemoryBlockInfo {
      name,
      start,
      end,
      length,
      read: item.get("read").and_then(Value::as_bool) == Some(true),
      write: item.get("write").and_then(Value::as_bool) == Some(true),
      execute: item.get("execute").and_then(Value::as_bool) == Some(true),
      initialized: item.get("initialized").and_then(Value::as_bool) != Some(false),
      volatile: item.get("volatile").and_then(Value::as_bool) == Some(true),
      overlay: item.get("overlay").and_then(Value::as_bool) == Some(true),
      kind: item
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned(),
      comment: item
        .get("comment")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned(),
    });
  }
  blocks.sort_by(|a, b| compare_addresses(&a.start, &b.start));
  blocks
}

/// Finds the memory block containing `address`, preferring non-overlay readable blocks.
pub(crate) fn find_memory_block<'a>(
  blocks: &'a [MemoryBlockInfo],
  address: &str,
) -> Option<&'a MemoryBlockInfo> {
  let mut fallback: Option<&'a MemoryBlockInfo> = None;
  for block in blocks {
    if !address_in_range(address, &block.start, &block.end) {
      continue;
    }
    if !block.overlay && block.read {
      return Some(block);
    }
    if fallback.is_none() {
      fallback = Some(block);
    }
  }
  fallback
}

/// Finds the adjacent memory block before (`direction < 0`) or after `address`.
pub(crate) fn adjacent_memory_block<'a>(
  blocks: &'a [MemoryBlockInfo],
  address: &str,
  direction: i32,
) -> Option<&'a MemoryBlockInfo> {
  if blocks.is_empty() || direction == 0 {
    return None;
  }
  if let Some(current) = find_memory_block(blocks, address) {
    let index = blocks.iter().position(|b| std::ptr::eq(b, current))?;
    return if direction > 0 {
      blocks.get(index + 1)
    } else {
      index.checked_sub(1).and_then(|prev| blocks.get(prev))
    };
  }
  if direction > 0 {
    blocks
      .iter()
      .find(|block| compare_addresses(&block.start, address) == Ordering::Greater)
  } else {
    blocks
      .iter()
      .rev()
      .find(|block| compare_addresses(&block.end, address) == Ordering::Less)
  }
}

/// Formats `block` permissions as a three-character triplet with Unicode minus signs.
pub(crate) fn permissions_label(block: &MemoryBlockInfo) -> String {
  format!(
    "{}{}{}",
    if block.read { 'R' } else { '\u{2212}' },
    if block.write { 'W' } else { '\u{2212}' },
    if block.execute { 'X' } else { '\u{2212}' }
  )
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
  let units = list_operation(backend, "listing", "data_unit.list", md5, params).await?;
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
