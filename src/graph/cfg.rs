// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Basic-block control-flow graph construction through `listing` `basic_block.list`.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use serde_json::{Value, json};

use super::{format_function_label, resolve_entry};
use crate::address::{display_address, paginate_operation, parse_address, same_address};
use crate::backend::McpBackend;

/// Maximum outgoing edges requested per `listing` `basic_block.list` page.
const BASIC_BLOCK_MAX_EDGES: usize = 2_000;
/// Scan timeout in milliseconds kept below the 30-second MCP session lock limit.
const BASIC_BLOCK_TIMEOUT_MS: u64 = 25_000;

/// Determines the byte length of one basic-block instruction summary, falling back to `1`.
fn instruction_byte_length(instr: &Value) -> usize {
  instr
    .get("length")
    .and_then(Value::as_u64)
    .filter(|&len| len > 0)
    .map_or(1, |len| usize::try_from(len).unwrap_or(usize::MAX))
}

/// Returns true when a flow or edge type describes a conditional branch.
fn is_conditional_label(label: &str) -> bool {
  let upper = label.to_ascii_uppercase();
  upper.contains("CONDITIONAL") && !upper.contains("UNCONDITIONAL")
}

/// Returns true when a backend edge type denotes a fall-through transition.
fn is_fall_through_type(edge_type: &str) -> bool {
  edge_type.eq_ignore_ascii_case("FALL_THROUGH")
    || edge_type.eq_ignore_ascii_case("Fall through")
    || edge_type.eq_ignore_ascii_case("fall-through")
}

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

/// Formats disassembly lines for one basic block's instruction slice.
fn format_block_lines(instructions: &[Value]) -> Vec<String> {
  instructions
    .iter()
    .map(|instr| {
      let mnemonic = instr.get("mnemonic").and_then(Value::as_str).unwrap_or("");
      let operands = instr
        .get("operands")
        .and_then(Value::as_array)
        .map(|ops| {
          ops
            .iter()
            .filter_map(|op| match op {
              Value::String(text) => Some(text.clone()),
              Value::Number(num) => Some(num.to_string()),
              _ => None,
            })
            .collect::<Vec<_>>()
            .join(", ")
        })
        .unwrap_or_default();
      format!("{mnemonic} {operands}").trim().to_owned()
    })
    .collect()
}

/// Returns true when `block` starts at or contains the function `entry` address.
fn block_contains_entry(block: &Value, entry: &str) -> bool {
  if block
    .get("start")
    .and_then(Value::as_str)
    .is_some_and(|start| same_address(start, entry))
  {
    return true;
  }
  block
    .get("instructions")
    .and_then(Value::as_array)
    .is_some_and(|instrs| {
      instrs.iter().any(|instr| {
        instr
          .get("address")
          .and_then(Value::as_str)
          .is_some_and(|addr| same_address(addr, entry))
      })
    })
}

/// Places the block containing `entry` at index zero while keeping remaining blocks ordered.
fn order_entry_block_first(mut blocks: Vec<Value>, entry: &str) -> Vec<Value> {
  if let Some(pos) = blocks
    .iter()
    .position(|block| block_contains_entry(block, entry))
    && pos > 0
  {
    let entry_block = blocks.remove(pos);
    blocks.insert(0, entry_block);
  }
  blocks
}

/// Serialized blocks, graph nodes, graph edges, and limit flags for a non-empty CFG.
struct CfgGraphPayload {
  /// Compact instruction length metadata grouped by basic block.
  blocks: Vec<Value>,
  /// Graph nodes including external jump targets outside the body range.
  nodes: Vec<Value>,
  /// Typed control-flow edges between graph nodes.
  edges: Vec<Value>,
  /// Count of basic blocks ending in an unresolved jump.
  unresolved_jumps: usize,
  /// True when any basic block reached its outgoing edge cap.
  edges_limited: bool,
}

/// Registers an address in both exact and canonical `space:offset` block membership maps.
fn insert_block_membership(
  exact_membership: &mut HashMap<String, String>,
  canon_membership: &mut HashMap<String, String>,
  addr: &str,
  block_id: &str,
) {
  if addr.is_empty() {
    return;
  }
  exact_membership
    .entry(addr.to_owned())
    .or_insert_with(|| block_id.to_owned());
  if let Some(parsed) = parse_address(addr, "ram") {
    canon_membership
      .entry(parsed.canonical)
      .or_insert_with(|| block_id.to_owned());
  }
}

