// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Virtual document state, token alignment, symbol resolution, and UTF-16 positions.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{Position, Range, TextEdit, Uri};

/// Display flag that controls whether full C++ template arguments appear in text.
pub(crate) static SHOW_TEMPLATE_ARGUMENTS: AtomicBool = AtomicBool::new(false);

/// Replaces outer C++ template argument lists with `<…>` while keeping operators unchanged.
pub(crate) fn brief_templates(name: &str) -> String {
  let chars: Vec<char> = name.chars().collect();
  let mut out = String::with_capacity(name.len());
  let mut depth = 0usize;
  let mut i = 0;
  while i < chars.len() {
    if depth == 0 && name_has_operator_at(&chars, i) {
      // Copy `operator` and its symbol verbatim.
      out.extend(&chars[i..i + 8]);
      i += 8;
      while i < chars.len() && chars[i] == ' ' {
        out.push(' ');
        i += 1;
      }
      let rest: String = chars[i..].iter().collect();
      for symbol in [
        "<<=", ">>=", "<=>", "<<", ">>", "<=", ">=", "->*", "->", "<", ">",
      ] {
        if rest.starts_with(symbol) {
          out.push_str(symbol);
          i += symbol.chars().count();
          break;
        }
      }
      continue;
    }
    match chars[i] {
      // Only `Name<` opens template arguments; namespaces such as `<EXTERNAL>` stay intact.
      '<'
        if depth > 0
          || (i > 0
            && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '_' || chars[i - 1] == '>')) =>
      {
        if depth == 0 {
          out.push_str("<…>");
        }
        depth += 1;
      }
      '>' if depth > 0 => depth -= 1,
      ch if depth == 0 => out.push(ch),
      _ => {}
    }
    i += 1;
  }
  if depth > 0 { name.to_owned() } else { out }
}

/// Returns true when `chars` starts an `operator` token at index `i`.
fn name_has_operator_at(chars: &[char], i: usize) -> bool {
  chars.len() >= i + 8
    && chars[i..i + 8].iter().collect::<String>() == "operator"
    && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_'))
}

/// Program symbol metadata returned by `ghidra-mcp` or inferred for local items.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct Symbol {
  /// Stable symbol identifier from `ghidra-mcp` or a synthetic local identifier.
  pub(crate) id: String,
  /// Short symbol name without namespace prefix.
  #[serde(default)]
  pub(crate) name: String,
  /// Optional demangled C++ name when available.
  #[serde(default)]
  pub(crate) demangled_name: Option<String>,
  /// Canonical symbol address string.
  #[serde(default)]
  pub(crate) address: String,
  /// Enclosing Ghidra namespace path.
  #[serde(default)]
  pub(crate) namespace: String,
  /// Symbol category name (`Function`, `Label`, `Global`, `Local`, `Parameter`, or `Constant`).
  #[serde(default, rename = "type")]
  pub(crate) kind: String,
}

impl Symbol {
  /// Returns the display name with template arguments elided unless enabled.
  pub(crate) fn display_name(&self) -> String {
    let full = self.full_name();
    if SHOW_TEMPLATE_ARGUMENTS.load(Ordering::Relaxed) {
      full
    } else {
      brief_templates(&full)
    }
  }

  /// Returns the full demangled or namespace-qualified name for matching and tooltips.
  pub(crate) fn full_name(&self) -> String {
    self
      .demangled_name
      .as_ref()
      .filter(|name| !name.is_empty())
      .cloned()
      .unwrap_or_else(|| self.qualified())
  }

  /// Returns true when this symbol can bind to a decompiled token.
  pub(crate) fn eligible(&self) -> bool {
    self.kind.eq_ignore_ascii_case("function")
      || self.kind.eq_ignore_ascii_case("label")
      || self.kind.eq_ignore_ascii_case("constant")
      || self.kind.eq_ignore_ascii_case("global")
  }

  /// Returns true when this symbol represents a function-local variable or parameter.
  pub(crate) fn local(&self) -> bool {
    matches!(
      self.kind.as_str(),
      "Local" | "Local Var" | "LocalVar" | "Parameter"
    )
  }

