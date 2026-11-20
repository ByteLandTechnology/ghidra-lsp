// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! LSP protocol handlers for [`Server`].

use std::sync::Arc;
use std::sync::atomic::Ordering;

use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  CallHierarchyIncomingCall, CallHierarchyIncomingCallsParams, CallHierarchyItem,
  CallHierarchyOutgoingCall, CallHierarchyOutgoingCallsParams, CallHierarchyPrepareParams,
  CallHierarchyServerCapability, CodeLens, CodeLensOptions, CodeLensParams, CompletionOptions,
  CompletionParams, CompletionResponse, DeclarationCapability, DidChangeTextDocumentParams,
  DidCloseTextDocumentParams, DidOpenTextDocumentParams, DocumentHighlight,
  DocumentHighlightParams, DocumentLink, DocumentLinkOptions, DocumentLinkParams,
  DocumentSymbolParams, DocumentSymbolResponse, ExecuteCommandOptions, ExecuteCommandParams,
  FoldingRange, FoldingRangeParams, FoldingRangeProviderCapability, GotoDefinitionParams,
  GotoDefinitionResponse, Hover, HoverContents, HoverParams, HoverProviderCapability,
  ImplementationProviderCapability, InitializeParams, InitializeResult, InlayHint, InlayHintParams,
  Location, MarkupContent, MarkupKind, OneOf, PositionEncodingKind, ReferenceParams,
  SemanticTokens, SemanticTokensFullOptions, SemanticTokensOptions, SemanticTokensParams,
  SemanticTokensResult, SemanticTokensServerCapabilities, ServerCapabilities, ServerInfo,
  SignatureHelp, SignatureHelpOptions, SignatureHelpParams, TextDocumentSyncCapability,
  TextDocumentSyncKind, TextDocumentSyncOptions, TypeDefinitionProviderCapability, WorkspaceSymbol,
  WorkspaceSymbolOptions, WorkspaceSymbolParams, WorkspaceSymbolResponse,
  request::{GotoDeclarationParams, GotoDeclarationResponse},
  request::{GotoImplementationParams, GotoImplementationResponse},
};
use tower_lsp_server::{LanguageServer, jsonrpc};

use super::{COMMANDS, Server, format_storage, rpc};
use crate::backend::{Config, McpBackend};
use crate::document::{Document, SHOW_TEMPLATE_ARGUMENTS, canonical_virtual_uri, data_type_name};
use crate::engine::Engine;
use crate::workbench;

impl LanguageServer for Server {
  async fn initialize(&self, params: InitializeParams) -> jsonrpc::Result<InitializeResult> {
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

  async fn hover(&self, params: HoverParams) -> jsonrpc::Result<Option<Hover>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let target = {
      let e = self.engine.lock().await;
      e.target(&uri, p.position).ok().map(|(md5, symbol, range)| {
        let local = e.local_detail(&symbol);
        let cached_fn = e
          .functions
          .get(&(md5.clone(), symbol.address.clone()))
          .cloned();
        let backend = e.backend.clone();
        (md5, symbol, range, local, cached_fn, backend)
      })
    };
    if let Some((md5, symbol, range, local, cached_fn, backend)) = target {
      let detail = if let Some(local) = local {
        let dtype = local
          .get("data_type")
          .filter(|v| !v.is_null())
          .map(data_type_name)
          .unwrap_or_default();
        let storage = format_storage(local.get("storage"));
        match (dtype.is_empty(), storage.is_empty()) {
          (false, false) => format!("```c\n{dtype}\n```\n\n`{storage}`"),
          (false, true) => format!("```c\n{dtype}\n```"),
          (true, false) => format!("`{storage}`"),
          (true, true) => String::new(),
        }
      } else if symbol.kind.eq_ignore_ascii_case("function") {
        let value = match cached_fn {
          Some(v) => Some(v),
          None => backend
            .call(
              "function",
              "get",
              Some(&md5),
              json!({"selector": {"entry": symbol.address}}),
            )
            .await
            .ok(),
        };
        let signature = value
          .as_ref()
          .and_then(|v| {
            v.get("signature").map(|sig| {
              sig
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| sig.to_string())
            })
          })
          .unwrap_or_else(|| symbol.display_name());
        let comment = value
          .as_ref()
          .and_then(|v| v.get("comment").and_then(Value::as_str))
          .unwrap_or("");
        if comment.is_empty() {
          format!("```c\n{signature}\n```")
        } else {
          format!("```c\n{signature}\n```\n\n{comment}")
        }
      } else {
        backend
          .call(
            "global_variable",
            "get",
            Some(&md5),
            json!({"selector": {"address": symbol.address}}),
          )
          .await
          .ok()
          .map(|value| {
            let dtype = value
              .get("data_type")
              .filter(|v| !v.is_null())
              .map(data_type_name)
              .unwrap_or_default();
            let repr = value
              .get("representation")
              .or_else(|| value.get("value"))
              .map(|v| {
                v.as_str()
                  .map(str::to_owned)
                  .unwrap_or_else(|| v.to_string())
              })
              .unwrap_or_default();
            match (dtype.is_empty(), repr.is_empty()) {
              (false, false) => format!("```c\n{dtype}\n```\n\n`{repr}`"),
              (false, true) => format!("```c\n{dtype}\n```"),
              (true, false) => format!("`{repr}`"),
              (true, true) => String::new(),
            }
          })
          .unwrap_or_default()
      };
      let demangled_full = symbol.full_name();
      let raw_mangled =
        (!symbol.name.is_empty() && symbol.name != demangled_full).then_some(symbol.name.as_str());
      let extra_names = match (symbol.display_name() != demangled_full, raw_mangled) {
        (true, Some(raw)) => format!(
          "\n\n`{}` (`{}`)",
          demangled_full.replace('`', "'"),
          raw.replace('`', "'")
        ),
        (true, None) => format!("\n\n`{}`", demangled_full.replace('`', "'")),
        (false, Some(raw)) => format!("\n\n`{}`", raw.replace('`', "'")),
        (false, None) => String::new(),
      };
      return Ok(Some(Hover {
        contents: HoverContents::Markup(MarkupContent {
          kind: MarkupKind::Markdown,
          value: format!(
            "### {}\n`{} · {}`{}{}",
            symbol
              .display_name()
              .chars()
              .fold(String::new(), |mut text, ch| {
                if ch.is_ascii_punctuation() {
                  text.push('\\');
                }
                text.push(ch);
                text
              }),
            symbol.kind,
            symbol.address,
            extra_names,
            if detail.is_empty() {
              String::new()
            } else {
              format!("\n\n{detail}")
            }
          ),
        }),
        range: Some(range),
      }));
    }

