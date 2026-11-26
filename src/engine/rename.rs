// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Scoped rename preview planning, origin save persistence, and pending rename discard.

use std::collections::HashMap;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  DocumentChanges, OneOf, OptionalVersionedTextDocumentIdentifier, Position, TextDocumentEdit,
  TextEdit, Uri, WorkspaceEdit,
};

use super::{Engine, EngineState, Pending, Refresh};
use crate::document::{
  Document, Span, Symbol, apply_edits, canonical_virtual_uri, matches_text, position, same_address,
  valid_name,
};

impl Engine {
  /// Plans a scoped rename preview across open session documents without writing to Ghidra.
  pub(crate) fn rename(&self, uri: &Uri, pos: Position, name: &str) -> Result<WorkspaceEdit> {
    self.write_state().rename(uri, pos, name)
  }
}

impl EngineState {
  /// Plans a scoped rename preview across open session documents without writing to Ghidra.
  pub(crate) fn rename(&mut self, uri: &Uri, pos: Position, name: &str) -> Result<WorkspaceEdit> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    ensure!(
      valid_name(name),
      "Use an ASCII identifier: letters, digits, underscore; no leading digit"
    );
    let (md5, symbol, _) = self.target(uri, pos)?;
    ensure!(name != symbol.name, "The name is unchanged");
    if symbol.local()
      && let Some(function) = self.functions.get(&(md5.clone(), symbol.address.clone()))
    {
      ensure!(
        !["parameters", "local_variables"]
          .iter()
          .flat_map(|k| {
            function
              .get(k)
              .and_then(Value::as_array)
              .into_iter()
              .flatten()
          })
          .any(|v| v.get("name").and_then(Value::as_str) == Some(name)),
        "Another variable or parameter already uses that name in this function"
      );
    }
    if let Some(old) = self.pending.get(&md5) {
      if !old.patched
        && old
          .expected
          .keys()
          .all(|u| self.docs.get(u).is_some_and(|d| d.current == d.base))
      {
        self.pending.remove(&md5);
      } else {
        bail!("Save or discard the pending rename in this session first");
      }
    }
    let mut expected = HashMap::new();
    let mut edits = vec![];
    let docs: Vec<&Document> = if symbol.local() {
      self.docs.get(uri).into_iter().collect()
    } else {
      self.docs.values().filter(|d| d.md5 == md5).collect()
    };
    for doc in docs {
      let replacements: Vec<TextEdit> = doc
        .spans
        .iter()
        .filter(|span| span_matches_symbol(span, &symbol))
        .map(|span| {
          let old = &doc.base[span.start..span.end];
          let replacement = if old == symbol.name {
            name.into()
          } else if let Some(prefix) = old.strip_suffix(&symbol.name) {
            format!("{prefix}{name}")
          } else {
            name.into()
          };
          TextEdit::new(doc.range(span), replacement)
        })
        .collect();
      if replacements.is_empty() {
        continue;
      }
      ensure!(
        doc.clean(),
        "A generated document has edits; refresh or discard those edits first"
      );
      expected.insert(doc.uri.clone(), apply_edits(&doc.base, &replacements)?);
      edits.push(TextDocumentEdit {
        text_document: OptionalVersionedTextDocumentIdentifier {
          uri: doc.uri.clone(),
          version: doc.version,
        },
        edits: replacements.into_iter().map(OneOf::Left).collect(),
      });
    }
    ensure!(
      expected.contains_key(uri),
      "No rename edits for the origin document"
    );
    self.pending.insert(
      md5,
      Pending {
        origin: uri.clone(),
        symbol,
        new_name: name.into(),
        expected,
        patched: false,
      },
    );
    Ok(WorkspaceEdit {
      document_changes: Some(DocumentChanges::Edits(edits)),
      ..Default::default()
    })
  }

  /// Detects a single-symbol inline identifier edit in `new_text` for auto-planning a rename.
  pub(crate) fn detect_rename(&self, uri: &Uri, new_text: &str) -> Option<(Position, String)> {
    let canon = canonical_virtual_uri(uri);
    let doc = self.docs.get(&canon)?;
    let old_clean = doc.base.replace("\r\n", "\n");
    let new_clean = new_text.replace("\r\n", "\n");

    if matches_text(&old_clean, &new_clean) {
      return None;
    }

    let prefix_bytes: usize = old_clean
      .chars()
      .zip(new_clean.chars())
      .take_while(|(a, b)| a == b)
      .map(|(c, _)| c.len_utf8())
      .sum();

    let suffix_bytes: usize = old_clean[prefix_bytes..]
      .chars()
      .rev()
      .zip(new_clean[prefix_bytes..].chars().rev())
      .take_while(|(a, b)| a == b)
      .map(|(c, _)| c.len_utf8())
      .sum();

    let old_diff_end = old_clean.len() - suffix_bytes;
    let new_diff_end = new_clean.len() - suffix_bytes;

    let word_start = old_clean[..prefix_bytes]
      .rfind(|c: char| !c.is_ascii_alphanumeric() && c != '_')
      .map_or(0, |i| i + 1);
    let word_end = old_clean[old_diff_end..]
      .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
      .map_or(old_clean.len(), |i| old_diff_end + i);

    let old_word = &old_clean[word_start..word_end];

    let new_word_prefix_len = prefix_bytes.saturating_sub(word_start);
    let new_word_start = word_start;
    let diff_len = new_diff_end.saturating_sub(prefix_bytes);
    let approx_new_end = new_word_start + new_word_prefix_len + diff_len;
    let approx_new_end = if approx_new_end <= new_clean.len() {
      let mut end = approx_new_end;
      while !new_clean.is_char_boundary(end) {
        end += 1;
      }
      end
    } else {
      new_clean.len()
    };
    let new_word_end = if approx_new_end < new_clean.len() {
      new_clean[approx_new_end..]
        .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .map_or(new_clean.len(), |i| approx_new_end + i)
    } else {
      new_clean.len()
    };

    if new_word_start >= new_word_end || new_word_end > new_clean.len() {
      return None;
    }

    let new_word = &new_clean[new_word_start..new_word_end];

    if old_word.is_empty() || new_word.is_empty() || old_word == new_word || !valid_name(new_word) {
      return None;
    }

    let pos = position(&old_clean, word_start);
    let (_, symbol, _) = self.target(&canon, pos).ok()?;

    if symbol.name != old_word {
      return None;
    }

    Some((pos, new_word.to_owned()))
  }
}

