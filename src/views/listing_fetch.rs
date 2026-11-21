// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Bounded MCP batch pipeline for fetching and assembling listing windows.

use std::cmp::Ordering;
use std::collections::HashMap;

use anyhow::Result;
use serde_json::{Value, json};

use super::format::{decode_bytes_vec, extract_batch_items, opt_nonempty_str, value_str};
use super::listing_build::{ListingBuildInput, build_listing_window};
use super::meta::get_or_load_meta;
use super::{COLLAPSE_THRESHOLD, DEFAULT_LISTING_LIMIT, ProgramMetaCache};
use crate::address::{add_address_offset, compare_addresses, find_memory_block};
use crate::backend::McpBackend;

/// Parameters controlling a bounded listing window fetch.
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

  let unit_res = backend
    .call(
      "listing",
      "code_unit.list",
      Some(&meta.md5),
      json!({
        "filter": { "kind": "all" },
        "page": page,
        "scan": scan,
      }),
    )
    .await?;

  let mut units = unit_res
    .get("items")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let next_cursor =
    opt_nonempty_str(unit_res.get("next_cursor")).map(|raw| format!("v1|{scan_start}|{raw}"));

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
    units.sort_by(|a, b| compare_addresses(&value_str(&a["address"]), &value_str(&b["address"])));
    let first_addr = value_str(&units[0]["address"]);
    let last_unit = &units[units.len() - 1];
    let last_bytes_len = decode_bytes_vec(&last_unit["bytes"]).len();
    let last_len = last_unit
      .get("length")
      .and_then(Value::as_u64)
      .map(|n| n as usize)
      .filter(|&n| n > 0)
      .or_else(|| (last_bytes_len > 0).then_some(last_bytes_len))
      .unwrap_or(1);
    let last_unit_addr = value_str(&last_unit["address"]);
    let last_addr =
      add_address_offset(&last_unit_addr, (last_len - 1) as i128).unwrap_or(last_unit_addr);

    let range = json!({ "start": first_addr, "end": last_addr });
    let overlay_res = backend
      .call(
        "batch",
        "execute",
        Some(&meta.md5),
        json!({
          "transaction_mode": "per_item",
          "items": [
            {
              "id": "symbols",
              "method": "symbol.list",
              "arguments": { "page": { "limit": 500 }, "scan": { "range": range, "timeout_ms": 15000 } }
            },
            {
              "id": "functions",
              "method": "function.list",
              "arguments": { "page": { "limit": 200 }, "scan": { "range": range, "timeout_ms": 15000 } }
            },
            {
              "id": "comments",
              "method": "comment.list",
              "arguments": { "page": { "limit": 500 }, "scan": { "range": range, "timeout_ms": 15000 } }
            },
            {
              "id": "inRefs",
              "method": "reference.list",
              "arguments": {
                "filter": { "direction": "to" },
                "page": { "limit": 1000 },
                "scan": { "range": range, "timeout_ms": 15000 }
              }
            },
            {
              "id": "outRefs",
              "method": "reference.list",
              "arguments": {
                "filter": { "direction": "from" },
                "page": { "limit": 1000 },
                "scan": { "range": range, "timeout_ms": 15000 }
              }
            }
          ]
        }),
      )
      .await?;

    let overlay = extract_batch_items(&overlay_res);
    let extract_array = |id: &str| -> Vec<Value> {
      overlay
        .get(id)
        .and_then(|v| v.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    };
    let symbols = extract_array("symbols");
    let functions = extract_array("functions");
    let comments = extract_array("comments");
    let in_refs = extract_array("inRefs");
    let out_refs = extract_array("outRefs");

    let mut incoming_refs: HashMap<String, Vec<Value>> = HashMap::new();
    for item in in_refs {
      let to = value_str(&item["to"]);
      if !to.is_empty() {
        incoming_refs.entry(to).or_default().push(item);
      }
    }

    let mut outgoing_refs: HashMap<String, Vec<Value>> = HashMap::new();
    for item in out_refs {
      let from = value_str(&item["from"]);
      if !from.is_empty() {
        outgoing_refs.entry(from).or_default().push(item);
      }
    }

    build_listing_window(ListingBuildInput {
      units,
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
