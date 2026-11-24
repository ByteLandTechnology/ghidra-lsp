// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Shared cache, payload data models, and exports for listing, memory, and inspector views.

/// Shared string, byte, symbol, and batch response formatting helpers.
mod format;
/// Data inspector decoding for integers, floats, pointers, and strings.
mod inspector;
/// Pure listing window builder and undefined-byte run collapsing.
mod listing_build;
/// Bounded RPC fetch pipeline for listing windows.
mod listing_fetch;
/// Bounded hexadecimal memory window and navigation helpers.
mod memory;
/// Cached program metadata loader and target address resolution.
mod meta;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

use crate::address::MemoryBlockInfo;

pub(crate) use format::symbol_display_name;
pub(crate) use inspector::inspect_bytes;
pub(crate) use listing_fetch::{ListingWindowRequest, listing_window};
pub(crate) use memory::{MemoryWindowRequest, memory_window};
pub(crate) use meta::{program_meta, resolve_target};

/// Default maximum unit count requested for one listing window.
pub(super) const DEFAULT_LISTING_LIMIT: usize = 140;
/// Default byte window size fetched for one hexadecimal memory chunk.
pub(super) const DEFAULT_HEX_CHUNK_BYTES: usize = 1024;
/// Maximum address count batched per cross-reference lookup wave.
pub(super) const MAX_XREF_BATCH: usize = 64;
/// Minimum consecutive undefined bytes collapsed into a single summary run.
pub(super) const COLLAPSE_THRESHOLD: usize = 8;

/// Cached summary metadata for a single Ghidra function.
#[derive(Clone, Debug)]
pub(super) struct RawFunctionMeta {
  /// Canonical entry address string.
  pub(super) entry: String,
  /// Unqualified symbol name.
  pub(super) name: String,
  /// Containing namespace path.
  pub(super) namespace: String,
  /// Optional demangled symbol signature or name.
  pub(super) demangled_name: Option<String>,
}

/// Cached program layout, endianness, blocks, and function index for a session.
#[derive(Clone, Debug)]
pub(super) struct CachedProgramMeta {
  /// Lowercase 32-character program MD5 hash.
  pub(super) md5: String,
  /// Human-readable binary name or MD5 fallback.
  pub(super) program_name: String,
  /// Byte order reported by Ghidra (`little` or `big`).
  pub(super) endian: String,
  /// Default pointer size in bits.
  pub(super) address_size_bits: u64,
  /// Default memory address space name.
  pub(super) default_space: String,
  /// Display width in hexadecimal digits for default addresses.
  pub(super) address_width: usize,
  /// Sorted memory blocks defined in the program.
  pub(super) blocks: Vec<MemoryBlockInfo>,
  /// Initial view target address chosen from executable or loaded blocks.
  pub(super) default_address: Option<String>,
  /// Indexed functions loaded from the backend.
  pub(super) functions: Vec<RawFunctionMeta>,
}

/// Per-session cache of bounded `ghidra_graph callgraph` responses.
#[derive(Clone, Debug, Default)]
struct CallGraphCache {
  /// Cached `ghidra_graph callgraph` payloads keyed by serialized query parameters.
  responses: HashMap<String, Value>,
}

/// Shared asynchronous cache of program metadata and bounded call-graph queries.
#[derive(Default)]
pub(crate) struct ProgramMetaCache {
  /// Cached program metadata keyed by lowercase MD5 hash.
  inner: RwLock<HashMap<String, CachedProgramMeta>>,
  /// Cached call-graph lookups keyed by lowercase MD5 hash.
  call_graph: RwLock<HashMap<String, CallGraphCache>>,
}

/// Alias used by the LSP server for the shared view metadata and graph cache.
pub(crate) type ViewCache = ProgramMetaCache;

impl ProgramMetaCache {
  /// Creates an empty view metadata cache.
  pub(crate) fn new() -> Self {
    Self::default()
  }

  /// Drops all cached program metadata and call-graph entries for session `md5`.
  pub(crate) async fn invalidate(&self, md5: &str) {
    let key = md5.to_ascii_lowercase();
    self.inner.write().await.remove(&key);
    self.call_graph.write().await.remove(&key);
  }

  /// Clears cached program metadata and call graphs for every session.
  pub(crate) async fn invalidate_all(&self) {
    self.inner.write().await.clear();
    self.call_graph.write().await.clear();
  }

  /// Drops cached call-graph entries for session `md5`.
  pub(crate) async fn invalidate_call_graph(&self, md5: &str) {
    self
      .call_graph
      .write()
      .await
      .remove(&md5.to_ascii_lowercase());
  }

  /// Reads a cached `ghidra_graph callgraph` payload for `query_key` inside session `md5`.
  pub(crate) async fn get_cached_call_graph(&self, md5: &str, query_key: &str) -> Option<Value> {
    self
      .call_graph
      .read()
      .await
      .get(&md5.to_ascii_lowercase())
      .and_then(|cg| cg.responses.get(query_key).cloned())
  }

