// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Function parameter and local variable merging, caching, and span binding.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::document::{
  LocalBinding, Span, Symbol, format_storage_value, is_field_access, resolve_locals,
};

/// Caches parameter and local details for `entry_str` and binds variable and parameter spans.
pub(super) fn bind_function_locals(
  md5: &str,
  entry_str: &str,
  code: &str,
  function: &Value,
  has_native_locals: bool,
  spans: &mut [Span],
) -> HashMap<String, Value> {
  let mut local_details = HashMap::new();
  let mut local_symbols = vec![];
  for (key, kind) in [("parameters", "Parameter"), ("local_variables", "Local")] {
    for variable in function
      .get(key)
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
    {
      let Some(name) = variable.get("name").and_then(Value::as_str) else {
        continue;
      };
      if name.is_empty() {
        continue;
      }
      let ordinal = (kind == "Parameter")
        .then(|| variable.get("ordinal").and_then(Value::as_u64))
        .flatten();
      if kind == "Parameter" && ordinal.is_none() {
        continue;
      }
      let storage_val = variable.get("storage").filter(|s| !s.is_null());
      let identity = if let Some(ord) = ordinal {
        json!({"ordinal": ord})
      } else if let Some(storage) = storage_val {
        json!({"storage": storage, "name": name})
      } else {
        json!({"name": name})
      };
      let id = format!("{kind}:{md5}:{entry_str}:{identity}");
      let mut detail = variable.clone();
      detail["entry"] = json!(entry_str);
      detail["kind"] = json!(kind);
      local_details.insert(id.clone(), detail);
      let storage_text = format_storage_value(storage_val);
      let serialization = storage_val
        .and_then(|v| {
          v.get("serialization")
            .and_then(Value::as_str)
            .or_else(|| v.as_str())
        })
        .map(str::to_owned);
      local_symbols.push(LocalBinding {
        symbol: Symbol {
          demangled_name: None,
          id,
          name: name.into(),
          address: entry_str.to_owned(),
          namespace: String::new(),
          kind: kind.into(),
        },
        ordinal,
        storage: (!storage_text.is_empty()).then_some(storage_text),
        serialization,
      });
    }
  }
  bind_native_local_spans(
    code,
    spans,
    &local_symbols,
    &mut local_details,
    md5,
    entry_str,
  );
  resolve_locals(code, spans, &local_symbols);
  if !has_native_locals {
    for span in spans {
      if span.symbol.is_none()
        && matches!(span.token.kind.as_str(), "variable" | "parameter")
        && !is_field_access(code, span.start)
      {
        let kind = if span.token.kind == "parameter" {
          "Parameter"
        } else {
          "Local"
        };
        span.symbol = Some(Symbol {
          demangled_name: None,
          id: format!("{kind}:{md5}:{entry_str}:name={}", span.token.text),
          name: span.token.text.clone(),
          address: entry_str.to_owned(),
          namespace: String::new(),
          kind: kind.into(),
        });
      }
    }
  }
  local_details
}

/// Merges `local_variables` from `decompilation` into `function` without duplicating entries.
pub(super) fn merge_decompilation_locals(function: &Value, decompilation: &Value) -> Value {
  let mut merged = function.clone();
  let Some(extra) = decompilation
    .get("local_variables")
    .and_then(Value::as_array)
  else {
    return merged;
  };
  let mut locals = merged
    .get("local_variables")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let mut seen: HashSet<(String, String)> = locals
    .iter()
    .filter_map(|v| {
      Some((
        v.get("name")?.as_str()?.to_owned(),
        format_storage_value(v.get("storage")),
      ))
    })
    .collect();
  for item in extra {
    let Some(name) = item.get("name").and_then(Value::as_str) else {
      continue;
    };
    let key = (name.to_owned(), format_storage_value(item.get("storage")));
    if seen.insert(key) {
      locals.push(item.clone());
    }
  }
  merged["local_variables"] = Value::Array(locals);
  merged
}

