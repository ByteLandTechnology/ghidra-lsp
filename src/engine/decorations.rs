// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Editor decorations: highlights, inlay hints, code lenses, folding ranges, and document links.

use std::collections::HashSet;

use anyhow::Result;
use serde_json::{Value, json};
use tower_lsp_server::ls_types::{
  CodeLens, Command, DocumentHighlight, DocumentHighlightKind, DocumentLink, FoldingRange,
  FoldingRangeKind, InlayHint, InlayHintKind, InlayHintLabel, InlayHintTooltip, Position, Range,
  Uri,
};

use super::{Engine, EngineState};
use crate::address::{find_memory_block, format_address, parse_address};
use crate::document::{Span, canonical_virtual_uri, offset, position, same_address, virtual_uri};
use crate::views::CachedProgramMeta;

impl Engine {
  /// Returns same-document highlights for the symbol or type token under `pos`.
  pub(crate) fn document_highlight(
    &self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Vec<DocumentHighlight>>> {
    self.read_state().document_highlight(uri, pos)
  }

  /// Returns storage hints for local symbols and target address hints for call sites in `range`.
  pub(crate) fn inlay_hints(&self, uri: &Uri, range: Range) -> Result<Option<Vec<InlayHint>>> {
    self.read_state().inlay_hints(uri, range)
  }

  /// Returns header code lenses for opening Listing, Call Graph, Control Flow, and reference panes.
  pub(crate) fn code_lenses(&self, uri: &Uri) -> Result<Option<Vec<CodeLens>>> {
    self.read_state().code_lenses(uri)
  }

  /// Computes comment and brace-block folding ranges for `uri`.
  pub(crate) fn folding_ranges(&self, uri: &Uri) -> Result<Option<Vec<FoldingRange>>> {
    self.read_state().folding_ranges(uri)
  }

  /// Finds clickable `ghidra://` URIs and verified function or memory-block address links in `uri`.
  pub(crate) fn document_links(
    &self,
    uri: &Uri,
    meta: Option<&CachedProgramMeta>,
  ) -> Result<Option<Vec<DocumentLink>>> {
    self.read_state().document_links(uri, meta)
  }
}

impl EngineState {
  /// Returns same-document highlights for the symbol or type token under `pos`.
  pub(crate) fn document_highlight(
    &self,
    uri: &Uri,
    pos: Position,
  ) -> Result<Option<Vec<DocumentHighlight>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let Some(doc) = self.docs.get(uri) else {
      return Ok(None);
    };
    if !doc.clean() {
      return Ok(None);
    }
    let Some(cursor) = offset(&doc.base, pos) else {
      return Ok(None);
    };
    let Some(current_span) = doc
      .spans
      .iter()
      .find(|s| s.start <= cursor && cursor < s.end)
    else {
      return Ok(None);
    };

    let matches: Vec<&Span> = if let Some(sym) = &current_span.symbol {
      doc
        .spans
        .iter()
        .filter(|s| s.symbol.as_ref().is_some_and(|target| target.id == sym.id))
        .collect()
    } else if current_span.token.kind == "type" {
      doc
        .spans
        .iter()
        .filter(|s| s.token.kind == "type" && s.token.text == current_span.token.text)
        .collect()
    } else {
      return Ok(None);
    };

    if matches.is_empty() {
      return Ok(None);
    }

    Ok(Some(
      matches
        .into_iter()
        .map(|s| DocumentHighlight {
          range: doc.range(s),
          kind: Some(DocumentHighlightKind::TEXT),
        })
        .collect(),
    ))
  }

  /// Returns storage hints for local symbols and target address hints for call sites in `range`.
  pub(crate) fn inlay_hints(&self, uri: &Uri, range: Range) -> Result<Option<Vec<InlayHint>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let Some(doc) = self.docs.get(uri) else {
      return Ok(None);
    };
    if !doc.clean() {
      return Ok(None);
    }
    let mut hints = Vec::new();
    let mut seen_local_storage = HashSet::new();
    let body_start = doc.body_start();