  /// Returns the name prefixed with its namespace when it is not in `Global`.
  pub(crate) fn qualified(&self) -> String {
    if self.namespace.is_empty() || self.namespace == "Global" {
      self.name.clone()
    } else {
      format!("{}::{}", self.namespace, self.name)
    }
  }
}

/// Indexed session symbol lookup tables and match helpers.
mod index;

pub(crate) use index::{SymbolIndex, contains_case_insensitive, starts_with_case_insensitive};

/// Raw decompiler token returned by `ghidra-mcp`.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Token {
  /// Decompiler token class (`function`, `variable`, `parameter`, `comment`, or `constant`).
  pub(crate) kind: String,
  /// Source text slice shown in the virtual C buffer.
  pub(crate) text: String,
  /// Optional address associated with this token.
  pub(crate) address: Option<String>,
}

/// Byte-range token alignment entry inside a virtual decompilation document.
#[derive(Clone, Debug)]
pub(crate) struct Span {
  /// Inclusive UTF-8 start byte offset in `Document::base`.
  pub(crate) start: usize,
  /// Exclusive UTF-8 end byte offset in `Document::base`.
  pub(crate) end: usize,
  /// Underlying decompiler token metadata.
  pub(crate) token: Token,
  /// Resolved symbol target when known.
  pub(crate) symbol: Option<Symbol>,
  /// Native GUI cursor and address mapping metadata when provided by `ghidra-mcp`.
  pub(crate) location: Option<CodeLocation>,
}

/// Native Ghidra GUI location metadata mapped to a token span.
#[derive(Clone, Debug)]
pub(crate) struct CodeLocation {
  /// Primary address attached to this GUI location.
  pub(crate) address: String,
  /// Start address of the enclosing instruction or data unit when available.
  pub(crate) code_unit_address: Option<String>,
  /// Highest instruction address covered by the GUI token when available.
  pub(crate) token_max_address: Option<String>,
  /// True when the token carries an exact address instead of an inferred line location.
  pub(crate) exact: bool,
}

/// One-line UTF-16 token span record from `ghidra.location` snapshot mode.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct LocationSpan<'a> {
  /// Zero-based line number in `Document::base`.
  pub(crate) line: u32,
  /// Inclusive UTF-16 start column on `line`.
  pub(crate) start: u32,
  /// Exclusive UTF-16 end column on `line`.
  pub(crate) end: u32,
  /// The `code_unit_address`, or `address` when `code_unit_address` is absent or empty.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(crate) address: Option<&'a str>,
}

/// In-memory state of an opened `ghidra://` virtual document.
#[derive(Clone, Debug)]
pub(crate) struct Document {
  /// Canonical `ghidra://` URI identifying this buffer.
  pub(crate) uri: Uri,
  /// Lowercase 32-character MD5 session hash owning this document.
  pub(crate) md5: String,
  /// Canonical function entry address when this document shows a function.
  pub(crate) entry: Option<String>,
  /// Last fetched clean decompilation or snapshot text.
  pub(crate) base: String,
  /// Current editor buffer contents reported through LSP synchronization.
  pub(crate) current: String,
  /// Last text persisted through a controlled save operation.
  pub(crate) saved: String,
  /// Latest LSP document version reported by the client.
  pub(crate) version: Option<i32>,
  /// Ordered token spans aligned to `base`.
  pub(crate) spans: Vec<Span>,
  /// Optional warning published as a document diagnostic.
  pub(crate) warning: Option<String>,
}

impl Document {
  /// Returns true when the client buffer matches the clean `base` text.
  pub(crate) fn clean(&self) -> bool {
    self.current == self.base
  }

  /// Finds the token span containing `pos` when the buffer is clean.
  pub(crate) fn span_at(&self, pos: Position) -> Option<&Span> {
    if self.current != self.base {
      return None;
    }
    let offset = offset(&self.base, pos)?;
    self
      .spans
      .iter()
      .find(|s| s.start <= offset && offset < s.end)
  }

