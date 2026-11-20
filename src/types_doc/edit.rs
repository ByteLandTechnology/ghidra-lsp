// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! UTF-16 range calculation, targeted JSONC edits, and save reconciliation.

use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;
use tower_lsp_server::ls_types::Range;

use super::PathSegment;
use super::jsonc::{JsoncKind, JsoncNode, find_node_at_path, parse_jsonc_ast};
use super::model::{same_type_data, type_model};
use crate::document::position;

/// Converts a byte `(offset, length)` span into an LSP UTF-16 `Range`.
pub(super) fn utf16_range(text: &str, offset: usize, length: usize) -> Range {
  let start = offset.min(text.len());
  let start = (0..=start)
    .rev()
    .find(|&b| text.is_char_boundary(b))
    .unwrap_or(0);
  let len = if length > 0 {
    length
  } else if start < text.len() {
    text[start..]
      .chars()
      .next()
      .map(char::len_utf8)
      .unwrap_or(1)
  } else {
    0
  };
  let end = start.saturating_add(len).min(text.len());
  Range::new(position(text, start), position(text, end))
}

/// Returns the leading horizontal whitespace slice on the line containing `byte_offset`.
fn line_indent_at(text: &str, byte_offset: usize) -> &str {
  let clamped = byte_offset.min(text.len());
  let line_start = text[..clamped].rfind('\n').map(|i| i + 1).unwrap_or(0);
  let rest = &text[line_start..clamped];
  let len = rest
    .bytes()
    .take_while(|&b| b == b' ' || b == b'\t')
    .count();
  &rest[..len]
}

/// Formats `value` as JSON aligned to `base_indent` and nesting `depth`.
fn format_json_value_indented(value: &Value, base_indent: &str, depth: usize) -> String {
  match value {
    Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
      serde_json::to_string(value).unwrap_or_else(|_| "null".into())
    }
    Value::Array(items) => {
      if items.is_empty() {
        return "[]".into();
      }
      let inner_indent = format!("{base_indent}{}", "  ".repeat(depth + 1));
      let closing_indent = format!("{base_indent}{}", "  ".repeat(depth));
      let mut out = String::from("[\n");
      for (i, item) in items.iter().enumerate() {
        out.push_str(&inner_indent);
        out.push_str(&format_json_value_indented(item, base_indent, depth + 1));
        if i + 1 < items.len() {
          out.push(',');
        }
        out.push('\n');
      }
      out.push_str(&closing_indent);
      out.push(']');
      out
    }
    Value::Object(map) => {
      if map.is_empty() {
        return "{}".into();
      }
      let inner_indent = format!("{base_indent}{}", "  ".repeat(depth + 1));
      let closing_indent = format!("{base_indent}{}", "  ".repeat(depth));
      let mut out = String::from("{\n");
      for (i, (k, v)) in map.iter().enumerate() {
        out.push_str(&inner_indent);
        out.push_str(&serde_json::to_string(k).unwrap_or_else(|_| "\"\"".into()));
        out.push_str(": ");
        out.push_str(&format_json_value_indented(v, base_indent, depth + 1));
        if i + 1 < map.len() {
          out.push(',');
        }
        out.push('\n');
      }
      out.push_str(&closing_indent);
      out.push('}');
      out
    }
  }
}

/// Finds the first `,` byte offset in `slice` outside JSONC comments.
fn find_comma_outside_comments(slice: &str) -> Option<usize> {
  let bytes = slice.as_bytes();
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'/' && i + 1 < bytes.len() {
      if bytes[i + 1] == b'/' {
        i += 2;
        while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' {
          i += 1;
        }
        continue;
      }
      if bytes[i + 1] == b'*' {
        i += 2;
        while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
          i += 1;
        }
        i = (i + 2).min(bytes.len());
        continue;
      }
    }
    if bytes[i] == b',' {
      return Some(i);
    }
    i += 1;
  }
  None
}

/// Returns the full line span when `[start..end]` occupies one line by itself.
fn alone_line_span(text: &str, start: usize, end: usize) -> Option<(usize, usize)> {
  let line_start = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
  if !text[line_start..start]
    .bytes()
    .all(|b| b == b' ' || b == b'\t')
  {
    return None;
  }
  let bytes = text.as_bytes();
  let mut i = end;
  while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
    i += 1;
  }
  if i == bytes.len() {
    return Some((line_start, i));
  }
  if bytes[i] == b'\r' && i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
    return Some((line_start, i + 2));
  }
  if bytes[i] == b'\n' {
    return Some((line_start, i + 1));
  }
  None
}

/// Finds the byte offset of the line break at or after `offset`.
fn end_of_line_before_eol(text: &str, offset: usize) -> usize {
  let bytes = text.as_bytes();
  let mut i = offset.min(bytes.len());
  while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' {
    i += 1;
  }
  i
}

