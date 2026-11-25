// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Model Context Protocol child-process transport for `ghidra-mcp`.

use std::collections::HashSet;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use rmcp::model::CallToolRequestParams;
use rmcp::service::RunningService;
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;
use tokio::sync::Mutex;

/// Configuration for launching and communicating with the `ghidra-mcp` child process.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Config {
  /// Executable name or path for the `ghidra-mcp` backend.
  pub(crate) mcp_command: String,
  /// Extra command-line arguments passed when starting `ghidra-mcp`.
  pub(crate) mcp_args: Vec<String>,
  /// Request timeout in milliseconds, clamped between 100 ms and 300 s.
  pub(crate) request_timeout_ms: u64,
}

impl Default for Config {
  fn default() -> Self {
    Self {
      mcp_command: "ghidra-mcp".into(),
      mcp_args: Vec::new(),
      request_timeout_ms: 35_000,
    }
  }
}

/// Active MCP client session paired with a monotonic identifier.
struct ClientSession {
  /// Session identifier used to invalidate only the failed connection.
  id: u64,
  /// Running `rmcp` client service attached to the child process.
  service: RunningService<RoleClient, ()>,
}

/// Concrete MCP stdio transport client managing a lazy child `ghidra-mcp` process.
pub(crate) struct McpBackend {
  /// Transport configuration used when spawning the child process.
  config: Config,
  /// Active client session guarded for lazy initialization and reset on failure.
  client: Mutex<Option<ClientSession>>,
  /// Monotonic counter for distinguishing recreated child sessions.
  next_id: AtomicU64,
}

impl McpBackend {
  /// Creates a new backend transport from `config` without spawning the child process yet.
  pub(crate) fn new(config: Config) -> Self {
    Self {
      config,
      client: Mutex::new(None),
      next_id: AtomicU64::new(1),
    }
  }

  /// Invokes `ghidra_<domain>` with `operation`, optional `md5`, and JSON `params`.
  pub(crate) async fn call(
    &self,
    domain: &str,
    operation: &str,
    md5: Option<&str>,
    params: Value,
  ) -> Result<Value> {
    let scan_ms = params
      .pointer("/scan/timeout_ms")
      .and_then(Value::as_u64)
      .unwrap_or(0);
    let deadline = Duration::from_millis(
      self
        .config
        .request_timeout_ms
        .max(scan_ms)
        .clamp(100, 300_000),
    );
    let (session_id, peer) = {
      let mut guard = self.client.lock().await;
      if guard.is_none() {
        let mut command = Command::new(&self.config.mcp_command);
        command
          .args(&self.config.mcp_args)
          .stderr(Stdio::inherit())
          .kill_on_drop(true);
        let transport = TokioChildProcess::new(command).context("start ghidra-mcp")?;
        let service = tokio::time::timeout(deadline, ().serve(transport))
          .await
          .context("MCP handshake timed out")??;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        *guard = Some(ClientSession { id, service });
      }
      let session = guard.as_ref().context("MCP client session is not active")?;
      (session.id, session.service.peer().clone())
    };
    let mut args = json!({ "operation": operation, "params": params });
    if let Some(md5) = md5 {
      args["md5"] = json!(md5);
    }
    let args_obj = args
      .as_object()
      .cloned()
      .context("MCP tool arguments must be a JSON object")?;
    let request = CallToolRequestParams::new(format!("ghidra_{domain}")).with_arguments(args_obj);
    let response = tokio::time::timeout(deadline, peer.call_tool(request)).await;
    match response {
      Ok(Ok(result)) => {
        if result.is_error == Some(true) {
          let err_msg = result
            .structured_content
            .as_ref()
            .and_then(format_error_value)
            .or_else(|| {
              result.content.iter().find_map(|c| {
                c.as_text().map(|t| {
                  if let Ok(v) = serde_json::from_str::<Value>(&t.text) {
                    format_error_value(&v).unwrap_or_else(|| t.text.clone())
                  } else {
                    t.text.clone()
                  }
                })
              })
            })
            .unwrap_or_else(|| "Unknown backend error".into());
          bail!("MCP {domain}.{operation}: {err_msg}");
        }
        let value = result
          .structured_content
          .clone()
          .or_else(|| {
            result
              .content
              .iter()
              .find_map(|c| c.as_text().and_then(|t| serde_json::from_str(&t.text).ok()))
          })
          .context("MCP result has no structured JSON")?;
        normalize(value)
      }
      Ok(Err(error)) => {
        let mut guard = self.client.lock().await;
        if guard.as_ref().is_some_and(|s| s.id == session_id) {
          *guard = None;
        }
        Err(error.into())
      }
      Err(_) => {
        let mut guard = self.client.lock().await;
        if guard.as_ref().is_some_and(|s| s.id == session_id) {
          *guard = None;
        }
        if is_read_only_operation(domain, operation) {
          bail!("MCP {domain}.{operation} timed out");
        }
        bail!(
          "MCP {domain}.{operation} timed out; a write may have completed. Refresh before retrying."
        )
      }
    }
  }
}

