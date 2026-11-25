// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Control-flow graph and bounded call-graph queries.

/// Bounded caller and callee neighborhood builder.
mod call_graph;
/// Function basic-block control-flow graph builder.
mod cfg;

use std::collections::HashMap;

use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::backend::{McpBackend, list_operation};
use crate::views::symbol_display_name;

pub(crate) use call_graph::{CallExpansion, CallGraphRequest, call_graph_with_cache};
pub(crate) use cfg::control_flow_graph;

/// One backend query inside a `batch_query` call.
pub(super) struct BatchRequest {
  /// Caller-assigned identifier returned in the batch response map.
  pub(super) id: String,
  /// Backend domain name.
  pub(super) domain: &'static str,
  /// Backend operation name inside `domain`.
  pub(super) operation: &'static str,
  /// Full `domain.operation` method name sent to `batch.execute`.
  pub(super) method: &'static str,
  /// JSON argument object for the operation.
  pub(super) params: Value,
  /// Whether to paginate all pages instead of sending a single call.
  pub(super) all: bool,
}

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

/// Resolves a function entry string from `entry_opt` or by querying `address.resolve`.
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
      "address",
      "resolve",
      Some(md5),
      json!({ "selector": { "address": address } }),
    )
    .await?;
  if let Some(entry) = resolved
    .pointer("/function/entry")
    .and_then(Value::as_str)
    .map(str::trim)
    .filter(|s| !s.is_empty())
  {
    return Ok(entry.to_owned());
  }
  bail!("No function contains {address}. Use Listing or bytes to inspect this address.");
}

/// Runs one `BatchRequest` directly through `list_operation` or `McpBackend::call`.
async fn execute_single_request(
  backend: &McpBackend,
  md5: &str,
  req: &BatchRequest,
) -> Result<Value> {
  if req.all {
    let items = list_operation(backend, req.domain, req.operation, md5, req.params.clone()).await?;
    Ok(json!({ "items": items }))
  } else {
    backend
      .call(req.domain, req.operation, Some(md5), req.params.clone())
      .await
  }
}

/// Executes many read requests via `batch.execute` with direct fallback for failures or partial pages.
pub(super) async fn batch_query(
  backend: &McpBackend,
  md5: &str,
  requests: &[BatchRequest],
) -> Result<HashMap<String, Value>> {
  let mut results = HashMap::new();
  if requests.is_empty() {
    return Ok(results);
  }
  if requests.len() == 1 {
    let req = &requests[0];
    let value = execute_single_request(backend, md5, req).await?;
    results.insert(req.id.clone(), value);
    return Ok(results);
  }

  for chunk in requests.chunks(1000) {
    let by_id: HashMap<&str, &BatchRequest> =
      chunk.iter().map(|req| (req.id.as_str(), req)).collect();
    let batch_items: Vec<Value> = chunk
      .iter()
      .map(|req| {
        json!({
          "id": req.id,
          "method": req.method,
          "arguments": req.params,
        })
      })
      .collect();
    let mut fallback: Vec<&BatchRequest> = Vec::new();
    match backend
      .call(
        "batch",
        "execute",
        Some(md5),
        json!({ "transaction_mode": "per_item", "items": batch_items }),
      )
      .await
    {
      Ok(batch) => {
        let mut seen = std::collections::HashSet::new();
        if let Some(returned) = batch.get("items").and_then(Value::as_array) {
          for entry in returned {
            let Some(id) = entry.get("id").and_then(Value::as_str) else {
              continue;
            };
            let Some(&req) = by_id.get(id) else {
              continue;
            };
            seen.insert(id.to_owned());
            let has_error = entry.get("error").is_some_and(|e| !e.is_null());
            let result = entry.get("result").filter(|v| v.is_object());
            let incomplete_page = result.is_some_and(|res| {
              req.all
                && res
                  .get("next_cursor")
                  .and_then(Value::as_str)
                  .is_some_and(|c| !c.is_empty())
            });
            if !has_error
              && !incomplete_page
              && let Some(res) = result
            {
              results.insert(id.to_owned(), res.clone());
            } else {
              fallback.push(req);
            }
          }
        }
        for req in chunk {
          if !seen.contains(req.id.as_str()) {
            fallback.push(req);
          }
        }
      }
      Err(_) => {
        fallback.extend(chunk);
      }
    }
    for req in fallback {
      let value = execute_single_request(backend, md5, req).await?;
      results.insert(req.id.clone(), value);
    }
  }
  Ok(results)
}
