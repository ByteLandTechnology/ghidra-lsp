// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Custom `workspace/executeCommand` handlers for session, function, document, symbol, and location actions.

use std::sync::atomic::Ordering;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{Position, Uri};

use super::Server;
use crate::backend::{McpBackend, list_all};
use crate::document::{
  Document, SHOW_TEMPLATE_ARGUMENTS, canonical_virtual_uri, matches_text, same_address,
};
use crate::engine::{
  ensure_symbols, fetch_snapshot_text, fetch_type_definition, open_function, select_session,
  symbol_location,
};
use crate::workbench;

/// Formats a virtual [`Document`] response payload for `ghidra.document`.
fn document_response(doc: &Document, use_current: bool) -> Value {
  let text = if use_current { &doc.current } else { &doc.base };
  json!({
    "uri": doc.uri,
    "text": text,
    "md5": doc.md5,
    "entry": doc.entry,
    "warning": doc.warning,
  })
}

impl Server {
  /// Dispatches one `workspace/executeCommand` call for session, function, document, or location actions.
  pub(super) async fn execute_session_command(
    &self,
    command: &str,
    arg: Value,
    backend: &McpBackend,
  ) -> Result<Value> {
    match command {
      "ghidra.sessions" => backend.call("session", "list", None, json!({})).await,
      "ghidra.selectSession" => {
        let md5 = arg
          .get("md5")
          .and_then(Value::as_str)
          .context("md5 is required")?
          .to_ascii_lowercase();
        select_session(&self.engine, backend, &md5).await?;
        Ok(json!({"md5": md5}))
      }
      "ghidra.functions" => {
        let md5 = self.scoped_md5(&arg).await?;
        let functions = list_all(
          backend,
          "function",
          &md5,
          json!({
            "page": {"limit": 1000},
            "scan": {"timeout_ms": 60000},
            "projection": {"fields": ["entry", "name", "namespace", "demangled_name"]},
          }),
        )
        .await?;
        let coverage = workbench::coverage("function", &json!({}), functions.len(), true);
        Ok(json!({"items": functions, "coverage": coverage}))
      }
      "ghidra.openFunction" => {
        let md5 = self.scoped_md5(&arg).await?;
        let entry = arg
          .get("entry")
          .and_then(Value::as_str)
          .context("entry is required")?;
        let (uri, _) = open_function(&self.engine, backend, &md5, entry).await?;
        self.report(&uri).await;
        Ok(json!({"uri": uri}))
      }
      "ghidra.openSymbol" => {
        let md5 = self.scoped_md5(&arg).await?;
        let id = arg
          .get("id")
          .and_then(Value::as_str)
          .context("symbol id is required")?;
        let symbol = ensure_symbols(&self.engine, backend, &md5)
          .await?
          .into_iter()
          .find(|s| s.id == id)
          .context("symbol no longer exists")?;
        let location = symbol_location(&self.engine, backend, &md5, &symbol).await?;
        self.changed(&md5).await;
        Ok(json!({"uri": location.uri}))
      }
      "ghidra.document" => {
        let raw_uri: Uri = arg
          .get("uri")
          .and_then(Value::as_str)
          .context("uri is required")?
          .parse()?;
        let uri = canonical_virtual_uri(&raw_uri);
        let include_pending = arg.get("includePending").and_then(Value::as_bool) == Some(true);
        {
          let e = self.engine.lock().await;
          if let Some(doc) = e.docs.get(&uri) {
            let use_current = include_pending
              && e
                .pending
                .get(&doc.md5)
                .and_then(|plan| plan.expected.get(&doc.uri))
                .is_some_and(|expected| matches_text(&doc.current, expected));
            return Ok(document_response(doc, use_current));
          }
        }
        let parsed = url::Url::parse(uri.as_str())?;
        ensure!(parsed.scheme() == "ghidra", "expected a ghidra URI");
        let md5 = parsed.host_str().context("missing session")?;
        let path = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
        let (kind, raw_key) = path
          .split_once('/')
          .context("invalid virtual document path")?;
        let key = percent_encoding::percent_decode_str(raw_key).decode_utf8()?;
        let (doc_uri, fallback_doc) = if kind == "function" {
          open_function(&self.engine, backend, md5, &key).await?
        } else if matches!(kind, "symbol" | "references" | "type") {
          let generation = self.engine.lock().await.generation(md5);
          let text = fetch_snapshot_text(backend, md5, kind, &key).await?;
          let snapshot = Document {
            uri: uri.clone(),
            md5: md5.to_ascii_lowercase(),
            entry: None,
            base: text.clone(),
            current: text.clone(),
            saved: text,
            version: None,
            spans: vec![],
            warning: None,
          };
          let mut e = self.engine.lock().await;
          let installed_uri = if e.generation(md5) == generation {
            e.install(snapshot.clone())?
          } else {
            uri.clone()
          };
          (installed_uri, snapshot)
        } else {
          bail!("Open this symbol through Ghidra first");
        };
        let e = self.engine.lock().await;
        if let Some(doc) = e.docs.get(&doc_uri).or_else(|| e.docs.get(&uri)) {
          let use_current = include_pending
            && e
              .pending
              .get(&doc.md5)
              .and_then(|plan| plan.expected.get(&doc.uri))
              .is_some_and(|expected| matches_text(&doc.current, expected));
          return Ok(document_response(doc, use_current));
        }
        Ok(document_response(&fallback_doc, false))
      }
      "ghidra.configure" => {
        if let Some(value) = arg.get("templateArguments").and_then(Value::as_str) {
          SHOW_TEMPLATE_ARGUMENTS.store(value == "show", Ordering::Relaxed);
        }
        Ok(json!({}))
      }
      "ghidra.location" => {
        let raw_uri: Uri = arg
          .get("uri")
          .and_then(Value::as_str)
          .context("uri is required")?
          .parse()?;
        let uri = canonical_virtual_uri(&raw_uri);
        let e = self.engine.lock().await;
        let doc = e.docs.get(&uri).context("Unknown virtual document")?;
        if let Some(version) = arg.get("version") {
          ensure!(
            *version == json!(doc.version),
            "The decompiled document changed. Request Code Actions again before editing comments"
          );
        }
        if let Some(address) = arg.get("address").and_then(Value::as_str) {
          ensure!(
            doc.clean(),
            "Save or discard the pending edit before mapping a code selection"
          );
          ensure!(
            doc.spans.iter().any(|span| span.location.is_some()),
            "Upgrade ghidra-mcp for GUI cursor locations; this document has no native layout"
          );
          let span = doc.spans.iter().find(|span| {
            span.token.kind != "comment"
              && span
                .location
                .as_ref()
                .and_then(|location| location.code_unit_address.as_deref())
                .is_some_and(|unit| same_address(unit, address))
          });
          return Ok(json!({
            "md5": doc.md5,
            "entry": doc.entry,
            "position": span.map(|span| doc.range(span).start),
            "native": true,
          }));
        }
        let p: Position = serde_json::from_value(
          arg
            .get("position")
            .cloned()
            .context("position is required")?,
        )?;
        let location = doc.code_location(p)?;
        Ok(json!({
          "md5": doc.md5,
          "entry": doc.entry,
          "address": location.map(|l| &l.address),
          "code_unit_address": location.and_then(|l| l.code_unit_address.as_deref()),
          "exact": location.is_some_and(|l| l.exact),
          "native": doc.spans.iter().any(|s| s.location.is_some()),
        }))
      }
      "ghidra.reveal" => {
        let md5 = self.scoped_md5(&arg).await?;
        let address_text = arg
          .get("address")
          .and_then(Value::as_str)
          .context("address is required")?;
        let resolved = backend
          .call(
            "address",
            "resolve",
            Some(&md5),
            json!({"selector": {"address": address_text}}),
          )
          .await?;
        let entry = resolved
          .pointer("/function/entry")
          .and_then(Value::as_str)
          .context("This address is outside a function; use Listing or Memory to inspect it")?;
        let canonical = resolved
          .get("address")
          .and_then(Value::as_str)
          .unwrap_or(address_text);
        let (uri, doc) = open_function(&self.engine, backend, &md5, entry).await?;
        ensure!(
          doc.clean(),
          "Save or discard the pending edit before revealing an assembly address in decompilation"
        );
        let span = doc.span_for_address(canonical).or_else(|| {
          resolved
            .pointer("/code_unit/address")
            .and_then(Value::as_str)
            .and_then(|start| doc.span_for_address(start))
        });
        let range = span.map(|s| doc.range(s)).unwrap_or_default();
        Ok(json!({
          "uri": uri,
          "range": range,
          "exact": span.is_some(),
          "md5": md5,
          "entry": entry,
          "address": canonical,
        }))
      }
      "ghidra.typeAtPosition" => {
        let raw_uri: Uri = arg
          .get("uri")
          .and_then(Value::as_str)
          .context("uri is required")?
          .parse()?;
        let uri = canonical_virtual_uri(&raw_uri);
        let p: Position = serde_json::from_value(
          arg
            .get("position")
            .cloned()
            .context("position is required")?,
        )?;
        let (md5, snapshot) = {
          let e = self.engine.lock().await;
          let md5 = e
            .docs
            .get(&uri)
            .context("Unknown virtual document")?
            .md5
            .clone();
          let snapshot = e.prepare_type_definition(&uri, p)?;
          (md5, snapshot)
        };
        let Some(snapshot) = snapshot else {
          return Ok(Value::Null);
        };
        match fetch_type_definition(backend, snapshot).await? {
          Some(data_type) => Ok(json!({"md5": md5, "type": data_type})),
          None => Ok(Value::Null),
        }
      }
      _ => bail!("Unknown command: {command}"),
    }
  }
}
