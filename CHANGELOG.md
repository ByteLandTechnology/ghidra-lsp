# Changelog

## [0.4.0](https://github.com/ByteLandTechnology/ghidra-lsp/compare/v0.3.1...v0.4.0) (2026-11-24)


### Features

* load binary imports and exports from program sessions ([#10](https://github.com/ByteLandTechnology/ghidra-lsp/issues/10)) ([ab4f320](https://github.com/ByteLandTechnology/ghidra-lsp/commit/ab4f32093915717aba1460832402878ce164a833))
* preserve native decompiler variable symbols ([#3](https://github.com/ByteLandTechnology/ghidra-lsp/issues/3)) ([cf023f5](https://github.com/ByteLandTechnology/ghidra-lsp/commit/cf023f5b584447f1d1b6ac65d1a3527ddf2442bc))
* **vscode:** guard webview single-key shortcuts ([#28](https://github.com/ByteLandTechnology/ghidra-lsp/issues/28)) ([3e7747f](https://github.com/ByteLandTechnology/ghidra-lsp/commit/3e7747f2d337018aeda787a8ac4d8e762e2708de))


### Bug Fixes

* **vscode:** reflow editable form grids and index row labels ([#14](https://github.com/ByteLandTechnology/ghidra-lsp/issues/14)) ([52ef531](https://github.com/ByteLandTechnology/ghidra-lsp/commit/52ef5319a5724a2499f90b40574d29f1dbcb31c5))
* **vscode:** replace SVG comment tabs with Markdown text links ([#12](https://github.com/ByteLandTechnology/ghidra-lsp/issues/12)) ([82f204b](https://github.com/ByteLandTechnology/ghidra-lsp/commit/82f204bd72b8af210a93c9aebe3feb1bf7cc8684))
* **vscode:** restore program listing focus and target sizes ([#21](https://github.com/ByteLandTechnology/ghidra-lsp/issues/21)) ([f16ddf7](https://github.com/ByteLandTechnology/ghidra-lsp/commit/f16ddf7d6b935d3f7cfb32fedcce261a8d78f1bd))
* **vscode:** restructure hex table into per-byte ARIA gridcells ([#16](https://github.com/ByteLandTechnology/ghidra-lsp/issues/16)) ([726f7ec](https://github.com/ByteLandTechnology/ghidra-lsp/commit/726f7ec7ffd80a5fa4228f64b783e815f01bd82e))


### Performance Improvements

* set initial list page limit to 1000 ([#17](https://github.com/ByteLandTechnology/ghidra-lsp/issues/17)) ([16f65f8](https://github.com/ByteLandTechnology/ghidra-lsp/commit/16f65f82c800f472c219e0938a1b65fec0fef073))

## [0.3.1](https://github.com/ByteLandTechnology/ghidra-lsp/compare/v0.3.0...v0.3.1) (2026-11-23)


### Bug Fixes

* **build:** upgrade url to 2.5.9 and remove stale advisory ([6695365](https://github.com/ByteLandTechnology/ghidra-lsp/commit/6695365743cc26784fe832fa0f1c39e45a898716))

## [0.3.0](https://github.com/ByteLandTechnology/ghidra-lsp/compare/v0.2.0...v0.3.0) (2026-11-20)


### Features

* **nvim:** auto-install ghidra-lsp and ghidra-mcp via npm ([b63049e](https://github.com/ByteLandTechnology/ghidra-lsp/commit/b63049e0cf30d15b258eae20312bf747922ceee7))
* **vscode:** auto-install ghidra-lsp and ghidra-mcp via npm ([56e7ce4](https://github.com/ByteLandTechnology/ghidra-lsp/commit/56e7ce410de9d4854bb3ad72886b88f819bba7c3))

## [0.2.0](https://github.com/ByteLandTechnology/ghidra-lsp/compare/v0.1.0...v0.2.0) (2026-11-20)


### Features

* add code intelligence, navigation, and semantic tokens ([919710c](https://github.com/ByteLandTechnology/ghidra-lsp/commit/919710c1ea5b848c8d6e73f634133659c66bdbf9))
* add JSONC data-type documents, validation, and save ([fb7938f](https://github.com/ByteLandTechnology/ghidra-lsp/commit/fb7938f9a11e6e9a1652a150bc9948cb6a7da0be))
* add listing, memory, byte inspector, and graph views ([9af21e8](https://github.com/ByteLandTechnology/ghidra-lsp/commit/9af21e826a5bb90a3b62683ac53f33e468ceb703))
* add scoped rename persistence, binary loader, and MCP policy ([6c50149](https://github.com/ByteLandTechnology/ghidra-lsp/commit/6c50149033b2c937b1c499f0a4b5114bfb5506bd))
* add string lookup and comment, prototype, and variable edits ([f03a8fb](https://github.com/ByteLandTechnology/ghidra-lsp/commit/f03a8fbedefbf6132d50d2709a035c19d7d191f3))
* **nvim:** add Neovim client plugin ([a167f10](https://github.com/ByteLandTechnology/ghidra-lsp/commit/a167f10663b4f28ea93a803e21b7126f696c0823))
* open and synchronize virtual decompilation buffers ([d8e16c3](https://github.com/ByteLandTechnology/ghidra-lsp/commit/d8e16c314e78a72f52741526c0856cacdf573da8))
* start LSP server with MCP client transport ([a3df778](https://github.com/ByteLandTechnology/ghidra-lsp/commit/a3df7787c8b8057d876aaeb268db663b905061d4))
* **vscode:** add VS Code client extension ([17fc266](https://github.com/ByteLandTechnology/ghidra-lsp/commit/17fc2665e8ff1ff0c6a52e4854990e1cd278da63))
* **xtask:** add npm package and license commands ([46751f9](https://github.com/ByteLandTechnology/ghidra-lsp/commit/46751f9c0066aa2ff583da80769120b9118f3322))