/// Updates, inserts, or removes a JSONC node at `path` while keeping nearby comments.
fn modify_jsonc_at_path(text: &str, path: &[PathSegment], value: Option<&Value>) -> Result<String> {
  let root = parse_jsonc_ast(text)
    .map_err(|e| anyhow::anyhow!("{}", e.message))?
    .context("Enter a data type definition.")?;

  if path.is_empty() {
    return match value {
      Some(v) => Ok(format_json_value_indented(v, "", 0)),
      None => Ok(String::new()),
    };
  }

  let (parent_path, last) = path.split_at(path.len() - 1);
  let parent = find_node_at_path(&root, parent_path)
    .with_context(|| "Target path does not exist in JSONC document".to_owned())?;

  match (&parent.kind, &last[0]) {
    (JsoncKind::Object(props), PathSegment::Key(key)) => {
      if let Some(idx) = props.iter().position(|p| p.key == *key) {
        let prop = &props[idx];
        if let Some(val) = value {
          let indent = line_indent_at(text, prop.key_offset);
          let formatted = format_json_value_indented(val, indent, 0);
          let mut out = text.to_owned();
          out.replace_range(
            prop.value.offset..prop.value.offset + prop.value.length,
            &formatted,
          );
          return Ok(out);
        }

        let val_end = prop.value.offset + prop.value.length;
        let obj_end_inner = parent.offset + parent.length - 1;
        let mut out = text.to_owned();

        if idx + 1 < props.len() {
          let next_key = props[idx + 1].key_offset;
          let comma_rel = find_comma_outside_comments(&text[val_end..next_key])
            .context("Missing comma after object property")?;
          let comma_end = val_end + comma_rel + 1;
          if let Some((ls, le)) = alone_line_span(text, prop.key_offset, comma_end) {
            out.replace_range(ls..le, "");
          } else {
            let mut del_end = comma_end;
            while del_end < next_key && matches!(text.as_bytes()[del_end], b' ' | b'\t') {
              del_end += 1;
            }
            out.replace_range(prop.key_offset..del_end, "");
          }
          return Ok(out);
        }

        let trailing_comma_end = find_comma_outside_comments(&text[val_end..obj_end_inner])
          .map(|rel| val_end + rel + 1)
          .unwrap_or(val_end);

        if idx > 0 {
          let prev_end = props[idx - 1].value.offset + props[idx - 1].value.length;
          let comma_rel = find_comma_outside_comments(&text[prev_end..prop.key_offset])
            .context("Missing comma before object property")?;
          let prev_comma = prev_end + comma_rel;

          if let Some((ls, le)) = alone_line_span(text, prop.key_offset, trailing_comma_end) {
            out.replace_range(ls..le, "");
            out.replace_range(prev_comma..prev_comma + 1, "");
          } else if text[prev_comma + 1..prop.key_offset]
            .bytes()
            .all(|b| b == b' ' || b == b'\t')
          {
            out.replace_range(prev_comma..trailing_comma_end, "");
          } else {
            out.replace_range(prop.key_offset..trailing_comma_end, "");
            out.replace_range(prev_comma..prev_comma + 1, "");
          }
          return Ok(out);
        }

        if let Some((ls, le)) = alone_line_span(text, prop.key_offset, trailing_comma_end) {
          out.replace_range(ls..le, "");
        } else {
          out.replace_range(prop.key_offset..trailing_comma_end, "");
        }
        Ok(out)
      } else {
        let Some(val) = value else {
          return Ok(text.to_owned());
        };
        let key_json = serde_json::to_string(key)?;
        let obj_slice = &text[parent.offset..parent.offset + parent.length];
        let is_multiline = obj_slice.contains('\n');
        let mut out = text.to_owned();

        let Some(last_prop) = props.last() else {
          let parent_indent = line_indent_at(text, parent.offset);
          let child_indent = format!("{parent_indent}  ");
          let val_json = format_json_value_indented(val, &child_indent, 0);
          if is_multiline {
            out.insert_str(
              parent.offset + 1,
              &format!("\n{child_indent}{key_json}: {val_json}"),
            );
          } else {
            out.replace_range(
              parent.offset..parent.offset + parent.length,
              &format!("{{\n{child_indent}{key_json}: {val_json}\n{parent_indent}}}"),
            );
          }
          return Ok(out);
        };

        let last_end = last_prop.value.offset + last_prop.value.length;
        let obj_close = parent.offset + parent.length - 1;
        let existing_comma =
          find_comma_outside_comments(&text[last_end..obj_close]).map(|rel| last_end + rel);
        let child_indent = line_indent_at(text, props[0].key_offset);
        let val_json = format_json_value_indented(val, child_indent, 0);

        if is_multiline {
          let anchor = existing_comma.map(|c| c + 1).unwrap_or(last_end);
          let eol_pos = end_of_line_before_eol(text, anchor).min(obj_close);
          out.insert_str(eol_pos, &format!("\n{child_indent}{key_json}: {val_json}"));
          if existing_comma.is_none() {
            out.insert(last_end, ',');
          }
        } else if let Some(comma_pos) = existing_comma {
          out.insert_str(comma_pos + 1, &format!(" {key_json}: {val_json}"));
        } else {
          out.insert_str(last_end, &format!(", {key_json}: {val_json}"));
        }
        Ok(out)
      }
    }
    (JsoncKind::Array(items), PathSegment::Index(idx)) => {
      let item = items
        .get(*idx)
        .with_context(|| format!("Array index {idx} out of bounds"))?;
      let Some(val) = value else {
        bail!("Removing array elements by path is not supported");
      };
      let indent = line_indent_at(text, item.offset);
      let formatted = format_json_value_indented(val, indent, 0);
      let mut out = text.to_owned();
      out.replace_range(item.offset..item.offset + item.length, &formatted);
      Ok(out)
    }
    _ => bail!("Target path parent does not match segment kind"),
  }
}

