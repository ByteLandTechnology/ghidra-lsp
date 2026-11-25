// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Comment, function prototype, parameter, and local variable mutation planning.

/// Function prototype, parameter, and local variable batch mutation compiler.
mod prototype;

use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};

pub(crate) use self::prototype::{
  execute_ops, function_prototype, prepare_function_prototype_ops, prepare_variables_ops,
};
use crate::address::{display_address, same_address};
use crate::backend::{McpBackend, list_operation};
use crate::workbench;

/// Canonical list of all five Ghidra comment types in fixed order.
const COMMENT_KINDS: [&str; 5] = ["plate", "pre", "eol", "post", "repeatable"];

/// Optimistic conflict error returned when a comment changed concurrently in Ghidra.
const CONFLICT_COMMENT: &str =
  "This comment changed outside the editor. Close and reopen the comments before saving.";

/// Optimistic conflict error returned when a function changed concurrently in Ghidra.
const CONFLICT_FORM: &str = "The analysis changed while this form was open. Close and reopen the form to review current data before saving.";

/// Prepared comment upsert, delete, or no-op mutation derived after conflict checking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PreparedCommentMutation {
  /// Canonical target code-unit address.
  pub(crate) address: String,
  /// Normalized lowercase comment kind (`plate`, `pre`, `eol`, `post`, or `repeatable`).
  pub(crate) kind: String,
  /// MCP comment operation name (`upsert`, `delete`, or `noop`).
  operation: &'static str,
  /// JSON argument object passed to the backend when `changed` is true.
  params: Value,
  /// Comment text persisted on success (empty string on delete).
  pub(crate) saved_text: String,
  /// Whether a backend mutation needs to run.
  pub(crate) changed: bool,
}

/// Fetches all comments at `address` inside session `md5` across all pages.
async fn paginate_comment_list(
  backend: &McpBackend,
  md5: &str,
  address: &str,
) -> Result<Vec<Value>> {
  let params = json!({
    "scan": {
      "range": { "start": address, "end": address },
      "timeout_ms": 30000
    }
  });
  list_operation(backend, "comment", "list", md5, params).await
}

/// Fetches all five comment kinds at `address` inside session `md5`.
pub(crate) async fn comments_at(backend: &McpBackend, md5: &str, address: &str) -> Result<Value> {
  let address = address.trim();
  ensure!(!address.is_empty(), "Comment address is required.");
  let items = paginate_comment_list(backend, md5, address).await?;
  let mut comments = Map::from_iter(
    COMMENT_KINDS
      .iter()
      .map(|&kind| (kind.to_owned(), Value::String(String::new()))),
  );
  for item in items {
    if let Some(item_addr) = item.get("address").and_then(Value::as_str)
      && !same_address(item_addr, address)
    {
      continue;
    }
    let Some(kind) = item
      .get("type")
      .and_then(Value::as_str)
      .map(|k| k.trim().to_ascii_lowercase())
    else {
      continue;
    };
    if COMMENT_KINDS.contains(&kind.as_str())
      && comments
        .get(&kind)
        .and_then(Value::as_str)
        .is_some_and(str::is_empty)
    {
      let text = item.get("text").and_then(Value::as_str).unwrap_or("");
      comments.insert(kind, Value::String(text.to_owned()));
    }
  }
  Ok(json!({
    "md5": md5,
    "address": address,
    "displayAddress": display_address(address),
    "comments": Value::Object(comments),
  }))
}

/// Reads current comments at `address`, enforces `expected`, and plans upsert, delete, or no-op.
pub(crate) async fn prepare_comment_mutation(
  backend: &McpBackend,
  md5: &str,
  address: &str,
  kind: &str,
  text: &str,
  expected: Option<&str>,
) -> Result<PreparedCommentMutation> {
  let address = address.trim();
  ensure!(!address.is_empty(), "Comment address is required.");
  let kind_norm = kind.trim().to_ascii_lowercase();
  ensure!(
    COMMENT_KINDS.contains(&kind_norm.as_str()),
    "Unsupported comment kind: {kind}"
  );
  let current = comments_at(backend, md5, address).await?;
  let latest = current["comments"][&kind_norm].as_str().unwrap_or("");
  if let Some(exp) = expected {
    ensure!(latest == exp, "{CONFLICT_COMMENT}");
  }

  let is_delete = text.trim().is_empty();
  let saved_text = if is_delete {
    String::new()
  } else {
    text.to_owned()
  };
  if expected.is_some_and(|exp| exp == text) || (is_delete && latest.is_empty()) {
    return Ok(PreparedCommentMutation {
      address: address.to_owned(),
      kind: kind_norm,
      operation: "noop",
      params: Value::Null,
      saved_text,
      changed: false,
    });
  }

  let (operation, params) = if is_delete {
    (
      "delete",
      json!({ "selector": { "address": address, "type": kind_norm } }),
    )
  } else {
    (
      "upsert",
      json!({ "resource": { "address": address, "type": kind_norm, "text": text } }),
    )
  };
  Ok(PreparedCommentMutation {
    address: address.to_owned(),
    kind: kind_norm,
    operation,
    params,
    saved_text,
    changed: true,
  })
}

/// Applies `prepared` comment write against `backend` without persisting the Ghidra project.
pub(crate) async fn execute_comment_mutation(
  backend: &McpBackend,
  md5: &str,
  prepared: &PreparedCommentMutation,
) -> Result<Value> {
  if !prepared.changed {
    return Ok(json!({ "noop": true }));
  }
  let result = backend
    .call(
      "comment",
      prepared.operation,
      Some(md5),
      prepared.params.clone(),
    )
    .await
    .context(
      "Modification may have reached Ghidra; refresh and inspect the actual program state before retrying",
    )?;
  workbench::check_write_result("comment", prepared.operation, &result)?;
  Ok(result)
}
