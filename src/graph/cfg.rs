// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Single-RPC basic-block control-flow graph query and webview node formatter.

use anyhow::{Result, bail};
use serde_json::{Value, json};

use super::format_function_label;
use crate::address::display_address;
use crate::backend::McpBackend;

/// Maximum instruction count requested per control-flow graph call.
const MAX_CFG_INSTRUCTIONS: usize = 10_000;
/// Bounded scan timeout in milliseconds for control-flow graph queries.
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

/// Formats one composite `control_flow_graph.get` node into the webview node schema.
fn format_cfg_node(raw_node: &Value, default_entry: &str) -> Value {
  let id = raw_node.get("id").and_then(Value::as_str).unwrap_or("");
  let kind = raw_node.get("kind").and_then(Value::as_str).unwrap_or("");
  let addr = raw_node
    .get("address")
    .and_then(Value::as_str)
    .unwrap_or("");
  if kind == "external" {
    return json!({
      "id": id,
      "title": display_address(addr),
      "subtitle": "Outside body range",
      "address": addr,
      "column": 2,
    });
  }
  let node_entry = raw_node
    .get("entry")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .unwrap_or(default_entry);
  let lines = raw_node
    .get("lines")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let count = lines.len();
  json!({
    "id": id,
    "title": display_address(addr),
    "subtitle": format!("{count} instruction{}", if count == 1 { "" } else { "s" }),
    "address": addr,
    "entry": node_entry,
    "kind": "block",
    "lines": lines,
  })
}

/// Builds basic-block nodes and control-flow edges for a function entry or address.
pub(crate) async fn control_flow_graph(
  backend: &McpBackend,
  md5: &str,
  entry_opt: Option<&str>,
  address_opt: Option<&str>,
  show_template_arguments: bool,
) -> Result<Value> {
  let trimmed_entry = entry_opt.map(str::trim).filter(|s| !s.is_empty());
  let trimmed_address = address_opt.map(str::trim).filter(|s| !s.is_empty());
  let selector = if let Some(entry) = trimmed_entry {
    json!({ "entry": entry })
  } else if let Some(address) = trimmed_address {
    json!({ "address": address })
  } else {
    bail!("Function entry or address is required.");
  };

  let cfg_val = match backend
    .call(
      "function",
      "control_flow_graph.get",
      Some(md5),
      json!({
        "selector": selector,
        "max_instructions": MAX_CFG_INSTRUCTIONS,
        "scan": { "timeout_ms": CFG_SCAN_TIMEOUT_MS },
      }),
    )
    .await
  {
    Ok(val) => val,
    Err(err) => {
      if trimmed_entry.is_none()
        && let Some(address) = trimmed_address
        && err.to_string().contains("no function contains address")
      {
        bail!("No function contains {address}. Use Listing or bytes to inspect this address.");
      }
      return Err(err);
    }
  };

  let entry = cfg_val
    .get("entry")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .or(trimmed_entry)
    .unwrap_or("")
    .to_owned();
  let name = format_function_label(&cfg_val, &entry, show_template_arguments);

  let has_body = cfg_val
    .get("has_body")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  if !has_body {
    let has_bounds = cfg_val.get("body").is_some_and(Value::is_object);
    let (empty_reason, scope) = if has_bounds {
      (
        "No instructions in this body.",
        "Ghidra reported no instruction flow.",
      )
    } else {
      (
        "This function has no instruction body.",
        "External functions do not have a local control-flow graph.",
      )
    };
    return Ok(empty_control_flow(md5, &entry, &name, empty_reason, scope));
  }

  let unresolved = cfg_val
    .get("unresolved_jumps")
    .and_then(Value::as_u64)
    .unwrap_or(0);
  let scan_incomplete = cfg_val.pointer("/scan/complete").and_then(Value::as_bool) == Some(false);
  let scope = match (unresolved > 0, scan_incomplete) {
    (true, true) => format!("{unresolved} unresolved jumps; truncated scan"),
    (true, false) => format!("{unresolved} unresolved jumps"),
    (false, true) => "Truncated function scan".to_owned(),
    (false, false) => String::new(),
  };

  let blocks = cfg_val
    .get("blocks")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let nodes: Vec<Value> = cfg_val
    .get("nodes")
    .and_then(Value::as_array)
    .map(|items| items.iter().map(|n| format_cfg_node(n, &entry)).collect())
    .unwrap_or_default();
  let edges = cfg_val
    .get("edges")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();

  Ok(json!({
    "md5": md5,
    "entry": entry,
    "name": name,
    "displayAddress": display_address(&entry),
    "hasBody": true,
    "emptyReason": Value::Null,
    "scope": scope,
    "unresolvedJumps": unresolved,
    "blocks": blocks,
    "nodes": nodes,
    "edges": edges,
  }))
}
