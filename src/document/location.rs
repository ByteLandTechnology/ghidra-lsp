// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Single and batch cursor, selection, and address location queries on [`Document`].

use std::collections::HashSet;

use anyhow::{Context, Result};
use serde::Deserialize;
use tower_lsp_server::ls_types::{Position, Range};

use super::{CodeLocation, Document, Span, in_address_range, same_address};

/// Inclusive machine-address range with preserved address-space prefix.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct AddressBounds {
  /// Inclusive start address string (`[space:][0x]<hex>`).
  pub(crate) start: String,
  /// Inclusive end address string (`[space:][0x]<hex>`).
  pub(crate) end: String,
}

/// Validated inclusive address range within a single preserved address space.
struct ParsedRange<'a> {
  /// Exact address-space prefix (`""` when bare hexadecimal).
  space: &'a str,
  /// Inclusive start offset in `space`.
  start: u64,
  /// Inclusive end offset in `space`.
  end: u64,
}

impl Document {
  /// Maps an LSP cursor position on a clean document to its native GUI [`CodeLocation`].
  pub(crate) fn code_location(&self, pos: Position) -> Result<Option<&CodeLocation>> {
    anyhow::ensure!(
      self.clean(),
      "Save or discard the pending edit before mapping a code selection"
    );
    let byte = self
      .offset(pos)
      .context("position is outside the document")?;
    anyhow::ensure!(
      self.has_native_locations(),
      "Upgrade ghidra-mcp for GUI cursor locations; this document has no native layout"
    );
    Ok(self.code_location_at(pos.line as usize, byte))
  }

  /// Resolves the effective [`CodeLocation`] at `byte` on zero-based `line_index`.
  fn code_location_at(&self, line_index: usize, byte: usize) -> Option<&CodeLocation> {
    let (start, end) = self.line_bounds(line_index)?;
    let first = self.spans.partition_point(|span| span.start < start);
    let mut line = self.spans[first..]
      .iter()
      .take_while(|span| span.start <= end)
      .filter(|span| span.location.is_some())
      .peekable();
    // The GUI selects the first token in indentation and the last token at end of line.
    while let Some(span) = line.next() {
      if byte < span.end || line.peek().is_none() {
        return span.location.as_ref();
      }
    }
    None
  }

  /// Returns merged UTF-16 `Range`s whose effective locations intersect `address_ranges`.
  pub(crate) fn ranges_for_addresses(
    &self,
    address_ranges: &[AddressBounds],
  ) -> Result<Vec<Range>> {
    anyhow::ensure!(
      self.clean(),
      "Save or discard the pending edit before mapping a code selection"
    );
    anyhow::ensure!(
      self.has_native_locations(),
      "Upgrade ghidra-mcp for GUI cursor locations; this document has no native layout"
    );
    if address_ranges.is_empty() || self.line_starts.is_empty() {
      return Ok(Vec::new());
    }
    let mut targets = Vec::with_capacity(address_ranges.len());
    for item in address_ranges {
      let (start_space, start) =
        parse_space_address(&item.start).context("invalid start address in addressRanges")?;
      let (end_space, end) =
        parse_space_address(&item.end).context("invalid end address in addressRanges")?;
      anyhow::ensure!(
        start_space == end_space,
        "address range bounds must share an address space"
      );
      anyhow::ensure!(start <= end, "address range start exceeds end");
      targets.push(ParsedRange {
        space: start_space,
        start,
        end,
      });
    }
    let mut merged: Vec<(usize, usize)> = Vec::new();
    let last_line = self.line_starts.len() - 1;
    self.for_each_line_segment(0, last_line, |seg_start, seg_end, location| {
      let Some((_, space, offset)) = effective_address(location) else {
        return;
      };
      if !targets
        .iter()
        .any(|t| t.space == space && t.start <= offset && offset <= t.end)
      {
        return;
      }
      // Join adjacent pieces of an expression, but never fill a gap containing unrelated code.
      if let Some(prev) = merged.last_mut()
        && self.base[prev.1..seg_start].chars().all(is_token_space)
      {
        prev.1 = seg_end;
      } else {
        merged.push((seg_start, seg_end));
      }
    });
    Ok(
      merged
        .into_iter()
        .map(|(start, end)| Range::new(self.position(start), self.position(end)))
        .collect(),
    )
  }