  /// Converts the byte span of `span` into an LSP UTF-16 `Range`.
  pub(crate) fn range(&self, span: &Span) -> Range {
    Range::new(
      position(&self.base, span.start),
      position(&self.base, span.end),
    )
  }

  /// Returns the UTF-8 byte offset of the opening `{` of the function body.
  pub(crate) fn body_start(&self) -> usize {
    self
      .spans
      .iter()
      .find(|span| span.token.kind != "comment" && span.token.text == "{")
      .map_or(self.base.len(), |span| span.start)
  }

  /// Maps an LSP cursor position on a clean document to its native GUI [`CodeLocation`].
  pub(crate) fn code_location(&self, pos: Position) -> Result<Option<&CodeLocation>> {
    anyhow::ensure!(
      self.clean(),
      "Save or discard the pending edit before mapping a code selection"
    );
    let byte = offset(&self.base, pos).context("position is outside the document")?;
    anyhow::ensure!(
      self.spans.iter().any(|s| s.location.is_some()),
      "Upgrade ghidra-mcp for GUI cursor locations; this document has no native layout"
    );
    let start = self.base[..byte].rfind('\n').map_or(0, |index| index + 1);
    let end = self.base[byte..]
      .find('\n')
      .map_or(self.base.len(), |index| byte + index);
    let first = self.spans.partition_point(|span| span.start < start);
    let mut line = self.spans[first..]
      .iter()
      .take_while(|span| span.start <= end)
      .filter(|span| span.location.is_some())
      .peekable();
    // The GUI selects the first token in indentation and the last token at end of line.
    while let Some(span) = line.next() {
      if byte < span.end || line.peek().is_none() {
        return Ok(span.location.as_ref());
      }
    }
    Ok(None)
  }

  /// Builds ordered UTF-16 [`LocationSpan`] records for a clean native GUI document in one pass.
  pub(crate) fn location_spans(&self) -> Result<Vec<LocationSpan<'_>>> {
    anyhow::ensure!(
      self.clean(),
      "Save or discard the pending edit before mapping a code selection"
    );
    anyhow::ensure!(
      self.spans.iter().any(|span| span.location.is_some()),
      "Upgrade ghidra-mcp for GUI cursor locations; this document has no native layout"
    );
    let mut out = Vec::with_capacity(self.spans.len());
    let (mut byte, mut line, mut character) = (0usize, 0u32, 0u32);
    for span in &self.spans {
      let Some(location) = &span.location else {
        continue;
      };
      let address = location
        .code_unit_address
        .as_deref()
        .filter(|value| !value.is_empty())
        .or_else(|| (!location.address.is_empty()).then_some(location.address.as_str()));
      let gap = self
        .base
        .get(byte..span.start)
        .context("span start is out of order or outside the document")?;
      advance_position(gap, &mut line, &mut character);
      byte = span.start;
      let slice = self
        .base
        .get(span.start..span.end)
        .context("span bounds are outside the document")?;
      if !slice.contains('\n') {
        let start = character;
        advance_position(slice, &mut line, &mut character);
        byte = span.end;
        push_location_span(&mut out, line, start, character, address);
      } else {
        for segment in slice.split_inclusive('\n') {
          let content = segment.trim_end_matches(['\r', '\n']);
          let length = content.encode_utf16().count() as u32;
          if length > 0 || !segment.ends_with('\n') {
            push_location_span(&mut out, line, character, character + length, address);
          }
          advance_position(segment, &mut line, &mut character);
          byte += segment.len();
        }
      }
    }
    Ok(out)
  }

  /// Finds the first non-comment span whose address or address range matches `target`.
  pub(crate) fn span_for_address(&self, target: &str) -> Option<&Span> {
    self.spans.iter().find(|span| {
      span.token.kind != "comment"
        && (span
          .token
          .address
          .as_deref()
          .is_some_and(|a| same_address(a, target))
          || span.location.as_ref().is_some_and(|location| {
            same_address(&location.address, target)
              || location
                .code_unit_address
                .as_deref()
                .is_some_and(|a| same_address(a, target))
              || span
                .token
                .address
                .as_deref()
                .zip(location.token_max_address.as_deref())
                .is_some_and(|(start, end)| in_address_range(target, start, end))
          }))
    })
  }
}

