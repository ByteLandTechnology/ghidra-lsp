// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Virtual `.ghidra-type` JSONC documents, validation, and save coordination.

/// UTF-16 range calculation, targeted JSONC edits, and save reconciliation.
mod edit;
/// Pure-Rust JSONC lexer, abstract syntax tree parser, and path lookup helpers.
mod jsonc;
/// Data-type model conversion, conflict equality checks, and JSONC rendering.
mod model;
/// Diffing and atomic MCP mutation planning for edited data-type models.
mod mutations;
/// Schema and field validation for edited `.ghidra-type` JSONC documents.
mod parse;

use std::fmt;

use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::Range;

use crate::backend::McpBackend;
use edit::{reconcile_type_text, utf16_range};
use jsonc::resolve_path_span;
use model::{readonly_type_reason, render_type_jsonc, same_type_data, type_model};
use mutations::type_mutations;
use parse::parse_type_jsonc;

/// Minimum integer represented without loss in IEEE-754 double-precision JSON numbers.
pub(super) const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;
/// Maximum integer represented without loss in IEEE-754 double-precision JSON numbers.
pub(super) const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
/// Maximum signed 32-bit integer accepted by Ghidra layout offsets and field lengths.
pub(super) const MAX_I32: i64 = 2_147_483_647;

/// Message returned when the backend copy changed since the draft was opened.
const CONFLICT_MESSAGE: &str = "This data type changed in Ghidra while you were editing. Your draft is preserved. Use Compare with Ghidra, then revert and reload before applying your changes.";
/// Prefix added to errors that occur after a write request has been sent to Ghidra.
const POST_SEND_WARNING: &str =
  "The save may have reached Ghidra; compare and reload before retrying";

/// Path step inside a JSONC document tree.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) enum PathSegment {
  /// Object property name.
  Key(String),
  /// Zero-based array element index.
  Index(usize),
}

impl Serialize for PathSegment {
  fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
    match self {
      PathSegment::Key(s) => serializer.serialize_str(s),
      PathSegment::Index(i) => serializer.serialize_u64(*i as u64),
    }
  }
}

/// Validation failure located by JSON path and optional explicit byte span.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(super) struct TypeEditError {
  /// Human-readable validation message.
  pub(super) message: String,
  /// JSON path to the invalid property or array element.
  pub(super) path: Vec<PathSegment>,
  /// Start byte offset resolved inside the source JSONC text.
  pub(super) offset: usize,
  /// Byte length of the offending token or node.
  pub(super) length: usize,
  /// LSP UTF-16 range computed from `offset` and `length`.
  pub(super) range: Range,
  /// Whether `offset` and `length` were fixed directly rather than resolved from `path`.
  #[serde(skip)]
  explicit_span: bool,
}

impl TypeEditError {
  /// Creates a validation error bound to `path` whose byte span is resolved later.
  pub(super) fn at_path(message: impl Into<String>, path: Vec<PathSegment>) -> Self {
    Self {
      message: message.into(),
      path,
      offset: 0,
      length: 1,
      range: Range::default(),
      explicit_span: false,
    }
  }

  /// Creates a validation error with an explicit byte span in the source JSONC text.
  pub(super) fn at_span(
    message: impl Into<String>,
    path: Vec<PathSegment>,
    offset: usize,
    length: usize,
  ) -> Self {
    Self {
      message: message.into(),
      path,
      offset,
      length,
      range: Range::default(),
      explicit_span: true,
    }
  }

  /// Resolves the byte span if needed and populates the UTF-16 LSP `range` from `text`.
  pub(super) fn with_span(mut self, text: &str) -> Self {
    if !self.explicit_span {
      let (offset, length) = resolve_path_span(text, &self.path);
      self.offset = offset;
      self.length = length;
    } else {
      self.offset = self.offset.min(text.len());
    }
    self.range = utf16_range(text, self.offset, self.length);
    self
  }
}

impl fmt::Display for TypeEditError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(&self.message)
  }
}

impl std::error::Error for TypeEditError {}

/// Single atomic Ghidra MCP operation planned for saving a `.ghidra-type` edit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TypeMutation {
  /// Dotted MCP domain operation name such as `data_type.patch` or `data_type.upsert`.
  pub(super) method: String,
  /// JSON arguments object passed to the MCP operation.
  pub(super) arguments: Value,
}

/// Reads a data type and program metadata to construct the virtual `.ghidra-type` payload.
pub(crate) async fn get_type_document(
  backend: &McpBackend,
  md5: &str,
  path: &str,
) -> Result<Value> {
  let (program, original) = tokio::try_join!(
    backend.call("program", "get", Some(md5), json!({})),
    backend.call(
      "data_type",
      "get",
      Some(md5),
      json!({ "selector": { "path": path } })
    ),
  )?;
  let program_name = program
    .get("name")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .unwrap_or(md5);
  let reason = readonly_type_reason(&original);
  let readonly = reason.is_some();
  let text = render_type_jsonc(&original, program_name);
  let model = type_model(&original);

  Ok(json!({
    "md5": md5,
    "path": path,
    "program": program_name,
    "readonly": readonly,
    "readonlyReason": reason,
    "text": text,
    "original": original,
    "model": model,
  }))
}