/// Binds native GUI variable and parameter spans to canonical or scoped function-local symbols.
fn bind_native_local_spans(
  code: &str,
  spans: &mut [Span],
  local_symbols: &[LocalBinding],
  local_details: &mut HashMap<String, Value>,
  md5: &str,
  entry_str: &str,
) {
  let mut ids_per_binding: HashMap<&str, HashSet<&str>> = HashMap::new();
  for span in spans.iter() {
    if !matches!(span.token.kind.as_str(), "variable" | "parameter")
      || is_field_access(code, span.start)
    {
      continue;
    }
    let Some(raw) = span.symbol.as_ref().filter(|sym| sym.local()) else {
      continue;
    };
    let target_name = if raw.name.is_empty() {
      span.token.text.as_str()
    } else {
      raw.name.as_str()
    };
    if let Some(bound) = match_tagged_local(local_symbols, &raw.id, target_name) {
      ids_per_binding
        .entry(bound.symbol.id.as_str())
        .or_default()
        .insert(raw.id.as_str());
    }
  }
  let shared_bindings: HashSet<String> = ids_per_binding
    .into_iter()
    .filter_map(|(bound_id, raw_ids)| (raw_ids.len() > 1).then(|| bound_id.to_owned()))
    .collect();
  let mut local_ids: HashMap<(&str, &str), Option<&str>> =
    HashMap::with_capacity(local_symbols.len());
  for binding in local_symbols {
    local_ids
      .entry((binding.symbol.kind.as_str(), binding.symbol.name.as_str()))
      .and_modify(|slot| *slot = None)
      .or_insert(Some(binding.symbol.id.as_str()));
  }

  for span in spans {
    if !matches!(span.token.kind.as_str(), "variable" | "parameter") {
      continue;
    }
    if is_field_access(code, span.start) {
      span.symbol = None;
      continue;
    }
    let Some(native) = &mut span.symbol else {
      continue;
    };
    if !native.local() {
      continue;
    }
    let target_name = if native.name.is_empty() {
      span.token.text.as_str()
    } else {
      native.name.as_str()
    };
    if let Some(bound) = match_tagged_local(local_symbols, &native.id, target_name)
      && !shared_bindings.contains(&bound.symbol.id)
    {
      *native = bound.symbol.clone();
      continue;
    }
    let kind = if native.kind == "Parameter" || span.token.kind == "parameter" {
      "Parameter"
    } else {
      "Local"
    };
    let prefix = format!("{kind}:{md5}:{entry_str}:");
    let scoped_id = if native.id.starts_with(&prefix) {
      native.id.clone()
    } else {
      format!("{prefix}symbol={}", native.id)
    };
    if !local_details.contains_key(&scoped_id) {
      let detail = if let Some(bound) = match_tagged_local(local_symbols, &native.id, target_name) {
        local_details.get(&bound.symbol.id).cloned().map(|mut d| {
          d["name"] = json!(target_name);
          d
        })
      } else if let Some(ord) = tagged_parameter_ordinal(&native.id) {
        Some(json!({
          "name": target_name,
          "ordinal": ord,
          "entry": entry_str,
          "kind": "Parameter",
        }))
      } else if let Some(storage_ser) = tagged_local_storage(&native.id) {
        Some(json!({
          "name": target_name,
          "storage": { "kind": "serialization", "serialization": storage_ser },
          "entry": entry_str,
          "kind": kind,
        }))
      } else {
        local_ids
          .get(&(kind, target_name))
          .copied()
          .flatten()
          .and_then(|id| local_details.get(id).cloned())
      };
      if let Some(detail) = detail {
        local_details.insert(scoped_id.clone(), detail);
      }
    }
    if native.name.is_empty() {
      native.name = span.token.text.clone();
    }
    native.id = scoped_id;
    native.address = entry_str.to_owned();
    native.namespace = String::new();
    native.kind = kind.into();
  }
}

/// Reads a zero-based parameter ordinal from a `"parameter:<ordinal>"` tag.
fn tagged_parameter_ordinal(raw_id: &str) -> Option<u64> {
  raw_id.strip_prefix("parameter:")?.parse::<u64>().ok()
}

/// Extracts a non-empty storage serialization suffix from a `"local:<id>:<storage>"` tag.
fn tagged_local_storage(raw_id: &str) -> Option<&str> {
  let rest = raw_id.strip_prefix("local:")?;
  let (_, storage_ser) = rest.split_once(':')?;
  (!storage_ser.is_empty()).then_some(storage_ser)
}

/// Finds the [`LocalBinding`] matching a `"parameter:<ordinal>"` or `"local:<id>:<storage>"` tag.
fn match_tagged_local<'a>(
  locals: &'a [LocalBinding],
  raw_id: &str,
  target_name: &str,
) -> Option<&'a LocalBinding> {
  if let Some(ord) = tagged_parameter_ordinal(raw_id) {
    return locals.iter().find(|b| b.ordinal == Some(ord));
  }
  let storage_ser = tagged_local_storage(raw_id)?;
  locals
    .iter()
    .find(|b| {
      b.symbol.kind == "Local" && b.matches_storage(storage_ser) && b.symbol.name == target_name
    })
    .or_else(|| {
      locals
        .iter()
        .find(|b| b.symbol.kind == "Local" && b.matches_storage(storage_ser))
    })
}
