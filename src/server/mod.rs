// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Language Server Protocol state, virtual buffer synchronization, and command dispatch.

/// Custom command execution handlers.
mod commands;
/// `LanguageServer` trait implementation for [`Server`].
mod lsp;
/// Document and workspace symbol search handlers.
mod symbols;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use anyhow::{Result, ensure};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tower_lsp_server::ls_types::{
  Diagnostic, DiagnosticSeverity, ExecuteCommandParams, Range, Uri, notification,
};
use tower_lsp_server::{Client, jsonrpc};

use crate::backend::{Config, McpBackend};
use crate::document::canonical_virtual_uri;
use crate::engine::Engine;

/// Command identifiers advertised during `initialize`.
const COMMANDS: &[&str] = &[
  "ghidra.sessions",
  "ghidra.selectSession",
  "ghidra.functions",
  "ghidra.openSymbol",
  "ghidra.openFunction",
  "ghidra.document",
  "ghidra.location",
  "ghidra.reveal",
  "ghidra.typeAtPosition",
  "ghidra.configure",
];

/// Custom LSP notification emitted when cached backend views change for a session.
enum Changed {}

impl notification::Notification for Changed {
  type Params = Value;
  const METHOD: &'static str = "ghidra/changed";
}

/// Language server instance handling LSP requests and MCP backend coordination.
pub(crate) struct Server {
  /// Connected LSP client used for progress and diagnostic notifications.
  client: Client,
  /// Active engine holding backend state, session selection, and opened buffers.
  engine: Mutex<Engine>,
  /// Baseline transport configuration merged with client `initializationOptions`.
  default_config: Config,
  /// Whether the client resolves workspace symbol ranges lazily.
  lazy_symbols: AtomicBool,
}

impl Server {
  /// Creates a new LSP server instance with `client` and initial `config`.
  pub(crate) fn new(client: Client, config: Config) -> Self {
    Self {
      client,
      engine: Mutex::new(Engine::new(Arc::new(McpBackend::new(config.clone())))),
      default_config: config,
      lazy_symbols: AtomicBool::new(false),
    }
  }

  /// Resolves the target session MD5 from `arg.md5` or the currently active session.
  async fn scoped_md5(&self, arg: &Value) -> Result<String> {
    let md5 = match arg.get("md5").and_then(Value::as_str) {
      Some(md5) => md5.to_lowercase(),
      None => self.engine.lock().await.session()?.to_owned(),
    };
    ensure!(
      md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
      "invalid session MD5"
    );
    Ok(md5)
  }

  /// Notifies the client that state for session `md5` changed.
  async fn changed(&self, md5: &str) {
    self
      .client
      .send_notification::<Changed>(json!({"md5": md5}))
      .await;
  }

  /// Publishes or clears warning diagnostics attached to virtual document `uri`.
  async fn report(&self, uri: &Uri) {
    let canon = canonical_virtual_uri(uri);
    let diagnostics = {
      let e = self.engine.lock().await;
      e.docs
        .get(&canon)
        .and_then(|d| d.warning.as_ref())
        .map(|message| {
          vec![Diagnostic {
            range: Range::default(),
            severity: Some(DiagnosticSeverity::WARNING),
            source: Some("ghidra-lsp".into()),
            message: message.clone(),
            ..Default::default()
          }]
        })
        .unwrap_or_default()
    };
    self
      .client
      .publish_diagnostics(canon, diagnostics, None)
      .await;
  }

  /// Dispatches one `workspace/executeCommand` invocation.
  async fn command(&self, params: ExecuteCommandParams) -> Result<Value> {
    let arg = params.arguments.first().cloned().unwrap_or(json!({}));
    let backend = self.engine.lock().await.backend.clone();
    self
      .execute_session_command(&params.command, arg, backend.as_ref())
      .await
  }
}

/// Formats variable storage JSON returned by `ghidra-mcp` into concise display text.
fn format_storage(value: Option<&Value>) -> String {
  let Some(value) = value.filter(|v| !v.is_null()) else {
    return String::new();
  };
  if let Some(s) = value.as_str() {
    return s.to_owned();
  }
  if let Some(obj) = value.as_object() {
    let mut parts = Vec::new();
    if let Some(r) = obj.get("register").and_then(Value::as_str) {
      parts.push(r.to_owned());
    }
    if let Some(off) = obj.get("stack_offset").and_then(Value::as_i64) {
      parts.push(format!("stack {off:+#x}"));
    }
    if !parts.is_empty() {
      return parts.join(", ");
    }
  }
  value.to_string()
}

/// Converts any displayable error into a JSON-RPC `INVALID_PARAMS` error.
fn rpc(error: impl std::fmt::Display) -> jsonrpc::Error {
  jsonrpc::Error::invalid_params(format!("{error:#}"))
}
