// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Native Ghidra GUI layout deserialization and UTF-16 token alignment validation.

use anyhow::{Result, ensure};
use serde::Deserialize;
use serde_json::Value;

use crate::document::{CodeLocation, Span, Symbol, Token};

/// One native decompiler line returned in `decompilation.get` document mode.
#[derive(Deserialize)]
struct Line {
  /// Zero-based line index expected in ascending sequence.
  number: usize,
  /// Leading space count in UTF-16 code units.
  indent: usize,
  /// Ordered tokens rendered on this line.
  tokens: Vec<LocatedToken>,
}

/// Native decompiler token with UTF-16 column bounds and address metadata.
#[derive(Deserialize)]
struct LocatedToken {
  /// Token class returned by the decompiler.
  kind: String,
  /// Exact source text for this token.
  text: String,
  /// Inclusive UTF-16 column offset on the line.
  start: usize,
  /// Exclusive UTF-16 column offset on the line.
  end: usize,
  /// Exact instruction or variable address attached to this token when present.
  address: Option<String>,
  /// Highest instruction address covered by this token when available.
  max_address: Option<String>,
  /// Fallback address assigned to this cursor location.
  location_address: String,
  /// Enclosing instruction or data unit address when known.
  code_unit_address: Option<String>,
  /// Target symbol embedded directly by the GUI bridge when available.
  symbol: Option<Symbol>,
}

/// Validates native GUI lines and columns against `code` and produces aligned spans.
pub(crate) fn spans(code: &str, lines: &Value) -> Result<Vec<Span>> {
  let lines: Vec<Line> = Vec::deserialize(lines)?;
  let mut expected = String::new();
  let mut spans = Vec::new();
  for (number, line) in lines.into_iter().enumerate() {
    ensure!(line.number == number, "native line numbers differ");
    ensure!(
      line.indent <= code.len(),
      "native indentation exceeds document size"
    );
    expected.push_str(&" ".repeat(line.indent));
    let mut column = line.indent;
    for token in line.tokens {
      ensure!(token.start == column, "native token start differs");
      column += token.text.encode_utf16().count();
      ensure!(token.end == column, "native token end differs");
      let start = expected.len();
      expected.push_str(&token.text);
      spans.push(Span {
        start,
        end: expected.len(),
        location: Some(CodeLocation {
          exact: token.address.is_some(),
          address: token.location_address,
          code_unit_address: token.code_unit_address,
          token_max_address: token.max_address,
        }),
        token: Token {
          kind: token.kind,
          text: token.text,
          address: token.address,
        },
        symbol: token.symbol,
      });
    }
    expected.push('\n');
    ensure!(
      expected.len() <= code.len(),
      "native layout exceeds document size"
    );
  }
  ensure!(expected == code, "native layout differs from document text");
  Ok(spans)
}
