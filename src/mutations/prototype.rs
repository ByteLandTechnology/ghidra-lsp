// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Function prototype, parameter, and local variable batch mutation compiler.

use std::collections::HashSet;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Map, Value, json};

use super::CONFLICT_FORM;
use crate::address::{format_type_ref, parse_type_ref};
use crate::backend::McpBackend;
use crate::workbench;

/// Formats the `data_type` field of a parameter or local variable JSON entry.
fn format_variable_type(val: &Value) -> String {
  match val.get("data_type") {
    Some(dt) if !dt.is_null() => format_type_ref(dt),
    _ => String::new(),
  }
}

/// Formats a structured or plain `storage` value into a display string.
fn format_storage(val: Option<&Value>) -> String {
  match val {
    Some(Value::String(s)) => s.clone(),
    Some(Value::Object(obj)) => match obj.get("kind").and_then(Value::as_str) {
      Some("register") => obj
        .get("register")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned(),
      Some("serialization") => obj
        .get("serialization")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned(),
      _ => String::new(),
    },
    _ => String::new(),
  }
}

/// Compares two data-type values across C string and structured object representations.
fn same_data_type(left: &Value, right: &Value) -> bool {
  left == right || format_type_ref(left).trim() == format_type_ref(right).trim()
}

/// Reads function prototype, parameters, and local variables at `entry` for form editing.
pub(crate) async fn function_prototype(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
) -> Result<Value> {
  let entry = entry.trim();
  ensure!(!entry.is_empty(), "Function entry is required.");
  let original = backend
    .call(
      "function",
      "get",
      Some(md5),
      json!({ "selector": { "entry": entry } }),
    )
    .await?;
  let resolved_entry = original
    .get("entry")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .unwrap_or(entry);
  let return_type = match original.get("return_type").filter(|v| !v.is_null()) {
    Some(rt) => format_type_ref(rt),
    None => "void".to_owned(),
  };
  let calling_convention = original
    .get("calling_convention")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .unwrap_or("default");
  let parameters: Vec<Value> = original
    .get("parameters")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .enumerate()
    .map(|(index, param)| {
      json!({
        "ordinal": param.get("ordinal").and_then(Value::as_u64).unwrap_or(index as u64),
        "name": param.get("name").and_then(Value::as_str).unwrap_or(""),
        "type": format_variable_type(param),
        "storage": format_storage(param.get("storage")),
      })
    })
    .collect();
  let locals: Vec<Value> = original
    .get("local_variables")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .map(|local| {
      json!({
        "name": local.get("name").and_then(Value::as_str).unwrap_or(""),
        "type": format_variable_type(local),
        "storage": format_storage(local.get("storage")),
      })
    })
    .collect();

  Ok(json!({
    "md5": md5,
    "entry": resolved_entry,
    "original": original,
    "name": original.get("name").and_then(Value::as_str).unwrap_or(""),
    "returnType": return_type,
    "callingConvention": calling_convention,
    "hasVarArgs": original.get("has_var_args").and_then(Value::as_bool).unwrap_or(false),
    "hasNoReturn": original.get("has_no_return").and_then(Value::as_bool).unwrap_or(false),
    "isInline": original.get("is_inline").and_then(Value::as_bool).unwrap_or(false),
    "comment": original.get("comment").and_then(Value::as_str).unwrap_or(""),
    "parameters": parameters,
    "locals": locals,
  }))
}

/// Converts a scalar JSON value into a trimmed string.
fn value_as_trimmed_str(val: &Value) -> String {
  match val {
    Value::String(s) => s.trim().to_owned(),
    Value::Number(n) => n.to_string(),
    _ => String::new(),
  }
}

/// Reads a required nonempty string property `key` from `obj`.
fn required_str(obj: &Value, key: &str, label: &str) -> Result<String> {
  let val = obj.get(key).map(value_as_trimmed_str).unwrap_or_default();
  ensure!(!val.is_empty(), "{label} is required.");
  Ok(val)
}

/// Reads the first nonempty string value across candidate `keys` in `obj`.
fn required_str_any(obj: &Value, keys: &[&str], label: &str) -> Result<String> {
  for &key in keys {
    if let Some(raw) = obj.get(key) {
      let trimmed = value_as_trimmed_str(raw);
      if !trimmed.is_empty() {
        return Ok(trimmed);
      }
    }
  }
  bail!("{label} is required.");
}

