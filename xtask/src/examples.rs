// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Finds Rust code examples in documentation comments and Markdown files.

use std::path::{Component, Path, PathBuf};

use crate::{lexer, workspace};

/// Code-fence info words that rustdoc compiles as Rust doctests.
const RUST_INFO: &[&str] = &[
  "",
  "rust",
  "no_run",
  "ignore",
  "should_panic",
  "compile_fail",
];

/// Returns each file and 1-based line number containing a Rust doc example.
pub(crate) fn find(path: &Path, source: &str) -> Result<Vec<(PathBuf, usize)>, String> {
  let doc_lines = documentation_lines(source);
  let mut found: Vec<(PathBuf, usize)> = rust_blocks(doc_lines)
    .into_iter()
    .map(|number| (path.to_path_buf(), number))
    .collect();
  for (number, text) in attribute_docs(source) {
    if !markdown(&text).is_empty() {
      found.push((path.to_path_buf(), number));
    }
  }
  for included in included_docs(path, source) {
    let text = workspace::read(&included)?;
    found.extend(
      rust_blocks(text.lines().map(Some))
        .into_iter()
        .map(|number| (included.clone(), number)),
    );
  }
  Ok(found)
}

/// Returns the 1-based line number of each Rust code block in a Markdown file.
pub(crate) fn markdown(source: &str) -> Vec<usize> {
  rust_blocks(source.lines().map(Some))
}

/// Extracts documentation comment text per source line (`None` for non-doc lines).
fn documentation_lines(source: &str) -> impl Iterator<Item = Option<&str>> {
  let mut block = false;
  source.lines().map(move |line| {
    let line = line.trim_start();
    if let Some(line) = line
      .strip_prefix("///")
      .or_else(|| line.strip_prefix("//!"))
    {
      return Some(line.strip_prefix(' ').unwrap_or(line));
    }
    let line = if block {
      line
        .strip_prefix('*')
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .unwrap_or(line)
    } else {
      let line = line
        .strip_prefix("/**")
        .or_else(|| line.strip_prefix("/*!"))?;
      block = true;
      line
    };
    if let Some((line, _)) = line.split_once("*/") {
      block = false;
      Some(line)
    } else if line == "/" {
      block = false;
      None
    } else {
      Some(line)
    }
  })
}

/// Returns 1-based line numbers where fenced or indented Rust blocks start.
fn rust_blocks<'a>(lines: impl Iterator<Item = Option<&'a str>>) -> Vec<usize> {
  let mut found = Vec::new();
  let mut fence = None;
  let mut paragraph = false;
  let mut indented = false;
  let mut list_indent = 0;
  for (index, line) in lines.enumerate() {
    let Some(line) = line else {
      fence = None;
      paragraph = false;
      indented = false;
      list_indent = 0;
      continue;
    };
    let line = quote_content(line);
    let trimmed = line.trim();
    if let Some((open_marker, open_length)) = fence {
      if let Some((marker, length, info)) = fence_start(trimmed)
        && marker == open_marker
        && length >= open_length
        && info.is_empty()
      {
        fence = None;
      }
      continue;
    }
    if trimmed.is_empty() {
      paragraph = false;
      continue;
    }
    let (indent, content) = indentation(line);
    let (indent, content) = if let Some((padding, content)) = list_item(content) {
      list_indent = indent + padding;
      paragraph = false;
      indented = false;
      (0, content)
    } else if indent >= list_indent {
      (indent - list_indent, content)
    } else {
      if !paragraph {
        list_indent = 0;
      }
      (indent, content)
    };
    if indent >= 4 && (indented || !paragraph) {
      if !indented {
        found.push(index + 1);
      }
      indented = true;
      continue;
    }
    indented = false;
    if let Some((marker, length, info)) = fence_start(content) {
      fence = Some((marker, length));
      paragraph = false;
      if is_rust(info) {
        found.push(index + 1);
      }
      continue;
    }
    paragraph = !content.starts_with('#');
  }
  found
}

/// Strips leading Markdown blockquote markers from a line.
fn quote_content(mut line: &str) -> &str {
  while let Some(content) = line.trim_start().strip_prefix('>') {
    line = content.strip_prefix(' ').unwrap_or(content);
  }
  line
}

/// Computes leading indentation column count and returns the remaining slice.
fn indentation(line: &str) -> (usize, &str) {
  let mut columns = 0;
  for (index, character) in line.char_indices() {
    match character {
      ' ' => columns += 1,
      '\t' => columns += 4 - columns % 4,
      _ => return (columns, &line[index..]),
    }
  }
  (columns, "")
}

/// Recognizes a Markdown bullet or numbered list prefix and returns content.
fn list_item(line: &str) -> Option<(usize, &str)> {
  let marker = if line.starts_with(['-', '+', '*']) {
    1
  } else {
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 || digits > 9 || !line.get(digits..)?.starts_with(['.', ')']) {
      return None;
    }
    digits + 1
  };
  let content = line.get(marker..)?.strip_prefix(' ')?;
  Some((marker + 1, content))
}