/// Aligns raw fallback tokens to `code` while rejecting non-whitespace mismatches.
pub(crate) fn align(code: &str, tokens: Vec<Token>) -> Result<Vec<Span>> {
  let chars: Vec<(usize, char)> = code
    .char_indices()
    .filter(|(_, c)| !c.is_whitespace())
    .collect();
  let mut cursor = 0;
  let mut spans = Vec::new();
  for token in tokens {
    let expected: Vec<char> = token.text.chars().filter(|c| !c.is_whitespace()).collect();
    if expected.is_empty() {
      continue;
    }
    let end = cursor + expected.len();
    if end > chars.len() || chars[cursor..end].iter().map(|(_, c)| *c).ne(expected) {
      bail!("text/token alignment differs");
    }
    let start_byte = chars[cursor].0;
    let end_byte = chars[end - 1].0 + chars[end - 1].1.len_utf8();
    // Keep internal whitespace exact, including strings and comments.
    if &code[start_byte..end_byte] != token.text.trim() {
      bail!("token content differs");
    }
    spans.push(Span {
      start: start_byte,
      end: end_byte,
      token,
      symbol: None,
      location: None,
    });
    cursor = end;
  }
  if cursor != chars.len() {
    bail!("tokens do not cover the document");
  }
  Ok(spans)
}

/// Resolves global, function, label, and constant token spans against the symbol index.
pub(crate) fn resolve(spans: &mut [Span], symbols: &SymbolIndex, locals: &HashSet<String>) {
  let mut extra_shadowed: HashSet<String> = HashSet::new();
  for span in spans.iter() {
    if matches!(span.token.kind.as_str(), "variable" | "parameter")
      && !locals.contains(span.token.text.as_str())
    {
      extra_shadowed.insert(span.token.text.clone());
    }
  }
  for span in spans.iter_mut() {
    // Native GUI tokens keep their attached function, variable, parameter, or global symbol.
    if span.location.is_some()
      && matches!(
        span.token.kind.as_str(),
        "function" | "variable" | "parameter" | "global"
      )
      && span.symbol.is_some()
    {
      continue;
    }
    if !matches!(
      span.token.kind.as_str(),
      "function" | "global" | "label" | "constant"
    ) || locals.contains(span.token.text.as_str())
      || extra_shadowed.contains(span.token.text.as_str())
    {
      span.symbol = None;
      continue;
    }
    span.symbol = symbols.resolve_span(span).cloned();
  }
}

/// Structured binding metadata for a function parameter or local variable symbol.
pub(crate) struct LocalBinding {
  /// Canonical LSP symbol entry for the parameter or local variable.
  pub(crate) symbol: Symbol,
  /// Zero-based parameter ordinal when `symbol` is a parameter.
  pub(crate) ordinal: Option<u64>,
  /// Formatted variable storage text when known.
  pub(crate) storage: Option<String>,
  /// Raw variable storage serialization string when known.
  pub(crate) serialization: Option<String>,
}

impl LocalBinding {
  /// Returns true when `storage_ser` matches the raw serialization or formatted storage text.
  pub(crate) fn matches_storage(&self, storage_ser: &str) -> bool {
    !storage_ser.is_empty()
      && (self.serialization.as_deref() == Some(storage_ser)
        || self.storage.as_deref() == Some(storage_ser))
  }
}

/// Resolves variable and parameter spans without a symbol when `locals` has one match.
pub(crate) fn resolve_locals(code: &str, spans: &mut [Span], locals: &[LocalBinding]) {
  let mut by_name: HashMap<&str, Option<&Symbol>> = HashMap::with_capacity(locals.len());
  for local in locals {
    by_name
      .entry(local.symbol.name.as_str())
      .and_modify(|slot| *slot = None)
      .or_insert(Some(&local.symbol));
  }
  for span in spans {
    if !matches!(span.token.kind.as_str(), "variable" | "parameter") {
      continue;
    }
    if is_field_access(code, span.start) {
      span.symbol = None;
      continue;
    }
    if span.symbol.is_some() {
      continue;
    }
    span.symbol = by_name
      .get(span.token.text.as_str())
      .copied()
      .flatten()
      .cloned();
  }
}

