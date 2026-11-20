// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Schema and field validation for edited `.ghidra-type` JSONC documents.

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::jsonc::{check_unique_keys, parse_jsonc_ast};
use super::model::safe_i64_from_value;
use super::{MAX_I32, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, PathSegment, TypeEditError};
use crate::address::parse_type_ref;

/// Returns a [`TypeEditError`] attached to `path`.
pub(super) fn fail_path<T>(
  message: impl Into<String>,
  path: &[PathSegment],
) -> std::result::Result<T, TypeEditError> {
  Err(TypeEditError::at_path(message, path.to_vec()))
}

/// Validates that `value` is an object containing only keys listed in `keys`.
fn check_record<'a>(
  value: Option<&'a Value>,
  path: &[PathSegment],
  keys: &[&str],
) -> std::result::Result<&'a Map<String, Value>, TypeEditError> {
  let Some(Value::Object(map)) = value else {
    return fail_path("Expected an object.", path);
  };
  for key in map.keys() {
    if !keys.contains(&key.as_str()) {
      let mut key_path = path.to_vec();
      key_path.push(PathSegment::Key(key.clone()));
      return fail_path(format!("Unsupported property \"{key}\"."), &key_path);
    }
  }
  Ok(map)
}

/// Validates that `value` is a JSON string, rejecting blank strings when `allow_empty` is false.
fn check_string<'a>(
  value: Option<&'a Value>,
  path: &[PathSegment],
  allow_empty: bool,
) -> std::result::Result<&'a str, TypeEditError> {
  let Some(Value::String(s)) = value else {
    return fail_path("Expected a non-empty string.", path);
  };
  if !allow_empty && s.trim().is_empty() {
    return fail_path("Expected a non-empty string.", path);
  }
  Ok(s.as_str())
}

/// Validates that `value` is an exact JSON integer within `min..=max`.
fn check_number(
  value: Option<&Value>,
  path: &[PathSegment],
  min: i64,
  max: i64,
) -> std::result::Result<i64, TypeEditError> {
  let Some(n) = safe_i64_from_value(value) else {
    return fail_path(format!("Expected an integer from {min} to {max}."), path);
  };
  if n < min || n > max {
    return fail_path(format!("Expected an integer from {min} to {max}."), path);
  }
  Ok(n)
}

/// Validates that `value` is a JSON array.
fn check_array<'a>(
  value: Option<&'a Value>,
  path: &[PathSegment],
) -> std::result::Result<&'a Vec<Value>, TypeEditError> {
  let Some(Value::Array(arr)) = value else {
    return fail_path("Expected an array. Use [] to remove all members.", path);
  };
  Ok(arr)
}

/// Validates a type reference string and converts it into a structured type descriptor.
fn check_type(
  value: Option<&Value>,
  path: &[PathSegment],
) -> std::result::Result<(), TypeEditError> {
  let name = check_string(value, path, false)?;
  parse_type_ref(name)
    .map(|_| ())
    .map_err(|err| TypeEditError::at_path(err.to_string(), path.to_vec()))
}

/// Parses and validates user-edited JSONC text against the baseline `TypeModel` snapshot.
pub(super) fn parse_type_jsonc(
  text: &str,
  original: &Value,
) -> std::result::Result<Value, TypeEditError> {
  parse_type_jsonc_inner(text, original).map_err(|e| e.with_span(text))
}

