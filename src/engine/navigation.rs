// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Target symbol resolution, go-to-definition, and cross-reference lookups.

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tower_lsp_server::ls_types::{Location, Position, Range, Uri};

use super::{
  Engine, ensure_symbols, fetch_snapshot_text, find_function_symbol, goto_type_definition,
  open_function,
};
use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, Span, Symbol, canonical_virtual_uri, extract_label_address, in_address_range,
  is_label_token, offset, same_address, virtual_uri, word_at,
};

/// Owned cursor state captured from an open document before running navigation queries.
struct DefinitionSnapshot {
  /// Lowercase 32-character MD5 session hash owning the document.
  md5: String,
  /// Canonical entry address when the document is a decompiled function.
  entry: Option<String>,
  /// Byte offset of the function body opening brace.
  body_start: usize,
  /// Enclosing function header declaration range used for self-recursive calls.
  self_decl_range: Range,
  /// Token span covering the cursor position when available.
  span: Option<Span>,
  /// Range of `span` in UTF-16 coordinates when `span` is present.
  span_range: Range,
  /// First matching token range for unresolved local or parameter fallback tokens.
  local_decl_range: Option<Range>,
  /// Identifier word at `pos` used when no semantic span matches.
  fallback_word: Option<(String, Range)>,
}

impl Engine {
  /// Snapshots cursor span and declaration ranges for `goto_definition` without MCP I/O.
  fn prepare_definition(&self, uri: &Uri, pos: Position) -> Option<DefinitionSnapshot> {
    let doc = self.docs.get(uri)?;
    if !doc.clean() {
      return None;
    }
    let cursor = offset(&doc.base, pos)?;
    let body_start = doc.body_start();
    let span = doc
      .spans
      .iter()
      .find(|s| s.start <= cursor && cursor < s.end)
      .cloned();
    let span_range = span.as_ref().map(|s| doc.range(s)).unwrap_or_default();
    let self_decl_range = doc
      .spans
      .iter()
      .find(|sp| sp.token.kind == "function" && sp.start < body_start)
      .map(|sp| doc.range(sp))
      .unwrap_or_default();
    let local_decl_range = span.as_ref().and_then(|s| {
      matches!(s.token.kind.as_str(), "variable" | "parameter").then(|| {
        doc
          .spans
          .iter()
          .find(|sp| sp.token.text == s.token.text)
          .map(|sp| doc.range(sp))
      })?
    });
    let fallback_word = word_at(&doc.base, pos).map(|(w, r)| (w.to_owned(), r));
    Some(DefinitionSnapshot {
      md5: doc.md5.clone(),
      entry: doc.entry.clone(),
      body_start,
      self_decl_range,
      span,
      span_range,
      local_decl_range,
      fallback_word,
    })
  }

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
        syms.iter().find(|s| {
          (s.name == span.token.text || s.qualified() == span.token.text)
            || (span
              .token
              .address
              .as_deref()
              .is_some_and(|a| same_address(a, &s.address)))
        })
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
        syms.iter().find(|s| {
          (s.name == span.token.text || s.qualified() == span.token.text)
            || (span
              .token
              .address
              .as_deref()
              .is_some_and(|a| same_address(a, &s.address)))
        })
      })
    {
      return Ok((doc.md5.clone(), sym.clone(), doc.range(span)));
    }
    bail!("No unambiguous symbol at this position; refresh if modified")
  }
}

/// Resolves the definition location for the symbol, call, local, or type at `pos`.
pub(crate) async fn goto_definition(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  uri: &Uri,
  pos: Position,
) -> Result<Option<Location>> {
  let canon = canonical_virtual_uri(uri);
  let Some(snap) = engine.lock().await.prepare_definition(&canon, pos) else {
    return Ok(None);
  };
  if let Some(s) = &snap.span
    && s.token.kind == "function"
    && s.start < snap.body_start
  {
    return Ok(Some(Location::new(canon, snap.span_range)));
  }
  if let Some(s) = &snap.span
    && let Some(symbol) = &s.symbol
  {
    return Ok(
      symbol_location(engine, backend, &snap.md5, symbol)
        .await
        .ok(),
    );
  }
  if let Some(s) = &snap.span
    && s.token.kind == "function"
  {
    let callee_addr = match s.token.text.strip_prefix("FUN_").map(str::to_owned) {
      Some(addr) => Some(addr),
      None => ensure_symbols(engine, backend, &snap.md5)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|sym| {
          sym.kind.eq_ignore_ascii_case("function")
            && (sym.name == s.token.text || sym.qualified() == s.token.text)
        })
        .map(|sym| sym.address),
    };
    if let Some(addr) = callee_addr {
      if snap
        .entry
        .as_deref()
        .is_some_and(|e| same_address(e, &addr))
      {
        return Ok(Some(Location::new(canon, snap.self_decl_range)));
      }
      if let Ok((target_uri, doc)) = open_function(engine, backend, &snap.md5, &addr).await {
        let target_body = doc.body_start();
        let range = doc
          .spans
          .iter()
          .find(|sp| sp.token.kind == "function" && sp.start < target_body)
          .map(|sp| doc.range(sp))
          .unwrap_or_default();
        return Ok(Some(Location::new(target_uri, range)));
      }
    }
  }
  if let Some(range) = snap.local_decl_range {
    return Ok(Some(Location::new(canon, range)));
  }
  if let Some(s) = &snap.span
    && matches!(s.token.kind.as_str(), "global" | "label")
  {
    let symbols = ensure_symbols(engine, backend, &snap.md5)
      .await
      .unwrap_or_default();
    if let Some(sym) = symbols
      .into_iter()
      .find(|sym| sym.name == s.token.text || sym.qualified() == s.token.text)
    {
      return Ok(Some(
        symbol_location(engine, backend, &snap.md5, &sym).await?,
      ));
    }
  }
  if let Some(s) = &snap.span
    && s.token.kind == "type"
    && let Ok(Some(loc)) = goto_type_definition(engine, backend, &canon, pos).await
  {
    return Ok(Some(loc));
  }
  if let Some((word, _)) = snap.fallback_word {
    if let Some(hex) = word.strip_prefix("FUN_")
      && let Ok((target_uri, _)) = open_function(engine, backend, &snap.md5, hex).await
    {
      return Ok(Some(Location::new(target_uri, Range::default())));
    }
    let symbols = ensure_symbols(engine, backend, &snap.md5).await?;
    if let Some(sym) = symbols
      .into_iter()
      .find(|s| s.name == word || s.qualified() == word)
    {
      return Ok(Some(
        symbol_location(engine, backend, &snap.md5, &sym).await?,
      ));
    }
    if let Ok(Some(loc)) = goto_type_definition(engine, backend, &canon, pos).await {
      return Ok(Some(loc));
    }
  }
  Ok(None)
}

