// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Data-type model conversion, conflict equality checks, and JSONC rendering.

use std::collections::HashSet;

use serde_json::{Map, Value, json};

use super::{MAX_SAFE_INTEGER, MIN_SAFE_INTEGER};
use crate::address::format_type_ref;

/// Extracts a lossless JSON integer from `value` inside the IEEE-754 safe range.
pub(super) fn safe_i64_from_value(value: Option<&Value>) -> Option<i64> {
  let num = value?.as_number()?;
  if let Some(i) = num.as_i64() {
    return (MIN_SAFE_INTEGER..=MAX_SAFE_INTEGER)
      .contains(&i)
      .then_some(i);
  }
  if let Some(u) = num.as_u64() {
    return (u <= MAX_SAFE_INTEGER as u64).then_some(u as i64);
  }
  if let Some(f) = num.as_f64()
    && f.is_finite()
    && f.fract() == 0.0
    && f >= MIN_SAFE_INTEGER as f64
    && f <= MAX_SAFE_INTEGER as f64
  {
    return Some(f as i64);
  }
  None
}

/// Compares two JSON numbers with safe-integer normalization.
fn numbers_equal(a: &serde_json::Number, b: &serde_json::Number) -> bool {
  if a == b {
    return true;
  }
  match (
    safe_i64_from_value(Some(&Value::Number(a.clone()))),
    safe_i64_from_value(Some(&Value::Number(b.clone()))),
  ) {
    (Some(x), Some(y)) => x == y,
    _ => a.as_f64().zip(b.as_f64()).is_some_and(|(x, y)| x == y),
  }
}

/// Compares two Ghidra data-type JSON snapshots structurally.
pub(super) fn same_type_data(a: &Value, b: &Value) -> bool {
  match (a, b) {
    (Value::Array(left), Value::Array(right)) => {
      left.len() == right.len()
        && left
          .iter()
          .zip(right.iter())
          .all(|(l, r)| same_type_data(l, r))
    }
    (Value::Object(left), Value::Object(right)) => {
      left.len() == right.len()
        && left
          .iter()
          .all(|(k, v)| right.get(k).is_some_and(|rv| same_type_data(v, rv)))
    }
    (Value::Number(left), Value::Number(right)) => numbers_equal(left, right),
    _ => a == b,
  }
}

/// Normalizes raw Ghidra data-type kind names to editable model kinds.
fn kind_of(data: &Value) -> &str {
  match data.get("kind").and_then(Value::as_str).unwrap_or("") {
    "structure" => "struct",
    "function_definition" => "function",
    other => other,
  }
}

/// Checks whether a Ghidra type name ends with a bit-field width suffix.
fn has_bitfield_suffix(name: &str) -> bool {
  let Some((_, suffix)) = name.rsplit_once(':') else {
    return false;
  };
  !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit())
}

/// Returns all field entries in `data` except Ghidra padding undefined bytes.
pub(super) fn non_undefined_fields(data: &Value) -> Vec<&Value> {
  data
    .get("fields")
    .and_then(Value::as_array)
    .map(|arr| {
      arr
        .iter()
        .filter(|f| f.get("is_undefined").and_then(Value::as_bool) != Some(true))
        .collect()
    })
    .unwrap_or_default()
}

/// Returns the reason why `data` is read-only in the virtual editor, or `None` if editable.
pub(super) fn readonly_type_reason(data: &Value) -> Option<&'static str> {
  let kind = kind_of(data);
  if !matches!(kind, "struct" | "union" | "enum" | "function") {
    return Some("This kind of data type is read-only in the Ghidra bridge.");
  }
  if kind == "function"
    && data
      .get("signature")
      .and_then(Value::as_object)
      .is_none_or(Map::is_empty)
  {
    return Some("The backend does not expose a structured function signature.");
  }
  if kind == "enum"
    && data
      .get("values")
      .and_then(Value::as_array)
      .is_some_and(|vals| {
        vals
          .iter()
          .any(|v| safe_i64_from_value(v.get("value")).is_none())
      })
  {
    return Some(
      "This enum contains integers outside the lossless JSON number range. Edit it in Ghidra.",
    );
  }

  let fields = non_undefined_fields(data);
  let bad_field = fields.iter().any(|field| {
    let non_positive_len = field
      .get("length")
      .and_then(Value::as_f64)
      .is_some_and(|n| n <= 0.0);
    let bitfield = field
      .pointer("/data_type/name")
      .and_then(Value::as_str)
      .is_some_and(has_bitfield_suffix);
    non_positive_len || bitfield
  });
  let duplicate_offsets = if kind == "struct" {
    let mut seen = HashSet::new();
    fields.iter().any(|f| {
      let key = f
        .get("offset")
        .map(|v| serde_json::to_string(v).unwrap_or_default())
        .unwrap_or_else(|| "undefined".into());
      !seen.insert(key)
    })
  } else {
    false
  };
  if bad_field || duplicate_offsets {
    return Some(
      "This layout contains zero-length or overlapping/bit fields that the bridge cannot safely edit.",
    );
  }

  let anonymous_count = fields
    .iter()
    .filter(|f| {
      f.get("name")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    })
    .count();
  let max_anon = if kind == "union" { 0 } else { 1 };
  if anonymous_count > max_anon {
    return Some("Name the anonymous members in Ghidra before editing this layout.");
  }

  None
}

