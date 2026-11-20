// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Pure-Rust JSONC lexer, abstract syntax tree parser, and path lookup helpers.

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::{PathSegment, TypeEditError};

/// Token classification produced by the JSONC lexer.
#[derive(Clone, Debug, PartialEq)]
enum TokenKind {
  /// Opening curly brace `{`.
  LBrace,
  /// Closing curly brace `}`.
  RBrace,
  /// Opening square bracket `[`.
  LBracket,
  /// Closing square bracket `]`.
  RBracket,
  /// Colon separator `:`.
  Colon,
  /// Comma separator `,`.
  Comma,
  /// Decoded JSON string literal.
  String(String),
  /// Parsed JSON numeric literal.
  Number(serde_json::Number),
  /// Boolean `true` literal.
  True,
  /// Boolean `false` literal.
  False,
  /// Null literal.
  Null,
}

/// Lexical token with its byte span in the source JSONC text.
#[derive(Clone, Debug)]
struct Token {
  /// Start byte offset in the source document.
  offset: usize,
  /// Length in UTF-8 bytes.
  length: usize,
  /// Classified token payload.
  kind: TokenKind,
}

/// Parse or lexical failure with a source byte span.
#[derive(Clone, Debug)]
pub(super) struct LexError {
  /// Error message shown to the user.
  pub(super) message: String,
  /// Start byte offset of the invalid span.
  pub(super) offset: usize,
  /// Length in UTF-8 bytes of the invalid span.
  pub(super) length: usize,
}

/// Kind of JSONC abstract syntax tree node.
#[derive(Clone, Debug)]
pub(super) enum JsoncKind {
  /// JSON object with ordered property nodes.
  Object(Vec<JsoncProperty>),
  /// JSON array with ordered element nodes.
  Array(Vec<JsoncNode>),
  /// Decoded string value.
  String(String),
  /// Parsed numeric value.
  Number(serde_json::Number),
  /// Boolean value.
  Bool(bool),
  /// Null value.
  Null,
}

/// Object property entry inside a parsed JSONC object node.
#[derive(Clone, Debug)]
pub(super) struct JsoncProperty {
  /// Unescaped property key name.
  pub(super) key: String,
  /// Start byte offset of the key token.
  pub(super) key_offset: usize,
  /// Byte length of the key token.
  pub(super) key_length: usize,
  /// Parsed value node for this property.
  pub(super) value: JsoncNode,
}

/// JSONC syntax node paired with its UTF-8 byte span.
#[derive(Clone, Debug)]
pub(super) struct JsoncNode {
  /// Start byte offset of the node in the source text.
  pub(super) offset: usize,
  /// Byte length of the node in the source text.
  pub(super) length: usize,
  /// Node variant and child values.
  pub(super) kind: JsoncKind,
}

impl JsoncNode {
  /// Converts this JSONC syntax node into a `serde_json::Value`.
  pub(super) fn to_value(&self) -> Value {
    match &self.kind {
      JsoncKind::Object(props) => {
        let mut map = Map::new();
        for prop in props {
          map.insert(prop.key.clone(), prop.value.to_value());
        }
        Value::Object(map)
      }
      JsoncKind::Array(items) => Value::Array(items.iter().map(JsoncNode::to_value).collect()),
      JsoncKind::String(s) => Value::String(s.clone()),
      JsoncKind::Number(n) => Value::Number(n.clone()),
      JsoncKind::Bool(b) => Value::Bool(*b),
      JsoncKind::Null => Value::Null,
    }
  }
}

/// Checks whether a character is treated as whitespace between JSONC tokens.
fn is_json_whitespace(c: char) -> bool {
  matches!(
    c,
    ' ' | '\t' | '\r' | '\n' | '\u{FEFF}' | '\u{000B}' | '\u{000C}' | '\u{00A0}'
  )
}

/// Parses four hexadecimal ASCII bytes at `pos` into a UTF-16 code unit.
fn parse_hex4(bytes: &[u8], pos: usize) -> Option<u16> {
  if pos + 4 > bytes.len() {
    return None;
  }
  let slice = std::str::from_utf8(&bytes[pos..pos + 4]).ok()?;
  u16::from_str_radix(slice, 16).ok()
}

