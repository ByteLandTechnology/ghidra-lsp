// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Call hierarchy item preparation and incoming/outgoing call edge queries.

use std::collections::HashMap;

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tower_lsp_server::ls_types::{
  CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Position, Range,
  SymbolKind, Uri,
};

use super::{Engine, ensure_symbols, open_function};
use crate::backend::{McpBackend, list_all};
use crate::document::{
  Span, canonical_virtual_uri, in_address_range, position, same_address, virtual_uri,
};

/// Owned document cursor state captured before preparing a call hierarchy root item.
struct HierarchySnapshot {
  /// Lowercase 32-character MD5 session hash owning the document.
  md5: String,
  /// Enclosing function entry address when the document is a function buffer.
  entry: Option<String>,
  /// Byte offset of the function body opening brace.
  body_start: usize,
  /// Full document range in UTF-16 coordinates.
  doc_range: Range,
  /// Declaration token text and UTF-16 range for the enclosing function header.
  decl_info: Option<(String, Range)>,
  /// Token span covering the cursor position when available.
  span: Option<Span>,
  /// UTF-16 range of `span` when present.
  span_range: Range,
}

impl Engine {
  /// Snapshots document cursor state for `prepare_call_hierarchy` without MCP I/O.
  fn snapshot_call_hierarchy(&self, uri: &Uri, pos: Position) -> Result<Option<HierarchySnapshot>> {
    let doc = self.docs.get(uri).context("Unknown virtual document")?;
    if !doc.clean() {
      return Ok(None);
    }
    let Some(cursor) = crate::document::offset(&doc.base, pos) else {
      return Ok(None);
    };
    let body_start = doc.body_start();
    let span = doc
      .spans
      .iter()
      .find(|s| s.start <= cursor && cursor < s.end)
      .cloned();
    let span_range = span.as_ref().map(|s| doc.range(s)).unwrap_or_default();
    let decl_info = doc
      .spans
      .iter()
      .find(|s| s.token.kind == "function" && s.start < body_start)
      .map(|s| (s.token.text.clone(), doc.range(s)));
    let doc_range = Range::new(Position::new(0, 0), position(&doc.base, doc.base.len()));
    Ok(Some(HierarchySnapshot {
      md5: doc.md5.clone(),
      entry: doc.entry.clone(),
      body_start,
      doc_range,
      decl_info,
      span,
      span_range,
    }))
  }
}

/// Builds the root [`CallHierarchyItem`] for the function or call expression at `pos`.
pub(crate) async fn prepare_call_hierarchy(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  uri: &Uri,
  pos: Position,
) -> Result<Option<Vec<CallHierarchyItem>>> {
  let canon = canonical_virtual_uri(uri);
  let Some(snap) = engine.lock().await.snapshot_call_hierarchy(&canon, pos)? else {
    return Ok(None);
  };

  let target_symbol = if let Some(s) = &snap.span {
    if let Some(sym) = &s.symbol {
      if sym.kind.eq_ignore_ascii_case("function") {
        Some(sym.clone())
      } else {
        None
      }
    } else if s.token.kind == "function" {
      let symbols = ensure_symbols(engine, backend, &snap.md5).await?;
      symbols.into_iter().find(|sym| {
        sym.kind.eq_ignore_ascii_case("function")
          && (sym.name == s.token.text || s.token.address.as_deref() == Some(&sym.address))
      })
    } else {
      None
    }
  } else {
    None
  };

  let (func_name, func_entry) = if let Some(sym) = target_symbol {
    (sym.display_name(), sym.address)
  } else if let Some(s) = &snap.span
    && s.token.kind == "function"
  {
    let addr = if s.start < snap.body_start {
      snap
        .entry
        .clone()
        .unwrap_or_else(|| s.token.address.clone().unwrap_or_default())
    } else {
      s.token
        .address
        .clone()
        .unwrap_or_else(|| snap.entry.clone().unwrap_or_default())
    };
    (s.token.text.clone(), addr)
  } else if let Some(ref entry_addr) = snap.entry {
    let name = snap
      .decl_info
      .as_ref()
      .map(|(text, _)| text.clone())
      .unwrap_or_else(|| format!("sub_{entry_addr}"));
    (name, entry_addr.clone())
  } else {
    return Ok(None);
  };

  let is_current = snap
    .entry
    .as_deref()
    .is_some_and(|e| same_address(e, &func_entry));
  let (target_uri, target_range, target_sel_range) = if is_current {
    let sel = snap.decl_info.as_ref().map(|(_, r)| *r).unwrap_or_else(|| {
      if snap.span_range.start != snap.span_range.end {
        snap.span_range
      } else {
        Range::new(
          Position::new(0, 0),
          Position::new(0, func_name.encode_utf16().count() as u32),
        )
      }
    });
    (canon, snap.doc_range, sel)
  } else {
    match open_function(engine, backend, &snap.md5, &func_entry).await {
      Ok((callee_uri, doc)) => {
        let body_start = doc.body_start();
        let decl = doc
          .spans
          .iter()
          .find(|s| s.token.kind == "function" && s.start < body_start);
        let sel = decl.map(|s| doc.range(s)).unwrap_or_else(|| {
          Range::new(
            Position::new(0, 0),
            Position::new(0, func_name.encode_utf16().count() as u32),
          )
        });
        let range = Range::new(Position::new(0, 0), position(&doc.base, doc.base.len()));
        (callee_uri, range, sel)
      }
      Err(_) => (canon, snap.span_range, snap.span_range),
    }
  };

  let item = CallHierarchyItem {
    name: func_name.clone(),
    kind: SymbolKind::FUNCTION,
    tags: None,
    detail: Some(func_entry.clone()),
    uri: target_uri,
    range: target_range,
    selection_range: target_sel_range,
    data: Some(json!({"md5": snap.md5, "entry": func_entry, "name": func_name})),
  };

  Ok(Some(vec![item]))
}

