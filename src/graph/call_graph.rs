// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Bounded caller and callee neighborhood exploration with view-cache reuse.

use std::collections::{HashMap, HashSet, VecDeque};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{canonical_call_id, format_function_label, resolve_entry};
use crate::address::paginate_operation;
use crate::backend::McpBackend;
use crate::views::ViewCache;

/// Maximum number of function nodes included in a call-graph response.
const CALL_GRAPH_NODE_LIMIT: usize = 80;
/// Maximum number of directed call edges included in a call-graph response.
const CALL_GRAPH_EDGE_LIMIT: usize = 240;
/// Maximum number of `function.call.list` queries run during one graph request.
const CALL_GRAPH_QUERY_LIMIT: usize = 40;

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

/// Traversal direction relative to a visited function node.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CallDirection {
  /// Inbound functions calling the visited node.
  Callers,
  /// Outbound functions called by the visited node.
  Callees,
}

impl CallDirection {
  /// Returns the MCP `function.call.list` filter value for this direction.
  fn as_str(self) -> &'static str {
    match self {
      Self::Callers => "callers",
      Self::Callees => "callees",
    }
  }
}

/// Interactive expansion state and neighbor count for one call-graph branch.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallBranchState {
  /// Whether neighbors along this branch are expanded in the graph.
  expanded: bool,
  /// Unique neighbor count reported when this branch is expanded.
  #[serde(skip_serializing_if = "Option::is_none")]
  count: Option<usize>,
}

/// Caller and callee expansion states attached to one function node.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallBranches {
  /// Inbound caller branch state, when evaluated.
  #[serde(skip_serializing_if = "Option::is_none")]
  callers: Option<CallBranchState>,
  /// Outbound callee branch state, when evaluated.
  #[serde(skip_serializing_if = "Option::is_none")]
  callees: Option<CallBranchState>,
}

/// Function vertex in a serialized call-graph payload.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallNode {
  /// Canonical node identifier (`space:offset`).
  id: String,
  /// Backend function entry address string.
  entry: String,
  /// Formatted function display name.
  name: String,
  /// Shortest observed caller hop distance from the root node.
  #[serde(skip_serializing_if = "Option::is_none")]
  caller_distance: Option<usize>,
  /// Shortest observed callee hop distance from the root node.
  #[serde(skip_serializing_if = "Option::is_none")]
  callee_distance: Option<usize>,
  /// Interactive expansion flags when expansion mode is active.
  #[serde(skip_serializing_if = "Option::is_none")]
  branches: Option<CallBranches>,
}

/// Directed caller-to-callee edge with deduplicated call-site addresses.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallEdge {
  /// Canonical identifier of the caller function node.
  from: String,
  /// Canonical identifier of the callee function node.
  to: String,
  /// Distinct call-site addresses connecting `from` to `to`.
  sites: Vec<String>,
}

/// Queued BFS expansion item for caller or callee discovery.
struct CallQueueItem {
  /// Canonical identifier of the node being expanded.
  source_id: String,
  /// Raw backend entry address of `source_id`.
  source_entry: String,
  /// Display label of `source_id` for diagnostic warnings.
  source_name: String,
  /// Direction of neighbors to query from `source_entry`.
  direction: CallDirection,
  /// Hop distance assigned to discovered neighbors.
  distance: usize,
  /// Maximum hop depth allowed for this traversal arm.
  depth: usize,
}

/// Fetches the root function summary from `cache` or `function.get`.
async fn load_root_function(
  backend: &McpBackend,
  cache: Option<&ViewCache>,
  md5: &str,
  initial_entry: &str,
) -> Result<Value> {
  let canon_initial = canonical_call_id(initial_entry);
  if let Some(c) = cache
    && let Some(val) = c.get_cached_function(md5, &canon_initial).await
  {
    return Ok(val);
  }
  let val = backend
    .call(
      "function",
      "get",
      Some(md5),
      json!({
        "selector": { "entry": initial_entry },
        "projection": { "fields": ["entry", "name", "namespace", "demangled_name"] }
      }),
    )
    .await?;
  if let Some(c) = cache {
    c.insert_cached_function(md5, canon_initial, val.clone())
      .await;
  }
  Ok(val)
}

/// Marks a node's branch expansion flag and reports whether traversal should continue.
fn mark_branch_expansion(
  nodes: &mut [CallNode],
  node_index: &HashMap<String, usize>,
  expanded_sets: &(HashSet<String>, HashSet<String>),
  item: &CallQueueItem,
) -> bool {
  let is_expanded = match item.direction {
    CallDirection::Callers => expanded_sets.0.contains(&item.source_id),
    CallDirection::Callees => expanded_sets.1.contains(&item.source_id),
  };
  if let Some(&src_idx) = node_index.get(&item.source_id) {
    let branches = nodes[src_idx]
      .branches
      .get_or_insert_with(CallBranches::default);
    let state = CallBranchState {
      expanded: is_expanded,
      count: None,
    };
    match item.direction {
      CallDirection::Callers => branches.callers = Some(state),
      CallDirection::Callees => branches.callees = Some(state),
    }
  }
  is_expanded
}

