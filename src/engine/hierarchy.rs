// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Call hierarchy item preparation and incoming/outgoing call edge queries.

use std::collections::HashMap;
use std::sync::atomic::Ordering;

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Position, Range,
  SymbolKind, Uri,
};

use super::{Engine, EngineState};
use crate::backend::list_operation;
use crate::document::{
  Document, SHOW_TEMPLATE_ARGUMENTS, Span, canonical_virtual_uri, in_address_range, position,
  same_address, virtual_uri,
};
use crate::graph::canonical_call_id;
use crate::views::symbol_display_name;

/// Aggregated caller or callee group built from `function` `call.list` items.
struct PeerCallGroup {
  /// Canonical entry address of the peer function.
  entry: String,
  /// Formatted display name of the peer function.
  name: String,
  /// Raw symbol name reported by the backend for token matching.
  raw_name: String,
  /// Ordered distinct call-site addresses connecting the two functions.
  call_sites: Vec<String>,
}

/// Groups paginated `function` `call.list` items by peer entry while preserving sibling call sites.
fn group_peer_calls(records: Vec<Value>) -> Vec<PeerCallGroup> {
  let show_templates = SHOW_TEMPLATE_ARGUMENTS.load(Ordering::Relaxed);
  let mut groups: Vec<PeerCallGroup> = Vec::new();
  let mut index_by_key: HashMap<String, usize> = HashMap::new();

  for record in records {
    let Some(peer_entry) = record
      .get("entry")
      .and_then(Value::as_str)
      .filter(|text| !text.is_empty())
    else {
      continue;
    };
    let key = canonical_call_id(peer_entry);
    let idx = if let Some(&existing) = index_by_key.get(&key) {
      existing
    } else {
      let raw_name = record
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
      let namespace = record
        .get("namespace")
        .and_then(Value::as_str)
        .unwrap_or("");
      let demangled = record.get("demangled_name").and_then(Value::as_str);
      let formatted = symbol_display_name(&raw_name, namespace, demangled, true, show_templates);
      let name = if formatted.is_empty() {
        peer_entry.to_owned()
      } else {
        formatted
      };
      let next_idx = groups.len();
      groups.push(PeerCallGroup {
        entry: peer_entry.to_owned(),
        name,
        raw_name,
        call_sites: Vec::new(),
      });
      index_by_key.insert(key, next_idx);
      next_idx
    };

    if let Some(site) = record
      .get("call_site")
      .and_then(Value::as_str)
      .filter(|text| !text.is_empty())
    {
      let sites = &mut groups[idx].call_sites;
      if !sites.iter().any(|existing| existing == site) {
        sites.push(site.to_owned());
      }
    }
  }
  groups
}

/// Formats `CallHierarchyItem::detail` with the peer entry and any static call-site addresses.
fn format_peer_detail(entry: &str, call_sites: &[String]) -> String {
  if call_sites.is_empty() {
    entry.to_owned()
  } else {
    format!("{entry} · {}", call_sites.join(", "))
  }
}

/// Computes the full document range and declaration selection range of an already-open document.
fn open_document_ranges(doc: &Document, fallback_name: &str) -> (Range, Range) {
  let body_start = doc.body_start();
  let decl = doc
    .spans
    .iter()
    .find(|span| span.token.kind == "function" && span.start < body_start);
  let selection = decl.map(|span| doc.range(span)).unwrap_or_else(|| {
    let first_line_end = doc
      .base
      .lines()
      .next()
      .map_or(0, |line| line.encode_utf16().count() as u32);
    let name_width = (fallback_name.encode_utf16().count() as u32).min(first_line_end);
    Range::new(Position::new(0, 0), Position::new(0, name_width))
  });
  let full = Range::new(Position::new(0, 0), position(&doc.base, doc.base.len()));
  (full, selection)
}

