// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Binary byte decoding for the memory data inspector panel.

use serde_json::{Value, json};

use super::DataInspectorEntry;
use crate::address::{MemoryBlockInfo, find_memory_block, format_address};

/// Formats a floating-point scalar cleanly using significant digits matching UI precision.
fn format_float(value: f64, precision: usize) -> String {
  if value.is_nan() {
    return "NaN".to_owned();
  }
  if value.is_infinite() {
    return if value.is_sign_positive() {
      "+Infinity".to_owned()
    } else {
      "-Infinity".to_owned()
    };
  }
  if value == 0.0 {
    return if value.is_sign_negative() {
      "-0".to_owned()
    } else {
      "0".to_owned()
    };
  }
  let abs = value.abs();
  if !(1e-4..1e7).contains(&abs) {
    let s = format!("{value:.prec$e}", prec = precision.saturating_sub(1));
    if let Some((mantissa, exp)) = s.split_once('e') {
      return if exp.starts_with('-') {
        format!("{mantissa}e{exp}")
      } else {
        format!("{mantissa}e+{exp}")
      };
    }
    return s;
  }
  let mag = abs.log10().floor() as i32;
  let decimals = ((precision as i32) - 1 - mag).max(0) as usize;
  let mut formatted = format!("{value:.decimals$}");
  if decimals > 0 && formatted.contains('.') {
    while formatted.ends_with('0') {
      formatted.pop();
    }
    if formatted.ends_with('.') {
      formatted.pop();
    }
  }
  if formatted == "-0" {
    "0".to_owned()
  } else {
    formatted
  }
}

