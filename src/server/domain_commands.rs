// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Custom `workspace/executeCommand` handlers for binaries, queries, mutations, and renames.

use std::sync::atomic::Ordering;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Map, Value, json};
use tower_lsp_server::ls_types::Uri;

use super::{OpenProgress, ProgramAnalysis, Server, job_error, job_id};
use crate::backend::{McpBackend, list_all};
use crate::document::{canonical_virtual_uri, matches_text};
use crate::workbench;

/// Optional string fields that `session.open` accepts for `.gpr` selection and firmware imports.
const OPEN_STRING_OPTIONS: [&str; 5] = [
  "programName",
  "processor",
  "compilerSpec",
  "loader",
  "baseAddress",
];

/// Copies optional `session.open` fields from `arg` into `parameters` and reports if any exist.
fn copy_open_options(arg: &Value, parameters: &mut Map<String, Value>) -> Result<bool> {
  let mut added = false;
  for field in OPEN_STRING_OPTIONS {
    if let Some(value) = arg.get(field).filter(|value| !value.is_null()) {
      let text = value
        .as_str()
        .with_context(|| format!("{field} must be a string"))?
        .trim();
      if !text.is_empty() {
        parameters.insert(field.to_owned(), json!(text));
        added = true;
      }
    }
  }
  if let Some(value) = arg.get("reimport").filter(|value| !value.is_null()) {
    let reimport = value.as_bool().context("reimport must be a boolean")?;
    parameters.insert(String::from("reimport"), json!(reimport));
    added = true;
  }
  Ok(added)
}

impl Server {
  /// Dispatches binary lifecycle, policy-checked MCP, and rename management commands.
  pub(super) async fn execute_domain_command(
    &self,
    command: &str,
    arg: Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    match command {
      "ghidra.beginOpenBinary" | "ghidra.beginReanalyze" => {
        self.handle_begin_job(command, &arg, backend).await
      }
      "ghidra.pollOpenBinary" => self.handle_poll_open_binary(&arg, backend).await,
      "ghidra.openBinary" => self.handle_open_binary(&arg, backend).await,
      "ghidra.closeSession" => self.handle_close_session(&arg, backend).await,
      "ghidra.reanalyze" => self.handle_reanalyze(&arg, backend).await,
      "ghidra.cancelJob" => self.handle_cancel_job(&arg, backend).await,
      "ghidra.binaryInterface" => {
        let md5 = self.scoped_md5(&arg).await?;
        crate::binary::interface(backend, &md5).await
      }
      "ghidra.query" => {
        let (domain, operation, _) = workbench::operation(&arg)?;
        let md5 = if workbench::session_required(domain, operation) {
          Some(self.scoped_md5(&arg).await?)
        } else {
          None
        };
        workbench::query(backend, md5.as_deref(), &arg).await
      }
      "ghidra.mutate" => self.handle_mutate(&arg, backend).await,
      "ghidra.renameState" => self.handle_rename_state(&arg).await,
      "ghidra.saveDocument" => self.handle_save_document(&arg).await,
      "ghidra.refreshDocument" => self.handle_refresh_document(&arg).await,
      "ghidra.program" | "ghidra.symbols" | "ghidra.types" | "ghidra.type" => {
        self.handle_catalog_command(command, &arg, backend).await
      }
      "ghidra.refresh" | "ghidra.discardRename" => {
        let md5 = self.scoped_md5(&arg).await?;
        self.view_cache.invalidate(&md5).await;
        let mut e = self.engine.lock().await;
        let changes = if command == "ghidra.refresh" {
          e.refresh_session(&md5, None).await?
        } else {
          e.discard(&md5).await?
        };
        let uris: Vec<Uri> = e
          .docs
          .values()
          .filter(|d| d.md5 == md5)
          .map(|d| d.uri.clone())
          .collect();
        drop(e);
        self.apply_refresh(changes).await?;
        for uri in uris {
          self.report(&uri).await;
        }
        self.changed(&md5).await;
        Ok(Value::Null)
      }
      _ => bail!("Unknown command: {command}"),
    }
  }

