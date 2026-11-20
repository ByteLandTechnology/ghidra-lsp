# AGENTS.md: rules for this repository

These rules apply to all persons and agents that change this repository.
The command `cargo xtask ci` makes sure that most of these rules are obeyed.

## Writing

- Use ASD-STE100 Simplified Technical English for all English text.
- This rule applies to this file, code comments, documentation comments,
  and commit messages.

## Independence and protocol boundaries

- This repository is independent of `ghidra-mcp`. Do not add a path
  dependency, a git dependency, or a workspace reference to `ghidra-mcp`.
- Run `ghidra-mcp` only as a child process over Model Context Protocol
  standard input and output (`ghidra_*` tools).
- Write framed Language Server Protocol JSON-RPC messages exclusively to
  `stdout`. Write logs only to `stderr`.
- Keep pseudocode and analysis views strictly in memory (`ghidra://`,
  `ghidra-listing://`, `ghidra-memory://`, `ghidra-type://`,
  `ghidra-string://`, `ghidra-reference://`). Write zero `.c` or `.h`
  files to disk.
- Keep lowercase 32-hex `md5` hashes, canonical `space:offset`
  addresses, symbol IDs, and raw mangled names unchanged in URIs and RPC
  payloads. Format `ram:` addresses as bare hex and collapse outer C++
  template arguments only for display.
- Compute LSP `Position` and `Range` values in UTF-16 code units, slice
  UTF-8 strings only at character boundaries, and compute addresses with
  checked `u64` math.
- Enforce controlled persistence: route edits through scoped rename
  previews with origin save, and read backend state before retry after a
  write timeout.
- Enforce the single-decompile request budget: retrieve GUI lines,
  tokens, cursor addresses, and all five comment kinds in one
  `decompilation.get` call, and batch multi-item reads via `ghidra_batch`
  or bounded `list_all`.

## Layout

- The workspace has two members: the root binary package `ghidra-lsp`
  (`src/`) and `xtask` (`xtask/`).
- `editors/nvim/` holds the Neovim client plugin (`plugin/` and
  `lua/ghidra-lsp/`).
- Keep other editor plugins and all test suites outside this
  repository.

## Disk use and cleanup

- Check free disk space and the sizes of the build, cache, and temporary
  directories before a full build or CI run. Keep at least 20 GiB free
  for these operations.
- Reuse build directories for compatible targets and profiles. Keep
  copied source trees separate from `target/`.
- Remove task-owned temporary files and obsolete build output as soon as
  no active check needs them. Preserve diagnostic logs and files that
  the user owns.

## Modules and files

- Divide `src/` into modules by domain.
- Use `src/main.rs` as the binary entry point. Do not add `src/lib.rs`.
- Use private or `pub(crate)` visibility by default. The
  `unreachable_pub` lint is on.
- Before you write a helper, look in existing modules. Do not copy a
  helper into a second module.
- Each `.rs` or `.lua` file must have no more than 800 lines of code.
  Comments and blank lines are not counted. There are no exceptions.

## Code rules

- Declare each third-party dependency and its version in the
  `Cargo.toml` file of its package. Do not use `[workspace.dependencies]`.
- Use only one version of each dependency in the workspace. `cargo deny`
  makes sure of this. If a transitive dependency makes this impossible,
  add it to `skip` in `deny.toml` and write the reason.
- Forbid `unsafe` code.
- Do not use `unwrap()` or `expect()`. Handle each error explicitly.
- Do not use `#[allow(...)]` or `#[expect(...)]`. Change the code to
  remove the lint warning.
- Do not use the `async-trait` crate. Use concrete backend types or
  native `async fn`.
- If a function needs many arguments, use a parameter struct.
- Write complete documentation comments on every crate, module, struct,
  enum, variant, field, constant, type alias, and function, including
  private items.

## Tests

- Put all tests, test data, and test tools outside this repository. Use
  the compiled `ghidra-lsp` binary over standard input and output for
  external tests.
- Do not add tests, `tests/` or `benches/` directories, test targets, or
  `[dev-dependencies]` to this repository.
- Do not add production code that exists only for tests. Examples are
  mock traits, fakes, recording doubles, and test-only wrapper
  functions.
- Do not write Rust code examples in documentation comments, because
  rustdoc runs them as tests. This rule also applies to a Markdown file
  that a crate includes as its documentation.

## License header

Start each Rust source file with these two lines:

```text
// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT
```

Start each Lua source file with these two lines:

```lua
-- Copyright 2026 ByteLand Technology Limited
-- SPDX-License-Identifier: MIT
```

## Commit messages

- Obey Conventional Commits.
- Use no more than 72 characters on each line, including spaces and
  list markers.
- Use lowercase letters for the type and the scope.
- Use these scopes:
  - `backend`: the MCP client transport in `src/backend.rs`.
  - `address`: address math and string lookups in `src/address.rs`.
  - `binary`: binary inspection and MD5 verification in `src/binary.rs`.
  - `document`: virtual document alignment and comments.
  - `engine`: LSP analysis and editing logic in `src/engine/`.
  - `mutations`: comment, prototype, and variable mutations in
    `src/mutations/`.
  - `types`: JSONC data-type documents in `src/types_doc/`.
  - `views`: listing and memory windows in `src/views/`.
  - `graph`: control-flow and call graphs in `src/graph/`.
  - `workbench`: semantic tokens and project guards in
    `src/workbench.rs`.
  - `server`: LSP protocol dispatch in `src/server/`.
  - `nvim`: the Neovim client plugin in `editors/nvim/`.
  - `xtask`: repository checks in `xtask/`.
  - `docs`: documents.
  - `build`: build, manifest, and ignore files.
  - If a commit changes more than one scope, do not write a scope.
- Start the summary with an imperative verb in lowercase letters.
- Do not put a period at the end of the summary.
- If you write a body, obey these rules:
  - Put one blank line between the header and the body.
  - Write the body as a list with `- ` before each item.
  - Start each item with a capital letter.
  - Put each item on one line. Do not put blank lines in the body.
  - Do not use nested lists.
- Do not add attribution lines such as `Co-Authored-By` to commit
  messages or pull request text.
- Each commit must compile and pass checks.

## Branches

- Commit directly to `main`.
- This project has no released version scheme outside `Cargo.toml`.

## Before you commit

Run `cargo xtask ci`. It runs these checks in order:

- `cargo fmt --all -- --check`
- `cargo xtask check`: license headers, code line limit, and forbidden
  code checks
- `cargo clippy --locked --workspace --all-targets -- -D warnings`
- `cargo doc --locked --workspace --no-deps --document-private-items`
- `cargo build --locked --workspace`
- `cargo deny --locked --workspace check`