/// Returns true when `(domain, operation)` is known to be read-only.
fn is_read_only_operation(domain: &str, operation: &str) -> bool {
  if domain == "batch" {
    return false;
  }
  if matches!(
    (domain, operation),
    ("listing", "window.get")
      | ("function", "control_flow_graph.get")
      | ("reference", "context.list")
  ) {
    return true;
  }
  let verb = operation.rsplit('.').next().unwrap_or(operation);
  matches!(
    verb,
    "get"
      | "list"
      | "read"
      | "wait"
      | "resolve"
      | "status"
      | "inspect"
      | "capabilities"
      | "describe"
      | "search"
  )
}

/// Extracts a human-readable error message from a structured MCP response value.
pub(crate) fn format_error_value(val: &Value) -> Option<String> {
  match val {
    Value::String(s) => Some(s.clone()),
    Value::Object(map) => {
      if let Some(resp) = map.get("response")
        && let Some(err) = resp.get("error").filter(|v| !v.is_null())
        && let Some(formatted) = format_error_value(err)
      {
        return Some(formatted);
      }
      if let Some(err) = map.get("error").filter(|v| !v.is_null())
        && let Some(formatted) = format_error_value(err)
      {
        return Some(formatted);
      }
      let reason = val
        .pointer("/data/details/reason")
        .or_else(|| val.pointer("/details/reason"))
        .and_then(Value::as_str);
      let target = val
        .pointer("/data/details/target")
        .or_else(|| val.pointer("/details/target"))
        .and_then(Value::as_str);
      let err_type = val
        .pointer("/data/type")
        .or_else(|| val.pointer("/type"))
        .and_then(Value::as_str);

      if let Some(reason) = reason {
        if err_type == Some("missing_target")
          && let Some(target) = target
        {
          return Some(format!(
            "Binary target `{target}` is not available in Ghidra: {reason}"
          ));
        }
        return Some(reason.to_owned());
      }

      if let Some(msg) = map.get("message").and_then(Value::as_str) {
        return Some(msg.to_owned());
      }

      None
    }
    _ => None,
  }
}

/// Unwraps `{ "response": { "result" | "error" } }` envelopes returned by `ghidra-mcp`.
pub(crate) fn normalize(value: Value) -> Result<Value> {
  if let Some(response) = value.get("response") {
    if let Some(error) = response.get("error").filter(|v| !v.is_null()) {
      if let Some(msg) = format_error_value(error) {
        bail!("{msg}");
      } else {
        bail!("{error}");
      }
    }
    return Ok(response.get("result").unwrap_or(response).clone());
  }
  Ok(value)
}

/// Fetches all pages from a list operation on `domain` for `md5` and rejects incomplete scans.
pub(crate) async fn list_all(
  backend: &McpBackend,
  domain: &str,
  md5: &str,
  params: Value,
) -> Result<Vec<Value>> {
  list_operation(backend, domain, "list", md5, params).await
}

/// Fetches all pages from `operation` on `domain` for `md5` and rejects incomplete scans.
pub(crate) async fn list_operation(
  backend: &McpBackend,
  domain: &str,
  operation: &str,
  md5: &str,
  mut params: Value,
) -> Result<Vec<Value>> {
  let mut items = Vec::new();
  let mut seen = HashSet::new();
  loop {
    let value = backend
      .call(domain, operation, Some(md5), params.clone())
      .await?;
    items.extend(
      value
        .get("items")
        .and_then(Value::as_array)
        .context("list response lacks items")?
        .iter()
        .cloned(),
    );
    if let Some(cursor) = value.get("next_cursor").and_then(Value::as_str) {
      if !seen.insert(cursor.to_owned()) {
        bail!("backend repeated a pagination cursor");
      }
      params["page"] = json!({"cursor": cursor, "limit": 1000});
    } else {
      if value.pointer("/scan/complete").and_then(Value::as_bool) == Some(false) {
        bail!("backend scan is incomplete; refresh after analysis finishes");
      }
      return Ok(items);
    }
  }
}
