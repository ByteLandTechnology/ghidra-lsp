// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Basic-block control-flow graph queries through `ghidra_graph basic_blocks`.

use anyhow::{Result, bail};
use serde_json::{Map, Value, json};

use super::format_function_label;
use crate::address::display_address;
use crate::backend::McpBackend;

/// Instruction scan timeout in milliseconds passed to `ghidra_graph basic_blocks`.
const CFG_SCAN_TIMEOUT_MS: u64 = 60_000;

/// Builds an empty CFG JSON response when a function has no body or instructions.
fn empty_control_flow(
  md5: &str,
  entry: &str,
  name: &str,
  empty_reason: &str,
  scope: &str,
) -> Value {
  json!({
    "md5": md5,
    "entry": entry,
    "name": name,
    "displayAddress": display_address(entry),
    "hasBody": false,
    "emptyReason": empty_reason,
    "scope": scope,
    "unresolvedJumps": 0,
    "blocks": [],
    "nodes": [],
    "edges": [],
  })
}

/// Converts one daemon basic-block object into compact block metadata and a UI graph node.
fn convert_block(block: &Value, block_idx: usize, entry: &str) -> (Value, Value) {
  let block_id = block
    .get("id")
    .and_then(Value::as_str)
    .map(str::to_owned)
    .unwrap_or_else(|| format!("block:{block_idx}"));
  let first_addr = block.get("address").and_then(Value::as_str).unwrap_or("");
  let raw_instrs = block
    .get("instructions")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let instrs: Vec<Value> = raw_instrs
    .iter()
    .map(|instr| {
      let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
      let len = instr.get("length").and_then(Value::as_u64).unwrap_or(1);
      json!({ "address": addr, "length": len })
    })
    .collect();
  let lines = block
    .get("lines")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let count = instrs.len();
  let subtitle = format!("{count} instruction{}", if count == 1 { "" } else { "s" });
  let compact = json!({
    "address": first_addr,
    "instructions": instrs,
  });
  let node = json!({
    "id": block_id,
    "title": display_address(first_addr),
    "subtitle": subtitle,
    "address": first_addr,
    "entry": entry,
    "kind": "block",
    "lines": lines,
  });
  (compact, node)
}

/// Queries `ghidra_graph basic_blocks` and formats basic-block nodes and control-flow edges.
pub(crate) async fn control_flow_graph(
  backend: &McpBackend,
  md5: &str,
  entry_opt: Option<&str>,
  address_opt: Option<&str>,
  show_template_arguments: bool,
) -> Result<Value> {
  let mut params = Map::new();
  if let Some(entry) = entry_opt.map(str::trim).filter(|s| !s.is_empty()) {
    params.insert("entry".to_owned(), json!(entry));
  } else if let Some(address) = address_opt.map(str::trim).filter(|s| !s.is_empty()) {
    params.insert("address".to_owned(), json!(address));
  } else {
    bail!("Function entry or address is required.");
  }
  params.insert("timeout_ms".to_owned(), json!(CFG_SCAN_TIMEOUT_MS));

  let raw = backend
    .call("graph", "basic_blocks", Some(md5), Value::Object(params))
    .await?;

  let entry = raw.get("entry").and_then(Value::as_str).unwrap_or("");
  let fn_val = raw.get("function").unwrap_or(&Value::Null);
  let name = format_function_label(fn_val, entry, show_template_arguments);

  if raw.get("has_body").and_then(Value::as_bool) != Some(true) {
    let empty_reason = raw
      .get("empty_reason")
      .and_then(Value::as_str)
      .unwrap_or("This function has no instruction body.");
    let scope = raw
      .get("scope")
      .and_then(Value::as_str)
      .unwrap_or("External functions do not have a local control-flow graph.");
    return Ok(empty_control_flow(md5, entry, &name, empty_reason, scope));
  }

  let raw_blocks = raw
    .get("blocks")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let mut blocks = Vec::with_capacity(raw_blocks.len());
  let mut nodes = Vec::with_capacity(raw_blocks.len());
  for (idx, block) in raw_blocks.iter().enumerate() {
    let (compact, node) = convert_block(block, idx, entry);
    blocks.push(compact);
    nodes.push(node);
  }

  if let Some(externals) = raw.get("external_targets").and_then(Value::as_array) {
    for ext in externals {
      let to_addr = ext.get("address").and_then(Value::as_str).unwrap_or("");
      let ext_id = ext
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("external:{to_addr}"));
      nodes.push(json!({
        "id": ext_id,
        "title": display_address(to_addr),
        "subtitle": "Outside body range",
        "address": to_addr,
        "column": 2,
      }));
    }
  }

  let edges = raw
    .get("edges")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let unresolved = raw
    .get("unresolved_jumps")
    .and_then(Value::as_u64)
    .unwrap_or(0);
  let scope = raw
    .get("scope")
    .and_then(Value::as_str)
    .unwrap_or("")
    .to_owned();

  Ok(json!({
    "md5": md5,
    "entry": entry,
    "name": name,
    "displayAddress": display_address(entry),
    "hasBody": true,
    "emptyReason": Value::Null,
    "scope": scope,
    "unresolvedJumps": unresolved,
    "blocks": blocks,
    "nodes": nodes,
    "edges": edges,
  }))
}
