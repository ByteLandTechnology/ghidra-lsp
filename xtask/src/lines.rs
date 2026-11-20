// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Checks the code-line limit of each Rust, Lua, and TypeScript source file.

use crate::{lexer, workspace};

/// Maximum number of non-comment, non-blank code lines in one file.
const LIMIT: usize = 800;

/// Active lexical context while scanning TypeScript source lines.
enum TsState {
  /// Regular code outside comments, strings, templates, and regular expressions.
  Normal {
    /// Whether `/` starts a regular expression literal instead of division.
    can_start_regex: bool,
  },
  /// Single-line `//` comment extending to the next newline.
  LineComment {
    /// Saved `can_start_regex` state to restore after the newline.
    can_start_regex: bool,
  },
  /// Multi-line `/* ... */` block comment.
  BlockComment {
    /// Saved `can_start_regex` state to restore after `*/`.
    can_start_regex: bool,
  },
  /// Quoted single-line string literal `'...'` or `"..."`.
  ShortString(u8),
  /// Template literal `` `...` `` supporting `${...}` expression interpolations.
  Template,
  /// Single-line `/.../` regular expression literal.
  Regex {
    /// Whether the scanner is inside a `[...]` character class.
    in_class: bool,
  },
}

/// Active lexical context while scanning Lua source lines.
enum LuaState {
  /// Regular Lua code outside comments and string literals.
  Normal,
  /// Single-line `--` comment extending to the next newline.
  LineComment,
  /// Long bracket comment `--[=[ ... ]=]` closed by `eq_count` equals signs.
  BlockComment(usize),
  /// Quoted single-line string `'...'` or `"..."`.
  ShortString(u8),
  /// Long bracket string `[=[ ... ]=]` closed by `eq_count` equals signs.
  LongString(usize),
}

/// Parses a Lua long bracket opener (`[=*[`) or closer (`]=*]`) starting at `start`.
fn long_bracket(bytes: &[u8], start: usize, delim: u8) -> Option<(usize, usize)> {
  if *bytes.get(start)? != delim {
    return None;
  }
  let mut eq_count = 0_usize;
  while bytes.get(start + 1 + eq_count) == Some(&b'=') {
    eq_count += 1;
  }
  if *bytes.get(start + 1 + eq_count)? == delim {
    Some((eq_count, eq_count + 2))
  } else {
    None
  }
}

/// Counts non-comment, non-blank lines in a Lua source file.
fn lua_code_lines(source: &str) -> usize {
  let bytes = source.as_bytes();
  let mut state = LuaState::Normal;
  let mut count = 0_usize;
  let mut has_code = false;
  let mut index = 0_usize;

  while index < bytes.len() {
    let byte = bytes[index];
    if byte == b'\n' {
      if has_code {
        count += 1;
        has_code = false;
      }
      if matches!(state, LuaState::LineComment | LuaState::ShortString(_)) {
        state = LuaState::Normal;
      }
      index += 1;
      continue;
    }

    match state {
      LuaState::LineComment => index += 1,
      LuaState::BlockComment(eq_count) => {
        if let Some((close_eq, len)) = long_bracket(bytes, index, b']')
          && close_eq == eq_count
        {
          state = LuaState::Normal;
          index += len;
        } else {
          index += 1;
        }
      }
      LuaState::ShortString(quote) => {
        if !byte.is_ascii_whitespace() {
          has_code = true;
        }
        if byte == b'\\' && index + 1 < bytes.len() {
          if bytes[index + 1] == b'\n' {
            count += usize::from(has_code);
            has_code = false;
          }
          index += 2;
        } else if byte == quote {
          state = LuaState::Normal;
          index += 1;
        } else {
          index += 1;
        }
      }
      LuaState::LongString(eq_count) => {
        if !byte.is_ascii_whitespace() {
          has_code = true;
        }
        if let Some((close_eq, len)) = long_bracket(bytes, index, b']')
          && close_eq == eq_count
        {
          state = LuaState::Normal;
          index += len;
        } else {
          index += 1;
        }
      }
      LuaState::Normal => {
        if byte.is_ascii_whitespace() {
          index += 1;
        } else if byte == b'-' && bytes.get(index + 1) == Some(&b'-') {
          if let Some((eq_count, len)) = long_bracket(bytes, index + 2, b'[') {
            state = LuaState::BlockComment(eq_count);
            index += 2 + len;
          } else {
            state = LuaState::LineComment;
            index += 2;
          }
        } else if byte == b'\'' || byte == b'"' {
          has_code = true;
          state = LuaState::ShortString(byte);
          index += 1;
        } else if let Some((eq_count, len)) = long_bracket(bytes, index, b'[') {
          has_code = true;
          state = LuaState::LongString(eq_count);
          index += len;
        } else {
          has_code = true;
          index += 1;
        }
      }
    }
  }

  if has_code {
    count += 1;
  }
  count
}

/// Returns whether an identifier or keyword allows a following `/` regex literal.
fn is_regex_prefix_keyword(ident: &[u8]) -> bool {
  matches!(
    ident,
    b"return"
      | b"case"
      | b"throw"
      | b"else"
      | b"do"
      | b"typeof"
      | b"void"
      | b"delete"
      | b"in"
      | b"instanceof"
      | b"new"
      | b"await"
      | b"yield"
      | b"of"
  )
}

/// Returns whether a punctuation byte allows a following `/` regex literal.
fn allows_regex_after_punct(byte: u8) -> bool {
  matches!(
    byte,
    b'('
      | b'['
      | b'{'
      | b','
      | b';'
      | b':'
      | b'='
      | b'!'
      | b'&'
      | b'|'
      | b'?'
      | b'+'
      | b'-'
      | b'*'
      | b'/'
      | b'%'
      | b'<'
      | b'>'
      | b'~'
      | b'^'
  )
}