  /// Starts an asynchronous binary-open or reanalysis job and returns its polling token.
  async fn handle_begin_job(
    &self,
    command: &str,
    arg: &Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    let opening = command == "ghidra.beginOpenBinary";
    let (md5, response) = if opening {
      let response = self.open_session(arg, backend).await?;
      let md5 = response
        .pointer("/session/md5")
        .or_else(|| response.pointer("/session/id"))
        .and_then(Value::as_str)
        .context("session has no MD5")?
        .to_ascii_lowercase();
      (md5, response)
    } else {
      let md5 = self.scoped_md5(arg).await?;
      let e = self.engine.lock().await;
      ensure!(
        !e.pending.contains_key(&md5),
        "Save or discard the pending rename before analysis"
      );
      drop(e);
      crate::engine::record_checkpoint(backend, &md5, "Before program analysis").await?;
      let mut parameters = json!({});
      if let Some(analyzers) = arg.get("analyzers") {
        parameters["analyzers"] = analyzers.clone();
      }
      let response = backend
        .call("analysis", "start", Some(&md5), parameters)
        .await?;
      (md5, response)
    };
    let progress = OpenProgress {
      md5: md5.clone(),
      phase: if opening { "opening" } else { "analysis" },
      job_id: job_id(&response),
      error: None,
      detail: None,
      percentage: None,
      analyze_requested: opening && arg.get("analyze").and_then(Value::as_bool) == Some(true),
      analysis: ProgramAnalysis::default(),
    };
    ensure!(
      opening || progress.job_id.is_some(),
      "backend did not return an analysis job ID"
    );
    let token = format!("{md5}-{}", self.next_job.fetch_add(1, Ordering::Relaxed));
    let value = progress.value(&token);
    let mut jobs = self.open_jobs.lock().await;
    if jobs.len() >= 32 {
      jobs.retain(|_, p| p.phase != "ready" && p.error.is_none());
    }
    jobs.insert(token, progress);
    Ok(value)
  }

  /// Advances and reports status for an active binary-open or reanalysis job token.
  async fn handle_poll_open_binary(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let token = arg
      .get("token")
      .and_then(Value::as_str)
      .context("token is required")?;
    let mut progress = self
      .open_jobs
      .lock()
      .await
      .get(token)
      .cloned()
      .context("Unknown program operation; list sessions to recover the background task")?;
    if progress.phase == "ready" || progress.error.is_some() {
      return Ok(progress.value(token));
    }
    if let Some(id) = &progress.job_id {
      let state = backend
        .call("job", "get", None, json!({"jobId": id}))
        .await?;
      let job = state.get("job").unwrap_or(&state);
      match job.get("status").and_then(Value::as_str) {
        Some("completed") => {}
        Some("failed" | "cancelled") => {
          progress.error = Some(match job_error(job) {
            Some(reason) => format!("Ghidra {} job did not complete: {reason}", progress.phase),
            None => format!("Ghidra {} job did not complete", progress.phase),
          });
          progress.analysis.running = false;
          let md5 = progress.md5.clone();
          let value = progress.value(token);
          self
            .open_jobs
            .lock()
            .await
            .insert(token.to_owned(), progress);
          self.changed(&md5).await;
          return Ok(value);
        }
        _ => {
          progress.detail = job
            .get("message")
            .or_else(|| job.get("description"))
            .or_else(|| job.get("phase"))
            .and_then(Value::as_str)
            .map(str::to_owned);
          progress.percentage = [
            job.get("percentage"),
            job.get("progress"),
            job.pointer("/progress/progress"),
          ]
          .into_iter()
          .flatten()
          .find_map(Value::as_f64);
          self
            .open_jobs
            .lock()
            .await
            .insert(token.to_owned(), progress.clone());
          return Ok(progress.value(token));
        }
      }
    }
    if progress.phase == "opening" {
      progress.analysis = self.program_analysis(&progress.md5).await?;
      if progress.analyze_requested && !progress.analysis.analyzed && !progress.analysis.running {
        ensure!(
          !self.engine.lock().await.pending.contains_key(&progress.md5),
          "Save or discard the pending rename before analysis"
        );
        let started = backend
          .call("analysis", "start", Some(&progress.md5), json!({}))
          .await?;
        progress.job_id =
          Some(job_id(&started).context("backend did not return an analysis job ID")?);
        progress.phase = "analysis";
      } else {
        progress.job_id = None;
        progress.phase = "ready";
      }
    } else {
      workbench::persist(backend, &progress.md5)
        .await
        .context("Analysis completed, but project persistence failed")?;
      self.view_cache.invalidate(&progress.md5).await;
      let mut e = self.engine.lock().await;
      // Preserve in-flight rename previews started while analysis ran in the background.
      let changes = if e.pending.contains_key(&progress.md5) {
        vec![]
      } else {
        e.refresh_session(&progress.md5, None).await?
      };
      drop(e);
      self.apply_refresh(changes).await?;
      progress.analysis = self.program_analysis(&progress.md5).await?;
      progress.phase = "ready";
      self.changed(&progress.md5).await;
    }
    let value = progress.value(token);
    self
      .open_jobs
      .lock()
      .await
      .insert(token.to_owned(), progress);
    Ok(value)
  }

