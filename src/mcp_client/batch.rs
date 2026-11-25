// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Declarative allowlist and `batch.execute` validation policies for MCP operations.

use std::collections::HashSet;

use anyhow::{Context, Result, ensure};
use serde_json::Value;

/// Read-only workbench operations permitted in `ghidra.query` and read batches.
const READ: &[(&str, &str)] = &[
  ("address", "resolve"),
  ("address_space", "list"),
  ("analysis", "get"),
  ("code_unit", "list"),
  ("comment", "get"),
  ("comment", "list"),
  ("data_type", "get"),
  ("data_type", "list"),
  ("data_type_category", "list"),
  ("data_unit", "list"),
  ("decompilation", "get"),
  ("entry_point", "list"),
  ("export", "list"),
  ("flow_override", "list"),
  ("function", "get"),
  ("function", "list"),
  ("function_call", "list"),
  ("global_variable", "get"),
  ("global_variable", "list"),
  ("import", "list"),
  ("instruction", "get"),
  ("instruction", "list"),
  ("interface", "get"),
  ("job", "get"),
  ("job", "wait"),
  ("memory", "read"),
  ("memory_block", "get"),
  ("memory_block", "list"),
  ("program", "get"),
  ("program_language", "get"),
  ("reference", "list"),
  ("session", "get"),
  ("session", "list"),
  ("symbol", "get"),
  ("symbol", "list"),
];

/// Mutation workbench operations permitted in `ghidra.mutate` and write batches.
const WRITE: &[(&str, &str)] = &[
  ("comment", "create"),
  ("comment", "delete"),
  ("comment", "patch"),
  ("comment", "upsert"),
  ("data_type", "create"),
  ("data_type", "delete"),
  ("data_type", "patch"),
  ("data_type", "upsert"),
  ("flow_override", "patch"),
  ("function", "patch"),
  ("function_local_variable", "patch"),
  ("function_parameter", "create"),
  ("function_parameter", "delete"),
  ("function_parameter", "patch"),
  ("global_variable", "create"),
  ("global_variable", "delete"),
  ("global_variable", "patch"),
  ("global_variable", "upsert"),
  ("memory", "write"),
  ("program", "save"),
  ("symbol", "patch"),
  ("symbol", "demangle"),
];

/// Transaction-mode requirement enforced on `batch.execute` requests.
#[derive(Clone, Copy, Debug)]
enum TransactionPolicy {
  /// Requires `"transaction_mode": "all_or_none"` for atomic write batches.
  AtomicOnly,
  /// Accepts absent or non-string defaults, `"per_item"`, or `"all_or_none"` for read batches.
  ReadCompatible,
}

/// Declarative policy that checks standalone operations and `batch.execute` item lists.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BatchPolicy {
  /// Maximum number of items permitted in one `batch.execute` request.
  max_items: usize,
  /// Permitted `(domain, operation)` resource pairs.
  allowed_methods: &'static [(&'static str, &'static str)],
  /// Optional `(domain, operation)` pair permitted standalone but excluded inside batches.
  excluded_batch_method: Option<(&'static str, &'static str)>,
  /// Whether batch item methods normalize through `resource_operation` before matching.
  normalize_batch_methods: bool,
  /// Transaction-mode rule applied to `batch.execute` requests.
  transaction_policy: TransactionPolicy,
  /// Error prefix formatted when a batch item method is rejected.
  unsupported_batch_prefix: &'static str,
  /// Error prefix formatted when a standalone operation is rejected.
  unsupported_operation_prefix: &'static str,
}

impl BatchPolicy {
  /// Atomic write policy for `ghidra.mutate`, prototype edits, and type-document saves.
  pub(crate) const WRITE: Self = Self {
    max_items: 1000,
    allowed_methods: WRITE,
    excluded_batch_method: Some(("program", "save")),
    normalize_batch_methods: false,
    transaction_policy: TransactionPolicy::AtomicOnly,
    unsupported_batch_prefix: "Unsupported batch mutation",
    unsupported_operation_prefix: "Unsupported workbench mutation",
  };