/// Counts non-comment, non-blank lines in a TypeScript source file.
fn ts_code_lines(source: &str) -> usize {
  let bytes = source.as_bytes();
  let mut state = TsState::Normal {
    can_start_regex: true,
  };
  let mut template_braces: Vec<usize> = Vec::new();
  let mut count = 0_usize;
  let mut has_code = false;
  let mut index = 0_usize;

  while index < bytes.len() {
    let byte = bytes[index];
    if byte == b'\n' {
      if has_code {
        count += 1;
        has_code = false;
      }
      state = match state {
        TsState::LineComment { can_start_regex } => TsState::Normal { can_start_regex },
        TsState::ShortString(_) | TsState::Regex { .. } => TsState::Normal {
          can_start_regex: false,
        },
        other => other,
      };
      index += 1;
      continue;
    }

    match state {
      TsState::LineComment { .. } => index += 1,
      TsState::BlockComment { can_start_regex } => {
        if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
          state = TsState::Normal { can_start_regex };
          index += 2;
        } else {
          index += 1;
        }
      }
      TsState::ShortString(quote) => {
        if !byte.is_ascii_whitespace() {
          has_code = true;
        }
        if byte == b'\\' && index + 1 < bytes.len() {
          if bytes[index + 1] == b'\n' {
            count += usize::from(has_code);
            has_code = false;
          }
          index += 2;
        } else if byte == quote {
          state = TsState::Normal {
            can_start_regex: false,
          };
          index += 1;
        } else {
          index += 1;
        }
      }
      TsState::Template => {
        if !byte.is_ascii_whitespace() {
          has_code = true;
        }
        if byte == b'\\' && index + 1 < bytes.len() {
          if bytes[index + 1] == b'\n' {
            count += usize::from(has_code);
            has_code = false;
          }
          index += 2;
        } else if byte == b'$' && bytes.get(index + 1) == Some(&b'{') {
          template_braces.push(0);
          state = TsState::Normal {
            can_start_regex: true,
          };
          index += 2;
        } else if byte == b'`' {
          state = TsState::Normal {
            can_start_regex: false,
          };
          index += 1;
        } else {
          index += 1;
        }
      }
      TsState::Regex { in_class } => {
        has_code = true;
        if byte == b'\\' && index + 1 < bytes.len() {
          index += 2;
        } else if byte == b'[' && !in_class {
          state = TsState::Regex { in_class: true };
          index += 1;
        } else if byte == b']' && in_class {
          state = TsState::Regex { in_class: false };
          index += 1;
        } else if byte == b'/' && !in_class {
          state = TsState::Normal {
            can_start_regex: false,
          };
          index += 1;
        } else {
          index += 1;
        }
      }
      TsState::Normal { can_start_regex } => {
        if byte.is_ascii_whitespace() {
          index += 1;
        } else if byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
          state = TsState::LineComment { can_start_regex };
          index += 2;
        } else if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
          state = TsState::BlockComment { can_start_regex };
          index += 2;
        } else if byte == b'/' && can_start_regex {
          has_code = true;
          state = TsState::Regex { in_class: false };
          index += 1;
        } else if byte == b'\'' || byte == b'"' {
          has_code = true;
          state = TsState::ShortString(byte);
          index += 1;
        } else if byte == b'`' {
          has_code = true;
          state = TsState::Template;
          index += 1;
        } else if byte == b'{' {
          has_code = true;
          if let Some(depth) = template_braces.last_mut() {
            *depth += 1;
          }
          state = TsState::Normal {
            can_start_regex: true,
          };
          index += 1;
        } else if byte == b'}' {
          has_code = true;
          match template_braces.last_mut() {
            Some(depth) if *depth == 0 => {
              template_braces.pop();
              state = TsState::Template;
            }
            Some(depth) => {
              *depth -= 1;
              state = TsState::Normal {
                can_start_regex: false,
              };
            }
            None => {
              state = TsState::Normal {
                can_start_regex: true,
              };
            }
          }
          index += 1;
        } else if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') {
          has_code = true;
          let start = index;
          while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'$'))
          {
            index += 1;
          }
          state = TsState::Normal {
            can_start_regex: is_regex_prefix_keyword(&bytes[start..index]),
          };
        } else {
          has_code = true;
          state = TsState::Normal {
            can_start_regex: allows_regex_after_punct(byte),
          };
          index += 1;
        }
      }
    }
  }

  if has_code {
    count += 1;
  }
  count
}

/// Verifies that no Rust, Lua, or TypeScript file exceeds [`LIMIT`] lines of code.
pub(crate) fn check() -> Result<(), String> {
  let mut over = Vec::new();
  for path in workspace::rust_files()? {
    let source = workspace::read(&path)?;
    let count = lexer::lex(&source)
      .iter()
      .filter(|line| line.has_code)
      .count();
    if count > LIMIT {
      over.push((count, workspace::display(&path)));
    }
  }
  for path in workspace::lua_files()? {
    let source = workspace::read(&path)?;
    let count = lua_code_lines(&source);
    if count > LIMIT {
      over.push((count, workspace::display(&path)));
    }
  }
  for path in workspace::ts_files()? {
    let source = workspace::read(&path)?;
    let count = ts_code_lines(&source);
    if count > LIMIT {
      over.push((count, workspace::display(&path)));
    }
  }
  if over.is_empty() {
    println!("Line limit: OK");
    return Ok(());
  }
  over.sort_by(|left, right| right.cmp(left));
  let list: Vec<String> = over
    .iter()
    .map(|(count, path)| format!("  {count}\t{path}"))
    .collect();
  Err(format!(
    "Line limit: these files have more than {LIMIT} lines of code:\n{}",
    list.join("\n")
  ))
}