    for span in &doc.spans {
      let span_range = doc.range(span);
      if span_range.end < range.start || span_range.start > range.end {
        continue;
      }

      if let Some(sym) = &span.symbol
        && sym.local()
        && seen_local_storage.insert(sym.id.clone())
        && let Some(detail) = self.local_detail(sym)
        && let Some(storage) = detail.get("storage").and_then(|storage| {
          storage
            .as_str()
            .or_else(|| storage.get("serialization").and_then(Value::as_str))
            .or_else(|| storage.get("register").and_then(Value::as_str))
        })
        && !storage.is_empty()
      {
        hints.push(InlayHint {
          position: span_range.end,
          label: InlayHintLabel::String(format!(": {storage}")),
          kind: Some(InlayHintKind::TYPE),
          text_edits: None,
          tooltip: Some(InlayHintTooltip::String(format!("Storage: {storage}"))),
          padding_left: Some(true),
          padding_right: None,
          data: None,
        });
      }

      if span.start >= body_start
        && (span.token.kind == "function"
          || span
            .symbol
            .as_ref()
            .is_some_and(|s| s.kind.eq_ignore_ascii_case("function")))
        && let Some(addr) = &span.token.address
        && doc.entry.as_deref() != Some(addr)
      {
        hints.push(InlayHint {
          position: span_range.start,
          label: InlayHintLabel::String(format!("[{addr}] ")),
          kind: Some(InlayHintKind::PARAMETER),
          text_edits: None,
          tooltip: Some(InlayHintTooltip::String(format!("Target: {addr}"))),
          padding_left: None,
          padding_right: Some(true),
          data: None,
        });
      }
    }

