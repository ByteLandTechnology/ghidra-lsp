// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Custom `workspace/executeCommand` handlers for string enumeration and structured edits.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use super::Server;
use crate::backend::McpBackend;

impl Server {
  /// Dispatches string lookup and comment, prototype, and variable mutation commands.
  pub(super) async fn execute_edit_command(
    &self,
    command: &str,
    arg: Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    match command {
      "ghidra.strings" => {
        let md5 = self.scoped_md5(&arg).await?;
        crate::address::defined_strings(backend, &md5).await
      }
      "ghidra.commentsAt" => {
        let md5 = self.scoped_md5(&arg).await?;
        let address = arg
          .get("address")
          .and_then(Value::as_str)
          .context("address is required")?;
        crate::mutations::comments_at(backend, &md5, address).await
      }
      "ghidra.saveComment" => self.handle_save_comment(&arg, backend).await,
      "ghidra.functionPrototype" => {
        let md5 = self.scoped_md5(&arg).await?;
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
    let md5 = self.scoped_md5(arg).await?;
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
    let e = self.engine.lock().await;
    Self::ensure_program_clean(&e, &md5)?;
    let prepared =
      crate::mutations::prepare_comment_mutation(backend, &md5, address, kind, text, expected)
        .await?;
    if !prepared.changed {
      drop(e);
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
    let result = crate::mutations::execute_comment_mutation(backend, &md5, &prepared).await?;
    self.commit_and_refresh(e, backend, &md5, None).await?;
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
    let md5 = self.scoped_md5(arg).await?;
    let entry = arg
      .get("entry")
      .and_then(Value::as_str)
      .context("entry is required")?;
    let original = arg
      .get("original")
      .filter(|v| v.is_object())
      .context("original function snapshot is required")?;
    let payload = arg.get("payload").filter(|v| v.is_object()).unwrap_or(arg);
    let e = self.engine.lock().await;
    Self::ensure_program_clean(&e, &md5)?;
    let ops = if command == "ghidra.saveFunctionPrototype" {
      crate::mutations::prepare_function_prototype_ops(backend, &md5, entry, original, payload)
        .await?
    } else {
      crate::mutations::prepare_variables_ops(backend, &md5, entry, original, payload).await?
    };
    let result = crate::mutations::execute_ops(backend, &md5, &ops).await?;
    self.commit_and_refresh(e, backend, &md5, None).await?;
    Ok(json!({
      "md5": md5,
      "entry": entry,
      "persisted": true,
      "result": result,
    }))
  }
}
