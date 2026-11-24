// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Bounded caller and callee neighborhood queries through `function` `call_graph.get`, with a
//! `function` `call.list` BFS fallback.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::call_graph_fallback::fallback_call_graph;
use super::{canonical_call_id, format_function_label, resolve_entry};
use crate::backend::{McpBackend, unsupported_operation};
use crate::views::ViewCache;

/// Maximum number of function nodes requested in one call-graph query.
pub(super) const CALL_GRAPH_NODE_LIMIT: usize = 80;
/// Maximum number of directed call edges requested in one call-graph query.
pub(super) const CALL_GRAPH_EDGE_LIMIT: usize = 240;
/// Scan timeout in milliseconds kept below the 30-second MCP session lock limit.
const CALL_GRAPH_TIMEOUT_MS: u64 = 25_000;

/// Optional expanded-branch sets for interactive call-graph exploration.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct CallExpansion {
  /// Entry addresses whose caller edges should be expanded.
  pub(crate) callers: Vec<String>,
  /// Entry addresses whose callee edges should be expanded.
  pub(crate) callees: Vec<String>,
}

/// Parameters controlling a bounded call-graph query.
pub(crate) struct CallGraphRequest<'a> {
  /// Program MD5 hash string.
  pub(crate) md5: &'a str,
  /// Optional explicit function entry address.
  pub(crate) entry: Option<&'a str>,
  /// Optional address resolved to its containing function when `entry` is absent.
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

/// Interactive expansion state and neighbor count for one call-graph branch.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CallBranchState {
  /// Whether neighbors along this branch are expanded in the graph.
  pub(super) expanded: bool,
  /// Unique neighbor count reported when this branch is expanded.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) count: Option<usize>,
}

/// Caller and callee expansion states attached to one function node.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CallBranches {
  /// Inbound caller branch state, when evaluated.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) callers: Option<CallBranchState>,
  /// Outbound callee branch state, when evaluated.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) callees: Option<CallBranchState>,
}

/// Function vertex in a serialized call-graph payload.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CallNode {
  /// Canonical node identifier (`space:offset`).
  pub(super) id: String,
  /// Backend function entry address string.
  pub(super) entry: String,
  /// Formatted function display name.
  pub(super) name: String,
  /// Shortest observed caller hop distance from the root node.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) caller_distance: Option<usize>,
  /// Shortest observed callee hop distance from the root node.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) callee_distance: Option<usize>,
  /// Interactive expansion flags when expansion mode is active.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) branches: Option<CallBranches>,
}

/// Directed caller-to-callee edge with deduplicated call-site addresses.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CallEdge {
  /// Canonical identifier of the caller function node.
  pub(super) from: String,
  /// Canonical identifier of the callee function node.
  pub(super) to: String,
  /// Distinct call-site addresses connecting `from` to `to`.
  pub(super) sites: Vec<String>,
}

/// Normalizes and sorts an expanded entry list for stable cache keys.
fn canonical_expansion_list(entries: &[String]) -> Vec<String> {
  let mut normalized: Vec<String> = entries
    .iter()
    .map(|entry| entry.trim())
    .filter(|entry| !entry.is_empty())
    .map(canonical_call_id)
    .collect();
  normalized.sort();
  normalized.dedup();
  normalized
}

/// Builds a deterministic cache key for one `function.call_graph.get` request.
fn build_cache_key(
  canonical_entry: &str,
  callers_depth: usize,
  callees_depth: usize,
  expansion: Option<&(Vec<String>, Vec<String>)>,
) -> String {
  match expansion {
    Some((callers, callees)) => json!({
      "entry": canonical_entry,
      "callers": callers,
      "callees": callees,
    })
    .to_string(),
    None => json!({
      "entry": canonical_entry,
      "callersDepth": callers_depth,
      "calleesDepth": callees_depth,
    })
    .to_string(),
  }
}

/// Parses an optional `u64` JSON field into `usize`.
fn optional_usize(value: Option<&Value>) -> Option<usize> {
  value
    .and_then(Value::as_u64)
    .map(|num| usize::try_from(num).unwrap_or(usize::MAX))
}

/// Parses one branch expansion state object returned by `function.call_graph.get`.
fn parse_branch_state(raw: Option<&Value>) -> Option<CallBranchState> {
  let obj = raw?.as_object()?;
  let expanded = obj.get("expanded").and_then(Value::as_bool)?;
  let count = optional_usize(obj.get("count"));
  Some(CallBranchState { expanded, count })
}

/// Parses optional caller and callee branch states on a backend node record.
fn parse_branches(raw: Option<&Value>) -> Option<CallBranches> {
  let obj = raw?.as_object()?;
  let callers = parse_branch_state(obj.get("callers"));
  let callees = parse_branch_state(obj.get("callees"));
  if callers.is_none() && callees.is_none() {
    None
  } else {
    Some(CallBranches { callers, callees })
  }
}

/// Converts backend `nodes` JSON records into formatted [`CallNode`] values.
fn parse_nodes(raw_nodes: Option<&Vec<Value>>, show_template_arguments: bool) -> Vec<CallNode> {
  let Some(items) = raw_nodes else {
    return Vec::new();
  };
  let mut nodes = Vec::with_capacity(items.len());
  for record in items {
    let Some(entry) = record
      .get("entry")
      .and_then(Value::as_str)
      .filter(|text| !text.is_empty())
    else {
      continue;
    };
    let id = canonical_call_id(entry);
    let name = format_function_label(record, entry, show_template_arguments);
    nodes.push(CallNode {
      id,
      entry: entry.to_owned(),
      name,
      caller_distance: optional_usize(record.get("caller_distance")),
      callee_distance: optional_usize(record.get("callee_distance")),
      branches: parse_branches(record.get("branches")),
    });
  }
  nodes
}

