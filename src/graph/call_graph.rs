// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Bounded caller and callee neighborhood queries through `ghidra_graph callgraph`.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::{canonical_call_id, format_function_label};
use crate::backend::McpBackend;
use crate::views::ViewCache;

/// Maximum number of function nodes requested in a call-graph response.
const CALL_GRAPH_NODE_LIMIT: usize = 80;
/// Maximum number of directed call edges requested in a call-graph response.
const CALL_GRAPH_EDGE_LIMIT: usize = 240;

/// Optional expanded-branch sets for interactive call-graph exploration.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct CallExpansion {
  /// Entry addresses whose caller edges are expanded.
  pub(crate) callers: Vec<String>,
  /// Entry addresses whose callee edges are expanded.
  pub(crate) callees: Vec<String>,
}

/// Parameters for a bounded call-graph query.
pub(crate) struct CallGraphRequest<'a> {
  /// Program MD5 hash string.
  pub(crate) md5: &'a str,
  /// Optional explicit function entry address.
  pub(crate) entry: Option<&'a str>,
  /// Optional address resolved to its function when `entry` is absent.
  pub(crate) address: Option<&'a str>,
  /// Maximum caller traversal depth when `expansion` is `None`.
  pub(crate) callers_depth: usize,
  /// Maximum callee traversal depth when `expansion` is `None`.
  pub(crate) callees_depth: usize,
  /// Optional explicit sets of expanded callers and callees.
  pub(crate) expansion: Option<CallExpansion>,
  /// Whether C++ template arguments remain visible in symbol names.
  pub(crate) show_template_arguments: bool,
}

/// Builds the `ghidra_graph callgraph` parameter object and deterministic cache key.
fn build_graph_params(req: &CallGraphRequest<'_>) -> Result<(Value, String)> {
  let mut params = Map::new();
  if let Some(entry) = req.entry.map(str::trim).filter(|s| !s.is_empty()) {
    params.insert("entry".to_owned(), json!(entry));
  } else if let Some(address) = req.address.map(str::trim).filter(|s| !s.is_empty()) {
    params.insert("address".to_owned(), json!(address));
  } else {
    bail!("Function entry or address is required.");
  }
  params.insert("max_nodes".to_owned(), json!(CALL_GRAPH_NODE_LIMIT));
  params.insert("max_edges".to_owned(), json!(CALL_GRAPH_EDGE_LIMIT));

  if let Some(ref exp) = req.expansion {
    let mut inbound: Vec<String> = exp.callers.iter().map(|e| canonical_call_id(e)).collect();
    let mut outbound: Vec<String> = exp.callees.iter().map(|e| canonical_call_id(e)).collect();
    inbound.sort();
    inbound.dedup();
    outbound.sort();
    outbound.dedup();
    params.insert(
      "expansion".to_owned(),
      json!({ "callers": inbound, "callees": outbound }),
    );
  } else {
    let inbound_depth = req.callers_depth.clamp(1, 3);
    let outbound_depth = req.callees_depth.clamp(1, 3);
    params.insert("callers_depth".to_owned(), json!(inbound_depth));
    params.insert("callees_depth".to_owned(), json!(outbound_depth));
  }

  let value = Value::Object(params);
  let key = serde_json::to_string(&value)?;
  Ok((value, key))
}

/// Formats one daemon graph node into the camelCase LSP call-graph node payload.
fn format_node(node: &Value, show_template_arguments: bool) -> Value {
  let entry = node.get("entry").and_then(Value::as_str).unwrap_or("");
  let id = node
    .get("id")
    .and_then(Value::as_str)
    .map(str::to_owned)
    .unwrap_or_else(|| canonical_call_id(entry));
  let name = format_function_label(node, entry, show_template_arguments);
  let mut out = Map::new();
  out.insert("id".to_owned(), json!(id));
  out.insert("entry".to_owned(), json!(entry));
  out.insert("name".to_owned(), json!(name));
  if let Some(dist) = node.get("caller_distance").filter(|v| !v.is_null()) {
    out.insert("callerDistance".to_owned(), dist.clone());
  }
  if let Some(dist) = node.get("callee_distance").filter(|v| !v.is_null()) {
    out.insert("calleeDistance".to_owned(), dist.clone());
  }
  if let Some(branches) = node.get("branches").filter(|v| !v.is_null()) {
    out.insert("branches".to_owned(), branches.clone());
  }
  Value::Object(out)
}

/// Queries `ghidra_graph callgraph` with optional view-cache reuse and formats display names.
pub(crate) async fn call_graph_with_cache(
  backend: &McpBackend,
  cache: Option<&ViewCache>,
  req: CallGraphRequest<'_>,
) -> Result<Value> {
  let (params, cache_key) = build_graph_params(&req)?;
  let raw = if let Some(c) = cache
    && let Some(cached) = c.get_cached_call_graph(req.md5, &cache_key).await
  {
    cached
  } else {
    let fetched = backend
      .call("graph", "callgraph", Some(req.md5), params)
      .await?;
    if let Some(c) = cache {
      c.insert_cached_call_graph(req.md5, cache_key, fetched.clone())
        .await;
    }
    fetched
  };

  let root_entry = raw.get("entry").and_then(Value::as_str).unwrap_or("");
  let root_id = raw
    .get("root")
    .and_then(Value::as_str)
    .map(str::to_owned)
    .unwrap_or_else(|| canonical_call_id(root_entry));
  let root_fn = raw.get("function").unwrap_or(&Value::Null);
  let root_name = format_function_label(root_fn, root_entry, req.show_template_arguments);

  let nodes: Vec<Value> = raw
    .get("nodes")
    .and_then(Value::as_array)
    .map(|items| {
      items
        .iter()
        .map(|node| format_node(node, req.show_template_arguments))
        .collect()
    })
    .unwrap_or_default();
  let edges = raw
    .get("edges")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let limited = raw.get("limited").and_then(Value::as_bool).unwrap_or(false);
  let warnings = raw
    .get("warnings")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();

  Ok(json!({
    "md5": req.md5,
    "root": root_id,
    "rootName": root_name,
    "nodes": nodes,
    "edges": edges,
    "limited": limited,
    "warnings": warnings,
  }))
}
