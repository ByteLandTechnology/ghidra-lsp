// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Semantic token generation and workbench operation helpers.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  SemanticToken, SemanticTokenModifier, SemanticTokenType, SemanticTokensLegend,
};

use crate::backend::McpBackend;
use crate::document::{Document, advance_position};
use crate::mcp_client::{PagePolicy, allow_read, next_cursor, resource_operation};

/// Returns the LSP semantic token legend used for decompiled virtual documents.
pub(crate) fn semantic_legend() -> SemanticTokensLegend {
  SemanticTokensLegend {
    token_types: vec![
      SemanticTokenType::KEYWORD,
      SemanticTokenType::COMMENT,
      SemanticTokenType::TYPE,
      SemanticTokenType::FUNCTION,
      SemanticTokenType::VARIABLE,
      SemanticTokenType::PARAMETER,
      SemanticTokenType::NUMBER,
      SemanticTokenType::STRING,
    ],
    token_modifiers: vec![SemanticTokenModifier::READONLY],
  }
}

/// Splits aligned Ghidra token spans into single-line UTF-16 LSP semantic tokens.
pub(crate) fn semantic_tokens(doc: &Document) -> Vec<SemanticToken> {
  if !doc.clean() {
    return vec![];
  }
  let mut tokens = Vec::new();
  let mut previous = (0, 0);
  let (mut byte, mut line, mut character) = (0, 0, 0);
  for span in &doc.spans {
    let kind = if matches!(span.token.kind.as_str(), "default" | "identifier" | "label") {
      span
        .symbol
        .as_ref()
        .map(|s| s.kind.to_ascii_lowercase())
        .unwrap_or_else(|| span.token.kind.clone())
    } else {
      span.token.kind.clone()
    };
    let (token_type, modifiers) = match kind.as_str() {
      "keyword" => (0, 0),
      "comment" => (1, 0),
      "type" => (2, 0),
      "function" => (3, 0),
      "variable" | "global" | "label" => (4, 0),
      "parameter" => (5, 0),
      "constant" => (
        if span.token.text.trim_start().starts_with(['"', '\''])
          || ["L\"", "u\"", "U\"", "u8\"", "L'", "u'", "U'"]
            .iter()
            .any(|prefix| span.token.text.trim_start().starts_with(prefix))
        {
          7
        } else {
          6
        },
        1,
      ),
      _ => continue,
    };
    advance_position(&doc.base[byte..span.start], &mut line, &mut character);
    byte = span.start;
    for segment in doc.base[span.start..span.end].split_inclusive('\n') {
      let content = segment.trim_end_matches(['\r', '\n']);
      let length = content.encode_utf16().count() as u32;
      if length > 0 {
        let delta_line = line - previous.0;
        tokens.push(SemanticToken {
          delta_line,
          delta_start: if delta_line == 0 {
            character - previous.1
          } else {
            character
          },
          length,
          token_type,
          token_modifiers_bitset: modifiers,
        });
        previous = (line, character);
      }
      advance_position(segment, &mut line, &mut character);
      byte += segment.len();
    }
  }
  tokens
}

/// Extracts `domain`, `operation`, and object `params` from a workbench command payload.
pub(crate) fn operation(arg: &Value) -> Result<(&str, &str, Value)> {
  let domain = arg
    .get("domain")
    .and_then(Value::as_str)
    .context("domain is required")?;
  let operation = arg
    .get("operation")
    .and_then(Value::as_str)
    .context("operation is required")?;
  let params = arg.get("params").cloned().unwrap_or_else(|| json!({}));
  ensure!(params.is_object(), "params must be an object");
  Ok((domain, operation, params))
}

/// Returns true when the bridge operation requires a session MD5 parameter.
pub(crate) fn session_required(domain: &str, operation: &str) -> bool {
  domain != "job" && !(domain == "session" && operation == "list")
}

/// Translates a workbench `(domain, operation)` pair to its MCP tool domain and operation name.
pub(crate) fn mcp_operation<'a>(domain: &'a str, operation: &'a str) -> (&'a str, String) {
  let (tool, prefix) = match domain {
    "address_space" => ("address", "space"),
    "program_language" => ("program", "language"),
    "import" | "export" | "entry_point" => ("program", domain),
    "memory_block" => ("memory", "block"),
    "code_unit" | "data_unit" | "instruction" | "flow_override" => ("listing", domain),
    "function_call" => ("function", "call"),
    "function_parameter" => ("function", "parameter"),
    "function_local_variable" => ("function", "local_variable"),
    "data_type_category" => ("data_type", "category"),
    "interface" => ("bridge", ""),
    _ => (domain, ""),
  };
  (
    tool,
    if prefix.is_empty() {
      operation.to_owned()
    } else {
      format!("{prefix}.{operation}")
    },
  )
}

