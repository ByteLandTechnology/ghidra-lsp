// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Document symbol outline and workspace symbol search handlers for [`Server`].

use std::collections::HashSet;
use std::sync::atomic::Ordering;

use serde_json::json;
use tower_lsp_server::jsonrpc;
use tower_lsp_server::ls_types::{
  DocumentSymbol, DocumentSymbolParams, DocumentSymbolResponse, Location, OneOf, Position, Range,
  SymbolKind, WorkspaceLocation, WorkspaceSymbol, WorkspaceSymbolParams, WorkspaceSymbolResponse,
};

use super::{Server, rpc};
use crate::backend::list_all;
use crate::document::{Document, Symbol, canonical_virtual_uri, position, virtual_uri};

impl Server {
  /// Builds nested outline symbols for the opened decompilation buffer in `params`.
  pub(super) async fn handle_document_symbol(
    &self,
    params: DocumentSymbolParams,
  ) -> jsonrpc::Result<Option<DocumentSymbolResponse>> {
    let uri = canonical_virtual_uri(&params.text_document.uri);
    let e = self.engine.lock().await;
    let Some(doc) = e.docs.get(&uri) else {
      return Ok(None);
    };
    if doc.current != doc.base {
      return Ok(None);
    }
    let body_start = doc.body_start();
    let decl = doc
      .spans
      .iter()
      .find(|s| s.token.kind == "function" && s.start < body_start);
    let root_id = doc
      .entry
      .as_ref()
      .and_then(|_| decl.and_then(|s| s.symbol.as_ref().map(|sym| sym.id.as_str())));
    let mut seen = HashSet::new();
    let mut symbols = Vec::new();
    for (span, symbol) in doc
      .spans
      .iter()
      .filter_map(|s| s.symbol.as_ref().map(|sym| (s, sym)))
      .filter(|(_, s)| root_id != Some(s.id.as_str()) && seen.insert(s.id.clone()))
    {
      symbols.push(
        make_document_symbol(
          symbol.display_name(),
          Some(symbol.address.clone()),
          kind(symbol),
          doc.range(span),
          doc.range(span),
          None,
        )
        .map_err(rpc)?,
      );
    }

    if let Some(entry) = &doc.entry {
      let func_name = decl
        .map(|s| {
          s.symbol
            .as_ref()
            .map_or_else(|| s.token.text.clone(), Symbol::display_name)
        })
        .unwrap_or_else(|| format!("func_{entry}"));
      let full_range = Range::new(Position::new(0, 0), position(&doc.base, doc.base.len()));
      let header_range = decl.map(|s| doc.range(s)).unwrap_or_else(|| {
        Range::new(
          Position::new(0, 0),
          Position::new(0, func_name.encode_utf16().count() as u32),
        )
      });

      let root = make_document_symbol(
        func_name,
        Some(entry.clone()),
        SymbolKind::FUNCTION,
        full_range,
        header_range,
        if symbols.is_empty() {
          None
        } else {
          Some(symbols)
        },
      )
      .map_err(rpc)?;
      return Ok(Some(DocumentSymbolResponse::Nested(vec![root])));
    }
    Ok(Some(DocumentSymbolResponse::Nested(symbols)))
  }