/// Scans `text` into a list of JSONC tokens while skipping line and block comments.
fn lex_jsonc(text: &str) -> std::result::Result<Vec<Token>, LexError> {
  let bytes = text.as_bytes();
  let mut pos = 0usize;
  let mut tokens = Vec::new();

  while pos < bytes.len() {
    let rest = &text[pos..];
    let Some(ch) = rest.chars().next() else {
      break;
    };
    if is_json_whitespace(ch) {
      pos += ch.len_utf8();
      continue;
    }
    if bytes[pos] == b'/' && pos + 1 < bytes.len() {
      if bytes[pos + 1] == b'/' {
        pos += 2;
        while pos < bytes.len() && bytes[pos] != b'\n' && bytes[pos] != b'\r' {
          pos += 1;
        }
        continue;
      }
      if bytes[pos + 1] == b'*' {
        let comment_start = pos;
        pos += 2;
        let mut closed = false;
        while pos + 1 < bytes.len() {
          if bytes[pos] == b'*' && bytes[pos + 1] == b'/' {
            pos += 2;
            closed = true;
            break;
          }
          pos += 1;
        }
        if !closed {
          return Err(LexError {
            message: "Unexpected end of comment.".into(),
            offset: comment_start,
            length: 2,
          });
        }
        continue;
      }
    }

    match bytes[pos] {
      b'{' => {
        tokens.push(Token {
          offset: pos,
          length: 1,
          kind: TokenKind::LBrace,
        });
        pos += 1;
      }
      b'}' => {
        tokens.push(Token {
          offset: pos,
          length: 1,
          kind: TokenKind::RBrace,
        });
        pos += 1;
      }
      b'[' => {
        tokens.push(Token {
          offset: pos,
          length: 1,
          kind: TokenKind::LBracket,
        });
        pos += 1;
      }
      b']' => {
        tokens.push(Token {
          offset: pos,
          length: 1,
          kind: TokenKind::RBracket,
        });
        pos += 1;
      }
      b':' => {
        tokens.push(Token {
          offset: pos,
          length: 1,
          kind: TokenKind::Colon,
        });
        pos += 1;
      }
      b',' => {
        tokens.push(Token {
          offset: pos,
          length: 1,
          kind: TokenKind::Comma,
        });
        pos += 1;
      }
      b'"' => {
        let start = pos;
        pos += 1;
        let mut out = String::new();
        let mut closed = false;
        while pos < bytes.len() {
          let b = bytes[pos];
          if b == b'"' {
            pos += 1;
            closed = true;
            break;
          }
          if b == b'\\' {
            let esc_pos = pos;
            pos += 1;
            if pos >= bytes.len() {
              return Err(LexError {
                message: "Unexpected end of string.".into(),
                offset: start,
                length: pos - start,
              });
            }
            match bytes[pos] {
              b'"' => {
                out.push('"');
                pos += 1;
              }
              b'\\' => {
                out.push('\\');
                pos += 1;
              }
              b'/' => {
                out.push('/');
                pos += 1;
              }
              b'b' => {
                out.push('\x08');
                pos += 1;
              }
              b'f' => {
                out.push('\x0c');
                pos += 1;
              }
              b'n' => {
                out.push('\n');
                pos += 1;
              }
              b'r' => {
                out.push('\r');
                pos += 1;
              }
              b't' => {
                out.push('\t');
                pos += 1;
              }
              b'u' => {
                pos += 1;
                let Some(code) = parse_hex4(bytes, pos) else {
                  return Err(LexError {
                    message: "Invalid unicode escape.".into(),
                    offset: esc_pos,
                    length: (bytes.len() - esc_pos).min(6),
                  });
                };
                pos += 4;
                if (0xD800..=0xDBFF).contains(&code) {
                  if pos + 6 <= bytes.len()
                    && bytes[pos] == b'\\'
                    && bytes[pos + 1] == b'u'
                    && let Some(low) = parse_hex4(bytes, pos + 2)
                    && (0xDC00..=0xDFFF).contains(&low)
                  {
                    pos += 6;
                    let combined =
                      0x10000 + ((((code as u32) - 0xD800) << 10) | ((low as u32) - 0xDC00));
                    let c = char::from_u32(combined).ok_or(LexError {
                      message: "Invalid unicode escape.".into(),
                      offset: esc_pos,
                      length: 6,
                    })?;
                    out.push(c);
                  } else {
                    return Err(LexError {
                      message: "Invalid unicode escape.".into(),
                      offset: esc_pos,
                      length: 6,
                    });
                  }
                } else if (0xDC00..=0xDFFF).contains(&code) {
                  return Err(LexError {
                    message: "Invalid unicode escape.".into(),
                    offset: esc_pos,
                    length: 6,
                  });
                } else {
                  let c = char::from_u32(code as u32).ok_or(LexError {
                    message: "Invalid unicode escape.".into(),
                    offset: esc_pos,
                    length: 6,
                  })?;
                  out.push(c);
                }
              }
              _ => {
                return Err(LexError {
                  message: "Invalid escape character in string.".into(),
                  offset: esc_pos,
                  length: 2.min(bytes.len() - esc_pos),
                });
              }
            }
            continue;
          }
          if b < 0x20 {
            return Err(LexError {
              message: "Invalid character in string.".into(),
              offset: pos,
              length: 1,
            });
          }
          let Some(c) = text[pos..].chars().next() else {
            break;
          };
          out.push(c);
          pos += c.len_utf8();
        }
        if !closed {
          return Err(LexError {
            message: "Unexpected end of string.".into(),
            offset: start,
            length: pos - start,
          });
        }
        tokens.push(Token {
          offset: start,
          length: pos - start,
          kind: TokenKind::String(out),
        });
      }
      b'-' | b'0'..=b'9' => {
        let start = pos;
        if bytes[pos] == b'-' {
          pos += 1;
          if pos >= bytes.len() || !bytes[pos].is_ascii_digit() {
            return Err(LexError {
              message: "Invalid number format.".into(),
              offset: start,
              length: pos - start,
            });
          }
        }
        if bytes[pos] == b'0' {
          pos += 1;
          if pos < bytes.len() && bytes[pos].is_ascii_digit() {
            return Err(LexError {
              message: "Invalid number format.".into(),
              offset: start,
              length: (pos + 1) - start,
            });
          }
        } else {
          while pos < bytes.len() && bytes[pos].is_ascii_digit() {
            pos += 1;
          }
        }
        if pos < bytes.len() && bytes[pos] == b'.' {
          pos += 1;
          if pos >= bytes.len() || !bytes[pos].is_ascii_digit() {
            return Err(LexError {
              message: "Invalid number format.".into(),
              offset: start,
              length: pos - start,
            });
          }
          while pos < bytes.len() && bytes[pos].is_ascii_digit() {
            pos += 1;
          }
        }
        if pos < bytes.len() && matches!(bytes[pos], b'e' | b'E') {
          pos += 1;
          if pos < bytes.len() && matches!(bytes[pos], b'+' | b'-') {
            pos += 1;
          }
          if pos >= bytes.len() || !bytes[pos].is_ascii_digit() {
            return Err(LexError {
              message: "Invalid number format.".into(),
              offset: start,
              length: pos - start,
            });
          }
          while pos < bytes.len() && bytes[pos].is_ascii_digit() {
            pos += 1;
          }
        }
        let slice = &text[start..pos];
        let num: serde_json::Number = serde_json::from_str(slice).map_err(|_| LexError {
          message: "Invalid number format.".into(),
          offset: start,
          length: pos - start,
        })?;
        tokens.push(Token {
          offset: start,
          length: pos - start,
          kind: TokenKind::Number(num),
        });
      }
      b'a'..=b'z' | b'A'..=b'Z' => {
        let start = pos;
        while pos < bytes.len() && (bytes[pos].is_ascii_alphanumeric() || bytes[pos] == b'_') {
          pos += 1;
        }
        let ident = &text[start..pos];
        let kind = match ident {
          "true" => TokenKind::True,
          "false" => TokenKind::False,
          "null" => TokenKind::Null,
          _ => {
            return Err(LexError {
              message: "Invalid symbol.".into(),
              offset: start,
              length: pos - start,
            });
          }
        };
        tokens.push(Token {
          offset: start,
          length: pos - start,
          kind,
        });
      }
      _ => {
        let len = ch.len_utf8();
        return Err(LexError {
          message: "Invalid symbol.".into(),
          offset: pos,
          length: len,
        });
      }
    }
  }

  Ok(tokens)
}

