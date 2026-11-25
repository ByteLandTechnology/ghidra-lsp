// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Singleflight coordinators for concurrent decompilation and symbol-table requests.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use anyhow::{Result, bail};
use tokio::sync::watch;
use tower_lsp_server::ls_types::Uri;

use crate::document::{Symbol, same_address};

/// Broadcast state of one in-flight operation.
#[derive(Clone)]
pub(super) enum FlightState<T> {
  /// The leader task is still running the backend request.
  Pending,
  /// The leader task finished with a value or formatted error text.
  Ready(std::result::Result<T, String>),
  /// The leader task stopped before completion so followers must retry.
  Cancelled,
}

/// Outcome returned when a caller checks for an active singleflight slot.
pub(super) enum Registration<T, G> {
  /// This caller owns the new slot and must complete `guard`.
  Leader(G),
  /// Another caller owns the slot; await `receiver` outside engine locks.
  Follower(watch::Receiver<FlightState<T>>),
}

/// Active decompilation slot for one `(md5, entry)` function target.
struct OpenEntry {
  /// Monotonic slot identifier used to remove only this leader on completion.
  id: u64,
  /// Lowercase 32-character session MD5 hash.
  md5: String,
  /// Decoded function entry selector string.
  entry: String,
  /// Watch receiver cloned by followers that join this slot.
  receiver: watch::Receiver<FlightState<Uri>>,
}

/// Coordinates concurrent cache-miss decompilations for `(md5, entry)` targets.
pub(crate) struct OpenFlights {
  /// Active in-flight function decompilations.
  entries: Mutex<Vec<OpenEntry>>,
  /// Counter used to assign unique slot identifiers.
  next_id: AtomicU64,
}

/// Drop-safe guard held by the leader of an `(md5, entry)` decompilation slot.
pub(super) struct OpenLeader<'a> {
  /// Coordinator table that owns the active slot entry.
  flights: &'a OpenFlights,
  /// Unique identifier of this leader slot.
  id: u64,
  /// Watch sender used to broadcast completion or cancellation to followers.
  sender: watch::Sender<FlightState<Uri>>,
  /// True after [`OpenLeader::complete`] publishes the final result.
  completed: bool,
}

impl OpenFlights {
  /// Creates an empty function-decompilation singleflight table.
  pub(crate) fn new() -> Self {
    Self {
      entries: Mutex::new(Vec::new()),
      next_id: AtomicU64::new(1),
    }
  }

  /// Removes all tracked slots when the server resets engine state.
  pub(crate) fn clear(&self) {
    self
      .entries
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .clear();
  }

  /// Detaches active decompilation slots for `md5` when that session closes.
  pub(crate) fn forget_session(&self, md5: &str) {
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    entries.retain(|item| item.md5 != md5);
  }

  /// Joins an existing `(md5, entry)` slot or registers the caller as leader.
  pub(super) fn acquire(&self, md5: &str, entry: &str) -> Registration<Uri, OpenLeader<'_>> {
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(existing) = entries
      .iter()
      .find(|item| item.md5 == md5 && (item.entry == entry || same_address(&item.entry, entry)))
    {
      return Registration::Follower(existing.receiver.clone());
    }
    let id = self.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = watch::channel(FlightState::Pending);
    entries.push(OpenEntry {
      id,
      md5: md5.to_owned(),
      entry: entry.to_owned(),
      receiver,
    });
    Registration::Leader(OpenLeader {
      flights: self,
      id,
      sender,
      completed: false,
    })
  }

  /// Removes slot `id` from the active list.
  fn remove(&self, id: u64) {
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    entries.retain(|item| item.id != id);
  }
}

impl OpenLeader<'_> {
  /// Publishes `result` to waiting followers and removes this slot.
  pub(super) fn complete(mut self, result: &Result<Uri>) {
    self.flights.remove(self.id);
    let payload = match result {
      Ok(uri) => Ok(uri.clone()),
      Err(error) => Err(format!("{error:#}")),
    };
    let _ = self.sender.send(FlightState::Ready(payload));
    self.completed = true;
  }
}

