// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Program import and export table loading from the bridge session, with a local file fallback.

use std::collections::HashMap;

use anyhow::{Context, Result, ensure};
use md5::{Digest, Md5};
use object::{Object, ObjectSegment};
use serde_json::{Value, json};

use crate::backend::{McpBackend, list_all, list_operation, unsupported_operation};

/// Loads import and export tables from the Ghidra program session, or falls back to local loader
/// tables when connected to an older bridge that lacks `import.list` and `export.list`.
pub(crate) async fn interface(backend: &McpBackend, md5: &str) -> Result<Value> {
  let program = backend.call("program", "get", Some(md5), json!({})).await?;
  if let Some(session) = session_interface(backend, md5, &program).await? {
    return Ok(session);
  }
  disk_interface(backend, md5, &program).await
}

/// Fetches `import.list` and `export.list` from `ghidra_program`, returning `Ok(None)` when the
/// connected server does not support those operations.
async fn session_interface(
  backend: &McpBackend,
  md5: &str,
  program: &Value,
) -> Result<Option<Value>> {
  let page = json!({"page": {"limit": 1000}});
  let raw_imports = match list_operation(backend, "program", "import.list", md5, page.clone()).await
  {
    Ok(items) => items,
    Err(error) if unsupported_operation(&error) => return Ok(None),
    Err(error) => return Err(error),
  };
  let raw_exports = match list_operation(backend, "program", "export.list", md5, page).await {
    Ok(items) => items,
    Err(error) if unsupported_operation(&error) => return Ok(None),
    Err(error) => return Err(error),
  };
  let mut imports: Vec<Value> = raw_imports.iter().map(map_session_import).collect();
  let mut exports: Vec<Value> = raw_exports.iter().map(map_session_export).collect();
  imports.sort_by_key(|item| {
    (
      item["library"].as_str().unwrap_or("").to_owned(),
      item["name"].as_str().unwrap_or("").to_owned(),
      item["external_address"].as_str().unwrap_or("").to_owned(),
    )
  });
  exports.sort_by_key(|item| {
    (
      item["name"].as_str().unwrap_or("").to_owned(),
      item["address"].as_str().unwrap_or("").to_owned(),
    )
  });
  Ok(Some(json!({
    "imports": imports,
    "exports": exports,
    "format": format_label(program.get("executable_format").and_then(Value::as_str)),
    "source": "Ghidra program session",
    "limitations": [],
  })))
}

/// Maps one `import.list` item into a `ghidra.binaryInterface` import entry.
fn map_session_import(item: &Value) -> Value {
  let external_address = item.get("address").and_then(Value::as_str);
  let thunk_address = item
    .get("thunk_addresses")
    .and_then(Value::as_array)
    .and_then(|items| items.iter().find_map(Value::as_str));
  let is_function = item.get("is_function").and_then(Value::as_bool) == Some(true);
  let mut mapped = json!({
    "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
    "library": item.get("library").and_then(Value::as_str).unwrap_or(""),
    "ordinal": item.get("ordinal").cloned().unwrap_or(Value::Null),
    "address": thunk_address.or(external_address),
    "external_address": external_address,
    "thunk_addresses": item.get("thunk_addresses").cloned().unwrap_or_else(|| json!([])),
    "kind": if is_function { "function" } else { "import" },
  });
  for field in ["demangled_name", "original_name", "signature"] {
    if let Some(value) = item.get(field).filter(|v| !v.is_null()) {
      mapped[field] = value.clone();
    }
  }
  mapped
}

/// Maps one `export.list` item into a `ghidra.binaryInterface` export entry.
fn map_session_export(item: &Value) -> Value {
  let is_function = item.get("is_function").and_then(Value::as_bool) == Some(true);
  let mut mapped = json!({
    "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
    "ordinal": item.get("ordinal").cloned().unwrap_or(Value::Null),
    "address": item.get("address").cloned().unwrap_or(Value::Null),
    "forward": Value::Null,
    "kind": if is_function { "function" } else { "export" },
  });
  for field in ["demangled_name", "namespace"] {
    if let Some(value) = item.get(field).filter(|v| !v.is_null()) {
      mapped[field] = value.clone();
    }
  }
  mapped
}

/// Shortens a Ghidra executable-format label for workbench summaries.
fn format_label(raw: Option<&str>) -> String {
  let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
    return String::from("binary");
  };
  let upper = value.to_ascii_uppercase();
  if upper.contains("ELF") {
    String::from("ELF")
  } else if upper.contains("MACH-O") || upper.contains("MACHO") {
    String::from("Mach-O")
  } else if upper.contains("PORTABLE EXECUTABLE") || upper == "PE" || upper.contains("(PE)") {
    String::from("PE")
  } else {
    value.to_owned()
  }
}