/// Converts raw Ghidra `data_type.get` JSON into the editable `TypeModel` snapshot.
pub(super) fn type_model(data: &Value) -> Value {
  let kind = kind_of(data);
  let path = data
    .get("path")
    .and_then(Value::as_str)
    .unwrap_or("undefined");
  let mut result = Map::new();
  result.insert("path".into(), json!(path));
  result.insert("kind".into(), json!(kind));

  if kind == "struct" || kind == "union" {
    let fields: Vec<Value> = non_undefined_fields(data)
      .into_iter()
      .enumerate()
      .map(|(index, field)| {
        let mut m = Map::new();
        m.insert("id".into(), json!(index.to_string()));
        if kind == "struct" {
          m.insert(
            "offset".into(),
            field.get("offset").cloned().unwrap_or(Value::Null),
          );
        }
        m.insert(
          "name".into(),
          json!(field.get("name").and_then(Value::as_str).unwrap_or("")),
        );
        let dt = field.get("data_type").unwrap_or(&Value::Null);
        m.insert("type".into(), json!(format_type_ref(dt)));
        if dt.get("kind").and_then(Value::as_str) != Some("array")
          && let Some(len) = field.get("length").filter(|v| !v.is_null())
        {
          m.insert("length".into(), len.clone());
        }
        Value::Object(m)
      })
      .collect();
    result.insert("fields".into(), Value::Array(fields));
  } else if kind == "enum" {
    let values: Vec<Value> = data
      .get("values")
      .and_then(Value::as_array)
      .map(|arr| {
        arr
          .iter()
          .enumerate()
          .map(|(index, val)| {
            json!({
              "id": index.to_string(),
              "name": val.get("name").cloned().unwrap_or(Value::Null),
              "value": val.get("value").cloned().unwrap_or(Value::Null),
            })
          })
          .collect()
      })
      .unwrap_or_default();
    result.insert("values".into(), Value::Array(values));
  } else if kind == "function" {
    let sig = data.get("signature").unwrap_or(&Value::Null);
    let params: Vec<Value> = sig
      .get("parameters")
      .and_then(Value::as_array)
      .map(|arr| {
        arr
          .iter()
          .map(|p| {
            json!({
              "name": p.get("name").and_then(Value::as_str).unwrap_or(""),
              "type": format_type_ref(p.get("data_type").unwrap_or(&Value::Null)),
            })
          })
          .collect()
      })
      .unwrap_or_default();
    let cc = sig
      .get("calling_convention")
      .and_then(Value::as_str)
      .filter(|s| !s.is_empty())
      .unwrap_or("default");
    result.insert(
      "signature".into(),
      json!({
        "return_type": format_type_ref(sig.get("return_type").unwrap_or(&Value::Null)),
        "calling_convention": cc,
        "has_var_args": sig.get("has_var_args").and_then(Value::as_bool) == Some(true),
        "has_no_return": sig.get("has_no_return").and_then(Value::as_bool) == Some(true),
        "parameters": params,
      }),
    );
  }

  Value::Object(result)
}

/// Replaces line breaks in comment banner text with spaces.
fn sanitize_comment_line(value: &str) -> String {
  value
    .chars()
    .map(|c| match c {
      '\r' | '\n' | '\u{2028}' | '\u{2029}' => ' ',
      _ => c,
    })
    .collect()
}

