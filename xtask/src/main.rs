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
/// Third-party license notice collector for locked dependencies.
mod licenses;
/// Maximum code-line limit checker for workspace source files.
mod lines;
/// npm launcher and platform package assembler.
mod npm;
/// Workspace path discovery helpers.
mod workspace;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

/// Command-line arguments for `cargo xtask`.
#[derive(Parser)]
#[command(name = "cargo xtask", bin_name = "cargo xtask")]
#[command(about = "Repository checks and CI runner for the ghidra-lsp workspace.")]
struct Cli {
  /// Subcommand to execute.
  #[command(subcommand)]
  command: Commands,
}

/// Available repository tasks.
#[derive(Subcommand)]
enum Commands {
  /// Run fmt, check, clippy, doc, build, and cargo-deny.
  Ci,
  /// Run header, line-limit, and forbidden-code checks.
  Check,
  /// Check the license header of each source file.
  LicenseHeaders,
  /// Check the code-line limit of each source file.
  LineLimit,
  /// Find code or manifests that AGENTS.md forbids.
  ForbiddenCode,
  /// Collect license notices for locked Rust dependencies.
  CollectLicenses,
  /// Make the npm packages from the release executables.
  NpmPack {
    /// Directory that holds the release executables.
    #[arg(long)]
    dist: PathBuf,
    /// Directory for the generated packages. It must be absent or empty.
    #[arg(long)]
    out: PathBuf,
  },
}

/// Parses the subcommand and prints any check failure to standard error.
fn main() -> ExitCode {
  let cli = Cli::parse();
  let result = match cli.command {
    Commands::Ci => ci::run(),
    Commands::Check => run_all(),
    Commands::LicenseHeaders => headers::check(),
    Commands::LineLimit => lines::check(),
    Commands::ForbiddenCode => forbidden::check(),
    Commands::CollectLicenses => licenses::collect(),
    Commands::NpmPack { dist, out } => npm::pack(&dist, &out),
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
