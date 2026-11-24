// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Function prototype, parameter, and local variable batch mutation compiler.

use std::collections::HashSet;

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::CONFLICT_FORM;
use crate::address::{format_type_ref, is_array_type_ref, parse_type_ref_for};
use crate::backend::{BackendCapabilities, McpBackend};
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
        "storage": param.get("storage").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
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
        "storage": local.get("storage").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
      })
    })
    .collect();

  Ok(json!({
    "md5": md5,
    "entry": resolved_entry,
    "original": original,
    "name": original.get("name").and_then(Value::as_str).unwrap_or(""),
    "returnType": return_type,
    "returnStorage": original.get("return_storage").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
    "callingConvention": calling_convention,
    "hasCustomVariableStorage": original.get("has_custom_variable_storage").and_then(Value::as_bool).unwrap_or(false),
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

/// Returns the first boolean value present across `keys` in `obj`.
fn opt_bool_any(obj: &Value, keys: &[&str]) -> Option<bool> {
  keys
    .iter()
    .find_map(|&key| obj.get(key).and_then(Value::as_bool))
}

/// Returns the first boolean value present across `keys` in `obj`, or `false`.
fn bool_any(obj: &Value, keys: &[&str]) -> bool {
  opt_bool_any(obj, keys).unwrap_or(false)
}

/// Normalizes a type field into a C type string or structured `DataTypeReference` AST.
fn parse_type_value(val: Option<&Value>, c_type_strings: bool) -> Result<Value> {
  match val {
    None | Some(Value::Null) => parse_type_ref_for("", c_type_strings),
    Some(Value::String(s)) => parse_type_ref_for(s, c_type_strings),
    Some(obj @ Value::Object(_)) => {
      if obj.get("kind").and_then(Value::as_str).is_some() {
        Ok(obj.clone())
      } else {
        parse_type_ref_for(&format_type_ref(obj), c_type_strings)
      }
    }
    Some(other) => parse_type_ref_for(&value_as_trimmed_str(other), c_type_strings),
  }
}

/// Returns true when `proposed` matches `original_dt` structurally or after C formatting.
fn same_type_input(proposed: &Value, original_dt: &Value) -> bool {
  if proposed == original_dt {
    return true;
  }
  if original_dt.is_null() {
    return false;
  }
  format_type_ref(proposed).trim() == format_type_ref(original_dt).trim()
}

/// Returns true when `dt` represents a pointer or untyped-pointer data type.
fn is_pointer_like_type(dt: &Value) -> bool {
  if matches!(
    dt.get("kind").and_then(Value::as_str),
    Some("pointer" | "untyped_pointer")
  ) {
    return true;
  }
  let Some(s) = dt.as_str() else {
    return false;
  };
  let trimmed = s.trim();
  !is_array_type_ref(dt)
    && (trimmed == "pointer" || trimmed.ends_with('*') || trimmed.contains("(*"))
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

/// Options that control how form rows map back to original parameter or local entries.
struct IdentityOptions<'a> {
  /// Human-readable field label for error diagnostics.
  label: &'a str,
  /// Whether `ordinal` numbers map to original parameter ordinals.
  match_by_ordinal: bool,
  /// Whether unmatched rows fall back to positional `row_index`.
  allow_fallback_index: bool,
}

/// Matches a form row against its corresponding index in `originals`.
fn resolve_indexed_identity(
  row: &Value,
  originals: &[Value],
  row_index: usize,
  opts: &IdentityOptions<'_>,
) -> Result<Option<usize>> {
  if let Some(raw) = row.get("_original") {
    let s = value_as_trimmed_str(raw);
    if s.is_empty() {
      return Ok(None);
    }
    if originals.is_empty() {
      bail!("{} refers to a missing original entry.", opts.label);
    }
    return Ok(Some(parse_index(raw, opts.label, originals.len() - 1)?));
  }
  if opts.match_by_ordinal
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
  if !opts.match_by_ordinal
    && let Some(orig_name) = row.get("originalName").and_then(Value::as_str)
    && let Some(pos) = originals
      .iter()
      .position(|l| l.get("name").and_then(Value::as_str) == Some(orig_name))
  {
    return Ok(Some(pos));
  }
  if opts.allow_fallback_index && row_index < originals.len() {
    return Ok(Some(row_index));
  }
  Ok(None)
}

/// Fetches the current function at `entry` and checks that it matches `original`.
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

/// Compiles a single atomic `function.patch` operation when `signature` is provided.
fn compile_signature_patch_op(
  entry: &str,
  original: &Value,
  payload: &Value,
  signature: &str,
  caps: BackendCapabilities,
) -> Result<Vec<Value>> {
  let has_conflict = payload.get("parameters").is_some()
    || payload
      .get("returnType")
      .or_else(|| payload.get("return_type"))
      .is_some_and(|v| !value_as_trimmed_str(v).is_empty() || v.is_object())
    || payload
      .get("callingConvention")
      .or_else(|| payload.get("convention"))
      .or_else(|| payload.get("calling_convention"))
      .is_some_and(|v| !value_as_trimmed_str(v).is_empty());
  ensure!(
    !has_conflict,
    "conflicting_fields: signature cannot be combined with parameters, return_type, or calling_convention."
  );
  ensure!(
    caps.function_signature,
    "A newer ghidra-mcp is required for one-line C function signatures."
  );

  let mut patch = serde_json::Map::new();
  patch.insert("signature".into(), Value::String(signature.to_owned()));

  let orig_name = original.get("name").and_then(Value::as_str).unwrap_or("");
  if let Some(raw_name) = payload.get("name") {
    let name = value_as_trimmed_str(raw_name);
    if !name.is_empty() && name != orig_name {
      patch.insert("name".into(), Value::String(name));
    }
  }
  if let Some(v) = opt_bool_any(payload, &["hasVarArgs", "varargs", "has_var_args"])
    && Some(v) != original.get("has_var_args").and_then(Value::as_bool)
  {
    patch.insert("has_var_args".into(), Value::Bool(v));
  }
  if let Some(v) = opt_bool_any(payload, &["hasNoReturn", "noreturn", "has_no_return"])
    && Some(v) != original.get("has_no_return").and_then(Value::as_bool)
  {
    patch.insert("has_no_return".into(), Value::Bool(v));
  }
  if let Some(v) = opt_bool_any(payload, &["isInline", "inline", "is_inline"])
    && Some(v) != original.get("is_inline").and_then(Value::as_bool)
  {
    patch.insert("is_inline".into(), Value::Bool(v));
  }
  if let Some(v) = opt_bool_any(
    payload,
    &["hasCustomVariableStorage", "has_custom_variable_storage"],
  ) {
    patch.insert("has_custom_variable_storage".into(), Value::Bool(v));
  }
  if let Some(ret_st) = payload
    .get("returnStorage")
    .or_else(|| payload.get("return_storage"))
    .filter(|v| v.is_object())
    && Some(ret_st) != original.get("return_storage")
  {
    patch.insert("return_storage".into(), ret_st.clone());
  }
  if let Some(raw_comment) = payload.get("comment").and_then(Value::as_str) {
    let orig_comment = original
      .get("comment")
      .and_then(Value::as_str)
      .unwrap_or("");
    if raw_comment != orig_comment {
      let comment_val = if raw_comment.is_empty() {
        Value::Null
      } else {
        Value::String(raw_comment.to_owned())
      };
      patch.insert("comment".into(), comment_val);
    }
  }

  Ok(vec![json!({
    "method": "function.patch",
    "arguments": {
      "selector": { "entry": entry },
      "patch": Value::Object(patch),
    }
  })])
}

/// Normalized parameter row compiled from a prototype edit payload.
struct CompiledParameter {
  /// Claimed index in `orig_params` when this row maps to an existing parameter.
  identity: Option<usize>,
  /// Validated parameter identifier.
  name: String,
  /// Normalized data-type reference in C string or structured AST form.
  data_type: Value,
  /// Optional custom `VariableStorageReference` preserved or edited for this parameter.
  storage: Option<Value>,
  /// Whether `storage` was explicitly changed relative to the matched original parameter.
  explicit_storage_change: bool,
}

/// Appends legacy `function_parameter.{delete,patch,create}` ops for non-atomic backends.
fn append_legacy_parameter_ops(
  entry: &str,
  orig_params: &[Value],
  compiled: &[CompiledParameter],
  ops: &mut Vec<Value>,
) {
  let mut keep_in_place = HashSet::new();
  let mut last_orig: Option<usize> = None;
  for item in compiled {
    if let Some(orig_idx) = item.identity
      && last_orig.is_none_or(|prev| orig_idx > prev)
    {
      keep_in_place.insert(orig_idx);
      last_orig = Some(orig_idx);
    }
  }
  for (ordinal, item) in compiled.iter().enumerate() {
    for later in &compiled[ordinal + 1..] {
      if let Some(later_idx) = later.identity
        && keep_in_place.contains(&later_idx)
        && orig_params[later_idx].get("name").and_then(Value::as_str) == Some(item.name.as_str())
      {
        keep_in_place.remove(&later_idx);
      }
    }
  }
  for index in (0..orig_params.len()).rev() {
    if !keep_in_place.contains(&index) {
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
  for (ordinal, item) in compiled.iter().enumerate() {
    if let Some(orig_idx) = item.identity
      && keep_in_place.contains(&orig_idx)
    {
      let previous = &orig_params[orig_idx];
      let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
      if item.name != prev_name
        || !same_type_input(&item.data_type, &previous["data_type"])
        || item.explicit_storage_change
      {
        let mut patch_map = serde_json::Map::new();
        patch_map.insert("name".into(), Value::String(item.name.clone()));
        patch_map.insert("data_type".into(), item.data_type.clone());
        if let Some(st) = &item.storage {
          patch_map.insert("storage".into(), st.clone());
        }
        ops.push(json!({
          "method": "function_parameter.patch",
          "arguments": {
            "selector": { "entry": entry, "ordinal": ordinal },
            "patch": Value::Object(patch_map),
          }
        }));
      }
    } else {
      let mut resource = serde_json::Map::new();
      resource.insert("ordinal".into(), json!(ordinal));
      resource.insert("name".into(), Value::String(item.name.clone()));
      resource.insert("data_type".into(), item.data_type.clone());
      if let Some(st) = &item.storage {
        resource.insert("storage".into(), st.clone());
      }
      ops.push(json!({
        "method": "function_parameter.create",
        "arguments": {
          "selector": { "entry": entry },
          "resource": Value::Object(resource),
        }
      }));
    }
  }
}

/// Compiles atomic `function.patch` (and legacy parameter ops when needed) for prototype edits.
fn compile_function_prototype_ops(
  entry: &str,
  original: &Value,
  payload: &Value,
  caps: BackendCapabilities,
) -> Result<Vec<Value>> {
  if let Some(sig) = payload
    .get("signature")
    .map(value_as_trimmed_str)
    .filter(|s| !s.is_empty())
  {
    return compile_signature_patch_op(entry, original, payload, &sig, caps);
  }

  let name = required_str(payload, "name", "Function name")?;
  let return_type = parse_type_value(
    payload
      .get("returnType")
      .or_else(|| payload.get("return_type")),
    caps.c_type_strings,
  )?;
  let calling_convention = required_str_any(
    payload,
    &["callingConvention", "convention", "calling_convention"],
    "Calling convention",
  )?;
  let has_var_args = bool_any(payload, &["hasVarArgs", "varargs", "has_var_args"]);
  let has_no_return = bool_any(payload, &["hasNoReturn", "noreturn", "has_no_return"]);
  let is_inline = bool_any(payload, &["isInline", "inline", "is_inline"]);
  let req_custom = opt_bool_any(
    payload,
    &["hasCustomVariableStorage", "has_custom_variable_storage"],
  );
  let comment = match payload.get("comment").and_then(Value::as_str) {
    Some(s) if !s.is_empty() => Value::String(s.to_owned()),
    _ => Value::Null,
  };

  let mut patch = serde_json::Map::new();
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
  if let Some(custom) = req_custom {
    patch.insert("has_custom_variable_storage".into(), Value::Bool(custom));
  }
  if let Some(ret_st) = payload
    .get("returnStorage")
    .or_else(|| payload.get("return_storage"))
    .filter(|v| v.is_object())
    && Some(ret_st) != original.get("return_storage")
  {
    patch.insert("return_storage".into(), ret_st.clone());
  }

  let orig_params = original
    .get("parameters")
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);
  let orig_custom = original
    .get("has_custom_variable_storage")
    .and_then(Value::as_bool)
    .unwrap_or(false);

  let mut legacy_params: Option<Vec<CompiledParameter>> = None;

  if let Some(params_val) = payload.get("parameters") {
    let parameters = params_val
      .as_array()
      .context("parameters must be an array")?;
    let id_opts = IdentityOptions {
      label: "Parameter identity",
      match_by_ordinal: true,
      allow_fallback_index: false,
    };
    let mut claimed = HashSet::new();
    let mut compiled = Vec::with_capacity(parameters.len());
    let mut params_changed = parameters.len() != orig_params.len() || req_custom.is_some();

    for (ordinal, param) in parameters.iter().enumerate() {
      let raw_identity = resolve_indexed_identity(param, orig_params, ordinal, &id_opts)?;
      let identity = raw_identity.filter(|idx| claimed.insert(*idx));
      let param_name = required_str(param, "name", "Parameter name")?;
      let data_type = parse_type_value(
        param.get("type").or_else(|| param.get("data_type")),
        caps.c_type_strings,
      )?;
      let param_storage_obj = param.get("storage").filter(|v| v.is_object());
      let orig_entry = identity.and_then(|idx| orig_params.get(idx));
      let orig_storage_obj = orig_entry
        .and_then(|p| p.get("storage"))
        .filter(|v| v.is_object());
      let explicit_storage_change =
        param_storage_obj.is_some() && param_storage_obj != orig_storage_obj;

      if identity != Some(ordinal) || explicit_storage_change {
        params_changed = true;
      }
      if let Some(previous) = orig_entry {
        let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
        if param_name != prev_name || !same_type_input(&data_type, &previous["data_type"]) {
          params_changed = true;
        }
      } else {
        params_changed = true;
      }

      let mut storage = None;
      if req_custom != Some(false) {
        if explicit_storage_change {
          storage = param_storage_obj.cloned();
        } else if (orig_custom || req_custom == Some(true))
          && let Some(previous) = orig_entry
          && let Some(st) = param_storage_obj.or(orig_storage_obj)
          && (same_type_input(&data_type, &previous["data_type"])
            || (is_pointer_like_type(&data_type) && is_pointer_like_type(&previous["data_type"])))
        {
          storage = Some(st.clone());
        }
      }

      compiled.push(CompiledParameter {
        identity,
        name: param_name,
        data_type,
        storage,
        explicit_storage_change,
      });
    }

    if params_changed {
      if caps.atomic_function_parameters {
        let patch_params: Vec<Value> = compiled
          .into_iter()
          .map(|p| {
            let mut item = serde_json::Map::new();
            item.insert("name".into(), Value::String(p.name));
            item.insert("data_type".into(), p.data_type);
            if let Some(st) = p.storage {
              item.insert("storage".into(), st);
            }
            Value::Object(item)
          })
          .collect();
        patch.insert("parameters".into(), Value::Array(patch_params));
      } else {
        legacy_params = Some(compiled);
      }
    }
  }

  let mut ops = vec![json!({
    "method": "function.patch",
    "arguments": {
      "selector": { "entry": entry },
      "patch": Value::Object(patch),
    }
  })];
  if let Some(compiled) = legacy_params {
    append_legacy_parameter_ops(entry, orig_params, &compiled, &mut ops);
  }
  Ok(ops)
}

/// Compiles `all_or_none` batch operations for parameter and local variable updates.
fn compile_variables_ops(
  entry: &str,
  original: &Value,
  payload: &Value,
  caps: BackendCapabilities,
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
  let param_opts = IdentityOptions {
    label: "Variable identity",
    match_by_ordinal: true,
    allow_fallback_index: true,
  };
  let local_opts = IdentityOptions {
    label: "Variable identity",
    match_by_ordinal: false,
    allow_fallback_index: true,
  };

  if let Some(params_val) = payload.get("parameters") {
    let parameters = params_val
      .as_array()
      .context("parameters must be an array")?;
    for (idx, var) in parameters.iter().enumerate() {
      let orig_idx = resolve_indexed_identity(var, orig_params, idx, &param_opts)?
        .context("Parameter variable identity is required.")?;
      let previous = &orig_params[orig_idx];
      let name = required_str(var, "name", "Variable name")?;
      let data_type = parse_type_value(
        var.get("type").or_else(|| var.get("data_type")),
        caps.c_type_strings,
      )?;
      let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
      if name == prev_name && same_type_input(&data_type, &previous["data_type"]) {
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
      let orig_idx = resolve_indexed_identity(var, orig_locals, idx, &local_opts)?
        .context("Local variable identity is required.")?;
      let previous = &orig_locals[orig_idx];
      let name = required_str(var, "name", "Variable name")?;
      let data_type = parse_type_value(
        var.get("type").or_else(|| var.get("data_type")),
        caps.c_type_strings,
      )?;
      let prev_name = previous.get("name").and_then(Value::as_str).unwrap_or("");
      if name == prev_name && same_type_input(&data_type, &previous["data_type"]) {
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
  let caps = backend.capabilities().await?;
  let entry = fetch_and_verify_function(backend, md5, entry, original).await?;
  compile_function_prototype_ops(&entry, original, payload, caps)
}

/// Fetches the current function state, checks conflict against `original`, and compiles variable ops.
pub(crate) async fn prepare_variables_ops(
  backend: &McpBackend,
  md5: &str,
  entry: &str,
  original: &Value,
  payload: &Value,
) -> Result<Vec<Value>> {
  let caps = backend.capabilities().await?;
  let entry = fetch_and_verify_function(backend, md5, entry, original).await?;
  compile_variables_ops(&entry, original, payload, caps)
}

/// Executes one single mutation or an atomic `all_or_none` batch through policy verification.
pub(crate) async fn execute_ops(backend: &McpBackend, md5: &str, ops: &[Value]) -> Result<Value> {
  ensure!(!ops.is_empty(), "No changes to save.");
  let caps = backend.capabilities().await?;
  if ops.len() == 1 {
    let op = &ops[0];
    let method = op
      .get("method")
      .and_then(Value::as_str)
      .context("mutation method is required")?;
    let (domain, operation) = method.split_once('.').context("invalid mutation method")?;
    let arguments = op.get("arguments").cloned().unwrap_or_else(|| json!({}));
    workbench::allow_write(domain, operation, &arguments)?;
    let arguments = workbench::adapt_write_params(domain, operation, arguments, caps)?;
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
  let batch_params = workbench::adapt_write_params("batch", "execute", batch_params, caps)?;
  let result = backend
    .call("batch", "execute", Some(md5), batch_params)
    .await
    .context(
      "Modification may have reached Ghidra; refresh and inspect the actual program state before retrying",
    )?;
  workbench::check_write_result("batch", "execute", &result)?;
  Ok(result)
}