/// Opens or synthesizes the canonical [`Location`] for `symbol` without holding `engine` across I/O.
pub(crate) async fn symbol_location(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  md5: &str,
  symbol: &Symbol,
) -> Result<Location> {
  if symbol.local() {
    let (uri, doc) = open_function(engine, backend, md5, &symbol.address).await?;
    let span = doc
      .spans
      .iter()
      .find(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
      .context("Variable declaration is unavailable in the current decompilation")?;
    return Ok(Location::new(uri, doc.range(span)));
  }
  if symbol.kind.eq_ignore_ascii_case("function")
    && let Ok((uri, doc)) = open_function(engine, backend, md5, &symbol.address).await
  {
    let range = doc
      .spans
      .iter()
      .find(|s| s.symbol.as_ref().is_some_and(|v| v.id == symbol.id))
      .map(|s| doc.range(s))
      .unwrap_or_default();
    return Ok(Location::new(uri, range));
  }
  let uri = virtual_uri(md5, "symbol", &symbol.id)?;
  let should_fetch = {
    let e = engine.lock().await;
    e.docs
      .get(&uri)
      .is_none_or(Document::clean)
      .then(|| e.generation(md5))
  };
  if let Some(generation) = should_fetch {
    let code = fetch_snapshot_text(backend, md5, "symbol", &symbol.id).await?;
    let mut e = engine.lock().await;
    if e.generation(md5) == generation && e.docs.get(&uri).is_none_or(Document::clean) {
      let version = e.docs.get(&uri).and_then(|doc| doc.version);
      e.install(Document {
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
  }
  Ok(Location::new(uri, Range::default()))
}

/// Collects in-document and cross-function references targeting `symbol` without holding `engine` across I/O.
pub(crate) async fn references(
  engine: &Mutex<Engine>,
  backend: &McpBackend,
  md5: &str,
  symbol: &Symbol,
  declaration: bool,
) -> Result<Vec<Location>> {
  if symbol.local() {
    let (uri, doc) = open_function(engine, backend, md5, &symbol.address).await?;
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
  let generation = engine.lock().await.generation(md5);
  let current_symbol: Symbol = serde_json::from_value(
    backend
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
    backend,
    "reference",
    md5,
    json!({"filter": {"direction": "to", "to": symbol.address}, "page": {"limit": 1000}}),
  )
  .await?;
  let functions = list_all(
    backend,
    "function",
    md5,
    json!({
      "page": {"limit": 1000},
      "scan": {"timeout_ms": 60000},
      "projection": {"fields": ["entry", "body"]},
    }),
  )
  .await?;
  let mut locations = vec![];
  let mut unmapped = vec![];
  for reference in refs {
    let from = reference
      .get("from")
      .and_then(Value::as_str)
      .context("reference lacks from address")?;
    let containing: Vec<_> = functions
      .iter()
      .filter(|f| {
        let start = f.pointer("/body/start").and_then(Value::as_str);
        let end = f.pointer("/body/end").and_then(Value::as_str);
        match (start, end) {
          (Some(s), Some(e)) => in_address_range(from, s, e),
          _ => false,
        }
      })
      .collect();
    let mut found = false;
    if containing.len() == 1
      && let Some(entry) = containing[0].get("entry").and_then(Value::as_str)
      && let Ok((uri, doc)) = open_function(engine, backend, md5, entry).await
      && doc.current == doc.base
    {
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
    let installed = {
      let mut e = engine.lock().await;
      if e.generation(md5) == generation && e.docs.get(&uri).is_none_or(Document::clean) {
        let version = e.docs.get(&uri).and_then(|doc| doc.version);
        e.install(Document {
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
        true
      } else {
        false
      }
    };
    if installed {
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
    locations.push(symbol_location(engine, backend, md5, symbol).await?);
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