/// Reads PE, ELF, or Mach-O import and export tables from `executable_path` on disk after
/// verifying the imported binary MD5.
async fn disk_interface(backend: &McpBackend, md5: &str, program: &Value) -> Result<Value> {
  let path = program
    .get("executable_path")
    .and_then(Value::as_str)
    .context("Imported binary path is unavailable")?
    .to_owned();
  let image_base = program
    .get("image_base")
    .and_then(Value::as_str)
    .and_then(parse_base);
  let size = tokio::fs::metadata(&path)
    .await
    .context("Read imported binary metadata")?
    .len();
  ensure!(
    size <= 2 * 1024 * 1024 * 1024,
    "Binary interface reader is limited to 2 GiB inputs"
  );
  let bytes = tokio::fs::read(&path)
    .await
    .context("Read imported binary")?;
  let cloned_base = image_base.clone();
  let expected_md5 = md5.to_owned();
  let mut result = tokio::task::spawn_blocking(move || {
    let actual = format!("{:x}", Md5::digest(&bytes));
    ensure!(
      actual.eq_ignore_ascii_case(&expected_md5),
      "Imported binary changed on disk: session MD5 does not match the loader-table input"
    );
    parse(&bytes, cloned_base)
  })
  .await??;
  // ELF and Mach-O imports can omit addresses in loader tables; bind only unique Ghidra symbols.
  if let Ok(symbols) = list_all(
    backend,
    "symbol",
    md5,
    json!({"page": {"limit": 1000}, "scan": {"timeout_ms": 60000}}),
  )
  .await
  {
    let mut names = HashMap::<&str, Vec<&Value>>::new();
    for symbol in &symbols {
      if let Some(name) = symbol.get("name").and_then(Value::as_str) {
        names.entry(name).or_default().push(symbol);
      }
    }
    for field in ["imports", "exports"] {
      let Some(items) = result.get_mut(field).and_then(Value::as_array_mut) else {
        continue;
      };
      for item in items {
        let name = item.get("name").and_then(Value::as_str).unwrap_or("");
        let Some(matches) = names.get(name) else {
          continue;
        };
        if let Some(demangled) = matches.iter().find_map(|s| s.get("demangled_name")) {
          item["demangled_name"] = demangled.clone();
        }
        if field != "imports" || item.get("address").is_some_and(Value::is_string) {
          continue;
        }
        let default_prefix = image_base
          .as_ref()
          .map(|(space, _)| format!("{space}:"))
          .unwrap_or_else(|| String::from("ram:"));
        let mut addresses: Vec<&str> = matches
          .iter()
          .filter_map(|s| s.get("address").and_then(Value::as_str))
          .filter(|s| s.starts_with(&default_prefix) || !s.starts_with("EXTERNAL:"))
          .collect();
        addresses.sort_unstable();
        addresses.dedup();
        if addresses.len() == 1 {
          item["address"] = json!(addresses[0]);
        }
      }
    }
  }
  Ok(result)
}

/// Parses an address string into an address-space prefix and numeric offset.
fn parse_base(raw: &str) -> Option<(String, u64)> {
  let (space, offset) = raw
    .rsplit_once(':')
    .map(|(space, offset)| (space.to_owned(), offset))
    .unwrap_or_else(|| (String::from("ram"), raw));
  let offset = offset
    .strip_prefix("0x")
    .or_else(|| offset.strip_prefix("0X"))
    .unwrap_or(offset);
  let value = u64::from_str_radix(offset, 16).ok()?;
  Some((space, value))
}

/// Converts raw loader symbol bytes into lossy UTF-8 text.
fn name(bytes: &[u8]) -> String {
  String::from_utf8_lossy(bytes).into_owned()
}

