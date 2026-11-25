// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Synchronous in-memory session, document, cache, and epoch state for [`crate::engine::Engine`].

use std::collections::HashMap;

use anyhow::{Context, Result};
use serde_json::Value;
use tower_lsp_server::ls_types::Uri;

use super::Pending;
use crate::document::{Document, Symbol, canonical_virtual_uri, same_address};

/// Buffered client document state recorded while an initial uncached open is in flight.
#[derive(Clone, Debug)]
pub(crate) enum ClientBuffer {
  /// Latest editor text and version received from `did_open` or `did_change`.
  Open {
    /// Monotonic LSP document version supplied by the editor client.
    version: i32,
    /// Full synchronized buffer contents from the editor client.
    text: String,
  },
  /// Marker recorded when `did_close` arrives before the initial open finishes.
  Closed,
}

/// In-memory session selection, opened buffers, caches, and epoch counters.
#[derive(Default)]
pub(crate) struct EngineState {
  /// Monotonic counter incremented when `initialize` resets the engine.
  pub(crate) generation: u64,
  /// Currently selected 32-character lowercase MD5 session hash.
  pub(crate) active: Option<String>,
  /// Virtual documents indexed by their canonical `ghidra://` URI.
  pub(crate) docs: HashMap<Uri, Document>,
  /// Buffered client edits for documents whose initial backend open is still running.
  pub(crate) client_buffers: HashMap<Uri, ClientBuffer>,
  /// Pending scoped rename plan keyed by lowercase session MD5.
  pub(crate) pending: HashMap<String, Pending>,
  /// Cached symbol tables keyed by lowercase session MD5.
  pub(crate) symbols: HashMap<String, Vec<Symbol>>,
  /// Pre-accepted document text after a confirmed backend save, keyed by URI.
  pub(crate) refresh_allowed: HashMap<Uri, String>,
  /// Cached function JSON payloads indexed by session MD5 and entry address.
  pub(crate) functions: HashMap<(String, String), Value>,
  /// Cached local variable and parameter metadata keyed by synthetic symbol ID.
  pub(crate) local_details: HashMap<String, Value>,
  /// Per-session mutation, refresh, and close epoch counters keyed by lowercase MD5.
  epochs: HashMap<String, u64>,
  /// Latest epoch at which each lowercase MD5 session was explicitly closed.
  closed_epochs: HashMap<String, u64>,
}

impl EngineState {
  /// Clears cached state while advancing `generation` so in-flight callers abort installation.
  pub(crate) fn reset(&mut self) {
    let next_generation = self.generation.wrapping_add(1);
    *self = Self {
      generation: next_generation,
      ..Self::default()
    };
  }

  /// Returns the selected session MD5 or an error when no session is active.
  pub(crate) fn session(&self) -> Result<&str> {
    self
      .active
      .as_deref()
      .context("Select a Ghidra session first")
  }

  /// Returns cached parameter or local variable detail for `symbol` when present.
  pub(crate) fn local_detail(&self, symbol: &Symbol) -> Option<Value> {
    symbol
      .local()
      .then(|| self.local_details.get(&symbol.id).cloned())
      .flatten()
  }

  /// Returns the current mutation and close epoch for session `md5`.
  pub(crate) fn epoch(&self, md5: &str) -> u64 {
    let key = md5.to_ascii_lowercase();
    self.epochs.get(&key).copied().unwrap_or(0)
  }

  /// Increments and returns the epoch counter for session `md5`.
  pub(crate) fn bump_epoch(&mut self, md5: &str) -> u64 {
    let key = md5.to_ascii_lowercase();
    let entry = self.epochs.entry(key).or_insert(0);
    *entry = entry.wrapping_add(1);
    *entry
  }

  /// Returns true when `md5` was closed or the engine was reset after `(start_epoch, start_gen)`.
  pub(crate) fn is_closed_since(&self, md5: &str, start_epoch: u64, start_gen: u64) -> bool {
    if self.generation != start_gen {
      return true;
    }
    let key = md5.to_ascii_lowercase();
    self
      .closed_epochs
      .get(&key)
      .is_some_and(|&closed_at| closed_at > start_epoch)
  }

