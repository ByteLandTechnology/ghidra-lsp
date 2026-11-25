// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Indexed session symbol table and token-span symbol resolution.

use std::collections::HashMap;

use super::{Span, Symbol, address, same_address};

/// Session symbol table indexed by short name, qualified name, symbol ID, and address offset.
#[derive(Clone, Debug, Default)]
pub(crate) struct SymbolIndex {
  /// Session symbols stored in backend arrival order.
  items: Vec<Symbol>,
  /// Precomputed namespace-qualified name for each symbol in `items`.
  qualified: Vec<String>,
  /// Arrival-ordered symbol indices keyed by short name.
  by_name: HashMap<String, Vec<usize>>,
  /// Arrival-ordered symbol indices keyed by namespace-qualified name.
  by_qualified: HashMap<String, Vec<usize>>,
  /// Arrival-ordered symbol indices keyed by symbol identifier.
  by_id: HashMap<String, Vec<usize>>,
  /// Arrival-ordered symbol indices keyed by parsed hexadecimal address offset.
  by_offset: HashMap<u64, Vec<usize>>,
}

impl SymbolIndex {
  /// Builds an indexed symbol table that preserves arrival order across all lookup buckets.
  pub(crate) fn new(items: Vec<Symbol>) -> Self {
    let cap = items.len();
    let mut qualified = Vec::with_capacity(cap);
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::with_capacity(cap);
    let mut by_qualified: HashMap<String, Vec<usize>> = HashMap::with_capacity(cap);
    let mut by_id: HashMap<String, Vec<usize>> = HashMap::with_capacity(cap);
    let mut by_offset: HashMap<u64, Vec<usize>> = HashMap::with_capacity(cap);

    for (idx, sym) in items.iter().enumerate() {
      let qual = sym.qualified();
      by_name.entry(sym.name.clone()).or_default().push(idx);
      by_qualified.entry(qual.clone()).or_default().push(idx);
      by_id.entry(sym.id.clone()).or_default().push(idx);
      if let Some((_, off)) = address(&sym.address) {
        by_offset.entry(off).or_default().push(idx);
      }
      qualified.push(qual);
    }

    Self {
      items,
      qualified,
      by_name,
      by_qualified,
      by_id,
      by_offset,
    }
  }

  /// Returns the first symbol in arrival order with identifier `id`.
  pub(crate) fn by_id(&self, id: &str) -> Option<&Symbol> {
    self
      .by_id
      .get(id)
      .and_then(|indices| indices.first())
      .map(|&idx| &self.items[idx])
  }

  /// Iterates over all symbols paired with their precomputed qualified names in arrival order.
  pub(crate) fn iter_with_qualified(&self) -> impl Iterator<Item = (&Symbol, &str)> {
    self
      .items
      .iter()
      .zip(self.qualified.iter().map(String::as_str))
  }

  /// Returns the first symbol in arrival order whose short or qualified name equals `name`.
  pub(crate) fn find_by_name(&self, name: &str) -> Option<&Symbol> {
    let by_short = self.by_name.get(name).and_then(|v| v.first().copied());
    let by_qual = self.by_qualified.get(name).and_then(|v| v.first().copied());
    by_short
      .into_iter()
      .chain(by_qual)
      .min()
      .map(|idx| &self.items[idx])
  }

  /// Returns the first symbol matching `name`, its qualified name, or `addr` via `same_address`.
  pub(crate) fn find_by_name_or_address(&self, name: &str, addr: Option<&str>) -> Option<&Symbol> {
    let by_short = self.by_name.get(name).and_then(|v| v.first().copied());
    let by_qual = self.by_qualified.get(name).and_then(|v| v.first().copied());
    let by_addr = addr.and_then(|target| {
      let (_, off) = address(target)?;
      self
        .by_offset
        .get(&off)?
        .iter()
        .copied()
        .find(|&idx| same_address(target, &self.items[idx].address))
    });
    [by_short, by_qual, by_addr]
      .into_iter()
      .flatten()
      .min()
      .map(|idx| &self.items[idx])
  }

  /// Finds a function symbol by compatible address first, then by short or qualified name.
  pub(crate) fn find_function(&self, entry_or_addr: Option<&str>, name: &str) -> Option<&Symbol> {
    if let Some(addr) = entry_or_addr
      && let Some((_, off)) = address(addr)
      && let Some(idx) = self.by_offset.get(&off).and_then(|indices| {
        indices.iter().copied().find(|&idx| {
          let sym = &self.items[idx];
          sym.kind.eq_ignore_ascii_case("function") && same_address(&sym.address, addr)
        })
      })
    {
      return Some(&self.items[idx]);
    }
    let by_short = self.by_name.get(name).and_then(|indices| {
      indices
        .iter()
        .copied()
        .find(|&idx| self.items[idx].kind.eq_ignore_ascii_case("function"))
    });
    let by_qual = self.by_qualified.get(name).and_then(|indices| {
      indices
        .iter()
        .copied()
        .find(|&idx| self.items[idx].kind.eq_ignore_ascii_case("function"))
    });
    by_short
      .into_iter()
      .chain(by_qual)
      .min()
      .map(|idx| &self.items[idx])
  }

