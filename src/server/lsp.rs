// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! LSP protocol handlers for [`Server`].

use std::sync::Arc;
use std::sync::atomic::Ordering;

use serde_json::Value;
use tower_lsp_server::ls_types::{
  DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
  ExecuteCommandOptions, ExecuteCommandParams, InitializeParams, InitializeResult,
  PositionEncodingKind, ServerCapabilities, ServerInfo, TextDocumentSyncCapability,
  TextDocumentSyncKind, TextDocumentSyncOptions,
};
use tower_lsp_server::{LanguageServer, jsonrpc};

use super::{COMMANDS, Server, rpc};
use crate::backend::{Config, McpBackend};
use crate::document::{Document, SHOW_TEMPLATE_ARGUMENTS, canonical_virtual_uri};
use crate::engine::Engine;

impl LanguageServer for Server {
  async fn initialize(&self, params: InitializeParams) -> jsonrpc::Result<InitializeResult> {
    if let Some(value) = params
      .initialization_options
      .as_ref()
      .and_then(|options| options.get("templateArguments"))
      .and_then(Value::as_str)
    {
      SHOW_TEMPLATE_ARGUMENTS.store(value == "show", Ordering::Relaxed);
    }
    if let Some(options) = params.initialization_options {
      let mut config = serde_json::to_value(&self.default_config).map_err(rpc)?;
      let options = options
        .as_object()
        .ok_or_else(|| rpc("initializationOptions must be an object"))?;
      for (key, value) in options {
        config[key] = value.clone();
      }
      let config: Config = serde_json::from_value(config).map_err(rpc)?;
      *self.engine.lock().await = Engine::new(Arc::new(McpBackend::new(config)));
    }
    Ok(InitializeResult {
      offset_encoding: None,
      server_info: Some(ServerInfo {
        name: "ghidra-lsp".into(),
        version: Some(env!("CARGO_PKG_VERSION").into()),
      }),
      capabilities: ServerCapabilities {
        position_encoding: Some(PositionEncodingKind::UTF16),
        text_document_sync: Some(TextDocumentSyncCapability::Options(
          TextDocumentSyncOptions {
            open_close: Some(true),
            change: Some(TextDocumentSyncKind::FULL),
            ..Default::default()
          },
        )),
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

  async fn did_open(&self, params: DidOpenTextDocumentParams) {
    let item = params.text_document;
    let uri = canonical_virtual_uri(&item.uri);
    let mut e = self.engine.lock().await;
    if !e.docs.contains_key(&uri)
      && let Ok(parsed) = url::Url::parse(uri.as_str())
      && parsed.scheme() == "ghidra"
      && let Some(md5) = parsed.host_str()
    {
      let path = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
      if let Some((kind, raw_key)) = path.split_once('/')
        && let Ok(key) = percent_encoding::percent_decode_str(raw_key).decode_utf8()
      {
        if kind == "function" {
          let _ = e.open(md5, &key).await;
        } else if matches!(kind, "symbol" | "references" | "type")
          && let Ok(text) = e.snapshot_text(md5, kind, &key).await
        {
          let _ = e.install(Document {
            uri: uri.clone(),
            md5: md5.into(),
            entry: None,
            base: text.clone(),
            current: text.clone(),
            saved: text,
            version: None,
            spans: vec![],
            warning: None,
          });
        }
      }
    }
    if let Some(doc) = e.docs.get_mut(&uri) {
      doc.current = item.text;
      doc.version = Some(item.version);
    }
    drop(e);
    self.report(&uri).await;
  }

  async fn did_change(&self, params: DidChangeTextDocumentParams) {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    if let Some(doc) = self.engine.lock().await.docs.get_mut(&uri)
      && let Some(change) = params.content_changes.into_iter().last()
      && change.range.is_none()
    {
      doc.current = change.text;
      doc.version = Some(params.text_document.version);
    }
  }

  async fn did_close(&self, params: DidCloseTextDocumentParams) {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let removed = {
      let mut e = self.engine.lock().await;
      if let Some(doc) = e.docs.get_mut(&uri) {
        doc.current = doc.base.clone();
        doc.version = None;
      }
      e.close_document(&uri);
      !e.docs.contains_key(&uri)
    };
    if removed {
      self.client.publish_diagnostics(uri, vec![], None).await;
    }
  }
}
