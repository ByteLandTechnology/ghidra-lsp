// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Discovers workspace source files, manifests, and forbidden directories.

use std::fs;
use std::path::{Path, PathBuf};

/// Returns the workspace root, which is the parent of the `xtask` crate.
pub(crate) fn root() -> Result<PathBuf, String> {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .map(Path::to_path_buf)
    .ok_or_else(|| "the xtask crate has no parent directory".to_owned())
}

/// Returns each `.rs` file in the workspace crates, sorted by path.
pub(crate) fn rust_files() -> Result<Vec<PathBuf>, String> {
  files_with(|name| name.ends_with(".rs"))
}

/// Returns each `.lua` file in the repository, sorted by path.
pub(crate) fn lua_files() -> Result<Vec<PathBuf>, String> {
  files_with(|name| name.ends_with(".lua"))
}

/// Returns the root manifest and each crate manifest, sorted by path.
pub(crate) fn manifests() -> Result<Vec<PathBuf>, String> {
  files_with(|name| name == "Cargo.toml")
}

/// Returns every non-hidden Markdown file in the workspace, sorted by path.
pub(crate) fn markdown_files() -> Result<Vec<PathBuf>, String> {
  files_with(|name| name.ends_with(".md"))
}

/// Returns directories reserved for tests and benchmarks.
pub(crate) fn test_directories() -> Result<Vec<PathBuf>, String> {
  let mut directories = Vec::new();
  walk(&root()?, &|_| false, &mut Vec::new(), &mut directories)?;
  directories.sort();
  Ok(directories)
}

/// Returns `path` relative to the workspace root for diagnostics.
pub(crate) fn display(path: &Path) -> String {
  match root() {
    Ok(root) => path
      .strip_prefix(&root)
      .unwrap_or(path)
      .display()
      .to_string(),
    Err(_) => path.display().to_string(),
  }
}

/// Reads a file as UTF-8 text.
pub(crate) fn read(path: &Path) -> Result<String, String> {
  fs::read_to_string(path).map_err(|error| format!("{}: {error}", display(path)))
}

/// Collects sorted file paths whose file name matches `matches`.
fn files_with(matches: impl Fn(&str) -> bool) -> Result<Vec<PathBuf>, String> {
  let root = root()?;
  let mut files = Vec::new();
  walk(&root, &matches, &mut files, &mut Vec::new())?;
  files.sort();
  Ok(files)
}

/// Recursively walks `directory`, collecting matching files and forbidden dirs.
fn walk(
  directory: &Path,
  matches: &impl Fn(&str) -> bool,
  files: &mut Vec<PathBuf>,
  test_directories: &mut Vec<PathBuf>,
) -> Result<(), String> {
  let entries =
    fs::read_dir(directory).map_err(|error| format!("{}: {error}", display(directory)))?;
  for entry in entries {
    let entry = entry.map_err(|error| format!("{}: {error}", display(directory)))?;
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().into_owned();
    if name.starts_with('.')
      || matches!(
        name.as_str(),
        "target" | "artifacts" | "node_modules" | "vendor"
      )
    {
      continue;
    }
    let kind = entry
      .file_type()
      .map_err(|error| format!("{}: {error}", display(&path)))?;
    if kind.is_dir() {
      if matches!(name.as_str(), "tests" | "benches") {
        test_directories.push(path.clone());
      }
      walk(&path, matches, files, test_directories)?;
    } else if kind.is_file() && matches(&name) {
      files.push(path);
    }
  }
  Ok(())
}