/// Decodes integers, IEEE-754 floats, pointer targets, and strings from byte slices.
pub(super) fn decode_data_inspector(
  bytes: &[Option<u8>],
  endian: &str,
  address_size_bits: u64,
  blocks: &[MemoryBlockInfo],
  default_space: &str,
  address_width: usize,
) -> Vec<DataInspectorEntry> {
  if bytes.is_empty() {
    return Vec::new();
  }
  if bytes[0].is_none() {
    return vec![DataInspectorEntry {
      label: "State".to_owned(),
      value: "Uninitialized (??)".to_owned(),
      raw_title: None,
      jump_address: None,
    }];
  }

  let prefix: Vec<u8> = bytes.iter().map_while(|&b| b).collect();
  if prefix.is_empty() {
    return Vec::new();
  }

  let le = !endian.eq_ignore_ascii_case("big");
  let b0 = prefix[0];
  let mut entries = Vec::new();

  let char_hint = if (32..=126).contains(&b0) {
    format!(" \u{00b7} '{}'", b0 as char)
  } else if b0 == 10 {
    " \u{00b7} '\\n'".to_owned()
  } else if b0 == 9 {
    " \u{00b7} '\\t'".to_owned()
  } else if b0 == 0 {
    " \u{00b7} '\\0'".to_owned()
  } else {
    String::new()
  };

  entries.push(DataInspectorEntry {
    label: "Binary".to_owned(),
    value: format!("{b0:08b}"),
    raw_title: Some(format!("0x{b0:02x}")),
    jump_address: None,
  });
  entries.push(DataInspectorEntry {
    label: "int8 / uint8".to_owned(),
    value: format!("{} / {}{}", b0 as i8, b0, char_hint),
    raw_title: Some(format!("0x{b0:02x}")),
    jump_address: None,
  });

  if prefix.len() >= 2 {
    let arr = [prefix[0], prefix[1]];
    let s16 = if le {
      i16::from_le_bytes(arr)
    } else {
      i16::from_be_bytes(arr)
    };
    let u16_val = if le {
      u16::from_le_bytes(arr)
    } else {
      u16::from_be_bytes(arr)
    };
    entries.push(DataInspectorEntry {
      label: "int16 / uint16".to_owned(),
      value: format!("{s16} / {u16_val}"),
      raw_title: Some(format!("0x{u16_val:04x}")),
      jump_address: None,
    });
  }

  if prefix.len() >= 4 {
    let arr = [prefix[0], prefix[1], prefix[2], prefix[3]];
    let s32 = if le {
      i32::from_le_bytes(arr)
    } else {
      i32::from_be_bytes(arr)
    };
    let u32_val = if le {
      u32::from_le_bytes(arr)
    } else {
      u32::from_be_bytes(arr)
    };
    entries.push(DataInspectorEntry {
      label: "int32 / uint32".to_owned(),
      value: format!("{s32} / {u32_val}"),
      raw_title: Some(format!("0x{u32_val:08x}")),
      jump_address: None,
    });
  }

  if prefix.len() >= 8 {
    let arr = [
      prefix[0], prefix[1], prefix[2], prefix[3], prefix[4], prefix[5], prefix[6], prefix[7],
    ];
    let s64 = if le {
      i64::from_le_bytes(arr)
    } else {
      i64::from_be_bytes(arr)
    };
    let u64_val = if le {
      u64::from_le_bytes(arr)
    } else {
      u64::from_be_bytes(arr)
    };
    entries.push(DataInspectorEntry {
      label: "int64 / uint64".to_owned(),
      value: format!("{s64} / {u64_val}"),
      raw_title: Some(format!("0x{u64_val:016x}")),
      jump_address: None,
    });
  }

  if prefix.len() >= 4 {
    let arr = [prefix[0], prefix[1], prefix[2], prefix[3]];
    let f32_val = if le {
      f32::from_le_bytes(arr)
    } else {
      f32::from_be_bytes(arr)
    };
    entries.push(DataInspectorEntry {
      label: "float32".to_owned(),
      value: format_float(f32_val as f64, 6),
      raw_title: None,
      jump_address: None,
    });
  }

  if prefix.len() >= 8 {
    let arr = [
      prefix[0], prefix[1], prefix[2], prefix[3], prefix[4], prefix[5], prefix[6], prefix[7],
    ];
    let f64_val = if le {
      f64::from_le_bytes(arr)
    } else {
      f64::from_be_bytes(arr)
    };
    entries.push(DataInspectorEntry {
      label: "float64".to_owned(),
      value: format_float(f64_val, 10),
      raw_title: None,
      jump_address: None,
    });
  }

  let ptr_bytes = if address_size_bits == 32 { 4 } else { 8 };
  if prefix.len() >= ptr_bytes {
    let ptr_val = if ptr_bytes == 4 {
      let arr = [prefix[0], prefix[1], prefix[2], prefix[3]];
      u64::from(if le {
        u32::from_le_bytes(arr)
      } else {
        u32::from_be_bytes(arr)
      })
    } else {
      let arr = [
        prefix[0], prefix[1], prefix[2], prefix[3], prefix[4], prefix[5], prefix[6], prefix[7],
      ];
      if le {
        u64::from_le_bytes(arr)
      } else {
        u64::from_be_bytes(arr)
      }
    };
    let space = if default_space.is_empty() {
      "ram"
    } else {
      default_space
    };
    let width = if address_width == 0 {
      ptr_bytes * 2
    } else {
      address_width
    };
    let target_canonical = format_address(space, ptr_val, width);
    let jump_address =
      find_memory_block(blocks, &target_canonical).map(|_| target_canonical.clone());
    entries.push(DataInspectorEntry {
      label: "Pointer".to_owned(),
      value: format!("0x{ptr_val:0width$x}"),
      raw_title: Some(target_canonical),
      jump_address,
    });
  }

  let mut ascii = String::new();
  for (i, &byte) in prefix.iter().take(32).enumerate() {
    if byte == 0 {
      break;
    }
    if (32..=126).contains(&byte) {
      ascii.push(byte as char);
    } else if byte == 9 {
      ascii.push_str("\\t");
    } else {
      if i < 2 {
        ascii.clear();
      }
      break;
    }
  }
  if ascii.len() >= 2 {
    entries.push(DataInspectorEntry {
      label: "ASCII".to_owned(),
      value: format!("\"{ascii}\""),
      raw_title: Some(ascii),
      jump_address: None,
    });
  }

  let nul_pos = prefix.iter().position(|&b| b == 0).unwrap_or(prefix.len());
  let utf8_slice = &prefix[..nul_pos.min(32)];
  let valid_end = match std::str::from_utf8(utf8_slice) {
    Ok(_) => utf8_slice.len(),
    Err(e) => e.valid_up_to(),
  };
  if valid_end > 0
    && let Ok(valid_str) = std::str::from_utf8(&utf8_slice[..valid_end])
  {
    let printable: String = valid_str
      .chars()
      .take_while(|&c| !c.is_control() || c == '\t')
      .map(|c| if c == '\t' { ' ' } else { c })
      .collect();
    if !printable.is_empty() && !printable.is_ascii() {
      entries.push(DataInspectorEntry {
        label: "UTF-8".to_owned(),
        value: format!("\"{printable}\""),
        raw_title: Some(printable),
        jump_address: None,
      });
    }
  }

  entries
}

/// Formats decoded inspector rows for `ghidra.inspectBytes`.
pub(crate) fn inspect_bytes(
  bytes: &[Option<u8>],
  endian: &str,
  address_size_bits: u64,
  blocks: &[MemoryBlockInfo],
  default_space: &str,
  address_width: usize,
) -> Value {
  let entries = decode_data_inspector(
    bytes,
    endian,
    address_size_bits,
    blocks,
    default_space,
    address_width,
  );
  json!({ "entries": entries })
}