/// Serializes one JSON value as compact JSON text.
fn json_str(v: &Value) -> String {
  serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

/// Formats `model` with deterministic property order for the `.ghidra-type` buffer.
fn format_model_in_canonical_order(model: &Value) -> String {
  let path = json_str(&model["path"]);
  let kind_val = model.get("kind").and_then(Value::as_str).unwrap_or("");
  let kind = json_str(&model["kind"]);
  let mut out = format!("{{\n  \"path\": {path},\n  \"kind\": {kind}");

  if kind_val == "struct" || kind_val == "union" {
    let fields = model
      .get("fields")
      .and_then(Value::as_array)
      .map(Vec::as_slice)
      .unwrap_or(&[]);
    if fields.is_empty() {
      out.push_str(",\n  \"fields\": []\n}");
      return out;
    }
    out.push_str(",\n  \"fields\": [\n");
    for (i, field) in fields.iter().enumerate() {
      out.push_str("    {\n");
      let mut entries = vec![("id", json_str(&field["id"]))];
      if kind_val == "struct" {
        entries.push(("offset", json_str(&field["offset"])));
      }
      entries.push(("name", json_str(&field["name"])));
      entries.push(("type", json_str(&field["type"])));
      if let Some(len) = field.get("length") {
        entries.push(("length", json_str(len)));
      }
      for (j, (k, v)) in entries.iter().enumerate() {
        out.push_str(&format!("      \"{k}\": {v}"));
        if j + 1 < entries.len() {
          out.push(',');
        }
        out.push('\n');
      }
      out.push_str("    }");
      if i + 1 < fields.len() {
        out.push(',');
      }
      out.push('\n');
    }
    out.push_str("  ]\n}");
    return out;
  }

  if kind_val == "enum" {
    let values = model
      .get("values")
      .and_then(Value::as_array)
      .map(Vec::as_slice)
      .unwrap_or(&[]);
    if values.is_empty() {
      out.push_str(",\n  \"values\": []\n}");
      return out;
    }
    out.push_str(",\n  \"values\": [\n");
    for (i, val) in values.iter().enumerate() {
      out.push_str("    {\n");
      out.push_str(&format!("      \"id\": {},\n", json_str(&val["id"])));
      out.push_str(&format!("      \"name\": {},\n", json_str(&val["name"])));
      out.push_str(&format!("      \"value\": {}\n", json_str(&val["value"])));
      out.push_str("    }");
      if i + 1 < values.len() {
        out.push(',');
      }
      out.push('\n');
    }
    out.push_str("  ]\n}");
    return out;
  }

  if kind_val == "function" {
    let sig = &model["signature"];
    out.push_str(",\n  \"signature\": {\n");
    out.push_str(&format!(
      "    \"return_type\": {},\n",
      json_str(&sig["return_type"])
    ));
    out.push_str(&format!(
      "    \"calling_convention\": {},\n",
      json_str(&sig["calling_convention"])
    ));
    out.push_str(&format!(
      "    \"has_var_args\": {},\n",
      json_str(&sig["has_var_args"])
    ));
    out.push_str(&format!(
      "    \"has_no_return\": {},\n",
      json_str(&sig["has_no_return"])
    ));
    let params = sig
      .get("parameters")
      .and_then(Value::as_array)
      .map(Vec::as_slice)
      .unwrap_or(&[]);
    if params.is_empty() {
      out.push_str("    \"parameters\": []\n  }\n}");
      return out;
    }
    out.push_str("    \"parameters\": [\n");
    for (i, param) in params.iter().enumerate() {
      out.push_str("      {\n");
      out.push_str(&format!(
        "        \"name\": {},\n",
        json_str(&param["name"])
      ));
      out.push_str(&format!("        \"type\": {}\n", json_str(&param["type"])));
      out.push_str("      }");
      if i + 1 < params.len() {
        out.push(',');
      }
      out.push('\n');
    }
    out.push_str("    ]\n  }\n}");
    return out;
  }

  out.push_str("\n}");
  out
}

/// Renders a Ghidra data type as an annotated JSONC document.
pub(super) fn render_type_jsonc(data: &Value, program: &str) -> String {
  let reason = readonly_type_reason(data);
  let path_str = data.get("path").and_then(Value::as_str).unwrap_or("");
  let raw_kind = data.get("kind").and_then(Value::as_str).unwrap_or("");
  let mut out = format!(
    "// {} \u{00b7} {}\n",
    sanitize_comment_line(program),
    sanitize_comment_line(path_str)
  );
  if let Some(reason) = reason {
    out.push_str(&format!("// Read-only: {reason}\n"));
    out.push_str(&serde_json::to_string_pretty(data).unwrap_or_else(|_| "{}".to_owned()));
  } else {
    out.push_str(
      "// Save to update the Ghidra project. VS Code Auto Save also saves this document.\n",
    );
    out.push_str(
      "// Keep existing ids; omit id for new members. path and kind identify this type.\n",
    );
    if matches!(raw_kind, "struct" | "structure") {
      out.push_str(
        "// Insert/remove follows Ghidra layout rules; saved offsets are read back from Ghidra.\n",
      );
    }
    out.push_str(
      "// Types: \"int\", \"/category/Type\", \"char *\", \"int[4]\". Omit length to use the natural size.\n",
    );
    let model = type_model(data);
    out.push_str(&format_model_in_canonical_order(&model));
  }
  out.push('\n');
  out
}
