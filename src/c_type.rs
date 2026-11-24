// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! C type validation, display formatting, and structured `DataTypeReference` compilation.

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

/// Maximum UTF-8 byte length permitted for one C data-type expression.
const MAX_C_TYPE_BYTES: usize = 4_096;

/// Maximum wrapper nesting depth permitted in a structured `DataTypeReference`.
const MAX_TYPE_NESTING_DEPTH: usize = 32;

/// Finds the byte index of the closing parenthesis matching `open` in `text`.
fn find_matching_paren(text: &str, open: usize) -> Option<usize> {
  let bytes = text.as_bytes();
  if bytes.get(open) != Some(&b'(') {
    return None;
  }
  let mut depth = 0_usize;
  for (idx, &b) in bytes[open..].iter().enumerate() {
    if b == b'(' {
      depth += 1;
    } else if b == b')' {
      depth = depth.checked_sub(1)?;
      if depth == 0 {
        return Some(open + idx);
      }
    }
  }
  None
}

/// Finds the byte index of the opening parenthesis matching `close` in `text`.
fn find_matching_open_paren(text: &str, close: usize) -> Option<usize> {
  let bytes = text.as_bytes();
  if bytes.get(close) != Some(&b')') {
    return None;
  }
  let mut depth = 0_usize;
  for idx in (0..=close).rev() {
    if bytes[idx] == b')' {
      depth += 1;
    } else if bytes[idx] == b'(' {
      depth = depth.checked_sub(1)?;
      if depth == 0 {
        return Some(idx);
      }
    }
  }
  None
}

/// Checks whether a C abstract declarator suffix denotes a top-level array type.
fn is_declarator_array(declarator: &str) -> bool {
  let rest = declarator.trim_start_matches(['*', ' ', '\t']);
  if rest.starts_with('(')
    && let Some(close) = find_matching_paren(rest, 0)
  {
    let inside = rest[1..close].trim();
    if inside.starts_with(['*', '(', '[']) {
      return is_declarator_array(inside);
    }
  }
  rest.starts_with('[')
}

/// Returns true when `value` represents a top-level array data-type reference.
pub(crate) fn is_array_type_ref(value: &Value) -> bool {
  if value.get("kind").and_then(Value::as_str) == Some("array") {
    return true;
  }
  let Some(text) = value.as_str() else {
    return false;
  };
  let trimmed = text.trim();
  let Some(idx) = trimmed.find(['*', '(', '[']) else {
    return false;
  };
  is_declarator_array(&trimmed[idx..])
}

/// Parses a positive 31-bit decimal or hexadecimal array element count.
fn parse_array_count(raw_count: &str) -> Result<i64> {
  let count_str = raw_count.trim();
  let parsed = if let Some(hex) = count_str
    .strip_prefix("0x")
    .or_else(|| count_str.strip_prefix("0X"))
  {
    i64::from_str_radix(hex, 16).ok()
  } else {
    count_str.parse::<i64>().ok()
  };
  parsed
    .filter(|&n| (1..=2_147_483_647).contains(&n))
    .context("Array length must be an integer between 1 and 2147483647.")
}

/// Validates byte length, delimiter balance, and array lengths in a C type string.
fn validate_c_type_syntax(name: &str) -> Result<()> {
  ensure!(
    name.len() <= MAX_C_TYPE_BYTES,
    "Data type must not exceed 4096 UTF-8 bytes."
  );
  ensure!(
    !name.contains([';', '{', '}']),
    "Enter one C data type without braces or semicolons."
  );
  let bytes = name.as_bytes();
  let mut paren_depth = 0_usize;
  let mut idx = 0_usize;
  while idx < bytes.len() {
    match bytes[idx] {
      b'(' => {
        paren_depth += 1;
        idx += 1;
      }
      b')' => {
        ensure!(
          paren_depth > 0,
          "Parentheses in the data type are not balanced."
        );
        paren_depth -= 1;
        idx += 1;
      }
      b'[' => {
        let Some(rel_close) = name[idx + 1..].find(']') else {
          bail!("Brackets in the data type are not balanced.");
        };
        parse_array_count(&name[idx + 1..idx + 1 + rel_close])?;
        idx += rel_close + 2;
      }
      b']' => bail!("Brackets in the data type are not balanced."),
      _ => idx += 1,
    }
  }
  ensure!(
    paren_depth == 0,
    "Parentheses in the data type are not balanced."
  );
  Ok(())
}