/// Returns true when `span` covers or binds to the instruction at `site`.
fn span_matches_call_site(span: &Span, site: &str) -> bool {
  if span.token.kind == "comment" {
    return false;
  }
  if span
    .token
    .address
    .as_deref()
    .is_some_and(|addr| same_address(addr, site))
  {
    return true;
  }
  span.location.as_ref().is_some_and(|loc| {
    same_address(&loc.address, site)
      || loc
        .code_unit_address
        .as_deref()
        .is_some_and(|addr| same_address(addr, site))
      || span
        .token
        .address
        .as_deref()
        .zip(loc.token_max_address.as_deref())
        .is_some_and(|(start, end)| in_address_range(site, start, end))
  })
}

/// Resolves source `from_ranges` in an already-open caller document from call sites or callee tokens.
fn resolve_open_call_ranges(
  caller_doc: &Document,
  call_sites: &[String],
  callee_entry: &str,
  callee_names: &[&str],
  fallback: Range,
) -> Vec<Range> {
  let body_start = caller_doc.body_start();
  let mut ranges: Vec<Range> = Vec::new();

  for site in call_sites {
    let direct_func = caller_doc.spans.iter().find(|span| {
      span.start >= body_start
        && span.token.kind == "function"
        && span_matches_call_site(span, site)
    });
    let matched = direct_func
      .or_else(|| {
        let site_span = caller_doc
          .spans
          .iter()
          .find(|span| span.start >= body_start && span_matches_call_site(span, site))?;
        let line_start = caller_doc.base[..site_span.start]
          .rfind('\n')
          .map_or(body_start, |idx| (idx + 1).max(body_start));
        let line_end = caller_doc.base[site_span.end..]
          .find('\n')
          .map_or(caller_doc.base.len(), |idx| site_span.end + idx);
        caller_doc
          .spans
          .iter()
          .find(|span| {
            span.start >= line_start
              && span.end <= line_end
              && span.token.kind == "function"
              && (span
                .symbol
                .as_ref()
                .is_some_and(|sym| same_address(&sym.address, callee_entry))
                || callee_names
                  .iter()
                  .any(|name| !name.is_empty() && span.token.text == *name))
          })
          .or(Some(site_span))
      })
      .or_else(|| caller_doc.span_for_address(site));
    if let Some(span) = matched {
      let range = caller_doc.range(span);
      if range.start != range.end && !ranges.contains(&range) {
        ranges.push(range);
      }
    }
  }

  if !ranges.is_empty() {
    return ranges;
  }

  for span in &caller_doc.spans {
    if span.start < body_start || span.token.kind != "function" {
      continue;
    }
    let matches_callee = span
      .symbol
      .as_ref()
      .is_some_and(|sym| same_address(&sym.address, callee_entry))
      || callee_names
        .iter()
        .any(|name| !name.is_empty() && span.token.text == *name);
    if matches_callee {
      let range = caller_doc.range(span);
      if range.start != range.end && !ranges.contains(&range) {
        ranges.push(range);
      }
    }
  }

  if ranges.is_empty() {
    vec![fallback]
  } else {
    ranges
  }
}

/// Finds an open virtual function document in `state` without decompilation.
fn find_open_function_doc<'a>(
  state: &'a EngineState,
  md5: &str,
  target_entry: &str,
) -> Option<&'a Document> {
  if let Ok(uri) = virtual_uri(md5, "function", target_entry)
    && let Some(doc) = state.docs.get(&uri)
  {
    return Some(doc);
  }
  state.docs.values().find(|doc| {
    doc.md5.eq_ignore_ascii_case(md5)
      && doc
        .entry
        .as_deref()
        .is_some_and(|doc_entry| doc_entry == target_entry || same_address(doc_entry, target_entry))
  })
}

