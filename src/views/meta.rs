// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Cached program metadata loading and target symbol or address resolution.

use std::collections::HashSet;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use super::format::{extract_batch_items, full_symbol_name, opt_nonempty_str, symbol_display_name};
use super::{CachedProgramMeta, ProgramFunctionMeta, ProgramMetaCache, RawFunctionMeta};
use crate::address::{
  MemoryBlockInfo, add_address_offset, display_address, find_memory_block, format_address,
  parse_address, parse_memory_blocks, same_address,
};
use crate::backend::McpBackend;

/// Follows any remaining `next_cursor` pages after an initial batch response page.
async fn finish_paginated_list(
  backend: &McpBackend,
  domain: &str,
  operation: &str,
  md5: &str,
  initial: Option<&Value>,
  mut params: Value,
) -> Result<Vec<Value>> {
  let Some(first) = initial else {
    return Ok(Vec::new());
  };
  let mut items = first
    .get("items")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let mut cursor_opt = opt_nonempty_str(first.get("next_cursor"));
  let mut seen = HashSet::new();
  while let Some(cursor) = cursor_opt {
    if !seen.insert(cursor.clone()) {
      bail!("backend repeated a pagination cursor");
    }
    params["page"] = json!({ "cursor": cursor, "limit": 1000 });
    let page = backend
      .call(domain, operation, Some(md5), params.clone())
      .await?;
    if let Some(more) = page.get("items").and_then(Value::as_array) {
      items.extend(more.iter().cloned());
    }
    cursor_opt = opt_nonempty_str(page.get("next_cursor"));
  }
  Ok(items)
}

/// Chooses the default initial view address from memory blocks, functions, or program bounds.
fn pick_default_address(
  blocks: &[MemoryBlockInfo],
  functions: &[RawFunctionMeta],
  program: &Value,
) -> Option<String> {
  let is_text =
    |name: &str| name.eq_ignore_ascii_case(".text") || name.eq_ignore_ascii_case("text");
  let preferred = blocks
    .iter()
    .find(|b| b.initialized && b.execute && !b.overlay && is_text(&b.name))
    .or_else(|| {
      blocks
        .iter()
        .find(|b| b.initialized && b.execute && !b.overlay)
    })
    .or_else(|| {
      blocks
        .iter()
        .find(|b| b.initialized && b.read && !b.overlay)
    })
    .or_else(|| blocks.iter().find(|b| b.initialized))
    .or_else(|| blocks.first());
  if let Some(b) = preferred
    && !b.start.is_empty()
  {
    return Some(b.start.clone());
  }
  if let Some(first_fn) = functions.first() {
    return Some(first_fn.entry.clone());
  }
  opt_nonempty_str(program.get("min_address"))
    .or_else(|| opt_nonempty_str(program.get("image_base")))
}

