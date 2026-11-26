// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Session document regeneration, single-document refresh, and snapshot installation.

use anyhow::{Context, Result, ensure};
use tower_lsp_server::ls_types::Uri;

use super::{ClientBuffer, Engine, EngineState, Pending, Refresh};
use crate::document::{Document, canonical_virtual_uri};

impl Engine {
  /// Fetches and installs a synthetic `symbol`, `references`, or `type` snapshot document.
  pub(crate) async fn open_snapshot(
    &self,
    uri: &Uri,
    md5: &str,
    kind: &str,
    id: &str,
    refresh_clean: bool,
  ) -> Result<Uri> {
    let canon = canonical_virtual_uri(uri);
    let (initial_gen, initial_epoch) = {
      let state = self.read_state();
      if state
        .docs
        .get(&canon)
        .is_some_and(|doc| !refresh_clean || !doc.clean())
      {
        return Ok(canon);
      }
      (state.generation, state.epoch(md5))
    };
    loop {
      let (generation, epoch) = {
        let state = self.read_state();
        ensure!(
          !state.is_closed_since(md5, initial_epoch, initial_gen),
          "Session was closed"
        );
        if state
          .docs
          .get(&canon)
          .is_some_and(|doc| !refresh_clean || !doc.clean())
        {
          return Ok(canon);
        }
        (state.generation, state.epoch(md5))
      };
      let text = self.snapshot_text(md5, kind, id).await?;
      let mut state = self.write_state();
      ensure!(
        !state.is_closed_since(md5, initial_epoch, initial_gen)
          && !state.is_closed_since(md5, epoch, generation),
        "Session was closed"
      );
      if state.epoch(md5) != epoch {
        continue;
      }
      if state
        .docs
        .get(&canon)
        .is_none_or(|doc| refresh_clean && doc.clean())
      {
        return state.install(Document {
          uri: canon,
          md5: md5.to_ascii_lowercase(),
          entry: None,
          base: text.clone(),
          current: text.clone(),
          saved: text,
          version: None,
          spans: vec![],
          warning: None,
        });
      }
      return Ok(canon);
    }
  }

  /// Regenerates every clean or accepted document in session `md5` while holding the session lock.
  pub(crate) async fn refresh_session_locked(
    &self,
    md5: &str,
    committed: Option<&Pending>,
  ) -> Result<Vec<Refresh>> {
    let (documents, start_gen, start_epoch) = {
      let mut state = self.write_state();
      if state.pending.get(md5).is_some_and(|p| {
        !p.patched
          && p
            .expected
            .keys()
            .all(|u| state.docs.get(u).is_some_and(|d| d.current == d.base))
      }) {
        state.pending.remove(md5);
      }
      ensure!(
        committed.is_some() || !state.pending.contains_key(md5),
        "Save or discard the pending rename before refreshing"
      );
      let generation = state.generation;
      let epoch = state.bump_epoch(md5);
      state.symbols.remove(md5);
      let documents: Vec<_> = state
        .docs
        .values()
        .filter(|doc| {
          if doc.md5 != md5 || doc.entry.is_none() {
            return false;
          }
          let accepted = committed.and_then(|p| p.expected.get(&doc.uri));
          doc.clean()
            || accepted == Some(&doc.current)
            || state.refresh_allowed.get(&doc.uri) == Some(&doc.current)
        })
        .cloned()
        .collect();
      (documents, generation, epoch)
    };

    let mut changes = vec![];
    for old in documents {
      let Some(entry) = old.entry.as_deref() else {
        continue;
      };
      let generated = self.generate_function(md5, entry, None).await?;
      let accepted = committed
        .and_then(|p| p.expected.get(&old.uri))
        .map(String::as_str);
      let mut state = self.write_state();
      ensure!(
        !state.is_closed_since(md5, start_epoch, start_gen),
        "Session was closed"
      );
      state.bump_epoch(md5);
      if let Some((entry_key, function_val, local_details)) = generated.metadata {
        state.apply_generated_metadata(md5, entry_key, function_val, local_details);
      }
      if let Some(change) = replace_generated(&mut state, &old, generated.doc, accepted) {
        changes.push(change);
      }
    }
    self
      .refresh_snapshots_locked(md5, start_epoch, start_gen)
      .await;
    Ok(changes)
  }

