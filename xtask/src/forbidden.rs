// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Finds code, attributes, manifests, and directories forbidden by `AGENTS.md`.

use std::path::Path;

use crate::{examples, lexer, workspace};

/// Attribute and macro names reserved for tests or benchmarks.
const TEST_NAMES: &[&str] = &[
  "test",
  "bench",
  "rstest",
  "test_case",
  "test_matrix",
  "test_casing",
  "proptest",
  "quickcheck",
  "parameterized",
  "should_panic",
];

/// Dependency prefixes reserved for JavaScript or TypeScript test suites.
const TEST_PACKAGE_PREFIXES: &[&str] = &[
  "\"@vscode/test-electron\":",
  "\"@vscode/test-cli\":",
  "\"mocha\":",
  "\"vitest\":",
  "\"jest\":",
  "\"ava\":",
  "\"tap\":",
];

/// Checks all workspace sources, manifests, and markdown files for violations.
pub(crate) fn check() -> Result<(), String> {
  let mut findings = Vec::new();
  for path in workspace::test_directories()? {
    findings.push(format!(
      "  {}: test directories belong outside this repository",
      workspace::display(&path)
    ));
  }
  let lib_path = workspace::root()?.join("src/lib.rs");
  if lib_path.exists() {
    findings.push(format!(
      "  {}: src/lib.rs is forbidden in the binary-only layout",
      workspace::display(&lib_path)
    ));
  }
  for path in workspace::rust_files()? {
    let source = workspace::read(&path)?;
    check_rust(&path, &source, &mut findings);
    for (file, number) in examples::find(&path, &source)? {
      report(
        &file,
        number,
        "a Rust code example in documentation",
        &mut findings,
      );
    }
  }
  for path in workspace::markdown_files()? {
    let source = workspace::read(&path)?;
    for number in examples::markdown(&source) {
      report(
        &path,
        number,
        "a Rust code example in documentation",
        &mut findings,
      );
    }
  }
  for path in workspace::manifests()? {
    check_manifest(&path, &workspace::read(&path)?, &mut findings);
  }
  for path in workspace::package_manifests()? {
    check_package_manifest(&path, &workspace::read(&path)?, &mut findings);
  }
  findings.sort();
  findings.dedup();
  if findings.is_empty() {
    println!("Forbidden code: OK");
    Ok(())
  } else {
    Err(format!("Forbidden code:\n{}", findings.join("\n")))
  }
}

/// Scans tokenized Rust source for forbidden attributes, `cfg(test)`, and `async_trait`.
fn check_rust(path: &Path, source: &str, findings: &mut Vec<String>) {
  let tokens = lexer::tokens(source);
  for (index, token) in tokens.iter().enumerate() {
    if token.text == "async_trait" {
      report(path, token.line, "the async-trait crate", findings);
    }
    if let Some(attr) = attribute(&tokens[index..]) {
      if attr
        .iter()
        .any(|part| TEST_NAMES.contains(&part.text.as_str()))
      {
        report(
          path,
          token.line,
          "test attributes belong outside this repository",
          findings,
        );
      }
      if attr
        .windows(2)
        .any(|parts| matches!(parts[0].text.as_str(), "allow" | "expect") && parts[1].text == "(")
      {
        report(
          path,
          token.line,
          "lint attributes (#[allow] or #[expect])",
          findings,
        );
      }
      if attr.first().is_some_and(|part| part.text == "cfg")
        && group(&attr[1..], "(", ")").is_some_and(|parts| parts.iter().any(|p| p.text == "test"))
      {
        report(
          path,
          token.line,
          "cfg(test) belongs outside this repository",
          findings,
        );
      }
    }
    if tokens.get(index + 1).is_some_and(|next| next.text == "!") {
      let test_macro = TEST_NAMES.contains(&token.text.as_str());
      let test_config = token.text == "cfg"
        && group(&tokens[index + 2..], "(", ")")
          .is_some_and(|parts| parts.iter().any(|part| part.text == "test"));
      if test_macro || test_config {
        report(
          path,
          token.line,
          "test macros belong outside this repository",
          findings,
        );
      }
    }
  }
}