/// Converts backend `edges` JSON records into [`CallEdge`] values with deduplicated sites.
fn parse_edges(raw_edges: Option<&Vec<Value>>) -> Vec<CallEdge> {
  let Some(items) = raw_edges else {
    return Vec::new();
  };
  let mut edges = Vec::with_capacity(items.len());
  for record in items {
    let Some(from) = record
      .get("from")
      .and_then(Value::as_str)
      .filter(|text| !text.is_empty())
    else {
      continue;
    };
    let Some(to) = record
      .get("to")
      .and_then(Value::as_str)
      .filter(|text| !text.is_empty())
    else {
      continue;
    };
    let mut sites = Vec::new();
    if let Some(raw_sites) = record.get("sites").and_then(Value::as_array) {
      for site in raw_sites
        .iter()
        .filter_map(Value::as_str)
        .filter(|text| !text.is_empty())
      {
        if !sites.iter().any(|existing| existing == site) {
          sites.push(site.to_owned());
        }
      }
    }
    edges.push(CallEdge {
      from: canonical_call_id(from),
      to: canonical_call_id(to),
      sites,
    });
  }
  edges
}

/// Queries a bounded caller and callee neighborhood through `function` `call_graph.get`, or falls
/// back to client-side `function` `call.list` traversal when `call_graph.get` is unavailable.
pub(crate) async fn call_graph_with_cache(
  backend: &McpBackend,
  cache: Option<&ViewCache>,
  req: CallGraphRequest<'_>,
) -> Result<Value> {
  let initial_entry = resolve_entry(backend, req.md5, req.entry, req.address).await?;
  if let Some(view_cache) = cache
    && view_cache.is_native_call_graph_unsupported(req.md5).await
  {
    return fallback_call_graph(backend, cache, &req, &initial_entry).await;
  }
  let canon_initial = canonical_call_id(&initial_entry);
  let normalized_expansion = req.expansion.as_ref().map(|exp| {
    (
      canonical_expansion_list(&exp.callers),
      canonical_expansion_list(&exp.callees),
    )
  });
  let callers_depth = if normalized_expansion.is_some() {
    1
  } else {
    req.callers_depth.clamp(1, 3)
  };
  let callees_depth = if normalized_expansion.is_some() {
    1
  } else {
    req.callees_depth.clamp(1, 3)
  };

  let cache_key = build_cache_key(
    &canon_initial,
    callers_depth,
    callees_depth,
    normalized_expansion.as_ref(),
  );
  let cached_graph = match cache {
    Some(view_cache) => view_cache.get_cached_call_graph(req.md5, &cache_key).await,
    None => None,
  };

  let raw_graph = if let Some(cached) = cached_graph {
    cached
  } else {
    let mut params = json!({
      "selector": { "entry": initial_entry },
      "callers_depth": callers_depth,
      "callees_depth": callees_depth,
      "max_nodes": CALL_GRAPH_NODE_LIMIT,
      "max_edges": CALL_GRAPH_EDGE_LIMIT,
      "scan": { "timeout_ms": CALL_GRAPH_TIMEOUT_MS },
    });
    if let Some((ref callers, ref callees)) = normalized_expansion {
      params["expansion"] = json!({
        "callers": callers,
        "callees": callees,
      });
    }
    let fetched = match backend
      .call("function", "call_graph.get", Some(req.md5), params)
      .await
    {
      Ok(fetched) => fetched,
      Err(error) if unsupported_operation(&error) => {
        if let Some(view_cache) = cache {
          view_cache.mark_native_call_graph_unsupported(req.md5).await;
        }
        return fallback_call_graph(backend, cache, &req, &initial_entry).await;
      }
      Err(error) => return Err(error),
    };
    if let Some(view_cache) = cache {
      view_cache
        .insert_cached_call_graph(req.md5, cache_key.clone(), fetched.clone())
        .await;
      if let Some(root_raw) = fetched
        .get("root")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
      {
        let canon_root = canonical_call_id(root_raw);
        if canon_root != canon_initial {
          let root_key = build_cache_key(
            &canon_root,
            callers_depth,
            callees_depth,
            normalized_expansion.as_ref(),
          );
          view_cache
            .insert_cached_call_graph(req.md5, root_key, fetched.clone())
            .await;
        }
      }
    }
    fetched
  };

  let root_entry = raw_graph
    .get("root")
    .and_then(Value::as_str)
    .filter(|text| !text.is_empty())
    .unwrap_or(&initial_entry);
  let root_id = canonical_call_id(root_entry);
  let mut nodes = parse_nodes(
    raw_graph.get("nodes").and_then(Value::as_array),
    req.show_template_arguments,
  );
  if nodes.is_empty() {
    nodes.push(CallNode {
      id: root_id.clone(),
      entry: root_entry.to_owned(),
      name: root_entry.to_owned(),
      caller_distance: None,
      callee_distance: None,
      branches: None,
    });
  }
  let root_name = nodes
    .iter()
    .find(|node| node.id == root_id)
    .map_or_else(|| nodes[0].name.clone(), |node| node.name.clone());
  let edges = parse_edges(raw_graph.get("edges").and_then(Value::as_array));
  let limited = raw_graph
    .get("limited")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  let warnings: Vec<String> = Vec::new();

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