/// Validates C type text and returns a C type string value for bridge write calls.
pub(crate) fn parse_type_ref(raw: &str) -> Result<Value> {
  let name = raw.trim();
  if name.is_empty() {
    bail!("Choose a data type.");
  }
  validate_c_type_syntax(name)?;
  Ok(Value::String(name.to_owned()))
}

/// Returns true when `token` is a C type qualifier stripped by Ghidra data types.
fn is_cvr_token(token: &str) -> bool {
  matches!(
    token,
    "const" | "volatile" | "restrict" | "__restrict" | "__restrict__" | "_Restrict"
  )
}

/// Strips leading C type qualifiers (`const`, `volatile`, `restrict`) from `text`.
fn strip_leading_cvr(mut text: &str) -> &str {
  loop {
    let trimmed = text.trim_start();
    let end = trimmed
      .bytes()
      .position(|b| !(b.is_ascii_alphanumeric() || b == b'_'))
      .unwrap_or(trimmed.len());
    if end > 0 && is_cvr_token(&trimmed[..end]) {
      text = &trimmed[end..];
    } else {
      return trimmed;
    }
  }
}

/// Splits a `/Category/Type` expression into its Ghidra path and trailing C declarator.
fn split_path_declarator(text: &str) -> (&str, &str) {
  let mut split = text.len();
  loop {
    let prefix = text[..split].trim_end();
    if prefix.is_empty() {
      break;
    }
    if prefix.ends_with(']') {
      let Some(open) = prefix.rfind('[') else {
        break;
      };
      if parse_array_count(&prefix[open + 1..prefix.len() - 1]).is_ok() {
        split = open;
        continue;
      }
      break;
    }
    if prefix.ends_with(')') {
      let Some(open) = find_matching_open_paren(prefix, prefix.len() - 1) else {
        break;
      };
      let inner = prefix[open + 1..prefix.len() - 1].trim();
      if inner.starts_with(['*', '(', '[']) {
        split = open;
        continue;
      }
      break;
    }
    if let Some(before_star) = prefix.strip_suffix('*') {
      split = before_star.len();
      continue;
    }
    let word_start = prefix
      .bytes()
      .rposition(|b| !(b.is_ascii_alphanumeric() || b == b'_'))
      .map_or(0, |idx| idx + 1);
    if word_start > 0
      && is_cvr_token(&prefix[word_start..])
      && matches!(
        prefix.as_bytes()[word_start - 1],
        b' ' | b'\t' | b'\r' | b'\n' | b'*'
      )
    {
      split = word_start;
      continue;
    }
    break;
  }
  (text[..split].trim(), text[split..].trim())
}

/// Splits a non-path C type expression into its base type specifier and declarator.
fn split_non_path_declarator(text: &str) -> (&str, &str) {
  let mut angle_depth = 0_usize;
  for (idx, ch) in text.char_indices() {
    match ch {
      '<' => angle_depth += 1,
      '>' => angle_depth = angle_depth.saturating_sub(1),
      '*' | '[' | '(' if angle_depth == 0 => {
        return (text[..idx].trim(), text[idx..].trim());
      }
      _ => {}
    }
  }
  (text.trim(), "")
}

