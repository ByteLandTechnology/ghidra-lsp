# Ghidra LSP for VS Code

Visual Studio Code extension for live Ghidra decompilation and reverse engineering through `ghidra-lsp` and `ghidra-mcp`.

Online documentation is available in the [ghidra-lsp documentation](https://github.com/ByteLandTechnology/ghidra-lsp#documentation).

## Features

- **Read-only `ghidra://` pseudocode**: View decompiled C functions in memory without writing `.c` or `.h` files to disk. Use `F2` for scoped symbol rename previews, save the origin tab with `Ctrl+S` (`Cmd+S` on macOS) to commit across modified tabs, or run **Ghidra: Discard Pending Rename** to cancel.
- **Five-kind inline comments**: Switch `PLATE`, `PRE`, `EOL`, `POST`, and `REPEATABLE (ext)` categories from horizontal tab badges (`ghidraLsp.selectCommentKind`) above a single active comment editor inside a native VS Code comment thread beside decompiled statements. Open the thread with **Code Actions** (`Ctrl+.` / `Cmd+.`) or **Ghidra: Edit Comment**.
- **In-memory analysis views**: Browse `ghidra-listing://` disassembly, `ghidra-memory://` byte windows, `ghidra-string://` decoded strings with reference CodeLens (`Shift+F12`), and readable `ghidra-reference://` peek previews.
- **Data type workbench**: Edit `struct`, `union`, `enum`, and `function` definitions in JSONC (`ghidra-type://<md5>/<path>.ghidra-type`, validated against `schemas/data-type.schema.json` without needing `"$schema"` in the buffer) or in the graphical **Ghidra Data Type Editor** custom editor. The graphical editor shows a visible kind/size header, a **JSONC** side-by-side button, conflict checks, and readback normalization. Built-in types and typedefs open read-only.
- **Synchronized custom editors and panels**: Open **Program Overview**, **Program Listing**, **Memory and Bytes (Hex)** (with a 2-column **Data Inspector** grid and live **Little Endian** / **Big Endian** toggle pill), **Strings**, **Imports**, **Exports**, and **Address References**. Explore functions in a rounded-edge **Control Flow Graph** (`ghidra.analysisControlFlow`) with an `Entry` badge, or in **Call Graph** and Miller-column **Callers** / **Callees** views. **Call Graph** includes a topbar `[Graph | Columns]` switch and hover-revealed inner horizontal grabber bars on top and bottom card edges that bend toward the expand or collapse direction, while **Call Columns** shows short address hints on each row.
- **Ghidra sidebar**: Manage **Sessions**, **Symbols**, **Strings**, and **Data Types** from the Activity Bar **Ghidra** container.

## Requirements and configuration

When `ghidraLsp.serverPath` (`"ghidra-lsp"`) and `ghidraLsp.mcpCommand` (`"ghidra-mcp"`) are left at their defaults and are not yet on `PATH`, the extension automatically installs `@ghidra-lsp/cli` and `@ghidra-mcp/cli` via `npm` into the shared managed bin directory (`~/.local/share/ghidra-lsp/bin` on Linux and macOS, or `%LOCALAPPDATA%\ghidra-lsp\bin` on Windows). You can also run **Ghidra: Install or Update Binaries** (`ghidraLsp.installBinaries`) at any time, or point `ghidraLsp.serverPath` / `ghidraLsp.mcpCommand` to custom executables in VS Code `settings.json`:

```json
{
  "ghidraLsp.autoInstall": true,
  "ghidraLsp.serverPath": "ghidra-lsp",
  "ghidraLsp.mcpCommand": "ghidra-mcp",
  "ghidraLsp.mcpArgs": [],
  "ghidraLsp.requestTimeoutMs": 35000,
  "ghidraLsp.liveRefreshIntervalMs": 2000,
  "ghidraLsp.templateArguments": "omit",
  "ghidraLsp.views.syncCursor": true,
  "ghidraLsp.views.singleKeyShortcuts": true
}
```

- `ghidraLsp.autoInstall`: Automatically install missing default `ghidra-lsp` and `ghidra-mcp` binaries via `npm` into the shared user bin directory (`true` by default).
- `ghidraLsp.serverPath`: Executable path or command name for `ghidra-lsp` (restart the extension after changing).
- `ghidraLsp.mcpCommand`: Executable path or command name for `ghidra-mcp`.
- `ghidraLsp.mcpArgs`: Array of extra CLI arguments forwarded to `ghidra-mcp`.
- `ghidraLsp.requestTimeoutMs`: Request timeout in milliseconds (`100` to `300000`, default `35000`).
- `ghidraLsp.liveRefreshIntervalMs`: Interval in milliseconds for refreshing visible, unmodified function tabs (`0` disables polling).
- `ghidraLsp.templateArguments`: Set `"omit"` (default) to display outer C++ template lists as `<…>` with concise inline badges when sibling templates collide, or `"show"` to display complete template argument lists. Full names remain in hover popups and tooltips.
- `ghidraLsp.views.syncCursor`: Enable (`true`, default) or disable cursor synchronization across open Program Listing, Hex View, Control Flow, and Decompiler tabs.
- `ghidraLsp.views.singleKeyShortcuts`: Enable (`true`, default) or disable bare single-character shortcuts (`/`, `g`, `+`, `=`, `-`, `0`) in Ghidra analysis webviews. Modifier shortcuts (`Ctrl+F` / `Cmd+F` and `Ctrl+G` / `Cmd+G`) stay active when off.
- For manual save confirmation on renames and data types, set `"files.autoSave": "off"` and `"files.refactoring.autoSave": false`.

## Views and custom editors

- **Sidebar views (`Ghidra` Activity Bar container)**:
  - **Sessions** (`ghidra.sessions`, collapsed by default): Open sessions, recent/stale programs, and background import or analysis tasks.
  - **Symbols** (`ghidra.symbols`): Functions, namespace-grouped symbols, and quick-start welcome actions.
  - **Strings** (`ghidra.strings`): Defined strings across the active program.
  - **Data Types** (`ghidra.types`): Category hierarchy for project data types.
- **Custom editors**:
  - **Ghidra Control Flow** (`ghidra.analysisControlFlow` on `ghidra-listing:/listing/*`): Interactive basic-block CFG webview sharing tabs with Listing and Bytes views.
  - **Ghidra Data Type Editor** (`ghidra.dataTypeEditor` on `ghidra-type:/**/*`): Graphical form editor synchronized with the underlying JSONC text buffer.

## Keybindings

- `Ctrl+.` (`Cmd+.` on macOS): **Ghidra: Code Actions…** inside `ghidra://` decompiled buffers.
- `F2`: **Ghidra: Rename Symbol** inside `ghidra://` function buffers.
- `Ctrl+S` (`Cmd+S` on macOS): **Ghidra: Submit Pending Rename** on the `origin` buffer of a pending rename.

## Commands

### Sessions and analysis

- **Ghidra: Open Binary** / **Ghidra: Open Recent Program** / **Ghidra: Select Session** / **Ghidra: Switch to Session** / **Ghidra: Reopen Session**
- **Ghidra: Refresh Sessions** / **Ghidra: Close Program** / **Ghidra: Reanalyze Program** / **Ghidra: Stop Waiting for Analysis** / **Ghidra: Program Overview** / **Ghidra: Install or Update Binaries**

### Navigation and inspection

- **Ghidra: Open Function** / **Ghidra: Go to Address** / **Ghidra: Demangle C++ Symbols**
- **Ghidra: Refresh Documents** / **Ghidra: Refresh Program Browser** / **Ghidra: Refresh Strings**
- **Ghidra: Function Details** / **Ghidra: Inspect Type at Cursor** / **Show Symbol Details**

### Renames, comments, and edits

- **Ghidra: Rename Symbol** / **Ghidra: Submit Pending Rename** / **Ghidra: Submit All Pending Renames** / **Ghidra: Show Pending Rename** / **Ghidra: Discard Pending Rename**
- **Ghidra: Code Actions…** / **Ghidra: Edit Comment** / **Switch Comment Kind** (`ghidraLsp.selectCommentKind`) / inline **Edit** / **Save** / **Cancel** / **Close comment editor**
- **Ghidra: Edit Function Signature** / **Ghidra: Edit Variables and Parameters** / **Ghidra: Edit Global Symbol**

### Data types

- **Ghidra: Create Data Type** / **Ghidra: Edit Data Type** / **Ghidra: Delete Data Type** / **Ghidra: Apply Data Type**
- **Ghidra: Data Type Details** / **Ghidra: Compare Data Type with Ghidra** / **Ghidra: Reload Data Type from Ghidra**

### Analysis views and graphs

- **Ghidra: Open Analysis Views** / **Ghidra: Switch Analysis View…**
- **Ghidra: Disassembly Listing** / **Ghidra: Program Listing** / **Ghidra: Memory and Bytes (Hex)**
- **Ghidra: Open Containing Function** / **Ghidra: References at Address** / **Ghidra: Switch to Bytes** / **Ghidra: Switch to Listing** / **Ghidra: Copy Address** / **Ghidra: Open in Program Listing** / **Ghidra: Refresh Listing**
- **Ghidra: Strings** / **Ghidra: Imports** / **Ghidra: Exports** / **Ghidra: Address References** / **Ghidra: Binary Address References**
- **Ghidra: Control Flow Graph** / **Ghidra: Call Graph** / **Ghidra: Callers** / **Ghidra: Callees** / **Ghidra: Show Call Hierarchy**

## Troubleshooting

If every binary fails with `request failed; inspect daemon.log`, run this check in the same environment as VS Code:

```sh
ghidra-mcp call ghidra_session '{"operation":"list"}'
```

On Linux, check `daemon.log` in `$XDG_RUNTIME_DIR/ghidra-mcp-<uid>` or `/tmp/ghidra-mcp-<uid>`.
