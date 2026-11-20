// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Bridge resource coverage reporting helpers.

use serde_json::{Value, json};

/// Builds a coverage summary describing the scan scope and completeness for `domain`.
pub(crate) fn coverage(domain: &str, params: &Value, count: usize, complete: bool) -> Value {
  let scoped = params.pointer("/scan/range").is_some();
  let address_scan = matches!(
    domain,
    "symbol"
      | "function"
      | "global_variable"
      | "code_unit"
      | "data_unit"
      | "instruction"
      | "comment"
  );
  let scope = if address_scan {
    if scoped {
      "requested-address-range"
    } else {
      "bridge-default-address-scan"
    }
  } else {
    "bridge-resource-list"
  };
  let note = match domain {
    "function" => {
      "Address-scanned functions. Whole-program function_count can also include external functions outside the bridge iterator; this list is not an import table."
    }
    "symbol" => {
      "Address-scanned symbols. Whole-program symbol_count also includes resources that the bridge does not enumerate, such as external or non-address symbols; this list is not an export table."
    }
    "data_unit" => {
      "Defined data units, including Ghidra-defined strings. This does not scan undefined bytes for candidate strings."
    }
    _ => "Resources returned by the real Ghidra bridge under the supplied filters and range.",
  };
  json!({"scope": scope, "count": count, "complete": complete, "note": note})
}