/// Builds node, edge, and compact block payloads from `basic_block.list` items.
fn build_cfg_graph_payload(raw_blocks: &[Value], entry: &str) -> CfgGraphPayload {
  let mut exact_membership: HashMap<String, String> = HashMap::new();
  let mut canon_membership: HashMap<String, String> = HashMap::new();
  let mut nodes: Vec<Value> = Vec::with_capacity(raw_blocks.len());
  let mut blocks: Vec<Value> = Vec::with_capacity(raw_blocks.len());
  let mut unresolved_jumps = 0usize;
  let mut edges_limited = false;

  for (block_idx, block) in raw_blocks.iter().enumerate() {
    let block_id = format!("block:{block_idx}");
    let instructions = block
      .get("instructions")
      .and_then(Value::as_array)
      .map_or(&[][..], Vec::as_slice);
    let first_addr = block
      .get("start")
      .and_then(Value::as_str)
      .filter(|text| !text.is_empty())
      .or_else(|| {
        instructions
          .first()
          .and_then(|instr| instr.get("address"))
          .and_then(Value::as_str)
      })
      .unwrap_or("");

    insert_block_membership(
      &mut exact_membership,
      &mut canon_membership,
      first_addr,
      &block_id,
    );
    for instr in instructions {
      let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
      insert_block_membership(
        &mut exact_membership,
        &mut canon_membership,
        addr,
        &block_id,
      );
    }

    if block.get("unresolved_jump").and_then(Value::as_bool) == Some(true) {
      unresolved_jumps += 1;
    }
    if block.get("edges_limited").and_then(Value::as_bool) == Some(true) {
      edges_limited = true;
    }

    let instr_count = instructions.len();
    nodes.push(json!({
      "id": block_id,
      "title": display_address(first_addr),
      "subtitle": format!("{instr_count} instruction{}", if instr_count == 1 { "" } else { "s" }),
      "address": first_addr,
      "entry": entry,
      "kind": "block",
      "lines": format_block_lines(instructions),
    }));

    let compact_instrs: Vec<Value> = instructions
      .iter()
      .map(|instr| {
        let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
        json!({
          "address": addr,
          "length": instruction_byte_length(instr),
        })
      })
      .collect();
    blocks.push(json!({
      "address": first_addr,
      "instructions": compact_instrs,
    }));
  }

  let mut raw_edges: Vec<(String, String, String)> = Vec::new();
  let mut external_seen = HashSet::new();

  for (block_idx, block) in raw_blocks.iter().enumerate() {
    let from_id = format!("block:{block_idx}");
    let flow_type = block.get("flow_type").and_then(Value::as_str).unwrap_or("");
    let destinations = block
      .get("destinations")
      .and_then(Value::as_array)
      .map_or(&[][..], Vec::as_slice);
    let conditional_block = is_conditional_label(flow_type)
      || destinations.iter().any(|dest| {
        dest
          .get("type")
          .and_then(Value::as_str)
          .is_some_and(is_conditional_label)
      });

    for dest in destinations {
      let Some(to_addr) = dest
        .get("to")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
      else {
        continue;
      };
      let raw_type = dest.get("type").and_then(Value::as_str).unwrap_or("");
      let label = if is_fall_through_type(raw_type) {
        if conditional_block {
          "Fall through".to_owned()
        } else {
          String::new()
        }
      } else {
        raw_type.to_owned()
      };
      let to_id = exact_membership
        .get(to_addr)
        .cloned()
        .or_else(|| {
          parse_address(to_addr, "ram")
            .and_then(|parsed| canon_membership.get(&parsed.canonical).cloned())
        })
        .unwrap_or_else(|| {
          let ext_id = format!("external:{to_addr}");
          if external_seen.insert(ext_id.clone()) {
            nodes.push(json!({
              "id": ext_id,
              "title": display_address(to_addr),
              "subtitle": "Outside body range",
              "address": to_addr,
              "column": 2,
            }));
          }
          ext_id
        });
      raw_edges.push((from_id.clone(), to_id, label));
    }
  }

  let branch_sources: HashSet<String> = raw_edges
    .iter()
    .filter(|(_, _, label)| is_conditional_label(label))
    .map(|(from, _, _)| from.clone())
    .collect();

  let edges: Vec<Value> = raw_edges
    .into_iter()
    .map(|(from, to, label)| {
      let kind = if is_conditional_label(&label) {
        "taken"
      } else if (label.eq_ignore_ascii_case("fall through")
        || label.eq_ignore_ascii_case("fall-through"))
        && branch_sources.contains(&from)
      {
        "fallthrough"
      } else {
        "flow"
      };
      json!({
        "from": from,
        "to": to,
        "label": label,
        "kind": kind,
      })
    })
    .collect();

  CfgGraphPayload {
    blocks,
    nodes,
    edges,
    unresolved_jumps,
    edges_limited,
  }
}

