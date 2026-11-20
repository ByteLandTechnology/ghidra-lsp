// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! A small Rust lexer that separates code from comments and literals.

/// One line of a Rust source file after lexing.
pub(crate) struct Line {
  /// The line with comments removed and literal contents replaced by spaces.
  pub(crate) code: String,
  /// Whether the line contains non-whitespace code tokens or literals.
  pub(crate) has_code: bool,
}

/// Active lexical scanner state across characters.
enum State {
  /// Scanning normal Rust code outside comments and string literals.
  Code,
  /// Scanning inside a nested block comment with the given nesting depth.
  BlockComment(usize),
  /// Scanning inside a standard quoted string literal.
  Str,
  /// Scanning inside a raw string literal delimited by `usize` hash signs.
  RawStr(usize),
}

/// Splits `source` into lines and classifies each character.
pub(crate) fn lex(source: &str) -> Vec<Line> {
  let chars: Vec<char> = source.chars().collect();
  let mut lines = Vec::new();
  let mut code = String::new();
  let mut has_code = false;
  let mut state = State::Code;
  let mut index = 0;
  while let Some(&current) = chars.get(index) {
    let next = chars.get(index + 1).copied();
    if current == '\n' {
      lines.push(Line {
        code: std::mem::take(&mut code),
        has_code,
      });
      has_code = false;
      index += 1;
      continue;
    }
    match state {
      State::Code => {
        if current == '/' && next == Some('/') {
          // Skip the rest of the line.
          while chars.get(index).is_some_and(|c| *c != '\n') {
            index += 1;
          }
          continue;
        }
        if current == '/' && next == Some('*') {
          state = State::BlockComment(1);
          index += 2;
          continue;
        }
        if let Some(hashes) = raw_string_start(&chars, index) {
          code.push('r');
          code.push('"');
          has_code = true;
          state = State::RawStr(hashes);
          index += hashes + 2;
          continue;
        }
        if current == '"' {
          code.push('"');
          has_code = true;
          state = State::Str;
          index += 1;
          continue;
        }
        if current == '\''
          && let Some(length) = char_literal_length(&chars, index)
        {
          code.push_str("' '");
          has_code = true;
          index += length;
          continue;
        }
        if !current.is_whitespace() {
          has_code = true;
        }
        code.push(current);
        index += 1;
      }
      State::BlockComment(depth) => {
        if current == '/' && next == Some('*') {
          state = State::BlockComment(depth + 1);
          index += 2;
        } else if current == '*' && next == Some('/') {
          state = if depth == 1 {
            State::Code
          } else {
            State::BlockComment(depth - 1)
          };
          index += 2;
        } else {
          index += 1;
        }
      }
      State::Str => {
        has_code = true;
        if current == '\\' && next.is_some_and(|c| c != '\n') {
          code.push_str("  ");
          index += 2;
        } else if current == '"' {
          code.push('"');
          state = State::Code;
          index += 1;
        } else {
          code.push(' ');
          index += 1;
        }
      }
      State::RawStr(hashes) => {
        has_code = true;
        if current == '"' && (1..=hashes).all(|n| chars.get(index + n) == Some(&'#')) {
          code.push('"');
          state = State::Code;
          index += hashes + 1;
        } else {
          code.push(' ');
          index += 1;
        }
      }
    }
  }
  if !code.is_empty() || has_code {
    lines.push(Line { code, has_code });
  }
  lines
}

/// Returns the number of `#` characters if a raw string starts at `index`.
fn raw_string_start(chars: &[char], index: usize) -> Option<usize> {
  if chars.get(index) != Some(&'r') {
    return None;
  }
  let previous = index.checked_sub(1).and_then(|i| chars.get(i));
  if previous.is_some_and(|c| c.is_alphanumeric() || *c == '_') && previous != Some(&'b') {
    return None;
  }
  let hashes = chars
    .iter()
    .skip(index + 1)
    .take_while(|c| **c == '#')
    .count();
  (chars.get(index + 1 + hashes) == Some(&'"')).then_some(hashes)
}

/// Returns the length of a character literal at `index`, or `None` for lifetimes.
fn char_literal_length(chars: &[char], index: usize) -> Option<usize> {
  match chars.get(index + 1) {
    Some('\\') => {
      let close = chars
        .iter()
        .skip(index + 2)
        .take(10)
        .position(|c| *c == '\'')?;
      Some(close + 3)
    }
    Some(_) if chars.get(index + 2) == Some(&'\'') => Some(3),
    _ => None,
  }
}

/// One code token and its 1-based source line number.
pub(crate) struct Token {
  /// Identifier or single-character punctuation token text.
  pub(crate) text: String,
  /// One-based line number in the source file.
  pub(crate) line: usize,
}

/// Splits code into identifiers and single-character punctuation tokens.
pub(crate) fn tokens(source: &str) -> Vec<Token> {
  let mut tokens = Vec::new();
  for (index, line) in lex(source).into_iter().enumerate() {
    let mut identifier = String::new();
    for character in line.code.chars() {
      if character.is_alphanumeric() || character == '_' {
        identifier.push(character);
        continue;
      }
      if !identifier.is_empty() {
        tokens.push(Token {
          text: std::mem::take(&mut identifier),
          line: index + 1,
        });
      }
      if !character.is_whitespace() {
        tokens.push(Token {
          text: character.to_string(),
          line: index + 1,
        });
      }
    }
    if !identifier.is_empty() {
      tokens.push(Token {
        text: identifier,
        line: index + 1,
      });
    }
  }
  tokens
}
