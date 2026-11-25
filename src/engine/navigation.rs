// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Target symbol resolution, go-to-definition, and cross-reference lookups.

use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{Location, Position, Range, Uri};

use super::{Engine, find_function_symbol};
use crate::address::parse_address;
use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Symbol, canonical_virtual_uri, extract_label_address, is_label_token, offset,
  same_address, virtual_uri, word_at,
};

/// Resolves containing function entries for reference `from` addresses when `reference.list`
/// omits `from_function` and `to_function` relation fields.
async fn resolve_missing_from_functions(
  backend: &McpBackend,
  md5: &str,
  refs: &[Value],
) -> Result<HashMap<String, String>> {
  let mut entries = HashMap::new();
  if refs.is_empty()
    || refs
      .iter()
      .any(|r| r.get("from_function").is_some() || r.get("to_function").is_some())
  {
    return Ok(entries);
  }

  let mut unique_from: Vec<(String, String)> = Vec::new();
  let mut seen_canon = HashSet::new();
  for reference in refs {
    let Some(from) = reference.get("from").and_then(Value::as_str) else {
      continue;
    };
    if let Some(parsed) = parse_address(from, "ram")
      && seen_canon.insert(parsed.canonical.clone())
    {
      unique_from.push((parsed.canonical, from.to_owned()));
    }
  }
  if unique_from.is_empty() {
    return Ok(entries);
  }

  if unique_from.len() == 1 {
    let (canon, raw) = &unique_from[0];
    if let Ok(resolved) = backend
      .call(
        "address",
        "resolve",
        Some(md5),
        json!({ "selector": { "address": raw } }),
      )
      .await
      && let Some(entry) = resolved
        .pointer("/function/entry")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
      entries.insert(canon.clone(), entry.to_owned());
    }
    return Ok(entries);
  }

  for chunk in unique_from.chunks(1000) {
    let batch_items: Vec<Value> = chunk
      .iter()
      .enumerate()
      .map(|(idx, (_, raw))| {
        json!({
          "id": format!("resolve:{idx}"),
          "method": "address.resolve",
          "arguments": { "selector": { "address": raw } },
        })
      })
      .collect();
    let mut unresolved_indices: Vec<usize> = Vec::new();
    match backend
      .call(
        "batch",
        "execute",
        Some(md5),
        json!({ "transaction_mode": "per_item", "items": batch_items }),
      )
      .await
    {
      Ok(batch) => {
        let mut seen_ids = HashSet::new();
        if let Some(items) = batch.get("items").and_then(Value::as_array) {
          for item in items {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
              continue;
            };
            let Some(idx) = id
              .strip_prefix("resolve:")
              .and_then(|s| s.parse::<usize>().ok())
              .filter(|&i| i < chunk.len())
            else {
              continue;
            };
            seen_ids.insert(idx);
            if item.get("error").is_some_and(|e| !e.is_null()) {
              unresolved_indices.push(idx);
              continue;
            }
            if let Some(entry) = item
              .pointer("/result/function/entry")
              .and_then(Value::as_str)
              .filter(|s| !s.is_empty())
            {
              entries.insert(chunk[idx].0.clone(), entry.to_owned());
            }
          }
        }
        for idx in 0..chunk.len() {
          if !seen_ids.contains(&idx) {
            unresolved_indices.push(idx);
          }
        }
      }
      Err(_) => {
        unresolved_indices.extend(0..chunk.len());
      }
    }

    for idx in unresolved_indices {
      let (canon, raw) = &chunk[idx];
      if let Ok(resolved) = backend
        .call(
          "address",
          "resolve",
          Some(md5),
          json!({ "selector": { "address": raw } }),
        )
        .await
        && let Some(entry) = resolved
          .pointer("/function/entry")
          .and_then(Value::as_str)
          .filter(|s| !s.is_empty())
      {
        entries.insert(canon.clone(), entry.to_owned());
      }
    }
  }

  Ok(entries)
}

