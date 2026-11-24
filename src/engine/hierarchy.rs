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

use super::Engine;
use crate::address::paginate_operation;
use crate::document::{
  Document, SHOW_TEMPLATE_ARGUMENTS, canonical_virtual_uri, position, same_address, virtual_uri,
};
use crate::views::symbol_display_name;

/// Maximum page size requested from `function` `call.list`.
const CALL_LIST_LIMIT: usize = 1000;

/// Grouped call records for one caller or callee peer function.
struct GroupedPeerCalls {
  /// Backend entry address string of the peer function.
  entry: String,
  /// Formatted display name of the peer function.
  name: String,
  /// Distinct call-site addresses reported on this directed call edge.
  sites: Vec<String>,
}

/// Formats a function label from a `function_call.list` record.
fn format_peer_name(record: &Value, fallback_entry: &str) -> String {
  let name = record.get("name").and_then(Value::as_str).unwrap_or("");
  let namespace = record
    .get("namespace")
    .and_then(Value::as_str)
    .unwrap_or("");
  let demangled = record.get("demangled_name").and_then(Value::as_str);
  let show_templates = SHOW_TEMPLATE_ARGUMENTS.load(Ordering::Relaxed);
  let formatted = symbol_display_name(name, namespace, demangled, true, show_templates);
  if formatted.is_empty() {
    fallback_entry.to_owned()
  } else {
    formatted
  }
}

/// Groups raw `function_call.list` records by peer entry in encounter sequence.
fn group_peer_calls(records: &[Value]) -> Vec<GroupedPeerCalls> {
  let mut order: Vec<String> = Vec::new();
  let mut index_by_key: HashMap<String, usize> = HashMap::new();
  let mut groups: Vec<GroupedPeerCalls> = Vec::new();

  for record in records {
    let Some(peer_entry) = record
      .get("entry")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|s| !s.is_empty())
    else {
      continue;
    };
    let key = peer_entry.to_ascii_lowercase();
    let idx = if let Some(&existing) = index_by_key.get(&key) {
      existing
    } else {
      let next_idx = groups.len();
      order.push(key.clone());
      index_by_key.insert(key, next_idx);
      groups.push(GroupedPeerCalls {
        entry: peer_entry.to_owned(),
        name: format_peer_name(record, peer_entry),
        sites: Vec::new(),
      });
      next_idx
    };
    if let Some(site) = record
      .get("call_site")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|s| !s.is_empty())
      && !groups[idx]
        .sites
        .iter()
        .any(|prev| same_address(prev, site))
    {
      groups[idx].sites.push(site.to_owned());
    }
  }
  let _ = order;
  groups
}

