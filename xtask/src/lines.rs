// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Checks the code-line limit of each Rust and Lua source file.

use crate::{lexer, workspace};

/// Maximum number of non-comment, non-blank code lines in one file.
const LIMIT: usize = 800;

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

/// Verifies that no Rust or Lua file exceeds [`LIMIT`] lines of code.
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
