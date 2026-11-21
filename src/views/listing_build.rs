// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Pure listing window assembly, comment merging, and undefined-byte run collapsing.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::format::{
  canonical_key, display_templates_str, format_byte_hex, format_storage, format_xref_suffix,
  full_symbol_name, make_block_header, normalize_type_ref, opt_nonempty_str, short_bytes,
  short_type_name, symbol_display_name, symbol_tooltip, value_str,
};
use super::{
  COLLAPSE_THRESHOLD, ListingFunctionHeader, ListingLabel, ListingRenderItem, ListingTarget,
  ListingUndefinedRun, ListingUnit, ListingVariable, ListingXref, RawFunctionMeta,
};
use crate::address::{
  MemoryBlockInfo, add_address_offset, address_in_range, compare_addresses, display_address,
  find_memory_block, parse_address, same_address,
};

/// Input collections and formatting options passed to [`build_listing_window`].
pub(super) struct ListingBuildInput<'a> {
  /// Code units sorted or returned by `listing.code_unit.list`.
  pub(super) units: Vec<Value>,
  /// Symbols overlapping the listing range.
  pub(super) symbols: Vec<Value>,
  /// Function records overlapping the listing range.
  pub(super) functions: Vec<Value>,
  /// Demangled function metadata indexed by entry address.
  pub(super) demangled_functions: HashMap<String, (String, String, Option<String>)>,
  /// Comments overlapping the listing range.
  pub(super) comments: Vec<Value>,
  /// Incoming cross-references keyed by target address.
  pub(super) incoming_refs: HashMap<String, Vec<Value>>,
  /// Outgoing cross-references keyed by source address.
  pub(super) outgoing_refs: HashMap<String, Vec<Value>>,
  /// Program memory blocks sorted by start address.
  pub(super) blocks: &'a [MemoryBlockInfo],
  /// Default address space name (`ram` fallback).
  pub(super) default_space: &'a str,
  /// Minimum consecutive undefined single-byte count collapsed together.
  pub(super) collapse_threshold: usize,
  /// Whether full C++ template arguments appear in formatted names.
  pub(super) show_template_arguments: bool,
}

/// Assembled listing units and collapsed render items for one viewport range.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingWindowData {
  /// First unit address in the window, or empty if no units were returned.
  pub(super) start_address: String,
  /// Final byte address covered by the window, or empty if no units were returned.
  pub(super) end_address: String,
  /// Memory block containing `start_address`, when available.
  pub(super) block: Option<MemoryBlockInfo>,
  /// Uncollapsed normalized units in address order.
  pub(super) units: Vec<ListingUnit>,
  /// Renderable items with contiguous undefined-byte runs collapsed.
  pub(super) collapsed_items: Vec<ListingRenderItem>,
}