    let mut e = self.engine.lock().await;
    if let Ok(Some(type_data)) = e.type_definition(&uri, p.position).await {
      let doc = e.docs.get(&uri);
      let range = doc.and_then(|d| d.span_at(p.position).map(|s| d.range(s)));
      let name = type_data
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Type");
      let kind = type_data
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("type");
      let path = type_data.get("path").and_then(Value::as_str).unwrap_or("");
      let length = type_data
        .get("length")
        .or_else(|| type_data.get("size"))
        .and_then(Value::as_u64)
        .map(|s| format!("{s} bytes (`0x{s:x}`)"))
        .unwrap_or_else(|| "variable/unknown".into());
      let value = format!("```c\n{kind} {name}\n```\n- **Path**: `{path}`\n- **Size**: {length}");
      return Ok(Some(Hover {
        contents: HoverContents::Markup(MarkupContent {
          kind: MarkupKind::Markdown,
          value,
        }),
        range,
      }));
    }
    Ok(None)
  }

  async fn completion(
    &self,
    params: CompletionParams,
  ) -> jsonrpc::Result<Option<CompletionResponse>> {
    let p = params.text_document_position;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let items = self
      .engine
      .lock()
      .await
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
    let e = self.engine.lock().await;
    let Some(doc) = e.docs.get(&uri) else {
      return Ok(None);
    };
    Ok(Some(SemanticTokensResult::Tokens(SemanticTokens {
      result_id: None,
      data: workbench::semantic_tokens(doc),
    })))
  }

  async fn signature_help(
    &self,
    params: SignatureHelpParams,
  ) -> jsonrpc::Result<Option<SignatureHelp>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    self
      .engine
      .lock()
      .await
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
    let mut e = self.engine.lock().await;
    let location = e.goto_definition(&uri, p.position).await.map_err(rpc)?;
    drop(e);
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
    let mut e = self.engine.lock().await;
    let location = e
      .goto_type_definition(&uri, p.position)
      .await
      .map_err(rpc)?;
    drop(e);
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
    let mut e = self.engine.lock().await;
    let Ok((md5, symbol, _)) = e.target(&uri, p.position) else {
      return Ok(None);
    };
    let locations = e
      .references(&md5, &symbol, params.context.include_declaration)
      .await
      .map_err(rpc)?;
    drop(e);
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
    let e = self.engine.lock().await;
    e.document_highlight(&uri, p.position).map_err(rpc)
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
    let e = self.engine.lock().await;
    e.inlay_hints(&uri, params.range).map_err(rpc)
  }

  async fn prepare_call_hierarchy(
    &self,
    params: CallHierarchyPrepareParams,
  ) -> jsonrpc::Result<Option<Vec<CallHierarchyItem>>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let mut e = self.engine.lock().await;
    e.prepare_call_hierarchy(&uri, p.position)
      .await
      .map_err(rpc)
  }

  async fn incoming_calls(
    &self,
    params: CallHierarchyIncomingCallsParams,
  ) -> jsonrpc::Result<Option<Vec<CallHierarchyIncomingCall>>> {
    let mut e = self.engine.lock().await;
    e.incoming_calls(&params.item).await.map_err(rpc)
  }

  async fn outgoing_calls(
    &self,
    params: CallHierarchyOutgoingCallsParams,
  ) -> jsonrpc::Result<Option<Vec<CallHierarchyOutgoingCall>>> {
    let mut e = self.engine.lock().await;
    e.outgoing_calls(&params.item).await.map_err(rpc)
  }

  async fn code_lens(&self, params: CodeLensParams) -> jsonrpc::Result<Option<Vec<CodeLens>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let e = self.engine.lock().await;
    e.code_lenses(&uri).map_err(rpc)
  }

  async fn folding_range(
    &self,
    params: FoldingRangeParams,
  ) -> jsonrpc::Result<Option<Vec<FoldingRange>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let e = self.engine.lock().await;
    e.folding_ranges(&uri).map_err(rpc)
  }

  async fn document_link(
    &self,
    params: DocumentLinkParams,
  ) -> jsonrpc::Result<Option<Vec<DocumentLink>>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let e = self.engine.lock().await;
    e.document_links(&uri).map_err(rpc)
  }
}
