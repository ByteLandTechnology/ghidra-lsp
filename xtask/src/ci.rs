// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Runs all checks that CI enforces, in strict order.

use std::process::Command;

use crate::workspace;

/// Runs format, repository rule, lint, doc, build, and dependency checks.
pub(crate) fn run() -> Result<(), String> {
  cargo(&["fmt", "--all", "--", "--check"])?;
  crate::run_all()?;
  cargo(&[
    "clippy",
    "--locked",
    "--workspace",
    "--all-targets",
    "--",
    "-D",
    "warnings",
  ])?;
  cargo(&[
    "doc",
    "--locked",
    "--workspace",
    "--no-deps",
    "--document-private-items",
  ])?;
  cargo(&["build", "--locked", "--workspace"])?;
  cargo(&["deny", "--locked", "--workspace", "check"])?;
  println!("CI: OK");
  Ok(())
}

/// Executes one `cargo` subcommand in the workspace root directory.
fn cargo(args: &[&str]) -> Result<(), String> {
  let program = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  println!("> cargo {}", args.join(" "));
  let status = Command::new(program)
    .args(args)
    .current_dir(workspace::root()?)
    .status()
    .map_err(|error| format!("cannot run cargo {}: {error}", args.join(" ")))?;
  if status.success() {
    Ok(())
  } else {
    Err(format!("cargo {} failed", args.join(" ")))
  }
}