/// Parses JSONC syntax, checks structural rules, and returns a normalized `Value` on success.
fn parse_type_jsonc_inner(
  text: &str,
  original: &Value,
) -> std::result::Result<Value, TypeEditError> {
  let tree = parse_jsonc_ast(text)
    .map_err(|e| TypeEditError::at_span(e.message, vec![], e.offset, e.length))?;
  let Some(tree) = tree else {
    return Err(TypeEditError::at_span(
      "Enter a data type definition.",
      vec![],
      0,
      1.min(text.len()),
    ));
  };

  let mut key_path = Vec::new();
  check_unique_keys(&tree, &mut key_path)?;

  let root_value = tree.to_value();
  let orig_kind = original.get("kind").and_then(Value::as_str).unwrap_or("");
  let orig_path = original.get("path").and_then(Value::as_str).unwrap_or("");
  let member_key = match orig_kind {
    "enum" => "values",
    "function" => "signature",
    _ => "fields",
  };

  let data = check_record(Some(&root_value), &[], &["path", "kind", member_key])?;
  if data.get("path").and_then(Value::as_str) != Some(orig_path) {
    return fail_path(
      "path identifies this data type and cannot be changed.",
      &[PathSegment::Key("path".into())],
    );
  }
  if data.get("kind").and_then(Value::as_str) != Some(orig_kind) {
    return fail_path(
      "kind identifies this data type and cannot be changed.",
      &[PathSegment::Key("kind".into())],
    );
  }

  if member_key == "signature" {
    let sig_path = [PathSegment::Key("signature".into())];
    let sig = check_record(
      data.get("signature"),
      &sig_path,
      &[
        "return_type",
        "calling_convention",
        "has_var_args",
        "has_no_return",
        "parameters",
      ],
    )?;
    check_type(
      sig.get("return_type"),
      &[
        PathSegment::Key("signature".into()),
        PathSegment::Key("return_type".into()),
      ],
    )?;
    let cc_path = [
      PathSegment::Key("signature".into()),
      PathSegment::Key("calling_convention".into()),
    ];
    let cc = check_string(sig.get("calling_convention"), &cc_path, false)?;
    if cc.eq_ignore_ascii_case("unknown") {
      return fail_path(
        "Choose a known calling convention, such as default.",
        &cc_path,
      );
    }
    for flag in ["has_var_args", "has_no_return"] {
      if !sig.get(flag).is_some_and(Value::is_boolean) {
        return fail_path(
          "Expected true or false.",
          &[
            PathSegment::Key("signature".into()),
            PathSegment::Key(flag.into()),
          ],
        );
      }
    }
    let params_path = [
      PathSegment::Key("signature".into()),
      PathSegment::Key("parameters".into()),
    ];
    let params = check_array(sig.get("parameters"), &params_path)?;
    for (i, param) in params.iter().enumerate() {
      let p = vec![
        PathSegment::Key("signature".into()),
        PathSegment::Key("parameters".into()),
        PathSegment::Index(i),
      ];
      let p_map = check_record(Some(param), &p, &["name", "type"])?;
      let mut name_p = p.clone();
      name_p.push(PathSegment::Key("name".into()));
      check_string(p_map.get("name"), &name_p, true)?;
      let mut type_p = p;
      type_p.push(PathSegment::Key("type".into()));
      check_type(p_map.get("type"), &type_p)?;
    }
  } else {
    let list_path = [PathSegment::Key(member_key.into())];
    let members = check_array(data.get(member_key), &list_path)?;
    let mut originals = HashSet::new();
    if let Some(orig_members) = original.get(member_key).and_then(Value::as_array) {
      for m in orig_members {
        if let Some(id) = m.get("id").and_then(Value::as_str) {
          originals.insert(id);
        }
      }
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    let mut offsets = HashSet::new();
    let allowed_keys: &[&str] = if member_key == "values" {
      &["id", "name", "value"]
    } else if orig_kind == "struct" {
      &["id", "name", "type", "length", "offset"]
    } else {
      &["id", "name", "type", "length"]
    };

    for (i, member) in members.iter().enumerate() {
      let p = vec![PathSegment::Key(member_key.into()), PathSegment::Index(i)];
      let m_map = check_record(Some(member), &p, allowed_keys)?;
      if let Some(id_val) = m_map.get("id") {
        let mut id_p = p.clone();
        id_p.push(PathSegment::Key("id".into()));
        let id = check_string(Some(id_val), &id_p, false)?;
        if !originals.contains(id) || !ids.insert(id.to_owned()) {
          return fail_path(
            "Keep a unique existing id, or omit id for a new member.",
            &id_p,
          );
        }
      }
      let allow_empty_name = member_key == "fields" && orig_kind == "struct";
      let mut name_p = p.clone();
      name_p.push(PathSegment::Key("name".into()));
      let name = check_string(m_map.get("name"), &name_p, allow_empty_name)?;
      if !name.is_empty() && !names.insert(name.to_owned()) {
        return fail_path("Member names must be unique.", &name_p);
      }
      if member_key == "values" {
        let mut val_p = p.clone();
        val_p.push(PathSegment::Key("value".into()));
        check_number(
          m_map.get("value"),
          &val_p,
          MIN_SAFE_INTEGER,
          MAX_SAFE_INTEGER,
        )?;
      } else {
        let mut type_p = p.clone();
        type_p.push(PathSegment::Key("type".into()));
        check_type(m_map.get("type"), &type_p)?;
        if let Some(len_val) = m_map.get("length") {
          let mut len_p = p.clone();
          len_p.push(PathSegment::Key("length".into()));
          check_number(Some(len_val), &len_p, 1, MAX_I32)?;
        }
        if orig_kind == "struct" {
          let mut off_p = p.clone();
          off_p.push(PathSegment::Key("offset".into()));
          let off = check_number(m_map.get("offset"), &off_p, 0, MAX_I32)?;
          if !offsets.insert(off) {
            return fail_path("Structure fields must have distinct offsets.", &off_p);
          }
        }
      }
    }
  }

  Ok(root_value)
}