/// Returns the first boolean value present across `keys` in `obj`, or `false`.
fn bool_any(obj: &Value, keys: &[&str]) -> bool {
  keys
    .iter()
    .find_map(|&key| obj.get(key).and_then(Value::as_bool))
    .unwrap_or(false)
}

/// Normalizes a type field supplied as either a string expression or structured bridge JSON.
fn parse_type_value(val: Option<&Value>) -> Result<Value> {
  match val {
    None | Some(Value::Null) => parse_type_ref(""),
    Some(Value::String(s)) => parse_type_ref(s),
    Some(obj @ Value::Object(_)) => {
      if obj.get("kind").and_then(Value::as_str).is_some() {
        Ok(obj.clone())
      } else {
        parse_type_ref(&format_type_ref(obj))
      }
    }
    Some(other) => parse_type_ref(&value_as_trimmed_str(other)),
  }
}

/// Parses an unsigned array index bounded inclusively by `max`.
fn parse_index(val: &Value, label: &str, max: usize) -> Result<usize> {
  let parsed = match val {
    Value::Number(n) => n.as_u64().map(|v| v as usize),
    Value::String(s) => s.trim().parse::<usize>().ok(),
    _ => None,
  };
  let Some(idx) = parsed.filter(|&i| i <= max) else {
    bail!("{label} must be an integer between 0 and {max}.");
  };
  Ok(idx)
}

/// Matches a form row against its corresponding index in `originals`.
fn resolve_indexed_identity(
  row: &Value,
  originals: &[Value],
  row_index: usize,
  label: &str,
  match_by_ordinal: bool,
  allow_fallback_index: bool,
) -> Result<Option<usize>> {
  if let Some(raw) = row.get("_original") {
    let s = value_as_trimmed_str(raw);
    if s.is_empty() {
      return Ok(None);
    }
    if originals.is_empty() {
      bail!("{label} refers to a missing original entry.");
    }
    return Ok(Some(parse_index(raw, label, originals.len() - 1)?));
  }
  if match_by_ordinal
    && let Some(ord) = row.get("ordinal").and_then(Value::as_u64)
    && let Some(pos) = originals.iter().enumerate().position(|(idx, p)| {
      p.get("ordinal")
        .and_then(Value::as_u64)
        .unwrap_or(idx as u64)
        == ord
    })
  {
    return Ok(Some(pos));
  }
  if !match_by_ordinal
    && let Some(orig_name) = row.get("originalName").and_then(Value::as_str)
    && let Some(pos) = originals
      .iter()
      .position(|l| l.get("name").and_then(Value::as_str) == Some(orig_name))
  {
    return Ok(Some(pos));
  }
  if allow_fallback_index && row_index < originals.len() {
    return Ok(Some(row_index));
  }
  Ok(None)
}

/// Fetches the current function at `entry` and verifies it matches `original`.
async fn fetch_and_verify_function(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
  original: &Value,
) -> Result<String> {
  let entry = entry.trim();
  ensure!(!entry.is_empty(), "Function entry is required.");
  let current = backend
    .call(
      "function",
      "get",
      Some(md5),
      json!({ "selector": { "entry": entry } }),
    )
    .await?;
  ensure!(current == *original, "{CONFLICT_FORM}");
  Ok(entry.to_owned())
}