/// Recursive-descent cursor over a slice of JSONC tokens.
struct Parser<'a> {
  /// Token slice returned by [`lex_jsonc`].
  tokens: &'a [Token],
  /// Current token index.
  pos: usize,
  /// Byte length of the full source string for end-of-file error spans.
  text_len: usize,
}

impl<'a> Parser<'a> {
  /// Returns the current token without moving the cursor.
  fn peek(&self) -> Option<&Token> {
    self.tokens.get(self.pos)
  }

  /// Returns the current token and moves the cursor forward by one.
  fn next(&mut self) -> Option<&Token> {
    let tok = self.tokens.get(self.pos)?;
    self.pos += 1;
    Some(tok)
  }

  /// Builds a [`LexError`] at the current token or at the end of the source string.
  fn err_here(&self, message: &str) -> LexError {
    if let Some(tok) = self.peek() {
      LexError {
        message: message.into(),
        offset: tok.offset,
        length: tok.length,
      }
    } else {
      LexError {
        message: message.into(),
        offset: self.text_len,
        length: 0,
      }
    }
  }

  /// Parses one JSONC value node from the current cursor position.
  fn parse_value(&mut self) -> std::result::Result<JsoncNode, LexError> {
    let text_len = self.text_len;
    let tok = self.next().ok_or_else(|| LexError {
      message: "Value expected.".into(),
      offset: text_len,
      length: 0,
    })?;
    let tok_offset = tok.offset;
    let tok_length = tok.length;
    match &tok.kind {
      TokenKind::LBrace => self.parse_object(tok_offset),
      TokenKind::LBracket => self.parse_array(tok_offset),
      TokenKind::String(s) => Ok(JsoncNode {
        offset: tok_offset,
        length: tok_length,
        kind: JsoncKind::String(s.clone()),
      }),
      TokenKind::Number(n) => Ok(JsoncNode {
        offset: tok_offset,
        length: tok_length,
        kind: JsoncKind::Number(n.clone()),
      }),
      TokenKind::True => Ok(JsoncNode {
        offset: tok_offset,
        length: tok_length,
        kind: JsoncKind::Bool(true),
      }),
      TokenKind::False => Ok(JsoncNode {
        offset: tok_offset,
        length: tok_length,
        kind: JsoncKind::Bool(false),
      }),
      TokenKind::Null => Ok(JsoncNode {
        offset: tok_offset,
        length: tok_length,
        kind: JsoncKind::Null,
      }),
      _ => Err(LexError {
        message: "Value expected.".into(),
        offset: tok_offset,
        length: tok_length,
      }),
    }
  }