impl Engine {
  /// Builds the root [`CallHierarchyItem`] for the function or call expression at `pos`.
  pub(crate) async fn prepare_call_hierarchy(
    &self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Vec<CallHierarchyItem>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let (md5, entry, span, span_range, body_start, header_name) = {
      let state = self.read_state();
      let doc = state.docs.get(uri).context("Unknown virtual document")?;
      if !doc.clean() {
        return Ok(None);
      }
      let Some(cursor) = crate::document::offset(&doc.base, pos) else {
        return Ok(None);
      };
      let span = doc
        .spans
        .iter()
        .find(|s| s.start <= cursor && cursor < s.end)
        .cloned();
      let span_range = span.as_ref().map(|s| doc.range(s)).unwrap_or_default();
      let body_start = doc.body_start();
      let header_name = doc
        .spans
        .iter()
        .find(|s| s.token.kind == "function" && s.start < body_start)
        .map(|s| s.token.text.clone());
      (
        doc.md5.clone(),
        doc.entry.clone(),
        span,
        span_range,
        body_start,
        header_name,
      )
    };

    let target_symbol = if let Some(s) = &span {
      if let Some(sym) = &s.symbol {
        if sym.kind.eq_ignore_ascii_case("function") {
          Some(sym.clone())
        } else {
          None
        }
      } else if s.token.kind == "function" {
        let symbols = self.symbols(&md5).await?;
        symbols
          .find_function_by_name_or_exact_address(&s.token.text, s.token.address.as_deref())
          .cloned()
      } else {
        None
      }
    } else {
      None
    };

    let (func_name, func_entry) = if let Some(sym) = target_symbol {
      (sym.display_name(), sym.address)
    } else if let Some(s) = &span
      && s.token.kind == "function"
    {
      let addr = if s.start < body_start {
        entry
          .clone()
          .unwrap_or_else(|| s.token.address.clone().unwrap_or_default())
      } else {
        s.token
          .address
          .clone()
          .unwrap_or_else(|| entry.clone().unwrap_or_default())
      };
      (s.token.text.clone(), addr)
    } else if let Some(ref entry_addr) = entry {
      let name = header_name.unwrap_or_else(|| format!("sub_{entry_addr}"));
      (name, entry_addr.clone())
    } else {
      return Ok(None);
    };

    let is_current = entry
      .as_deref()
      .is_some_and(|e| same_address(e, &func_entry));
    let (target_uri, target_range, target_sel_range) = if is_current {
      let state = self.read_state();
      let doc = state.docs.get(uri).context("Unknown virtual document")?;
      let body_start = doc.body_start();
      let decl = doc
        .spans
        .iter()
        .find(|s| s.token.kind == "function" && s.start < body_start);
      let sel = decl.map(|s| doc.range(s)).unwrap_or_else(|| {
        if span_range.start != span_range.end {
          span_range
        } else {
          Range::new(
            Position::new(0, 0),
            Position::new(0, func_name.encode_utf16().count() as u32),
          )
        }
      });
      let range = Range::new(Position::new(0, 0), position(&doc.base, doc.base.len()));
      (uri.clone(), range, sel)
    } else {
      match self.open(&md5, &func_entry).await {
        Ok(callee_uri) => {
          let state = self.read_state();
          let doc = state
            .docs
            .get(&callee_uri)
            .context("Unknown callee document")?;
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
        Err(_) => (uri.clone(), span_range, span_range),
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
      data: Some(json!({"md5": md5, "entry": func_entry, "name": func_name})),
    };

    Ok(Some(vec![item]))
  }

  /// Resolves incoming call hierarchy edges for `item` from `function` `call.list`.
  pub(crate) async fn incoming_calls(
    &self,
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
    let target_name = data
      .get("name")
      .and_then(Value::as_str)
      .unwrap_or(&item.name);

    let backend = self.backend();
    let records = list_operation(
      backend.as_ref(),
      "function",
      "call.list",
      md5,
      json!({
        "filter": {
          "entry": entry,
          "direction": "callers",
        },
        "page": { "limit": 1000 },
      }),
    )
    .await?;

    let state = self.read_state();
    let mut result = Vec::new();
    for caller in group_peer_calls(records) {
      let (caller_uri, caller_range, caller_sel_range, from_ranges) =
        if let Some(caller_doc) = find_open_function_doc(&state, md5, &caller.entry) {
          let doc_entry = caller_doc.entry.as_deref().unwrap_or(&caller.entry);
          let uri = virtual_uri(md5, "function", doc_entry)?;
          let (range, sel) = open_document_ranges(caller_doc, &caller.name);
          let ranges = resolve_open_call_ranges(
            caller_doc,
            &caller.call_sites,
            entry,
            &[target_name, &item.name],
            sel,
          );
          (uri, range, sel, ranges)
        } else {
          let uri = virtual_uri(md5, "function", &caller.entry)?;
          let ranges = vec![Range::default(); caller.call_sites.len().max(1)];
          (uri, Range::default(), Range::default(), ranges)
        };

      let detail = format_peer_detail(&caller.entry, &caller.call_sites);
      let item_data = json!({
        "md5": md5,
        "entry": caller.entry,
        "name": caller.name,
        "callSites": caller.call_sites,
      });
      let caller_item = CallHierarchyItem {
        name: caller.name,
        kind: SymbolKind::FUNCTION,
        tags: None,
        detail: Some(detail),
        uri: caller_uri,
        range: caller_range,
        selection_range: caller_sel_range,
        data: Some(item_data),
      };
      result.push(CallHierarchyIncomingCall {
        from: caller_item,
        from_ranges,
      });
    }

    Ok(Some(result))
  }

  /// Resolves outgoing call hierarchy edges for `item` from `function` `call.list`.
  pub(crate) async fn outgoing_calls(
    &self,
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
    let source_name = data
      .get("name")
      .and_then(Value::as_str)
      .unwrap_or(&item.name);

    let backend = self.backend();
    let records = list_operation(
      backend.as_ref(),
      "function",
      "call.list",
      md5,
      json!({
        "filter": {
          "entry": entry,
          "direction": "callees",
        },
        "page": { "limit": 1000 },
      }),
    )
    .await?;

    let state = self.read_state();
    let source_doc = find_open_function_doc(&state, md5, entry);
    let source_sel_range = source_doc
      .map(|doc| open_document_ranges(doc, source_name).1)
      .unwrap_or_default();

    let mut result = Vec::new();
    for callee in group_peer_calls(records) {
      let from_ranges = if let Some(doc) = source_doc {
        resolve_open_call_ranges(
          doc,
          &callee.call_sites,
          &callee.entry,
          &[&callee.raw_name, &callee.name],
          source_sel_range,
        )
      } else {
        vec![Range::default(); callee.call_sites.len().max(1)]
      };

      let (callee_uri, callee_range, callee_sel_range) =
        if let Some(callee_doc) = find_open_function_doc(&state, md5, &callee.entry) {
          let doc_entry = callee_doc.entry.as_deref().unwrap_or(&callee.entry);
          let uri = virtual_uri(md5, "function", doc_entry)?;
          let (range, sel) = open_document_ranges(callee_doc, &callee.name);
          (uri, range, sel)
        } else {
          let uri = virtual_uri(md5, "function", &callee.entry)?;
          (uri, Range::default(), Range::default())
        };

      let detail = format_peer_detail(&callee.entry, &callee.call_sites);
      let item_data = json!({
        "md5": md5,
        "entry": callee.entry,
        "name": callee.name,
        "callSites": callee.call_sites,
      });
      let callee_item = CallHierarchyItem {
        name: callee.name,
        kind: SymbolKind::FUNCTION,
        tags: None,
        detail: Some(detail),
        uri: callee_uri,
        range: callee_range,
        selection_range: callee_sel_range,
        data: Some(item_data),
      };
      result.push(CallHierarchyOutgoingCall {
        to: callee_item,
        from_ranges,
      });
    }

    Ok(Some(result))
  }
}