/// Extracts the inner token slice of a `#` or `#!` attribute if present at `tokens[0]`.
fn attribute(tokens: &[lexer::Token]) -> Option<&[lexer::Token]> {
  if tokens.first()?.text != "#" {
    return None;
  }
  let start = if tokens.get(1)?.text == "!" { 2 } else { 1 };
  group(tokens.get(start..)?, "[", "]")
}

/// Returns the inner slice of a balanced delimiter pair starting at `tokens[0]`.
fn group<'a>(tokens: &'a [lexer::Token], open: &str, close: &str) -> Option<&'a [lexer::Token]> {
  if tokens.first()?.text != open {
    return None;
  }
  let mut depth = 0_usize;
  for (index, token) in tokens.iter().enumerate() {
    if token.text == open {
      depth += 1;
    } else if token.text == close {
      depth = depth.checked_sub(1)?;
      if depth == 0 {
        return tokens.get(1..index);
      }
    }
  }
  None
}

/// Checks a `Cargo.toml` manifest for forbidden dependency or test sections.
fn check_manifest(path: &Path, source: &str, findings: &mut Vec<String>) {
  for (index, line) in source.lines().enumerate() {
    let line = line.split('#').next().unwrap_or_default().trim();
    let compact: String = line
      .chars()
      .filter(|character| !character.is_whitespace() && !matches!(character, '\'' | '"'))
      .collect();
    if compact.starts_with('[') {
      let fields: Vec<&str> = compact.trim_matches(['[', ']']).split('.').collect();
      if fields.contains(&"dev-dependencies") {
        report(
          path,
          index + 1,
          "dev-dependencies belong outside this repository",
          findings,
        );
      }
      if matches!(compact.as_str(), "[[test]]" | "[[bench]]") {
        report(
          path,
          index + 1,
          "test targets belong outside this repository",
          findings,
        );
      }
      if fields.starts_with(&["workspace", "dependencies"]) {
        report(
          path,
          index + 1,
          "workspace dependencies (declare them in each crate)",
          findings,
        );
      }
      if fields.contains(&"async-trait") {
        report(path, index + 1, "the async-trait crate", findings);
      }
    }
    if let Some((key, _)) = compact.split_once('=') {
      if key.split('.').any(|field| field == "dev-dependencies") {
        report(
          path,
          index + 1,
          "dev-dependencies belong outside this repository",
          findings,
        );
      }
      if matches!(key, "test" | "bench") && compact.contains('[') {
        report(
          path,
          index + 1,
          "test targets belong outside this repository",
          findings,
        );
      }
    }
    if compact.starts_with("async-trait=") || compact.contains("package=async-trait") {
      report(path, index + 1, "the async-trait crate", findings);
    }
    if matches!(
      compact.as_str(),
      "test=true" | "doctest=true" | "bench=true"
    ) {
      report(
        path,
        index + 1,
        "test targets belong outside this repository",
        findings,
      );
    }
  }
}

/// Checks a `package.json` manifest for forbidden test scripts or dependencies.
fn check_package_manifest(path: &Path, source: &str, findings: &mut Vec<String>) {
  for (index, raw_line) in source.lines().enumerate() {
    let line = raw_line.trim_start();
    if line.starts_with("\"test\":") || line.starts_with("\"test:") {
      report(
        path,
        index + 1,
        "test scripts belong outside this repository",
        findings,
      );
    }
    if TEST_PACKAGE_PREFIXES
      .iter()
      .any(|prefix| line.starts_with(prefix))
    {
      report(
        path,
        index + 1,
        "test dependencies belong outside this repository",
        findings,
      );
    }
  }
}

/// Appends one formatted diagnostic line to `findings`.
fn report(path: &Path, line: usize, message: &str, findings: &mut Vec<String>) {
  findings.push(format!("  {}:{line}: {message}", workspace::display(path)));
}