/// Returns true when `code` immediately before `span_start` ends with `.` or `->`.
pub(crate) fn is_field_access(code: &str, span_start: usize) -> bool {
  let before = code.get(..span_start).unwrap_or("").trim_end();
  before.ends_with('.') || before.ends_with("->")
}

/// Formats variable storage JSON returned by `ghidra-mcp` into display text.
pub(crate) fn format_storage_value(value: Option<&Value>) -> String {
  let Some(value) = value.filter(|v| !v.is_null()) else {
    return String::new();
  };
  if let Some(s) = value.as_str() {
    return s.to_owned();
  }
  if let Some(obj) = value.as_object() {
    let mut parts = Vec::new();
    if let Some(r) = obj.get("register").and_then(Value::as_str) {
      parts.push(r.to_owned());
    }
    if let Some(off) = obj.get("stack_offset").and_then(Value::as_i64) {
      let sign = if off < 0 { '-' } else { '+' };
      parts.push(format!("stack {sign}{:#x}", off.unsigned_abs()));
    }
    if !parts.is_empty() {
      return parts.join(", ");
    }
    if let Some(ser) = obj.get("serialization").and_then(Value::as_str) {
      return ser.to_owned();
    }
  }
  value.to_string()
}

/// Converts a backend storage value into a valid `selector.storage` wire object when present.
pub(crate) fn storage_selector(value: Option<&Value>) -> Option<Value> {
  let value = value.filter(|v| !v.is_null())?;
  if let Some(obj) = value.as_object() {
    if let Some(ser) = obj
      .get("serialization")
      .and_then(Value::as_str)
      .map(str::trim)
      .filter(|s| !s.is_empty())
    {
      return Some(json!({ "kind": "serialization", "serialization": ser }));
    }
    if obj.get("stack_offset").is_none()
      && let Some(reg) = obj
        .get("register")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
      return Some(json!({ "kind": "register", "register": reg }));
    }
    return None;
  }
  let text = value.as_str().map(str::trim).filter(|s| !s.is_empty())?;
  Some(json!({ "kind": "serialization", "serialization": text }))
}

/// Returns true when two `storage` JSON values identify the same storage location.
pub(crate) fn same_storage(a: Option<&Value>, b: Option<&Value>) -> bool {
  let (Some(a), Some(b)) = (a.filter(|v| !v.is_null()), b.filter(|v| !v.is_null())) else {
    return false;
  };
  if a == b {
    return true;
  }
  let sa = a
    .get("serialization")
    .and_then(Value::as_str)
    .or_else(|| a.as_str());
  let sb = b
    .get("serialization")
    .and_then(Value::as_str)
    .or_else(|| b.as_str());
  matches!((sa, sb), (Some(sa), Some(sb)) if !sa.is_empty() && sa == sb)
}

/// Formats a structured or string Ghidra data type reference into C-style text.
pub(crate) fn data_type_name(value: &Value) -> String {
  match value.get("kind").and_then(Value::as_str) {
    Some("named") => value
      .get("name")
      .and_then(Value::as_str)
      .unwrap_or("unknown")
      .into(),
    Some("pointer") => format!("{} *", data_type_name(&value["target"])),
    Some("array") => format!("{}[{}]", data_type_name(&value["element"]), value["count"]),
    Some("untyped_pointer") => "void *".into(),
    _ => value.as_str().unwrap_or("unknown").into(),
  }
}

/// Adds a UTF-16 [`LocationSpan`], or joins it with the last span on the same line and address.
fn push_location_span<'a>(
  out: &mut Vec<LocationSpan<'a>>,
  line: u32,
  start: u32,
  end: u32,
  address: Option<&'a str>,
) {
  if let Some(previous) = out.last_mut()
    && previous.line == line
    && previous.end == start
    && previous.address == address
  {
    previous.end = end;
    return;
  }
  out.push(LocationSpan {
    line,
    start,
    end,
    address,
  });
}

