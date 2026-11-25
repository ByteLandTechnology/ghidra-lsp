// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Basic-block control-flow graph construction from listing instructions.

use std::collections::{BTreeSet, HashMap, HashSet};

use anyhow::Result;
use serde_json::{Value, json};

use super::{BatchRequest, batch_query, format_function_label, resolve_entry};
use crate::address::{display_address, parse_address, same_address};
use crate::backend::McpBackend;
use crate::mcp_client::PagePolicy;

/// Computes decoded byte length from a base64 string without storing decoded bytes.
fn base64_byte_len(data: &str) -> usize {
  let clean: Vec<u8> = data.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
  if clean.len() < 4 {
    return 0;
  }
  let padding = clean
    .iter()
    .rev()
    .take(2)
    .take_while(|&&b| b == b'=')
    .count();
  (clean.len() * 3) / 4 - padding
}

/// Determines the byte length of one listing instruction record, falling back to `1`.
fn instruction_byte_length(instr: &Value) -> usize {
  if let Some(len) = instr
    .get("length")
    .and_then(Value::as_u64)
    .filter(|&n| n > 0)
  {
    return usize::try_from(len).unwrap_or(usize::MAX);
  }
  if let Some(bytes) = instr.get("bytes").and_then(Value::as_object) {
    let encoding = bytes.get("encoding").and_then(Value::as_str).unwrap_or("");
    let data = bytes.get("data").and_then(Value::as_str).unwrap_or("");
    let count = if encoding == "base64" {
      base64_byte_len(data)
    } else {
      let hex_len = data.chars().filter(|c| !c.is_whitespace()).count();
      hex_len.div_ceil(2)
    };
    if count > 0 {
      return count;
    }
  }
  1
}

/// Returns true when a reference label describes a conditional branch.
fn is_conditional_label(label: &str) -> bool {
  label.contains("CONDITIONAL") && !label.contains("UNCONDITIONAL")
}