impl Drop for OpenLeader<'_> {
  fn drop(&mut self) {
    if !self.completed {
      self.flights.remove(self.id);
      let _ = self.sender.send(FlightState::Cancelled);
    }
  }
}

/// Active symbol-table load slot for one `md5` session.
struct SymbolEntry {
  /// Monotonic slot identifier used to remove only this leader on completion.
  id: u64,
  /// Watch receiver cloned by followers that join this slot.
  receiver: watch::Receiver<FlightState<Vec<Symbol>>>,
}

/// Coordinates concurrent cache-miss symbol loads per `md5` session.
pub(crate) struct SymbolFlights {
  /// Active symbol-table loads keyed by lowercase session MD5.
  entries: Mutex<HashMap<String, SymbolEntry>>,
  /// Counter used to assign unique slot identifiers.
  next_id: AtomicU64,
}

/// Drop-safe guard held by the leader of a session symbol-load slot.
pub(super) struct SymbolLeader<'a> {
  /// Coordinator map that owns the active slot entry.
  flights: &'a SymbolFlights,
  /// Lowercase 32-character session MD5 key.
  md5: String,
  /// Unique identifier of this leader slot.
  id: u64,
  /// Watch sender used to broadcast completion or cancellation to followers.
  sender: watch::Sender<FlightState<Vec<Symbol>>>,
  /// True after [`SymbolLeader::complete`] publishes the final result.
  completed: bool,
}

impl SymbolFlights {
  /// Creates an empty symbol-load singleflight table.
  pub(crate) fn new() -> Self {
    Self {
      entries: Mutex::new(HashMap::new()),
      next_id: AtomicU64::new(1),
    }
  }

  /// Removes all tracked slots when the server resets engine state.
  pub(crate) fn clear(&self) {
    self
      .entries
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .clear();
  }

  /// Detaches any active symbol-load slot for `md5` when that session closes.
  pub(crate) fn forget_session(&self, md5: &str) {
    self
      .entries
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .remove(md5);
  }

  /// Joins an existing `md5` symbol-load slot or registers the caller as leader.
  pub(super) fn acquire(&self, md5: &str) -> Registration<Vec<Symbol>, SymbolLeader<'_>> {
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(existing) = entries.get(md5) {
      return Registration::Follower(existing.receiver.clone());
    }
    let id = self.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = watch::channel(FlightState::Pending);
    entries.insert(md5.to_owned(), SymbolEntry { id, receiver });
    Registration::Leader(SymbolLeader {
      flights: self,
      md5: md5.to_owned(),
      id,
      sender,
      completed: false,
    })
  }

  /// Removes slot `(md5, id)` when it still matches the active entry.
  fn remove(&self, md5: &str, id: u64) {
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    if entries.get(md5).is_some_and(|item| item.id == id) {
      entries.remove(md5);
    }
  }
}

impl SymbolLeader<'_> {
  /// Publishes `result` to waiting followers and removes this slot.
  pub(super) fn complete(mut self, result: &Result<Vec<Symbol>>) {
    self.flights.remove(&self.md5, self.id);
    let payload = match result {
      Ok(symbols) => Ok(symbols.clone()),
      Err(error) => Err(format!("{error:#}")),
    };
    let _ = self.sender.send(FlightState::Ready(payload));
    self.completed = true;
  }
}

impl Drop for SymbolLeader<'_> {
  fn drop(&mut self) {
    if !self.completed {
      self.flights.remove(&self.md5, self.id);
      let _ = self.sender.send(FlightState::Cancelled);
    }
  }
}

/// Waits for `receiver` to finish and returns `Ok(None)` if the leader cancelled.
pub(super) async fn wait_flight<T: Clone>(
  mut receiver: watch::Receiver<FlightState<T>>,
) -> Result<Option<T>> {
  loop {
    let current = receiver.borrow_and_update().clone();
    match current {
      FlightState::Pending => {
        if receiver.changed().await.is_err() {
          return Ok(None);
        }
      }
      FlightState::Ready(Ok(value)) => return Ok(Some(value)),
      FlightState::Ready(Err(message)) => bail!("{message}"),
      FlightState::Cancelled => return Ok(None),
    }
  }
}
