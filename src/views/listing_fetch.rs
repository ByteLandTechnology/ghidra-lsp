// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Bounded single-RPC fetch and assembly for address windows.

use std::cmp::Ordering;
use std::collections::HashMap;

use anyhow::Result;
use serde_json::{Value, json};

use super::format::{opt_nonempty_str, value_str};
use super::listing_build::{ListingBuildInput, build_listing_window};
use super::meta::get_or_load_meta;
use super::{COLLAPSE_THRESHOLD, DEFAULT_LISTING_LIMIT, ProgramMetaCache};
use crate::address::{add_address_offset, compare_addresses, find_memory_block};
use crate::backend::McpBackend;

/// Parameters for one bounded address window request.
pub(crate) struct ListingWindowRequest<'a> {
  /// Lowercase 32-character session MD5 hash.
  pub(crate) md5: &'a str,
  /// Optional target address used when starting a fresh scan.
  pub(crate) address: Option<&'a str>,
  /// Optional opaque pagination cursor returned by an earlier window call.
  pub(crate) cursor: Option<&'a str>,
  /// Requested unit count (`0` uses `DEFAULT_LISTING_LIMIT`).
  pub(crate) limit: usize,
  /// Whether full C++ template argument lists appear in symbol names.
  pub(crate) show_template_arguments: bool,
  /// Whether to scan directly from `address` instead of backing up 32 bytes for context.
  pub(crate) exact_start: bool,
}

/// Groups a flat JSON array of reference records by the string value at `key_field`.
fn group_references_by_field(
  items: Option<&Value>,
  key_field: &str,
) -> HashMap<String, Vec<Value>> {
  let mut grouped: HashMap<String, Vec<Value>> = HashMap::new();
  let Some(records) = items.and_then(Value::as_array) else {
    return grouped;
  };
  for record in records {
    let key = value_str(&record[key_field]);
    if !key.is_empty() {
      grouped.entry(key).or_default().push(record.clone());
    }
  }
  grouped
}

/// Extracts a cloned JSON array field from `parent`, or returns an empty vector.
fn array_field(parent: &Value, field: &str) -> Vec<Value> {
  parent
    .get(field)
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
}

/// Fetches a bounded listing window with overlay symbols, comments, and cross-references.
pub(crate) async fn listing_window(
  backend: &McpBackend,
  cache: &ProgramMetaCache,
  req: ListingWindowRequest<'_>,
) -> Result<Value> {
  let meta = get_or_load_meta(backend, cache, req.md5).await?;
  let effective_limit = if req.limit == 0 {
    DEFAULT_LISTING_LIMIT
  } else {
    req.limit.min(1000)
  };
  let (saved_scan_start, raw_cursor) = match req.cursor.map(str::trim).filter(|s| !s.is_empty()) {
    Some(c) => match c.strip_prefix("v1|").and_then(|s| s.rsplit_once('|')) {
      Some((saved_start, raw)) if !raw.is_empty() => {
        (Some(saved_start.to_owned()), Some(raw.to_owned()))
      }
      _ => (None, Some(c.to_owned())),
    },
    None => (None, None),
  };
  let target_address = req
    .address
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(str::to_owned)
    .or_else(|| meta.default_address.clone())
    .unwrap_or_default();

  let mut scan_start = saved_scan_start.unwrap_or_else(|| target_address.clone());
  if !req.exact_start
    && raw_cursor.is_none()
    && !target_address.is_empty()
    && effective_limit >= 40
    && let Some(block) = find_memory_block(&meta.blocks, &target_address)
  {
    let back = add_address_offset(&target_address, -32);
    scan_start = match back {
      Some(b) if compare_addresses(&b, &block.start) != Ordering::Less => b,
      _ => block.start.clone(),
    };
  }

  let mut page = json!({ "limit": effective_limit });
  if let Some(cursor) = &raw_cursor {
    page["cursor"] = json!(cursor);
  }
  let mut scan = json!({ "timeout_ms": 30000 });
  if !scan_start.is_empty() {
    scan["range"] = json!({ "start": scan_start });
  }

  let window_res = backend
    .call(
      "listing",
      "window.get",
      Some(&meta.md5),
      json!({
        "filter": { "kind": "all" },
        "page": page,
        "scan": scan,
      }),
    )
    .await?;

  let units = array_field(&window_res, "items");
  let next_cursor =
    opt_nonempty_str(window_res.get("next_cursor")).map(|raw| format!("v1|{scan_start}|{raw}"));

  let mut demangled_functions = HashMap::new();
  for f in &meta.functions {
    demangled_functions.insert(
      f.entry.clone(),
      (
        f.name.clone(),
        f.namespace.clone(),
        f.demangled_name.clone(),
      ),
    );
  }

  let window = if !units.is_empty() {
    let data_units = array_field(&window_res, "data_units");
    let symbols = array_field(&window_res, "symbols");
    let functions = array_field(&window_res, "functions");
    let comments = array_field(&window_res, "comments");
    let incoming_refs = group_references_by_field(window_res.get("incoming_references"), "to");
    let outgoing_refs = group_references_by_field(window_res.get("outgoing_references"), "from");

    build_listing_window(ListingBuildInput {
      units,
      data_units,
      symbols,
      functions,
      demangled_functions,
      comments,
      incoming_refs,
      outgoing_refs,
      blocks: &meta.blocks,
      default_space: &meta.default_space,
      collapse_threshold: COLLAPSE_THRESHOLD,
      show_template_arguments: req.show_template_arguments,
    })
  } else {
    build_listing_window(ListingBuildInput {
      units: Vec::new(),
      data_units: Vec::new(),
      symbols: Vec::new(),
      functions: Vec::new(),
      demangled_functions,
      comments: Vec::new(),
      incoming_refs: HashMap::new(),
      outgoing_refs: HashMap::new(),
      blocks: &meta.blocks,
      default_space: &meta.default_space,
      collapse_threshold: COLLAPSE_THRESHOLD,
      show_template_arguments: req.show_template_arguments,
    })
  };

  let has_more_after = next_cursor.is_some()
    || window.block.as_ref().is_some_and(|b| {
      compare_addresses(&window.end_address, &b.end) == Ordering::Less
        || meta
          .blocks
          .iter()
          .position(|cand| cand.start == b.start && cand.name == b.name)
          .is_some_and(|idx| idx + 1 < meta.blocks.len())
    });

  Ok(json!({
    "md5": meta.md5,
    "programName": meta.program_name,
    "endian": meta.endian,
    "addressSizeBits": meta.address_size_bits,
    "defaultSpace": meta.default_space,
    "addressWidth": meta.address_width,
    "blocks": meta.blocks,
    "startAddress": window.start_address,
    "endAddress": window.end_address,
    "nextCursor": next_cursor,
    "hasMoreAfter": has_more_after,
    "block": window.block,
    "units": window.units,
    "collapsedItems": window.collapsed_items,
  }))
}
