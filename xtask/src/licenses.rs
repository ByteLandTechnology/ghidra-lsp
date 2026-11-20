// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Collects third-party license notices for locked dependencies.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use crate::workspace;

/// Parsed `cargo metadata` payload containing workspace and external packages.
#[derive(Debug, Deserialize)]
struct Metadata {
  /// All packages present in the resolved dependency graph.
  packages: Vec<Package>,
  /// Package identifiers belonging to workspace members.
  workspace_members: Vec<String>,
}

/// Metadata for a single Rust package in `cargo metadata`.
#[derive(Debug, Deserialize)]
struct Package {
  /// Unique package identifier used by Cargo.
  id: String,
  /// Crate name.
  name: String,
  /// Crate version string.
  version: String,
  /// SPDX license expression declared in the crate manifest.
  license: Option<String>,
  /// Custom license file path relative to the crate root, if declared.
  license_file: Option<String>,
  /// Upstream source repository URL, if declared.
  repository: Option<String>,
  /// Absolute path to the crate `Cargo.toml` manifest.
  manifest_path: String,
}

/// Prints consolidated license notices for `ghidra-lsp` and all locked dependencies.
pub(crate) fn collect() -> Result<(), String> {
  let root = workspace::root()?;
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());

  let output = Command::new(cargo)
    .args(["metadata", "--locked", "--format-version=1"])
    .current_dir(&root)
    .output()
    .map_err(|error| format!("cannot run cargo metadata: {error}"))?;

  if !output.status.success() {
    return Err(format!(
      "cargo metadata failed: {}",
      String::from_utf8_lossy(&output.stderr)
    ));
  }

  let metadata: Metadata = serde_json::from_slice(&output.stdout)
    .map_err(|error| format!("cannot parse cargo metadata: {error}"))?;

  let root_license = workspace::read(&root.join("LICENSE"))?;
  let mut sections = vec![
    concat!(
      "ghidra-lsp: licenses and source locations\n",
      "This file includes all locked Rust dependencies. ",
      "It also includes build dependencies and targets for other platforms.\n",
    )
    .to_owned(),
    format!("ghidra-lsp\n{root_license}"),
  ];

  let workspace_members: BTreeSet<&str> = metadata
    .workspace_members
    .iter()
    .map(String::as_str)
    .collect();

  let mut packages: Vec<&Package> = metadata
    .packages
    .iter()
    .filter(|pkg| !workspace_members.contains(pkg.id.as_str()))
    .collect();

  packages.sort_by(|left, right| (&left.name, &left.version).cmp(&(&right.name, &right.version)));

  for pkg in packages {
    let manifest_path = Path::new(&pkg.manifest_path);
    let directory = manifest_path
      .parent()
      .ok_or_else(|| format!("invalid manifest path: {}", pkg.manifest_path))?;

    let mut license_files = BTreeSet::new();
    find_license_files(directory, &mut license_files)?;

    if let Some(ref file) = pkg.license_file {
      let extra = directory.join(file);
      if extra.is_file() {
        license_files.insert(extra);
      }
    }

    if license_files.is_empty() {
      return Err(format!(
        "No license text for {} {}; inspect the source archive",
        pkg.name, pkg.version
      ));
    }

    let repo_info = pkg.repository.as_deref().unwrap_or("see source archive");
    let license_name = pkg.license.as_deref().unwrap_or("");
    let mut section = format!(
      concat!(
        "{} {}\nLicense: {}\nRepository: {}\n",
        "Source: https://crates.io/api/v1/crates/{}/{}/download\n",
      ),
      pkg.name, pkg.version, license_name, repo_info, pkg.name, pkg.version
    );

    for file_path in license_files {
      let relative = file_path
        .strip_prefix(directory)
        .unwrap_or(&file_path)
        .display();
      let content = fs::read_to_string(&file_path)
        .map_err(|error| format!("cannot read {}: {error}", file_path.display()))?
        .replace("\r\n", "\n");
      section.push_str(&format!("\n--- {relative} ---\n{content}"));
    }

    sections.push(section);
  }

  println!("{}", sections.join("\n\n"));
  Ok(())
}

/// Recursively collects license and notice files inside `dir`.
fn find_license_files(dir: &Path, files: &mut BTreeSet<PathBuf>) -> Result<(), String> {
  let entries =
    fs::read_dir(dir).map_err(|error| format!("cannot read dir {}: {error}", dir.display()))?;
  for entry in entries {
    let entry = entry.map_err(|error| format!("cannot read entry: {error}"))?;
    let path = entry.path();
    let file_type = entry
      .file_type()
      .map_err(|error| format!("cannot read file type: {error}"))?;

    if file_type.is_dir() {
      find_license_files(&path, files)?;
    } else if file_type.is_file() {
      let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

      if file_name.starts_with("license")
        || file_name.starts_with("licence")
        || file_name.starts_with("copying")
        || file_name.starts_with("notice")
      {
        files.insert(path);
      }
    }
  }
  Ok(())
}