/// Validates JSONC draft text against the raw `original` Ghidra data type snapshot.
pub(crate) fn validate_type_document(text: &str, original: &Value) -> Value {
  if let Some(reason) = readonly_type_reason(original) {
    let len = 1.min(text.len());
    return json!({
      "valid": false,
      "message": reason,
      "path": [],
      "offset": 0,
      "length": len,
      "range": utf16_range(text, 0, len),
    });
  }
  let model = type_model(original);
  match parse_type_jsonc(text, &model) {
    Err(err) => {
      let err = err.with_span(text);
      json!({
        "valid": false,
        "message": err.message,
        "path": err.path,
        "offset": err.offset,
        "length": err.length,
        "range": err.range,
      })
    }
    Ok(draft) => match type_mutations(&model, &draft, original) {
      Err(err) => {
        let err = err.with_span(text);
        json!({
          "valid": false,
          "message": err.message,
          "path": err.path,
          "offset": err.offset,
          "length": err.length,
          "range": err.range,
        })
      }
      Ok(mutations) => json!({
        "valid": true,
        "model": draft,
        "mutations": mutations,
      }),
    },
  }
}

/// Validates a type save request and builds the parsed draft model plus planned mutations.
pub(crate) fn prepare_type_save(
  text: &str,
  original: &Value,
) -> Result<(Value, Vec<TypeMutation>)> {
  if let Some(reason) = readonly_type_reason(original) {
    bail!("{reason}");
  }
  let model = type_model(original);
  let draft = parse_type_jsonc(text, &model)?;
  let operations = type_mutations(&model, &draft, original).map_err(|e| e.with_span(text))?;
  Ok((draft, operations))
}

/// Verifies that the current Ghidra snapshot still matches `original`.
fn check_type_conflict(current: &Value, original: &Value) -> Result<()> {
  ensure!(same_type_data(current, original), "{CONFLICT_MESSAGE}");
  Ok(())
}

/// Fetches the current Ghidra data type and verifies that it still matches `original`.
pub(crate) async fn fetch_and_check_type_conflict(
  backend: &McpBackend,
  md5: &str,
  path: &str,
  original: &Value,
) -> Result<Value> {
  let current = backend
    .call(
      "data_type",
      "get",
      Some(md5),
      json!({ "selector": { "path": path } }),
    )
    .await?;
  check_type_conflict(&current, original)?;
  Ok(current)
}

/// Collapses one or more mutations into `(domain, operation, parameters)` for `McpBackend::call`.
pub(crate) fn build_type_write_request(
  operations: &[TypeMutation],
) -> Option<(&'static str, &'static str, Value)> {
  if operations.is_empty() {
    return None;
  }
  if operations.len() == 1 {
    let op = &operations[0];
    let (domain, operation) = op.method.split_once('.')?;
    let domain = match domain {
      "data_type" => "data_type",
      _ => return None,
    };
    let operation = match operation {
      "patch" => "patch",
      "upsert" => "upsert",
      _ => return None,
    };
    return Some((domain, operation, op.arguments.clone()));
  }
  let items: Vec<Value> = operations
    .iter()
    .enumerate()
    .map(|(index, op)| {
      json!({
        "id": index.to_string(),
        "method": op.method,
        "arguments": op.arguments,
      })
    })
    .collect();
  Some((
    "batch",
    "execute",
    json!({
      "transaction_mode": "all_or_none",
      "items": items,
    }),
  ))
}

/// Attaches the uncertain-write recovery warning to errors that occur after sending mutations.
pub(crate) fn wrap_post_send_error(error: anyhow::Error) -> anyhow::Error {
  error.context(POST_SEND_WARNING)
}

/// Reads back the saved type, reconciles JSONC formatting, and builds the save response.
pub(crate) async fn read_type_and_finish_save(
  backend: &McpBackend,
  md5: &str,
  path: &str,
  text: &str,
  draft: &Value,
) -> Result<Value> {
  let actual = backend
    .call(
      "data_type",
      "get",
      Some(md5),
      json!({ "selector": { "path": path } }),
    )
    .await
    .map_err(wrap_post_send_error)?;
  finish_type_save(md5, path, text, draft, actual).map_err(wrap_post_send_error)
}

/// Reconciles `text` against `actual` and constructs the `ghidra.saveTypeDocument` payload.
fn finish_type_save(
  md5: &str,
  path: &str,
  text: &str,
  draft: &Value,
  actual: Value,
) -> Result<Value> {
  let normalized = reconcile_type_text(text, draft, &actual)?;
  Ok(json!({
    "md5": md5,
    "path": path,
    "mutated": true,
    "persisted": true,
    "requiresReadback": normalized != text,
    "text": normalized,
    "original": actual,
  }))
}

/// Builds the `ghidra.saveTypeDocument` payload when no Ghidra mutations were needed.
pub(crate) fn noop_type_save(md5: &str, path: &str, text: &str, original: Value) -> Value {
  json!({
    "md5": md5,
    "path": path,
    "mutated": false,
    "persisted": true,
    "requiresReadback": false,
    "text": text,
    "original": original,
  })
}
