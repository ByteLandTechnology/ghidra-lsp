// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Language Server Protocol state and command routing.

/// LanguageServer trait implementation for `Server`.
mod lsp;

use std::sync::Arc;

use anyhow::{Result, bail};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tower_lsp_server::{Client, jsonrpc, ls_types::ExecuteCommandParams};

use crate::backend::{Config, McpBackend};

/// Command identifiers advertised during `initialize`.
const COMMANDS: &[&str] = &["ghidra.sessions"];

/// Language server instance handling LSP requests and MCP backend coordination.
pub(crate) struct Server {
  /// Connected LSP client used for progress notifications.
  client: Client,
  /// Active MCP backend instance protected for reinitialization on `initialize`.
  backend: Mutex<Arc<McpBackend>>,
  /// Baseline transport configuration merged with client `initializationOptions`.
  default_config: Config,
}

impl Server {
  /// Creates a new LSP server instance with `client` and initial `config`.
  pub(crate) fn new(client: Client, config: Config) -> Self {
    let backend = Arc::new(McpBackend::new(config.clone()));
    Self {
      client,
      backend: Mutex::new(backend),
      default_config: config,
    }
  }

  /// Replaces the active MCP backend instance with a new configuration.
  async fn reconfigure_backend(&self, config: Config) {
    *self.backend.lock().await = Arc::new(McpBackend::new(config));
  }

  /// Dispatches one `workspace/executeCommand` invocation.
  async fn command(&self, params: ExecuteCommandParams) -> Result<Value> {
    let _ = params.arguments.first();
    let backend = self.backend.lock().await.clone();
    match params.command.as_str() {
      "ghidra.sessions" => backend.call("session", "list", None, json!({})).await,
      _ => bail!("Unknown command: {}", params.command),
    }
  }
}

/// Converts any displayable error into a JSON-RPC `INVALID_PARAMS` error.
fn rpc(error: impl std::fmt::Display) -> jsonrpc::Error {
  jsonrpc::Error::invalid_params(format!("{error:#}"))
}
