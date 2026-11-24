// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Pre-edit checkpoint helpers and post-restore session document regeneration.

use anyhow::Result;
use serde_json::json;

use super::{Engine, Pending, Refresh};
use crate::backend::McpBackend;
use crate::document::Document;

/// Records a named project checkpoint in `ghidra-mcp` before a committed edit.
pub(crate) async fn record_checkpoint(backend: &McpBackend, md5: &str, name: &str) -> Result<()> {
  match backend
    .call(
      "session",
      "checkpoint.create",
      Some(md5),
      json!({"name": name}),
    )
    .await
  {
    Ok(_) => Ok(()),
    Err(error) if unsupported_checkpoint_operation(&error) => Ok(()),
    Err(error) => Err(error),
  }
}

/// Returns true when an older `ghidra-mcp` binary does not implement `checkpoint.create`.
fn unsupported_checkpoint_operation(error: &anyhow::Error) -> bool {
  let message = format!("{error:#}").to_ascii_lowercase();
  message.contains("checkpoint.create")
    && [
      "unknown",
      "unsupported",
      "invalid",
      "not allowed",
      "enum",
      "unrecognized",
    ]
    .iter()
    .any(|word| message.contains(word))
}

impl Engine {
  /// Records a checkpoint before committing `pending` symbol rename to Ghidra.
  pub(super) async fn record_rename_checkpoint(&self, md5: &str, pending: &Pending) -> Result<()> {
    let label = format!(
      "Before rename {} to {}",
      pending.symbol.name, pending.new_name
    );
    record_checkpoint(self.backend.as_ref(), md5, &label).await
  }

  /// Clears cached state for `md5` and regenerates open virtual documents after restore or reset.
  pub(crate) async fn refresh_after_restore(&mut self, md5: &str) -> Vec<Refresh> {
    self.pending.remove(md5);
    self.symbols.remove(md5);
    self.functions.retain(|(session, _), _| session != md5);
    let local_prefix = format!("Local:{md5}:");
    let parameter_prefix = format!("Parameter:{md5}:");
    self
      .local_details
      .retain(|id, _| !id.starts_with(&local_prefix) && !id.starts_with(&parameter_prefix));

    let documents: Vec<Document> = self
      .docs
      .values()
      .filter(|doc| doc.md5 == md5 && doc.entry.is_some())
      .cloned()
      .collect();
    let mut changes = Vec::new();
    for old in documents {
      let Some(entry) = old.entry.clone() else {
        continue;
      };
      let next = match self.generate(md5, &entry).await {
        Ok(generated) => generated,
        Err(error) => unavailable_function_document(&old, &entry, &error),
      };
      if let Some(change) = self.replace_restored_document(old, next) {
        changes.push(change);
      }
    }
    self.refresh_snapshots(md5).await;
    changes
  }

  /// Replaces `old` with `new` after restore or reset, overwriting stale local preview text.
  fn replace_restored_document(&mut self, old: Document, mut new: Document) -> Option<Refresh> {
    new.version = old.version;
    let uri = old.uri.clone();
    new.uri = uri.clone();
    new.saved = new.base.clone();
    let mut change = None;
    if old.version.is_some() {
      new.current = old.current;
      if new.current != new.base {
        self.refresh_allowed.insert(uri.clone(), new.base.clone());
        change = Some(Refresh {
          uri: uri.clone(),
          old: new.current.clone(),
          new: new.base.clone(),
          version: old.version,
        });
      } else {
        self.refresh_allowed.remove(&uri);
      }
    } else {
      self.refresh_allowed.remove(&uri);
    }
    self.docs.insert(uri, new);
    change
  }
}

/// Builds a read-only placeholder document when `entry` does not exist in the restored program.
fn unavailable_function_document(old: &Document, entry: &str, error: &anyhow::Error) -> Document {
  let warning = format!("Function {entry} is unavailable in this program state: {error:#}");
  let code = format!(
    "// Function {entry} is not defined in this program state.\n// {}\n",
    warning.replace('\n', "\n// ")
  );
  Document {
    uri: old.uri.clone(),
    md5: old.md5.clone(),
    entry: Some(entry.to_owned()),
    base: code.clone(),
    current: code.clone(),
    saved: code,
    version: old.version,
    spans: Vec::new(),
    warning: Some(warning),
  }
}
