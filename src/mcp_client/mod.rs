// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

//! Declarative MCP pagination and batch validation policies.

/// Declarative `batch.execute` item and allowlist policies.
mod batch;
/// Declarative cursor pagination policies for multi-page MCP lists.
mod pagination;

pub(crate) use batch::{allow_read, allow_write, resource_operation};
pub(crate) use pagination::{PagePolicy, PageRequest, next_cursor};
