// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Custom `workspace/executeCommand` handlers for string enumeration and structured edits.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use super::Server;
use crate::backend::McpBackend;
use crate::workbench;

impl Server {
  /// Dispatches string lookup, type-document, comment, prototype, and variable commands.
  pub(super) async fn execute_edit_command(
    &self,
    command: &str,
    arg: Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    match command {
      "ghidra.strings" => {
        let md5 = self.scoped_md5(&arg)?;
        crate::address::defined_strings(backend, &md5).await
      }
      "ghidra.typeDocument" => {
        let md5 = self.scoped_md5(&arg)?;
        let path = arg
          .get("path")
          .and_then(Value::as_str)
          .context("type path is required")?;
        crate::types_doc::get_type_document(backend, &md5, path).await
      }
      "ghidra.validateTypeDocument" => {
        let text = arg
          .get("text")
          .and_then(Value::as_str)
          .context("text is required")?;
        let original = arg
          .get("original")
          .filter(|v| v.is_object())
          .context("original data type snapshot is required")?;
        Ok(crate::types_doc::validate_type_document(text, original))
      }
      "ghidra.saveTypeDocument" => self.handle_save_type_document(&arg, backend).await,
      "ghidra.commentsAt" => {
        let md5 = self.scoped_md5(&arg)?;
        let address = arg
          .get("address")
          .and_then(Value::as_str)
          .context("address is required")?;
        crate::mutations::comments_at(backend, &md5, address).await
      }
      "ghidra.saveComment" => self.handle_save_comment(&arg, backend).await,
      "ghidra.functionPrototype" => {
        let md5 = self.scoped_md5(&arg)?;
        let entry = arg
          .get("entry")
          .and_then(Value::as_str)
          .context("entry is required")?;
        crate::mutations::function_prototype(backend, &md5, entry).await
      }
      "ghidra.saveFunctionPrototype" | "ghidra.saveVariables" => {
        self.handle_save_function_edit(command, &arg, backend).await
      }
      _ => bail!("Unknown command: {command}"),
    }
  }

  /// Applies and persists one comment edit with optimistic conflict verification.
  async fn handle_save_comment(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg)?;
    let address = arg
      .get("address")
      .and_then(Value::as_str)
      .context("address is required")?;
    let kind = arg
      .get("kind")
      .or_else(|| arg.get("commentType"))
      .and_then(Value::as_str)
      .context("comment kind is required")?;
    let text = arg
      .get("text")
      .and_then(Value::as_str)
      .context("text is required")?;
    let expected = arg.get("expected").and_then(Value::as_str);
    let session_guard = self.engine.lock_session(&md5).await;
    Self::ensure_program_clean(&self.engine.read_state(), &md5)?;
    let prepared =
      crate::mutations::prepare_comment_mutation(backend, &md5, address, kind, text, expected)
        .await?;
    if !prepared.changed {
      drop(session_guard);
      return Ok(json!({
        "md5": md5,
        "address": prepared.address,
        "displayAddress": crate::address::display_address(&prepared.address),
        "kind": prepared.kind,
        "text": prepared.saved_text,
        "mutated": false,
        "persisted": false,
      }));
    }
    let call_result = crate::mutations::execute_comment_mutation(backend, &md5, &prepared).await;
    self.engine.bump_epoch(&md5);
    let result = call_result?;
    self
      .commit_and_refresh(session_guard, backend, &md5, None)
      .await?;
    Ok(json!({
      "md5": md5,
      "address": prepared.address,
      "displayAddress": crate::address::display_address(&prepared.address),
      "kind": prepared.kind,
      "text": prepared.saved_text,
      "mutated": true,
      "persisted": true,
      "result": result,
    }))
  }

  /// Applies and persists function prototype or variable mutations in one atomic batch.
  async fn handle_save_function_edit(
    &self,
    command: &str,
    arg: &Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    let md5 = self.scoped_md5(arg)?;
    let entry = arg
      .get("entry")
      .and_then(Value::as_str)
      .context("entry is required")?;
    let original = arg
      .get("original")
      .filter(|v| v.is_object())
      .context("original function snapshot is required")?;
    let payload = arg.get("payload").filter(|v| v.is_object()).unwrap_or(arg);
    let session_guard = self.engine.lock_session(&md5).await;
    Self::ensure_program_clean(&self.engine.read_state(), &md5)?;
    let ops = if command == "ghidra.saveFunctionPrototype" {
      crate::mutations::prepare_function_prototype_ops(backend, &md5, entry, original, payload)
        .await?
    } else {
      crate::mutations::prepare_variables_ops(backend, &md5, entry, original, payload).await?
    };
    let call_result = crate::mutations::execute_ops(backend, &md5, &ops).await;
    self.engine.bump_epoch(&md5);
    let result = call_result?;
    self
      .commit_and_refresh(session_guard, backend, &md5, None)
      .await?;
    Ok(json!({
      "md5": md5,
      "entry": entry,
      "persisted": true,
      "result": result,
    }))
  }

  /// Validates conflicts, applies mutations, refreshes state, and reconciles a saved type buffer.
  async fn handle_save_type_document(&self, arg: &Value, backend: &McpBackend) -> Result<Value> {
    let md5 = self.scoped_md5(arg)?;
    let path = arg
      .get("path")
      .and_then(Value::as_str)
      .context("type path is required")?;
    let text = arg
      .get("text")
      .and_then(Value::as_str)
      .context("text is required")?;
    let original = arg
      .get("original")
      .filter(|v| v.is_object())
      .context("original data type snapshot is required")?;
    let (draft, operations) = crate::types_doc::prepare_type_save(text, original)?;
    let session_guard = self.engine.lock_session(&md5).await;
    Self::ensure_program_clean(&self.engine.read_state(), &md5)?;
    let current =
      crate::types_doc::fetch_and_check_type_conflict(backend, &md5, path, original).await?;
    let Some((domain, operation, parameters)) =
      crate::types_doc::build_type_write_request(&operations)
    else {
      drop(session_guard);
      return Ok(crate::types_doc::noop_type_save(&md5, path, text, current));
    };
    workbench::allow_write(domain, operation, &parameters)?;
    let (tool, tool_operation) = workbench::mcp_operation(domain, operation);
    let call_result = backend
      .call(tool, &tool_operation, Some(&md5), parameters)
      .await;
    self.engine.bump_epoch(&md5);
    let result = call_result.map_err(crate::types_doc::wrap_post_send_error)?;
    workbench::check_write_result(domain, operation, &result)
      .map_err(crate::types_doc::wrap_post_send_error)?;
    if let Err(error) = workbench::persist(backend, &md5).await {
      drop(session_guard);
      self.changed(&md5).await;
      return Err(crate::types_doc::wrap_post_send_error(error));
    }
    let changes = self
      .engine
      .refresh_session_locked(&md5, None)
      .await
      .map_err(crate::types_doc::wrap_post_send_error)?;
    drop(session_guard);
    self.changed(&md5).await;
    self
      .apply_refresh(changes)
      .await
      .map_err(crate::types_doc::wrap_post_send_error)?;
    crate::types_doc::read_type_and_finish_save(backend, &md5, path, text, &draft).await
  }
}
