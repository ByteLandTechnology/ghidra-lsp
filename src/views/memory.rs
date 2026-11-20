// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Hexadecimal memory window loading, chunk formatting, and block navigation.

use std::cmp::Ordering;
use std::collections::HashMap;

use anyhow::{Context, Result};
use serde_json::{Value, json};

use super::format::{canonical_key, decode_bytes_vec, value_str};
use super::inspector::decode_data_inspector;
use super::meta::get_or_load_meta;
use super::{DEFAULT_HEX_CHUNK_BYTES, HexCell, HexChunk, HexRow, ProgramMetaCache};
use crate::address::{
  MemoryBlockInfo, add_address_offset, address_in_range, adjacent_memory_block, align_row_address,
  clamp_address, compare_addresses, find_memory_block, format_address, parse_address,
};
use crate::backend::McpBackend;

/// Parameters controlling a bounded hexadecimal memory window request.
pub(crate) struct MemoryWindowRequest<'a> {
  /// Lowercase 32-character session MD5 hash.
  pub(crate) md5: &'a str,
  /// Optional target start address in the program.
  pub(crate) address: Option<&'a str>,
  /// Requested byte window length (`0` uses `DEFAULT_HEX_CHUNK_BYTES`).
  pub(crate) length: usize,
  /// Row width in bytes (`8` or `16`).
  pub(crate) bytes_per_row: usize,
  /// Optional byte order override (`little` or `big`).
  pub(crate) endian: Option<&'a str>,
  /// Optional cursor address decoded by the data inspector.
  pub(crate) inspect_address: Option<&'a str>,
  /// Selected byte span length reported in the response.
  pub(crate) selection_length: usize,
}

/// Formats loaded bytes and symbols inside `[slice_start, slice_end]` into aligned hex rows.
fn build_hex_chunk(
  block: &MemoryBlockInfo,
  slice_start: &str,
  slice_end: &str,
  raw_bytes: &[u8],
  bytes_per_row: usize,
  symbols_by_address: &HashMap<String, String>,
  default_space: &str,
) -> HexChunk {
  let bytes_per_row = if bytes_per_row == 8 { 8 } else { 16 };
  let default_space = if default_space.is_empty() {
    "ram"
  } else {
    default_space
  };

  let (Some(block_start), Some(block_end), Some(req_start), Some(req_end)) = (
    parse_address(&block.start, default_space),
    parse_address(&block.end, default_space),
    parse_address(slice_start, default_space),
    parse_address(slice_end, default_space),
  ) else {
    return HexChunk {
      block: block.clone(),
      row_start: slice_start.to_owned(),
      start: slice_start.to_owned(),
      end: slice_end.to_owned(),
      byte_length: 0,
      bytes_per_row,
      rows: Vec::new(),
    };
  };

  let effective_start_offset = req_start.offset.max(block_start.offset);
  let effective_end_offset = req_end.offset.min(block_end.offset);
  let start_addr = format_address(
    &block_start.space,
    effective_start_offset,
    block_start.width,
  );
  let end_addr = format_address(
    &block_start.space,
    effective_end_offset.max(effective_start_offset),
    block_start.width,
  );
  let row_start = align_row_address(&start_addr, bytes_per_row as u64);
  let row_start_offset =
    parse_address(&row_start, &block_start.space).map_or(effective_start_offset, |p| p.offset);
  let last_row = align_row_address(&end_addr, bytes_per_row as u64);
  let last_row_offset =
    parse_address(&last_row, &block_start.space).map_or(effective_end_offset, |p| p.offset);

  let expected_slice_len = if effective_end_offset >= effective_start_offset {
    (effective_end_offset - effective_start_offset + 1) as usize
  } else {
    0
  };

  let mut symbols_by_canon = HashMap::new();
  for (k, name) in symbols_by_address {
    symbols_by_canon
      .entry(canonical_key(k, &block_start.space))
      .or_insert_with(|| name.clone());
  }

  let mut rows = Vec::new();
  let mut cursor_opt = Some(row_start_offset);
  while let Some(cursor_offset) = cursor_opt {
    if cursor_offset > last_row_offset {
      break;
    }
    let row_address = format_address(&block_start.space, cursor_offset, block_start.width);
    let mut first_in_block_address = String::new();
    let mut cells = Vec::with_capacity(bytes_per_row);

    for col in 0..bytes_per_row {
      let Some(cell_offset) = cursor_offset.checked_add(col as u64) else {
        cells.push(HexCell {
          offset_in_row: col,
          address: None,
          value: None,
          in_block: false,
          symbol: None,
        });
        continue;
      };
      let cell_address = format_address(&block_start.space, cell_offset, block_start.width);
      let in_block = address_in_range(&cell_address, &block.start, &block.end);
      if !in_block {
        cells.push(HexCell {
          offset_in_row: col,
          address: None,
          value: None,
          in_block: false,
          symbol: None,
        });
        continue;
      }
      if first_in_block_address.is_empty() {
        first_in_block_address = cell_address.clone();
      }
      let value = if block.initialized && cell_offset >= effective_start_offset {
        let rel = (cell_offset - effective_start_offset) as usize;
        raw_bytes.get(rel).copied()
      } else {
        None
      };
      let cell_canon = format!("{}:{cell_offset:x}", block_start.space.to_ascii_lowercase());
      let sym = symbols_by_canon.get(&cell_canon).cloned();
      cells.push(HexCell {
        offset_in_row: col,
        address: Some(cell_address),
        value,
        in_block: true,
        symbol: sym,
      });
    }
    rows.push(HexRow {
      row_address: row_address.clone(),
      first_in_block_address: if first_in_block_address.is_empty() {
        row_address
      } else {
        first_in_block_address
      },
      cells,
    });
    cursor_opt = cursor_offset.checked_add(bytes_per_row as u64);
  }

  let byte_length = if block.initialized {
    if raw_bytes.is_empty() {
      expected_slice_len
    } else {
      expected_slice_len.min(raw_bytes.len())
    }
  } else {
    expected_slice_len
  };

  HexChunk {
    block: block.clone(),
    row_start,
    start: start_addr,
    end: end_addr,
    byte_length,
    bytes_per_row,
    rows,
  }
}