  /// Returns deduplicated machine addresses in document order covered by UTF-16 `selections`.
  pub(crate) fn addresses_for_selections(&self, selections: &[Range]) -> Result<Vec<String>> {
    anyhow::ensure!(
      self.clean(),
      "Save or discard the pending edit before mapping a code selection"
    );
    let mut non_empty = Vec::new();
    let mut cursors = Vec::new();
    let mut min_line = usize::MAX;
    let mut max_line = 0usize;
    for sel in selections {
      let (start_pos, end_pos) =
        if (sel.start.line, sel.start.character) <= (sel.end.line, sel.end.character) {
          (sel.start, sel.end)
        } else {
          (sel.end, sel.start)
        };
      let start_byte = self
        .offset(start_pos)
        .context("position is outside the document")?;
      let end_byte = self
        .offset(end_pos)
        .context("position is outside the document")?;
      if start_byte == end_byte {
        cursors.push((start_byte, start_pos.line as usize));
      } else {
        min_line = min_line.min(start_pos.line as usize);
        max_line = max_line.max(end_pos.line as usize);
        non_empty.push((start_byte, end_byte));
      }
    }
    anyhow::ensure!(
      self.has_native_locations(),
      "Upgrade ghidra-mcp for GUI cursor locations; this document has no native layout"
    );
    if non_empty.is_empty() && cursors.is_empty() {
      return Ok(Vec::new());
    }
    let mut resolved: Vec<(usize, &CodeLocation)> = Vec::new();
    if !non_empty.is_empty() {
      self.for_each_line_segment(min_line, max_line, |seg_start, seg_end, location| {
        if non_empty
          .iter()
          .any(|&(sel_start, sel_end)| sel_start < seg_end && seg_start < sel_end)
        {
          resolved.push((seg_start, location));
        }
      });
    }
    for (byte, line) in cursors {
      if let Some(location) = self.code_location_at(line, byte) {
        resolved.push((byte, location));
      }
    }
    if resolved.len() > 1 {
      resolved.sort_by_key(|(byte, _)| *byte);
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (_, location) in resolved {
      if let Some((raw, space, offset)) = effective_address(location)
        && seen.insert((space, offset))
      {
        out.push(raw.to_owned());
      }
    }
    Ok(out)
  }

  /// Visits contiguous non-empty byte segments and their effective [`CodeLocation`] across `first_line..=last_line`.
  fn for_each_line_segment<'a>(
    &'a self,
    first_line: usize,
    last_line: usize,
    mut visit: impl FnMut(usize, usize, &'a CodeLocation),
  ) {
    if self.line_starts.is_empty() || first_line > last_line {
      return;
    }
    let end_line = last_line.min(self.line_starts.len() - 1);
    let Some(&initial_byte) = self.line_starts.get(first_line) else {
      return;
    };
    let mut span_idx = self.spans.partition_point(|span| span.start < initial_byte);
    for line_idx in first_line..=end_line {
      let Some((line_start, line_end)) = self.line_bounds(line_idx) else {
        continue;
      };
      while span_idx < self.spans.len() && self.spans[span_idx].start < line_start {
        span_idx += 1;
      }
      let first = span_idx;
      while span_idx < self.spans.len() && self.spans[span_idx].start <= line_end {
        span_idx += 1;
      }
      if line_start >= line_end {
        continue;
      }
      let line_text = &self.base[line_start..line_end];
      let mut cursor = line_start;
      let mut iter = self.spans[first..span_idx]
        .iter()
        .filter_map(|span| span.location.as_ref().map(|loc| (span, loc)))
        .peekable();
      while let Some((span, location)) = iter.next() {
        let raw_end = if iter.peek().is_none() {
          line_end
        } else {
          span.end.min(line_end)
        };
        if raw_end <= cursor {
          continue;
        }
        let seg_end = if raw_end < line_end {
          line_start + extend_token_boundary(line_text, raw_end - line_start)
        } else {
          line_end
        };
        visit(cursor, seg_end, location);
        cursor = seg_end;
      }
    }
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

/// Returns true when `ch` matches JavaScript `\s` whitespace in selection token splitting.
fn is_token_space(ch: char) -> bool {
  ch.is_whitespace() || ch == '\u{feff}'
}

/// Returns true when `ch` belongs to an identifier or numeric word run (`[\p{L}\p{N}_$]`).
fn is_token_word(ch: char) -> bool {
  ch.is_alphanumeric() || ch == '_' || ch == '$'
}

/// Extends `rel_end` to the end of any whitespace or identifier run crossing `rel_end` in `line`.
fn extend_token_boundary(line: &str, rel_end: usize) -> usize {
  let mut boundary = rel_end.min(line.len());
  while boundary < line.len() && !line.is_char_boundary(boundary) {
    boundary += 1;
  }
  if boundary == 0 || boundary >= line.len() {
    return boundary;
  }
  let prev = line[..boundary].chars().next_back();
  let next = line[boundary..].chars().next();
  if let (Some(p), Some(n)) = (prev, next) {
    if is_token_space(p) && is_token_space(n) {
      boundary += line[boundary..]
        .chars()
        .take_while(|&c| is_token_space(c))
        .map(char::len_utf8)
        .sum::<usize>();
    } else if is_token_word(p) && is_token_word(n) {
      boundary += line[boundary..]
        .chars()
        .take_while(|&c| is_token_word(c))
        .map(char::len_utf8)
        .sum::<usize>();
    }
  }
  boundary
}

/// Parses `[space:][0x]<hex>` while preserving exact `space` prefixes.
fn parse_space_address(value: &str) -> Option<(&str, u64)> {
  let (space, rest) = value.rsplit_once(':').unwrap_or(("", value));
  let hex = rest.strip_prefix("0x").unwrap_or(rest);
  if hex.is_empty() || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
    return None;
  }
  Some((space, u64::from_str_radix(hex, 16).ok()?))
}

/// Extracts the effective raw address, space prefix, and offset from `location`.
fn effective_address(location: &CodeLocation) -> Option<(&str, &str, u64)> {
  let raw = location
    .code_unit_address
    .as_deref()
    .filter(|s| !s.is_empty())
    .unwrap_or(location.address.as_str());
  if raw.is_empty() {
    return None;
  }
  let (space, offset) = parse_space_address(raw)?;
  Some((raw, space, offset))
}