/// Returns cached program metadata for `md5` or fetches and indexes it in one batch wave.
pub(crate) async fn get_or_load_meta(
  backend: &McpBackend,
  cache: &ProgramMetaCache,
  md5: &str,
) -> Result<CachedProgramMeta> {
  let md5_lower = md5.to_ascii_lowercase();
  if let Some(cached) = cache.get(&md5_lower).await {
    return Ok(cached);
  }

  let fn_params = json!({
    "page": { "limit": 1000 },
    "scan": { "timeout_ms": 60000 },
    "projection": { "fields": ["entry", "name", "namespace", "demangled_name"] }
  });
  let batch_params = json!({
    "transaction_mode": "per_item",
    "items": [
      { "id": "program", "method": "program.get", "arguments": {} },
      { "id": "language", "method": "program_language.get", "arguments": {} },
      { "id": "blocks", "method": "memory_block.list", "arguments": { "page": { "limit": 1000 } } },
      { "id": "spaces", "method": "address_space.list", "arguments": { "page": { "limit": 1000 } } },
      { "id": "functions", "method": "function.list", "arguments": fn_params.clone() }
    ]
  });

  let batch_res = backend
    .call("batch", "execute", Some(&md5_lower), batch_params)
    .await?;
  let items_map = extract_batch_items(&batch_res);

  let program = items_map
    .get("program")
    .cloned()
    .unwrap_or_else(|| json!({}));
  let language = items_map
    .get("language")
    .cloned()
    .unwrap_or_else(|| json!({}));

  let raw_blocks = finish_paginated_list(
    backend,
    "memory",
    "block.list",
    &md5_lower,
    items_map.get("blocks"),
    json!({ "page": { "limit": 1000 } }),
  )
  .await?;
  let spaces = finish_paginated_list(
    backend,
    "address",
    "space.list",
    &md5_lower,
    items_map.get("spaces"),
    json!({ "page": { "limit": 1000 } }),
  )
  .await?;
  let raw_fns = finish_paginated_list(
    backend,
    "function",
    "list",
    &md5_lower,
    items_map.get("functions"),
    fn_params,
  )
  .await?;

  let blocks = parse_memory_blocks(&raw_blocks);
  let default_space_obj = spaces
    .iter()
    .find(|s| s.get("default").and_then(Value::as_bool) == Some(true))
    .or_else(|| spaces.first());
  let default_space = default_space_obj
    .and_then(|s| s.get("name"))
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .map(str::to_owned)
    .or_else(|| {
      blocks
        .first()
        .and_then(|b| parse_address(&b.start, "ram"))
        .map(|p| p.space)
    })
    .unwrap_or_else(|| "ram".to_owned());

  let address_size_bits = language
    .get("address_size")
    .and_then(Value::as_u64)
    .filter(|&n| n > 0)
    .or_else(|| {
      default_space_obj
        .and_then(|s| s.get("size"))
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
    })
    .unwrap_or(64);

  let endian = if language
    .get("endian")
    .and_then(Value::as_str)
    .is_some_and(|e| e.eq_ignore_ascii_case("big"))
  {
    "big".to_owned()
  } else {
    "little".to_owned()
  };

  let sample_addr = blocks
    .first()
    .map(|b| b.start.as_str())
    .filter(|s| !s.is_empty())
    .or_else(|| {
      program
        .get("image_base")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    })
    .or_else(|| {
      program
        .get("min_address")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    });
  let address_width = sample_addr
    .and_then(|addr| parse_address(addr, &default_space))
    .map(|p| p.width)
    .filter(|&w| w > 0)
    .unwrap_or_else(|| ((address_size_bits as usize).div_ceil(4)).max(8));

  let program_name = opt_nonempty_str(program.get("name")).unwrap_or_else(|| md5_lower.clone());

  let functions: Vec<RawFunctionMeta> = raw_fns
    .into_iter()
    .filter_map(|fn_val| {
      let entry = opt_nonempty_str(fn_val.get("entry"))?;
      Some(RawFunctionMeta {
        entry,
        name: fn_val
          .get("name")
          .and_then(Value::as_str)
          .unwrap_or("")
          .to_owned(),
        namespace: fn_val
          .get("namespace")
          .and_then(Value::as_str)
          .unwrap_or("")
          .to_owned(),
        demangled_name: opt_nonempty_str(fn_val.get("demangled_name")),
      })
    })
    .collect();

  let default_address = pick_default_address(&blocks, &functions, &program);
  let meta = CachedProgramMeta {
    md5: md5_lower.clone(),
    program_name,
    endian,
    address_size_bits,
    default_space,
    address_width,
    blocks,
    default_address,
    functions,
  };
  cache.insert(&md5_lower, meta.clone()).await;
  Ok(meta)
}

/// Returns cached program metadata, blocks, default address, and display function list for `md5`.
pub(crate) async fn program_meta(
  backend: &McpBackend,
  cache: &ProgramMetaCache,
  md5: &str,
  show_template_arguments: bool,
) -> Result<Value> {
  let meta = get_or_load_meta(backend, cache, md5).await?;
  let functions: Vec<ProgramFunctionMeta> = meta
    .functions
    .iter()
    .map(|f| ProgramFunctionMeta {
      entry: f.entry.clone(),
      name: f.name.clone(),
      namespace: f.namespace.clone(),
      demangled_name: f.demangled_name.clone(),
      display_name: symbol_display_name(
        &f.name,
        &f.namespace,
        f.demangled_name.as_deref(),
        true,
        show_template_arguments,
      ),
    })
    .collect();

  Ok(json!({
    "md5": meta.md5,
    "programName": meta.program_name,
    "endian": meta.endian,
    "addressSizeBits": meta.address_size_bits,
    "defaultSpace": meta.default_space,
    "addressWidth": meta.address_width,
    "blocks": meta.blocks,
    "defaultAddress": meta.default_address,
    "functions": functions,
  }))
}

