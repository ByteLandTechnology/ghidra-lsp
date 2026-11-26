# LSP Protocol and Development Guide

This reference documents every Language Server Protocol (LSP) capability exposed by `ghidra-lsp`, the complete catalog of 45 `workspace/executeCommand` methods, repository module layout, and `AGENTS.md` compliance rules.

## LSP capability matrix

Declared in `Server::initialize` (`src/server/lsp.rs`):

| Capability | Registration | Behavior in `ghidra-lsp` |
| --- | --- | --- |
| `positionEncoding` | `utf-16` | UTF-16 code-unit `Position` and `Range` across all documents |
| `textDocumentSync` | `openClose: true`, `change: FULL`, `save.includeText: true` | Synchronizes `ghidra://` buffers; enforces clean vs pending-rename state on save |
| `hoverProvider` | `true` | Shows symbol name, kind, address, full demangled/raw mangled names, C signature/type, storage, comments, or type metadata |
| `definitionProvider` | `true` | Jumps to function `ghidra://.../function/<entry>`, symbol snapshot, or fallback Listing window |
| `declarationProvider` | `true` | Delegates to `goto_definition` |
| `implementationProvider` | `true` | Delegates to `goto_definition` |
| `typeDefinitionProvider` | `true` | Resolves symbol data type to `ghidra://<md5>/type/<path>.md` snapshot |
| `referencesProvider` | `true` | Finds incoming references across functions (`ghidra://`) and non-decompiled sites (`/references/<id>`) |
| `documentHighlightProvider` | `true` | Highlights matching symbol ID or `type` token occurrences in clean buffers |
| `documentSymbolProvider` | `true` | Returns nested function root and referenced child symbols (`DocumentSymbol`) |
| `workspaceSymbolProvider` | `resolveProvider: true` | Searches program symbols and data types; supports lazy `symbol/resolve` when client supports `location.range` |
| `renameProvider` | `prepareProvider: true` | Validates target span and identifier, plans scoped `WorkspaceEdit` preview across open buffers |
| `completionProvider` | `resolveProvider: false` | Offers locals, program symbols, and 32 built-in decompiler types (`COMMON_TYPES`) |
| `signatureHelpProvider` | Triggers `(`, `,`; retrigger `,` | Displays active function signature and parameter index inside call expressions |
| `semanticTokensProvider` | Full document | Maps tokens to `keyword`, `comment`, `type`, `function`, `variable`, `parameter`, `number`, `string` with `readonly` modifier on constants |
| `codeActionProvider` | `quickfix`, `refactor` | Offers `Edit comments at <addr>…` (`quickfix`) plus type inspection, signature/variable editing, Listing, CFG, Call Graph, Callers, Callees, and References |
| `inlayHintProvider` | `true` | Displays local variable storage (`: <storage>`) and call-target addresses (`[<addr>] `) |
| `callHierarchyProvider` | `true` | Prepares `CallHierarchyItem` and resolves incoming callers and outgoing callees |
| `codeLensProvider` | `resolveProvider: false` | Emits function header lenses for `Listing`, `Call Graph`, `Control Flow`, `Callers`, `Callees`, and `References` |
| `foldingRangeProvider` | `true` | Computes comment block (`//`, `/* ... */`) and brace `{ ... }` folding ranges |
| `documentLinkProvider` | `resolveProvider: false` | Links inline `ghidra://` URIs, `ram:<hex>` addresses, and `0x<hex>` literals to `ghidra://` targets |
| `executeCommandProvider` | 45 commands | Exposes session, analysis, window, mutation, and rename commands listed below |

Custom server notification: `ghidra/changed` (`{"md5": "<32-hex>"}`) notifies clients when cached views or backend analysis state change.

## `workspace/executeCommand` catalog

All 45 commands declared in `COMMANDS` (`src/server/mod.rs`) and dispatched across `commands.rs`, `domain_commands.rs`, `edit_commands.rs`, and `view_commands.rs`:

### Sessions, binaries, and analysis

| Command | Arguments | Description |
| --- | --- | --- |
| `ghidra.sessions` | `{}` | List all known `ghidra-mcp` sessions |
| `ghidra.selectSession` | `{"md5"}` | Verify session is `ready` and set it active |
| `ghidra.openBinary` | `{"path" \| "md5", "analyze?", "programName?", "processor?", "compilerSpec?", "loader?", "baseAddress?", "reimport?"}` | Synchronously open a binary, `.gpr` project, or saved MD5 with optional import flags, run analysis if requested, and wait up to 10 minutes |
| `ghidra.beginOpenBinary` | `{"path" \| "md5", "analyze?", "programName?", "processor?", "compilerSpec?", "loader?", "baseAddress?", "reimport?"}` | Start an async binary or `.gpr` open job with optional import flags and return a polling `token` |
| `ghidra.pollOpenBinary` | `{"token"}` | Advance/poll pending open or analysis job and return progress snapshot |
| `ghidra.beginReanalyze` | `{"md5?", "analyzers?"}` | Start async program reanalysis and return polling `token` |
| `ghidra.reanalyze` | `{"md5?", "analyzers?", "wait?"}` | Start analysis, optionally wait (`default: true`), persist, and refresh open buffers |
| `ghidra.closeSession` | `{"md5?", "force?"}` | Close a clean program session (rejects pending renames or dirty buffers) and clear caches |
| `ghidra.cancelJob` | `{}` | Returns explicit guidance because installed `ghidra-mcp` exposes `job.get` / `job.wait` without `job.cancel` |

