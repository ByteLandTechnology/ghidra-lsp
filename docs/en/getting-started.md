# Getting Started

This guide describes the prerequisites, how to build `ghidra-lsp`, the command-line flags, editor verification steps, and troubleshooting.

## Prerequisites

| Requirement | Version or detail | Notes |
| --- | --- | --- |
| Rust toolchain | Rust `1.88` or newer (`edition = "2024"`) | Required to compile `ghidra-lsp` and `xtask` |
| Ghidra and `ghidra-mcp` | Compatible `ghidra-mcp` MCP server | `ghidra-lsp` spawns `ghidra-mcp` over MCP `stdio` |
| Visual Studio Code | `^1.96.0` | Required only for the VS Code extension (`Node.js` and `npm` for building VSIX) |
| Neovim | `>= 0.10` | Required only for the Neovim plugin (`:checkhealth ghidra-lsp`) |
| `cargo-deny` | Optional for development | Required only when running full `cargo xtask ci` |

## Install with npm

If you have Node.js 18 or later, install `@ghidra-lsp/cli` globally or invoke it with `npx`:

```sh
npm install --global @ghidra-lsp/cli
ghidra-lsp --version
```

npm installs the matching platform package (`@ghidra-lsp/darwin-arm64`, `@ghidra-lsp/darwin-x64`, `@ghidra-lsp/linux-arm64`, `@ghidra-lsp/linux-x64`, `@ghidra-lsp/win32-arm64`, or `@ghidra-lsp/win32-x64`) as an optional dependency. Do not pass `--omit=optional`. Linux packages require glibc.

## Use a prebuilt executable

Download the binary for your platform from [GitHub Releases](https://github.com/ByteLandTechnology/ghidra-lsp/releases) (`ghidra-lsp-macos-x86_64`, `ghidra-lsp-macos-arm64`, `ghidra-lsp-linux-x86_64`, `ghidra-lsp-linux-arm64`, `ghidra-lsp-windows-x86_64.exe`, or `ghidra-lsp-windows-arm64.exe`), rename it to `ghidra-lsp` (`ghidra-lsp.exe` on Windows), run `chmod +x ghidra-lsp` on Unix, and place it on `PATH`.

## Build `ghidra-lsp` from source

Clone the repository and compile the release binary with locked dependencies:

```sh
cargo build --locked --release
```

The compiled executable is placed at `target/release/ghidra-lsp`. Copy it to a directory on `PATH`, or point your editor configuration directly to `target/release/ghidra-lsp`.

Verify that the binary starts and prints its command-line options:

```sh
./target/release/ghidra-lsp --help
```

## Command-line flags

`src/main.rs` defines the server command-line interface with `clap`:

| Flag | Default | Description |
| --- | --- | --- |
| `--mcp-command <MCP_COMMAND>` | `ghidra-mcp` | Executable name or filesystem path for the `ghidra-mcp` child process |
| `--mcp-arg <MCP_ARG>` | Empty (`Vec<String>`) | Extra argument passed to `ghidra-mcp` (repeatable, allows hyphen values) |
| `--request-timeout-ms <REQUEST_TIMEOUT_MS>` | `35000` | Timeout in milliseconds for MCP calls (clamped to `100..=300000`, or raised by `scan.timeout_ms`) |
| `--version` / `-V` | — | Print the `ghidra-lsp` package version (`0.1.0`) |
| `--help` / `-h` | — | Print command-line help |

Example invocation with custom `ghidra-mcp` arguments and a 60-second request timeout:

```sh
ghidra-lsp \
  --mcp-command /usr/local/bin/ghidra-mcp \
  --mcp-arg --project-dir \
  --mcp-arg /path/to/ghidra-projects \
  --request-timeout-ms 60000
```

Editor clients can also override `mcpCommand`, `mcpArgs`, `requestTimeoutMs`, `templateArguments`, and `readonlyDocuments` through LSP `initializationOptions` during `initialize`.

## Verify in Visual Studio Code

1. Compile and package the extension from `editors/vscode/`:

```sh
npm --prefix editors/vscode install
npm --prefix editors/vscode run check
npm --prefix editors/vscode run package
```

2. Install the generated `.vsix` package in VS Code (`Extensions: Install from VSIX...`), or open `editors/vscode` and press `F5` to launch an Extension Development Host.
3. Configure `ghidraLsp.serverPath` and `ghidraLsp.mcpCommand` in VS Code settings if they are not on `PATH`.
4. Open the **Ghidra** Activity Bar icon, click **Open Binary** in **Symbols** or **Sessions**, and pick a test binary.
5. Accept the prompt to analyze the binary when Ghidra has not analyzed it yet.
6. Select a function in **Symbols** to open its read-only `ghidra://` pseudocode buffer, then press `F2` on a local variable or function name to verify scoped rename preview and `Ctrl+S` (`Cmd+S` on macOS) origin save.

## Verify in Neovim

1. Add `editors/nvim` to your Neovim plugin manager (see the [Neovim Guide](neovim-guide.md) for `lazy.nvim`, `packer.nvim`, and `vim.pack` examples) and point `server_path` to `ghidra-lsp`.
2. Run health diagnostics inside Neovim:

```vim
:checkhealth ghidra-lsp
```

Confirm that Neovim reports `>= 0.10`, locates both `ghidra-lsp` and `ghidra-mcp`, and passes without errors.
3. Open a binary and browse functions:

```vim
:GhidraOpenBinary /path/to/binary
:GhidraFunctions
```

4. Inside the decompiled buffer, test `K` (Hover), `<leader>gl` (Listing), `<leader>gm` (Memory), and `<leader>gc` (5-kind Comment float).

## Troubleshooting

### `request failed; inspect daemon.log` or MCP startup errors

`ghidra-lsp` spawns `ghidra-mcp` lazily on the first backend request. If every binary open fails, test `ghidra-mcp` directly from the same shell environment as your editor:

```sh
ghidra-mcp call ghidra_session '{"operation":"list"}'
```

On Linux, inspect `daemon.log` inside `$XDG_RUNTIME_DIR/ghidra-mcp-<uid>` or `/tmp/ghidra-mcp-<uid>`.

### `ghidra-lsp` fails to start over `stdio`

Make sure that no wrapper script writes banner text to `stdout`. `ghidra-lsp` reserves `stdout` strictly for framed `Content-Length` LSP JSON-RPC messages and writes logs only to `stderr`.

### Analysis wait exceeds the client timeout

Long binary imports and auto-analysis run asynchronously through `ghidra.beginOpenBinary`, `ghidra.beginReanalyze`, and `ghidra.pollOpenBinary`. In `Server::wait_job`, synchronous waits allow up to 10 minutes before returning a notice that the backend job continues running. Check **Sessions** in VS Code or run `:GhidraSelectSession` in Neovim to reconnect to a finished session.

### Automatic saves conflict with `<F2>` rename previews

Set `"files.autoSave": "off"` and `"files.refactoring.autoSave": false` in VS Code when you want manual `Ctrl+S` confirmation before writing `<F2>` renames to Ghidra.

Next chapter: [Architecture](architecture.md).
