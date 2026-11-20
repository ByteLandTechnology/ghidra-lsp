// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! LSP protocol handlers for [`Server`].

use serde_json::Value;
use tower_lsp_server::ls_types::{
  ExecuteCommandOptions, ExecuteCommandParams, InitializeParams, InitializeResult,
  PositionEncodingKind, ServerCapabilities, ServerInfo,
};
use tower_lsp_server::{LanguageServer, jsonrpc};

use super::{COMMANDS, Server, rpc};
use crate::backend::Config;

impl LanguageServer for Server {
  async fn initialize(&self, params: InitializeParams) -> jsonrpc::Result<InitializeResult> {
    if let Some(options) = params.initialization_options {
      let mut config = serde_json::to_value(&self.default_config).map_err(rpc)?;
      let options = options
        .as_object()
        .ok_or_else(|| rpc("initializationOptions must be an object"))?;
      for (key, value) in options {
        config[key] = value.clone();
      }
      let config: Config = serde_json::from_value(config).map_err(rpc)?;
      self.reconfigure_backend(config).await;
    }
    Ok(InitializeResult {
      offset_encoding: None,
      server_info: Some(ServerInfo {
        name: "ghidra-lsp".into(),
        version: Some(env!("CARGO_PKG_VERSION").into()),
      }),
      capabilities: ServerCapabilities {
        position_encoding: Some(PositionEncodingKind::UTF16),
        execute_command_provider: Some(ExecuteCommandOptions {
          commands: COMMANDS.iter().map(|s| (*s).to_owned()).collect(),
          ..Default::default()
        }),
        ..Default::default()
      },
    })
  }

  async fn shutdown(&self) -> jsonrpc::Result<()> {
    Ok(())
  }

  async fn execute_command(&self, params: ExecuteCommandParams) -> jsonrpc::Result<Option<Value>> {
    let progress = if let Some(token) = params.work_done_progress_params.work_done_token.clone() {
      Some(self.client.progress(token, "Ghidra").begin().await)
    } else {
      None
    };
    let result = self.command(params).await;
    if let Some(progress) = progress {
      progress.finish().await;
    }
    result.map(Some).map_err(rpc)
  }
}