  /// Refreshes clean read-only `symbol`, `references`, and `type` snapshots in session `md5`.
  pub(super) async fn refresh_snapshots_locked(&self, md5: &str, start_epoch: u64, start_gen: u64) {
    let snapshots: Vec<_> = {
      let state = self.read_state();
      state
        .docs
        .values()
        .filter(|doc| doc.md5 == md5 && doc.entry.is_none() && doc.clean())
        .filter_map(|doc| {
          let parsed = url::Url::parse(doc.uri.as_str()).ok()?;
          let mut parts = parsed.path_segments()?;
          let kind = parts.next()?.to_owned();
          if !matches!(kind.as_str(), "symbol" | "references" | "type") {
            return None;
          }
          let id = percent_encoding::percent_decode_str(parts.next()?)
            .decode_utf8()
            .ok()?
            .into_owned();
          Some((doc.uri.clone(), kind, id))
        })
        .collect()
    };
    for (uri, kind, id) in snapshots {
      let (text, warning) = match self.snapshot_text(md5, &kind, &id).await {
        Ok(text) => (text, None),
        Err(error) => {
          let warning = format!("This {kind} is unavailable in the current analysis: {error:#}");
          (
            format!("// {}\n", warning.replace('\n', "\n// ")),
            Some(warning),
          )
        }
      };
      let mut state = self.write_state();
      if state.is_closed_since(md5, start_epoch, start_gen) {
        return;
      }
      if let Some(doc) = state.docs.get_mut(&uri)
        && doc.clean()
      {
        doc.base = text.clone();
        doc.current = text.clone();
        doc.saved = text;
        doc.warning = warning;
      }
    }
  }

  /// Regenerates a single clean function document `uri` while holding the session lock.
  pub(crate) async fn refresh_document_locked(&self, uri: &Uri) -> Result<Vec<Refresh>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let (old, entry, start_gen, start_epoch) = {
      let mut state = self.write_state();
      let old = state
        .docs
        .get(uri)
        .context("Unknown virtual document")?
        .clone();
      if !old.clean() || state.pending.contains_key(&old.md5) {
        return Ok(vec![]);
      }
      let Some(entry) = old.entry.clone() else {
        return Ok(vec![]);
      };
      let generation = state.generation;
      let epoch = state.bump_epoch(&old.md5);
      (old, entry, generation, epoch)
    };
    let generated = self
      .generate_function(&old.md5, &entry, Some(&old.base))
      .await?;
    let base_changed = old.base != generated.doc.base;
    let change = {
      let mut state = self.write_state();
      ensure!(
        !state.is_closed_since(&old.md5, start_epoch, start_gen),
        "Session was closed"
      );
      state.bump_epoch(&old.md5);
      if let Some((entry_key, function_val, local_details)) = generated.metadata {
        state.apply_generated_metadata(&old.md5, entry_key, function_val, local_details);
      }
      replace_generated(&mut state, &old, generated.doc, None)
    };
    if base_changed {
      self
        .refresh_snapshots_locked(&old.md5, start_epoch, start_gen)
        .await;
    }
    Ok(change.into_iter().collect())
  }
}

/// Installs regenerated `new` over live state while preserving concurrent `did_change` edits.
fn replace_generated(
  state: &mut EngineState,
  snapshot_old: &Document,
  mut new: Document,
  accepted: Option<&str>,
) -> Option<Refresh> {
  new.uri = canonical_virtual_uri(&new.uri);
  let uri = new.uri.clone();
  let live = state.docs.get(&uri).unwrap_or(snapshot_old);
  new.version = live.version;
  let mut change = None;
  if live.version.is_some() {
    new.current = live.current.clone();
    new.saved = live.saved.clone();
    let eligible = live.current == snapshot_old.base
      || accepted == Some(live.current.as_str())
      || state.refresh_allowed.get(&uri) == Some(&live.current);
    if !eligible && new.current != new.base {
      state.docs.insert(uri, new);
      return None;
    }
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
  } else {
    if let Some(ClientBuffer::Open { version, text }) = state.client_buffers.remove(&uri) {
      new.version = Some(version);
      new.current = text;
    }
    state.refresh_allowed.remove(&uri);
  }
  state.docs.insert(uri, new);
  change
}
