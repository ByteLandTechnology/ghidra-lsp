// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Custom `workspace/executeCommand` handlers for analysis job cancellation.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use super::{OpenProgress, ProgramAnalysis, Server, job_error};
use crate::backend::McpBackend;

impl Server {
  /// Cancels an active analysis job by `token`, `jobId`, or session `md5` and updates `open_jobs`.
  pub(super) async fn handle_cancel_job(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let wait = arg.get("wait").and_then(Value::as_bool).unwrap_or(true);
    let timeout_ms = arg.get("timeoutMs").and_then(Value::as_u64);
    let explicit_token = arg
      .get("token")
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty());
    let explicit_job_id = arg
      .get("jobId")
      .or_else(|| arg.get("id"))
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty());

    if let Some(token) = explicit_token {
      let progress = self
        .open_jobs
        .lock()
        .await
        .get(token)
        .cloned()
        .context("Unknown program operation; list sessions to recover the background task")?;
      if progress.phase == "ready" || progress.error.is_some() {
        return Ok(progress.value(token));
      }
      ensure!(
        progress.phase != "opening",
        "Opening a binary cannot be cancelled with ghidra.cancelJob; close the session instead"
      );
      if let Some(id) = progress.job_id.clone() {
        return self
          .cancel_backend_job(
            backend,
            &id,
            Some((token.to_owned(), progress)),
            wait,
            timeout_ms,
          )
          .await;
      }
      return self
        .cancel_session_analysis(backend, &progress.md5, Some(token), wait)
        .await;
    }

    if let Some(id) = explicit_job_id {
      let matched = self
        .open_jobs
        .lock()
        .await
        .iter()
        .find(|(_, p)| p.job_id.as_deref() == Some(id))
        .map(|(k, v)| (k.clone(), v.clone()));
      if let Some((_, progress)) = &matched {
        ensure!(
          progress.phase != "opening" || progress.error.is_some(),
          "Opening a binary cannot be cancelled with ghidra.cancelJob; close the session instead"
        );
      }
      return self
        .cancel_backend_job(backend, id, matched, wait, timeout_ms)
        .await;
    }

    let md5 = self.scoped_md5(arg).await?;
    let active = self
      .open_jobs
      .lock()
      .await
      .iter()
      .find(|(_, p)| p.md5 == md5 && p.phase != "ready" && p.error.is_none())
      .map(|(k, v)| (k.clone(), v.clone()));
    if let Some((token, progress)) = active {
      ensure!(
        progress.phase != "opening",
        "Opening a binary cannot be cancelled with ghidra.cancelJob; close the session instead"
      );
      if let Some(id) = progress.job_id.clone() {
        return self
          .cancel_backend_job(backend, &id, Some((token, progress)), wait, timeout_ms)
          .await;
      }
      return self
        .cancel_session_analysis(backend, &md5, Some(&token), wait)
        .await;
    }
    self
      .cancel_session_analysis(backend, &md5, None, wait)
      .await
  }

  /// Calls `job.cancel` on `backend`, updates matching `open_jobs` entries, and notifies clients.
  async fn cancel_backend_job(
    &self,
    backend: &McpBackend,
    id: &str,
    matched: Option<(String, OpenProgress)>,
    wait: bool,
    timeout_ms: Option<u64>,
  ) -> Result<Value> {
    let mut params = json!({"jobId": id, "wait": wait});
    if let Some(ms) = timeout_ms {
      params["timeoutMs"] = ms.into();
    }
    let response = backend
      .call("job", "cancel", None, params)
      .await
      .map_err(map_cancel_error)?;
    let job = response.get("job").unwrap_or(&response);
    let status = job.get("status").and_then(Value::as_str);
    let md5 = job
      .get("md5")
      .and_then(Value::as_str)
      .map(str::to_ascii_lowercase)
      .or_else(|| matched.as_ref().map(|(_, p)| p.md5.clone()));
    let analysis = match md5.as_deref() {
      Some(session_md5) => self.program_analysis(session_md5).await.unwrap_or_default(),
      None => ProgramAnalysis::default(),
    };
    let error = match status {
      Some("completed") => None,
      Some("failed" | "cancelled") => {
        Some(job_error(job).unwrap_or_else(|| "Ghidra analysis cancelled".to_owned()))
      }
      _ => job_error(job),
    };

    let mut primary_value = None;
    {
      let mut jobs = self.open_jobs.lock().await;
      for (token, entry) in jobs.iter_mut() {
        if entry.job_id.as_deref() == Some(id) {
          entry.analysis = analysis;
          if status == Some("completed") {
            entry.phase = "ready";
            entry.error = None;
          } else if let Some(reason) = &error {
            entry.error = Some(reason.clone());
          } else {
            entry.detail = Some("Cancelling Ghidra analysis".to_owned());
          }
          if matched.as_ref().is_some_and(|(t, _)| t == token) {
            primary_value = Some(entry.value(token));
          }
        }
      }
    }

    if let Some(session_md5) = &md5 {
      self.changed(session_md5).await;
    }
    if let Some(value) = primary_value {
      return Ok(value);
    }
    let state = if error.is_some() {
      "failed"
    } else if status == Some("completed") {
      "ready"
    } else {
      "pending"
    };
    Ok(json!({
      "md5": md5,
      "jobId": id,
      "state": state,
      "phase": "analysis",
      "error": error,
      "analyzed": analysis.analyzed,
      "analysisRunning": analysis.running,
      "job": job,
    }))
  }

  /// Calls `analysis.cancel` for `md5` when no backend `jobId` tracks the analysis.
  async fn cancel_session_analysis(
    &self,
    backend: &McpBackend,
    md5: &str,
    token: Option<&str>,
    wait: bool,
  ) -> Result<Value> {
    let mut snapshot = backend
      .call("analysis", "cancel", Some(md5), json!({}))
      .await
      .map_err(map_cancel_error)?;
    if wait && snapshot.get("status").and_then(Value::as_str) == Some("running") {
      let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
      while tokio::time::Instant::now() < deadline {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        snapshot = backend
          .call("analysis", "get", Some(md5), json!({}))
          .await?;
        if snapshot.get("status").and_then(Value::as_str) != Some("running") {
          break;
        }
      }
    }
    let status = snapshot.get("status").and_then(Value::as_str);
    let error = match status {
      Some("failed" | "cancelled") => {
        Some(job_error(&snapshot).unwrap_or_else(|| "Ghidra analysis cancelled".to_owned()))
      }
      _ => job_error(&snapshot),
    };
    let analysis = ProgramAnalysis {
      analyzed: snapshot.get("analyzed").and_then(Value::as_bool) == Some(true)
        || status == Some("completed"),
      running: status == Some("running"),
    };
    let mut token_value = None;
    {
      let mut jobs = self.open_jobs.lock().await;
      for (key, entry) in jobs.iter_mut() {
        if entry.md5 == md5 && entry.phase != "ready" && entry.error.is_none() {
          entry.analysis = analysis;
          if let Some(reason) = &error {
            entry.error = Some(reason.clone());
          } else if !analysis.running {
            entry.phase = "ready";
          }
          if token == Some(key.as_str()) {
            token_value = Some(entry.value(key));
          }
        }
      }
    }
    self.changed(md5).await;
    if let Some(value) = token_value {
      return Ok(value);
    }
    let state = if error.is_some() {
      "failed"
    } else if analysis.running {
      "pending"
    } else {
      "ready"
    };
    Ok(json!({
      "md5": md5,
      "state": state,
      "phase": "analysis",
      "error": error,
      "analyzed": analysis.analyzed,
      "analysisRunning": analysis.running,
      "analysis": snapshot,
    }))
  }
}

/// Maps backend unknown-operation or unknown-method failures on `cancel` to user guidance.
fn map_cancel_error(error: anyhow::Error) -> anyhow::Error {
  let text = format!("{error:#}").to_ascii_lowercase();
  if [
    "unknown operation",
    "unknown_operation",
    "no such operation",
    "unsupported operation",
    "unknown_method",
    "no such method",
    "method not found",
  ]
  .iter()
  .any(|pattern| text.contains(pattern))
  {
    anyhow::anyhow!(
      "The installed ghidra-mcp or ghidra-bridge backend does not support job.cancel or analysis.cancel. Update the backend, or close the session to stop Ghidra analysis"
    )
  } else {
    error
  }
}