  /// Opens a backend session from a binary or `.gpr` `path`, or from a saved program `md5`.
  async fn open_session(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    ensure!(
      arg.get("path").is_some() != arg.get("md5").is_some(),
      "provide exactly one binary or .gpr path, or one saved program MD5"
    );
    let mut parameters = Map::new();
    let mut gpr_target = false;
    let md5 = if let Some(path) = arg.get("path") {
      let path = path
        .as_str()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .context("path must be a nonempty string")?;
      gpr_target = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gpr"));
      parameters.insert(String::from("path"), json!(path));
      None
    } else {
      ensure!(
        arg.get("md5").and_then(Value::as_str).is_some(),
        "md5 must be a string"
      );
      Some(self.scoped_md5(arg).await?)
    };
    let has_options = copy_open_options(arg, &mut parameters)?;
    if gpr_target || has_options {
      backend.check_extended_open(gpr_target).await?;
    }
    let opened = backend
      .call("session", "open", md5.as_deref(), Value::Object(parameters))
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

  /// Synchronously opens a program session, optionally runs analysis, and selects it.
  async fn handle_open_binary(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let opened = self.open_session(arg, backend).await?;
    let md5 = opened
      .pointer("/session/md5")
      .or_else(|| opened.pointer("/session/id"))
      .and_then(Value::as_str)
      .context("session has no MD5")?
      .to_ascii_lowercase();
    if let Some(job) = opened.get("job") {
      self.wait_job(job).await?;
    } else if let Some(id) = opened.get("jobId") {
      self.wait_job(&json!({"id": id})).await?;
    }
    let mut analysis = self.program_analysis(&md5).await?;
    if arg.get("analyze").and_then(Value::as_bool) == Some(true)
      && !analysis.analyzed
      && !analysis.running
    {
      ensure!(
        !self.engine.lock().await.pending.contains_key(&md5),
        "Save or discard the pending rename before analysis"
      );
      let started = backend
        .call("analysis", "start", Some(&md5), json!({}))
        .await?;
      self
        .wait_job(started.get("job").unwrap_or(&started))
        .await?;
      workbench::persist(backend, &md5)
        .await
        .context("Analysis completed, but project persistence failed")?;
      self.view_cache.invalidate(&md5).await;
      analysis = self.program_analysis(&md5).await?;
    }
    self.engine.lock().await.select(&md5).await?;
    Ok(json!({"md5": md5, "analyzed": analysis.analyzed, "analysisRunning": analysis.running}))
  }

  /// Closes a clean program session and clears cached engine state for that session.
  async fn handle_close_session(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let mut e = self.engine.lock().await;
    ensure!(
      !e.pending.contains_key(&md5),
      "Save or discard this program's pending rename before closing it"
    );
    ensure!(
      !e.docs.values().any(|d| d.md5 == md5 && !d.clean()),
      "Discard this program's unsaved edits before closing it"
    );
    let result = backend
      .call(
        "session",
        "close",
        Some(&md5),
        json!({"force": arg.get("force").and_then(Value::as_bool).unwrap_or(false)}),
      )
      .await?;
    e.forget_session(&md5);
    drop(e);
    self.view_cache.invalidate(&md5).await;
    for progress in self
      .open_jobs
      .lock()
      .await
      .values_mut()
      .filter(|p| p.md5 == md5 && p.phase != "ready")
    {
      progress.error = Some("The program was closed while its operation was pending".into());
    }
    self.changed(&md5).await;
    Ok(result)
  }

  /// Starts program analysis and optionally waits for completion and document regeneration.
  async fn handle_reanalyze(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let e = self.engine.lock().await;
    ensure!(
      !e.pending.contains_key(&md5),
      "Save or discard the pending rename before analysis"
    );
    drop(e);
    crate::engine::record_checkpoint(backend, &md5, "Before program analysis").await?;
    let mut parameters = json!({});
    if let Some(analyzers) = arg.get("analyzers") {
      parameters["analyzers"] = analyzers.clone();
    }
    let started = backend
      .call("analysis", "start", Some(&md5), parameters)
      .await?;
    let wait = arg.get("wait").and_then(Value::as_bool).unwrap_or(true);
    if wait {
      self
        .wait_job(started.get("job").unwrap_or(&started))
        .await?;
      workbench::persist(backend, &md5)
        .await
        .context("Analysis completed, but project persistence failed")?;
      self.view_cache.invalidate(&md5).await;
      let changes = self.engine.lock().await.refresh_session(&md5, None).await?;
      self.apply_refresh(changes).await?;
    }
    self.changed(&md5).await;
    Ok(json!({"md5": md5, "job": started.get("job").unwrap_or(&started), "waited": wait}))
  }

  /// Executes a policy-checked MCP write operation followed by project persistence and refresh.
  async fn handle_mutate(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let (domain, operation, parameters) = workbench::operation(arg)?;
    workbench::allow_write(domain, operation, &parameters)?;
    let e = self.engine.lock().await;
    Self::ensure_program_clean(&e, &md5)?;
    if (domain, operation) != ("program", "save") {
      crate::engine::record_checkpoint(backend, &md5, &format!("Before {domain}.{operation}"))
        .await?;
    }
    let (tool, tool_operation) = workbench::mcp_operation(domain, operation);
    let result = backend
      .call(tool, &tool_operation, Some(&md5), parameters)
      .await
      .context("Modification may have reached Ghidra; refresh and inspect the actual program state before retrying")?;
    workbench::check_write_result(domain, operation, &result)?;
    let saved_result = ((domain, operation) == ("program", "save")).then_some(&result);
    self
      .commit_and_refresh(e, backend, &md5, saved_result)
      .await?;
    Ok(json!({"md5": md5, "persisted": true, "result": result}))
  }

  /// Reports pending rename metadata and affected documents for the scoped session.
  async fn handle_rename_state(&self, arg: &Value) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let engine = self.engine.lock().await;
    let pending = engine.pending.get(&md5).map(|plan| {
      let applied = plan.patched
        || plan.expected.iter().any(|(uri, expected)| {
          engine
            .docs
            .get(uri)
            .is_some_and(|doc| doc.current != doc.base && matches_text(&doc.current, expected))
        });
      let origin_applied = plan.patched
        || plan.expected.get(&plan.origin).is_some_and(|expected| {
          engine
            .docs
            .get(&plan.origin)
            .is_some_and(|doc| matches_text(&doc.current, expected))
        });
      json!({
        "origin": plan.origin,
        "oldName": plan.symbol.name,
        "newName": plan.new_name,
        "documents": plan.expected.keys().collect::<Vec<_>>(),
        "applied": applied,
        "originApplied": origin_applied,
        "patched": plan.patched,
      })
    });
    Ok(json!({"pending": pending}))
  }