impl Engine {
  /// Acquires the per-session lock and commits a pending rename when saving `uri`.
  pub(crate) async fn save(&self, uri: &Uri, text: Option<String>) -> Result<Vec<Refresh>> {
    let canon = canonical_virtual_uri(uri);
    let md5 = self
      .read_state()
      .docs
      .get(&canon)
      .context("Unknown document")?
      .md5
      .clone();
    let _guard = self.lock_session(&md5).await;
    self.save_locked(&md5, &canon, text).await
  }

  /// Validates and commits a pending rename while the caller holds the `md5` session lock.
  pub(crate) async fn save_locked(
    &self,
    md5: &str,
    uri: &Uri,
    text: Option<String>,
  ) -> Result<Vec<Refresh>> {
    let pending = {
      let mut state = self.write_state();
      let (current_text, base_text) = {
        let doc = state.docs.get(uri).context("Unknown document")?;
        if let Some(text) = text {
          ensure!(
            matches_text(&text, &doc.current),
            "Save text differs from the synchronized document"
          );
        }
        (doc.current.clone(), doc.base.clone())
      };
      let Some(pending) = state.pending.get(md5).cloned() else {
        ensure!(
          matches_text(&current_text, &base_text),
          "Only an F2 rename can be saved to Ghidra; arbitrary text edits are not supported"
        );
        if let Some(doc) = state.docs.get_mut(uri) {
          doc.saved = doc.current.clone();
        }
        return Ok(vec![]);
      };
      if !pending.patched
        && pending.expected.keys().all(|u| {
          state
            .docs
            .get(u)
            .is_some_and(|d| matches_text(&d.current, &d.base))
        })
      {
        state.pending.remove(md5);
        if let Some(doc) = state.docs.get_mut(uri) {
          doc.saved = doc.current.clone();
        }
        return Ok(vec![]);
      }
      if pending.origin != *uri {
        ensure!(
          pending
            .expected
            .get(uri)
            .is_some_and(|exp| matches_text(&current_text, exp))
            || matches_text(&current_text, &base_text),
          "Saved text does not match the pending F2 rename"
        );
        if let Some(doc) = state.docs.get_mut(uri) {
          doc.saved = doc.current.clone();
        }
        return Ok(vec![]);
      }
      ensure!(
        pending
          .expected
          .get(uri)
          .is_some_and(|exp| matches_text(&current_text, exp)),
        "Saved text does not match the pending F2 rename"
      );
      for (u, expected) in &pending.expected {
        let doc = state
          .docs
          .get(u)
          .context("Expected rename document is missing")?;
        ensure!(
          matches_text(&doc.current, &doc.base) || matches_text(&doc.current, expected),
          "A rename document has unrelated edits; commit stopped"
        );
      }
      pending
    };

    let backend = self.backend();
    let (domain, selector, current_name) = self.resolve_rename_target(md5, &pending).await?;
    if !pending.patched && current_name == pending.symbol.name {
      self.record_rename_checkpoint(md5, &pending).await?;
      // Mark uncertain write outcomes and evict cached symbols before sending the write.
      {
        let mut state = self.write_state();
        state.bump_epoch(md5);
        state.symbols.remove(md5);
        if let Some(p) = state.pending.get_mut(md5) {
          p.patched = true;
        }
      }
      let (tool_domain, operation) = match domain {
        "function_local_variable" => ("function", "local_variable.patch"),
        "function_parameter" => ("function", "parameter.patch"),
        _ => (domain, "patch"),
      };
      let patch_result = backend
        .call(
          tool_domain,
          operation,
          Some(md5),
          json!({"selector": selector, "patch": {"name": pending.new_name}}),
        )
        .await;
      self.invalidate_symbols(md5);
      if let Err(err) = patch_result {
        if !err.to_string().contains("timed out")
          && let Some(p) = self.write_state().pending.get_mut(md5)
        {
          p.patched = false;
        }
        return Err(err);
      }
    } else if current_name == pending.new_name {
      if let Some(p) = self.write_state().pending.get_mut(md5) {
        p.patched = true;
      }
    } else if pending.patched && current_name == pending.symbol.name {
      if let Some(p) = self.write_state().pending.get_mut(md5) {
        p.patched = false;
      }
      bail!("The earlier write did not apply. Save again to retry the rename.");
    } else {
      bail!("Symbol name changed externally; commit stopped");
    }

    let saved = backend
      .call("program", "save", Some(md5), json!({}))
      .await
      .context(
        "Symbol renamed but not persisted; save the origin document again to retry persistence",
      )?;
    ensure!(
      saved.get("saved").and_then(Value::as_bool) == Some(true),
      "Symbol renamed but backend did not confirm persistence; save again"
    );
    {
      let mut state = self.write_state();
      state.bump_epoch(md5);
      state.symbols.remove(md5);
      // Keep the pending plan until persistence succeeds; after save, never reapply the patch.
      state.pending.remove(md5);
      if let Some(doc) = state.docs.get_mut(uri) {
        doc.saved = doc.current.clone();
      }
      for (u, expected) in &pending.expected {
        if state.docs.get(u).is_some_and(|d| &d.current == expected) {
          state.refresh_allowed.insert(u.clone(), expected.clone());
        }
      }
    }
    self
      .refresh_session_locked(md5, Some(&pending))
      .await
      .context(
        "Rename persisted, but regeneration failed. Use Ghidra: Refresh Documents to recover",
      )
  }