/// Records the unique neighbor count onto an expanded branch state.
fn record_branch_count(
  nodes: &mut [CallNode],
  node_index: &HashMap<String, usize>,
  item: &CallQueueItem,
  records: &[Value],
) {
  let Some(&src_idx) = node_index.get(&item.source_id) else {
    return;
  };
  let unique_targets: HashSet<String> = records
    .iter()
    .filter_map(|r| r.get("entry").and_then(Value::as_str))
    .filter(|e| !e.is_empty())
    .map(canonical_call_id)
    .collect();
  let Some(branches) = nodes[src_idx].branches.as_mut() else {
    return;
  };
  let target_state = match item.direction {
    CallDirection::Callers => branches.callers.as_mut(),
    CallDirection::Callees => branches.callees.as_mut(),
  };
  if let Some(state) = target_state {
    state.count = Some(unique_targets.len());
  }
}

/// Mutable graph state accumulated during bounded call-graph BFS.
struct CallGraphBuilder {
  /// Collected vertices starting with the root function at index `0`.
  nodes: Vec<CallNode>,
  /// Lookup map from canonical node identifier to index inside `nodes`.
  node_index: HashMap<String, usize>,
  /// Collected directed call edges.
  edges: Vec<CallEdge>,
  /// Lookup map from `(from_id, to_id)` to index inside `edges`.
  edge_index: HashMap<(String, String), usize>,
  /// Seen canonical node identifiers along the caller traversal arm.
  seen_callers: HashSet<String>,
  /// Seen canonical node identifiers along the callee traversal arm.
  seen_callees: HashSet<String>,
  /// Pending BFS expansion queue.
  queue: VecDeque<CallQueueItem>,
  /// True when any node, edge, or query limit stopped expansion.
  limited: bool,
  /// True when explicit branch expansion sets control traversal.
  interactive: bool,
}

impl CallGraphBuilder {
  /// Incorporates neighbor call records discovered from one `item`, queueing unseen targets.
  fn apply_records(
    &mut self,
    item: &CallQueueItem,
    records: Vec<Value>,
    show_template_arguments: bool,
  ) {
    for record in records {
      let Some(rec_entry) = record
        .get("entry")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
      else {
        continue;
      };
      let target_id = canonical_call_id(rec_entry);
      let (from, to) = match item.direction {
        CallDirection::Callers => (target_id.clone(), item.source_id.clone()),
        CallDirection::Callees => (item.source_id.clone(), target_id.clone()),
      };
      let edge_key = (from.clone(), to.clone());
      if !self.edge_index.contains_key(&edge_key) && self.edges.len() >= CALL_GRAPH_EDGE_LIMIT {
        self.limited = true;
        continue;
      }

      let target_idx = if let Some(&idx) = self.node_index.get(&target_id) {
        idx
      } else {
        if self.nodes.len() >= CALL_GRAPH_NODE_LIMIT {
          self.limited = true;
          continue;
        }
        let target_name = format_function_label(&record, rec_entry, show_template_arguments);
        let idx = self.nodes.len();
        self.nodes.push(CallNode {
          id: target_id.clone(),
          entry: rec_entry.to_owned(),
          name: target_name,
          caller_distance: None,
          callee_distance: None,
          branches: None,
        });
        self.node_index.insert(target_id.clone(), idx);
        idx
      };

      if target_idx != 0 {
        match item.direction {
          CallDirection::Callers => {
            let d = &mut self.nodes[target_idx].caller_distance;
            *d = Some(d.map_or(item.distance, |prev| prev.min(item.distance)));
          }
          CallDirection::Callees => {
            let d = &mut self.nodes[target_idx].callee_distance;
            *d = Some(d.map_or(item.distance, |prev| prev.min(item.distance)));
          }
        }
      }

      let e_idx = if let Some(&idx) = self.edge_index.get(&edge_key) {
        idx
      } else {
        let idx = self.edges.len();
        self.edges.push(CallEdge {
          from,
          to,
          sites: Vec::new(),
        });
        self.edge_index.insert(edge_key, idx);
        idx
      };
      if let Some(site) = record
        .get("call_site")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
      {
        let sites = &mut self.edges[e_idx].sites;
        if !sites.iter().any(|s| s == site) {
          sites.push(site.to_owned());
        }
      }

      let directions: &[CallDirection] = if self.interactive {
        &[CallDirection::Callers, CallDirection::Callees]
      } else {
        std::slice::from_ref(&item.direction)
      };
      for &direction in directions {
        let seen_set = match direction {
          CallDirection::Callers => &mut self.seen_callers,
          CallDirection::Callees => &mut self.seen_callees,
        };
        if seen_set.insert(target_id.clone()) && item.distance < item.depth {
          let next_entry = self.nodes[target_idx].entry.clone();
          let next_name = self.nodes[target_idx].name.clone();
          self.queue.push_back(CallQueueItem {
            source_id: target_id.clone(),
            source_entry: next_entry,
            source_name: next_name,
            direction,
            distance: item.distance + 1,
            depth: item.depth,
          });
        }
      }
    }
  }
}