/// Keeps JSONC comments and formatting while updating only values normalized by Ghidra.
pub(super) fn reconcile_type_text(text: &str, draft: &Value, actual: &Value) -> Result<String> {
  let current = type_model(actual);
  let mut text = text.to_owned();

  let apply_change =
    |doc: &mut String, path: &[PathSegment], value: Option<&Value>| -> Result<()> {
      let tree = parse_jsonc_ast(doc).map_err(|e| anyhow::anyhow!("{}", e.message))?;
      let existing = tree
        .as_ref()
        .and_then(|root| find_node_at_path(root, path))
        .map(JsoncNode::to_value);
      let unchanged = match (existing.as_ref(), value) {
        (None, None) => true,
        (Some(a), Some(b)) => same_type_data(a, b),
        _ => false,
      };
      if unchanged {
        return Ok(());
      }
      *doc = modify_jsonc_at_path(doc, path, value)?;
      Ok(())
    };

  if draft.get("kind").and_then(Value::as_str) == Some("function") {
    let cur_sig = current
      .get("signature")
      .and_then(Value::as_object)
      .context("Actual type lacks signature")?;
    let draft_params_len = draft
      .pointer("/signature/parameters")
      .and_then(Value::as_array)
      .map(Vec::len)
      .unwrap_or(0);
    let cur_params_len = cur_sig
      .get("parameters")
      .and_then(Value::as_array)
      .map(Vec::len)
      .unwrap_or(0);
    ensure!(
      cur_params_len == draft_params_len,
      "The saved parameter list changed in Ghidra. Reload the type before editing again."
    );
    for (key, value) in cur_sig {
      if key == "parameters" {
        if let Some(params) = value.as_array() {
          for (i, param) in params.iter().enumerate() {
            if let Some(p_map) = param.as_object() {
              for (pk, pv) in p_map {
                apply_change(
                  &mut text,
                  &[
                    PathSegment::Key("signature".into()),
                    PathSegment::Key("parameters".into()),
                    PathSegment::Index(i),
                    PathSegment::Key(pk.clone()),
                  ],
                  Some(pv),
                )?;
              }
            }
          }
        }
      } else {
        apply_change(
          &mut text,
          &[
            PathSegment::Key("signature".into()),
            PathSegment::Key(key.clone()),
          ],
          Some(value),
        )?;
      }
    }
  } else {
    let key = if draft.get("kind").and_then(Value::as_str) == Some("enum") {
      "values"
    } else {
      "fields"
    };
    let mut remaining = current
      .get(key)
      .and_then(Value::as_array)
      .cloned()
      .unwrap_or_default();
    let draft_members = draft
      .get(key)
      .and_then(Value::as_array)
      .map(Vec::as_slice)
      .unwrap_or(&[]);

    for (i, member) in draft_members.iter().enumerate() {
      let Some(pos) = remaining
        .iter()
        .position(|actual_member| actual_member.get("name") == member.get("name"))
      else {
        bail!(
          "Saved members could not be matched to the Ghidra layout. Reload the type before editing again."
        );
      };
      let actual_member = remaining.remove(pos);
      let mut props = Vec::new();
      if let Some(m) = member.as_object() {
        for k in m.keys() {
          props.push(k.clone());
        }
      }
      if let Some(m) = actual_member.as_object() {
        for k in m.keys() {
          if !props.contains(k) {
            props.push(k.clone());
          }
        }
      }
      for prop in props {
        apply_change(
          &mut text,
          &[
            PathSegment::Key(key.into()),
            PathSegment::Index(i),
            PathSegment::Key(prop.clone()),
          ],
          actual_member.get(&prop),
        )?;
      }
    }
    ensure!(
      remaining.is_empty(),
      "The saved layout contains unexpected members. Reload the type before editing again."
    );
  }

  Ok(text)
}