  /// Parses a JSONC object literal that started at `open_offset`.
  fn parse_object(&mut self, open_offset: usize) -> std::result::Result<JsoncNode, LexError> {
    let mut props = Vec::new();
    if let Some(tok) = self.peek()
      && tok.kind == TokenKind::RBrace
    {
      let close_end = tok.offset + tok.length;
      self.pos += 1;
      return Ok(JsoncNode {
        offset: open_offset,
        length: close_end - open_offset,
        kind: JsoncKind::Object(props),
      });
    }

    loop {
      let key_tok = self.peek().ok_or_else(|| LexError {
        message: "Property expected.".into(),
        offset: self.text_len,
        length: 0,
      })?;
      let (key, key_offset, key_length) = match &key_tok.kind {
        TokenKind::String(s) => (s.clone(), key_tok.offset, key_tok.length),
        _ => return Err(self.err_here("Property expected.")),
      };
      self.pos += 1;

      let colon_tok = self.peek().ok_or_else(|| LexError {
        message: "Colon expected.".into(),
        offset: self.text_len,
        length: 0,
      })?;
      if colon_tok.kind != TokenKind::Colon {
        return Err(self.err_here("Colon expected."));
      }
      self.pos += 1;

      let value = self.parse_value()?;
      props.push(JsoncProperty {
        key,
        key_offset,
        key_length,
        value,
      });

      match self.peek() {
        Some(tok) if tok.kind == TokenKind::Comma => {
          self.pos += 1;
          if let Some(next) = self.peek()
            && next.kind == TokenKind::RBrace
          {
            let close_end = next.offset + next.length;
            self.pos += 1;
            return Ok(JsoncNode {
              offset: open_offset,
              length: close_end - open_offset,
              kind: JsoncKind::Object(props),
            });
          }
        }
        Some(tok) if tok.kind == TokenKind::RBrace => {
          let close_end = tok.offset + tok.length;
          self.pos += 1;
          return Ok(JsoncNode {
            offset: open_offset,
            length: close_end - open_offset,
            kind: JsoncKind::Object(props),
          });
        }
        _ => return Err(self.err_here("Expected comma or closing brace.")),
      }
    }
  }

