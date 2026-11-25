// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Language Server Protocol state, virtual buffer synchronization, and command dispatch.

/// Custom command execution handlers for session, function, and location actions.
mod commands;
/// Domain command handlers for binaries, queries, mutations, and rename lifecycle.
mod domain_commands;
/// String lookup and comment, prototype, variable, and type-document handlers.
mod edit_commands;
/// `LanguageServer` trait implementation for [`Server`].
mod lsp;
/// Document and workspace symbol search handlers.
mod symbols;
/// Bounded view-command handlers for listing, memory, inspector, and graph views.
mod view_commands;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use tokio::sync::{Mutex, OwnedMutexGuard};
use tower_lsp_server::ls_types::{
  Diagnostic, DiagnosticSeverity, DocumentChanges, ExecuteCommandParams, Hover, HoverContents,
  HoverParams, MarkupContent, MarkupKind, OneOf, OptionalVersionedTextDocumentIdentifier, Position,
  Range, TextDocumentEdit, TextEdit, Uri, WorkspaceEdit, notification,
};
use tower_lsp_server::{Client, jsonrpc};

use crate::backend::{Config, McpBackend};
use crate::document::{canonical_virtual_uri, data_type_name, position};
use crate::engine::{Engine, EngineState, Refresh};
use crate::workbench;

/// Command identifiers advertised during `initialize`.
const COMMANDS: &[&str] = &[
  "ghidra.sessions",
  "ghidra.selectSession",
  "ghidra.openBinary",
  "ghidra.beginOpenBinary",
  "ghidra.pollOpenBinary",
  "ghidra.beginReanalyze",
  "ghidra.functions",
  "ghidra.program",
  "ghidra.symbols",
  "ghidra.types",
  "ghidra.type",
  "ghidra.strings",
  "ghidra.typeDocument",
  "ghidra.validateTypeDocument",
  "ghidra.saveTypeDocument",
  "ghidra.programMeta",
  "ghidra.resolveTarget",
  "ghidra.listingWindow",
  "ghidra.memoryWindow",
  "ghidra.inspectBytes",
  "ghidra.controlFlowGraph",
  "ghidra.callGraph",
  "ghidra.commentsAt",
  "ghidra.saveComment",
  "ghidra.functionPrototype",
  "ghidra.saveFunctionPrototype",
  "ghidra.saveVariables",
  "ghidra.openSymbol",
  "ghidra.openFunction",
  "ghidra.refresh",
  "ghidra.discardRename",
  "ghidra.renameState",
  "ghidra.document",
  "ghidra.saveDocument",
  "ghidra.refreshDocument",
  "ghidra.query",
  "ghidra.mutate",
  "ghidra.location",
  "ghidra.reveal",
  "ghidra.typeAtPosition",
  "ghidra.binaryInterface",
  "ghidra.closeSession",
  "ghidra.reanalyze",
  "ghidra.cancelJob",
  "ghidra.configure",
];

/// Custom LSP notification emitted when cached backend views change for a session.
enum Changed {}

impl notification::Notification for Changed {
  type Params = Value;
  const METHOD: &'static str = "ghidra/changed";
}

/// Analysis completion flags reported for an open Ghidra program session.
#[derive(Clone, Copy, Default)]
struct ProgramAnalysis {
  /// Whether `analysis.get` reports that program analysis finished.
  analyzed: bool,
  /// Whether background program analysis is currently running.
  running: bool,
}

/// Progress snapshot tracked for an asynchronous binary-open or reanalysis job.
#[derive(Clone)]
struct OpenProgress {
  /// Lowercase 32-character MD5 hash of the target session.
  md5: String,
  /// Current operation stage (`opening`, `analysis`, or `ready`).
  phase: &'static str,
  /// Active backend job identifier when a backend job is running.
  job_id: Option<String>,
  /// Terminal error text recorded when the operation fails.
  error: Option<String>,
  /// Optional human-readable progress text from the backend job.
  detail: Option<String>,
  /// Optional completion percentage from `0.0` to `100.0`.
  percentage: Option<f64>,
  /// Whether opening a binary should start auto-analysis once opening completes.
  analyze_requested: bool,
  /// Most recent analysis status observed for the session.
  analysis: ProgramAnalysis,
}

