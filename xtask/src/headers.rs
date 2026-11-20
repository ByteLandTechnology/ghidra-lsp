// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Checks that every Rust, Lua, and TypeScript source file starts with the two-line SPDX header.

use std::path::PathBuf;

use crate::workspace;

/// Required first line of each Rust and TypeScript source file.
const SLASH_COPYRIGHT: &str = "// Copyright 2026 ByteLand Technology Limited";

/// Required second line of each Rust and TypeScript source file.
const SLASH_SPDX: &str = "// SPDX-License-Identifier: MIT";

/// Required first line of each Lua source file.
const LUA_COPYRIGHT: &str = "-- Copyright 2026 ByteLand Technology Limited";

/// Required second line of each Lua source file.
const LUA_SPDX: &str = "-- SPDX-License-Identifier: MIT";

/// Collects relative paths whose leading two lines do not match `copyright` and `spdx`.
fn collect_missing(
  files: Vec<PathBuf>,
  copyright: &str,
  spdx: &str,
  missing: &mut Vec<String>,
) -> Result<(), String> {
  for path in files {
    let source = workspace::read(&path)?;
    let mut lines = source.lines();
    if lines.next() == Some(copyright) && lines.next() == Some(spdx) {
      continue;
    }
    missing.push(workspace::display(&path));
  }
  Ok(())
}

/// Verifies that every workspace `.rs`, `.lua`, and `.ts` file starts with its SPDX header.
pub(crate) fn check() -> Result<(), String> {
  let mut missing = Vec::new();
  collect_missing(
    workspace::rust_files()?,
    SLASH_COPYRIGHT,
    SLASH_SPDX,
    &mut missing,
  )?;
  collect_missing(
    workspace::lua_files()?,
    LUA_COPYRIGHT,
    LUA_SPDX,
    &mut missing,
  )?;
  collect_missing(
    workspace::ts_files()?,
    SLASH_COPYRIGHT,
    SLASH_SPDX,
    &mut missing,
  )?;
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