impl Engine {
  /// Resolves the unambiguous symbol, owning session MD5, and token range at `pos`.
  pub(crate) fn target(&self, uri: &Uri, pos: Position) -> Result<(String, Symbol, Range)> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let doc = self
      .docs
      .get(uri)
      .context("Open this function through Ghidra LSP first")?;
    let span = doc
      .span_at(pos)
      .context("No unambiguous symbol at this position; refresh if modified")?;
    if let Some(sym) = &span.symbol {
      return Ok((doc.md5.clone(), sym.clone(), doc.range(span)));
    }
    let body_start = doc.body_start();
    if span.token.kind == "function" && span.start < body_start {
      let entry = doc.entry.as_deref().context("Unknown function entry")?;
      if let Some(sym) = self
        .symbols
        .get(&doc.md5)
        .and_then(|syms| find_function_symbol(syms, Some(entry), &span.token.text))
      {
        return Ok((doc.md5.clone(), sym.clone(), doc.range(span)));
      }
      return Ok((
        doc.md5.clone(),
        Symbol {
          demangled_name: None,
          id: format!("Function:{}:{}", doc.md5, entry),
          name: span.token.text.clone(),
          address: entry.to_owned(),
          namespace: String::new(),
          kind: "Function".into(),
        },
        doc.range(span),
      ));
    }
    if span.token.kind == "function"
      && let Some(sym) = self.symbols.get(&doc.md5).and_then(|syms| {
        find_function_symbol(syms, span.token.address.as_deref(), &span.token.text)
      })
    {
      return Ok((doc.md5.clone(), sym.clone(), doc.range(span)));
    }
    if matches!(span.token.kind.as_str(), "variable" | "parameter") {
      let entry = doc.entry.as_deref().context("Unknown function entry")?;
      let kind = if span.token.kind == "parameter" {
        "Parameter"
      } else {
        "Local"
      };
      return Ok((
        doc.md5.clone(),
        Symbol {
          demangled_name: None,
          id: format!("{kind}:{}:{entry}:name={}", doc.md5, span.token.text),
          name: span.token.text.clone(),
          address: entry.to_owned(),
          namespace: String::new(),
          kind: kind.into(),
        },
        doc.range(span),
      ));
    }
    let is_label = span.token.kind == "label"
      || is_label_token(&span.token.text, span.start, span.end, &doc.base);
    if is_label {
      if let Some(sym) = self.symbols.get(&doc.md5).and_then(|syms| {
        syms.find_by_name_or_address(&span.token.text, span.token.address.as_deref())
      }) {
        return Ok((doc.md5.clone(), sym.clone(), doc.range(span)));
      }
      let addr = span
        .token
        .address
        .as_deref()
        .map(str::to_string)
        .or_else(|| extract_label_address(&span.token.text))
        .unwrap_or_else(|| doc.entry.clone().unwrap_or_default());
      return Ok((
        doc.md5.clone(),
        Symbol {
          demangled_name: None,
          id: format!("Label:{}:{addr}", doc.md5),
          name: span.token.text.clone(),
          address: addr,
          namespace: String::new(),
          kind: "Label".into(),
        },
        doc.range(span),
      ));
    }
    if matches!(span.token.kind.as_str(), "constant" | "global")
      && let Some(sym) = self.symbols.get(&doc.md5).and_then(|syms| {
        syms.find_by_name_or_address(&span.token.text, span.token.address.as_deref())
      })
    {
      return Ok((doc.md5.clone(), sym.clone(), doc.range(span)));
    }
    bail!("No unambiguous symbol at this position; refresh if modified")
  }

  /// Resolves the definition location for the symbol, call, local, or type at `pos`.
  pub(crate) async fn goto_definition(
    &mut self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Location>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let (md5, span, entry, fallback_word) = {
      let Some(doc) = self.docs.get(uri) else {
        return Ok(None);
      };
      if !doc.clean() {
        return Ok(None);
      }
      let Some(c) = offset(&doc.base, pos) else {
        return Ok(None);
      };
      let span = doc
        .spans
        .iter()
        .find(|s| s.start <= c && c < s.end)
        .cloned();
      let word = word_at(&doc.base, pos).map(|(w, r)| (w.to_owned(), r));
      (doc.md5.clone(), span, doc.entry.clone(), word)
    };

    // Navigate directly when the cursor is on the enclosing function header.
    let body_start = {
      let doc = self.docs.get(uri).context("Unknown virtual document")?;
      doc.body_start()
    };
    if let Some(s) = &span
      && s.token.kind == "function"
      && s.start < body_start
    {
      let doc = self.docs.get(uri).context("Unknown virtual document")?;
      return Ok(Some(Location::new(uri.clone(), doc.range(s))));
    }

    if let Some(s) = &span
      && let Some(symbol) = &s.symbol
    {
      if let Ok(loc) = self.symbol_location(&md5, symbol).await {
        return Ok(Some(loc));
      }
      return Ok(None);
    }

    if let Some(s) = &span
      && s.token.kind == "function"
    {
      let callee_addr = s
        .symbol
        .as_ref()
        .map(|sym| sym.address.clone())
        .or_else(|| s.token.text.strip_prefix("FUN_").map(str::to_owned));
      let callee_addr = match callee_addr {
        Some(a) => Some(a),
        None => self.symbols(&md5).await.ok().and_then(|symbols| {
          find_function_symbol(&symbols, None, &s.token.text).map(|sym| sym.address.clone())
        }),
      };

      if let Some(addr) = callee_addr {
        if entry.as_deref().is_some_and(|e| same_address(e, &addr)) {
          let doc = &self.docs[uri];
          let decl_span = doc
            .spans
            .iter()
            .find(|sp| sp.token.kind == "function" && sp.start < body_start);
          let range = decl_span.map(|sp| doc.range(sp)).unwrap_or_default();
          return Ok(Some(Location::new(uri.clone(), range)));
        }

        if let Ok(target_uri) = self.open(&md5, &addr).await {
          let doc = &self.docs[&target_uri];
          let target_body = doc.body_start();
          let decl_span = doc
            .spans
            .iter()
            .find(|sp| sp.token.kind == "function" && sp.start < target_body);
          let range = decl_span.map(|sp| doc.range(sp)).unwrap_or_default();
          return Ok(Some(Location::new(target_uri, range)));
        }
      }
    }

    if let Some(s) = &span
      && matches!(s.token.kind.as_str(), "variable" | "parameter")
    {
      let doc = &self.docs[uri];
      if let Some(decl) = doc.spans.iter().find(|sp| sp.token.text == s.token.text) {
        return Ok(Some(Location::new(uri.clone(), doc.range(decl))));
      }
    }

    if let Some(s) = &span {
      if let Some(sym) = &s.symbol {
        if !sym.local() {
          return Ok(Some(self.symbol_location(&md5, sym).await?));
        }
      } else if matches!(s.token.kind.as_str(), "global" | "label")
        && let Ok(symbols) = self.symbols(&md5).await
        && let Some(sym) = symbols.find_by_name(&s.token.text).cloned()
      {
        return Ok(Some(self.symbol_location(&md5, &sym).await?));
      }
    }

    if let Some(s) = &span
      && s.token.kind == "type"
      && let Ok(Some(loc)) = self.goto_type_definition(uri, pos).await
    {
      return Ok(Some(loc));
    }

    if let Some((word, _)) = fallback_word {
      if let Some(hex) = word.strip_prefix("FUN_")
        && let Ok(target_uri) = self.open(&md5, hex).await
      {
        return Ok(Some(Location::new(target_uri, Range::default())));
      }

      let symbols = self.symbols(&md5).await?;
      if let Some(sym) = symbols.find_by_name(&word).cloned() {
        return Ok(Some(self.symbol_location(&md5, &sym).await?));
      }

      if let Ok(Some(loc)) = self.goto_type_definition(uri, pos).await {
        return Ok(Some(loc));
      }
    }

    Ok(None)
  }

  /// Opens or synthesizes the canonical [`Location`] for `symbol` in session `md5`.
  pub(crate) async fn symbol_location(&mut self, md5: &str, symbol: &Symbol) -> Result<Location> {
    if symbol.local() {
      let uri = self.open(md5, &symbol.address).await?;
      let doc = self
        .docs
        .get(&uri)
        .context("Missing opened function document")?;
      let span = doc
        .spans
        .iter()
        .find(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
        .context("Variable declaration is unavailable in the current decompilation")?;
      return Ok(Location::new(uri, doc.range(span)));
    }
    if symbol.kind.eq_ignore_ascii_case("function")
      && let Ok(uri) = self.open(md5, &symbol.address).await
    {
      let doc = self
        .docs
        .get(&uri)
        .context("Missing opened function document")?;
      let range = doc
        .spans
        .iter()
        .find(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
        .map(|s| doc.range(s))
        .unwrap_or_default();
      return Ok(Location::new(uri, range));
    }
    let uri = virtual_uri(md5, "symbol", &symbol.id)?;
    if self.docs.get(&uri).is_none_or(Document::clean) {
      let code = self.snapshot_text(md5, "symbol", &symbol.id).await?;
      let version = self.docs.get(&uri).and_then(|doc| doc.version);
      self.install(Document {
        uri: uri.clone(),
        md5: md5.into(),
        entry: None,
        base: code.clone(),
        current: code.clone(),
        saved: code,
        version,
        spans: vec![],
        warning: None,
      })?;
    }
    Ok(Location::new(uri, Range::default()))
  }

  /// Collects in-document and cross-function references targeting `symbol`.
  pub(crate) async fn references(
    &mut self,
    md5: &str,
    symbol: &Symbol,
    declaration: bool,
  ) -> Result<Vec<Location>> {
    if symbol.local() {
      let uri = self.open(md5, &symbol.address).await?;
      let doc = &self.docs[&uri];
      ensure!(
        doc.clean(),
        "Refresh modified decompilation before finding references"
      );
      return Ok(
        doc
          .spans
          .iter()
          .filter(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
          .skip(usize::from(!declaration))
          .map(|s| Location::new(uri.clone(), doc.range(s)))
          .collect(),
      );
    }
    let current_symbol: Symbol = serde_json::from_value(
      self
        .backend
        .call(
          "symbol",
          "get",
          Some(md5),
          json!({"selector": {"id": symbol.id}}),
        )
        .await?,
    )?;
    let symbol = &current_symbol;
    let refs = list_all(
      self.backend.as_ref(),
      "reference",
      md5,
      json!({"filter": {"direction": "to", "to": symbol.address}, "page": {"limit": 1000}}),
    )
    .await?;
    let fallback_entries =
      resolve_missing_from_functions(self.backend.as_ref(), md5, &refs).await?;
    let mut locations = vec![];
    let mut unmapped = vec![];
    for reference in refs {
      let from = reference
        .get("from")
        .and_then(Value::as_str)
        .context("reference lacks from address")?;
      let entry_opt = reference
        .pointer("/from_function/entry")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or_else(|| {
          parse_address(from, "ram")
            .and_then(|parsed| fallback_entries.get(&parsed.canonical).map(String::as_str))
        });
      let mut found = false;
      if let Some(entry) = entry_opt
        && let Ok(uri) = self.open(md5, entry).await
      {
        let doc = &self.docs[&uri];
        if doc.current == doc.base {
          for span in &doc.spans {
            if span.symbol.as_ref().is_some_and(|s| s.id == symbol.id)
              && span
                .token
                .address
                .as_deref()
                .is_some_and(|a| same_address(a, from))
            {
              locations.push(Location::new(uri.clone(), doc.range(span)));
              found = true;
            }
          }
        }
      }
      if !found {
        unmapped.push(format!(
          "// {from} -> {} ({})",
          symbol.address,
          reference
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("reference")
        ));
      }
    }
    if !unmapped.is_empty() {
      let uri = virtual_uri(md5, "references", &symbol.id)?;
      let code = format!(
        "// References to {} at {}\n{}\n",
        symbol.display_name(),
        symbol.address,
        unmapped.join("\n")
      );
      // Never overwrite a user-modified reference document.
      if self.docs.get(&uri).is_none_or(Document::clean) {
        let version = self.docs.get(&uri).and_then(|doc| doc.version);
        self.install(Document {
          uri: uri.clone(),
          md5: md5.into(),
          entry: None,
          base: code.clone(),
          current: code.clone(),
          saved: code,
          version,
          spans: vec![],
          warning: None,
        })?;
        for (line, text) in unmapped.iter().enumerate() {
          locations.push(Location::new(
            uri.clone(),
            Range::new(
              Position::new(line as u32 + 1, 0),
              Position::new(line as u32 + 1, text.encode_utf16().count() as u32),
            ),
          ));
        }
      }
    }
    if declaration {
      locations.push(self.symbol_location(md5, symbol).await?);
    }
    locations.sort_by(|a, b| {
      (a.uri.as_str(), a.range.start.line, a.range.start.character).cmp(&(
        b.uri.as_str(),
        b.range.start.line,
        b.range.start.character,
      ))
    });
    locations.dedup();
    Ok(locations)
  }
}