  /// Resolves the backend domain, selector payload, and live name for a pending rename target.
  async fn resolve_rename_target(
    &self,
    md5: &str,
    pending: &Pending,
  ) -> Result<(&'static str, Value, String)> {
    if pending.symbol.local() {
      return Ok(self.resolve_local_rename_target(md5, pending).await);
    }
    let backend = self.backend();
    if pending.symbol.id.starts_with("Function:") {
      let function = backend
        .call(
          "function",
          "get",
          Some(md5),
          json!({"selector": {"entry": pending.symbol.address}}),
        )
        .await?;
      let current_name = function
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&pending.symbol.name)
        .to_owned();
      return Ok((
        "function",
        json!({"entry": pending.symbol.address}),
        current_name,
      ));
    }
    if pending.symbol.id.starts_with("Label:") {
      return Ok(self.resolve_label_rename_target(md5, pending).await);
    }
    let current = backend
      .call(
        "symbol",
        "get",
        Some(md5),
        json!({"selector": {"id": pending.symbol.id}}),
      )
      .await?;
    let current: Symbol = serde_json::from_value(current)?;
    ensure!(
      current.id == pending.symbol.id
        && current.address == pending.symbol.address
        && current.namespace == pending.symbol.namespace
        && current.kind == pending.symbol.kind,
      "Symbol identity changed; commit stopped"
    );
    Ok(("symbol", json!({"id": pending.symbol.id}), current.name))
  }

  /// Resolves a function parameter or local variable selector and live name from Ghidra.
  async fn resolve_local_rename_target(
    &self,
    md5: &str,
    pending: &Pending,
  ) -> (&'static str, Value, String) {
    let detail = self.read_state().local_detail(&pending.symbol);
    let function = self
      .backend()
      .call(
        "function",
        "get",
        Some(md5),
        json!({"selector": {"entry": pending.symbol.address}}),
      )
      .await
      .ok();
    if pending.symbol.kind == "Parameter" {
      let ordinal = detail
        .as_ref()
        .and_then(|d| d.get("ordinal").and_then(Value::as_u64))
        .or_else(|| {
          function
            .as_ref()
            .and_then(|f| f.get("parameters"))
            .and_then(Value::as_array)
            .and_then(|params| {
              params.iter().find(|v| {
                let n = v.get("name").and_then(Value::as_str);
                n == Some(&pending.symbol.name) || n == Some(&pending.new_name)
              })
            })
            .and_then(|v| v.get("ordinal").and_then(Value::as_u64))
        });
      let current_name = function
        .as_ref()
        .and_then(|f| f.get("parameters"))
        .and_then(Value::as_array)
        .and_then(|params| {
          ordinal.and_then(|ord| {
            params
              .iter()
              .find(|v| v.get("ordinal").and_then(Value::as_u64) == Some(ord))
          })
        })
        .and_then(|v| v.get("name").and_then(Value::as_str))
        .unwrap_or(&pending.symbol.name)
        .to_owned();
      if let Some(ord) = ordinal {
        return (
          "function_parameter",
          json!({"entry": pending.symbol.address, "ordinal": ord}),
          current_name,
        );
      }
      return (
        "function_local_variable",
        json!({"entry": pending.symbol.address, "name": pending.symbol.name}),
        pending.symbol.name.clone(),
      );
    }

    let expected_storage = detail
      .as_ref()
      .and_then(|d| d.get("storage"))
      .filter(|s| !s.is_null());
    let matched = function
      .as_ref()
      .and_then(|f| f.get("local_variables"))
      .and_then(Value::as_array)
      .and_then(|vars| {
        expected_storage
          .and_then(|st| vars.iter().find(|v| v.get("storage") == Some(st)))
          .or_else(|| {
            vars.iter().find(|v| {
              let n = v.get("name").and_then(Value::as_str);
              n == Some(&pending.new_name) || n == Some(&pending.symbol.name)
            })
          })
      });
    let current_name = matched
      .and_then(|v| v.get("name").and_then(Value::as_str))
      .unwrap_or(&pending.symbol.name)
      .to_owned();
    let selector_name = if current_name == pending.new_name {
      pending.new_name.as_str()
    } else {
      pending.symbol.name.as_str()
    };
    (
      "function_local_variable",
      json!({"entry": pending.symbol.address, "name": selector_name}),
      current_name,
    )
  }

  /// Resolves a synthetic label symbol ID and live name by address or name query.
  async fn resolve_label_rename_target(
    &self,
    md5: &str,
    pending: &Pending,
  ) -> (&'static str, Value, String) {
    let backend = self.backend();
    let mut matched: Option<(String, String)> = None;
    for filter in [
      json!({"address": pending.symbol.address}),
      json!({"name": pending.symbol.name}),
    ] {
      if matched.is_some() {
        break;
      }
      if let Ok(list) = backend
        .call(
          "symbol",
          "list",
          Some(md5),
          json!({"filter": filter, "page": {"limit": 50}}),
        )
        .await
        && let Some(items) = list.get("items").and_then(Value::as_array)
      {
        matched = pick_label_item(items, pending);
      }
    }
    let (sym_id, current_name) =
      matched.unwrap_or_else(|| (pending.symbol.id.clone(), pending.symbol.name.clone()));
    ("symbol", json!({"id": sym_id}), current_name)
  }

  /// Reverts an unpatched pending rename across affected session documents under the session lock.
  pub(crate) fn discard_locked(&self, md5: &str) -> Result<Vec<Refresh>> {
    let mut state = self.write_state();
    let Some(pending) = state.pending.get(md5).cloned() else {
      return Ok(vec![]);
    };
    ensure!(
      !pending.patched,
      "A backend write may already have occurred; save the origin document to resolve persistence first"
    );
    let mut changes = vec![];
    for (uri, expected) in &pending.expected {
      let doc = state.docs.get_mut(uri).context("Missing rename document")?;
      ensure!(
        doc.current == doc.base || &doc.current == expected,
        "Document has unrelated edits; discard or undo them first"
      );
    }
    for uri in pending.expected.keys() {
      let Some(doc) = state.docs.get_mut(uri) else {
        continue;
      };
      if doc.version.is_some() && doc.current != doc.base {
        changes.push(Refresh {
          uri: uri.clone(),
          old: doc.current.clone(),
          new: doc.base.clone(),
          version: doc.version,
        });
      } else {
        doc.current = doc.base.clone();
      }
      if doc.version.is_none() {
        doc.saved = doc.base.clone();
      }
    }
    state.bump_epoch(md5);
    state.pending.remove(md5);
    Ok(changes)
  }
}

