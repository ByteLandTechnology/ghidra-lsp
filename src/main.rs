// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Language server entry point for Ghidra decompilation through `ghidra-mcp`.

/// Canonical address parsing, structured type references, and defined string queries.
mod address;
/// Model Context Protocol child-process client and response normalization.
mod backend;
/// Binary loader import and export parsing.
mod binary;
/// Repeatable comment insertion inside virtual C documents.
mod comments;
/// Virtual document state, token alignment, and UTF-16 helpers.
mod document;
/// Session selection, symbol table, and decompilation engine.
mod engine;
/// Control-flow graph and bounded call-graph queries.
mod graph;
/// Native Ghidra GUI layout validation.
mod gui;
/// Comment, function prototype, and variable mutation planning.
mod mutations;
/// Language Server Protocol state and handlers.
mod server;
/// Virtual `.ghidra-type` JSONC documents, validation, and save coordination.
mod types_doc;
/// Listing, memory hex, and byte data inspector views.
mod views;
/// Bridge resource coverage helpers.
mod workbench;

use backend::Config;
use clap::Parser;
use server::Server;
use tower_lsp_server::{LspService, Server as LspServer};

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

/// Parses command-line options and serves LSP requests over standard input and output.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
  let args = Args::parse();
  let config = Config {
    mcp_command: args.mcp_command,
    mcp_args: args.mcp_arg,
    request_timeout_ms: args.request_timeout_ms,
  };
  let (service, socket) = LspService::new(move |client| Server::new(client, config.clone()));
  LspServer::new(tokio::io::stdin(), tokio::io::stdout(), socket)
    .serve(service)
    .await;
  Ok(())
}