/// Computes the previous or next memory window start address across block boundaries.
fn step_chunk_address(
  blocks: &[MemoryBlockInfo],
  current_start: &str,
  chunk_bytes: usize,
  direction: i32,
) -> Option<String> {
  let Some(block) = find_memory_block(blocks, current_start) else {
    return if direction > 0 {
      blocks.first().map(|b| b.start.clone())
    } else {
      blocks.last().map(|b| b.start.clone())
    };
  };
  let cur = parse_address(current_start, "ram")?;
  let start = parse_address(&block.start, &cur.space)?;
  let end = parse_address(&block.end, &cur.space)?;
  let step = chunk_bytes as u64;

  if direction > 0 {
    if let Some(next) = cur.offset.checked_add(step)
      && next <= end.offset
    {
      return Some(format_address(&cur.space, next, cur.width));
    }
    return adjacent_memory_block(blocks, current_start, 1).map(|b| b.start.clone());
  }

  if cur.offset > start.offset {
    let prev = cur.offset.saturating_sub(step);
    return Some(if prev >= start.offset {
      format_address(&cur.space, prev, cur.width)
    } else {
      block.start.clone()
    });
  }

  let prev_block = adjacent_memory_block(blocks, current_start, -1)?;
  let (Some(prev_start), Some(prev_end)) = (
    parse_address(&prev_block.start, &cur.space),
    parse_address(&prev_block.end, &cur.space),
  ) else {
    return Some(prev_block.start.clone());
  };
  let last_window_start = (prev_end.offset as i128) + 1 - (chunk_bytes as i128);
  if last_window_start > prev_start.offset as i128 {
    Some(format_address(
      &prev_start.space,
      last_window_start as u64,
      prev_start.width,
    ))
  } else {
    Some(prev_block.start.clone())
  }
}

/// Extracts up to `max_len` contiguous optional byte values starting at `start_addr` from `chunk`.
fn collect_bytes_from_chunk(chunk: &HexChunk, start_addr: &str, max_len: usize) -> Vec<Option<u8>> {
  if parse_address(start_addr, "ram").is_none() {
    return Vec::new();
  }
  let mut flat: HashMap<String, Option<u8>> = HashMap::new();
  for row in &chunk.rows {
    for cell in &row.cells {
      if cell.in_block
        && let Some(addr) = &cell.address
      {
        flat.insert(canonical_key(addr, "ram"), cell.value);
      }
    }
  }
  let mut result = Vec::with_capacity(max_len);
  for i in 0..max_len {
    let Some(addr) = add_address_offset(start_addr, i as i128) else {
      break;
    };
    let Some(&val) = flat.get(&canonical_key(&addr, "ram")) else {
      break;
    };
    result.push(val);
    if val.is_none() {
      break;
    }
  }
  result
}