  /// Finds an already opened function document in session `md5` matching `entry` or `decoded`.
  pub(crate) fn find_function_doc(
    &self,
    md5: &str,
    entry: &str,
    decoded: &str,
  ) -> Option<&Document> {
    self.docs.values().find(|doc| {
      doc.md5 == md5
        && doc
          .entry
          .as_deref()
          .is_some_and(|e| e == entry || e == decoded || same_address(e, decoded))
    })
  }

  /// Replaces cached function and local-variable metadata for `(md5, entry_key)`.
  pub(crate) fn apply_generated_metadata(
    &mut self,
    md5: &str,
    entry_key: String,
    function: Value,
    local_details: HashMap<String, Value>,
  ) {
    let param_prefix = format!("Parameter:{md5}:{entry_key}:");
    let local_prefix = format!("Local:{md5}:{entry_key}:");
    self
      .local_details
      .retain(|key, _| !key.starts_with(&param_prefix) && !key.starts_with(&local_prefix));
    self.local_details.extend(local_details);
    self.functions.insert((md5.to_owned(), entry_key), function);
  }

  /// Stores `doc` under its canonical URI while preserving newer client versions and edits.
  pub(crate) fn install(&mut self, mut doc: Document) -> Result<Uri> {
    doc.uri = canonical_virtual_uri(&doc.uri);
    let uri = doc.uri.clone();
    if let Some(old) = self.docs.get(&uri)
      && let Some(old_ver) = old.version
      && doc.version.is_none_or(|new_ver| new_ver < old_ver)
    {
      doc.version = Some(old_ver);
      if !old.clean() {
        doc.current = old.current.clone();
      }
      if old.saved != old.base {
        doc.saved = old.saved.clone();
      }
    }
    if let Some(ClientBuffer::Open { version, text }) = self.client_buffers.get(&uri) {
      if doc
        .version
        .is_none_or(|current_ver| current_ver <= *version)
      {
        doc.version = Some(*version);
        doc.current = text.clone();
      }
      self.client_buffers.remove(&uri);
    }
    self.docs.insert(uri.clone(), doc);
    Ok(uri)
  }

  /// Removes clean document `uri` when no uncommitted local edits or rename previews remain.
  pub(crate) fn close_document(&mut self, uri: &Uri) {
    let canon = canonical_virtual_uri(uri);
    let keep = self.docs.get(&canon).is_some_and(|doc| {
      !doc.clean()
        || self
          .pending
          .get(&doc.md5)
          .is_some_and(|plan| plan.expected.contains_key(&canon))
    });
    if !keep {
      self.docs.remove(&canon);
      self.refresh_allowed.remove(&canon);
    }
  }

  /// Drops every view, rename plan, and semantic cache belonging to closed session `md5`.
  pub(crate) fn forget_session(&mut self, md5: &str) {
    let key = md5.to_ascii_lowercase();
    let closed_at = self.bump_epoch(&key);
    self.closed_epochs.insert(key.clone(), closed_at);
    self.docs.retain(|_, doc| doc.md5 != key);
    self.client_buffers.retain(|uri, _| {
      url::Url::parse(uri.as_str())
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_ascii_lowercase))
        .as_deref()
        != Some(key.as_str())
    });
    self.pending.remove(&key);
    self.symbols.remove(&key);
    self.functions.retain(|(session, _), _| session != &key);
    let local_prefix = format!("Local:{key}:");
    let parameter_prefix = format!("Parameter:{key}:");
    self
      .local_details
      .retain(|id, _| !id.starts_with(&local_prefix) && !id.starts_with(&parameter_prefix));
    self.refresh_allowed.retain(|uri, _| {
      url::Url::parse(uri.as_str())
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_ascii_lowercase))
        .as_deref()
        != Some(key.as_str())
    });
    if self.active.as_deref() == Some(key.as_str()) {
      self.active = None;
    }
  }
}
