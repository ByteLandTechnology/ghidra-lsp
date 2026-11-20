// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Repository checks and CI runner for the `ghidra-lsp` workspace.
//!
//! Run `cargo xtask help` for the list of supported commands.

/// Continuous integration runner that executes all repository checks.
mod ci;
/// Documentation code-example scanner for Rust files and Markdown.
mod examples;
/// Forbidden attribute, dependency, and test-code scanner.
mod forbidden;
/// License and SPDX header checker.
mod headers;
/// Small Rust lexer that separates code from comments and literals.
mod lexer;
/// Maximum code-line limit checker for Rust source files.
mod lines;
/// Workspace path discovery helpers.
mod workspace;

use std::process::ExitCode;

/// Command-line usage text printed for `help` or invalid arguments.
const USAGE: &str = "\
Usage: cargo xtask <command>

Commands:
  ci               Run fmt, check, clippy, doc, build, and cargo-deny
  check            Run header, line-limit, and forbidden-code checks
  license-headers  Check the license header of each Rust file
  line-limit       Check the code-line limit of each Rust file
  forbidden-code   Find code or manifests that AGENTS.md forbids
  help             Show this text";

/// Parses the subcommand and prints any check failure to standard error.
fn main() -> ExitCode {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let args: Vec<&str> = args.iter().map(String::as_str).collect();
  let result = match args.as_slice() {
    ["ci"] => ci::run(),
    ["check"] => run_all(),
    ["license-headers"] => headers::check(),
    ["line-limit"] => lines::check(),
    ["forbidden-code"] => forbidden::check(),
    ["help"] | [] => {
      println!("{USAGE}");
      return ExitCode::SUCCESS;
    }
    _ => Err(format!("unknown command\n\n{USAGE}")),
  };
  match result {
    Ok(()) => ExitCode::SUCCESS,
    Err(message) => {
      eprintln!("{message}");
      ExitCode::FAILURE
    }
  }
}

/// Runs every repository rule check and reports all failures together.
pub(crate) fn run_all() -> Result<(), String> {
  let failures: Vec<String> = [headers::check(), lines::check(), forbidden::check()]
    .into_iter()
    .filter_map(Result::err)
    .collect();
  if failures.is_empty() {
    Ok(())
  } else {
    Err(failures.join("\n"))
  }
}
