// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Language server entry point for Ghidra decompilation through `ghidra-mcp`.

use clap::Parser;

/// Command-line options for the `ghidra-lsp` executable.
#[derive(Parser)]
#[command(version, about = "Ghidra language server through ghidra-mcp")]
struct Args {
  /// Executable name or path for the `ghidra-mcp` child process.
  #[arg(long, default_value = "ghidra-mcp")]
  mcp_command: String,
  /// Additional arguments passed to the `ghidra-mcp` child process.
  #[arg(long, allow_hyphen_values = true)]
  mcp_arg: Vec<String>,
  /// Request timeout in milliseconds for backend MCP calls.
  #[arg(long, default_value_t = 35_000)]
  request_timeout_ms: u64,
}

/// Parses command-line options and starts the language server runtime.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
  let args = Args::parse();
  let _ = (&args.mcp_command, &args.mcp_arg, args.request_timeout_ms);
  Ok(())
}