/// Explores bounded caller and callee neighborhoods using an optional shared view cache.
pub(crate) async fn call_graph_with_cache(
  backend: &McpBackend,
  cache: Option<&ViewCache>,
  req: CallGraphRequest<'_>,
) -> Result<Value> {
  let initial_entry = resolve_entry(backend, req.md5, req.entry, req.address).await?;
  let root_fn = load_root_function(backend, cache, req.md5, &initial_entry).await?;
  let root_entry = root_fn
    .get("entry")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .unwrap_or(&initial_entry)
    .to_owned();
  let root_name = format_function_label(&root_fn, &root_entry, req.show_template_arguments);
  let root_id = canonical_call_id(&root_entry);

  let expanded_sets = req.expansion.map(|exp| {
    (
      exp
        .callers
        .into_iter()
        .map(|e| canonical_call_id(&e))
        .collect::<HashSet<String>>(),
      exp
        .callees
        .into_iter()
        .map(|e| canonical_call_id(&e))
        .collect::<HashSet<String>>(),
    )
  });

  let callers_limit = if expanded_sets.is_some() {
    usize::MAX
  } else {
    req.callers_depth.clamp(1, 3)
  };
  let callees_limit = if expanded_sets.is_some() {
    usize::MAX
  } else {
    req.callees_depth.clamp(1, 3)
  };

  let mut builder = CallGraphBuilder {
    nodes: vec![CallNode {
      id: root_id.clone(),
      entry: root_entry.clone(),
      name: root_name.clone(),
      caller_distance: None,
      callee_distance: None,
      branches: None,
    }],
    node_index: HashMap::from([(root_id.clone(), 0)]),
    edges: Vec::new(),
    edge_index: HashMap::new(),
    seen_callers: HashSet::from([root_id.clone()]),
    seen_callees: HashSet::from([root_id.clone()]),
    queue: VecDeque::from([
      CallQueueItem {
        source_id: root_id.clone(),
        source_entry: root_entry.clone(),
        source_name: root_name.clone(),
        direction: CallDirection::Callers,
        distance: 1,
        depth: callers_limit,
      },
      CallQueueItem {
        source_id: root_id.clone(),
        source_entry: root_entry,
        source_name: root_name.clone(),
        direction: CallDirection::Callees,
        distance: 1,
        depth: callees_limit,
      },
    ]),
    limited: false,
    interactive: expanded_sets.is_some(),
  };

  let mut warnings: Vec<String> = Vec::new();
  let mut queries = 0usize;

  while let Some(item) = builder.queue.pop_front() {
    if let Some(ref sets) = expanded_sets
      && !mark_branch_expansion(&mut builder.nodes, &builder.node_index, sets, &item)
    {
      continue;
    }
    if queries >= CALL_GRAPH_QUERY_LIMIT || builder.edges.len() >= CALL_GRAPH_EDGE_LIMIT {
      builder.limited = true;
      break;
    }
    queries += 1;

    let canon_src = canonical_call_id(&item.source_entry);
    let cached_records = match cache {
      Some(c) => {
        c.get_cached_calls(req.md5, &canon_src, item.direction.as_str())
          .await
      }
      None => None,
    };
    let records = if let Some(cached) = cached_records {
      cached
    } else {
      let fetched = match paginate_operation(
        backend,
        "function",
        "call.list",
        req.md5,
        json!({
          "filter": {
            "entry": item.source_entry,
            "direction": item.direction.as_str(),
          },
          "page": {
            "limit": 1000,
          },
        }),
      )
      .await
      {
        Ok(records) => records,
        Err(error) => {
          if item.source_id == root_id {
            return Err(error);
          }
          warnings.push(format!("Could not expand {}: {error}", item.source_name));
          continue;
        }
      };
      if let Some(c) = cache {
        c.insert_cached_calls(
          req.md5,
          canon_src,
          item.direction.as_str().to_owned(),
          fetched.clone(),
        )
        .await;
      }
      fetched
    };

    if expanded_sets.is_some() {
      record_branch_count(&mut builder.nodes, &builder.node_index, &item, &records);
    }
    builder.apply_records(&item, records, req.show_template_arguments);
  }

  Ok(json!({
    "md5": req.md5,
    "root": root_id,
    "rootName": root_name,
    "nodes": builder.nodes,
    "edges": builder.edges,
    "limited": builder.limited,
    "warnings": warnings,
  }))
}