  /// Stores a `ghidra_graph callgraph` payload for `query_key` inside session `md5`.
  pub(crate) async fn insert_cached_call_graph(&self, md5: &str, query_key: String, value: Value) {
    let mut guard = self.call_graph.write().await;
    let cg = guard.entry(md5.to_ascii_lowercase()).or_default();
    if cg.responses.len() >= 128 && !cg.responses.contains_key(&query_key) {
      cg.responses.clear();
    }
    cg.responses.insert(query_key, value);
  }

  /// Looks up cached program metadata for `md5`.
  pub(super) async fn get(&self, md5: &str) -> Option<CachedProgramMeta> {
    self
      .inner
      .read()
      .await
      .get(&md5.to_ascii_lowercase())
      .cloned()
  }

  /// Saves loaded program metadata for `md5`.
  pub(super) async fn insert(&self, md5: &str, meta: CachedProgramMeta) {
    self
      .inner
      .write()
      .await
      .insert(md5.to_ascii_lowercase(), meta);
  }
}

/// Serializable function metadata entry returned by `ghidra.programMeta`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProgramFunctionMeta {
  /// Canonical entry address.
  pub(super) entry: String,
  /// Raw symbol name.
  pub(super) name: String,
  /// Containing namespace path.
  pub(super) namespace: String,
  /// Optional demangled function name or signature.
  #[serde(rename = "demangled_name")]
  pub(super) demangled_name: Option<String>,
  /// Formatted symbol name honoring template display configuration.
  pub(super) display_name: String,
}

/// Label attached to a listing address.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingLabel {
  /// Optional backend symbol identifier.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) id: Option<String>,
  /// Formatted label text shown in the listing view.
  pub(super) name: String,
  /// Full uncollapsed symbol details for hover tooltips.
  pub(super) full_tooltip: String,
  /// Whether this is the primary symbol at the address.
  pub(super) primary: bool,
}

/// Incoming cross-reference summary shown beside a listing unit.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingXref {
  /// Source address string reported by the backend.
  pub(super) from: String,
  /// Formatted caller function or address label.
  pub(super) label: String,
  /// Short reference-kind suffix such as `(c)` or `(R)`.
  pub(super) suffix: String,
  /// Raw backend cross-reference type string.
  #[serde(rename = "type")]
  pub(super) kind: String,
  /// Whether clicking `from` navigates inside program memory.
  pub(super) navigable: bool,
}

/// Outgoing call or data target associated with a listing unit.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingTarget {
  /// Canonical target address.
  pub(super) to: String,
  /// Resolved symbol name or display address at `to`.
  pub(super) label: String,
  /// Backend reference type string.
  pub(super) kind: String,
  /// Optional formatted constant or string preview at `to`.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) preview: Option<String>,
  /// Whether the target address already appears inline in operands.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) inline_only: Option<bool>,
}

/// Parameter or local variable entry shown inside a listing function header.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingVariable {
  /// Variable category (`param` or `local`).
  pub(super) kind: String,
  /// Short data-type name.
  pub(super) data_type: String,
  /// Display storage location such as `RDI`, `Stack[-0x10]`, or `param#0`.
  pub(super) storage: String,
  /// Optional raw backend storage serialization string.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) raw_storage: Option<String>,
  /// Variable identifier or fallback label.
  pub(super) name: String,
}

/// Structured function header rendered above the entry unit of a function.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingFunctionHeader {
  /// Canonical function entry address.
  pub(super) entry: String,
  /// Function signature formatted for display.
  pub(super) display_signature: String,
  /// Uncollapsed function signature string.
  pub(super) raw_signature: String,
  /// Formatted function display name.
  pub(super) name: String,
  /// Optional raw mangled symbol name when different from demangled display name.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) mangled_name: Option<String>,
  /// Explicit calling convention when omitted from `display_signature`.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) calling_convention: Option<String>,
  /// Boolean attribute badges such as `thunk`, `external`, or `noreturn`.
  pub(super) flags: Vec<String>,
  /// Ordered parameters and local variables declared on the function.
  pub(super) variables: Vec<ListingVariable>,
}

/// Banner describing the memory block entered at a listing row.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingBlockHeader {
  /// Block name.
  pub(super) name: String,
  /// Block start address.
  pub(super) start: String,
  /// Block end address.
  pub(super) end: String,
  /// Formatted permission triplet such as `R-X`.
  pub(super) permissions: String,
  /// Whether the block contains initialized bytes.
  pub(super) initialized: bool,
  /// Optional non-default block kind string.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) kind: Option<String>,
  /// Cleaned block comment without trailing address range suffix.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) comment: Option<String>,
}

