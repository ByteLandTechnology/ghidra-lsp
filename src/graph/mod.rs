// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Control-flow graph and bounded call-graph queries.

/// Bounded caller and callee neighborhood builder.
mod call_graph;
/// Function basic-block control-flow graph builder.
mod cfg;

use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::backend::McpBackend;
use crate::views::symbol_display_name;

pub(crate) use call_graph::{CallExpansion, CallGraphRequest, call_graph_with_cache};
pub(crate) use cfg::control_flow_graph;

/// Normalizes a function entry address into a lowercase canonical graph node identifier.
pub(super) fn canonical_call_id(entry: &str) -> String {
  match entry.rsplit_once(':') {
    Some((prefix, offset)) => {
      let space = if prefix.eq_ignore_ascii_case("ram") {
        "ram"
      } else {
        prefix
      };
      format!("{space}:{}", offset.to_ascii_lowercase())
    }
    None => entry.to_ascii_lowercase(),
  }
}

/// Formats a qualified function display label from a symbol JSON record, or returns `fallback`.
pub(super) fn format_function_label(
  val: &Value,
  fallback: &str,
  show_template_arguments: bool,
) -> String {
  let name = val.get("name").and_then(Value::as_str).unwrap_or("");
  let namespace = val.get("namespace").and_then(Value::as_str).unwrap_or("");
  let demangled = val.get("demangled_name").and_then(Value::as_str);
  let formatted = symbol_display_name(name, namespace, demangled, true, show_template_arguments);
  if formatted.is_empty() {
    fallback.to_owned()
  } else {
    formatted
  }
}

/// Resolves a function entry string from `entry_opt` or from `function.get` with `selector.address`.
pub(super) async fn resolve_entry(
  backend: &McpBackend,
  md5: &str,
  entry_opt: Option<&str>,
  address_opt: Option<&str>,
) -> Result<String> {
  if let Some(entry) = entry_opt.map(str::trim).filter(|s| !s.is_empty()) {
    return Ok(entry.to_owned());
  }
  let Some(address) = address_opt.map(str::trim).filter(|s| !s.is_empty()) else {
    bail!("Function entry or address is required.");
  };
  let resolved = backend
    .call(
      "function",
      "get",
      Some(md5),
      json!({
        "selector": { "address": address },
        "projection": { "fields": ["entry"] }
      }),
    )
    .await;
  if let Ok(func) = resolved
    && let Some(entry) = func
      .get("entry")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|s| !s.is_empty())
  {
    return Ok(entry.to_owned());
  }
  bail!("No function contains {address}. Use Listing or bytes to inspect this address.");
}