  /// Parses a JSONC array literal that started at `open_offset`.
  fn parse_array(&mut self, open_offset: usize) -> std::result::Result<JsoncNode, LexError> {
    let mut items = Vec::new();
    if let Some(tok) = self.peek()
      && tok.kind == TokenKind::RBracket
    {
      let close_end = tok.offset + tok.length;
      self.pos += 1;
      return Ok(JsoncNode {
        offset: open_offset,
        length: close_end - open_offset,
        kind: JsoncKind::Array(items),
      });
    }

    loop {
      items.push(self.parse_value()?);
      match self.peek() {
        Some(tok) if tok.kind == TokenKind::Comma => {
          self.pos += 1;
          if let Some(next) = self.peek()
            && next.kind == TokenKind::RBracket
          {
            let close_end = next.offset + next.length;
            self.pos += 1;
            return Ok(JsoncNode {
              offset: open_offset,
              length: close_end - open_offset,
              kind: JsoncKind::Array(items),
            });
          }
        }
        Some(tok) if tok.kind == TokenKind::RBracket => {
          let close_end = tok.offset + tok.length;
          self.pos += 1;
          return Ok(JsoncNode {
            offset: open_offset,
            length: close_end - open_offset,
            kind: JsoncKind::Array(items),
          });
        }
        _ => return Err(self.err_here("Expected comma or closing bracket.")),
      }
    }
  }
}

/// Parses a JSONC document string into an optional root syntax node.
pub(super) fn parse_jsonc_ast(text: &str) -> std::result::Result<Option<JsoncNode>, LexError> {
  let tokens = lex_jsonc(text)?;
  if tokens.is_empty() {
    return Ok(None);
  }
  let mut parser = Parser {
    tokens: &tokens,
    pos: 0,
    text_len: text.len(),
  };
  let root = parser.parse_value()?;
  if let Some(extra) = parser.peek() {
    return Err(LexError {
      message: "End of file expected.".into(),
      offset: extra.offset,
      length: extra.length,
    });
  }
  Ok(Some(root))
}

/// Finds the JSONC node at `path` inside `node`.
pub(super) fn find_node_at_path<'a>(
  mut node: &'a JsoncNode,
  path: &[PathSegment],
) -> Option<&'a JsoncNode> {
  for seg in path {
    match (seg, &node.kind) {
      (PathSegment::Key(k), JsoncKind::Object(props)) => {
        let prop = props.iter().find(|p| p.key == *k)?;
        node = &prop.value;
      }
      (PathSegment::Index(idx), JsoncKind::Array(items)) => {
        node = items.get(*idx)?;
      }
      _ => return None,
    }
  }
  Some(node)
}

/// Returns the `(offset, length)` byte span for `path` in `text`, or a safe fallback span.
pub(super) fn resolve_path_span(text: &str, path: &[PathSegment]) -> (usize, usize) {
  if let Ok(Some(root)) = parse_jsonc_ast(text)
    && let Some(node) = find_node_at_path(&root, path)
  {
    return (node.offset, node.length);
  }
  (0, 1.min(text.len()))
}

/// Verifies that no JSON object inside `node` contains duplicate property keys.
pub(super) fn check_unique_keys(
  node: &JsoncNode,
  path: &mut Vec<PathSegment>,
) -> std::result::Result<(), TypeEditError> {
  match &node.kind {
    JsoncKind::Object(props) => {
      let mut seen = HashSet::new();
      for prop in props {
        if !seen.insert(prop.key.as_str()) {
          return Err(TypeEditError::at_span(
            format!("Duplicate property \"{}\".", prop.key),
            path.clone(),
            prop.key_offset,
            prop.key_length,
          ));
        }
        path.push(PathSegment::Key(prop.key.clone()));
        check_unique_keys(&prop.value, path)?;
        path.pop();
      }
    }
    JsoncKind::Array(items) => {
      for (i, item) in items.iter().enumerate() {
        path.push(PathSegment::Index(i));
        check_unique_keys(item, path)?;
        path.pop();
      }
    }
    _ => {}
  }
  Ok(())
}
