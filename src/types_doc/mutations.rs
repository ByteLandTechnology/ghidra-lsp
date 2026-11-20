// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Diffing and atomic MCP mutation planning for edited data-type models.

use std::collections::{BTreeMap, HashSet};

use serde_json::{Map, Value, json};

use super::model::{non_undefined_fields, safe_i64_from_value, same_type_data};
use super::parse::fail_path;
use super::{PathSegment, TypeEditError, TypeMutation};
use crate::address::parse_type_ref;

/// Builds a Ghidra member selector object for a struct offset or union/enum name.
fn field_selector(kind: &str, member: &Value) -> Value {
  if kind == "struct" {
    json!({ "offset": member["offset"] })
  } else {
    json!({ "name": member["name"] })
  }
}

/// Checks whether a raw Ghidra field entry carries a non-empty comment string.
fn has_nonempty_comment(field: &Value) -> bool {
  field
    .get("comment")
    .and_then(Value::as_str)
    .is_some_and(|s| !s.is_empty())
}

/// Computes the ordered Ghidra MCP mutations needed to apply `draft` over `original`.
pub(super) fn type_mutations(
  original: &Value,
  draft: &Value,
  raw: &Value,
) -> std::result::Result<Vec<TypeMutation>, TypeEditError> {
  let path = original.get("path").and_then(Value::as_str).unwrap_or("");
  let kind = original.get("kind").and_then(Value::as_str).unwrap_or("");
  let make_op = |patch: Map<String, Value>| -> TypeMutation {
    let mut full_patch = Map::new();
    full_patch.insert("kind".into(), json!(kind));
    for (k, v) in patch {
      full_patch.insert(k, v);
    }
    TypeMutation {
      method: "data_type.patch".into(),
      arguments: json!({
        "selector": { "path": path },
        "patch": Value::Object(full_patch),
      }),
    }
  };

  if kind == "function" {
    if same_type_data(&original["signature"], &draft["signature"]) {
      return Ok(vec![]);
    }
    let sig = &draft["signature"];
    let return_type = parse_type_ref(sig["return_type"].as_str().unwrap_or("")).map_err(|e| {
      TypeEditError::at_path(
        e.to_string(),
        vec![
          PathSegment::Key("signature".into()),
          PathSegment::Key("return_type".into()),
        ],
      )
    })?;
    let mut params = Vec::new();
    if let Some(arr) = sig.get("parameters").and_then(Value::as_array) {
      for (i, param) in arr.iter().enumerate() {
        let dt = parse_type_ref(param["type"].as_str().unwrap_or("")).map_err(|e| {
          TypeEditError::at_path(
            e.to_string(),
            vec![
              PathSegment::Key("signature".into()),
              PathSegment::Key("parameters".into()),
              PathSegment::Index(i),
              PathSegment::Key("type".into()),
            ],
          )
        })?;
        params.push(json!({
          "name": param["name"],
          "data_type": dt,
        }));
      }
    }
    return Ok(vec![TypeMutation {
      method: "data_type.upsert".into(),
      arguments: json!({
        "resource": {
          "kind": kind,
          "name": raw["name"],
          "category_path": raw["category_path"],
          "signature": {
            "return_type": return_type,
            "calling_convention": sig["calling_convention"],
            "has_var_args": sig["has_var_args"],
            "has_no_return": sig["has_no_return"],
            "parameters": params,
          },
        }
      }),
    }]);
  }

  let enum_type = kind == "enum";
  let suffix = if enum_type { "values" } else { "fields" };
  let before = original
    .get(suffix)
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);
  let after = draft
    .get(suffix)
    .and_then(Value::as_array)
    .map(Vec::as_slice)
    .unwrap_or(&[]);

  let kept: HashSet<&str> = after
    .iter()
    .filter_map(|m| m.get("id").and_then(Value::as_str))
    .collect();

  if kind == "union" {
    let surviving_order: Vec<&str> = before
      .iter()
      .filter_map(|m| m.get("id").and_then(Value::as_str))
      .filter(|id| kept.contains(id))
      .collect();
    let requested_order: Vec<&str> = after
      .iter()
      .filter_map(|m| m.get("id").and_then(Value::as_str))
      .collect();
    let first_new = after.iter().position(|m| m.get("id").is_none());
    let inserted =
      first_new.is_some_and(|idx| after[idx + 1..].iter().any(|m| m.get("id").is_some()));
    if surviving_order != requested_order || inserted {
      if raw
        .get("fields")
        .and_then(Value::as_array)
        .is_some_and(|arr| arr.iter().any(has_nonempty_comment))
      {
        return fail_path(
          "Moving these fields would lose Ghidra comments. Move them in Ghidra instead.",
          &[PathSegment::Key("fields".into())],
        );
      }
      let remove_fields: Vec<Value> = before.iter().map(|m| field_selector(kind, m)).collect();
      let mut add_fields = Vec::with_capacity(after.len());
      for (i, member) in after.iter().enumerate() {
        let data_type = parse_type_ref(member["type"].as_str().unwrap_or("")).map_err(|e| {
          TypeEditError::at_path(
            e.to_string(),
            vec![
              PathSegment::Key("fields".into()),
              PathSegment::Index(i),
              PathSegment::Key("type".into()),
            ],
          )
        })?;
        let mut def = Map::new();
        def.insert("name".into(), member["name"].clone());
        def.insert("data_type".into(), data_type.clone());
        if let Some(len) = member.get("length").filter(|v| !v.is_null())
          && data_type.get("kind").and_then(Value::as_str) != Some("array")
        {
          def.insert("length".into(), len.clone());
        }
        add_fields.push(Value::Object(def));
      }
      let mut patch = Map::new();
      patch.insert("remove_fields".into(), Value::Array(remove_fields));
      patch.insert("add_fields".into(), Value::Array(add_fields));
      return Ok(vec![make_op(patch)]);
    }
  }

  let mut removals: Vec<Value> = Vec::new();
  let mut additions: Vec<Value> = Vec::new();
  let mut updates: Vec<Value> = Vec::new();
  let mut renames: Vec<Value> = Vec::new();

  for member in before {
    let id = member.get("id").and_then(Value::as_str).unwrap_or("");
    if !kept.contains(id) {
      removals.push(field_selector(kind, member));
    }
  }

  let raw_non_undefined = non_undefined_fields(raw);

  for (index, member) in after.iter().enumerate() {
    let mut previous = member.get("id").and_then(Value::as_str).and_then(|id| {
      before
        .iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
    });

    if let Some(prev) = previous
      && kind == "struct"
      && !same_type_data(&member["offset"], &prev["offset"])
    {
      if let Some(raw_idx) = prev
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| id.parse::<usize>().ok())
        && raw_non_undefined
          .get(raw_idx)
          .is_some_and(|src| has_nonempty_comment(src))
      {
        return fail_path(
          "Moving this field would lose its Ghidra comment. Move it in Ghidra instead.",
          &[
            PathSegment::Key("fields".into()),
            PathSegment::Index(index),
            PathSegment::Key("offset".into()),
          ],
        );
      }
      removals.push(field_selector(kind, prev));
      previous = None;
    }

    if enum_type {
      if let Some(prev) = previous {
        if member["name"] != prev["name"] {
          renames.push(json!({
            "name": prev["name"],
            "new_name": member["name"],
          }));
        }
        if !same_type_data(&member["value"], &prev["value"]) {
          updates.push(json!({
            "name": member["name"],
            "value": member["value"],
          }));
        }
      } else {
        additions.push(json!({
          "name": member["name"],
          "value": member["value"],
        }));
      }
    } else {
      let data_type = parse_type_ref(member["type"].as_str().unwrap_or("")).map_err(|e| {
        TypeEditError::at_path(
          e.to_string(),
          vec![
            PathSegment::Key("fields".into()),
            PathSegment::Index(index),
            PathSegment::Key("type".into()),
          ],
        )
      })?;
      let is_array = data_type.get("kind").and_then(Value::as_str) == Some("array");
      let member_len = member.get("length").filter(|v| !v.is_null());
      let prev_len = previous.and_then(|p| p.get("length").filter(|v| !v.is_null()));
      let include_length = if let Some(len) = member_len
        && !is_array
        && (previous.is_none()
          || previous
            .is_some_and(|p| member_len != prev_len || member.get("type") == p.get("type")))
      {
        Some(len.clone())
      } else {
        None
      };

      if let Some(prev) = previous {
        if member["name"] != prev["name"] {
          let mut entry = field_selector(kind, prev)
            .as_object()
            .cloned()
            .unwrap_or_default();
          entry.insert("new_name".into(), member["name"].clone());
          renames.push(Value::Object(entry));
        }
        if member["type"] != prev["type"] || member_len != prev_len {
          let mut entry = if kind == "struct" {
            field_selector(kind, prev)
              .as_object()
              .cloned()
              .unwrap_or_default()
          } else {
            let mut m = Map::new();
            m.insert("name".into(), member["name"].clone());
            m
          };
          entry.insert("data_type".into(), data_type);
          if let Some(len) = include_length {
            entry.insert("length".into(), len);
          }
          updates.push(Value::Object(entry));
        }
      } else {
        let mut entry = Map::new();
        entry.insert("name".into(), member["name"].clone());
        entry.insert("data_type".into(), data_type);
        if let Some(len) = include_length {
          entry.insert("length".into(), len);
        }
        if kind == "struct" {
          entry.insert("offset".into(), member["offset"].clone());
        }
        additions.push(Value::Object(entry));
      }
    }
  }

  if kind == "struct" {
    let mut changes: BTreeMap<i64, Map<String, Value>> = BTreeMap::new();
    for (prefix, entries) in [
      ("remove", removals),
      ("rename", renames),
      ("update", updates),
    ] {
      for entry in entries {
        let offset = safe_i64_from_value(entry.get("offset")).unwrap_or(0);
        let change = changes.entry(offset).or_default();
        change.insert(format!("{prefix}_fields"), Value::Array(vec![entry]));
      }
    }
    let mut operations: Vec<TypeMutation> = changes
      .into_iter()
      .rev()
      .map(|(_, patch)| make_op(patch))
      .collect();
    if !additions.is_empty() {
      additions.sort_by_key(|a| safe_i64_from_value(a.get("offset")).unwrap_or(0));
      let mut patch = Map::new();
      patch.insert("add_fields".into(), Value::Array(additions));
      operations.push(make_op(patch));
    }
    return Ok(operations);
  }

  let mut patch = Map::new();
  for (prefix, list) in [
    ("remove", removals),
    ("rename", renames),
    ("update", updates),
    ("add", additions),
  ] {
    if !list.is_empty() {
      patch.insert(format!("{prefix}_{suffix}"), Value::Array(list));
    }
  }
  if patch.is_empty() {
    Ok(vec![])
  } else {
    Ok(vec![make_op(patch)])
  }
}