### Program catalogs and documents

| Command | Arguments | Description |
| --- | --- | --- |
| `ghidra.program` | `{"md5?"}` | Query `program.get` metadata for the session |
| `ghidra.programMeta` | `{"md5?", "showTemplateArguments?"}` | Return cached endianness, pointer size, memory blocks, default address, and functions |
| `ghidra.functions` | `{"md5?"}` | List all functions with `entry`, `name`, `namespace`, `demangled_name`, and coverage |
| `ghidra.symbols` | `{"md5?"}` | List all program symbols with pagination coverage |
| `ghidra.types` | `{"md5?"}` | List all program data types with pagination coverage |
| `ghidra.type` | `{"md5?", "path"}` | Fetch one raw data type definition with `data_type.get` |
| `ghidra.strings` | `{"md5?"}` | Query defined strings in the program (`address::defined_strings`) |
| `ghidra.binaryInterface` | `{"md5?"}` | Load imports and exports from the Ghidra session (`import.list` and `export.list`), with a local loader-table fallback (`binary::interface`) |
| `ghidra.openFunction` | `{"md5?", "entry"}` | Decompile `entry` and return its canonical `ghidra://` URI |
| `ghidra.openSymbol` | `{"md5?", "id"}` | Resolve symbol `id` to its function or `/symbol/` URI |
| `ghidra.document` | `{"uri", "includePending?"}` | Retrieve or lazily generate text and metadata for a `ghidra://` URI |
| `ghidra.saveDocument` | `{"uri", "text"}` | Save a `ghidra://` document from an explicit payload (only clean or planned F2 rename edits succeed) |
| `ghidra.refreshDocument` | `{"uri"}` | Regenerate one clean virtual document and push client edits if changed |
| `ghidra.refresh` | `{"md5?"}` | Invalidate caches and regenerate all clean virtual documents in the session |
| `ghidra.configure` | `{"templateArguments?"}` | Update live display settings (`"show"` or `"omit"`) |

### Location, navigation, and views

| Command | Arguments | Description |
| --- | --- | --- |
| `ghidra.resolveTarget` | `{"md5?", "input" \| "target", "currentAddress?"}` | Resolve user input (address, relative offset `-0x80`, or symbol) to a canonical target |
| `ghidra.location` | `{"uri", "position?" \| "address?", "version?"}` | Map cursor UTF-16 `Position` to native `CodeLocation`, map `code_unit_address` back to `Position`, or return ordered UTF-16 location spans when `position` and `address` are absent |
| `ghidra.reveal` | `{"md5?", "address"}` | Open containing function and return UTF-16 `Range` for `address` |
| `ghidra.typeAtPosition` | `{"uri", "position"}` | Resolve data type metadata at a decompiler token position |
| `ghidra.listingWindow` | `{"md5?", "address?", "cursor?", "limit?", "showTemplateArguments?", "exactStart?"}` | Fetch bounded disassembly listing window with collapsed undefined byte runs and xrefs |
| `ghidra.memoryWindow` | `{"md5?", "address?", "length?", "bytesPerRow?", "endian?", "inspectAddress?", "selectionLength?"}` | Fetch bounded hexadecimal memory window and initial Data Inspector values |
| `ghidra.inspectBytes` | `{"bytes", "md5?", "endian?", "addressSizeBits?", "defaultSpace?", "addressWidth?", "blocks?"}` | Decode up to 16 bytes (supporting `null` gaps) into integer, float, pointer, and string inspector entries |
| `ghidra.controlFlowGraph` | `{"md5?", "entry?", "address?", "showTemplateArguments?"}` | Build basic-block control-flow graph (`nodes`, `edges`, `blocks`, `scope`) |
| `ghidra.callGraph` | `{"md5?", "entry?", "address?", "callersDepth?", "calleesDepth?", "expansion?", "refresh?", "showTemplateArguments?"}` | Build bounded caller/callee neighborhood using directional depth traversal (`callersDepth`, `calleesDepth`) or interactive per-node `expansion` (`callers` and `callees` branch sets on discovered nodes; caps: 80 nodes, 240 edges, 40 queries) |

### Renames, comments, prototypes, data types, and workbench RPC