/// Compiles `all_or_none` batch operations for function signature and parameter updates.
fn compile_function_prototype_ops(
  entry: &str,
  original: &Value,
  payload: &Value,
) -> Result<Vec<Value>> {
  let name = required_str(payload, "name", "Function name")?;
  let return_type = parse_type_value(
    payload
      .get("returnType")
      .or_else(|| payload.get("return_type")),
  )?;
  let calling_convention = required_str_any(
    payload,
    &["callingConvention", "convention", "calling_convention"],
    "Calling convention",
  )?;
  let has_var_args = bool_any(payload, &["hasVarArgs", "varargs", "has_var_args"]);
  let has_no_return = bool_any(payload, &["hasNoReturn", "noreturn", "has_no_return"]);
  let is_inline = bool_any(payload, &["isInline", "inline", "is_inline"]);
  let comment = match payload.get("comment").and_then(Value::as_str) {
    Some(s) if !s.is_empty() => Value::String(s.to_owned()),
    _ => Value::Null,
  };

  let orig_name = original.get("name").and_then(Value::as_str).unwrap_or("");
  let return_changed = match original.get("return_type").filter(|v| !v.is_null()) {
    Some(orig_rt) => !same_data_type(&return_type, orig_rt),
    None => format_type_ref(&return_type).trim() != "void",
  };
  let orig_cc = original
    .get("calling_convention")
    .and_then(Value::as_str)
    .filter(|s| !s.is_empty())
    .unwrap_or("default");
  let orig_var_args = original
    .get("has_var_args")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  let orig_no_return = original
    .get("has_no_return")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  let orig_inline = original
    .get("is_inline")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  let orig_comment = match original.get("comment").and_then(Value::as_str) {
    Some(s) if !s.is_empty() => Value::String(s.to_owned()),
    _ => Value::Null,
  };
  let header_changed = name != orig_name
    || return_changed
    || calling_convention != orig_cc
    || has_var_args != orig_var_args
    || has_no_return != orig_no_return
    || is_inline != orig_inline
    || comment != orig_comment;

  let mut patch = Map::new();
  patch.insert("name".into(), Value::String(name));
  patch.insert("return_type".into(), return_type);
  patch.insert(
    "calling_convention".into(),
    Value::String(calling_convention),
  );
  patch.insert("has_var_args".into(), Value::Bool(has_var_args));
  patch.insert("has_no_return".into(), Value::Bool(has_no_return));
  patch.insert("is_inline".into(), Value::Bool(is_inline));
  patch.insert("comment".into(), comment);

  let orig_params = original
    .get("parameters")
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);
  let has_custom_storage = original
    .get("has_custom_variable_storage")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  let mut params_changed = false;

  if let Some(params_val) = payload.get("parameters") {
    let parameters = params_val
      .as_array()
      .context("parameters must be an array")?;
    if parameters.len() != orig_params.len() {
      params_changed = true;
    }
    let mut seen_originals = HashSet::new();
    let mut seen_names = HashSet::new();
    let mut compiled_params = Vec::with_capacity(parameters.len());

    for (ordinal, param) in parameters.iter().enumerate() {
      let identity = resolve_indexed_identity(
        param,
        orig_params,
        ordinal,
        "Parameter identity",
        true,
        false,
      )?;
      let param_name = required_str(param, "name", "Parameter name")?;
      ensure!(
        seen_names.insert(param_name.clone()),
        "Parameter names must be unique."
      );
      let data_type = parse_type_value(param.get("type").or_else(|| param.get("data_type")))?;
      let explicit_storage = param.get("storage").filter(|v| v.is_object()).cloned();

      let storage = match identity {
        Some(orig_idx) => {
          ensure!(
            seen_originals.insert(orig_idx),
            "Duplicate original parameter identity."
          );
          let previous = &orig_params[orig_idx];
          let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
          if orig_idx != ordinal
            || param_name != prev_name
            || !same_data_type(&data_type, &previous["data_type"])
          {
            params_changed = true;
          }
          if let Some(explicit) = explicit_storage {
            if previous.get("storage") != Some(&explicit) {
              params_changed = true;
            }
            Some(explicit)
          } else if has_custom_storage {
            previous.get("storage").filter(|v| v.is_object()).cloned()
          } else {
            None
          }
        }
        None => {
          params_changed = true;
          explicit_storage
        }
      };

      let mut item = Map::new();
      item.insert("ordinal".into(), json!(ordinal));
      item.insert("name".into(), Value::String(param_name));
      item.insert("data_type".into(), data_type);
      if let Some(storage_obj) = storage {
        item.insert("storage".into(), storage_obj);
      }
      compiled_params.push(Value::Object(item));
    }

    if params_changed {
      patch.insert("parameters".into(), Value::Array(compiled_params));
    }
  }

  ensure!(header_changed || params_changed, "No changes to save.");

  Ok(vec![json!({
    "method": "function.patch",
    "arguments": {
      "selector": { "entry": entry },
      "patch": Value::Object(patch),
    }
  })])
}