/// Advances zero-based `line` and UTF-16 `character` coordinates across `text`.
pub(crate) fn advance_position(text: &str, line: &mut u32, character: &mut u32) {
  if text.is_ascii() {
    for segment in text.split_inclusive('\n') {
      if segment.ends_with('\n') {
        *line += 1;
        *character = 0;
      } else {
        *character += segment.len() as u32;
      }
    }
    return;
  }
  for c in text.chars() {
    if c == '\n' {
      *line += 1;
      *character = 0;
    } else {
      *character += c.len_utf16() as u32;
    }
  }
}

/// Converts a UTF-8 byte index in `text` into an LSP UTF-16 `Position`.
pub(crate) fn position(text: &str, byte: usize) -> Position {
  let byte = byte.min(text.len());
  let byte = (0..=byte)
    .rev()
    .find(|&b| text.is_char_boundary(b))
    .unwrap_or(0);
  let prefix = &text[..byte];
  Position::new(
    prefix.bytes().filter(|b| *b == b'\n').count() as u32,
    prefix
      .rsplit('\n')
      .next()
      .unwrap_or("")
      .encode_utf16()
      .count() as u32,
  )
}

/// Converts an LSP UTF-16 `Position` in `text` into a UTF-8 byte offset.
pub(crate) fn offset(text: &str, pos: Position) -> Option<usize> {
  let mut start = 0;
  for _ in 0..pos.line {
    start += text.get(start..)?.find('\n')? + 1;
  }
  let line = text.get(start..)?.split('\n').next()?;
  let mut units = 0;
  for (i, c) in line.char_indices() {
    if units == pos.character {
      return Some(start + i);
    }
    units += c.len_utf16() as u32;
  }
  (units == pos.character).then_some(start + line.len())
}

/// Applies non-overlapping LSP `TextEdit` changes to `text` in reverse order.
pub(crate) fn apply_edits(text: &str, edits: &[TextEdit]) -> Result<String> {
  let mut ranges = edits
    .iter()
    .map(|e| {
      Ok((
        offset(text, e.range.start).context("invalid edit start")?,
        offset(text, e.range.end).context("invalid edit end")?,
        e.new_text.as_str(),
      ))
    })
    .collect::<Result<Vec<_>>>()?;
  ranges.sort_by_key(|e| e.0);
  let mut out = text.to_owned();
  let mut boundary = text.len();
  for (start, end, replacement) in ranges.into_iter().rev() {
    if end > boundary || start > end {
      bail!("overlapping edits");
    }
    out.replace_range(start..end, replacement);
    boundary = start;
  }
  Ok(out)
}