/// Verifies that an atomic batch write completed with zero item errors.
pub(crate) fn check_write_result(domain: &str, operation: &str, value: &Value) -> Result<()> {
  if (domain, operation) == ("batch", "execute") {
    let items = value
      .get("items")
      .and_then(Value::as_array)
      .context("batch response lacks items")?;
    let failures: Vec<_> = items.iter().filter(|i| i.get("error").is_some()).collect();
    ensure!(
      failures.is_empty(),
      "Ghidra rejected the atomic batch; no changes were saved: {}",
      serde_json::to_string(&failures)?
    );
  }
  Ok(())
}

/// Checks that `program.save` returned `"saved": true`.
pub(crate) fn confirm_saved(value: &Value) -> Result<()> {
  ensure!(
    value.get("saved").and_then(Value::as_bool) == Some(true),
    "Ghidra did not confirm project persistence; refresh and inspect before retrying"
  );
  Ok(())
}

/// Saves the Ghidra project for session `md5` and checks persistence confirmation.
pub(crate) async fn persist(backend: &McpBackend, md5: &str) -> Result<()> {
  let result = backend
    .call("program", "save", Some(md5), json!({}))
    .await?;
  confirm_saved(&result)
}

/// Builds a coverage summary describing the scan scope and completeness for `domain`.
pub(crate) fn coverage(domain: &str, params: &Value, count: usize, complete: bool) -> Value {
  let scoped = params.pointer("/scan/range").is_some();
  let external_functions = domain == "function"
    && params.pointer("/filter/external").and_then(Value::as_bool) == Some(true);
  let address_scan = !external_functions
    && matches!(
      domain,
      "symbol"
        | "function"
        | "global_variable"
        | "code_unit"
        | "data_unit"
        | "instruction"
        | "comment"
    );
  let scope = if address_scan {
    if scoped {
      "requested-address-range"
    } else {
      "bridge-default-address-scan"
    }
  } else {
    "bridge-resource-list"
  };
  let note = match domain {
    "function" if external_functions => {
      "External functions from Ghidra. Use import.list for library names and thunk addresses."
    }
    "function" => {
      "Address-scanned functions. Set filter.external to true for external functions, or use import.list for the import table."
    }
    "symbol" => {
      "Address-scanned symbols. Use import.list, export.list, or entry_point.list for imports, exports, and entry points."
    }
    "data_unit" => {
      "Defined data units, including Ghidra-defined strings. This does not scan undefined bytes for candidate strings."
    }
    _ => "Resources returned by the real Ghidra bridge under the supplied filters and range.",
  };
  json!({"scope": scope, "count": count, "complete": complete, "note": note})
}

/// Executes a read-only workbench query, paginating all pages when `all` is true on a list call.
pub(crate) async fn query(backend: &McpBackend, md5: Option<&str>, arg: &Value) -> Result<Value> {
  let (domain, operation, params) = operation(arg)?;
  let (resource, verb) = resource_operation(domain, operation);
  allow_read(domain, operation, &params)?;
  let all = arg.get("all").and_then(Value::as_bool).unwrap_or(false);
  ensure!(
    !all || verb == "list",
    "all is only valid for list operations"
  );
  let (domain, operation) = mcp_operation(domain, operation);
  if all && session_required(domain, &operation) {
    let items = PagePolicy::RANGE_SCOPED
      .collect(backend, domain, &operation, md5, params.clone())
      .await?;
    let coverage = coverage(resource, &params, items.len(), true);
    return Ok(json!({"items": items, "coverage": coverage}));
  }
  let mut value = backend
    .call(domain, &operation, md5, params.clone())
    .await?;
  if verb == "list"
    && let Some(items) = value.get("items").and_then(Value::as_array)
  {
    let complete = next_cursor(&value).is_none()
      && value.pointer("/scan/complete").and_then(Value::as_bool) != Some(false);
    value["coverage"] = coverage(resource, &params, items.len(), complete);
  }
  Ok(value)
}