  /// Finds the first function symbol in arrival order matching short `name` or exact `exact_addr`.
  pub(crate) fn find_function_by_name_or_exact_address(
    &self,
    name: &str,
    exact_addr: Option<&str>,
  ) -> Option<&Symbol> {
    let by_short = self.by_name.get(name).and_then(|indices| {
      indices
        .iter()
        .copied()
        .find(|&idx| self.items[idx].kind.eq_ignore_ascii_case("function"))
    });
    let by_addr = exact_addr.and_then(|target| {
      let (_, off) = address(target)?;
      self.by_offset.get(&off)?.iter().copied().find(|&idx| {
        let sym = &self.items[idx];
        sym.kind.eq_ignore_ascii_case("function") && sym.address == target
      })
    });
    by_short
      .into_iter()
      .chain(by_addr)
      .min()
      .map(|idx| &self.items[idx])
  }

  /// Resolves a candidate decompiler `span` using arrival-ordered name and offset buckets.
  pub(super) fn resolve_span(&self, span: &Span) -> Option<&Symbol> {
    let text = span.token.text.as_str();
    let short_slice = self.by_name.get(text).map_or(&[][..], Vec::as_slice);
    let qual_slice = self.by_qualified.get(text).map_or(&[][..], Vec::as_slice);
    let addr_slice = if span.location.is_none() {
      span
        .token
        .address
        .as_deref()
        .and_then(address)
        .and_then(|(_, off)| self.by_offset.get(&off))
        .map_or(&[][..], Vec::as_slice)
    } else {
      &[]
    };

    let mut count = 0usize;
    let mut first_candidate = None;
    let mut first_exact = None;
    let mut name_match_count = 0usize;
    let mut first_name_match = None;

    for idx in (MergedIndices {
      slices: [short_slice, qual_slice, addr_slice],
    }) {
      let sym = &self.items[idx];
      if !span_kind_matches(&span.token.kind, sym) {
        continue;
      }
      let name_match = sym.name == text || self.qualified[idx] == text;
      let addr_match = span.location.is_none()
        && span
          .token
          .address
          .as_deref()
          .is_some_and(|addr| same_address(addr, &sym.address));
      if !name_match && !addr_match {
        continue;
      }
      count += 1;
      if first_candidate.is_none() {
        first_candidate = Some(idx);
      }
      if name_match && addr_match && first_exact.is_none() {
        first_exact = Some(idx);
      }
      if name_match {
        name_match_count += 1;
        if first_name_match.is_none() {
          first_name_match = Some(idx);
        }
      }
    }

    let chosen = if count == 1 {
      first_candidate
    } else if count > 1 {
      if first_exact.is_some() {
        first_exact
      } else if name_match_count == 1 {
        first_name_match
      } else {
        None
      }
    } else {
      None
    };
    chosen.map(|idx| &self.items[idx])
  }
}

/// Yields unique symbol indices in ascending order across three sorted index slices.
struct MergedIndices<'a> {
  /// Remaining ascending index slices from short-name, qualified-name, and offset buckets.
  slices: [&'a [usize]; 3],
}

impl Iterator for MergedIndices<'_> {
  type Item = usize;

  fn next(&mut self) -> Option<usize> {
    let min = self
      .slices
      .iter()
      .filter_map(|slice| slice.first().copied())
      .min()?;
    for slice in &mut self.slices {
      if slice.first().copied() == Some(min) {
        *slice = &slice[1..];
      }
    }
    Some(min)
  }
}

/// Returns true when `sym` is eligible to bind to a decompiler token of `token_kind`.
fn span_kind_matches(token_kind: &str, sym: &Symbol) -> bool {
  if !sym.eligible() {
    return false;
  }
  if token_kind == "function" && !sym.kind.eq_ignore_ascii_case("function") {
    return false;
  }
  if token_kind == "label" && !sym.kind.eq_ignore_ascii_case("label") {
    return false;
  }
  if token_kind == "constant"
    && !sym.kind.eq_ignore_ascii_case("constant")
    && !sym.kind.eq_ignore_ascii_case("label")
    && !sym.kind.eq_ignore_ascii_case("global")
  {
    return false;
  }
  true
}