/// Builds the [`ListingFunctionHeader`] rendered at a function entry unit.
fn build_function_header(
  fn_val: &Value,
  demangled: Option<&RawFunctionMeta>,
  show_template_arguments: bool,
) -> ListingFunctionHeader {
  let entry = value_str(&fn_val["entry"]);
  let raw_name = value_str(&fn_val["name"]);
  let namespace = value_str(&fn_val["namespace"]);
  let demangled_str = demangled
    .and_then(|d| d.demangled_name.clone())
    .or_else(|| opt_nonempty_str(fn_val.get("demangled_name")));

  let name = symbol_display_name(
    &raw_name,
    &namespace,
    demangled_str.as_deref(),
    true,
    show_template_arguments,
  );
  let mangled_name = demangled_str
    .as_deref()
    .filter(|d| !d.is_empty() && raw_name != *d)
    .map(|_| raw_name.clone());

  let full_name = full_symbol_name(&raw_name, &namespace, demangled_str.as_deref(), true);
  let raw_signature = opt_nonempty_str(fn_val.get("signature")).unwrap_or_else(|| {
    let ret = normalize_type_ref(&fn_val["return_type"]);
    let ret = if ret.is_empty() { "undefined" } else { &ret };
    format!("{ret} {full_name}()")
  });
  let display_signature = display_templates_str(&raw_signature, show_template_arguments);

  let mut flags = Vec::new();
  if fn_val.get("thunk").and_then(Value::as_bool) == Some(true) {
    flags.push("thunk".to_owned());
  }
  if fn_val.get("external").and_then(Value::as_bool) == Some(true) {
    flags.push("external".to_owned());
  }
  if fn_val.get("is_inline").and_then(Value::as_bool) == Some(true) {
    flags.push("inline".to_owned());
  }
  if fn_val.get("has_no_return").and_then(Value::as_bool) == Some(true) {
    flags.push("noreturn".to_owned());
  }
  if fn_val.get("has_var_args").and_then(Value::as_bool) == Some(true) {
    flags.push("variadic".to_owned());
  }

  let mut variables = Vec::new();
  if let Some(params) = fn_val.get("parameters").and_then(Value::as_array) {
    for param in params {
      let (st_disp, st_raw) = format_storage(&param["storage"]);
      let dt = short_type_name(&normalize_type_ref(&param["data_type"]));
      let ord = value_str(&param["ordinal"]);
      let pname = value_str(&param["name"]);
      variables.push(ListingVariable {
        kind: "param".to_owned(),
        data_type: if dt.is_empty() {
          "undefined".to_owned()
        } else {
          dt
        },
        storage: if st_disp.is_empty() {
          format!("param#{}", if ord.is_empty() { "0" } else { &ord })
        } else {
          st_disp
        },
        raw_storage: (!st_raw.is_empty()).then_some(st_raw),
        name: if pname.is_empty() {
          "(unnamed)".to_owned()
        } else {
          pname
        },
      });
    }
  }
  if let Some(locals) = fn_val.get("local_variables").and_then(Value::as_array) {
    for local in locals {
      let (st_disp, st_raw) = format_storage(&local["storage"]);
      let dt = short_type_name(&normalize_type_ref(&local["data_type"]));
      let lname = value_str(&local["name"]);
      variables.push(ListingVariable {
        kind: "local".to_owned(),
        data_type: if dt.is_empty() {
          "undefined".to_owned()
        } else {
          dt
        },
        storage: if st_disp.is_empty() {
          "Stack".to_owned()
        } else {
          st_disp
        },
        raw_storage: (!st_raw.is_empty()).then_some(st_raw),
        name: if lname.is_empty() {
          "(local)".to_owned()
        } else {
          lname
        },
      });
    }
  }

  let raw_cc = fn_val
    .get("calling_convention")
    .and_then(Value::as_str)
    .map(str::trim)
    .unwrap_or("");
  let calling_convention = (!raw_cc.is_empty()
    && !raw_cc.eq_ignore_ascii_case("unknown")
    && !raw_cc.eq_ignore_ascii_case("default")
    && !display_signature
      .to_ascii_lowercase()
      .contains(&raw_cc.to_ascii_lowercase()))
  .then(|| raw_cc.to_owned());

  ListingFunctionHeader {
    entry,
    display_signature,
    raw_signature,
    name,
    mangled_name,
    calling_convention,
    flags,
    variables,
  }
}

/// Checks whether a normalized listing unit can be merged into an undefined-byte run.
fn is_collapsible_unit(u: &ListingUnit) -> bool {
  u.is_undefined_byte == Some(true)
    && u.byte_length == 1
    && u.plate_comment.is_none()
    && u.function_header.is_none()
    && u.labels.is_empty()
    && u.xref_total == 0
    && u.pre_comment.is_none()
    && u.post_comment.is_none()
    && u.eol_comment.is_none()
    && u.targets.is_empty()
}

