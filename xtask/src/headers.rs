// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Checks that every Rust source file starts with the two-line SPDX header.

use crate::workspace;

/// Required first line of each Rust source file.
const COPYRIGHT: &str = "// Copyright 2026 ByteLand Technology Limited";

/// Required second line of each Rust source file.
const SPDX: &str = "// SPDX-License-Identifier: MIT";

/// Verifies that every workspace `.rs` file starts with the required header.
pub(crate) fn check() -> Result<(), String> {
  let mut missing = Vec::new();
  for path in workspace::rust_files()? {
    let source = workspace::read(&path)?;
    let mut lines = source.lines();
    if lines.next() == Some(COPYRIGHT) && lines.next() == Some(SPDX) {
      continue;
    }
    missing.push(workspace::display(&path));
  }
  if missing.is_empty() {
    println!("License headers: OK");
    Ok(())
  } else {
    Err(format!(
      "License headers: missing or incorrect in {} file(s):\n  {}",
      missing.len(),
      missing.join("\n  ")
    ))
  }
}