/// Compiles `all_or_none` batch operations for renaming and retyping parameters and locals.
fn compile_variables_ops(entry: &str, original: &Value, payload: &Value) -> Result<Vec<Value>> {
  let orig_params = original
    .get("parameters")
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);
  let orig_locals = original
    .get("local_variables")
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);

  let mut ops = Vec::new();

  if let Some(params_val) = payload.get("parameters") {
    let parameters = params_val
      .as_array()
      .context("parameters must be an array")?;
    for (idx, var) in parameters.iter().enumerate() {
      let orig_idx =
        resolve_indexed_identity(var, orig_params, idx, "Variable identity", true, true)?
          .context("Parameter variable identity is required.")?;
      let previous = &orig_params[orig_idx];
      let name = required_str(var, "name", "Variable name")?;
      let data_type = parse_type_value(var.get("type").or_else(|| var.get("data_type")))?;
      let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
      if name == prev_name && same_data_type(&data_type, &previous["data_type"]) {
        continue;
      }
      let orig_ordinal = previous
        .get("ordinal")
        .and_then(Value::as_u64)
        .unwrap_or(orig_idx as u64);
      ops.push(json!({
        "method": "function_parameter.patch",
        "arguments": {
          "selector": { "entry": entry, "ordinal": orig_ordinal },
          "patch": { "name": name, "data_type": data_type }
        }
      }));
    }
  }

  if let Some(locals_val) = payload
    .get("locals")
    .or_else(|| payload.get("local_variables"))
  {
    let locals = locals_val.as_array().context("locals must be an array")?;
    for (idx, var) in locals.iter().enumerate() {
      let orig_idx =
        resolve_indexed_identity(var, orig_locals, idx, "Variable identity", false, true)?
          .context("Local variable identity is required.")?;
      let previous = &orig_locals[orig_idx];
      let name = required_str(var, "name", "Variable name")?;
      let data_type = parse_type_value(var.get("type").or_else(|| var.get("data_type")))?;
      let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
      if name == prev_name && same_data_type(&data_type, &previous["data_type"]) {
        continue;
      }
      ops.push(json!({
        "method": "function_local_variable.patch",
        "arguments": {
          "selector": { "entry": entry, "name": prev_name },
          "patch": { "name": name, "data_type": data_type }
        }
      }));
    }
  }

  ensure!(!ops.is_empty(), "No changes to save.");
  Ok(ops)
}

/// Fetches the current function state, checks conflict against `original`, and compiles prototype ops.
pub(crate) async fn prepare_function_prototype_ops(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
  original: &Value,
  payload: &Value,
) -> Result<Vec<Value>> {
  let entry = fetch_and_verify_function(backend, md5, entry, original).await?;
  compile_function_prototype_ops(&entry, original, payload)
}

/// Fetches the current function state, checks conflict against `original`, and compiles variable ops.
pub(crate) async fn prepare_variables_ops(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
  original: &Value,
  payload: &Value,
) -> Result<Vec<Value>> {
  let entry = fetch_and_verify_function(backend, md5, entry, original).await?;
  compile_variables_ops(&entry, original, payload)
}

/// Executes one single mutation or an atomic `all_or_none` batch through policy verification.
pub(crate) async fn execute_ops(backend: &McpBackend, md5: &str, ops: &[Value]) -> Result<Value> {
  ensure!(!ops.is_empty(), "No changes to save.");
  if ops.len() == 1 {
    let op = &ops[0];
    let method = op
      .get("method")
      .and_then(Value::as_str)
      .context("mutation method is required")?;
    let (domain, operation) = method.split_once('.').context("invalid mutation method")?;
    let arguments = op.get("arguments").cloned().unwrap_or_else(|| json!({}));
    workbench::allow_write(domain, operation, &arguments)?;
    let (tool, tool_op) = workbench::mcp_operation(domain, operation);
    let result = backend
      .call(tool, &tool_op, Some(md5), arguments)
      .await
      .context(
        "Modification may have reached Ghidra; refresh and inspect the actual program state before retrying",
      )?;
    workbench::check_write_result(domain, operation, &result)?;
    return Ok(result);
  }

  let items: Vec<Value> = ops
    .iter()
    .enumerate()
    .map(|(index, op)| {
      json!({
        "id": index.to_string(),
        "method": op["method"],
        "arguments": op["arguments"],
      })
    })
    .collect();
  let batch_params = json!({
    "transaction_mode": "all_or_none",
    "items": items,
  });
  workbench::allow_write("batch", "execute", &batch_params)?;
  let result = backend
    .call("batch", "execute", Some(md5), batch_params)
    .await
    .context(
      "Modification may have reached Ghidra; refresh and inspect the actual program state before retrying",
    )?;
  workbench::check_write_result("batch", "execute", &result)?;
  Ok(result)
}