/// Fetches a bounded memory window, nearby symbols, and decoded inspector entries.
pub(crate) async fn memory_window(
  backend: &McpBackend,
  cache: &ProgramMetaCache,
  req: MemoryWindowRequest<'_>,
) -> Result<Value> {
  let meta = get_or_load_meta(backend, cache, req.md5).await?;
  let bytes_per_row = if req.bytes_per_row == 8 { 8 } else { 16 };
  let chunk_bytes = if req.length == 0 {
    DEFAULT_HEX_CHUNK_BYTES
  } else {
    req.length.min(16384)
  };
  let endian = match req.endian {
    Some(e) if e.eq_ignore_ascii_case("big") => "big".to_owned(),
    Some(e) if e.eq_ignore_ascii_case("little") => "little".to_owned(),
    _ => meta.endian.clone(),
  };

  let mut target_addr = req
    .address
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(str::to_owned)
    .or_else(|| meta.default_address.clone())
    .or_else(|| meta.blocks.first().map(|b| b.start.clone()))
    .unwrap_or_default();

  let block = find_memory_block(&meta.blocks, &target_addr)
    .or_else(|| meta.blocks.first())
    .cloned()
    .context("Program has no memory blocks.")?;

  if !address_in_range(&target_addr, &block.start, &block.end) {
    target_addr = block.start.clone();
  }

  let aligned = align_row_address(&target_addr, bytes_per_row as u64);
  let slice_start = clamp_address(&aligned, &block.start, &block.end);
  let raw_slice_end = add_address_offset(&slice_start, (chunk_bytes.saturating_sub(1)) as i128)
    .unwrap_or_else(|| block.end.clone());
  let slice_end = if compare_addresses(&raw_slice_end, &block.end) == Ordering::Greater {
    block.end.clone()
  } else {
    raw_slice_end
  };

  let read_length = match (
    parse_address(&slice_start, &meta.default_space),
    parse_address(&slice_end, &meta.default_space),
  ) {
    (Some(s), Some(e)) if e.offset >= s.offset => {
      ((e.offset - s.offset + 1) as usize).clamp(1, chunk_bytes)
    }
    _ => 256,
  };

  // Fetch bytes only when initialized; skip `memory.read` for uninitialized blocks.
  let raw_bytes = if block.initialized {
    let mem_res = backend
      .call(
        "memory",
        "read",
        Some(&meta.md5),
        json!({
          "selector": { "address": slice_start },
          "encoding": "hex",
          "length": read_length,
        }),
      )
      .await?;
    decode_bytes_vec(&mem_res["bytes"])
  } else {
    Vec::new()
  };

  let sym_res = backend
    .call(
      "symbol",
      "list",
      Some(&meta.md5),
      json!({
        "page": { "limit": 200 },
        "scan": { "range": { "start": slice_start, "end": slice_end }, "timeout_ms": 8000 }
      }),
    )
    .await
    .ok();
  let mut symbols_by_address = HashMap::new();
  if let Some(items) = sym_res
    .as_ref()
    .and_then(|v| v.get("items"))
    .and_then(Value::as_array)
  {
    for sym in items {
      let addr = value_str(&sym["address"]);
      let name = value_str(&sym["name"]);
      if !addr.is_empty() && !name.is_empty() {
        symbols_by_address.entry(addr).or_insert(name);
      }
    }
  }

  let chunk = build_hex_chunk(
    &block,
    &slice_start,
    &slice_end,
    &raw_bytes,
    bytes_per_row,
    &symbols_by_address,
    &meta.default_space,
  );

  let selected_address = req
    .inspect_address
    .map(str::trim)
    .filter(|s| !s.is_empty() && address_in_range(s, &chunk.start, &chunk.end))
    .map(str::to_owned)
    .unwrap_or_else(|| {
      if address_in_range(&target_addr, &chunk.start, &chunk.end) {
        target_addr
      } else {
        chunk.start.clone()
      }
    });

  let cursor_bytes = collect_bytes_from_chunk(&chunk, &selected_address, 32);
  let inspector = decode_data_inspector(
    &cursor_bytes,
    &endian,
    meta.address_size_bits,
    &meta.blocks,
    &meta.default_space,
    meta.address_width,
  );

  let has_prev = meta
    .blocks
    .first()
    .is_some_and(|first| compare_addresses(&chunk.start, &first.start) == Ordering::Greater);
  let has_next = meta
    .blocks
    .last()
    .is_some_and(|last| compare_addresses(&chunk.end, &last.end) == Ordering::Less);
  let prev_address = step_chunk_address(&meta.blocks, &chunk.start, chunk_bytes, -1);
  let next_address = step_chunk_address(&meta.blocks, &chunk.start, chunk_bytes, 1);

  Ok(json!({
    "md5": meta.md5,
    "programName": meta.program_name,
    "endian": endian,
    "addressSizeBits": meta.address_size_bits,
    "defaultSpace": meta.default_space,
    "addressWidth": meta.address_width,
    "blocks": meta.blocks,
    "selectedAddress": selected_address,
    "selectionLength": req.selection_length.max(1),
    "chunk": chunk,
    "inspector": inspector,
    "hasPrev": has_prev,
    "hasNext": has_next,
    "prevAddress": prev_address,
    "nextAddress": next_address,
  }))
}