/// Returns true when `span` refers to `symbol` or carries an unresolved fallback matching token.
fn span_matches_symbol(span: &Span, symbol: &Symbol) -> bool {
  if let Some(v) = &span.symbol {
    v.id == symbol.id
  } else if symbol.kind.eq_ignore_ascii_case("function") {
    span.token.kind == "function" && span.token.text == symbol.name
  } else if symbol.local() {
    matches!(span.token.kind.as_str(), "variable" | "parameter") && span.token.text == symbol.name
  } else if symbol.kind.eq_ignore_ascii_case("label")
    || symbol.kind.eq_ignore_ascii_case("constant")
  {
    span.token.text == symbol.name
  } else {
    false
  }
}

/// Selects the matching symbol `(id, name)` entry for a pending label rename.
fn pick_label_item(items: &[Value], pending: &Pending) -> Option<(String, String)> {
  items
    .iter()
    .find(|item| {
      let same_name = item
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|n| n == pending.symbol.name || n == pending.new_name);
      let same_addr = item
        .get("address")
        .and_then(Value::as_str)
        .is_some_and(|a| same_address(a, &pending.symbol.address));
      same_name && same_addr
    })
    .or_else(|| items.first())
    .and_then(|item| {
      let id = item.get("id").and_then(Value::as_str)?.to_owned();
      let cur = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&pending.symbol.name)
        .to_owned();
      Some((id, cur))
    })
}