/// Finds an instruction index by exact address string or canonical `space:offset` form.
fn lookup_address_index(
  exact_map: &HashMap<String, usize>,
  canon_map: &HashMap<String, usize>,
  addr: &str,
) -> Option<usize> {
  if let Some(&idx) = exact_map.get(addr) {
    return Some(idx);
  }
  parse_address(addr, "ram").and_then(|parsed| canon_map.get(&parsed.canonical).copied())
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

/// Removes instructions outside the owning function when the body span has multiple ranges.
async fn filter_body_instructions(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
  bounds: Option<&serde_json::Map<String, Value>>,
  start: &str,
  end: &str,
  mut instructions: Vec<Value>,
) -> Result<Vec<Value>> {
  let Some(body_start) = parse_address(start, "ram") else {
    return Ok(instructions);
  };
  let Some(body_end) = parse_address(end, "ram") else {
    return Ok(instructions);
  };
  let Some(num_addresses) = bounds
    .and_then(|b| b.get("num_addresses"))
    .and_then(Value::as_u64)
  else {
    return Ok(instructions);
  };
  if body_end.offset < body_start.offset {
    return Ok(instructions);
  }
  let span = u128::from(body_end.offset) - u128::from(body_start.offset) + 1;
  if u128::from(num_addresses) == span || instructions.is_empty() {
    return Ok(instructions);
  }

  let resolve_requests: Vec<BatchRequest> = instructions
    .iter()
    .enumerate()
    .map(|(index, instr)| BatchRequest {
      id: format!("resolve:{index}"),
      domain: "address",
      operation: "resolve",
      method: "address.resolve",
      params: json!({
        "selector": {
          "address": instr.get("address").and_then(Value::as_str).unwrap_or("")
        }
      }),
      all: false,
    })
    .collect();
  let resolved_map = batch_query(backend, md5, &resolve_requests).await?;
  let mut filtered = Vec::with_capacity(instructions.len());
  for (index, instr) in instructions.drain(..).enumerate() {
    let owns = resolved_map
      .get(&format!("resolve:{index}"))
      .and_then(|val| val.pointer("/function/entry"))
      .and_then(Value::as_str)
      .is_some_and(|resolved_entry| same_address(resolved_entry, entry));
    if owns {
      filtered.push(instr);
    }
  }
  Ok(filtered)
}

/// Output produced by partitioning instructions into basic blocks.
struct PartitionResult {
  /// Sorted start instruction indexes for each basic block.
  starts: Vec<usize>,
  /// Outgoing `(target_address, edge_label)` list per instruction index.
  targets: Vec<Vec<(String, String)>>,
  /// Count of jump or branch instructions that produced zero resolved targets.
  unresolved: usize,
}

/// Analyzes instruction flow and branch references to determine block leaders and edges.
fn partition_blocks(
  instructions: &[Value],
  branch_refs: &HashMap<String, Value>,
) -> PartitionResult {
  let mut exact_index = HashMap::with_capacity(instructions.len());
  let mut canon_index = HashMap::with_capacity(instructions.len());
  for (index, instr) in instructions.iter().enumerate() {
    let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
    exact_index.entry(addr.to_owned()).or_insert(index);
    if let Some(parsed) = parse_address(addr, "ram") {
      canon_index.entry(parsed.canonical).or_insert(index);
    }
  }

  let mut targets: Vec<Vec<(String, String)>> = vec![Vec::new(); instructions.len()];
  let mut leaders = BTreeSet::from([0usize]);
  let mut unresolved = 0usize;

  for (index, instr) in instructions.iter().enumerate() {
    let flow = instr.get("flow_type").and_then(Value::as_str).unwrap_or("");
    let mut outgoing: Vec<(String, String)> = Vec::new();
    if flow.contains("JUMP") || flow.contains("BRANCH") {
      if let Some(refs) = branch_refs
        .get(&format!("ref:{index}"))
        .and_then(|v| v.get("items"))
        .and_then(Value::as_array)
      {
        for ref_item in refs {
          let ref_type = ref_item.get("type").and_then(Value::as_str).unwrap_or("");
          if ref_type.contains("JUMP") || ref_type.contains("BRANCH") {
            let to = ref_item
              .get("to")
              .and_then(Value::as_str)
              .unwrap_or("")
              .to_owned();
            outgoing.push((to, ref_type.to_owned()));
          }
        }
      }
      if outgoing.is_empty() {
        unresolved += 1;
      }
    }
    let fall_through = instr
      .get("fall_through")
      .and_then(Value::as_str)
      .unwrap_or("");
    if !fall_through.is_empty() {
      let label = if flow.contains("CONDITIONAL") {
        "Fall through"
      } else {
        ""
      };
      outgoing.push((fall_through.to_owned(), label.to_owned()));
    }

    let breaks_flow = flow.contains("JUMP")
      || flow.contains("BRANCH")
      || flow.contains("TERMINATOR")
      || flow.contains("RETURN")
      || fall_through.is_empty();
    if breaks_flow {
      if index + 1 < instructions.len() {
        leaders.insert(index + 1);
      }
      for (to, _) in &outgoing {
        if let Some(pos) = lookup_address_index(&exact_index, &canon_index, to) {
          leaders.insert(pos);
        }
      }
    } else if index + 1 < instructions.len() {
      let next_addr = instructions[index + 1]
        .get("address")
        .and_then(Value::as_str)
        .unwrap_or("");
      if !same_address(fall_through, next_addr) {
        leaders.insert(index + 1);
        if let Some(pos) = lookup_address_index(&exact_index, &canon_index, fall_through) {
          leaders.insert(pos);
        }
      }
    }
    targets[index] = outgoing;
  }

  PartitionResult {
    starts: leaders.into_iter().collect(),
    targets,
    unresolved,
  }
}

/// Formats disassembly lines for one basic block slice.
fn format_block_lines(block: &[Value]) -> Vec<String> {
  block
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
              Value::String(s) => Some(s.clone()),
              Value::Number(n) => Some(n.to_string()),
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

/// Serialized blocks, graph nodes, and graph edges for a non-empty CFG.
struct CfgGraphPayload {
  /// Compact instruction length metadata grouped by basic block.
  blocks: Vec<Value>,
  /// Graph nodes including external jump targets outside the body range.
  nodes: Vec<Value>,
  /// Typed control-flow edges between graph nodes.
  edges: Vec<Value>,
}

/// Builds node, edge, and compact block payloads from partitioned instructions.
fn build_cfg_graph_payload(
  instructions: &[Value],
  entry: &str,
  starts: &[usize],
  targets: &[Vec<(String, String)>],
) -> CfgGraphPayload {
  let mut blocks_slice: Vec<(usize, &[Value])> = Vec::with_capacity(starts.len());
  let mut exact_membership: HashMap<String, String> = HashMap::new();
  let mut canon_membership: HashMap<String, String> = HashMap::new();

  for (block_idx, &start_idx) in starts.iter().enumerate() {
    let end_idx = starts
      .get(block_idx + 1)
      .copied()
      .unwrap_or(instructions.len());
    let block = &instructions[start_idx..end_idx];
    let block_id = format!("block:{block_idx}");
    for instr in block {
      let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
      exact_membership
        .entry(addr.to_owned())
        .or_insert_with(|| block_id.clone());
      if let Some(parsed) = parse_address(addr, "ram") {
        canon_membership
          .entry(parsed.canonical)
          .or_insert_with(|| block_id.clone());
      }
    }
    blocks_slice.push((end_idx - 1, block));
  }

  let mut nodes: Vec<Value> = blocks_slice
    .iter()
    .enumerate()
    .map(|(block_idx, (_, block))| {
      let first_addr = block[0].get("address").and_then(Value::as_str).unwrap_or("");
      json!({
        "id": format!("block:{block_idx}"),
        "title": display_address(first_addr),
        "subtitle": format!("{} instruction{}", block.len(), if block.len() == 1 { "" } else { "s" }),
        "address": first_addr,
        "entry": entry,
        "kind": "block",
        "lines": format_block_lines(block),
      })
    })
    .collect();

  let mut raw_edges: Vec<(String, String, String)> = Vec::new();
  let mut external_seen = HashSet::new();
  for (block_idx, (last_idx, _)) in blocks_slice.iter().enumerate() {
    let from_id = format!("block:{block_idx}");
    for (to_addr, label) in &targets[*last_idx] {
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
      raw_edges.push((from_id.clone(), to_id, label.clone()));
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

  let blocks: Vec<Value> = blocks_slice
    .iter()
    .map(|(_, block)| {
      let first_addr = block[0]
        .get("address")
        .and_then(Value::as_str)
        .unwrap_or("");
      let instrs: Vec<Value> = block
        .iter()
        .map(|instr| {
          let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
          json!({
            "address": addr,
            "length": instruction_byte_length(instr),
          })
        })
        .collect();
      json!({
        "address": first_addr,
        "instructions": instrs,
      })
    })
    .collect();

  CfgGraphPayload {
    blocks,
    nodes,
    edges,
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
    .filter(|s| !s.is_empty())
    .unwrap_or(&initial_entry)
    .to_owned();
  let name = format_function_label(&fn_val, &entry, show_template_arguments);

  let bounds = fn_val.get("body").and_then(Value::as_object);
  let start_str = bounds
    .and_then(|b| b.get("start"))
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty());
  let end_str = bounds
    .and_then(|b| b.get("end"))
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty());
  let (Some(start), Some(end)) = (start_str, end_str) else {
    return Ok(empty_control_flow(
      md5,
      &entry,
      &name,
      "This function has no instruction body.",
      "External functions do not have a local control-flow graph.",
    ));
  };

  let raw_instructions = PagePolicy::STRICT
    .collect_session(
      backend,
      "listing",
      "instruction.list",
      md5,
      json!({ "scan": { "range": { "start": start, "end": end }, "timeout_ms": 60000 } }),
    )
    .await?;
  let instructions =
    filter_body_instructions(backend, md5, &entry, bounds, start, end, raw_instructions).await?;
  if instructions.is_empty() {
    return Ok(empty_control_flow(
      md5,
      &entry,
      &name,
      "No instructions in this body.",
      "Ghidra reported no instruction flow.",
    ));
  }

  let branch_requests: Vec<BatchRequest> = instructions
    .iter()
    .enumerate()
    .filter(|(_, instr)| {
      let flow = instr.get("flow_type").and_then(Value::as_str).unwrap_or("");
      flow.contains("JUMP") || flow.contains("BRANCH")
    })
    .map(|(index, instr)| BatchRequest {
      id: format!("ref:{index}"),
      domain: "reference",
      operation: "list",
      method: "reference.list",
      params: json!({
        "filter": {
          "direction": "from",
          "from": instr.get("address").and_then(Value::as_str).unwrap_or("")
        }
      }),
      all: true,
    })
    .collect();
  let branch_refs = batch_query(backend, md5, &branch_requests).await?;

  let partitioned = partition_blocks(&instructions, &branch_refs);
  let payload = build_cfg_graph_payload(
    &instructions,
    &entry,
    &partitioned.starts,
    &partitioned.targets,
  );
  let scope = if partitioned.unresolved > 0 {
    format!("{} unresolved jumps", partitioned.unresolved)
  } else {
    String::new()
  };

  Ok(json!({
    "md5": md5,
    "entry": entry,
    "name": name,
    "displayAddress": display_address(&entry),
    "hasBody": true,
    "emptyReason": Value::Null,
    "scope": scope,
    "unresolvedJumps": partitioned.unresolved,
    "blocks": payload.blocks,
    "nodes": payload.nodes,
    "edges": payload.edges,
  }))
}