/// Parses a relative `+offset` or `-offset` expression in decimal or hexadecimal.
fn parse_relative_offset(input: &str) -> Option<i128> {
  let s = input.trim();
  let (neg, rest) = if let Some(r) = s.strip_prefix('+') {
    (false, r.trim_start())
  } else {
    let r = s.strip_prefix('-')?;
    (true, r.trim_start())
  };
  let mag = if let Some(hex) = rest.strip_prefix("0x").or_else(|| rest.strip_prefix("0X")) {
    if hex.is_empty() || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
      return None;
    }
    u64::from_str_radix(hex, 16).ok()?
  } else {
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
      return None;
    }
    rest.parse::<u64>().ok()?
  };
  Some(if neg { -(mag as i128) } else { mag as i128 })
}

/// Checks whether `input` starts with `0x` or an address-space prefix `space:`.
fn has_space_prefix_or_0x(input: &str) -> bool {
  if input.len() >= 2 && input[..2].eq_ignore_ascii_case("0x") {
    return true;
  }
  if let Some(colon) = input.find(':') {
    let prefix = &input[..colon];
    return !prefix.is_empty()
      && (prefix.as_bytes()[0].is_ascii_alphabetic() || prefix.as_bytes()[0] == b'_')
      && prefix
        .bytes()
        .skip(1)
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.');
  }
  false
}