  /// Searches symbols and data types across the active Ghidra session.
  pub(super) async fn handle_workspace_symbol(
    &self,
    params: WorkspaceSymbolParams,
  ) -> jsonrpc::Result<Option<WorkspaceSymbolResponse>> {
    let mut e = self.engine.lock().await;
    let Ok(md5) = e.session().map(str::to_owned) else {
      return Ok(Some(WorkspaceSymbolResponse::Nested(vec![])));
    };
    let symbols = e.symbols(&md5).await.map_err(rpc)?;
    let mut result = vec![];
    let query = params.query.to_lowercase();
    for symbol in symbols.into_iter().filter(|s| {
      s.eligible()
        && (s.full_name().to_lowercase().contains(&query)
          || s.qualified().to_lowercase().contains(&query))
    }) {
      let sym_uri = virtual_uri(
        &md5,
        if symbol.kind.eq_ignore_ascii_case("function") {
          "function"
        } else {
          "symbol"
        },
        if symbol.kind.eq_ignore_ascii_case("function") {
          &symbol.address
        } else {
          &symbol.id
        },
      )
      .map_err(rpc)?;
      let location = if self.lazy_symbols.load(Ordering::Relaxed) {
        OneOf::Right(WorkspaceLocation { uri: sym_uri })
      } else if symbol.kind.eq_ignore_ascii_case("function") {
        let open_loc = e.docs.get(&sym_uri).map(|doc| {
          let body_start = doc.body_start();
          let range = doc
            .spans
            .iter()
            .find(|s| s.token.kind == "function" && s.start < body_start)
            .map(|s| doc.range(s))
            .unwrap_or_default();
          Location::new(doc.uri.clone(), range)
        });
        OneOf::Left(open_loc.unwrap_or_else(|| Location::new(sym_uri, Range::default())))
      } else {
        OneOf::Left(Location::new(sym_uri, Range::default()))
      };
      let container = (!symbol.namespace.is_empty() && symbol.namespace != "Global")
        .then(|| symbol.namespace.clone())
        .or_else(|| Some(md5.clone()));
      result.push(WorkspaceSymbol {
        name: symbol.display_name(),
        kind: kind(&symbol),
        tags: None,
        location,
        container_name: container,
        data: Some(json!({"md5": md5, "symbol": symbol})),
      });
    }
    let backend = e.backend.clone();
    drop(e);
    if let Ok(types) = list_all(
      backend.as_ref(),
      "data_type",
      &md5,
      json!({"page": {"limit": 1000}}),
    )
    .await
    {
      let query = params.query.to_lowercase();
      for dt in types {
        let name = dt
          .get("name")
          .and_then(serde_json::Value::as_str)
          .unwrap_or("");
        let path = dt
          .get("path")
          .and_then(serde_json::Value::as_str)
          .unwrap_or("");
        let kind_str = dt
          .get("kind")
          .and_then(serde_json::Value::as_str)
          .unwrap_or("type");
        if name.is_empty() {
          continue;
        }
        if !query.is_empty()
          && !name.to_lowercase().contains(&query)
          && !path.to_lowercase().contains(&query)
        {
          continue;
        }
        let sym_kind = match kind_str {
          "structure" | "struct" | "union" => SymbolKind::STRUCT,
          "enum" => SymbolKind::ENUM,
          "typedef" => SymbolKind::INTERFACE,
          _ => SymbolKind::CLASS,
        };
        let uri = match virtual_uri(&md5, "type", &format!("{path}.md")) {
          Ok(u) => u,
          Err(_) => continue,
        };
        let location = if self.lazy_symbols.load(Ordering::Relaxed) {
          OneOf::Right(WorkspaceLocation { uri })
        } else {
          OneOf::Left(Location::new(uri, Range::default()))
        };
        result.push(WorkspaceSymbol {
          name: format!("{name} ({kind_str})"),
          kind: sym_kind,
          tags: None,
          location,
          container_name: Some(path.to_owned()),
          data: Some(json!({"md5": md5, "type_path": path})),
        });
      }
    }
    Ok(Some(WorkspaceSymbolResponse::Nested(result)))
  }

  /// Resolves a deferred workspace symbol or type entry into a concrete virtual document location.
  pub(super) async fn handle_symbol_resolve(
    &self,
    mut params: WorkspaceSymbol,
  ) -> jsonrpc::Result<WorkspaceSymbol> {
    let data = params
      .data
      .as_ref()
      .ok_or_else(|| rpc("Missing symbol data"))?;
    let md5 = data
      .get("md5")
      .and_then(serde_json::Value::as_str)
      .ok_or_else(|| rpc("Missing session"))?;
    if let Some(type_path) = data.get("type_path").and_then(serde_json::Value::as_str) {
      let uri = virtual_uri(md5, "type", &format!("{type_path}.md")).map_err(rpc)?;
      let mut e = self.engine.lock().await;
      if e.docs.get(&uri).is_none_or(Document::clean) {
        let code = e.snapshot_text(md5, "type", type_path).await.map_err(rpc)?;
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
        })
        .map_err(rpc)?;
      }
      drop(e);
      self.changed(md5).await;
      params.location = OneOf::Left(Location::new(uri, Range::default()));
      return Ok(params);
    }
    let symbol: Symbol = serde_json::from_value(
      data
        .get("symbol")
        .cloned()
        .ok_or_else(|| rpc("Missing symbol"))?,
    )
    .map_err(rpc)?;
    params.location = OneOf::Left(
      self
        .engine
        .lock()
        .await
        .symbol_location(md5, &symbol)
        .await
        .map_err(rpc)?,
    );
    if matches!(&params.location, OneOf::Left(location) if location.uri.as_str().contains("/symbol/"))
    {
      self.changed(md5).await;
    }
    Ok(params)
  }
}

/// Maps a Ghidra [`Symbol`] category to an LSP [`SymbolKind`].
fn kind(symbol: &Symbol) -> SymbolKind {
  if symbol.kind.eq_ignore_ascii_case("function") {
    SymbolKind::FUNCTION
  } else {
    SymbolKind::VARIABLE
  }
}

/// Constructs an LSP [`DocumentSymbol`] via JSON to avoid initializing its deprecated field directly.
fn make_document_symbol(
  name: String,
  detail: Option<String>,
  kind: SymbolKind,
  range: Range,
  selection_range: Range,
  children: Option<Vec<DocumentSymbol>>,
) -> anyhow::Result<DocumentSymbol> {
  serde_json::from_value(json!({
    "name": name,
    "detail": detail,
    "kind": kind,
    "range": range,
    "selectionRange": selection_range,
    "children": children,
  }))
  .map_err(Into::into)
}
