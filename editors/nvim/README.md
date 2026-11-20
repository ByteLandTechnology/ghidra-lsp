# Ghidra LSP for Neovim

Native Neovim integration for live Ghidra decompilation through `ghidra-lsp` and `ghidra-mcp`.

## Requirements

- Neovim `>= 0.10`
- `ghidra-lsp` binary on `PATH` (or configured with `server_path`)
- `ghidra-mcp` and a configured Ghidra backend

## Features

- **In-memory `ghidra://` pseudocode buffers**: Read-only decompiled C views with scoped `<F2>` rename previews. Save the origin buffer with `:w` to commit across modified buffers, jump back with `:GhidraOrigin`, or cancel with `:GhidraDiscardRename`.
- **Editable `.ghidra-type` JSONC buffers**: `ghidra-type://<md5><path>.ghidra-type` buffers with live diagnostics on `TextChanged` and `InsertLeave`, conflict checks, and normalized readback on `:w` (built-in types and typedefs open read-only).
- **Virtual reverse-engineering splits**:
  - Program Assembly Listing (`ghidra-listing://`)
  - Hex and Memory Viewer with live `CursorMoved` Data Inspector (`ghidra-memory://`)
  - Defined Strings (`ghidra-string://`)
  - Basic-Block Control Flow Graph (`ghidra-cfg://`)
  - Bounded Call Graph (`ghidra-callgraph://`)
  - Program Overview (`ghidra-overview://`), Types, Symbols, and References snapshots
- **Floating editors and theme highlights**: Five-kind comment float (`PLATE`, `PRE`, `EOL`, `POST`, `REPEATABLE (ext)`), function signature form (`ghidra-edit-fn://`), searchable picker, and variable/parameter editor backed by `all_or_none` server transactions. Theme-linked highlight groups (`GhidraFloatBorder`, `GhidraFloatTitle`, `GhidraFloatFooter`, `GhidraTabActive`, `GhidraTabDirty`, `GhidraTabFilled`, `GhidraStatusAccent`) refresh automatically on `ColorScheme` changes.
- **Native Neovim LSP integration**: Hover (`K`), Signature Help (`<C-k>`), Go to Definition (`gd`), Declaration (`gD`), Implementation (`gi`), Type Definition (`gy`), References (`gr`), Document Symbols (`gO`), Code Actions (`<leader>ca`), Rename (`<F2>` / `<leader>rn`), Semantic Tokens, Inlay Hints, and Call Hierarchy (`:GhidraCallHierarchy`).

## Installation

### `lazy.nvim`

```lua
{
  'ghidra-lsp',
  dir = '/path/to/ghidra-lsp/editors/nvim',
  config = function()
    require('ghidra-lsp').setup({
      server_path = 'ghidra-lsp',
      mcp_command = 'ghidra-mcp',
      mcp_args = {},
      request_timeout_ms = 35000,
      template_arguments = 'omit',
      auto_attach = true,
    })
  end,
}
```

### `packer.nvim`

```lua
use({
  '/path/to/ghidra-lsp/editors/nvim',
  config = function()
    require('ghidra-lsp').setup({
      server_path = 'ghidra-lsp',
      mcp_command = 'ghidra-mcp',
      mcp_args = {},
      request_timeout_ms = 35000,
      template_arguments = 'omit',
      auto_attach = true,
    })
  end,
})
```

### `vim.pack` (Neovim 0.12+)

```lua
vim.pack.add({
  'https://github.com/ByteLandTechnology/ghidra-lsp',
})
vim.opt.runtimepath:append(vim.fn.stdpath('data') .. '/site/pack/core/opt/ghidra-lsp/editors/nvim')
require('ghidra-lsp').setup({
  server_path = 'ghidra-lsp',
  mcp_command = 'ghidra-mcp',
  template_arguments = 'omit',
})
```

Verify installation with `:checkhealth ghidra-lsp`.

## Keymaps in `ghidra://` buffers

- `<F2>` / `<leader>rn`: Preview scoped symbol rename (`:w` on origin buffer commits; `:GhidraDiscardRename` cancels; `:GhidraOrigin` jumps to origin).
- `<leader>ca`: Open LSP Code Actions menu.
- `<leader>gl`: Open Program Listing (`ghidra-listing://`) at cursor.
- `<leader>gm`: Open Hex and Memory Viewer (`ghidra-memory://`) at cursor.
- `<leader>gc`: Open 5-kind comment float (`<Tab>` / `<S-Tab>` switch kind, `:w` / `<C-s>` save, clear text and save to delete while native `d` operators `dd`/`dw`/`d$` work normally, `q` / `<Esc>` close; footer shows `:w/<C-s> save · <Tab> kind · q close`).
- `<leader>gt`: Open `.ghidra-type` JSONC editor for type at cursor or from the picker.
- `<leader>go`: Go to address.
- `<leader>gh`: Show call hierarchy.
- `K` / `<C-k>` / `gd` / `gD` / `gi` / `gy` / `gr` / `gO`: Native LSP Hover, Signature Help, Definition, Declaration, Implementation, Type Definition, References, and Document Symbols.
- `q`: Close snapshot, Listing, Memory, String, CFG, or Call Graph splits.

## Commands (24)

- `:GhidraOpenBinary [path]`: Open a binary file (restores silently when analyzed, or asks to analyze).
- `:GhidraSelectSession [md5]` / `:GhidraCloseSession [md5]` / `:GhidraReanalyze`: Manage active sessions and program analysis.
- `:GhidraOpenFunction [entry|name]` / `:GhidraFunctions`: Open or search functions with `<Tab>` completion.
- `:GhidraSymbols` / `:GhidraTypes` / `:GhidraStrings`: Search symbols, data types, and defined strings.
- `:GhidraEditType [path]`: Open an editable `ghidra-type://<md5><path>.ghidra-type` JSONC buffer.
- `:GhidraGoto [address]`: Jump to address in decompilation, or fall back to Program Listing.
- `:GhidraListing [address]` / `:GhidraMemory [address]` / `:GhidraHex [address]`: Open Listing or Hex/Memory splits (`:GhidraHex` aliases `:GhidraMemory`).
- `:GhidraControlFlow` / `:GhidraCallGraph [entry|address]`: Open basic-block CFG and bounded Call Graph splits.
- `:GhidraComment [address]` / `:GhidraEditFunction` / `:GhidraEditVariables`: Open 5-kind comment float, function signature form, and variable editor.
- `:GhidraRefresh` / `:GhidraDiscardRename` / `:GhidraOrigin` / `:GhidraOverview` / `:GhidraCallHierarchy`: Refresh buffers, control renames, view program overview, and inspect call hierarchy.