/// Resolves call-site ranges inside an already open caller [`Document`].
fn resolve_open_site_ranges(
  caller_doc: &Document,
  sites: &[String],
  callee_entry: &str,
  callee_name: Option<&str>,
  fallback_range: Range,
) -> Vec<Range> {
  let body_start = caller_doc.body_start();
  let mut ranges: Vec<Range> = Vec::new();

  for site in sites {
    let matched = caller_doc
      .spans
      .iter()
      .find(|s| {
        s.start >= body_start
          && s.token.kind == "function"
          && s
            .token
            .address
            .as_deref()
            .is_some_and(|addr| same_address(addr, site))
      })
      .or_else(|| {
        caller_doc.spans.iter().find(|s| {
          s.start >= body_start
            && s
              .token
              .address
              .as_deref()
              .is_some_and(|addr| same_address(addr, site))
        })
      })
      .map(|s| caller_doc.range(s));
    if let Some(range) = matched
      && !ranges.contains(&range)
    {
      ranges.push(range);
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
      || span
        .token
        .address
        .as_deref()
        .is_some_and(|addr| same_address(addr, callee_entry))
      || callee_name.is_some_and(|target_name| span.token.text == target_name);
    if matches_callee {
      let range = caller_doc.range(span);
      if !ranges.contains(&range) {
        ranges.push(range);
      }
    }
  }

  if ranges.is_empty() {
    vec![fallback_range]
  } else {
    ranges
  }
}

/// Computes document and declaration ranges from an already open virtual buffer.
fn open_doc_bounds(doc: &Document, fallback_name: &str) -> (Range, Range) {
  let body_start = doc.body_start();
  let decl = doc
    .spans
    .iter()
    .find(|s| s.token.kind == "function" && s.start < body_start);
  let sel = decl.map(|s| doc.range(s)).unwrap_or_else(|| {
    Range::new(
      Position::new(0, 0),
      Position::new(0, fallback_name.encode_utf16().count() as u32),
    )
  });
  let full = Range::new(Position::new(0, 0), position(&doc.base, doc.base.len()));
  (full, sel)
}

impl Engine {
  /// Builds the root [`CallHierarchyItem`] for the function or call expression at `pos`.
  pub(crate) async fn prepare_call_hierarchy(
    &mut self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Vec<CallHierarchyItem>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let (md5, entry, span, span_range) = {
      let doc = self.docs.get(uri).context("Unknown virtual document")?;
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
      (doc.md5.clone(), doc.entry.clone(), span, span_range)
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

    let body_start = {
      let doc = self.docs.get(uri).context("Unknown virtual document")?;
      doc.body_start()
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
      let doc = self.docs.get(uri).context("Unknown virtual document")?;
      let name = doc
        .spans
        .iter()
        .find(|s| s.token.kind == "function" && s.start < body_start)
        .map(|s| s.token.text.clone())
        .unwrap_or_else(|| format!("sub_{entry_addr}"));
      (name, entry_addr.clone())
    } else {
      return Ok(None);
    };

    let is_current = entry
      .as_deref()
      .is_some_and(|e| same_address(e, &func_entry));
    let (target_uri, target_range, target_sel_range) = if is_current {
      let doc = self.docs.get(uri).context("Unknown virtual document")?;
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
          let doc = self
            .docs
            .get(&callee_uri)
            .context("Unknown callee document")?;
          let (range, sel) = open_doc_bounds(doc, &func_name);
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

  /// Paginates `function` `call.list` for `entry` and `direction` without scanning all functions.
  async fn query_function_calls(
    &self,
    md5: &str,
    entry: &str,
    direction: &str,
  ) -> Result<Vec<Value>> {
    paginate_operation(
      &self.backend,
      "function",
      "call.list",
      md5,
      json!({
        "filter": { "entry": entry, "direction": direction },
        "page": { "limit": CALL_LIST_LIMIT },
      }),
    )
    .await
  }

  /// Builds a [`CallHierarchyItem`] for `peer_entry` without decompiling unopened peers.
  fn build_peer_item(
    &self,
    md5: &str,
    peer_entry: &str,
    peer_name: String,
  ) -> Result<CallHierarchyItem> {
    let peer_uri = virtual_uri(md5, "function", peer_entry)?;
    let (range, selection_range) = match self.docs.get(&peer_uri) {
      Some(peer_doc) => open_doc_bounds(peer_doc, &peer_name),
      None => (Range::default(), Range::default()),
    };
    Ok(CallHierarchyItem {
      name: peer_name.clone(),
      kind: SymbolKind::FUNCTION,
      tags: None,
      detail: Some(peer_entry.to_owned()),
      uri: peer_uri,
      range,
      selection_range,
      data: Some(json!({ "md5": md5, "entry": peer_entry, "name": peer_name })),
    })
  }

  /// Resolves incoming call hierarchy edges from `function` `call.list` without decompiling peers.
  pub(crate) async fn incoming_calls(
    &mut self,
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
    let callee_name = data.get("name").and_then(Value::as_str);

    let records = self.query_function_calls(md5, entry, "callers").await?;
    let groups = group_peer_calls(&records);
    let mut result = Vec::with_capacity(groups.len());

    for group in groups {
      let caller_item = self.build_peer_item(md5, &group.entry, group.name)?;
      let from_ranges = match self.docs.get(&caller_item.uri) {
        Some(caller_doc) => resolve_open_site_ranges(
          caller_doc,
          &group.sites,
          entry,
          callee_name,
          caller_item.selection_range,
        ),
        None => vec![Range::default(); group.sites.len().max(1)],
      };
      result.push(CallHierarchyIncomingCall {
        from: caller_item,
        from_ranges,
      });
    }

    Ok(Some(result))
  }

  /// Resolves outgoing call hierarchy edges from `function` `call.list` without decompiling peers.
  pub(crate) async fn outgoing_calls(
    &mut self,
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

    let records = self.query_function_calls(md5, entry, "callees").await?;
    let groups = group_peer_calls(&records);
    let caller_uri = virtual_uri(md5, "function", entry)?;
    let mut result = Vec::with_capacity(groups.len());

    for group in groups {
      let callee_name = group.name.clone();
      let callee_item = self.build_peer_item(md5, &group.entry, group.name)?;
      let from_ranges = match self.docs.get(&caller_uri) {
        Some(caller_doc) => resolve_open_site_ranges(
          caller_doc,
          &group.sites,
          &group.entry,
          Some(&callee_name),
          Range::default(),
        ),
        None => vec![Range::default(); group.sites.len().max(1)],
      };
      result.push(CallHierarchyOutgoingCall {
        to: callee_item,
        from_ranges,
      });
    }

    Ok(Some(result))
  }
}