/// Builds annotated listing units and collapses long runs of plain undefined bytes.
pub(super) fn build_listing_window(input: ListingBuildInput<'_>) -> ListingWindowData {
  let default_space = if input.default_space.is_empty() {
    "ram"
  } else {
    input.default_space
  };
  let collapse_threshold = if input.collapse_threshold == 0 {
    COLLAPSE_THRESHOLD
  } else {
    input.collapse_threshold
  };

  let mut data_by_key: HashMap<String, Value> = HashMap::new();
  for u in &input.units {
    if u.get("kind").and_then(Value::as_str) == Some("data") {
      let addr = value_str(&u["address"]);
      if !addr.is_empty() {
        data_by_key.insert(canonical_key(&addr, default_space), u.clone());
      }
    }
  }

  let mut symbols_by_key: HashMap<String, Vec<Value>> = HashMap::new();
  for sym in input.symbols {
    let addr = value_str(&sym["address"]);
    if addr.is_empty() {
      continue;
    }
    symbols_by_key
      .entry(canonical_key(&addr, default_space))
      .or_default()
      .push(sym);
  }

  let functions_list: Vec<Value> = input
    .functions
    .into_iter()
    .filter(|fn_val| !value_str(&fn_val["entry"]).is_empty())
    .collect();
  let mut function_by_entry: HashMap<String, Value> = HashMap::new();
  for fn_val in &functions_list {
    let entry = value_str(&fn_val["entry"]);
    function_by_entry.insert(canonical_key(&entry, default_space), fn_val.clone());
  }

  let mut comments_by_key: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
  for c in input.comments {
    let addr = value_str(&c["address"]);
    let ctype = value_str(&c["type"]).to_ascii_lowercase();
    let body = value_str(&c["text"]);
    if addr.is_empty() || ctype.is_empty() || body.is_empty() {
      continue;
    }
    comments_by_key
      .entry(canonical_key(&addr, default_space))
      .or_default()
      .entry(ctype)
      .or_default()
      .push(body);
  }

  let mut demangled_by_key: HashMap<String, RawFunctionMeta> = HashMap::new();
  for (k, (name, namespace, demangled_name)) in input.demangled_functions {
    demangled_by_key.insert(
      canonical_key(&k, default_space),
      RawFunctionMeta {
        entry: k,
        name,
        namespace,
        demangled_name,
      },
    );
  }

  let normalize_ref_map = |src: HashMap<String, Vec<Value>>| -> HashMap<String, Vec<Value>> {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    for (k, refs) in src {
      out
        .entry(canonical_key(&k, default_space))
        .or_default()
        .extend(refs);
    }
    out
  };
  let incoming_by_key = normalize_ref_map(input.incoming_refs);
  let outgoing_by_key = normalize_ref_map(input.outgoing_refs);

  let resolve_containing_function = |address: &str| -> Option<&Value> {
    let key = canonical_key(address, default_space);
    if let Some(direct) = function_by_entry.get(&key) {
      return Some(direct);
    }
    functions_list.iter().find(|fn_val| {
      let start = fn_val
        .pointer("/body/start")
        .map(value_str)
        .unwrap_or_default();
      let end = fn_val
        .pointer("/body/end")
        .map(value_str)
        .unwrap_or_default();
      !start.is_empty() && !end.is_empty() && address_in_range(address, &start, &end)
    })
  };

  let resolve_name_at = |address: &str| -> Option<String> {
    let key = canonical_key(address, default_space);
    let demangled = demangled_by_key.get(&key);
    let fn_val = function_by_entry.get(&key);
    if fn_val.is_some() || demangled.is_some() {
      let name = fn_val
        .and_then(|f| opt_nonempty_str(f.get("name")))
        .or_else(|| demangled.map(|d| d.name.clone()))
        .unwrap_or_default();
      let namespace = fn_val
        .and_then(|f| opt_nonempty_str(f.get("namespace")))
        .or_else(|| demangled.map(|d| d.namespace.clone()))
        .unwrap_or_default();
      let demangled_name = demangled
        .and_then(|d| d.demangled_name.clone())
        .or_else(|| fn_val.and_then(|f| opt_nonempty_str(f.get("demangled_name"))));
      return Some(symbol_display_name(
        &name,
        &namespace,
        demangled_name.as_deref(),
        true,
        input.show_template_arguments,
      ));
    }
    if let Some(syms) = symbols_by_key.get(&key)
      && !syms.is_empty()
    {
      let primary = syms
        .iter()
        .find(|s| s.get("primary").and_then(Value::as_bool) == Some(true))
        .unwrap_or(&syms[0]);
      let name = value_str(&primary["name"]);
      let namespace = value_str(&primary["namespace"]);
      let demangled_name = opt_nonempty_str(primary.get("demangled_name"));
      return Some(symbol_display_name(
        &name,
        &namespace,
        demangled_name.as_deref(),
        true,
        input.show_template_arguments,
      ));
    }
    None
  };

  let mut sorted_units = input.units;
  sorted_units
    .sort_by(|a, b| compare_addresses(&value_str(&a["address"]), &value_str(&b["address"])));

  let mut units: Vec<ListingUnit> = Vec::with_capacity(sorted_units.len());
  let mut last_block_name: Option<String> = None;

  for raw in sorted_units {
    let address = value_str(&raw["address"]);
    if address.is_empty() {
      continue;
    }
    let key = canonical_key(&address, default_space);
    let block = find_memory_block(input.blocks, &address);
    let block_header = block
      .filter(|b| last_block_name.as_deref() != Some(b.name.as_str()))
      .map(make_block_header);
    if let Some(b) = block {
      last_block_name = Some(b.name.clone());
    }

    let bytes_text = format_byte_hex(&raw["bytes"]);
    let raw_byte_parts: Vec<&str> = if bytes_text.is_empty() {
      Vec::new()
    } else {
      bytes_text.split(' ').filter(|p| !p.is_empty()).collect()
    };
    let raw_length = raw.get("length").and_then(Value::as_u64).unwrap_or(0) as usize;
    let byte_length = if raw_length > 0 {
      raw_length
    } else if !raw_byte_parts.is_empty() {
      raw_byte_parts.len()
    } else {
      1
    };
    let kind = if raw.get("kind").and_then(Value::as_str) == Some("instruction") {
      "instruction".to_owned()
    } else {
      "data".to_owned()
    };

    let fn_val = resolve_containing_function(&address);
    let fn_display_name = fn_val.map(|f| {
      let fn_key = canonical_key(&value_str(&f["entry"]), default_space);
      let demangled = demangled_by_key
        .get(&fn_key)
        .and_then(|d| d.demangled_name.clone())
        .or_else(|| opt_nonempty_str(f.get("demangled_name")));
      symbol_display_name(
        &value_str(&f["name"]),
        &value_str(&f["namespace"]),
        demangled.as_deref(),
        true,
        input.show_template_arguments,
      )
    });

    let is_entry = fn_val.is_some_and(|f| same_address(&address, &value_str(&f["entry"])));
    let demangled_entry = if is_entry {
      demangled_by_key.get(&key)
    } else {
      None
    };
    let function_header = if is_entry {
      fn_val.map(|f| build_function_header(f, demangled_entry, input.show_template_arguments))
    } else {
      None
    };

    let comment_bucket = comments_by_key.get(&key);
    let mut plate_parts = comment_bucket
      .and_then(|b| b.get("plate"))
      .cloned()
      .unwrap_or_default();
    if is_entry
      && let Some(f) = fn_val
      && let Some(fn_comment) = opt_nonempty_str(f.get("comment"))
      && !plate_parts.contains(&fn_comment)
    {
      plate_parts.insert(0, fn_comment);
    }
    let plate_comment = (!plate_parts.is_empty()).then(|| plate_parts.join("\n"));
    let pre_comment = comment_bucket
      .and_then(|b| b.get("pre"))
      .filter(|v| !v.is_empty())
      .map(|v| v.join("\n"));
    let post_comment = comment_bucket
      .and_then(|b| b.get("post"))
      .filter(|v| !v.is_empty())
      .map(|v| v.join("\n"));

    let mut eol_parts = comment_bucket
      .and_then(|b| b.get("eol"))
      .cloned()
      .unwrap_or_default();
    if let Some(reps) = comment_bucket.and_then(|b| b.get("repeatable")) {
      for rep in reps {
        if !eol_parts.contains(rep) {
          eol_parts.push(rep.clone());
        }
      }
    }
    if is_entry
      && let Some(f) = fn_val
      && let Some(rep_comment) = opt_nonempty_str(f.get("repeatable_comment"))
      && !eol_parts.contains(&rep_comment)
    {
      eol_parts.push(rep_comment);
    }

    let syms = symbols_by_key.get(&key).map(Vec::as_slice).unwrap_or(&[]);
    let fn_raw_name = fn_val.map(|f| value_str(&f["name"]));
    let labels: Vec<ListingLabel> = syms
      .iter()
      .filter(|sym| {
        !(is_entry
          && function_header.is_some()
          && fn_raw_name.as_deref() == Some(value_str(&sym["name"]).as_str())
          && sym.get("primary").and_then(Value::as_bool) == Some(true))
      })
      .map(|sym| {
        let sname = value_str(&sym["name"]);
        let snamespace = value_str(&sym["namespace"]);
        let sdemangled = opt_nonempty_str(sym.get("demangled_name"));
        ListingLabel {
          id: opt_nonempty_str(sym.get("id")),
          name: symbol_display_name(
            &sname,
            &snamespace,
            sdemangled.as_deref(),
            true,
            input.show_template_arguments,
          ),
          full_tooltip: symbol_tooltip(&sname, &snamespace, sdemangled.as_deref()),
          primary: sym.get("primary").and_then(Value::as_bool) == Some(true),
        }
      })
      .collect();

    let raw_incoming = incoming_by_key.get(&key).map(Vec::as_slice).unwrap_or(&[]);
    let xrefs: Vec<ListingXref> = raw_incoming
      .iter()
      .take(4)
      .map(|r| {
        let from = value_str(&r["from"]);
        let ref_type = value_str(&r["type"]);
        let navigable = parse_address(&from, default_space).is_some();
        let caller = if navigable {
          resolve_containing_function(&from)
        } else {
          None
        };
        let caller_name = if let Some(c) = caller {
          let ckey = canonical_key(&value_str(&c["entry"]), default_space);
          let cdemangled = demangled_by_key
            .get(&ckey)
            .and_then(|d| d.demangled_name.clone())
            .or_else(|| opt_nonempty_str(c.get("demangled_name")));
          Some(symbol_display_name(
            &value_str(&c["name"]),
            &value_str(&c["namespace"]),
            cdemangled.as_deref(),
            true,
            input.show_template_arguments,
          ))
        } else if let Some(from_fn) = r.get("from_function").filter(|v| v.is_object()) {
          let fn_entry = value_str(&from_fn["entry"]);
          let fn_key = canonical_key(&fn_entry, default_space);
          let meta_fn = demangled_by_key.get(&fn_key);
          let raw_name = opt_nonempty_str(from_fn.get("name"))
            .or_else(|| meta_fn.map(|d| d.name.clone()))
            .unwrap_or_default();
          let namespace = meta_fn.map(|d| d.namespace.as_str()).unwrap_or("");
          let demangled_str = meta_fn.and_then(|d| d.demangled_name.as_deref());
          (!raw_name.is_empty()).then(|| {
            symbol_display_name(
              &raw_name,
              namespace,
              demangled_str,
              true,
              input.show_template_arguments,
            )
          })
        } else if navigable {
          resolve_name_at(&from)
        } else {
          None
        };
        let from_short = if !navigable && from.eq_ignore_ascii_case("entry point:entry point") {
          "entry point".to_owned()
        } else {
          display_address(&from)
        };
        let label = match caller_name {
          Some(cn) if !cn.is_empty() => format!("{cn}:{from_short}"),
          _ => from_short,
        };
        ListingXref {
          from,
          label,
          suffix: format_xref_suffix(&ref_type).to_owned(),
          kind: ref_type,
          navigable,
        }
      })
      .collect();

    let data_unit = data_by_key.get(&key);
    let mnemonic: String;
    let operands_text: String;
    let mut type_path: Option<String> = None;
    let mut is_undefined_byte = false;

    if kind == "instruction" {
      let raw_text = value_str(&raw["text"]);
      mnemonic = opt_nonempty_str(raw.get("mnemonic"))
        .unwrap_or_else(|| raw_text.split_whitespace().next().unwrap_or("").to_owned());
      operands_text = if let Some(ops) = raw.get("operands").and_then(Value::as_array) {
        ops.iter().map(value_str).collect::<Vec<_>>().join(", ")
      } else {
        raw_text
          .strip_prefix(&mnemonic)
          .unwrap_or_else(|| {
            raw_text
              .split_once(char::is_whitespace)
              .map_or("", |(_, rest)| rest)
          })
          .trim()
          .to_owned()
      };
    } else {
      let raw_dt = data_unit
        .and_then(|d| d.get("data_type"))
        .filter(|v| !v.is_null())
        .unwrap_or(&raw["data_type"]);
      let raw_data_type = normalize_type_ref(raw_dt);
      if raw_data_type.starts_with('/') {
        type_path = Some(raw_data_type.clone());
      }
      let short_type = short_type_name(&raw_data_type);
      let repr = data_unit
        .and_then(|d| {
          opt_nonempty_str(d.get("representation")).or_else(|| opt_nonempty_str(d.get("value")))
        })
        .unwrap_or_else(|| value_str(&raw["text"]))
        .trim()
        .to_owned();
      let is_anon_undefined = (short_type.is_empty()
        || short_type.eq_ignore_ascii_case("undefined")
        || short_type.eq_ignore_ascii_case("undefined1"))
        && byte_length == 1;
      if is_anon_undefined && data_unit.is_none() {
        is_undefined_byte = true;
        let uninit = block.is_some_and(|b| !b.initialized);
        mnemonic = if uninit {
          "??".to_owned()
        } else {
          "db".to_owned()
        };
        operands_text = if uninit {
          "??".to_owned()
        } else if let Some(first_byte) = raw_byte_parts.first() {
          format!("{}h", first_byte.to_ascii_uppercase())
        } else if !repr.is_empty() {
          repr
        } else {
          "??".to_owned()
        };
      } else {
        mnemonic = if short_type.is_empty() {
          "data".to_owned()
        } else {
          short_type
        };
        let raw_text = value_str(&raw["text"]);
        operands_text = if !repr.is_empty() {
          repr
        } else if !raw_text.is_empty() {
          raw_text
        } else {
          bytes_text.clone()
        };
      }
    }

    let raw_outgoing = outgoing_by_key.get(&key).map(Vec::as_slice).unwrap_or(&[]);
    let mut targets: Vec<ListingTarget> = Vec::new();
    let op_lower = operands_text.to_ascii_lowercase();
    for r in raw_outgoing {
      let to = value_str(&r["to"]);
      let Some(parsed_target) = parse_address(&to, default_space) else {
        continue;
      };
      let target_key = canonical_key(&to, default_space);
      let data_target = data_by_key.get(&target_key);
      let preview = data_target.and_then(|d| {
        opt_nonempty_str(d.get("representation")).or_else(|| opt_nonempty_str(d.get("value")))
      });
      let bare_shown = display_address(&to);
      let label = resolve_name_at(&to).unwrap_or_else(|| bare_shown.clone());
      let hex_trimmed = format!("{:x}", parsed_target.offset);
      let inline_only = label.eq_ignore_ascii_case(&bare_shown)
        && (op_lower.contains(&bare_shown.to_ascii_lowercase())
          || op_lower.contains(&format!("0x{hex_trimmed}")));
      if !targets.iter().any(|item| same_address(&item.to, &to)) {
        targets.push(ListingTarget {
          to,
          label,
          kind: value_str(&r["type"]),
          preview: preview.clone(),
          inline_only: inline_only.then_some(true),
        });
      }
      if let Some(target_rep) = comments_by_key
        .get(&target_key)
        .and_then(|c| c.get("repeatable"))
        .and_then(|v| v.first())
        && !eol_parts.contains(target_rep)
      {
        eol_parts.push(target_rep.clone());
      }
      if let Some(prev) = preview
        && !eol_parts.iter().any(|item| item.contains(&prev))
      {
        eol_parts.push(format!("= {prev}"));
      }
    }

    let eol_comment = (!eol_parts.is_empty()).then(|| eol_parts.join(" ; "));
    units.push(ListingUnit {
      kind,
      address,
      byte_length,
      entry: fn_val.map(|f| value_str(&f["entry"])),
      function_name: fn_display_name,
      bytes_short: short_bytes(&bytes_text),
      bytes_text,
      mnemonic,
      operands_text,
      type_path,
      block_header,
      plate_comment,
      function_header,
      labels,
      xrefs,
      xref_total: raw_incoming.len(),
      pre_comment,
      post_comment,
      eol_comment,
      targets,
      is_undefined_byte: is_undefined_byte.then_some(true),
    });
  }

  let mut collapsed_items: Vec<ListingRenderItem> = Vec::new();
  let mut i = 0;
  while i < units.len() {
    if !is_collapsible_unit(&units[i]) {
      collapsed_items.push(ListingRenderItem::Unit(Box::new(units[i].clone())));
      i += 1;
      continue;
    }
    let mut j = i + 1;
    while j < units.len() && is_collapsible_unit(&units[j]) && units[j].block_header.is_none() {
      let expected = add_address_offset(&units[j - 1].address, 1);
      if expected.is_none_or(|exp| !same_address(&exp, &units[j].address)) {
        break;
      }
      j += 1;
    }
    let run_units = &units[i..j];
    if run_units.len() >= collapse_threshold {
      collapsed_items.push(ListingRenderItem::UndefinedRun(Box::new(
        ListingUndefinedRun {
          kind: "undefinedRun".to_owned(),
          start_address: run_units[0].address.clone(),
          end_address: run_units[run_units.len() - 1].address.clone(),
          byte_length: run_units.len(),
          uninitialized: run_units[0].mnemonic == "??",
          block_header: run_units[0].block_header.clone(),
          units: run_units.to_vec(),
        },
      )));
    } else {
      for u in run_units {
        collapsed_items.push(ListingRenderItem::Unit(Box::new(u.clone())));
      }
    }
    i = j;
  }

  let start_address = units.first().map(|u| u.address.clone()).unwrap_or_default();
  let end_address = units
    .last()
    .map(|u| {
      add_address_offset(&u.address, u.byte_length.saturating_sub(1) as i128)
        .unwrap_or_else(|| u.address.clone())
    })
    .unwrap_or_default();
  let block = if start_address.is_empty() {
    None
  } else {
    find_memory_block(input.blocks, &start_address).cloned()
  };

  ListingWindowData {
    start_address,
    end_address,
    block,
    units,
    collapsed_items,
  }
}