| Command | Arguments | Description |
| --- | --- | --- |
| `ghidra.renameState` | `{"md5?"}` | Report pending rename `origin`, `oldName`, `newName`, `documents`, `applied`, `originApplied`, `patched` |
| `ghidra.discardRename` | `{"md5?"}` | Discard pending rename preview and revert clean buffers |
| `ghidra.commentsAt` | `{"md5?", "address"}` | Read all five comment kinds (`plate`, `pre`, `eol`, `post`, `repeatable`) at `address` |
| `ghidra.saveComment` | `{"md5?", "address", "kind" \| "commentType", "text", "expected?"}` | Upsert or delete one comment with optimistic conflict verification and project save |
| `ghidra.functionPrototype` | `{"md5?", "entry"}` | Read function signature, attributes, parameters, locals, and `original` snapshot |
| `ghidra.saveFunctionPrototype` | `{"md5?", "entry", "original", "payload?" \| fields...}` | Validate and apply function signature and parameter edits in one `all_or_none` batch |
| `ghidra.saveVariables` | `{"md5?", "entry", "original", "payload?" \| fields...}` | Validate and apply parameter/local variable name and type edits in one `all_or_none` batch |
| `ghidra.typeDocument` | `{"md5?", "path"}` | Render `.ghidra-type` JSONC document, read-only state, `original` snapshot, and `model` |
| `ghidra.validateTypeDocument` | `{"text", "original"}` | Validate edited JSONC draft and return UTF-16 `range` diagnostics |
| `ghidra.saveTypeDocument` | `{"md5?", "path", "text", "original"}` | Check conflicts, write `data_type` mutation, persist project, refresh functions, and read back normalized JSONC |
| `ghidra.query` | `{"md5?", "domain", "operation", "params?"}` | Policy-checked read-only MCP query (`READ` allowlist in `src/workbench.rs`) |
| `ghidra.mutate` | `{"md5?", "domain", "operation", "params?"}` | Policy-checked MCP write (`WRITE` allowlist or `batch.execute` with `all_or_none`), persist, and refresh |

## Repository layout and module architecture

```text
ghidra-lsp/
├── Cargo.toml                  # Workspace root + ghidra-lsp binary crate (Rust 1.88, edition 2024)
├── deny.toml                   # Dependency license and single-version policy
├── AGENTS.md                   # Engineering, writing, layout, and CI rules
├── src/
│   ├── main.rs                 # Binary entry point and clap CLI parser (no src/lib.rs)
│   ├── backend.rs              # Lazy rmcp child-process client for ghidra-mcp
│   ├── address.rs              # Checked u64 address math, type refs, defined strings
│   ├── binary.rs               # Binary loader import/export inspection (object crate)
│   ├── comments.rs             # Supplemental repeatable comment insertion and span shifting
│   ├── document.rs             # Virtual Document state, UTF-8/UTF-16 mapping, template folding
│   ├── gui.rs                  # Native Ghidra GUI line layout validation
│   ├── workbench.rs            # Semantic tokens and query/mutate policy allowlists
│   ├── engine/                 # Decompilation, navigation, completion, hierarchy, rename lifecycle
│   ├── graph/                  # Basic-block CFG and bounded call-graph builders
│   ├── mutations/              # Comment, function prototype, and variable batch planners
│   ├── server/                 # LSP trait implementation and 45 custom command handlers
│   ├── types_doc/              # JSONC lexer/parser, validation, conflict check, type mutations
│   └── views/                  # Cached metadata, listing window, memory chunk, byte inspector
├── xtask/                      # Workspace verification CLI (fmt, headers, lines, forbidden, ci)
├── editors/
│   ├── vscode/                 # VS Code extension (TS sources, data-type.schema.json, grammars)
│   └── nvim/                   # Neovim plugin (plugin/ghidra-lsp.lua + lua/ghidra-lsp/)
└── docs/                       # Trilingual guides (en, zh-CN, ja) and SVG assets
```

## Compliance rules and `cargo xtask ci`

`AGENTS.md` enforces strict structural and quality rules verified by `cargo xtask ci`:

| Check step | What it enforces |
| --- | --- |
| `cargo fmt --all -- --check` | Standard Rust formatting across the workspace |
| `cargo xtask check` (`license-headers`) | Exact 2-line copyright and `SPDX-License-Identifier: MIT` header on every `.rs`, `.lua`, and `.ts` file |
| `cargo xtask check` (`line-limit`) | Maximum 800 non-comment, non-blank code lines in every `.rs`, `.lua`, and `.ts` file |
| `cargo xtask check` (`forbidden-code`) | No `src/lib.rs`, no `tests/` or `benches/` directories, no `[dev-dependencies]`, no `#[test]`, no `#[allow]` or `#[expect]`, no `async-trait`, and no Rust doc examples or bare/4-space code blocks in `.rs` or `.md` files |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | Zero warnings; workspace lints forbid `unsafe`, deny `unwrap()`, `expect()`, `unreachable_pub`, and `missing_docs` (including private items) |
| `cargo doc --locked --workspace --no-deps --document-private-items` | Complete doc comments without bare URLs or broken intra-doc links |
| `cargo build --locked --workspace` | Clean workspace compilation |
| `cargo deny --locked --workspace check` | License compliance and single dependency version per crate |

## External black-box testing boundary

All tests, test data, and test harnesses live outside this repository. Keep zero test targets, mock traits, recording doubles, or `[dev-dependencies]` in `ghidra-lsp`. Validate behavior by running the compiled `ghidra-lsp` binary over `stdin` and `stdout` with real or external MCP harnesses.

Before running a full build or `cargo xtask ci`, check available disk space (`df -h .`) and keep at least 20 GiB free.
