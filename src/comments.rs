// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Supplemental insertion of Ghidra repeatable comments into virtual C buffers.

use std::collections::BTreeMap;

use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::Value;

use crate::document::{CodeLocation, Document, Span, Token, same_address};

/// Supplemental comment record returned by `decompilation.get`.
#[derive(Deserialize)]
struct Comment {
  /// Target address of the comment.
  address: String,
  /// Ghidra comment kind (`repeatable`).
  #[serde(rename = "type")]
  kind: String,
  /// Raw multi-line comment body text.
  text: String,
}

/// Inserts repeatable comments from `response` into `document` and shifts token spans.
pub(crate) fn include(document: &mut Document, response: &Value) -> Result<()> {
  let comments: Vec<Comment> = serde_json::from_value(
    response
      .get("comments")
      .context("Backend omitted repeatable comments; upgrade ghidra-mcp")?
      .clone(),
  )?;
  ensure!(
    comments
      .iter()
      .all(|c| c.kind.eq_ignore_ascii_case("repeatable")),
    "Backend returned a non-repeatable supplemental comment"
  );
  render(document, comments);
  ensure!(
    response.get("comments_complete").and_then(Value::as_bool) == Some(true),
    "Repeatable comment result is incomplete; see backend warnings"
  );
  Ok(())
}

/// Anchors non-empty comments onto lines in `document` and updates `base`, `current`, `saved`, and `spans`.
fn render(document: &mut Document, comments: Vec<Comment>) {
  let body = document
    .spans
    .iter()
    .find(|span| span.token.kind != "comment" && span.token.text == "{");
  let mut insertions = BTreeMap::<usize, Vec<(Comment, bool, String)>>::new();
  for comment in comments {
    if comment.text.is_empty() {
      continue;
    }
    let matching = document.spans.iter().find(|span| {
      span.token.kind != "comment"
        && body.is_some_and(|body| span.start >= body.end)
        && span
          .token
          .address
          .as_deref()
          .is_some_and(|location| same_address(location, &comment.address))
    });
    let anchor = if document
      .entry
      .as_deref()
      .is_some_and(|entry| same_address(entry, &comment.address))
    {
      body
    } else {
      matching
    };
    let mut insertion = document.base.len();
    let mut unmapped = true;
    let mut indent = String::new();
    if let Some(anchor) = anchor {
      let line_start = document.base[..anchor.start]
        .rfind('\n')
        .map_or(0, |offset| offset + 1);
      indent = document.base[line_start..anchor.start]
        .chars()
        .take_while(|character| matches!(character, ' ' | '\t'))
        .collect();
      if body.is_some_and(|body| anchor.start <= body.end)
        || matches!(comment.kind.to_ascii_lowercase().as_str(), "eol" | "post")
      {
        insertion = document.base[anchor.end..]
          .find('\n')
          .map_or(document.base.len(), |offset| anchor.end + offset + 1);
        if body.is_some_and(|body| anchor.start == body.start) {
          indent.push_str("  ");
        }
      } else {
        insertion = line_start;
      }
      unmapped = document
        .spans
        .iter()
        .any(|span| span.start < insertion && insertion < span.end);
      if unmapped {
        insertion = document.base.len();
        indent.clear();
      }
    }
    insertions
      .entry(insertion)
      .or_default()
      .push((comment, unmapped, indent));
  }
  if insertions.is_empty() {
    return;
  }
  let mut output = String::new();
  let mut cursor = 0;
  let mut shifts = Vec::new();
  let mut additions = Vec::new();
  for (offset, comments) in insertions {
    output.push_str(&document.base[cursor..offset]);
    let before = output.len();
    if !output.is_empty() && !output.ends_with('\n') {
      output.push('\n');
    }
    if offset == document.base.len() && comments.iter().any(|(_, unmapped, _)| *unmapped) {
      output.push_str("// REPEATABLE comments (extension; no exact pseudocode location)\n");
    }
    for (comment, unmapped, indent) in comments {
      let start = output.len() + indent.len();
      let qualifier = if unmapped {
        "; no exact pseudocode location"
      } else {
        ""
      };
      output.push_str(&format!(
        "{indent}// [{} {} (extension){qualifier}] ",
        comment.kind.to_ascii_uppercase(),
        comment.address
      ));
      for (index, line) in comment.text.lines().enumerate() {
        if index > 0 {
          output.push_str(&format!("\n{indent}// "));
        }
        output.push_str(line);
      }
      let end = output.len();
      let unit = document.spans.iter().find_map(|span| {
        let location = span.location.as_ref()?;
        (span
          .token
          .address
          .as_deref()
          .is_some_and(|a| same_address(a, &comment.address))
          || location
            .code_unit_address
            .as_deref()
            .is_some_and(|a| same_address(a, &comment.address)))
        .then(|| location.code_unit_address.clone())
        .flatten()
      });
      let mut line_start = start;
      for line in output[start..end].split('\n') {
        additions.push(Span {
          start: line_start,
          end: line_start + line.len(),
          token: Token {
            kind: "comment".into(),
            text: line.into(),
            address: Some(comment.address.clone()),
          },
          symbol: None,
          location: Some(CodeLocation {
            address: comment.address.clone(),
            code_unit_address: unit.clone(),
            token_max_address: None,
            exact: true,
          }),
        });
        line_start += line.len() + 1;
      }
      output.push('\n');
    }
    shifts.push((offset, output.len() - before));
    cursor = offset;
  }
  output.push_str(&document.base[cursor..]);
  for span in &mut document.spans {
    let empty = span.start == span.end;
    span.start += shifts
      .iter()
      .filter(|(offset, _)| *offset <= span.start)
      .map(|(_, size)| size)
      .sum::<usize>();
    span.end += shifts
      .iter()
      .filter(|(offset, _)| *offset < span.end || (empty && *offset == span.end))
      .map(|(_, size)| size)
      .sum::<usize>();
  }
  document.spans.extend(additions);
  document.spans.sort_by_key(|span| span.start);
  document.base = output.clone();
  document.current = output.clone();
  document.saved = output;
}
