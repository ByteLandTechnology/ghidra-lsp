// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Semantic token generation and bridge resource coverage reporting.

use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  SemanticToken, SemanticTokenModifier, SemanticTokenType, SemanticTokensLegend,
};

use crate::document::Document;

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

/// Advances zero-based `line` and UTF-16 `character` coordinates across `text`.
fn advance_position(text: &str, line: &mut u32, character: &mut u32) {
  for c in text.chars() {
    if c == '\n' {
      *line += 1;
      *character = 0;
    } else {
      *character += c.len_utf16() as u32;
    }
  }
}

/// Builds a coverage summary describing the scan scope and completeness for `domain`.
pub(crate) fn coverage(domain: &str, params: &Value, count: usize, complete: bool) -> Value {
  let scoped = params.pointer("/scan/range").is_some();
  let address_scan = matches!(
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
    "function" => {
      "Address-scanned functions. Whole-program function_count can also include external functions outside the bridge iterator; this list is not an import table."
    }
    "symbol" => {
      "Address-scanned symbols. Whole-program symbol_count also includes resources that the bridge does not enumerate, such as external or non-address symbols; this list is not an export table."
    }
    "data_unit" => {
      "Defined data units, including Ghidra-defined strings. This does not scan undefined bytes for candidate strings."
    }
    _ => "Resources returned by the real Ghidra bridge under the supplied filters and range.",
  };
  json!({"scope": scope, "count": count, "complete": complete, "note": note})
}