/// Parses loader import and export tables from raw executable bytes relative to `image_base`.
fn parse(bytes: &[u8], image_base: Option<(String, u64)>) -> Result<Value> {
  let file = match object::File::parse(bytes) {
    Ok(file) => file,
    Err(error) => {
      return Ok(json!({
        "imports": [],
        "exports": [],
        "format": "unavailable",
        "source": "imported binary",
        "limitations": [format!("No supported ELF/PE/thin Mach-O loader tables: {error}")],
      }));
    }
  };
  let format = format!("{:?}", file.format());
  let native_base = match file.format() {
    object::BinaryFormat::Pe => file.relative_address_base(),
    _ => file
      .segments()
      .filter(|s| s.size() > 0 && s.file_range().1 > 0)
      .map(|s| s.address())
      .min()
      .unwrap_or(0),
  };
  let (space, loaded_base) = image_base.unwrap_or_else(|| (String::from("ram"), native_base));
  let loaded = |value: u64| -> Option<String> {
    value
      .checked_sub(native_base)
      .and_then(|rva| loaded_base.checked_add(rva))
      .map(|a| format!("{space}:{a:08x}"))
  };
  let mut imports = Vec::new();
  let mut exports = Vec::new();
  let mut limitations = Vec::<String>::new();
  macro_rules! pe_tables {
    ($pe:expr, $headers:ty) => {{
      use object::LittleEndian as LE;
      use object::read::pe::{ExportTarget, Import};
      if let Some(table) = $pe.import_table()? {
        let mut descriptors = table.descriptors()?;
        while let Some(descriptor) = descriptors.next()? {
          let library = name(table.name(descriptor.name.get(LE))?);
          let first = descriptor.original_first_thunk.get(LE);
          let mut thunks = table.thunks(if first == 0 {
            descriptor.first_thunk.get(LE)
          } else {
            first
          })?;
          let mut index = 0u64;
          while let Some(thunk) = thunks.next::<$headers>()? {
            let (symbol, ordinal) = match table.import::<$headers>(thunk)? {
              Import::Name(_, bytes) => (name(bytes), None),
              Import::Ordinal(ordinal) => (format!("#{ordinal}"), Some(ordinal)),
            };
            let slot = index
              .checked_mul(if file.is_64() { 8 } else { 4 })
              .and_then(|offset| u64::from(descriptor.first_thunk.get(LE)).checked_add(offset))
              .and_then(|rva| file.relative_address_base().checked_add(rva));
            imports.push(json!({
              "name": symbol,
              "library": library,
              "ordinal": ordinal,
              "address": slot.and_then(loaded),
              "kind": "import",
            }));
            index += 1;
          }
        }
      }
      if let Some(table) = $pe.export_table()? {
        for export in table.exports()? {
          let (address, forward) = match export.target {
            ExportTarget::Address(0) => continue,
            ExportTarget::Address(rva) => (
              file
                .relative_address_base()
                .checked_add(u64::from(rva))
                .and_then(loaded),
              None,
            ),
            ExportTarget::ForwardByOrdinal(library, ordinal) => {
              (None, Some(format!("{}.#{}", name(library), ordinal)))
            }
            ExportTarget::ForwardByName(library, symbol) => {
              (None, Some(format!("{}.{}", name(library), name(symbol))))
            }
          };
          exports.push(json!({
            "name": export.name.map(name).unwrap_or_else(|| format!("#{}", export.ordinal)),
            "ordinal": export.ordinal,
            "address": address,
            "forward": forward,
            "kind": "export",
          }));
        }
      }
      limitations
        .push("PE delay-load imports are not included in the ordinary import table".into());
    }};
  }
  macro_rules! macho_tables {
    ($mach:expr) => {{
      use object::read::macho::{MachHeader, Nlist};
      let endian = $mach.endian();
      let two_level = $mach.macho_header().flags(endian) & object::macho::MH_TWOLEVEL != 0;
      let mut libraries = vec![String::from("Self")];
      let mut commands = $mach.macho_load_commands()?;
      while let Some(command) = commands.next()? {
        if let Some(dylib) = command.dylib()? {
          libraries.push(name(command.string(endian, dylib.dylib.name)?));
        }
      }
      let table = $mach.macho_symbol_table();
      for symbol in table.iter().filter(|symbol| symbol.is_undefined()) {
        let symbol_name = name(symbol.name(endian, table.strings())?);
        if symbol_name.is_empty() {
          continue;
        }
        let ordinal = symbol.library_ordinal(endian);
        let library = if !two_level {
          String::from("Flat namespace")
        } else {
          match ordinal {
            0xFF => String::from("Main executable"),
            0xFE => String::from("Flat namespace (dynamic lookup)"),
            _ => libraries
              .get(ordinal as usize)
              .cloned()
              .unwrap_or_else(|| format!("Ordinal {ordinal}")),
          }
        };
        imports.push(json!({"name": symbol_name, "library": library, "kind": "import"}));
      }
      for export in file.exports().context("Read Mach-O exports")? {
        exports.push(json!({
          "name": name(export.name()),
          "address": loaded(export.address()),
          "kind": "export",
        }));
      }
    }};
  }
  match &file {
    object::File::Pe32(pe) => pe_tables!(pe, object::pe::ImageNtHeaders32),
    object::File::Pe64(pe) => pe_tables!(pe, object::pe::ImageNtHeaders64),
    object::File::MachO32(mach) => macho_tables!(mach),
    object::File::MachO64(mach) => macho_tables!(mach),
    _ => {
      for import in file.imports().context("Read loader imports")? {
        imports.push(json!({
          "name": name(import.name()),
          "library": name(import.library()),
          "kind": "import",
        }));
      }
      for export in file.exports().context("Read loader exports")? {
        exports.push(json!({
          "name": name(export.name()),
          "address": loaded(export.address()),
          "kind": "export",
        }));
      }
    }
  }
  imports.sort_by_key(|i| {
    (
      i["library"].as_str().unwrap_or("").to_owned(),
      i["name"].as_str().unwrap_or("").to_owned(),
    )
  });
  exports.sort_by_key(|e| e["name"].as_str().unwrap_or("").to_owned());
  Ok(json!({
    "imports": imports,
    "exports": exports,
    "format": format,
    "source": "binary loader tables",
    "limitations": limitations,
  }))
}