  /// Saves a virtual document from an explicit editor payload, planning single-identifier renames.
  async fn handle_save_document(&self, arg: &Value) -> Result<Value> {
    let raw_uri: Uri = arg
      .get("uri")
      .and_then(Value::as_str)
      .context("uri is required")?
      .parse()?;
    let uri = canonical_virtual_uri(&raw_uri);
    let text = arg
      .get("text")
      .and_then(Value::as_str)
      .context("text is required")?
      .to_owned();
    let mut e = self.engine.lock().await;
    let (md5, base, saved) = {
      let doc = e.docs.get(&uri).context("Unknown virtual document")?;
      (doc.md5.clone(), doc.base.clone(), doc.saved.clone())
    };
    let is_clean = matches_text(&text, &base)
      || matches_text(&text, &saved)
      || e
        .refresh_allowed
        .get(&uri)
        .is_some_and(|exp| matches_text(&text, exp));
    if is_clean {
      if let Some(d) = e.docs.get_mut(&uri) {
        d.current = text.clone();
        d.saved = text;
      }
      e.refresh_allowed.remove(&uri);
      return Ok(Value::Null);
    }

    let matches_pending = e
      .pending
      .get(&md5)
      .and_then(|p| p.expected.get(&uri))
      .is_some_and(|expected| matches_text(&text, expected));
    if !matches_pending
      && !e.pending.contains_key(&md5)
      && let Some((pos, new_name)) = e.detect_rename(&uri, &text)
    {
      let _ = e.rename(&uri, pos, &new_name);
    }

    let matches_pending_after = e
      .pending
      .get(&md5)
      .and_then(|p| p.expected.get(&uri))
      .is_some_and(|expected| matches_text(&text, expected));
    ensure!(
      matches_pending_after,
      "Cannot save changes to read-only decompiled text. Use F2 or Rename Symbol to rename functions, variables, or parameters."
    );

    let text_to_save = e
      .pending
      .get(&md5)
      .and_then(|p| p.expected.get(&uri).cloned())
      .unwrap_or(text);
    e.docs
      .get_mut(&uri)
      .context("Unknown virtual document")?
      .current = text_to_save.clone();
    let changes = e.save(&uri, Some(text_to_save)).await?;
    drop(e);
    self.apply_refresh(changes).await?;
    self.report(&uri).await;
    self.changed(&md5).await;
    Ok(Value::Null)
  }