impl OpenProgress {
  /// Formats this progress state into a JSON payload keyed by `token`.
  fn value(&self, token: &str) -> Value {
    let state = if self.error.is_some() {
      "failed"
    } else if self.phase == "ready" {
      "ready"
    } else {
      "pending"
    };
    json!({
      "token": token,
      "md5": self.md5,
      "state": state,
      "stage": self.phase,
      "phase": self.phase,
      "jobId": self.job_id,
      "error": self.error,
      "detail": self.detail,
      "percentage": self.percentage,
      "analyzed": self.analysis.analyzed,
      "analysisRunning": self.analysis.running,
    })
  }
}

/// Language server instance handling LSP requests and MCP backend coordination.
pub(crate) struct Server {
  /// Connected LSP client used for progress and diagnostic notifications.
  client: Client,
  /// Dedicated synchronous lock storing the active `ghidra-mcp` transport handle.
  backend: RwLock<Arc<McpBackend>>,
  /// Concurrent engine coordinating singleflight RPCs and isolated in-memory state.
  engine: Engine,
  /// Shared cache of program metadata and call-graph lookups.
  pub(super) view_cache: crate::views::ViewCache,
  /// Baseline transport configuration merged with client `initializationOptions`.
  default_config: Config,
  /// Whether the client resolves workspace symbol ranges lazily.
  lazy_symbols: AtomicBool,
  /// Whether the client opens virtual documents in read-only mode.
  readonly_documents: AtomicBool,
  /// In-flight binary open and reanalysis progress entries keyed by client token.
  open_jobs: Mutex<HashMap<String, OpenProgress>>,
  /// Monotonic counter used to allocate unique open-progress tokens.
  next_job: AtomicU64,
}

impl Server {
  /// Creates a new LSP server instance with `client` and initial `config`.
  pub(crate) fn new(client: Client, config: Config) -> Self {
    let backend = Arc::new(McpBackend::new(config.clone()));
    Self {
      client,
      backend: RwLock::new(Arc::clone(&backend)),
      engine: Engine::new(backend),
      view_cache: crate::views::ViewCache::new(),
      default_config: config,
      lazy_symbols: AtomicBool::new(false),
      readonly_documents: AtomicBool::new(false),
      open_jobs: Mutex::new(HashMap::new()),
      next_job: AtomicU64::new(1),
    }
  }

  /// Clones the active [`McpBackend`] handle without locking [`EngineState`].
  pub(super) fn backend(&self) -> Arc<McpBackend> {
    self
      .backend
      .read()
      .unwrap_or_else(PoisonError::into_inner)
      .clone()
  }

  /// Replaces the [`McpBackend`] transport and resets [`Engine`] caches.
  pub(super) fn swap_backend(&self, backend: Arc<McpBackend>) {
    *self.backend.write().unwrap_or_else(PoisonError::into_inner) = Arc::clone(&backend);
    self.engine.reset(backend);
  }

  /// Queries `analysis.get` for `md5` and normalizes completion flags.
  async fn program_analysis(&self, md5: &str) -> Result<ProgramAnalysis> {
    let backend = self.backend();
    let status = backend
      .call("analysis", "get", Some(md5), json!({}))
      .await?;
    // Older bridges can finish an analysis without setting the native program flag.
    Ok(ProgramAnalysis {
      analyzed: status.get("analyzed").and_then(Value::as_bool) == Some(true)
        || status.get("status").and_then(Value::as_str) == Some("completed"),
      running: status.get("status").and_then(Value::as_str) == Some("running"),
    })
  }

  /// Notifies the client that state for session `md5` changed.
  async fn changed(&self, md5: &str) {
    self.view_cache.invalidate(md5).await;
    self
      .client
      .send_notification::<Changed>(json!({"md5": md5}))
      .await;
  }

  /// Verifies that session `md5` has no pending rename or unsaved local edits.
  fn ensure_program_clean(state: &EngineState, md5: &str) -> Result<()> {
    ensure!(
      !state.pending.contains_key(md5),
      "Save or discard the pending rename in this program before another modification"
    );
    ensure!(
      !state.docs.values().any(|d| d.md5 == md5 && !d.clean()),
      "Discard unrelated edits in this program before modifying Ghidra"
    );
    Ok(())
  }

