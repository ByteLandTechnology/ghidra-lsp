// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Custom `workspace/executeCommand` handlers for checkpoints and session reset.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::Uri;

use super::Server;
use crate::backend::McpBackend;
use crate::workbench;

impl Server {
  /// Dispatches checkpoint list, create, restore, and session reset commands.
  pub(super) async fn execute_checkpoint_command(
    &self,
    command: &str,
    arg: Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    match command {
      "ghidra.checkpoints" => {
        let md5 = self.scoped_md5(&arg).await?;
        call_session_checkpoint_op(backend, "checkpoint.list", &md5, json!({})).await
      }
      "ghidra.createCheckpoint" => self.handle_create_checkpoint(&arg, backend).await,
      "ghidra.restoreCheckpoint" => self.handle_restore_checkpoint(&arg, backend).await,
      "ghidra.resetSession" => self.handle_reset_session(&arg, backend).await,
      _ => bail!("Unknown command: {command}"),
    }
  }

  /// Creates an explicit named or unnamed checkpoint for a clean program session.
  async fn handle_create_checkpoint(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let e = self.engine.lock().await;
    Self::ensure_program_clean(&e, &md5)?;
    let mut parameters = json!({});
    if let Some(name) = arg
      .get("name")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|value| !value.is_empty())
    {
      parameters["name"] = Value::String(name.to_owned());
    }
    call_session_checkpoint_op(backend, "checkpoint.create", &md5, parameters).await
  }

  /// Restores a saved project checkpoint, waits for session relaunch, and refreshes open views.
  async fn handle_restore_checkpoint(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let mut parameters = json!({"wait": false});
    if let Some(id) = arg
      .get("id")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|value| !value.is_empty())
    {
      parameters["id"] = Value::String(id.to_owned());
    }
    if let Some(name) = arg
      .get("name")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|value| !value.is_empty())
    {
      parameters["name"] = Value::String(name.to_owned());
    }
    let restored =
      call_session_checkpoint_op(backend, "checkpoint.restore", &md5, parameters).await?;
    self
      .fail_pending_open_jobs(
        &md5,
        "The program was restored to an earlier checkpoint while this operation was pending",
      )
      .await;
    if let Some(job) = restored.get("job") {
      self.wait_job(job).await?;
    } else if let Some(id) = restored.get("jobId") {
      self.wait_job(&json!({"id": id})).await?;
    }
    self.refresh_restored_session(&md5).await?;
    let session = backend
      .call("session", "get", Some(&md5), json!({}))
      .await
      .ok()
      .and_then(|value| value.get("session").cloned())
      .or_else(|| restored.get("session").cloned())
      .unwrap_or(Value::Null);
    Ok(json!({
      "md5": md5,
      "restored": true,
      "checkpoint": restored.get("checkpoint").cloned().unwrap_or(Value::Null),
      "session": session,
    }))
  }

  /// Resets `projects/<md5>/ghidra/` and checkpoints, optionally re-importing and re-analyzing.
  async fn handle_reset_session(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg).await?;
    let reopen = arg.get("reopen").and_then(Value::as_bool).unwrap_or(true);
    let analyze = reopen && arg.get("analyze").and_then(Value::as_bool).unwrap_or(false);
    let reset = call_session_checkpoint_op(
      backend,
      "reset",
      &md5,
      json!({"open": reopen, "wait": false}),
    )
    .await?;
    self
      .fail_pending_open_jobs(
        &md5,
        "The program session was reset while this operation was pending",
      )
      .await;
    if !reopen {
      self.engine.lock().await.forget_session(&md5);
      self.view_cache.invalidate(&md5).await;
      self.changed(&md5).await;
      return Ok(json!({
        "md5": md5,
        "reset": true,
        "reopened": false,
        "analyzed": false,
        "fileName": reset.get("fileName").cloned().unwrap_or(Value::Null),
      }));
    }
    if let Some(job) = reset.get("job") {
      self.wait_job(job).await?;
    } else if let Some(id) = reset.get("jobId") {
      self.wait_job(&json!({"id": id})).await?;
    }
    if analyze {
      let started = backend
        .call("analysis", "start", Some(&md5), json!({}))
        .await?;
      self
        .wait_job(started.get("job").unwrap_or(&started))
        .await?;
      workbench::persist(backend, &md5)
        .await
        .context("Analysis completed after session reset, but project persistence failed")?;
    }
    self.refresh_restored_session(&md5).await?;
    let analysis = self.program_analysis(&md5).await.unwrap_or_default();
    Ok(json!({
      "md5": md5,
      "reset": true,
      "reopened": true,
      "analyzed": analysis.analyzed,
      "analysisRunning": analysis.running,
      "fileName": reset.get("fileName").cloned().unwrap_or(Value::Null),
    }))
  }

  /// Marks any in-flight open or reanalysis progress entries for `md5` as failed.
  async fn fail_pending_open_jobs(&self, md5: &str, message: &str) {
    for progress in self
      .open_jobs
      .lock()
      .await
      .values_mut()
      .filter(|progress| progress.md5 == md5 && progress.phase != "ready")
    {
      progress.error = Some(message.to_owned());
    }
  }

  /// Selects `md5`, regenerates all open virtual documents, and emits `ghidra/changed`.
  async fn refresh_restored_session(&self, md5: &str) -> Result<()> {
    self.view_cache.invalidate(md5).await;
    let (changes, uris) = {
      let mut e = self.engine.lock().await;
      if e.active.is_none() || e.active.as_deref() == Some(md5) {
        e.select(md5).await?;
      }
      let changes = e.refresh_after_restore(md5).await;
      let uris: Vec<Uri> = e
        .docs
        .values()
        .filter(|doc| doc.md5 == md5)
        .map(|doc| doc.uri.clone())
        .collect();
      (changes, uris)
    };
    self.apply_refresh(changes).await?;
    for uri in uris {
      self.report(&uri).await;
    }
    self.changed(md5).await;
    Ok(())
  }
}

/// Calls a checkpoint or reset `ghidra_session` operation and maps older-backend errors clearly.
async fn call_session_checkpoint_op(
  backend: &McpBackend,
  operation: &str,
  md5: &str,
  parameters: Value,
) -> Result<Value> {
  match backend
    .call("session", operation, Some(md5), parameters)
    .await
  {
    Ok(value) => {
      backend.set_checkpoint_create_supported(true).await;
      Ok(value)
    }
    Err(error) if crate::engine::unsupported_session_operation(&error, operation) => {
      backend.set_checkpoint_create_supported(false).await;
      bail!(
        "ghidra-mcp does not support session.{operation}; update ghidra-mcp and restart the daemon"
      )
    }
    Err(error) => Err(error),
  }
}