/// Builds basic-block nodes and control-flow edges for a function entry or address.
pub(crate) async fn control_flow_graph(
  backend: &McpBackend,
  md5: &str,
  entry_opt: Option<&str>,
  address_opt: Option<&str>,
  show_template_arguments: bool,
) -> Result<Value> {
  let initial_entry = resolve_entry(backend, md5, entry_opt, address_opt).await?;
  let fn_val = backend
    .call(
      "function",
      "get",
      Some(md5),
      json!({
        "selector": { "entry": initial_entry },
        "projection": { "fields": ["entry", "name", "namespace", "demangled_name", "body"] }
      }),
    )
    .await?;
  let entry = fn_val
    .get("entry")
    .and_then(Value::as_str)
    .filter(|text| !text.is_empty())
    .unwrap_or(&initial_entry)
    .to_owned();
  let name = format_function_label(&fn_val, &entry, show_template_arguments);

  let bounds = fn_val.get("body").and_then(Value::as_object);
  let has_start = bounds
    .and_then(|body| body.get("start"))
    .and_then(Value::as_str)
    .is_some_and(|text| !text.is_empty());
  let has_end = bounds
    .and_then(|body| body.get("end"))
    .and_then(Value::as_str)
    .is_some_and(|text| !text.is_empty());
  if !has_start || !has_end {
    return Ok(empty_control_flow(
      md5,
      &entry,
      &name,
      "This function has no instruction body.",
      "External functions do not have a local control-flow graph.",
    ));
  }

  let fetched_blocks = paginate_operation(
    backend,
    "listing",
    "basic_block.list",
    md5,
    json!({
      "filter": {
        "selector": { "kind": "function", "entry": entry },
        "max_edges": BASIC_BLOCK_MAX_EDGES,
      },
      "page": { "limit": 1000 },
      "scan": { "timeout_ms": BASIC_BLOCK_TIMEOUT_MS },
    }),
  )
  .await?;

  let non_empty_blocks: Vec<Value> = fetched_blocks
    .into_iter()
    .filter(|block| {
      block
        .get("instructions")
        .and_then(Value::as_array)
        .is_some_and(|instrs| !instrs.is_empty())
    })
    .collect();
  if non_empty_blocks.is_empty() {
    return Ok(empty_control_flow(
      md5,
      &entry,
      &name,
      "No instructions in this body.",
      "Ghidra reported no instruction flow.",
    ));
  }

  let ordered_blocks = order_entry_block_first(non_empty_blocks, &entry);
  let payload = build_cfg_graph_payload(&ordered_blocks, &entry);
  let scope = match (payload.unresolved_jumps > 0, payload.edges_limited) {
    (true, true) => format!(
      "{} unresolved jumps; flow edges truncated at limit",
      payload.unresolved_jumps
    ),
    (true, false) => format!("{} unresolved jumps", payload.unresolved_jumps),
    (false, true) => "Flow edges truncated at limit".to_owned(),
    (false, false) => String::new(),
  };

  Ok(json!({
    "md5": md5,
    "entry": entry,
    "name": name,
    "displayAddress": display_address(&entry),
    "hasBody": true,
    "emptyReason": Value::Null,
    "scope": scope,
    "unresolvedJumps": payload.unresolved_jumps,
    "blocks": payload.blocks,
    "nodes": payload.nodes,
    "edges": payload.edges,
  }))
}