/// Resolves incoming call hierarchy edges without holding `engine` across MCP I/O.
pub(crate) async fn incoming_calls(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  item: &CallHierarchyItem,
) -> Result<Option<Vec<CallHierarchyIncomingCall>>> {
  let data = item.data.as_ref().context("Missing call hierarchy data")?;
  let md5 = data
    .get("md5")
    .and_then(Value::as_str)
    .context("Missing md5")?;
  let entry = data
    .get("entry")
    .and_then(Value::as_str)
    .context("Missing entry")?;

  let mut refs = list_all(
    backend,
    "reference",
    md5,
    json!({"filter": {"direction": "to", "to": entry}, "page": {"limit": 1000}}),
  )
  .await
  .unwrap_or_default();

  if refs.is_empty()
    && let Some((_, raw)) = entry.split_once(':')
    && let Ok(extra) = list_all(
      backend,
      "reference",
      md5,
      json!({"filter": {"direction": "to", "to": raw}, "page": {"limit": 1000}}),
    )
    .await
  {
    refs = extra;
  }

  let functions = list_all(
    backend,
    "function",
    md5,
    json!({
      "page": {"limit": 1000},
      "scan": {"timeout_ms": 60000},
      "projection": {"fields": ["entry", "name", "namespace", "body"]},
    }),
  )
  .await?;

  let mut raw_callers: HashMap<String, (Value, Vec<String>)> = HashMap::new();
  for reference in refs {
    let Some(from) = reference.get("from").and_then(Value::as_str) else {
      continue;
    };
    let caller_func = functions.iter().find(|f| {
      let start = f.pointer("/body/start").and_then(Value::as_str);
      let end = f.pointer("/body/end").and_then(Value::as_str);
      match (start, end) {
        (Some(s), Some(e)) => in_address_range(from, s, e),
        _ => false,
      }
    });
    if let Some(func) = caller_func
      && let Some(caller_entry) = func.get("entry").and_then(Value::as_str)
    {
      raw_callers
        .entry(caller_entry.to_owned())
        .or_insert_with(|| (func.clone(), Vec::new()))
        .1
        .push(from.to_owned());
    }
  }

  let callers: Vec<(String, Value, Vec<Range>)> = {
    let e = engine.lock().await;
    raw_callers
      .into_iter()
      .map(|(caller_entry, (func, froms))| {
        let caller_uri = virtual_uri(md5, "function", &caller_entry)?;
        let ranges = froms
          .into_iter()
          .map(|from| {
            e.docs
              .get(&caller_uri)
              .and_then(|caller_doc| {
                caller_doc
                  .spans
                  .iter()
                  .find(|s| {
                    s.token
                      .address
                      .as_deref()
                      .is_some_and(|a| same_address(a, &from))
                  })
                  .map(|s| caller_doc.range(s))
              })
              .unwrap_or_default()
          })
          .collect();
        Ok((caller_entry, func, ranges))
      })
      .collect::<Result<Vec<_>>>()?
  };

  let mut result = Vec::new();
  for (caller_entry, func, ranges) in callers {
    let opened = open_function(engine, backend, md5, &caller_entry).await;
    let (caller_uri, maybe_doc) = match opened {
      Ok((u, doc)) => (u, Some(doc)),
      Err(_) => {
        let u = virtual_uri(md5, "function", &caller_entry)?;
        let existing = engine.lock().await.docs.get(&u).cloned();
        (u, existing)
      }
    };
    let (caller_range, caller_sel_range, caller_name, actual_ranges) =
      if let Some(caller_doc) = maybe_doc {
        let body_start = caller_doc.body_start();
        let decl = caller_doc
          .spans
          .iter()
          .find(|s| s.token.kind == "function" && s.start < body_start);
        let name = func
          .get("name")
          .and_then(Value::as_str)
          .map(str::to_owned)
          .or_else(|| decl.map(|s| s.token.text.clone()))
          .unwrap_or_else(|| caller_entry.clone());
        let sel = decl.map(|s| caller_doc.range(s)).unwrap_or_else(|| {
          Range::new(
            Position::new(0, 0),
            Position::new(0, name.encode_utf16().count() as u32),
          )
        });
        let range = Range::new(
          Position::new(0, 0),
          position(&caller_doc.base, caller_doc.base.len()),
        );
        let clean_ranges: Vec<Range> = ranges.into_iter().filter(|r| r.start != r.end).collect();
        let final_ranges = if !clean_ranges.is_empty() {
          clean_ranges
        } else {
          let item_name = data.get("name").and_then(Value::as_str);
          let found_ranges: Vec<Range> = caller_doc
            .spans
            .iter()
            .filter(|s| {
              s.start >= body_start
                && s.token.kind == "function"
                && (s
                  .symbol
                  .as_ref()
                  .is_some_and(|sym| same_address(&sym.address, entry))
                  || item_name.is_some_and(|n| s.token.text == n))
            })
            .map(|s| caller_doc.range(s))
            .collect();
          if !found_ranges.is_empty() {
            found_ranges
          } else {
            vec![sel]
          }
        };
        (range, sel, name, final_ranges)
      } else {
        let name = func
          .get("name")
          .and_then(Value::as_str)
          .unwrap_or(&caller_entry)
          .to_owned();
        (Range::default(), Range::default(), name, ranges)
      };
    let caller_item = CallHierarchyItem {
      name: caller_name,
      kind: SymbolKind::FUNCTION,
      tags: None,
      detail: Some(caller_entry.clone()),
      uri: caller_uri,
      range: caller_range,
      selection_range: caller_sel_range,
      data: Some(json!({"md5": md5, "entry": caller_entry})),
    };
    result.push(CallHierarchyIncomingCall {
      from: caller_item,
      from_ranges: actual_ranges,
    });
  }

  Ok(Some(result))
}