/// Maps multi-word standard C primitive specifiers to Ghidra built-in data-type names.
fn canonical_builtin_name(specifier: &str) -> &str {
  match specifier {
    "unsigned char" => "uchar",
    "signed char" => "sbyte",
    "short int" | "signed short" | "signed short int" => "short",
    "unsigned short" | "unsigned short int" => "ushort",
    "signed" | "signed int" => "int",
    "unsigned" | "unsigned int" => "uint",
    "long int" | "signed long" | "signed long int" => "long",
    "unsigned long" | "unsigned long int" => "ulong",
    "long long" | "long long int" | "signed long long" | "signed long long int" => "longlong",
    "unsigned long long" | "unsigned long long int" => "ulonglong",
    "long double" => "longdouble",
    "_Bool" => "bool",
    other => other,
  }
}

/// Normalizes a C base specifier or `/Category/Type` path into a base `DataTypeReference`.
fn parse_base_type_ref(base_raw: &str) -> Result<Value> {
  let stripped = strip_leading_cvr(base_raw).trim();
  ensure!(!stripped.is_empty(), "Choose a data type.");
  if stripped == "pointer" {
    return Ok(json!({ "kind": "untyped_pointer" }));
  }
  if stripped.starts_with('/') {
    return Ok(json!({ "kind": "named", "name": stripped }));
  }
  let mut tokens: Vec<&str> = stripped
    .split_whitespace()
    .filter(|tok| !is_cvr_token(tok))
    .collect();
  if tokens
    .first()
    .is_some_and(|&tok| matches!(tok, "struct" | "union" | "enum"))
  {
    tokens.remove(0);
  }
  ensure!(!tokens.is_empty(), "Choose a data type.");
  let joined = tokens.join(" ");
  let canonical = canonical_builtin_name(&joined);
  if canonical == "pointer" {
    return Ok(json!({ "kind": "untyped_pointer" }));
  }
  Ok(json!({ "kind": "named", "name": canonical }))
}

/// Wraps `current` in `pointer` nodes for each leading `*` in `declarator`.
fn consume_pointer_prefix<'a>(
  mut current: Value,
  mut declarator: &'a str,
  depth: &mut usize,
) -> Result<(Value, &'a str)> {
  loop {
    declarator = declarator.trim_start();
    let Some(after_star) = declarator.strip_prefix('*') else {
      return Ok((current, declarator.trim()));
    };
    *depth += 1;
    ensure!(
      *depth <= MAX_TYPE_NESTING_DEPTH,
      "Data type exceeds the maximum nesting depth of 32."
    );
    current = json!({
      "kind": "pointer",
      "target": current,
    });
    declarator = strip_leading_cvr(after_star);
  }
}

/// Applies trailing `[N]` array dimensions (and optional legacy postfix `*`) onto `current`.
fn apply_declarator_suffixes(
  mut current: Value,
  suffix: &str,
  full_raw: &str,
  depth: &mut usize,
) -> Result<Value> {
  let mut rem = suffix.trim();
  if rem.is_empty() {
    return Ok(current);
  }
  let mut counts = Vec::new();
  while let Some(after_open) = rem.strip_prefix('[') {
    let Some(close) = after_open.find(']') else {
      bail!("Brackets in the data type are not balanced.");
    };
    counts.push(parse_array_count(&after_open[..close])?);
    rem = after_open[close + 1..].trim_start();
  }
  if counts.is_empty() {
    bail!("A newer ghidra-mcp with C type parser support is required for `{full_raw}`.");
  }
  for &count in counts.iter().rev() {
    *depth += 1;
    ensure!(
      *depth <= MAX_TYPE_NESTING_DEPTH,
      "Data type exceeds the maximum nesting depth of 32."
    );
    current = json!({
      "kind": "array",
      "element": current,
      "count": count,
    });
  }
  let tail = rem.trim();
  if tail.is_empty() {
    return Ok(current);
  }
  if tail.starts_with('*') {
    return apply_abstract_declarator(current, tail, full_raw, depth);
  }
  bail!("A newer ghidra-mcp with C type parser support is required for `{full_raw}`.")
}