/// Checks whether `input` looks like an unprefixed 4-to-16 digit hexadecimal offset.
fn looks_like_bare_hex(input: &str) -> bool {
  (4..=16).contains(&input.len()) && input.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Builds the resolved-target response object for `address` and optional containing `entry`.
fn format_resolved_target(
  meta: &CachedProgramMeta,
  address: String,
  entry: Option<String>,
) -> Value {
  let block = find_memory_block(&meta.blocks, &address).cloned();
  let resolved_entry = entry.or_else(|| {
    meta
      .functions
      .iter()
      .find(|f| same_address(&f.entry, &address))
      .map(|f| f.entry.clone())
  });
  json!({
    "md5": meta.md5,
    "address": address,
    "displayAddress": display_address(&address),
    "block": block,
    "entry": resolved_entry,
  })
}

/// Queries `address.resolve` on `backend` and returns `(address, function_entry)` if in memory.
async fn try_resolve_address(
  backend: &McpBackend,
  md5: &str,
  address: &str,
) -> Option<(String, Option<String>)> {
  let resolved = backend
    .call(
      "address",
      "resolve",
      Some(md5),
      json!({ "selector": { "address": address } }),
    )
    .await
    .ok()?;
  if resolved.get("valid").and_then(Value::as_bool) == Some(false)
    || resolved.get("in_memory").and_then(Value::as_bool) == Some(false)
  {
    return None;
  }
  let addr = opt_nonempty_str(resolved.get("address")).unwrap_or_else(|| address.to_owned());
  let entry = opt_nonempty_str(resolved.pointer("/function/entry"));
  Some((addr, entry))
}

/// Resolves a user navigation string (relative offset, address, or symbol name) in `md5`.
pub(crate) async fn resolve_target(
  backend: &McpBackend,
  cache: &ProgramMetaCache,
  md5: &str,
  input: &str,
  current_address: Option<&str>,
) -> Result<Value> {
  let meta = get_or_load_meta(backend, cache, md5).await?;
  let trimmed = input.trim();

  if trimmed.is_empty() {
    let addr = current_address
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .map(str::to_owned)
      .or_else(|| meta.default_address.clone())
      .context("No target address available in program")?;
    return Ok(format_resolved_target(&meta, addr, None));
  }

  if let Some(delta) = parse_relative_offset(trimmed)
    && let Some(cur) = current_address.map(str::trim).filter(|s| !s.is_empty())
  {
    let target = add_address_offset(cur, delta)
      .with_context(|| format!("Invalid relative offset: {trimmed}"))?;
    if !meta.blocks.is_empty() && find_memory_block(&meta.blocks, &target).is_none() {
      bail!(
        "Address {} is not in program memory",
        display_address(&target)
      );
    }
    let entry = try_resolve_address(backend, &meta.md5, &target)
      .await
      .and_then(|(_, e)| e);
    return Ok(format_resolved_target(&meta, target, entry));
  }

  if let Some(parsed) = parse_address(trimmed, &meta.default_space)
    && (has_space_prefix_or_0x(trimmed) || looks_like_bare_hex(trimmed))
  {
    let candidate = format_address(&parsed.space, parsed.offset, meta.address_width);
    if let Some((addr, entry)) = try_resolve_address(backend, &meta.md5, &candidate).await {
      return Ok(format_resolved_target(&meta, addr, entry));
    }
    if find_memory_block(&meta.blocks, &candidate).is_some() {
      return Ok(format_resolved_target(&meta, candidate, None));
    }
    if has_space_prefix_or_0x(trimmed) {
      bail!("Address {trimmed} is not in program memory");
    }
  }

  if let Some((addr, entry)) = try_resolve_address(backend, &meta.md5, trimmed).await {
    return Ok(format_resolved_target(&meta, addr, entry));
  }

  let (sym_res, fn_res) = tokio::join!(
    backend.call(
      "symbol",
      "list",
      Some(&meta.md5),
      json!({ "filter": { "name": trimmed }, "page": { "limit": 10 } }),
    ),
    backend.call(
      "function",
      "list",
      Some(&meta.md5),
      json!({ "filter": { "name": trimmed }, "page": { "limit": 10 } }),
    )
  );

  if let Ok(sym_val) = sym_res
    && let Some(items) = sym_val.get("items").and_then(Value::as_array)
  {
    let pick = items
      .iter()
      .find(|s| {
        s.get("name").and_then(Value::as_str) == Some(trimmed)
          && opt_nonempty_str(s.get("address")).is_some()
      })
      .or_else(|| {
        items.iter().find(|s| {
          s.get("name")
            .and_then(Value::as_str)
            .is_some_and(|n| n.eq_ignore_ascii_case(trimmed))
            && opt_nonempty_str(s.get("address")).is_some()
        })
      })
      .or_else(|| {
        items
          .iter()
          .find(|s| opt_nonempty_str(s.get("address")).is_some())
      });
    if let Some(sym) = pick
      && let Some(addr) = opt_nonempty_str(sym.get("address"))
    {
      let entry = sym
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|k| k.eq_ignore_ascii_case("function"))
        .then(|| addr.clone());
      return Ok(format_resolved_target(&meta, addr, entry));
    }
  }

  if let Ok(fn_val) = fn_res
    && let Some(items) = fn_val.get("items").and_then(Value::as_array)
  {
    let pick = items
      .iter()
      .find(|f| {
        f.get("name").and_then(Value::as_str) == Some(trimmed)
          && opt_nonempty_str(f.get("entry")).is_some()
      })
      .or_else(|| {
        items.iter().find(|f| {
          f.get("name")
            .and_then(Value::as_str)
            .is_some_and(|n| n.eq_ignore_ascii_case(trimmed))
            && opt_nonempty_str(f.get("entry")).is_some()
        })
      })
      .or_else(|| {
        items
          .iter()
          .find(|f| opt_nonempty_str(f.get("entry")).is_some())
      });
    if let Some(f) = pick
      && let Some(entry) = opt_nonempty_str(f.get("entry"))
    {
      return Ok(format_resolved_target(&meta, entry.clone(), Some(entry)));
    }
  }

  let needle = trimmed.to_ascii_lowercase();
  let demangled_match = meta
    .functions
    .iter()
    .find(|f| {
      let full = full_symbol_name(&f.name, &f.namespace, f.demangled_name.as_deref(), true)
        .to_ascii_lowercase();
      let raw = f.name.to_ascii_lowercase();
      full == needle || raw == needle
    })
    .or_else(|| {
      meta.functions.iter().find(|f| {
        full_symbol_name(&f.name, &f.namespace, f.demangled_name.as_deref(), true)
          .to_ascii_lowercase()
          .contains(&needle)
      })
    });
  if let Some(f) = demangled_match {
    let addr = parse_address(&f.entry, &meta.default_space)
      .map(|p| format_address(&p.space, p.offset, meta.address_width))
      .unwrap_or_else(|| f.entry.clone());
    return Ok(format_resolved_target(&meta, addr, Some(f.entry.clone())));
  }

  bail!("Address or symbol \"{trimmed}\" not found in program memory");
}