/// Returns true when `name` is a non-empty ASCII C identifier.
pub(crate) fn valid_name(name: &str) -> bool {
  let mut chars = name.chars();
  chars
    .next()
    .is_some_and(|c| c == '_' || c.is_ascii_alphabetic())
    && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// Compares `actual` and `expected` buffer contents ignoring CRLF and trailing whitespace differences.
pub(crate) fn matches_text(actual: &str, expected: &str) -> bool {
  if actual == expected {
    return true;
  }
  let actual_lf = actual.replace("\r\n", "\n");
  let expected_lf = expected.replace("\r\n", "\n");
  if actual_lf == expected_lf {
    return true;
  }
  let actual_trimmed = actual_lf.trim_end();
  let expected_trimmed = expected_lf.trim_end();
  if actual_trimmed == expected_trimmed {
    return true;
  }
  let actual_lines: Vec<&str> = actual_lf.lines().map(str::trim_end).collect();
  let expected_lines: Vec<&str> = expected_lf.lines().map(str::trim_end).collect();
  actual_lines == expected_lines
}

/// Builds a percent-encoded `ghidra://` virtual document URI.
pub(crate) fn virtual_uri(md5: &str, kind: &str, key: &str) -> Result<Uri> {
  /// Characters left unencoded inside a URI path segment.
  const COMPONENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');
  let encoded = percent_encoding::utf8_percent_encode(key, COMPONENT);
  format!("ghidra://{md5}/{kind}/{encoded}")
    .parse()
    .map_err(Into::into)
}

/// Re-encodes any `ghidra://` URI into its canonical percent-encoded form.
pub(crate) fn canonical_virtual_uri(uri: &Uri) -> Uri {
  if let Ok(parsed) = url::Url::parse(uri.as_str())
    && parsed.scheme() == "ghidra"
    && let Some(host) = parsed.host_str()
  {
    let path = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
    if let Some((kind, raw_key)) = path.split_once('/')
      && let Ok(decoded_key) = percent_encoding::percent_decode_str(raw_key).decode_utf8()
      && let Ok(canon) = virtual_uri(host, kind, &decoded_key)
    {
      return canon;
    }
  }
  uri.clone()
}

/// Extracts the ASCII identifier word and its UTF-16 `Range` around `pos`.
pub(crate) fn word_at(text: &str, pos: Position) -> Option<(&str, Range)> {
  let offset = offset(text, pos)?;
  let start = text[..offset]
    .rfind(|c: char| !c.is_ascii_alphanumeric() && c != '_')
    .map(|i| i + 1)
    .unwrap_or(0);
  let end = text[offset..]
    .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
    .map(|i| offset + i)
    .unwrap_or(text.len());
  if start >= end {
    return None;
  }
  let word = &text[start..end];
  if word.is_empty() {
    return None;
  }
  let range = Range::new(position(text, start), position(text, end));
  Some((word, range))
}

/// Parses an address string into an optional space name and hexadecimal offset.
pub(crate) fn address(value: &str) -> Option<(&str, u64)> {
  let (space, number) = value.rsplit_once(':').unwrap_or(("", value));
  Some((
    space,
    u64::from_str_radix(number.trim_start_matches("0x"), 16).ok()?,
  ))
}

/// Returns true when `a` and `b` denote the same address in compatible address spaces.
pub(crate) fn same_address(a: &str, b: &str) -> bool {
  match (address(a), address(b)) {
    (Some((sa, na)), Some((sb, nb))) => (sa.is_empty() || sb.is_empty() || sa == sb) && na == nb,
    _ => false,
  }
}

/// Returns true when `addr` falls within the inclusive `[start, end]` address range.
pub(crate) fn in_address_range(addr: &str, start: &str, end: &str) -> bool {
  match (address(addr), address(start), address(end)) {
    (Some((sa, na)), Some((ss, ns)), Some((se, ne))) => {
      (sa.is_empty() || ss.is_empty() || sa == ss)
        && (sa.is_empty() || se.is_empty() || sa == se)
        && ns <= na
        && na <= ne
    }
    _ => false,
  }
}

/// Returns true when a token at `[span_start, span_end)` looks like a Ghidra branch label.
pub(crate) fn is_label_token(
  text: &str,
  span_start: usize,
  span_end: usize,
  doc_text: &str,
) -> bool {
  if text.starts_with("LAB_") || text.starts_with("code_") || text.starts_with("switchD_") {
    return true;
  }
  let after = doc_text[span_end..].trim_start();
  if after.starts_with(':') && !after.starts_with("::") {
    return true;
  }
  let before = doc_text[..span_start].trim_end();
  before.ends_with("goto") || before.ends_with("goto ")
}

/// Extracts a synthetic `ram:<hex>` label address from auto-generated Ghidra label names.
pub(crate) fn extract_label_address(text: &str) -> Option<String> {
  if let Some(rest) = text.strip_prefix("LAB_") {
    let hex = rest.rsplit('_').next().unwrap_or(rest);
    if u64::from_str_radix(hex, 16).is_ok() {
      return Some(format!("ram:{hex}"));
    }
  }
  if let Some(rest) = text.strip_prefix("code_") {
    let hex = rest.strip_prefix("r0x").unwrap_or(rest);
    if u64::from_str_radix(hex, 16).is_ok() {
      return Some(format!("ram:{hex}"));
    }
  }
  None
}
