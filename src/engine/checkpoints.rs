// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Pre-edit checkpoint helpers and post-restore session document regeneration.

use anyhow::Result;
use serde_json::json;

use super::{ClientBuffer, Engine, EngineState, Pending, Refresh};
use crate::backend::McpBackend;
use crate::document::{Document, canonical_virtual_uri};

/// Records a named project checkpoint in `ghidra-mcp` before a committed edit.
pub(crate) async fn record_checkpoint(backend: &McpBackend, md5: &str, name: &str) -> Result<()> {
  if !backend.supports_checkpoint_create().await? {
    return Ok(());
  }
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
    Err(error) if unsupported_session_operation(&error, "checkpoint.create") => {
      backend.set_checkpoint_create_supported(false).await;
      Ok(())
    }
    Err(error) if unsupported_attached_gpr_checkpoint(&error) => Ok(()),
    Err(error) => Err(error),
  }
}

/// Returns true when `error` shows that `md5` is an attached `.gpr` project without checkpoints.
fn unsupported_attached_gpr_checkpoint(error: &anyhow::Error) -> bool {
  let message = format!("{error:#}").to_ascii_lowercase();
  message.contains("attached .gpr") && message.contains("not supported")
}

/// Returns true when `error` shows that `ghidra_session` does not implement `operation`.
pub(crate) fn unsupported_session_operation(error: &anyhow::Error, operation: &str) -> bool {
  let message = format!("{error:#}").to_ascii_lowercase();
  let target = operation.to_ascii_lowercase();
  message.contains(&target)
    && [
      "unknown operation",
      "unknown variant",
      "unsupported operation",
      "unrecognized operation",
      "invalid operation",
      "not allowed",
      "not one of",
      "enum",
    ]
    .iter()
    .any(|phrase| message.contains(phrase))
}

impl Engine {
  /// Records a checkpoint before committing `pending` symbol rename to Ghidra.
  pub(super) async fn record_rename_checkpoint(&self, md5: &str, pending: &Pending) -> Result<()> {
    let label = format!(
      "Before rename {} to {}",
      pending.symbol.name, pending.new_name
    );
    record_checkpoint(self.backend().as_ref(), md5, &label).await
  }

  /// Clears cached state for `md5` and regenerates open virtual documents after restore or reset.
  pub(crate) async fn refresh_after_restore_locked(&self, md5: &str) -> Vec<Refresh> {
    let key = md5.to_ascii_lowercase();
    let (documents, start_gen, start_epoch) = {
      let mut state = self.write_state();
      let generation = state.generation;
      let epoch = state.bump_epoch(&key);
      state.pending.remove(&key);
      state.symbols.remove(&key);
      state.functions.retain(|(session, _), _| session != &key);
      let local_prefix = format!("Local:{key}:");
      let parameter_prefix = format!("Parameter:{key}:");
      state
        .local_details
        .retain(|id, _| !id.starts_with(&local_prefix) && !id.starts_with(&parameter_prefix));
      let documents: Vec<Document> = state
        .docs
        .values()
        .filter(|doc| doc.md5 == key && doc.entry.is_some())
        .cloned()
        .collect();
      (documents, generation, epoch)
    };
    self.open_flights.forget_session(&key);
    self.symbol_flights.forget_session(&key);

    let mut changes = Vec::new();
    for old in documents {
      let Some(entry) = old.entry.clone() else {
        continue;
      };
      let (next_doc, metadata) = match self.generate_function(&key, &entry, None).await {
        Ok(generated) => (generated.doc, generated.metadata),
        Err(error) => (unavailable_function_document(&old, &entry, &error), None),
      };
      let mut state = self.write_state();
      if state.is_closed_since(&key, start_epoch, start_gen) {
        return changes;
      }
      state.bump_epoch(&key);
      if let Some((entry_key, function_val, local_details)) = metadata {
        state.apply_generated_metadata(&key, entry_key, function_val, local_details);
      }
      if let Some(change) = replace_restored_document(&mut state, &old, next_doc) {
        changes.push(change);
      }
    }
    self
      .refresh_snapshots_locked(&key, start_epoch, start_gen)
      .await;
    changes
  }
}

/// Replaces `snapshot_old` with `new` after restore or reset, overwriting stale preview text.
fn replace_restored_document(
  state: &mut EngineState,
  snapshot_old: &Document,
  mut new: Document,
) -> Option<Refresh> {
  let uri = canonical_virtual_uri(&snapshot_old.uri);
  new.uri = uri.clone();
  new.saved = new.base.clone();
  let live = state.docs.get(&uri).unwrap_or(snapshot_old);
  new.version = live.version;
  let mut change = None;
  if live.version.is_some() {
    new.current = live.current.clone();
    if new.current != new.base {
      state
        .refresh_allowed
        .insert(uri.clone(), new.current.clone());
      change = Some(Refresh {
        uri: uri.clone(),
        old: new.current.clone(),
        new: new.base.clone(),
        version: live.version,
      });
    } else {
      state.refresh_allowed.remove(&uri);
    }
  } else if let Some(ClientBuffer::Open { version, text }) = state.client_buffers.remove(&uri) {
    new.version = Some(version);
    new.current = text;
    if new.current != new.base {
      state
        .refresh_allowed
        .insert(uri.clone(), new.current.clone());
      change = Some(Refresh {
        uri: uri.clone(),
        old: new.current.clone(),
        new: new.base.clone(),
        version: new.version,
      });
    } else {
      state.refresh_allowed.remove(&uri);
    }
  } else {
    state.refresh_allowed.remove(&uri);
  }
  state.docs.insert(uri, new);
  change
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