  /// Regenerates one clean virtual document and pushes updated buffer text if changed.
  async fn handle_refresh_document(&self, arg: &Value) -> Result<Value> {
    let raw_uri: Uri = arg
      .get("uri")
      .and_then(Value::as_str)
      .context("uri is required")?
      .parse()?;
    let uri = canonical_virtual_uri(&raw_uri);
    let mut e = self.engine.lock().await;
    let changes = e.refresh_document(&uri).await?;
    let changed = !changes.is_empty();
    let doc = e.docs.get(&uri).context("Unknown virtual document")?;
    let md5 = doc.md5.clone();
    let text = doc.base.clone();
    drop(e);
    self.apply_refresh(changes).await?;
    self.report(&uri).await;
    if changed {
      self.changed(&md5).await;
    }
    Ok(json!({"uri": uri, "text": text}))
  }

  /// Executes program metadata, symbol table, or data-type catalog read commands.
  async fn handle_catalog_command(
    &self,
    command: &str,
    arg: &Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    match command {
      "ghidra.program" => backend.call("program", "get", Some(&md5), json!({})).await,
      "ghidra.type" => {
        let path = arg
          .get("path")
          .and_then(Value::as_str)
          .context("type path is required")?;
        backend
          .call(
            "data_type",
            "get",
            Some(&md5),
            json!({"selector": {"path": path}}),
          )
          .await
      }
      _ => {
        let domain = if command == "ghidra.types" {
          "data_type"
        } else {
          "symbol"
        };
        let items = list_all(backend, domain, &md5, json!({"page": {"limit": 1000}})).await?;
        let scope = workbench::coverage(domain, &json!({}), items.len(), true);
        Ok(json!({"items": items, "coverage": scope}))
      }
    }
  }
}