/// Parses an opening or closing code fence delimiter line.
fn fence_start(line: &str) -> Option<(char, usize, &str)> {
  let marker = line
    .chars()
    .next()
    .filter(|marker| matches!(marker, '`' | '~'))?;
  let length = line
    .chars()
    .take_while(|character| *character == marker)
    .count();
  (length >= 3).then(|| (marker, length, line[length..].trim()))
}

/// Extracts string literals from `#[doc = "..."]` attributes.
fn attribute_docs(source: &str) -> Vec<(usize, String)> {
  let tokens = lexer::tokens(source);
  let lines: Vec<&str> = source.split_inclusive('\n').collect();
  let mut offsets = Vec::with_capacity(lines.len());
  let mut offset = 0;
  for line in &lines {
    offsets.push(offset);
    offset += line.len();
  }
  let mut docs = Vec::new();
  for (index, token) in tokens.iter().enumerate() {
    if token.text != "#" {
      continue;
    }
    let start = index + 1 + usize::from(tokens.get(index + 1).is_some_and(|part| part.text == "!"));
    let Some(parts) = tokens.get(start..start + 3) else {
      continue;
    };
    if parts[0].text != "[" || parts[1].text != "doc" || parts[2].text != "=" {
      continue;
    }
    let Some(offset) = token.line.checked_sub(1).and_then(|line| offsets.get(line)) else {
      continue;
    };
    if let Some(text) = doc_literal(&source[*offset..]) {
      docs.push((token.line, text));
    }
  }
  docs
}

/// Decodes a Rust string or raw string literal from an attribute line.
fn doc_literal(source: &str) -> Option<String> {
  let source = source.trim_start().strip_prefix('#')?.trim_start();
  let source = source.strip_prefix('!').unwrap_or(source).trim_start();
  let source = source.strip_prefix('[')?.trim_start();
  let source = source.strip_prefix("doc")?.trim_start();
  let source = source.strip_prefix('=')?.trim_start();
  if let Some(raw) = source.strip_prefix('r') {
    let hashes = raw.bytes().take_while(|byte| *byte == b'#').count();
    let content = raw.get(hashes..)?.strip_prefix('"')?;
    let delimiter = format!("\"{}", "#".repeat(hashes));
    return Some(content.split_once(&delimiter)?.0.to_owned());
  }
  let mut characters = source.strip_prefix('"')?.chars();
  let mut text = String::new();
  while let Some(character) = characters.next() {
    match character {
      '"' => return Some(text),
      '\\' => match characters.next()? {
        'n' => text.push('\n'),
        'r' => text.push('\r'),
        't' => text.push('\t'),
        '0' => text.push('\0'),
        '\\' => text.push('\\'),
        '\'' => text.push('\''),
        '"' => text.push('"'),
        'x' => {
          let high = characters.next()?.to_digit(16)?;
          let low = characters.next()?.to_digit(16)?;
          text.push(char::from_u32(high * 16 + low)?);
        }
        'u' => {
          if characters.next()? != '{' {
            return None;
          }
          let digits: String = characters
            .by_ref()
            .take_while(|character| *character != '}')
            .collect();
          let digits = digits.replace('_', "");
          text.push(char::from_u32(u32::from_str_radix(&digits, 16).ok()?)?);
        }
        '\n' => {
          characters = characters.as_str().trim_start().chars();
        }
        _ => return None,
      },
      other => text.push(other),
    }
  }
  None
}

/// Returns true if a code fence info string denotes Rust code for rustdoc.
fn is_rust(info: &str) -> bool {
  let first = info.trim().split([' ', ',']).next().unwrap_or_default();
  RUST_INFO.contains(&first) || first.starts_with("edition")
}

/// Returns each file included by `#![doc = include_str!("...")]`.
fn included_docs(path: &Path, source: &str) -> Vec<PathBuf> {
  let Some(directory) = path.parent() else {
    return Vec::new();
  };
  source
    .lines()
    .filter(|line| line.trim_start().starts_with("#![doc"))
    .filter_map(|line| {
      let start = line.find("include_str!(\"")? + "include_str!(\"".len();
      let end = line.get(start..)?.find('"')? + start;
      line.get(start..end)
    })
    .map(|relative| normalize(&directory.join(relative)))
    .collect()
}

/// Normalizes `.` and `..` path components without reading the filesystem.
fn normalize(path: &Path) -> PathBuf {
  let mut normal = PathBuf::new();
  for component in path.components() {
    match component {
      Component::CurDir => {}
      Component::ParentDir => {
        normal.pop();
      }
      other => normal.push(other),
    }
  }
  normal
}
