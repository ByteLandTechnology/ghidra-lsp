// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Model Context Protocol child-process transport for `ghidra-mcp`.

use std::borrow::Cow;
use std::collections::HashSet;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use rmcp::model::CallToolRequestParams;
use rmcp::service::{Peer, RunningService, ServiceError};
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

/// Schema capabilities advertised by the connected `ghidra-mcp` child process.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BackendCapabilities {
  /// Whether `data_type_reference` inputs accept C type strings.
  pub(crate) c_type_strings: bool,
  /// Whether `function.patch` accepts an atomic `parameters` array.
  pub(crate) atomic_function_parameters: bool,
  /// Whether `function.patch` accepts a one-line C `signature` string.
  pub(crate) function_signature: bool,
  /// Input property name (`"source"` or `"declarations"`) when `data_type.parse_c` exists.
  pub(crate) parse_c_field: Option<&'static str>,
}

impl BackendCapabilities {
  /// Returns full capabilities when the MCP server does not expose `ghidra_help`.
  pub(crate) const fn modern() -> Self {
    Self {
      c_type_strings: true,
      atomic_function_parameters: true,
      function_signature: true,
      parse_c_field: Some("declarations"),
    }
  }
}

/// Returns true when a JSON Schema node permits a JSON `string` value.
fn schema_accepts_string(schema: &Value) -> bool {
  if schema.get("type").and_then(Value::as_str) == Some("string") {
    return true;
  }
  schema
    .get("oneOf")
    .or_else(|| schema.get("anyOf"))
    .and_then(Value::as_array)
    .is_some_and(|items| {
      items
        .iter()
        .any(|item| item.get("type").and_then(Value::as_str) == Some("string"))
    })
}

/// Active MCP client session paired with a monotonic identifier.
struct ClientSession {
  /// Session identifier used to invalidate only the failed connection.
  id: u64,
  /// Running `rmcp` client service attached to the child process.
  service: RunningService<RoleClient, ()>,
  /// Cached schema capabilities queried from `ghidra_help`.
  capabilities: Option<BackendCapabilities>,
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

  /// Lazily starts or reuses the child `ghidra-mcp` session and returns its peer handle.
  async fn ensure_session(
    &self,
    deadline: Duration,
  ) -> Result<(u64, Peer<RoleClient>, Option<BackendCapabilities>)> {
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
        capabilities: None,
      });
    }
    let session = guard.as_ref().context("MCP client session is not active")?;
    Ok((
      session.id,
      session.service.peer().clone(),
      session.capabilities,
    ))
  }

  /// Queries `ghidra_help` on `peer`, returning `Ok(None)` when `ghidra_help` is unavailable.
  async fn call_help(
    &self,
    session_id: u64,
    peer: &Peer<RoleClient>,
    deadline: Duration,
    args: Value,
  ) -> Result<Option<Value>> {
    let args_obj = args
      .as_object()
      .cloned()
      .context("MCP help arguments must be a JSON object")?;
    let request = CallToolRequestParams::new("ghidra_help").with_arguments(args_obj);
    match tokio::time::timeout(deadline, peer.call_tool(request)).await {
      Ok(Ok(result)) => {
        if result.is_error == Some(true) {
          return Ok(None);
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
          .context("MCP help result has no structured JSON")?;
        Ok(Some(normalize(value)?))
      }
      Ok(Err(ServiceError::McpError(_))) => Ok(None),
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
        bail!("MCP ghidra_help timed out")
      }
    }
  }

  /// Returns cached schema capabilities for the active `ghidra-mcp` session.
  pub(crate) async fn capabilities(&self) -> Result<BackendCapabilities> {
    let deadline = Duration::from_millis(self.config.request_timeout_ms.clamp(100, 300_000));
    let (session_id, peer, cached) = self.ensure_session(deadline).await?;
    if let Some(caps) = cached {
      return Ok(caps);
    }
    let fn_help = self
      .call_help(
        session_id,
        &peer,
        deadline,
        json!({ "domain": "ghidra_function", "operation": "patch" }),
      )
      .await?;
    let caps = if let Some(fn_schema) = fn_help {
      let c_type_strings = fn_schema
        .pointer("/inputSchema/$defs/data_type_reference")
        .is_some_and(schema_accepts_string);
      let atomic_function_parameters = fn_schema
        .pointer("/inputSchema/properties/patch/properties/parameters")
        .is_some();
      let function_signature = fn_schema
        .pointer("/inputSchema/properties/patch/properties/signature")
        .is_some();
      let dt_help = self
        .call_help(
          session_id,
          &peer,
          deadline,
          json!({ "domain": "ghidra_data_type" }),
        )
        .await?;
      let parse_c_field = dt_help
        .as_ref()
        .and_then(|dt| dt.get("operations"))
        .and_then(Value::as_array)
        .and_then(|ops| {
          ops
            .iter()
            .find(|op| op.get("name").and_then(Value::as_str) == Some("parse_c"))
        })
        .map(|op| {
          if op.pointer("/inputSchema/properties/declarations").is_some() {
            "declarations"
          } else if op.pointer("/inputSchema/properties/source").is_some() {
            "source"
          } else {
            "declarations"
          }
        });
      BackendCapabilities {
        c_type_strings,
        atomic_function_parameters,
        function_signature,
        parse_c_field,
      }
    } else {
      BackendCapabilities::modern()
    };
    let mut guard = self.client.lock().await;
    if let Some(session) = guard.as_mut().filter(|s| s.id == session_id) {
      session.capabilities = Some(caps);
    }
    Ok(caps)
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
    let (session_id, peer, _) = self.ensure_session(deadline).await?;
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