  /// Persists a backend write, refreshes session documents, and pushes editor updates.
  async fn commit_and_refresh(
    &self,
    session_guard: OwnedMutexGuard<()>,
    backend: &McpBackend,
    md5: &str,
    already_saved_result: Option<&Value>,
  ) -> Result<()> {
    let persisted = if let Some(result) = already_saved_result {
      workbench::confirm_saved(result)
    } else {
      workbench::persist(backend, md5).await
    };
    if let Err(error) = persisted {
      drop(session_guard);
      self.changed(md5).await;
      return Err(error).context(
        "Modification reached Ghidra, but saving the project failed. Refresh and inspect the program before retrying",
      );
    }
    let changes = self.engine.refresh_session_locked(md5, None).await;
    drop(session_guard);
    self.changed(md5).await;
    self
      .apply_refresh(changes.context(
        "Modification was saved, but function regeneration failed. Refresh Documents to recover",
      )?)
      .await
  }

  /// Resolves the target session MD5 from `arg.md5` or the currently active session.
  fn scoped_md5(&self, arg: &Value) -> Result<String> {
    let md5 = match arg.get("md5").and_then(Value::as_str) {
      Some(md5) => md5.to_lowercase(),
      None => self.engine.read_state().session()?.to_owned(),
    };
    ensure!(
      md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit()),
      "invalid session MD5"
    );
    Ok(md5)
  }

  /// Publishes or clears warning diagnostics attached to virtual document `uri`.
  async fn report(&self, uri: &Uri) {
    let canon = canonical_virtual_uri(uri);
    let diagnostics = {
      let state = self.engine.read_state();
      state
        .docs
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

  /// Applies regenerated virtual document text edits to the LSP client and updates `docs`.
  async fn apply_refresh(&self, changes: Vec<Refresh>) -> Result<()> {
    if changes.is_empty() {
      return Ok(());
    }
    let edit = WorkspaceEdit {
      document_changes: Some(DocumentChanges::Edits(
        changes
          .iter()
          .map(|c| TextDocumentEdit {
            text_document: OptionalVersionedTextDocumentIdentifier {
              uri: c.uri.clone(),
              version: c.version,
            },
            edits: vec![OneOf::Left(TextEdit::new(
              Range::new(Position::default(), position(&c.old, c.old.len())),
              c.new.clone(),
            ))],
          })
          .collect(),
      )),
      ..Default::default()
    };
    let response = self.client.apply_edit(edit).await?;
    ensure!(
      response.applied,
      "Ghidra was updated but the editor rejected regenerated text. Refresh the documents: {:?}",
      response.failure_reason
    );
    let mut state = self.engine.write_state();
    for change in changes {
      if let Some(doc) = state.docs.get_mut(&change.uri) {
        // Never overwrite a concurrent unrelated user edit inside the synchronized buffer.
        if doc.current == change.old || doc.current == change.new {
          doc.current = change.new;
        }
      }
      state.refresh_allowed.remove(&change.uri);
    }
    Ok(())
  }

  /// Polls backend `job.get` until `job` finishes or reaches the 10-minute wait limit.
  async fn wait_job(&self, job: &Value) -> Result<()> {
    let Some(id) = job
      .get("id")
      .or_else(|| job.get("jobId"))
      .and_then(Value::as_str)
    else {
      bail!("backend did not return a job ID: {job}");
    };
    let backend = self.backend();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
    loop {
      let state = backend
        .call("job", "get", None, json!({"jobId": id}))
        .await?;
      let job = state.get("job").unwrap_or(&state);
      match job.get("status").and_then(Value::as_str) {
        Some("completed") => return Ok(()),
        Some("failed" | "cancelled") => bail!("Ghidra job failed: {job}"),
        _ => {}
      }
      ensure!(
        tokio::time::Instant::now() < deadline,
        "Analysis wait exceeded ten minutes; the shared backend job continues"
      );
      tokio::time::sleep(Duration::from_millis(500)).await;
    }
  }

  /// Opens a backend session from a filesystem `path` or an existing saved program `md5`.
  async fn open_session(&self, arg: &Value) -> Result<Value> {
    ensure!(
      arg.get("path").is_some() != arg.get("md5").is_some(),
      "provide exactly one binary path or saved program MD5"
    );
    let (md5, parameters) = if let Some(path) = arg.get("path") {
      let path = path
        .as_str()
        .filter(|path| !path.trim().is_empty())
        .context("path must be a nonempty string")?;
      (None, json!({"path": path}))
    } else {
      ensure!(
        arg.get("md5").and_then(Value::as_str).is_some(),
        "md5 must be a string"
      );
      (Some(self.scoped_md5(arg)?), json!({}))
    };
    let backend = self.backend();
    let opened = backend
      .call("session", "open", md5.as_deref(), parameters)
      .await?;
    if let Some(expected) = md5 {
      let actual = opened
        .pointer("/session/md5")
        .or_else(|| opened.pointer("/session/id"))
        .and_then(Value::as_str)
        .context("session has no MD5")?;
      ensure!(
        actual.eq_ignore_ascii_case(&expected),
        "backend opened a different saved program"
      );
    }
    Ok(opened)
  }

  /// Dispatches one `workspace/executeCommand` invocation.
  async fn command(&self, params: ExecuteCommandParams) -> Result<Value> {
    let arg = params.arguments.first().cloned().unwrap_or(json!({}));
    if params.command == "ghidra.location" {
      return self.execute_location_command(arg);
    }
    let backend = self.backend();
    match params.command.as_str() {
      "ghidra.sessions"
      | "ghidra.selectSession"
      | "ghidra.functions"
      | "ghidra.openFunction"
      | "ghidra.openSymbol"
      | "ghidra.document"
      | "ghidra.configure"
      | "ghidra.reveal"
      | "ghidra.typeAtPosition" => {
        self
          .execute_session_command(&params.command, arg, backend.as_ref())
          .await
      }
      "ghidra.strings"
      | "ghidra.typeDocument"
      | "ghidra.validateTypeDocument"
      | "ghidra.saveTypeDocument"
      | "ghidra.commentsAt"
      | "ghidra.saveComment"
      | "ghidra.functionPrototype"
      | "ghidra.saveFunctionPrototype"
      | "ghidra.saveVariables" => {
        self
          .execute_edit_command(&params.command, arg, backend.as_ref())
          .await
      }
      "ghidra.programMeta"
      | "ghidra.resolveTarget"
      | "ghidra.listingWindow"
      | "ghidra.memoryWindow"
      | "ghidra.inspectBytes"
      | "ghidra.controlFlowGraph"
      | "ghidra.callGraph" => {
        self
          .execute_view_command(&params.command, arg, backend.as_ref())
          .await
      }
      _ => {
        self
          .execute_domain_command(&params.command, arg, backend.as_ref())
          .await
      }
    }
  }

  /// Resolves Markdown hover cards for symbols, functions, globals, locals, and data types.
  async fn handle_hover(&self, params: HoverParams) -> jsonrpc::Result<Option<Hover>> {
    let p = params.text_document_position_params;
    let uri = canonical_virtual_uri(&p.text_document.uri);
    let target = {
      let state = self.engine.read_state();
      state
        .target(&uri, p.position)
        .ok()
        .map(|(md5, symbol, range)| {
          let local = state.local_detail(&symbol);
          let cached_fn = state
            .functions
            .get(&(md5.clone(), symbol.address.clone()))
            .cloned();
          (md5, symbol, range, local, cached_fn)
        })
    };
    if let Some((md5, symbol, range, local, cached_fn)) = target {
      let backend = self.backend();
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

    if let Ok(Some(type_data)) = self.engine.type_definition(&uri, p.position).await {
      let range = {
        let state = self.engine.read_state();
        state
          .docs
          .get(&uri)
          .and_then(|d| d.span_at(p.position).map(|s| d.range(s)))
      };
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

/// Extracts a backend job identifier from nested or top-level job response fields.
fn job_id(response: &Value) -> Option<String> {
  response
    .pointer("/job/id")
    .or_else(|| response.pointer("/job/jobId"))
    .or_else(|| response.get("jobId"))
    .or_else(|| response.get("id"))
    .and_then(Value::as_str)
    .map(str::to_owned)
}

/// Converts any displayable error into a JSON-RPC `INVALID_PARAMS` error.
fn rpc(error: impl std::fmt::Display) -> jsonrpc::Error {
  jsonrpc::Error::invalid_params(format!("{error:#}"))
}
