// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Checks the code-line limit of each Rust source file.

use crate::{lexer, workspace};

/// Maximum number of non-comment, non-blank code lines in one file.
const LIMIT: usize = 800;

/// Verifies that no Rust file exceeds [`LIMIT`] lines of code.
pub(crate) fn check() -> Result<(), String> {
  let mut over = Vec::new();
  for path in workspace::rust_files()? {
    let source = workspace::read(&path)?;
    let count = lexer::lex(&source)
      .iter()
      .filter(|line| line.has_code)
      .count();
    if count > LIMIT {
      over.push((count, workspace::display(&path)));
    }
  }
  if over.is_empty() {
    println!("Line limit: OK");
    return Ok(());
  }
  over.sort_by(|left, right| right.cmp(left));
  let list: Vec<String> = over
    .iter()
    .map(|(count, path)| format!("  {count}\t{path}"))
    .collect();
  Err(format!(
    "Line limit: these files have more than {LIMIT} lines of code:\n{}",
    list.join("\n")
  ))
}
