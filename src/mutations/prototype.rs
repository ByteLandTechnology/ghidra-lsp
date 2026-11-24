// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Function prototype, parameter, and local variable batch mutation compiler.

use std::collections::HashSet;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::CONFLICT_FORM;
use crate::address::{format_type_ref, parse_type_ref};
use crate::backend::{McpBackend, unsupported_storage_selector};
use crate::document::{format_storage_value, storage_selector};
use crate::workbench;

/// Formats the `data_type` field of a parameter or local variable JSON entry.
fn format_variable_type(val: &Value) -> String {
  match val.get("data_type") {
    Some(dt) if !dt.is_null() => format_type_ref(dt),
    _ => String::new(),
  }
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
        "storage": format_storage_value(param.get("storage")),
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
        "storage": format_storage_value(local.get("storage")),
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
  if !match_by_ordinal && let Some(orig_name) = row.get("originalName").and_then(Value::as_str) {
    let row_storage = format_storage_value(row.get("storage"));
    if !row_storage.is_empty()
      && let Some(pos) = originals.iter().position(|l| {
        l.get("name").and_then(Value::as_str) == Some(orig_name)
          && format_storage_value(l.get("storage")) == row_storage
      })
    {
      return Ok(Some(pos));
    }
    if let Some(pos) = originals
      .iter()
      .position(|l| l.get("name").and_then(Value::as_str) == Some(orig_name))
    {
      return Ok(Some(pos));
    }
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

  let mut ops = vec![json!({
    "method": "function.patch",
    "arguments": {
      "selector": { "entry": entry },
      "patch": {
        "name": name,
        "return_type": return_type,
        "calling_convention": calling_convention,
        "has_var_args": has_var_args,
        "has_no_return": has_no_return,
        "is_inline": is_inline,
        "comment": comment,
      }
    }
  })];

  let orig_params = original
    .get("parameters")
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);

  if let Some(params_val) = payload.get("parameters") {
    let parameters = params_val
      .as_array()
      .context("parameters must be an array")?;
    let mut retained = HashSet::new();
    let mut identities = Vec::with_capacity(parameters.len());
    for (idx, param) in parameters.iter().enumerate() {
      let identity =
        resolve_indexed_identity(param, orig_params, idx, "Parameter identity", true, false)?;
      if let Some(orig_idx) = identity {
        retained.insert(orig_idx);
      }
      identities.push(identity);
    }

    // Delete highest ordinals first so lower parameter ordinals do not shift mid-batch.
    for index in (0..orig_params.len()).rev() {
      if !retained.contains(&index) {
        let orig_ordinal = orig_params[index]
          .get("ordinal")
          .and_then(Value::as_u64)
          .unwrap_or(index as u64);
        ops.push(json!({
          "method": "function_parameter.delete",
          "arguments": {
            "selector": { "entry": entry, "ordinal": orig_ordinal }
          }
        }));
      }
    }

    for (ordinal, (param, identity)) in parameters.iter().zip(identities).enumerate() {
      let param_name = required_str(param, "name", "Parameter name")?;
      let data_type = parse_type_value(param.get("type").or_else(|| param.get("data_type")))?;
      match identity {
        None => {
          ops.push(json!({
            "method": "function_parameter.create",
            "arguments": {
              "selector": { "entry": entry },
              "resource": {
                "ordinal": ordinal,
                "name": param_name,
                "data_type": data_type,
              }
            }
          }));
        }
        Some(orig_idx) => {
          let previous = &orig_params[orig_idx];
          let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
          if param_name != prev_name || data_type != previous["data_type"] {
            ops.push(json!({
              "method": "function_parameter.patch",
              "arguments": {
                "selector": { "entry": entry, "ordinal": ordinal },
                "patch": {
                  "name": param_name,
                  "data_type": data_type,
                }
              }
            }));
          }
        }
      }
    }
  }

  Ok(ops)
}

/// Compiles `all_or_none` batch operations for renaming and retyping parameters and locals.
fn compile_variables_ops(
  entry: &str,
  original: &Value,
  payload: &Value,
  include_local_storage: bool,
) -> Result<Vec<Value>> {
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
      if name == prev_name && data_type == previous["data_type"] {
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
      if name == prev_name && data_type == previous["data_type"] {
        continue;
      }
      let mut selector = json!({ "entry": entry, "name": prev_name });
      if include_local_storage && let Some(storage) = storage_selector(previous.get("storage")) {
        selector["storage"] = storage;
      }
      ops.push(json!({
        "method": "function_local_variable.patch",
        "arguments": {
          "selector": selector,
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
  compile_variables_ops(&entry, original, payload, backend.supports_local_storage())
}

/// Copies `ops` without `selector.storage` on local patches, or returns `None` if none had it.
fn strip_local_storage_ops(ops: &[Value]) -> Option<Vec<Value>> {
  let mut stripped = false;
  let updated = ops
    .iter()
    .map(|op| {
      let mut copy = op.clone();
      if copy.get("method").and_then(Value::as_str) == Some("function_local_variable.patch")
        && let Some(selector) = copy
          .pointer_mut("/arguments/selector")
          .and_then(Value::as_object_mut)
        && selector.remove("storage").is_some()
      {
        stripped = true;
      }
      copy
    })
    .collect();
  stripped.then_some(updated)
}

/// Builds an `all_or_none` `batch.execute` parameter payload from compiled mutation `ops`.
fn build_batch_params(ops: &[Value]) -> Value {
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
  json!({
    "transaction_mode": "all_or_none",
    "items": items,
  })
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
    let has_storage =
      method == "function_local_variable.patch" && arguments.pointer("/selector/storage").is_some();
    let call_result = match backend
      .call(tool, &tool_op, Some(md5), arguments.clone())
      .await
    {
      Ok(res) => Ok(res),
      Err(err) if has_storage && unsupported_storage_selector(&err, false) => {
        backend.disable_local_storage();
        let mut fallback_args = arguments;
        if let Some(selector) = fallback_args
          .get_mut("selector")
          .and_then(Value::as_object_mut)
        {
          selector.remove("storage");
        }
        workbench::allow_write(domain, operation, &fallback_args)?;
        backend.call(tool, &tool_op, Some(md5), fallback_args).await
      }
      Err(err) => Err(err),
    };
    let result = call_result.context(
      "Modification may have reached Ghidra; refresh and inspect the actual program state before retrying",
    )?;
    workbench::check_write_result(domain, operation, &result)?;
    return Ok(result);
  }

  let batch_params = build_batch_params(ops);
  workbench::allow_write("batch", "execute", &batch_params)?;
  let call_result = match backend
    .call("batch", "execute", Some(md5), batch_params)
    .await
  {
    Ok(res) => Ok(res),
    Err(err) if unsupported_storage_selector(&err, true) => {
      if let Some(fallback_ops) = strip_local_storage_ops(ops) {
        backend.disable_local_storage();
        let fallback_params = build_batch_params(&fallback_ops);
        workbench::allow_write("batch", "execute", &fallback_params)?;
        backend
          .call("batch", "execute", Some(md5), fallback_params)
          .await
      } else {
        Err(err)
      }
    }
    Err(err) => Err(err),
  };
  let result = call_result.context(
    "Modification may have reached Ghidra; refresh and inspect the actual program state before retrying",
  )?;
  workbench::check_write_result("batch", "execute", &result)?;
  Ok(result)
}