/// Normalized code or data listing row ready for webview rendering.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingUnit {
  /// Unit category (`instruction` or `data`).
  pub(super) kind: String,
  /// Canonical unit address.
  pub(super) address: String,
  /// Unit size in bytes.
  pub(super) byte_length: usize,
  /// Containing function entry address when inside a function body.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) entry: Option<String>,
  /// Display name of the containing function.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) function_name: Option<String>,
  /// Full hexadecimal byte sequence separated by spaces.
  pub(super) bytes_text: String,
  /// Truncated hexadecimal byte preview (up to eight bytes).
  pub(super) bytes_short: String,
  /// Instruction mnemonic or formatted data type name.
  pub(super) mnemonic: String,
  /// Formatted instruction operands or data value representation.
  pub(super) operands_text: String,
  /// Optional Ghidra data-type path when unit data type starts with `/`.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) type_path: Option<String>,
  /// Block banner emitted when transitioning into a new memory block.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) block_header: Option<ListingBlockHeader>,
  /// Combined plate comment rendered above the unit.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) plate_comment: Option<String>,
  /// Structured function header emitted at a function entry address.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) function_header: Option<ListingFunctionHeader>,
  /// Non-duplicate symbol labels attached at this address.
  pub(super) labels: Vec<ListingLabel>,
  /// Up to four incoming cross-references to this unit.
  pub(super) xrefs: Vec<ListingXref>,
  /// Total count of incoming cross-references before truncation.
  pub(super) xref_total: usize,
  /// Pre-instruction or pre-data comment lines.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) pre_comment: Option<String>,
  /// Post-instruction or post-data comment lines.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) post_comment: Option<String>,
  /// Merged end-of-line and repeatable comment text.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) eol_comment: Option<String>,
  /// Resolved outgoing branch or data reference targets.
  pub(super) targets: Vec<ListingTarget>,
  /// Present and true for collapsible undefined single-byte rows.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) is_undefined_byte: Option<bool>,
}

/// Collapsed run of contiguous undefined or uninitialized bytes in a listing window.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ListingUndefinedRun {
  /// Fixed item kind string `"undefinedRun"`.
  pub(super) kind: String,
  /// Start address of the collapsed run.
  pub(super) start_address: String,
  /// End address of the collapsed run.
  pub(super) end_address: String,
  /// Number of single-byte rows collapsed together.
  pub(super) byte_length: usize,
  /// True when the underlying block bytes are uninitialized (`??`).
  pub(super) uninitialized: bool,
  /// Optional memory block header at the start of the run.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) block_header: Option<ListingBlockHeader>,
  /// Original constituent units preserved for on-demand expansion.
  pub(super) units: Vec<ListingUnit>,
}

/// Polymorphic row inside `collapsedItems` of a listing window response.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(super) enum ListingRenderItem {
  /// Uncollapsed code or data listing row.
  Unit(Box<ListingUnit>),
  /// Collapsed contiguous run of undefined single-byte rows.
  UndefinedRun(Box<ListingUndefinedRun>),
}

/// Single byte cell inside a hexadecimal memory view row.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct HexCell {
  /// Column index within the row (`0..bytes_per_row`).
  pub(super) offset_in_row: usize,
  /// Canonical address of this cell when inside the memory block.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) address: Option<String>,
  /// Byte value when inside an initialized block and loaded.
  pub(super) value: Option<u8>,
  /// True when this cell lies within the enclosing memory block bounds.
  pub(super) in_block: bool,
  /// Optional primary or named symbol at this byte address.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) symbol: Option<String>,
}

/// Fixed-width aligned row inside a hexadecimal memory chunk.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct HexRow {
  /// Aligned base address of the row.
  pub(super) row_address: String,
  /// Address of the first cell in the row that falls inside the block.
  pub(super) first_in_block_address: String,
  /// Byte cells ordered from column zero to `bytes_per_row - 1`.
  pub(super) cells: Vec<HexCell>,
}

/// Contiguous slice of memory formatted as aligned hexadecimal rows.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct HexChunk {
  /// Enclosing memory block descriptor.
  pub(super) block: MemoryBlockInfo,
  /// Aligned address of the first rendered row.
  pub(super) row_start: String,
  /// Inclusive slice start address clamped to the block.
  pub(super) start: String,
  /// Inclusive slice end address clamped to the block.
  pub(super) end: String,
  /// Number of bytes represented by `[start, end]`.
  pub(super) byte_length: usize,
  /// Column count per row (`8` or `16`).
  pub(super) bytes_per_row: usize,
  /// Rendered rows covering `[start, end]`.
  pub(super) rows: Vec<HexRow>,
}

/// Decoded interpretation row shown in the memory data inspector panel.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct DataInspectorEntry {
  /// Scalar type label such as `int32 / uint32` or `Pointer`.
  pub(super) label: String,
  /// Formatted value string.
  pub(super) value: String,
  /// Optional unformatted value or canonical pointer target for hover tooltips.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) raw_title: Option<String>,
  /// Navigable canonical target address when `Pointer` points into program memory.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) jump_address: Option<String>,
}
