// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! LSP protocol handlers for [`Server`].

use std::sync::Arc;
use std::sync::atomic::Ordering;

use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  CallHierarchyIncomingCall, CallHierarchyIncomingCallsParams, CallHierarchyItem,
  CallHierarchyOutgoingCall, CallHierarchyOutgoingCallsParams, CallHierarchyPrepareParams,
  CallHierarchyServerCapability, CodeAction, CodeActionDisabled, CodeActionKind, CodeActionOptions,
  CodeActionOrCommand, CodeActionParams, CodeActionProviderCapability, CodeActionResponse,
  CodeLens, CodeLensOptions, CodeLensParams, Command, CompletionOptions, CompletionParams,
  CompletionResponse, DeclarationCapability, DidChangeTextDocumentParams,
  DidCloseTextDocumentParams, DidOpenTextDocumentParams, DidSaveTextDocumentParams,
  DocumentHighlight, DocumentHighlightParams, DocumentLink, DocumentLinkOptions,
  DocumentLinkParams, DocumentSymbolParams, DocumentSymbolResponse, ExecuteCommandOptions,
  ExecuteCommandParams, FoldingRange, FoldingRangeParams, FoldingRangeProviderCapability,
  GotoDefinitionParams, GotoDefinitionResponse, Hover, HoverParams, HoverProviderCapability,
  ImplementationProviderCapability, InitializeParams, InitializeResult, InlayHint, InlayHintParams,
  Location, MessageType, OneOf, PositionEncodingKind, PrepareRenameResponse, ReferenceParams,
  RenameOptions, RenameParams, SaveOptions, SemanticTokens, SemanticTokensFullOptions,
  SemanticTokensOptions, SemanticTokensParams, SemanticTokensResult,
  SemanticTokensServerCapabilities, ServerCapabilities, ServerInfo, SignatureHelp,
  SignatureHelpOptions, SignatureHelpParams, TextDocumentPositionParams,
  TextDocumentSyncCapability, TextDocumentSyncKind, TextDocumentSyncOptions,
  TextDocumentSyncSaveOptions, TypeDefinitionProviderCapability, WorkspaceEdit, WorkspaceSymbol,
  WorkspaceSymbolOptions, WorkspaceSymbolParams, WorkspaceSymbolResponse,
  request::{GotoDeclarationParams, GotoDeclarationResponse},
  request::{GotoImplementationParams, GotoImplementationResponse},
};
use tower_lsp_server::{LanguageServer, jsonrpc};

use super::{COMMANDS, Server, rpc};
use crate::backend::{Config, McpBackend};
use crate::document::{
  Document, SHOW_TEMPLATE_ARGUMENTS, canonical_virtual_uri, matches_text, offset,
};
use crate::engine::ClientBuffer;
use crate::workbench;