    Ok(Some(hints))
  }

  /// Returns header code lenses for opening Listing, Call Graph, Control Flow, and reference panes.
  pub(crate) fn code_lenses(&self, uri: &Uri) -> Result<Option<Vec<CodeLens>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let Some(doc) = self.docs.get(uri) else {
      return Ok(None);
    };
    let Some(entry) = doc.entry.as_deref() else {
      return Ok(None);
    };
    let body_start = doc.body_start();
    let fn_span = doc
      .spans
      .iter()
      .find(|s| s.token.kind == "function" && s.start < body_start);
    let (range, pos) = if let Some(s) = fn_span {
      (doc.range(s), position(&doc.base, s.start))
    } else {
      (
        Range::new(Position::new(0, 0), Position::new(0, 0)),
        Position::new(0, 0),
      )
    };
    let lenses = vec![
      CodeLens {
        range,
        command: Some(Command {
          title: "Listing".into(),
          command: "ghidraLsp.showListing".into(),
          arguments: Some(vec![json!(uri.to_string()), json!(entry)]),
        }),
        data: None,
      },
      CodeLens {
        range,
        command: Some(Command {
          title: "Call Graph".into(),
          command: "ghidraLsp.showCallGraph".into(),
          arguments: Some(vec![json!(uri.to_string()), json!(entry)]),
        }),
        data: None,
      },
      CodeLens {
        range,
        command: Some(Command {
          title: "Control Flow".into(),
          command: "ghidraLsp.showControlFlow".into(),
          arguments: Some(vec![json!(uri.to_string()), json!(entry)]),
        }),
        data: None,
      },
      CodeLens {
        range,
        command: Some(Command {
          title: "Callers".into(),
          command: "ghidraLsp.showCallers".into(),
          arguments: Some(vec![
            json!({"uri": uri.to_string(), "entry": entry, "position": pos}),
          ]),
        }),
        data: None,
      },
      CodeLens {
        range,
        command: Some(Command {
          title: "Callees".into(),
          command: "ghidraLsp.showCallees".into(),
          arguments: Some(vec![
            json!({"uri": uri.to_string(), "entry": entry, "position": pos}),
          ]),
        }),
        data: None,
      },
      CodeLens {
        range,
        command: Some(Command {
          title: "References".into(),
          command: "ghidraLsp.showReferences".into(),
          arguments: Some(vec![
            json!({"uri": uri.to_string(), "entry": entry, "position": pos}),
          ]),
        }),
        data: None,
      },
    ];
    Ok(Some(lenses))
  }

  /// Computes comment and brace-block folding ranges for `uri`.
  pub(crate) fn folding_ranges(&self, uri: &Uri) -> Result<Option<Vec<FoldingRange>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let Some(doc) = self.docs.get(uri) else {
      return Ok(None);
    };
    let text = if doc.current.is_empty() {
      &doc.base
    } else {
      &doc.current
    };
    let mut ranges = Vec::new();
    let mut brace_stack = Vec::new();
    let mut comment_start: Option<u32> = None;
    let mut line_comment_start: Option<u32> = None;

    for (line_idx, line) in text.lines().enumerate() {
      let line_num = line_idx as u32;
      let trimmed = line.trim();
      let started_in_block = comment_start.is_some();

      if !started_in_block && trimmed.starts_with("//") {
        if line_comment_start.is_none() {
          line_comment_start = Some(line_num);
        }
      } else if let Some(start) = line_comment_start {
        if line_num.saturating_sub(1) > start {
          ranges.push(FoldingRange {
            start_line: start,
            start_character: None,
            end_line: line_num - 1,
            end_character: None,
            kind: Some(FoldingRangeKind::Comment),
            collapsed_text: None,
          });
        }
        line_comment_start = None;
      }

      let bytes = line.as_bytes();
      let mut i = 0;
      let mut quote: Option<u8> = None;
      let mut escaped = false;
      while i < bytes.len() {
        if let Some(start) = comment_start {
          if i + 1 < bytes.len() && bytes[i] == b'*' && bytes[i + 1] == b'/' {
            if line_num > start {
              ranges.push(FoldingRange {
                start_line: start,
                start_character: None,
                end_line: line_num,
                end_character: None,
                kind: Some(FoldingRangeKind::Comment),
                collapsed_text: None,
              });
            }
            comment_start = None;
            i += 2;
          } else {
            i += 1;
          }
          continue;
        }
        let b = bytes[i];
        if let Some(q) = quote {
          if escaped {
            escaped = false;
          } else if b == b'\\' {
            escaped = true;
          } else if b == q {
            quote = None;
          }
          i += 1;
          continue;
        }
        if i + 1 < bytes.len() && b == b'/' && bytes[i + 1] == b'/' {
          break;
        }
        if i + 1 < bytes.len() && b == b'/' && bytes[i + 1] == b'*' {
          comment_start = Some(line_num);
          i += 2;
          continue;
        }
        if b == b'"' || b == b'\'' {
          quote = Some(b);
          i += 1;
          continue;
        }
        if b == b'{' {
          brace_stack.push(line_num);
        } else if b == b'}'
          && let Some(start_line) = brace_stack.pop()
          && line_num > start_line
        {
          ranges.push(FoldingRange {
            start_line,
            start_character: None,
            end_line: line_num,
            end_character: None,
            kind: Some(FoldingRangeKind::Region),
            collapsed_text: None,
          });
        }
        i += 1;
      }
    }

    if let Some(start) = line_comment_start {
      let last_line = text.lines().count().saturating_sub(1) as u32;
      if last_line > start {
        ranges.push(FoldingRange {
          start_line: start,
          start_character: None,
          end_line: last_line,
          end_character: None,
          kind: Some(FoldingRangeKind::Comment),
          collapsed_text: None,
        });
      }
    }

    Ok(Some(ranges))
  }

  /// Finds clickable `ghidra://` URIs and verified function or memory-block address links in `uri`.
  pub(crate) fn document_links(
    &self,
    uri: &Uri,
    meta: Option<&CachedProgramMeta>,
  ) -> Result<Option<Vec<DocumentLink>>> {
    let canon = canonical_virtual_uri(uri);
    let uri = &canon;
    let Some(doc) = self.docs.get(uri) else {
      return Ok(None);
    };
    let text = if doc.current.is_empty() {
      &doc.base
    } else {
      &doc.current
    };
    let default_space = meta.map_or("ram", |m| m.default_space.as_str());
    let mut links = Vec::new();

    for (line_idx, line) in text.lines().enumerate() {
      let line_num = line_idx as u32;
      let mut iter = line.char_indices().peekable();
      let mut utf16_col: u32 = 0;
      let mut prev_ident = false;
      while let Some((byte_idx, ch)) = iter.next() {
        let tail = &line[byte_idx..];
        if tail.starts_with("ghidra://") {
          let start_col = utf16_col;
          let mut end_byte = byte_idx + ch.len_utf8();
          let mut end_col = utf16_col + ch.len_utf16() as u32;
          while let Some(&(nb, nc)) = iter.peek() {
            if nc.is_whitespace() || matches!(nc, ')' | ']' | '>' | '"' | '\'') {
              break;
            }
            iter.next();
            end_byte = nb + nc.len_utf8();
            end_col += nc.len_utf16() as u32;
          }
          let uri_str = &line[byte_idx..end_byte];
          if let Ok(target_uri) = uri_str.parse::<Uri>() {
            links.push(DocumentLink {
              range: Range::new(
                Position::new(line_num, start_col),
                Position::new(line_num, end_col),
              ),
              target: Some(target_uri),
              tooltip: Some(format!("Open {uri_str}")),
              data: None,
            });
          }
          utf16_col = end_col;
          prev_ident = false;
          continue;
        }

        if tail.starts_with("ram:") && !prev_ident {
          let start_col = utf16_col;
          let mut end_byte = byte_idx + 4;
          let mut end_col = utf16_col + 4;
          for _ in 0..3 {
            let _ = iter.next();
          }
          while let Some(&(nb, nc)) = iter.peek() {
            if !nc.is_ascii_hexdigit() {
              break;
            }
            iter.next();
            end_byte = nb + nc.len_utf8();
            end_col += nc.len_utf16() as u32;
          }
          let trailing_ident = iter
            .peek()
            .is_some_and(|&(_, nc)| nc.is_ascii_alphanumeric() || nc == '_');
          if !trailing_ident && end_byte - byte_idx >= 7 {
            let addr_str = &line[byte_idx..end_byte];
            if let Some(link) = self.build_address_link(
              &doc.md5,
              addr_str,
              addr_str,
              default_space,
              meta,
              Range::new(
                Position::new(line_num, start_col),
                Position::new(line_num, end_col),
              ),
            ) {
              links.push(link);
            }
          }
          utf16_col = end_col;
          prev_ident = true;
          continue;
        }

        if !prev_ident && (tail.starts_with("0x") || tail.starts_with("0X")) {
          let start_col = utf16_col;
          let mut end_byte = byte_idx + 2;
          let mut end_col = utf16_col + 2;
          let _ = iter.next();
          while let Some(&(nb, nc)) = iter.peek() {
            if !nc.is_ascii_hexdigit() {
              break;
            }
            iter.next();
            end_byte = nb + nc.len_utf8();
            end_col += nc.len_utf16() as u32;
          }
          let trailing_ident = iter.peek().is_some_and(|&(_, nc)| {
            (nc.is_ascii_alphanumeric() || nc == '_') && !matches!(nc, 'u' | 'U' | 'l' | 'L')
          });
          if !trailing_ident && end_byte - byte_idx >= 6 {
            let hex_str = &line[byte_idx..end_byte];
            let target_addr = &hex_str[2..];
            if let Some(link) = self.build_address_link(
              &doc.md5,
              target_addr,
              hex_str,
              default_space,
              meta,
              Range::new(
                Position::new(line_num, start_col),
                Position::new(line_num, end_col),
              ),
            ) {
              links.push(link);
            }
          }
          utf16_col = end_col;
          prev_ident = true;
          continue;
        }

        utf16_col += ch.len_utf16() as u32;
        prev_ident = ch.is_ascii_alphanumeric() || ch == '_';
      }
    }

    Ok(Some(links))
  }

  /// Resolves `candidate` against cached functions and memory blocks to build a verified link.
  fn build_address_link(
    &self,
    md5: &str,
    candidate: &str,
    display_text: &str,
    default_space: &str,
    meta: Option<&CachedProgramMeta>,
    range: Range,
  ) -> Option<DocumentLink> {
    let parsed = parse_address(candidate, default_space)?;
    let width = meta.map_or(parsed.width.max(8), |m| m.address_width);
    let canonical = format_address(&parsed.space, parsed.offset, width);

    let function_entry = meta
      .and_then(|m| {
        m.functions
          .iter()
          .find(|f| same_address(&f.entry, &canonical))
          .map(|f| f.entry.as_str())
      })
      .or_else(|| {
        self
          .functions
          .keys()
          .find(|(f_md5, entry)| f_md5 == md5 && same_address(entry, &canonical))
          .map(|(_, entry)| entry.as_str())
      })
      .or_else(|| {
        self
          .symbols
          .get(md5)?
          .function_at(&canonical)
          .map(|s| s.address.as_str())
      });

    if let Some(entry) = function_entry {
      let target = virtual_uri(md5, "function", entry).ok()?;
      return Some(DocumentLink {
        range,
        target: Some(target),
        tooltip: Some(format!("Go to function {display_text}")),
        data: Some(json!({
          "md5": md5,
          "kind": "function",
          "address": entry,
        })),
      });
    }

    let meta = meta?;
    find_memory_block(&meta.blocks, &canonical)?;

    let sym_key = self
      .symbols
      .get(md5)
      .and_then(|syms| syms.by_address(&canonical).map(|s| s.id.as_str()))
      .unwrap_or(&canonical);
    let target = virtual_uri(md5, "symbol", sym_key).ok()?;
    Some(DocumentLink {
      range,
      target: Some(target),
      tooltip: Some(format!("Go to address {canonical}")),
      data: Some(json!({
        "md5": md5,
        "kind": "address",
        "address": canonical,
      })),
    })
  }
}