/// Applies a C abstract declarator (including `(*)[N]`) onto `base` from outside in.
fn apply_abstract_declarator(
  base: Value,
  declarator: &str,
  full_raw: &str,
  depth: &mut usize,
) -> Result<Value> {
  let (mut current, rest) = consume_pointer_prefix(base, declarator, depth)?;
  if rest.is_empty() {
    return Ok(current);
  }
  if rest.starts_with('(') {
    let Some(close) = find_matching_paren(rest, 0) else {
      bail!("Parentheses in the data type are not balanced.");
    };
    let inner = rest[1..close].trim();
    let suffix = rest[close + 1..].trim();
    if !inner.starts_with(['*', '(', '[']) {
      bail!("A newer ghidra-mcp with C type parser support is required for `{full_raw}`.");
    }
    current = apply_declarator_suffixes(current, suffix, full_raw, depth)?;
    return apply_abstract_declarator(current, inner, full_raw, depth);
  }
  apply_declarator_suffixes(current, rest, full_raw, depth)
}

/// Compiles C type text into a structured `DataTypeReference` AST for legacy backends.
pub(crate) fn parse_structured_type_ref(raw: &str) -> Result<Value> {
  let name = raw.trim();
  if name.is_empty() {
    bail!("Choose a data type.");
  }
  validate_c_type_syntax(name)?;
  if name == "pointer" {
    return Ok(json!({ "kind": "untyped_pointer" }));
  }
  let without_cvr = strip_leading_cvr(name);
  let (base_raw, declarator) = if without_cvr.starts_with('/') {
    split_path_declarator(without_cvr)
  } else {
    split_non_path_declarator(without_cvr)
  };
  let base = parse_base_type_ref(base_raw)?;
  let mut depth = 0_usize;
  apply_abstract_declarator(base, declarator, name, &mut depth)
}

/// Parses `raw` as a C type string when `c_type_strings` is true, or as a structured AST.
pub(crate) fn parse_type_ref_for(raw: &str, c_type_strings: bool) -> Result<Value> {
  if c_type_strings {
    parse_type_ref(raw)
  } else {
    parse_structured_type_ref(raw)
  }
}

/// Extracts scalar text from string or number JSON values, or returns an em dash.
fn scalar_text(value: Option<&Value>) -> String {
  match value {
    Some(Value::String(s)) => s.clone(),
    Some(Value::Number(n)) => n.to_string(),
    _ => "\u{2014}".to_owned(),
  }
}

/// Formats structured `value` with accumulated inner C declarator text `inner`.
fn format_declarator(value: &Value, inner: &str) -> String {
  if let Some(s) = value.as_str() {
    if inner.is_empty() {
      return s.to_owned();
    }
    return if inner.starts_with('[') {
      format!("{s}{inner}")
    } else {
      format!("{s} {inner}")
    };
  }
  match value.get("kind").and_then(Value::as_str) {
    Some("pointer") => {
      let target = value.get("target").unwrap_or(&Value::Null);
      format_declarator(target, &format!("*{inner}"))
    }
    Some("array") => {
      let element = value.get("element").unwrap_or(&Value::Null);
      let count = scalar_text(value.get("count"));
      let next_inner = if inner.starts_with('*') {
        format!("({inner})[{count}]")
      } else {
        format!("{inner}[{count}]")
      };
      format_declarator(element, &next_inner)
    }
    kind => {
      let base = if kind == Some("untyped_pointer") {
        "pointer".to_owned()
      } else {
        scalar_text(value.get("name"))
      };
      if inner.is_empty() {
        base
      } else if inner.starts_with('[') {
        format!("{base}{inner}")
      } else {
        format!("{base} {inner}")
      }
    }
  }
}

/// Formats structured bridge data-type reference JSON back into C declaration syntax.
pub(crate) fn format_type_ref(value: &Value) -> String {
  format_declarator(value, "")
}