impl LanguageServer for Server {
  async fn initialize(&self, params: InitializeParams) -> jsonrpc::Result<InitializeResult> {
    self.readonly_documents.store(
      params
        .initialization_options
        .as_ref()
        .and_then(|options| options.get("readonlyDocuments"))
        .and_then(Value::as_bool)
        .unwrap_or(false),
      Ordering::Relaxed,
    );
    self.lazy_symbols.store(
      params
        .capabilities
        .workspace
        .as_ref()
        .and_then(|w| w.symbol.as_ref())
        .and_then(|s| s.resolve_support.as_ref())
        .is_some_and(|r| r.properties.iter().any(|p| p == "location.range")),
      Ordering::Relaxed,
    );
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
      self.swap_backend(Arc::new(McpBackend::new(config)));
      self.view_cache.invalidate_all().await;
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
            save: Some(TextDocumentSyncSaveOptions::SaveOptions(SaveOptions {
              include_text: Some(true),
            })),
            ..Default::default()
          },
        )),
        hover_provider: Some(HoverProviderCapability::Simple(true)),
        definition_provider: Some(OneOf::Left(true)),
        declaration_provider: Some(DeclarationCapability::Simple(true)),
        implementation_provider: Some(ImplementationProviderCapability::Simple(true)),
        type_definition_provider: Some(TypeDefinitionProviderCapability::Simple(true)),
        references_provider: Some(OneOf::Left(true)),
        document_highlight_provider: Some(OneOf::Left(true)),
        document_symbol_provider: Some(OneOf::Left(true)),
        workspace_symbol_provider: Some(OneOf::Right(WorkspaceSymbolOptions {
          resolve_provider: Some(true),
          work_done_progress_options: Default::default(),
        })),
        rename_provider: Some(OneOf::Right(RenameOptions {
          prepare_provider: Some(true),
          work_done_progress_options: Default::default(),
        })),
        completion_provider: Some(CompletionOptions {
          resolve_provider: Some(false),
          ..Default::default()
        }),
        signature_help_provider: Some(SignatureHelpOptions {
          trigger_characters: Some(vec!["(".into(), ",".into()]),
          retrigger_characters: Some(vec![",".into()]),
          ..Default::default()
        }),
        semantic_tokens_provider: Some(SemanticTokensServerCapabilities::SemanticTokensOptions(
          SemanticTokensOptions {
            legend: workbench::semantic_legend(),
            full: Some(SemanticTokensFullOptions::Bool(true)),
            range: None,
            ..Default::default()
          },
        )),
        code_action_provider: Some(CodeActionProviderCapability::Options(CodeActionOptions {
          code_action_kinds: Some(vec![CodeActionKind::QUICKFIX, CodeActionKind::REFACTOR]),
          resolve_provider: Some(false),
          ..Default::default()
        })),
        inlay_hint_provider: Some(OneOf::Left(true)),
        call_hierarchy_provider: Some(CallHierarchyServerCapability::Simple(true)),
        code_lens_provider: Some(CodeLensOptions {
          resolve_provider: Some(false),
        }),
        folding_range_provider: Some(FoldingRangeProviderCapability::Simple(true)),
        document_link_provider: Some(DocumentLinkOptions {
          resolve_provider: Some(false),
          work_done_progress_options: Default::default(),
        }),
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
    let parsed_ghidra = url::Url::parse(uri.as_str()).ok().and_then(|parsed| {
      if parsed.scheme() != "ghidra" {
        return None;
      }
      let md5 = parsed.host_str()?.to_owned();
      let path = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
      let (kind, raw_key) = path.split_once('/')?;
      let key = percent_encoding::percent_decode_str(raw_key)
        .decode_utf8()
        .ok()?
        .into_owned();
      Some((md5, kind.to_owned(), key))
    });
    let (already_open, start_gen, start_epoch) = {
      let mut state = self.engine.write_state();
      if let Some(doc) = state.docs.get_mut(&uri) {
        if doc.version.is_none_or(|ver| ver <= item.version) {
          doc.current = item.text;
          doc.version = Some(item.version);
        }
        (true, 0, 0)
      } else {
        let should_store = match state.client_buffers.get(&uri) {
          Some(ClientBuffer::Open { version, .. }) => *version <= item.version,
          _ => true,
        };
        if should_store {
          state.client_buffers.insert(
            uri.clone(),
            ClientBuffer::Open {
              version: item.version,
              text: item.text,
            },
          );
        }
        let epoch = parsed_ghidra
          .as_ref()
          .map_or(0, |(md5, _, _)| state.epoch(md5));
        (false, state.generation, epoch)
      }
    };
    if already_open {
      self.report(&uri).await;
      return;
    }
    if let Some((md5, kind, key)) = parsed_ghidra {
      if kind == "function" {
        let _ = self.engine.open(&md5, &key).await;
      } else if matches!(kind.as_str(), "symbol" | "references" | "type")
        && let Ok(text) = self.engine.snapshot_text(&md5, &kind, &key).await
      {
        let mut state = self.engine.write_state();
        if !state.is_closed_since(&md5, start_epoch, start_gen) {
          let _ = state.install(Document {
            uri: uri.clone(),
            md5,
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
    let closed_early = {
      let mut state = self.engine.write_state();
      match state.client_buffers.remove(&uri) {
        Some(ClientBuffer::Closed) => {
          state.close_document(&uri);
          Some(!state.docs.contains_key(&uri))
        }
        Some(ClientBuffer::Open { version, text }) => {
          if let Some(doc) = state.docs.get_mut(&uri)
            && doc.version.is_none_or(|ver| ver <= version)
          {
            doc.current = text;
            doc.version = Some(version);
          }
          None
        }
        None => None,
      }
    };
    if let Some(removed) = closed_early {
      if removed {
        self.client.publish_diagnostics(uri, vec![], None).await;
      }
      return;
    }
    self.report(&uri).await;
  }

  async fn did_change(&self, params: DidChangeTextDocumentParams) {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let Some(change) = params.content_changes.into_iter().last() else {
      return;
    };
    if change.range.is_some() {
      return;
    }
    let new_ver = params.text_document.version;
    let mut state = self.engine.write_state();
    if let Some(doc) = state.docs.get_mut(&uri) {
      if doc.version.is_none_or(|ver| ver <= new_ver) {
        doc.current = change.text;
        doc.version = Some(new_ver);
      }
    } else if let Some(ClientBuffer::Open { version, text }) = state.client_buffers.get_mut(&uri)
      && *version <= new_ver
    {
      *version = new_ver;
      *text = change.text;
    }
  }

  async fn did_close(&self, params: DidCloseTextDocumentParams) {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let removed = {
      let mut state = self.engine.write_state();
      if !state.docs.contains_key(&uri) {
        if state.client_buffers.contains_key(&uri) {
          state
            .client_buffers
            .insert(uri.clone(), ClientBuffer::Closed);
        }
        false
      } else {
        let keep_preview = self.readonly_documents.load(Ordering::Relaxed)
          && state.docs.get(&uri).is_some_and(|doc| {
            state
              .pending
              .get(&doc.md5)
              .and_then(|plan| plan.expected.get(&uri))
              .is_some_and(|expected| matches_text(&doc.current, expected))
          });
        if let Some(doc) = state.docs.get_mut(&uri) {
          if !keep_preview {
            doc.current = doc.base.clone();
          }
          doc.version = None;
        }
        if keep_preview {
          false
        } else {
          state.close_document(&uri);
          !state.docs.contains_key(&uri)
        }
      }
    };
    if removed {
      self.client.publish_diagnostics(uri, vec![], None).await;
    }
  }

  async fn did_save(&self, params: DidSaveTextDocumentParams) {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let md5 = self
      .engine
      .read_state()
      .docs
      .get(&uri)
      .map(|d| d.md5.clone());
    let result = match self.engine.save(&uri, params.text).await {
      Ok(changes) => self.apply_refresh(changes).await,
      Err(e) => Err(e),
    };
    if let Err(error) = result {
      self
        .client
        .show_message(MessageType::ERROR, format!("Ghidra save: {error:#}"))
        .await;
    } else {
      self.report(&uri).await;
      if let Some(md5) = md5 {
        self.changed(&md5).await;
      }
    }
  }

  async fn hover(&self, params: HoverParams) -> jsonrpc::Result<Option<Hover>> {
    self.handle_hover(params).await
  }

  async fn completion(
    &self,
    params: CompletionParams,
  ) -> jsonrpc::Result<Option<CompletionResponse>> {
    let p = params.text_document_position;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let items = self
      .engine
      .completion(&uri, p.position)
      .await
      .map_err(rpc)?;
    Ok(Some(CompletionResponse::Array(items)))
  }

  async fn semantic_tokens_full(
    &self,
    params: SemanticTokensParams,
  ) -> jsonrpc::Result<Option<SemanticTokensResult>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let state = self.engine.read_state();
    let Some(doc) = state.docs.get(&uri) else {
      return Ok(None);
    };
    Ok(Some(SemanticTokensResult::Tokens(SemanticTokens {
      result_id: None,
      data: workbench::semantic_tokens(doc),
    })))
  }

  async fn code_action(
    &self,
    params: CodeActionParams,
  ) -> jsonrpc::Result<Option<CodeActionResponse>> {
    let includes = |kind: &CodeActionKind| {
      params.context.only.as_ref().is_none_or(|only| {
        only.iter().any(|requested| {
          requested.as_str().is_empty()
            || kind.as_str() == requested.as_str()
            || kind
              .as_str()
              .starts_with(&format!("{}.", requested.as_str()))
        })
      })
    };
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let state = self.engine.read_state();
    let Some(doc) = state.docs.get(&uri) else {
      return Ok(None);
    };
    let Some(entry) = doc.entry.as_deref() else {
      return Ok(Some(vec![]));
    };
    if !doc.clean() {
      return Ok(Some(vec![]));
    }
    let Some(byte) = offset(&doc.base, params.range.start) else {
      return Ok(Some(vec![]));
    };
    let mut actions = Vec::new();
    if includes(&CodeActionKind::QUICKFIX) {
      let location = doc.code_location(params.range.start);
      let (title, disabled) = match location {
        Ok(Some(location)) => match &location.code_unit_address {
          Some(address) => (format!("Edit comments at {address}…"), None),
          None => (
            "Edit comments…".into(),
            Some(CodeActionDisabled {
              reason:
                "The selected position has no CodeUnit. Select a code or data unit in Listing."
                  .into(),
            }),
          ),
        },
        Ok(None) => (
          "Edit comments…".into(),
          Some(CodeActionDisabled {
            reason:
              "The cursor has no valid code context. Select a code token before editing comments."
                .into(),
          }),
        ),
        Err(error) => (
          "Edit comments…".into(),
          Some(CodeActionDisabled {
            reason: error.to_string(),
          }),
        ),
      };
      let command = disabled.is_none().then(|| Command {
        title: title.clone(),
        command: "ghidraLsp.editComment".into(),
        arguments: Some(vec![json!({
          "md5": doc.md5,
          "uri": doc.uri,
          "position": params.range.start,
          "version": doc.version,
        })]),
      });
      actions.push(CodeActionOrCommand::CodeAction(CodeAction {
        title,
        kind: Some(CodeActionKind::QUICKFIX),
        command,
        disabled,
        ..Default::default()
      }));
    }
    if !includes(&CodeActionKind::REFACTOR) {
      return Ok(Some(actions));
    }
    let address = doc
      .spans
      .iter()
      .find(|span| span.start <= byte && byte < span.end)
      .and_then(|span| span.token.address.as_deref())
      .unwrap_or(entry);
    let resource = json!({
      "md5": doc.md5,
      "uri": doc.uri,
      "position": params.range.start,
      "entry": entry,
      "address": address,
    });
    actions.extend(
      [
        ("Inspect data type", "ghidraLsp.inspectType"),
        ("Edit function signature", "ghidraLsp.editFunction"),
        ("Edit variables and parameters", "ghidraLsp.editVariables"),
        ("Show assembly listing", "ghidraLsp.showListing"),
        ("Show control-flow graph", "ghidraLsp.showControlFlow"),
        ("Show call graph", "ghidraLsp.showCallGraph"),
        ("Show callers", "ghidraLsp.showCallers"),
        ("Show callees", "ghidraLsp.showCallees"),
        ("Show references", "ghidraLsp.showReferences"),
      ]
      .into_iter()
      .map(|(title, command)| {
        CodeActionOrCommand::CodeAction(CodeAction {
          title: title.into(),
          kind: Some(CodeActionKind::REFACTOR),
          command: Some(Command {
            title: title.into(),
            command: command.into(),
            arguments: Some(vec![resource.clone()]),
          }),
          ..Default::default()
        })
      }),
    );
    Ok(Some(actions))
  }

  async fn signature_help(
    &self,
    params: SignatureHelpParams,
  ) -> jsonrpc::Result<Option<SignatureHelp>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    self
      .engine
      .signature_help(&uri, p.position)
      .await
      .map_err(rpc)
  }

  async fn goto_definition(
    &self,
    params: GotoDefinitionParams,
  ) -> jsonrpc::Result<Option<GotoDefinitionResponse>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let location = self
      .engine
      .goto_definition(&uri, p.position)
      .await
      .map_err(rpc)?;
    if let Some(loc) = &location
      && loc.uri.as_str().contains("/symbol/")
      && let Ok(parsed) = url::Url::parse(loc.uri.as_str())
      && let Some(md5) = parsed.host_str()
    {
      self.changed(md5).await;
    }
    Ok(location.map(GotoDefinitionResponse::Scalar))
  }

  async fn goto_declaration(
    &self,
    params: GotoDeclarationParams,
  ) -> jsonrpc::Result<Option<GotoDeclarationResponse>> {
    self.goto_definition(params).await
  }

  async fn goto_implementation(
    &self,
    params: GotoImplementationParams,
  ) -> jsonrpc::Result<Option<GotoImplementationResponse>> {
    self.goto_definition(params).await
  }

  async fn goto_type_definition(
    &self,
    params: GotoDefinitionParams,
  ) -> jsonrpc::Result<Option<GotoDefinitionResponse>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let location = self
      .engine
      .goto_type_definition(&uri, p.position)
      .await
      .map_err(rpc)?;
    if let Some(loc) = &location
      && let Ok(parsed) = url::Url::parse(loc.uri.as_str())
      && let Some(md5) = parsed.host_str()
    {
      self.changed(md5).await;
    }
    Ok(location.map(GotoDefinitionResponse::Scalar))
  }

  async fn references(&self, params: ReferenceParams) -> jsonrpc::Result<Option<Vec<Location>>> {
    let p = params.text_document_position;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let Ok((md5, symbol, _)) = self.engine.target(&uri, p.position) else {
      return Ok(None);
    };
    let locations = self
      .engine
      .references(&md5, &symbol, params.context.include_declaration)
      .await
      .map_err(rpc)?;
    if locations
      .iter()
      .any(|location| location.uri.as_str().contains("/references/"))
    {
      self.changed(&md5).await;
    }
    Ok(Some(locations))
  }

  async fn document_highlight(
    &self,
    params: DocumentHighlightParams,
  ) -> jsonrpc::Result<Option<Vec<DocumentHighlight>>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    self
      .engine
      .document_highlight(&uri, p.position)
      .map_err(rpc)
  }

  async fn prepare_rename(
    &self,
    params: TextDocumentPositionParams,
  ) -> jsonrpc::Result<Option<PrepareRenameResponse>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let Ok((_, symbol, range)) = self.engine.target(&uri, params.position) else {
      return Ok(None);
    };
    Ok(Some(PrepareRenameResponse::RangeWithPlaceholder {
      range,
      placeholder: symbol.name,
    }))
  }

  async fn rename(&self, params: RenameParams) -> jsonrpc::Result<Option<WorkspaceEdit>> {
    let p = params.text_document_position;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    Ok(Some(
      self
        .engine
        .rename(&uri, p.position, &params.new_name)
        .map_err(rpc)?,
    ))
  }

  async fn document_symbol(
    &self,
    params: DocumentSymbolParams,
  ) -> jsonrpc::Result<Option<DocumentSymbolResponse>> {
    self.handle_document_symbol(params).await
  }

  async fn symbol(
    &self,
    params: WorkspaceSymbolParams,
  ) -> jsonrpc::Result<Option<WorkspaceSymbolResponse>> {
    self.handle_workspace_symbol(params).await
  }

  async fn symbol_resolve(&self, params: WorkspaceSymbol) -> jsonrpc::Result<WorkspaceSymbol> {
    self.handle_symbol_resolve(params).await
  }

  async fn inlay_hint(&self, params: InlayHintParams) -> jsonrpc::Result<Option<Vec<InlayHint>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    self.engine.inlay_hints(&uri, params.range).map_err(rpc)
  }

  async fn prepare_call_hierarchy(
    &self,
    params: CallHierarchyPrepareParams,
  ) -> jsonrpc::Result<Option<Vec<CallHierarchyItem>>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    self
      .engine
      .prepare_call_hierarchy(&uri, p.position)
      .await
      .map_err(rpc)
  }

  async fn incoming_calls(
    &self,
    params: CallHierarchyIncomingCallsParams,
  ) -> jsonrpc::Result<Option<Vec<CallHierarchyIncomingCall>>> {
    self.engine.incoming_calls(&params.item).await.map_err(rpc)
  }

  async fn outgoing_calls(
    &self,
    params: CallHierarchyOutgoingCallsParams,
  ) -> jsonrpc::Result<Option<Vec<CallHierarchyOutgoingCall>>> {
    self.engine.outgoing_calls(&params.item).await.map_err(rpc)
  }

  async fn code_lens(&self, params: CodeLensParams) -> jsonrpc::Result<Option<Vec<CodeLens>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    self.engine.code_lenses(&uri).map_err(rpc)
  }

  async fn folding_range(
    &self,
    params: FoldingRangeParams,
  ) -> jsonrpc::Result<Option<Vec<FoldingRange>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    self.engine.folding_ranges(&uri).map_err(rpc)
  }

  async fn document_link(
    &self,
    params: DocumentLinkParams,
  ) -> jsonrpc::Result<Option<Vec<DocumentLink>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    self.engine.document_links(&uri).map_err(rpc)
  }
}
