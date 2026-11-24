// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Fallback basic-block control-flow graph builder using `listing` `instruction.list`.

use std::collections::{BTreeSet, HashMap};

use anyhow::Result;
use serde_json::{Value, json};

use super::cfg::{
  CfgBlockInput, empty_control_flow, finish_control_flow, is_conditional_label,
  order_block_inputs_entry_first,
};
use super::{BatchRequest, batch_query};
use crate::address::{paginate_operation, parse_address, same_address};
use crate::backend::{McpBackend, unsupported_schema};

/// Function metadata resolved before building a fallback control-flow graph.
pub(super) struct FallbackCfgRequest<'a> {
  /// Program MD5 hash string.
  pub(super) md5: &'a str,
  /// Canonical function entry address.
  pub(super) entry: &'a str,
  /// Formatted function display name.
  pub(super) name: &'a str,
  /// Function body metadata object from `function.get`.
  pub(super) bounds: &'a serde_json::Map<String, Value>,
  /// Inclusive body start address.
  pub(super) start: &'a str,
  /// Inclusive body end address.
  pub(super) end: &'a str,
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

/// Removes instructions outside the owning function when the body span has multiple ranges.
async fn filter_body_instructions(
  backend: &McpBackend,
  req: &FallbackCfgRequest<'_>,
  mut instructions: Vec<Value>,
) -> Result<Vec<Value>> {
  let Some(body_start) = parse_address(req.start, "ram") else {
    return Ok(instructions);
  };
  let Some(body_end) = parse_address(req.end, "ram") else {
    return Ok(instructions);
  };
  let Some(num_addresses) = req.bounds.get("num_addresses").and_then(Value::as_u64) else {
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
  let resolved_map = batch_query(backend, req.md5, &resolve_requests).await?;
  let mut filtered = Vec::with_capacity(instructions.len());
  for (index, instr) in instructions.drain(..).enumerate() {
    let owns = resolved_map
      .get(&format!("resolve:{index}"))
      .and_then(|val| val.pointer("/function/entry"))
      .and_then(Value::as_str)
      .is_some_and(|resolved_entry| same_address(resolved_entry, req.entry));
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
  /// Per-instruction flag set when a jump or branch has zero resolved targets.
  unresolved_flags: Vec<bool>,
}

/// Analyzes instruction flow and branch references to determine block leaders and edges.
fn partition_blocks(
  instructions: &[Value],
  entry: &str,
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
  let mut unresolved_flags = vec![false; instructions.len()];
  let mut leaders = BTreeSet::from([0usize]);
  if let Some(entry_idx) = lookup_address_index(&exact_index, &canon_index, entry) {
    leaders.insert(entry_idx);
  }

  for (index, instr) in instructions.iter().enumerate() {
    let flow = instr.get("flow_type").and_then(Value::as_str).unwrap_or("");
    let mut outgoing: Vec<(String, String)> = Vec::new();
    if flow.contains("JUMP") || flow.contains("BRANCH") {
      if let Some(refs) = branch_refs
        .get(&format!("ref:{index}"))
        .and_then(|val| val.get("items"))
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
        unresolved_flags[index] = true;
      }
    }
    let fall_through = instr
      .get("fall_through")
      .and_then(Value::as_str)
      .unwrap_or("");
    if !fall_through.is_empty() {
      let label = if is_conditional_label(flow) {
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
    unresolved_flags,
  }
}

/// Queries outgoing branch references per instruction with `batch.execute`.
async fn batch_branch_refs(
  backend: &McpBackend,
  md5: &str,
  instructions: &[Value],
) -> Result<HashMap<String, Value>> {
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
  batch_query(backend, md5, &branch_requests).await
}

/// Groups function-scoped reference items under `ref:{index}` keys for `partition_blocks`.
fn group_scoped_branch_refs(
  instructions: &[Value],
  raw_refs: Vec<Value>,
) -> HashMap<String, Value> {
  let mut exact_index = HashMap::with_capacity(instructions.len());
  let mut canon_index = HashMap::with_capacity(instructions.len());
  for (index, instr) in instructions.iter().enumerate() {
    let addr = instr.get("address").and_then(Value::as_str).unwrap_or("");
    exact_index.entry(addr.to_owned()).or_insert(index);
    if let Some(parsed) = parse_address(addr, "ram") {
      canon_index.entry(parsed.canonical).or_insert(index);
    }
  }
  let mut grouped: HashMap<usize, Vec<Value>> = HashMap::new();
  for ref_item in raw_refs {
    let from = ref_item.get("from").and_then(Value::as_str).unwrap_or("");
    if !from.is_empty()
      && let Some(index) = lookup_address_index(&exact_index, &canon_index, from)
    {
      grouped.entry(index).or_default().push(ref_item);
    }
  }
  grouped
    .into_iter()
    .map(|(index, items)| (format!("ref:{index}"), json!({ "items": items })))
    .collect()
}

/// Builds a control-flow graph from `listing` `instruction.list` and `reference` `list` queries.
pub(super) async fn fallback_control_flow_graph(
  backend: &McpBackend,
  req: FallbackCfgRequest<'_>,
) -> Result<Value> {
  let scoped_instructions = paginate_operation(
    backend,
    "listing",
    "instruction.list",
    req.md5,
    json!({
      "filter": { "selector": { "kind": "function", "entry": req.entry } },
      "page": { "limit": 1000 },
      "scan": { "timeout_ms": 60000 }
    }),
  )
  .await;

  let (instructions, branch_refs) = match scoped_instructions {
    Ok(instructions) => {
      if instructions.is_empty() {
        return Ok(empty_control_flow(
          req.md5,
          req.entry,
          req.name,
          "No instructions in this body.",
          "Ghidra reported no instruction flow.",
        ));
      }
      let has_branches = instructions.iter().any(|instr| {
        let flow = instr.get("flow_type").and_then(Value::as_str).unwrap_or("");
        flow.contains("JUMP") || flow.contains("BRANCH")
      });
      let branch_refs = if has_branches {
        match paginate_operation(
          backend,
          "reference",
          "list",
          req.md5,
          json!({
            "filter": {
              "direction": "from",
              "selector": { "kind": "function", "entry": req.entry }
            },
            "page": { "limit": 1000 },
            "scan": { "timeout_ms": 60000 }
          }),
        )
        .await
        {
          Ok(raw_refs) => group_scoped_branch_refs(&instructions, raw_refs),
          Err(error) if unsupported_schema(&error) => {
            batch_branch_refs(backend, req.md5, &instructions).await?
          }
          Err(error) => return Err(error),
        }
      } else {
        HashMap::new()
      };
      (instructions, branch_refs)
    }
    Err(error) if unsupported_schema(&error) => {
      let raw_instructions = paginate_operation(
        backend,
        "listing",
        "instruction.list",
        req.md5,
        json!({ "scan": { "range": { "start": req.start, "end": req.end }, "timeout_ms": 60000 } }),
      )
      .await?;
      let instructions = filter_body_instructions(backend, &req, raw_instructions).await?;
      if instructions.is_empty() {
        return Ok(empty_control_flow(
          req.md5,
          req.entry,
          req.name,
          "No instructions in this body.",
          "Ghidra reported no instruction flow.",
        ));
      }
      let branch_refs = batch_branch_refs(backend, req.md5, &instructions).await?;
      (instructions, branch_refs)
    }
    Err(error) => return Err(error),
  };

  let partitioned = partition_blocks(&instructions, req.entry, &branch_refs);
  let mut blocks_in = Vec::with_capacity(partitioned.starts.len());
  for (block_idx, &start_idx) in partitioned.starts.iter().enumerate() {
    let end_idx = partitioned
      .starts
      .get(block_idx + 1)
      .copied()
      .unwrap_or(instructions.len());
    let slice = &instructions[start_idx..end_idx];
    if slice.is_empty() {
      continue;
    }
    let last_idx = end_idx - 1;
    let start = slice[0]
      .get("address")
      .and_then(Value::as_str)
      .unwrap_or("");
    let unresolved_jump = partitioned.unresolved_flags[start_idx..end_idx]
      .iter()
      .any(|&flag| flag);
    blocks_in.push(CfgBlockInput {
      start,
      instructions: slice,
      destinations: partitioned.targets[last_idx].clone(),
      unresolved_jump,
      edges_limited: false,
    });
  }

  let ordered_blocks = order_block_inputs_entry_first(blocks_in, req.entry);
  Ok(finish_control_flow(
    req.md5,
    req.entry,
    req.name,
    &ordered_blocks,
  ))
}