  /// Read-only query policy for `ghidra.query` and read-only `batch.execute` requests.
  pub(crate) const READ: Self = Self {
    max_items: 1000,
    allowed_methods: READ,
    excluded_batch_method: None,
    normalize_batch_methods: true,
    transaction_policy: TransactionPolicy::ReadCompatible,
    unsupported_batch_prefix: "Unsupported batch query",
    unsupported_operation_prefix: "Unsupported read-only workbench query",
  };

  /// Checks `(domain, operation)` and, for `batch.execute`, every batch item against this policy.
  pub(crate) fn validate(self, domain: &str, operation: &str, params: &Value) -> Result<()> {
    let (domain, operation) = resource_operation(domain, operation);
    if (domain, operation) == ("batch", "execute") {
      self.check_transaction_mode(params)?;
      let items = params
        .get("items")
        .and_then(Value::as_array)
        .context("batch items are required")?;
      ensure!(
        !items.is_empty() && items.len() <= self.max_items,
        "batch must contain 1–{} items",
        self.max_items
      );
      let mut ids = HashSet::new();
      for item in items {
        let id = item
          .get("id")
          .and_then(Value::as_str)
          .context("batch item id is required")?;
        ensure!(
          !id.is_empty() && ids.insert(id),
          "batch item IDs must be unique and nonempty"
        );
        let method = item
          .get("method")
          .and_then(Value::as_str)
          .context("batch method is required")?;
        let (item_domain, item_op) = method.split_once('.').context("invalid batch method")?;
        let (norm_domain, norm_op) = if self.normalize_batch_methods {
          resource_operation(item_domain, item_op)
        } else {
          (item_domain, item_op)
        };
        let allowed = self.excluded_batch_method != Some((norm_domain, norm_op))
          && self.allowed_methods.contains(&(norm_domain, norm_op));
        ensure!(allowed, "{}: {method}", self.unsupported_batch_prefix);
        ensure!(
          item.get("arguments").is_some_and(Value::is_object),
          "batch arguments must be an object"
        );
      }
      return Ok(());
    }
    ensure!(
      self.allowed_methods.contains(&(domain, operation)),
      "{}: {domain}.{operation}",
      self.unsupported_operation_prefix
    );
    Ok(())
  }

  /// Checks the `transaction_mode` field of a `batch.execute` parameter object.
  fn check_transaction_mode(self, params: &Value) -> Result<()> {
    let mode = params.get("transaction_mode").and_then(Value::as_str);
    match self.transaction_policy {
      TransactionPolicy::AtomicOnly => ensure!(
        mode == Some("all_or_none"),
        "Workbench batches must use transaction_mode all_or_none"
      ),
      TransactionPolicy::ReadCompatible => ensure!(
        matches!(mode, None | Some("per_item") | Some("all_or_none")),
        "Unsupported batch transaction_mode"
      ),
    }
    Ok(())
  }
}

/// Converts an MCP tool domain and prefixed operation back to its resource `(domain, operation)`.
pub(crate) fn resource_operation<'a>(domain: &'a str, operation: &'a str) -> (&'a str, &'a str) {
  match (domain, operation.split_once('.')) {
    ("address", Some(("space", op))) => ("address_space", op),
    ("program", Some(("language", op))) => ("program_language", op),
    ("program", Some((resource @ ("import" | "export" | "entry_point"), op))) => (resource, op),
    ("memory", Some(("block", op))) => ("memory_block", op),
    (
      "listing",
      Some((resource @ ("code_unit" | "data_unit" | "instruction" | "flow_override"), op)),
    ) => (resource, op),
    ("function", Some(("call", op))) => ("function_call", op),
    ("function", Some(("parameter", op))) => ("function_parameter", op),
    ("function", Some(("local_variable", op))) => ("function_local_variable", op),
    ("data_type", Some(("category", op))) => ("data_type_category", op),
    ("bridge", None) => ("interface", operation),
    _ => (domain, operation),
  }
}

/// Checks that `(domain, operation)` and any atomic batch items are approved write operations.
pub(crate) fn allow_write(domain: &str, operation: &str, params: &Value) -> Result<()> {
  BatchPolicy::WRITE.validate(domain, operation, params)
}

/// Checks that `(domain, operation)` and any read batch items are read-only workbench queries.
pub(crate) fn allow_read(domain: &str, operation: &str, params: &Value) -> Result<()> {
  BatchPolicy::READ.validate(domain, operation, params)
}
