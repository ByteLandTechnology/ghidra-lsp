// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Declarative cursor pagination policies for multi-page MCP list operations.

use std::collections::HashSet;

use anyhow::{Result, bail, ensure};
use serde_json::{Value, json};

use crate::backend::McpBackend;

/// Target tool, session MD5, and request parameters for a paginated MCP query.
pub(crate) struct PageRequest<'a> {
  /// MCP tool domain name without the `ghidra_` prefix.
  pub(crate) domain: &'a str,
  /// Domain operation name such as `"list"` or `"import.list"`.
  pub(crate) operation: &'a str,
  /// Optional lowercase 32-hex session MD5 hash.
  pub(crate) md5: Option<&'a str>,
  /// Request parameter object updated with continuation `page` cursors.
  pub(crate) params: Value,
}

impl<'a> PageRequest<'a> {
  /// Builds a session-scoped pagination request for `(domain, operation)` on `md5`.
  pub(crate) fn session(domain: &'a str, operation: &'a str, md5: &'a str, params: Value) -> Self {
    Self {
      domain,
      operation,
      md5: Some(md5),
      params,
    }
  }
}

/// Declarative policy that controls MCP cursor pagination, item checks, and scan completion.
#[derive(Clone, Copy, Debug)]
pub(crate) struct PagePolicy {
  /// Page size sent in `page.limit` on continuation requests.
  page_limit: u64,
  /// Whether each page must contain an `items` array.
  require_items: bool,
  /// Error message returned when the terminal page has `/scan/complete == false`.
  incomplete_scan_error: Option<&'static str>,
}

impl PagePolicy {
  /// Strict full-program pagination policy that requires `items` and a complete scan.
  pub(crate) const STRICT: Self = Self {
    page_limit: 1000,
    require_items: true,
    incomplete_scan_error: Some("backend scan is incomplete; refresh after analysis finishes"),
  };

  /// Range-scoped workbench pagination policy with range-focused scan guidance.
  pub(crate) const RANGE_SCOPED: Self = Self {
    page_limit: 1000,
    require_items: true,
    incomplete_scan_error: Some(
      "backend scan is incomplete; narrow the address range or retry after analysis",
    ),
  };

  /// Lenient continuation policy that preserves partial results from pre-fetched batch pages.
  pub(crate) const LENIENT: Self = Self {
    page_limit: 1000,
    require_items: false,
    incomplete_scan_error: None,
  };

  /// Fetches all pages for `(domain, operation)` with optional `md5` under this policy.
  pub(crate) async fn collect(
    self,
    backend: &McpBackend,
    domain: &str,
    operation: &str,
    md5: Option<&str>,
    params: Value,
  ) -> Result<Vec<Value>> {
    self
      .collect_pages(
        backend,
        PageRequest {
          domain,
          operation,
          md5,
          params,
        },
        None,
      )
      .await
  }

  /// Fetches all pages for session `md5` on `(domain, operation)` under this policy.
  pub(crate) async fn collect_session(
    self,
    backend: &McpBackend,
    domain: &str,
    operation: &str,
    md5: &str,
    params: Value,
  ) -> Result<Vec<Value>> {
    self
      .collect_pages(
        backend,
        PageRequest::session(domain, operation, md5, params),
        None,
      )
      .await
  }

  /// Follows any remaining cursor pages after a pre-fetched `initial` response page.
  pub(crate) async fn continue_from(
    self,
    backend: &McpBackend,
    request: PageRequest<'_>,
    initial: Option<&Value>,
  ) -> Result<Vec<Value>> {
    let Some(first) = initial else {
      return Ok(Vec::new());
    };
    self.collect_pages(backend, request, Some(first)).await
  }

  /// Runs the cursor loop across an optional pre-fetched page and backend continuation calls.
  async fn collect_pages(
    self,
    backend: &McpBackend,
    mut request: PageRequest<'_>,
    mut prefetched: Option<&Value>,
  ) -> Result<Vec<Value>> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    loop {
      let owned;
      let page = if let Some(first) = prefetched.take() {
        first
      } else {
        owned = backend
          .call(
            request.domain,
            request.operation,
            request.md5,
            request.params.clone(),
          )
          .await?;
        &owned
      };
      if let Some(page_items) = page.get("items").and_then(Value::as_array) {
        items.extend(page_items.iter().cloned());
      } else if self.require_items {
        bail!("list response lacks items");
      }
      if let Some(cursor) = next_cursor(page) {
        ensure!(
          seen.insert(cursor.to_owned()),
          "backend repeated a pagination cursor"
        );
        request.params["page"] = json!({
          "cursor": cursor,
          "limit": self.page_limit,
        });
      } else {
        if let Some(err_msg) = self.incomplete_scan_error {
          ensure!(
            page.pointer("/scan/complete").and_then(Value::as_bool) != Some(false),
            "{err_msg}"
          );
        }
        return Ok(items);
      }
    }
  }
}

/// Returns a non-empty continuation cursor string from `page`, or `None` for terminal pages.
pub(crate) fn next_cursor(page: &Value) -> Option<&str> {
  page
    .get("next_cursor")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
}
