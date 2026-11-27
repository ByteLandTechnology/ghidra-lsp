// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! LSP custom command handlers for listing, memory, byte inspector, and graph views.

use std::sync::atomic::Ordering;

use anyhow::{Context, Result, bail};
use serde_json::Value;

use super::Server;
use crate::address::MemoryBlockInfo;
use crate::backend::McpBackend;
use crate::graph::{CallExpansion, CallGraphRequest, call_graph_with_cache, control_flow_graph};
use crate::views::{
  ListingWindowRequest, MemoryWindowRequest, inspect_bytes, listing_window, memory_window,
  program_meta, resolve_target,
};

/// Reads the optional `showTemplateArguments` flag or falls back to global display settings.
fn show_templates_option(arg: &Value) -> bool {
  arg
    .get("showTemplateArguments")
    .and_then(Value::as_bool)
    .unwrap_or_else(|| crate::document::SHOW_TEMPLATE_ARGUMENTS.load(Ordering::Relaxed))
}

/// Parses an optional `u64` JSON field into `usize` with `default` fallback.
fn usize_arg(arg: &Value, key: &str, default: usize) -> usize {
  arg
    .get(key)
    .and_then(Value::as_u64)
    .map_or(default, |n| usize::try_from(n).unwrap_or(usize::MAX))
}

impl Server {
  /// Dispatches bounded listing, memory, byte-inspector, and graph commands.
  pub(super) async fn execute_view_command(
    &self,
    command: &str,
    arg: Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    match command {
      "ghidra.programMeta" => {
        let md5 = self.scoped_md5(&arg)?;
        let show_template_arguments = show_templates_option(&arg);
        program_meta(backend, &self.view_cache, &md5, show_template_arguments).await
      }
      "ghidra.resolveTarget" => {
        let md5 = self.scoped_md5(&arg)?;
        let input = arg
          .get("input")
          .or_else(|| arg.get("target"))
          .and_then(Value::as_str)
          .unwrap_or("");
        let current_address = arg.get("currentAddress").and_then(Value::as_str);
        resolve_target(backend, &self.view_cache, &md5, input, current_address).await
      }
      "ghidra.listingWindow" => {
        let md5 = self.scoped_md5(&arg)?;
        let req = ListingWindowRequest {
          md5: &md5,
          address: arg.get("address").and_then(Value::as_str),
          cursor: arg.get("cursor").and_then(Value::as_str),
          limit: usize_arg(&arg, "limit", 160),
          show_template_arguments: show_templates_option(&arg),
          exact_start: arg
            .get("exactStart")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        };
        listing_window(backend, &self.view_cache, req).await
      }
      "ghidra.memoryWindow" => {
        let md5 = self.scoped_md5(&arg)?;
        let req = MemoryWindowRequest {
          md5: &md5,
          address: arg.get("address").and_then(Value::as_str),
          length: usize_arg(&arg, "length", 256),
          bytes_per_row: usize_arg(&arg, "bytesPerRow", 16),
          endian: arg.get("endian").and_then(Value::as_str),
          inspect_address: arg.get("inspectAddress").and_then(Value::as_str),
          selection_length: usize_arg(&arg, "selectionLength", 0),
        };
        memory_window(backend, &self.view_cache, req).await
      }
      "ghidra.inspectBytes" => self.handle_inspect_bytes(&arg, backend).await,
      "ghidra.controlFlowGraph" => {
        let md5 = self.scoped_md5(&arg)?;
        let entry = arg.get("entry").and_then(Value::as_str);
        let address = arg.get("address").and_then(Value::as_str);
        let show_template_arguments = show_templates_option(&arg);
        control_flow_graph(backend, &md5, entry, address, show_template_arguments).await
      }
      "ghidra.callGraph" => {
        let md5 = self.scoped_md5(&arg)?;
        let expansion = arg
          .get("expansion")
          .filter(|v| !v.is_null())
          .map(|v| serde_json::from_value::<CallExpansion>(v.clone()))
          .transpose()?;
        if arg.get("refresh").and_then(Value::as_bool) == Some(true) {
          self.view_cache.invalidate_call_graph(&md5).await;
        }
        let req = CallGraphRequest {
          md5: &md5,
          entry: arg.get("entry").and_then(Value::as_str),
          address: arg.get("address").and_then(Value::as_str),
          callers_depth: usize_arg(&arg, "callersDepth", 1),
          callees_depth: usize_arg(&arg, "calleesDepth", 1),
          expansion,
          show_template_arguments: show_templates_option(&arg),
        };
        call_graph_with_cache(backend, Some(&self.view_cache), req).await
      }
      _ => bail!("unknown command {command}"),
    }
  }

  /// Decodes raw bytes with optional metadata fallback for integer, pointer, and string views.
  async fn handle_inspect_bytes(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let bytes_arr = arg
      .get("bytes")
      .and_then(Value::as_array)
      .context("bytes array is required")?;
    let mut bytes = Vec::with_capacity(bytes_arr.len());
    for item in bytes_arr {
      if item.is_null() {
        bytes.push(None);
      } else if let Some(byte) = item.as_u64().and_then(|v| u8::try_from(v).ok()) {
        bytes.push(Some(byte));
      } else {
        bail!("bytes elements must be integers in 0..=255 or null");
      }
    }
    let explicit_blocks = arg
      .get("blocks")
      .filter(|v| !v.is_null())
      .map(|v| serde_json::from_value::<Vec<MemoryBlockInfo>>(v.clone()))
      .transpose()?;
    let need_meta = explicit_blocks.is_none()
      || arg.get("endian").and_then(Value::as_str).is_none()
      || arg.get("addressSizeBits").and_then(Value::as_u64).is_none()
      || arg.get("defaultSpace").and_then(Value::as_str).is_none()
      || arg.get("addressWidth").and_then(Value::as_u64).is_none();
    let meta = if need_meta && let Ok(md5) = self.scoped_md5(arg) {
      Some(program_meta(backend, &self.view_cache, &md5, false).await?)
    } else {
      None
    };
    let endian = arg
      .get("endian")
      .and_then(Value::as_str)
      .or_else(|| {
        meta
          .as_ref()
          .and_then(|m| m.get("endian").and_then(Value::as_str))
      })
      .unwrap_or("little");
    let address_size_bits = arg
      .get("addressSizeBits")
      .and_then(Value::as_u64)
      .or_else(|| {
        meta
          .as_ref()
          .and_then(|m| m.get("addressSizeBits").and_then(Value::as_u64))
      })
      .unwrap_or(64);
    let default_space = arg
      .get("defaultSpace")
      .and_then(Value::as_str)
      .or_else(|| {
        meta
          .as_ref()
          .and_then(|m| m.get("defaultSpace").and_then(Value::as_str))
      })
      .unwrap_or("ram");
    let address_width = usize::try_from(
      arg
        .get("addressWidth")
        .and_then(Value::as_u64)
        .or_else(|| {
          meta
            .as_ref()
            .and_then(|m| m.get("addressWidth").and_then(Value::as_u64))
        })
        .unwrap_or(8),
    )
    .unwrap_or(usize::MAX);
    let blocks = match explicit_blocks {
      Some(b) => b,
      None => match meta.as_ref().and_then(|m| m.get("blocks")) {
        Some(b) => serde_json::from_value(b.clone())?,
        None => Vec::new(),
      },
    };
    Ok(inspect_bytes(
      &bytes,
      endian,
      address_size_bits,
      &blocks,
      default_space,
      address_width,
    ))
  }
}