/// Resolves outgoing call hierarchy edges without holding `engine` across MCP I/O.
pub(crate) async fn outgoing_calls(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  item: &CallHierarchyItem,
) -> Result<Option<Vec<CallHierarchyOutgoingCall>>> {
  let data = item.data.as_ref().context("Missing call hierarchy data")?;
  let md5 = data
    .get("md5")
    .and_then(Value::as_str)
    .context("Missing md5")?;
  let entry = data
    .get("entry")
    .and_then(Value::as_str)
    .context("Missing entry")?;

  let (_, doc) = open_function(engine, backend, md5, entry).await?;
  let body_start = doc.body_start();
  let mut callees: HashMap<String, (String, Vec<Range>)> = HashMap::new();
  for span in &doc.spans {
    if span.start < body_start {
      continue;
    }
    let callee_info = if let Some(sym) = &span.symbol
      && sym.kind.eq_ignore_ascii_case("function")
      && sym.address != entry
    {
      Some((sym.address.clone(), sym.display_name()))
    } else if span.token.kind == "function" {
      let addr = span
        .token
        .address
        .clone()
        .or_else(|| span.token.text.strip_prefix("FUN_").map(str::to_owned));
      if let Some(a) = addr
        && a != entry
      {
        Some((a, span.token.text.clone()))
      } else {
        None
      }
    } else {
      None
    };

    if let Some((callee_entry, name)) = callee_info {
      let entry_slot = callees
        .entry(callee_entry)
        .or_insert_with(|| (name, Vec::new()));
      entry_slot.1.push(doc.range(span));
    }
  }

  let mut result = Vec::new();
  for (callee_entry, (name, ranges)) in callees {
    let opened = open_function(engine, backend, md5, &callee_entry).await;
    let (callee_uri, maybe_doc) = match opened {
      Ok((u, doc)) => (u, Some(doc)),
      Err(_) => {
        let u = virtual_uri(md5, "function", &callee_entry)?;
        let existing = engine.lock().await.docs.get(&u).cloned();
        (u, existing)
      }
    };
    let (callee_range, callee_sel_range) = if let Some(callee_doc) = maybe_doc {
      let body_start = callee_doc.body_start();
      let decl = callee_doc
        .spans
        .iter()
        .find(|s| s.token.kind == "function" && s.start < body_start);
      let sel = decl.map(|s| callee_doc.range(s)).unwrap_or_else(|| {
        Range::new(
          Position::new(0, 0),
          Position::new(0, name.encode_utf16().count() as u32),
        )
      });
      let range = Range::new(
        Position::new(0, 0),
        position(&callee_doc.base, callee_doc.base.len()),
      );
      (range, sel)
    } else {
      (Range::default(), Range::default())
    };
    let callee_item = CallHierarchyItem {
      name,
      kind: SymbolKind::FUNCTION,
      tags: None,
      detail: Some(callee_entry.clone()),
      uri: callee_uri,
      range: callee_range,
      selection_range: callee_sel_range,
      data: Some(json!({"md5": md5, "entry": callee_entry})),
    };
    result.push(CallHierarchyOutgoingCall {
      to: callee_item,
      from_ranges: ranges,
    });
  }

  Ok(Some(result))
}
