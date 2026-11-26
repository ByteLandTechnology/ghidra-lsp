// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Model Context Protocol child-process transport for `ghidra-mcp`.

use std::borrow::Cow;
use std::collections::HashSet;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use rmcp::model::{CallToolRequestParams, CallToolResult};
use rmcp::service::{Peer, RunningService};
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

/// Result of checking `ghidra_session` `open` parameter support on the child server.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionOpenSupport {
  /// The child server accepts `.gpr` attachment and firmware import parameters.
  Extended,
  /// The child server predates `.gpr` attachment and firmware import parameters.
  Legacy,
  /// The child server does not publish a `ghidra_help` `session.open` schema.
  Unknown,
}

/// Active MCP client session paired with a monotonic identifier.
struct ClientSession {
  /// Session identifier used to invalidate only the failed connection.
  id: u64,
  /// Running `rmcp` client service attached to the child process.
  service: RunningService<RoleClient, ()>,
  /// Cached `session.open` parameter check result for this child process.
  session_open_support: Option<SessionOpenSupport>,
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

  /// Connects or reuses the child `ghidra-mcp` process and returns its session handle.
  async fn connect(
    &self,
    deadline: Duration,
  ) -> Result<(u64, Peer<RoleClient>, Option<SessionOpenSupport>)> {
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
      *guard = Some(ClientSession {
        id,
        service,
        session_open_support: None,
      });
    }
    let session = guard.as_ref().context("MCP client session is not active")?;
    Ok((
      session.id,
      session.service.peer().clone(),
      session.session_open_support,
    ))
  }

  /// Resets the active client session if its identifier still matches `session_id`.
  async fn invalidate(&self, session_id: u64) {
    let mut guard = self.client.lock().await;
    if guard.as_ref().is_some_and(|s| s.id == session_id) {
      *guard = None;
    }
  }

  /// Checks whether the connected `ghidra-mcp` supports `.gpr` attachment and firmware flags.
  pub(crate) async fn check_extended_open(&self, gpr_target: bool) -> Result<()> {
    let deadline = Duration::from_millis(self.config.request_timeout_ms.clamp(100, 300_000));
    let (session_id, peer, cached) = self.connect(deadline).await?;
    let support = if let Some(support) = cached {
      support
    } else {
      let args_obj = json!({ "domain": "session", "operation": "open" })
        .as_object()
        .cloned()
        .context("MCP help arguments must be a JSON object")?;
      let request = CallToolRequestParams::new("ghidra_help").with_arguments(args_obj);
      match tokio::time::timeout(deadline, peer.call_tool(request)).await {
        Ok(Ok(result)) => {
          let detected = classify_session_open_help(&result);
          let mut guard = self.client.lock().await;
          if let Some(session) = guard.as_mut().filter(|s| s.id == session_id) {
            session.session_open_support = Some(detected);
          }
          detected
        }
        Ok(Err(error)) => {
          self.invalidate(session_id).await;
          return Err(error.into());
        }
        Err(_) => {
          self.invalidate(session_id).await;
          bail!("MCP help.session.open timed out");
        }
      }
    };
    if support == SessionOpenSupport::Legacy {
      if gpr_target {
        bail!(
          "Installed ghidra-mcp does not support .gpr project attachment; update ghidra-mcp first"
        );
      }
      bail!(
        "Installed ghidra-mcp does not support firmware import options; update ghidra-mcp first"
      );
    }
    Ok(())
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
    let (session_id, peer, _) = self.connect(deadline).await?;
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
        self.invalidate(session_id).await;
        Err(error.into())
      }
      Err(_) => {
        self.invalidate(session_id).await;
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

/// Classifies `ghidra_help` output for `session.open` into extended, legacy, or unknown support.
fn classify_session_open_help(result: &CallToolResult) -> SessionOpenSupport {
  if result.is_error == Some(true) {
    return SessionOpenSupport::Unknown;
  }
  let payload = result.structured_content.clone().or_else(|| {
    result
      .content
      .iter()
      .find_map(|c| c.as_text().and_then(|t| serde_json::from_str(&t.text).ok()))
  });
  let Some(properties) = payload
    .as_ref()
    .and_then(|v| v.pointer("/inputSchema/properties"))
    .and_then(Value::as_object)
  else {
    return SessionOpenSupport::Unknown;
  };
  if properties.contains_key("programName") && properties.contains_key("processor") {
    SessionOpenSupport::Extended
  } else if properties.contains_key("path") {
    SessionOpenSupport::Legacy
  } else {
    SessionOpenSupport::Unknown
  }
}

/// Returns true when `(domain, operation)` is known to be read-only.
fn is_read_only_operation(domain: &str, operation: &str) -> bool {
  if domain == "batch" {
    return false;
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

/// Options for initial page selection and scan checks in `list_pages`.
#[derive(Clone, Copy)]
pub(crate) struct ListOptions<'a> {
  /// Initial batch page (`Some(None)` returns an empty list without a backend call).
  pub(crate) initial: Option<Option<&'a Value>>,
  /// True when each page must contain an `"items"` array.
  pub(crate) require_items: bool,
  /// Error message when `/scan/complete` is `false`, or `None` to accept partial scans.
  pub(crate) incomplete_error: Option<&'a str>,
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
  params: Value,
) -> Result<Vec<Value>> {
  let options = ListOptions {
    initial: None,
    require_items: true,
    incomplete_error: Some("backend scan is incomplete; refresh after analysis finishes"),
  };
  list_pages(backend, domain, operation, Some(md5), params, options).await
}

/// Fetches all `next_cursor` pages for `operation` on `domain` with `options`.
pub(crate) async fn list_pages(
  backend: &McpBackend,
  domain: &str,
  operation: &str,
  md5: Option<&str>,
  mut params: Value,
  options: ListOptions<'_>,
) -> Result<Vec<Value>> {
  let mut page = match options.initial {
    Some(None) => return Ok(Vec::new()),
    Some(Some(first)) => Cow::Borrowed(first),
    None => Cow::Owned(backend.call(domain, operation, md5, params.clone()).await?),
  };
  let mut items = Vec::new();
  let mut seen = HashSet::new();
  loop {
    if let Some(more) = page["items"].as_array() {
      items.extend(more.iter().cloned());
    } else if options.require_items {
      bail!("list response lacks items");
    }
    let Some(cursor) = page["next_cursor"].as_str().filter(|s| !s.is_empty()) else {
      if let Some(err) = options.incomplete_error {
        ensure!(
          page.pointer("/scan/complete").and_then(Value::as_bool) != Some(false),
          "{err}"
        );
      }
      return Ok(items);
    };
    ensure!(
      seen.insert(cursor.to_owned()),
      "backend repeated a pagination cursor"
    );
    params["page"] = json!({ "cursor": cursor, "limit": 1000 });
    page = Cow::Owned(backend.call(domain, operation, md5, params.clone()).await?);
  }
}
