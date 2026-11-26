# LSP 能力参考与开发规范

本文档完整列出 `ghidra-lsp` 实现的 Language Server Protocol 能力、49 个 `workspace/executeCommand` 自定义命令、仓库目录结构、`AGENTS.md` 强制规范、`cargo xtask ci` 检查流水线以及外部黑盒测试边界。

---

## LSP 服务器能力矩阵（`src/server/lsp.rs`）

在 `initialize` 握手中，`ghidra-lsp` 声明以下标准能力：

| LSP 能力 / 请求 | 服务器配置与实现说明 |
| --- | --- |
| `positionEncoding` | 固定协商为 `utf-16`（`PositionEncodingKind::UTF16`）。 |
| `textDocumentSync` | `openClose: true`、`change: FULL (1)`、`save: { includeText: true }`。 |
| `hoverProvider` | 显示符号类型、存储位置/全局变量表示、函数签名、注释、完整反修饰名与原始修饰名，以及类型路径与字节大小。 |
| `definitionProvider` / `declarationProvider` / `implementationProvider` | 跳转到函数反编译（按需自动打开）、局部变量声明、全局符号快照或类型定义。 |
| `typeDefinitionProvider` | 解析变量或表达式的数据类型并打开 `ghidra://<md5>/type/...` 只读快照。 |
| `referencesProvider` | 对局部变量返回当前函数内引用；对全局符号或函数结合反编译映射与 `ghidra-reference://` / `ghidra://<md5>/references/...` 返回全程序跨函数引用。 |
| `documentHighlightProvider` | 高亮当前干净缓冲区内相同 `symbol.id` 或同类 `type` Token 的全部出现位置。 |
| `documentSymbolProvider` | 构建当前反编译函数的嵌套文档符号大纲。 |
| `workspaceSymbolProvider` | 支持全工作区符号检索，并支持 `resolveProvider: true` 延迟解析 `location.range`（当客户端声明 `resolveSupport` 时启用）。 |
| `renameProvider` | `prepareProvider: true`；返回待重命名范围与原始名称占位符；`rename` 生成作用域预览 `WorkspaceEdit`。 |
| `completionProvider` | `resolveProvider: false`；基于当前函数局部变量、全程序合法符号及 32 个内置 C/Ghidra 类型提供补全。 |
| `signatureHelpProvider` | 触发字符 `["(", ","]`，重触发字符 `[","]`，实时高亮当前活动参数索引。 |
| `semanticTokensProvider` | `full: true`；Token 类型图例为 `keyword`、`comment`、`type`、`function`、`variable`、`parameter`、`number`、`string`，修饰符为 `readonly`（常量数字与字符串附带 `readonly` 修饰符）。 |
| `codeActionProvider` | 支持 `quickfix`（光标代码单元的 **Edit comments at …**）与 `refactor`（检视类型、编辑函数/变量、打开清单/CFG/调用图/引用）。 |
| `inlayHintProvider` | 为局部变量首现处标注存储位置（`: <storage>`），为函数体内调用点标注目标地址（`[<addr>] `）。 |
| `callHierarchyProvider` | 支持 `prepareCallHierarchy`、`incomingCalls` 与 `outgoingCalls`。 |
| `codeLensProvider` | `resolveProvider: false`；在函数声明处提供 `Listing`、`Call Graph`、`Control Flow`、`Callers`、`Callees`、`References` 入口。 |
| `foldingRangeProvider` | 计算多行注释、`//` 连续注释与 `{ ... }` 代码块折叠范围。 |
| `documentLinkProvider` | `resolveProvider: false`；提取函数内可点击链接。 |
| `executeCommandProvider` | 注册下述 49 个 `ghidra.*` 自定义命令，支持 `workDoneToken` 进度通知。 |

### 自定义通知

- `ghidra/changed`：当任意会话的后端视图或缓存发生更新或失效时，服务器主动向客户端发送 `{"md5": "<32-hex>"}`，驱动客户端树视图与分析面板同步刷新。

---

## 自定义命令目录（`workspace/executeCommand`）

`src/server/mod.rs` 中的 `COMMANDS` 常量完整注册了以下 49 个命令，并按职责分发至 `commands.rs`、`checkpoint_commands.rs`、`domain_commands.rs`、`edit_commands.rs` 与 `view_commands.rs`：

### 会话、二进制与分析任务

| 命令 | 参数载荷 | 说明 |
| --- | --- | --- |
| `ghidra.sessions` | `{}` | 列出当前已知的全部 `ghidra-mcp` 会话 |
| `ghidra.selectSession` | `{"md5"}` | 校验会话处于 `ready` 状态并将其设为当前活动会话 |
| `ghidra.openBinary` | `{"path" \| "md5", "analyze?"}` | 同步打开磁盘二进制或已保存 MD5，可选执行分析并最多等待 10 分钟 |
| `ghidra.beginOpenBinary` | `{"path" \| "md5", "analyze?"}` | 启动异步打开作业并返回轮询 `token` |
| `ghidra.pollOpenBinary` | `{"token"}` | 推进并查询未决打开或分析作业，返回进度快照 |
| `ghidra.beginReanalyze` | `{"md5?", "analyzers?"}` | 启动异步重分析作业并返回轮询 `token` |
| `ghidra.reanalyze` | `{"md5?", "analyzers?", "wait?"}` | 触发重分析，可选等待完成（默认 `true`）、持久化并刷新打开文档 |
| `ghidra.closeSession` | `{"md5?", "force?"}` | 关闭干净的会话（拒绝存在待决重命名或未保存改动的会话）并清理缓存 |
| `ghidra.checkpoints` | `{"md5?"}` | 按最新到最旧顺序出会话已保存的项目检查点（`items`、`maxPerBinary`） |
| `ghidra.createCheckpoint` | `{"md5?", "name?"}` | 保存干净程序会话并创建命名或未命名项目检查点 |
| `ghidra.restoreCheckpoint` | `{"md5?", "id?", "name?"}` | 不保存强制停止 Ghidra、原子恢复指定或最新检查点、重新启动会话并刷新全部已打开视图 |
| `ghidra.resetSession` | `{"md5?", "reopen?", "analyze?"}` | 删除 `ghidra/` 与检查点同时保留 `binary` 和 `binary.json`，可选重新导入与分析 |
| `ghidra.cancelJob` | `{}` | 返回明确指引：已安装的 `ghidra-mcp` 仅暴露 `job.get`/`job.wait` 而无 `job.cancel` |

### 程序目录与虚拟文档

| 命令 | 参数载荷 | 说明 |
| --- | --- | --- |
| `ghidra.program` | `{"md5?"}` | 调用 `program.get` 查询会话元数据 |
| `ghidra.programMeta` | `{"md5?", "showTemplateArguments?"}` | 返回缓存的端序、指针位宽、内存块、默认地址及函数列表 |
| `ghidra.functions` | `{"md5?"}` | 分页拉取全部函数（`entry`、`name`、`namespace`、`demangled_name`）及覆盖范围 |
| `ghidra.symbols` | `{"md5?"}` | 分页列出全部程序符号及覆盖范围 |
| `ghidra.types` | `{"md5?"}` | 分页列出全部程序数据类型及覆盖范围 |
| `ghidra.type` | `{"md5?", "path"}` | 通过 `data_type.get` 读取单个原始数据类型定义 |
| `ghidra.strings` | `{"md5?"}` | 查询程序内已定义字符串列表（`address::defined_strings`） |
| `ghidra.binaryInterface` | `{"md5?"}` | 从 Ghidra 会话（`import.list` / `export.list`）读取导入导出表，旧版桥接时回退至本地可执行文件解析（`binary::interface`） |
| `ghidra.openFunction` | `{"md5?", "entry"}` | 反编译 `entry` 函数并返回规范 `ghidra://` URI |
| `ghidra.openSymbol` | `{"md5?", "id"}` | 将符号 `id` 解析为所属函数或 `/symbol/` 快照 URI |
| `ghidra.document` | `{"uri", "includePending?"}` | 获取或按需生成 `ghidra://` 虚拟文档正文与元数据 |
| `ghidra.saveDocument` | `{"uri", "text"}` | 从显式文本保存 `ghidra://` 文档（仅接受未修改或符合 F2 预期的重命名文本） |
| `ghidra.refreshDocument` | `{"uri"}` | 重新生成单个干净虚拟文档并在变更时向编辑器推送编辑 |
| `ghidra.refresh` | `{"md5?"}` | 失效缓存并重新生成会话内全部干净虚拟文档 |
| `ghidra.configure` | `{"templateArguments?"}` | 动态切换展示设置（`"show"` 或 `"omit"`） |

### 地址定位、导航与逆向视图

| 命令 | 参数载荷 | 说明 |
| --- | --- | --- |
| `ghidra.resolveTarget` | `{"md5?", "input" \| "target", "currentAddress?"}` | 将地址、相对偏移（如 `-0x80`）或符号输入解析为规范目标地址 |
| `ghidra.location` | `{"uri", "position?" \| "address?", "version?"}` | 将光标 UTF-16 `Position` 映射为原生 `CodeLocation`，将 `code_unit_address` 反向映射为 `Position`，或在省略 `position` 与 `address` 时返回有序 UTF-16 跨度地址快照 |
| `ghidra.reveal` | `{"md5?", "address"}` | 打开包含该地址的函数并返回对应 UTF-16 `Range` |
| `ghidra.typeAtPosition` | `{"uri", "position"}` | 解析反编译 Token 光标处的数据类型元数据 |
| `ghidra.listingWindow` | `{"md5?", "address?", "cursor?", "limit?", "showTemplateArguments?", "exactStart?"}` | 分页加载有界汇编清单窗口，包含未定义字节折叠与交叉引用汇总 |
| `ghidra.memoryWindow` | `{"md5?", "address?", "length?", "bytesPerRow?", "endian?", "inspectAddress?", "selectionLength?"}` | 加载有界十六进制内存窗口及初始 Data Inspector 解码结果 |
| `ghidra.inspectBytes` | `{"bytes", "md5?", "endian?", "addressSizeBits?", "defaultSpace?", "addressWidth?", "blocks?"}` | 将最多 16 字节切片（支持 `null` 缺口）解码为整数、浮点、指针与字符串条目 |
| `ghidra.controlFlowGraph` | `{"md5?", "entry?", "address?", "showTemplateArguments?"}` | 构建函数基本块控制流图（`nodes`、`edges`、`blocks`、`scope`） |
| `ghidra.callGraph` | `{"md5?", "entry?", "address?", "callersDepth?", "calleesDepth?", "expansion?", "refresh?", "showTemplateArguments?"}` | 基于双向深度遍历（`callersDepth` / `calleesDepth`）或逐节点交互展开集合（`expansion.callers` / `expansion.callees`）构建有界调用图邻域（上限：80 节点、240 条边、40 次查询） |

### 重命名、注释、原型、数据类型与工作台桥接

| 命令 | 参数载荷 | 说明 |
| --- | --- | --- |
| `ghidra.renameState` | `{"md5?"}` | 返回待决重命名的 `origin`、`oldName`、`newName`、`documents`、`applied`、`originApplied` 与 `patched` 状态 |
| `ghidra.discardRename` | `{"md5?"}` | 放弃待决重命名预览并恢复干净缓冲区 |
| `ghidra.commentsAt` | `{"md5?", "address"}` | 读取指定地址的全部 5 类注释（`plate`、`pre`、`eol`、`post`、`repeatable`） |
| `ghidra.saveComment` | `{"md5?", "address", "kind" \| "commentType", "text", "expected?"}` | 执行乐观锁校验后更新或删除单条注释并持久化项目 |
| `ghidra.functionPrototype` | `{"md5?", "entry"}` | 读取函数签名、标志位、参数列表、局部变量与 `original` 快照 |
| `ghidra.saveFunctionPrototype` | `{"md5?", "entry", "original", "payload?" \| fields...}` | 校验并通过单一 `all_or_none` 批处理事务提交函数签名与参数改动 |
| `ghidra.saveVariables` | `{"md5?", "entry", "original", "payload?" \| fields...}` | 校验并通过单一 `all_or_none` 批处理事务提交参数或局部变量的名称与类型改动 |
| `ghidra.typeDocument` | `{"md5?", "path"}` | 渲染 `.ghidra-type` JSONC 文本、只读状态、`original` 快照与 `model` |
| `ghidra.validateTypeDocument` | `{"text", "original"}` | 校验编辑中的 JSONC 草稿并返回精确到 UTF-16 `range` 的诊断结果 |
| `ghidra.saveTypeDocument` | `{"md5?", "path", "text", "original"}` | 检测冲突、执行 `data_type` 写入、保存项目、刷新函数并回读归一化 JSONC |
| `ghidra.query` | `{"md5?", "domain", "operation", "params?"}` | 经 `src/workbench.rs` `READ` 白名单校验的受控只读 MCP 查询 |
| `ghidra.mutate` | `{"md5?", "domain", "operation", "params?"}` | 经 `WRITE` 白名单或 `all_or_none` 批处理校验的受控写操作、持久化与刷新 |

---

## 仓库目录结构

```text
ghidra-lsp/
├── Cargo.toml                 # 工作区清单（成员为根包 ghidra-lsp 与 xtask）
├── deny.toml                  # cargo-deny 依赖与许可证校验配置
├── AGENTS.md                  # 仓库开发、代码质量与测试边界总纲
├── src/
│   ├── main.rs                # 二进制入口与 clap CLI 解析（禁止存在 src/lib.rs）
│   ├── backend.rs             # MCP stdio 子进程传输与响应归一化
│   ├── address.rs             # 规范地址解析、checked u64 数学与定义字符串查询
│   ├── binary.rs              # PE/ELF/Mach-O 加载器导入导出表解析与 MD5 校验
│   ├── comments.rs            # 可重复注释在虚拟 C 文档中的锚定与偏移重算
│   ├── document.rs            # 虚拟文档状态、UTF-16 坐标与模板名折叠
│   ├── gui.rs                 # Ghidra 原生 GUI 行列布局反序列化与校验
│   ├── workbench.rs           # LSP 语义 Token 生成与 ghidra.query/mutate 白名单校验
│   ├── engine/                # 会话管理、单次反编译生成、导航、高亮与 F2 重命名计划
│   ├── graph/                 # 基本块控制流图与有界调用图查询
│   ├── mutations/             # 5 类注释、函数原型与变量批量变更编译器
│   ├── server/                # LSP 协议实现、符号检索与 49 个命令分发器
│   ├── types_doc/             # .ghidra-type JSONC 词法/AST、校验、冲突检测与修改计划
│   └── views/                 # 汇编清单窗口、十六进制内存窗口、元数据缓存与数据检视器
├── xtask/                     # 自动化规则检查与 CI 编排器
├── editors/
│   ├── vscode/                # VS Code 客户端扩展（TypeScript + JSON Schema + TextMate 语法）
│   └── nvim/                  # Neovim 原生 Lua 插件
└── docs/                      # 多语言文档（en / zh-CN / ja）与矢量资产
```

---

## `AGENTS.md` 核心约束与 `cargo xtask ci` 流水线

仓库根目录的 `AGENTS.md` 与 `xtask/` 强制执行以下工程规则：

### 代码与文件约束

- **语言与文档注释**：所有英文文本（包括代码注释、文档注释、提交信息与英文文档）须使用 ASD-STE100 简化技术英语；所有 Crate、模块、结构体、枚举、变体、字段、常量、类型别名与函数（包括私有项）必须拥有完整文档注释。
- **零 `unsafe` 与显式错误处理**：禁止 `unsafe`、禁止 `.unwrap()` / `.expect()`、禁止 `#[allow(...)]` / `#[expect(...)]`、禁止引入 `async-trait` 与 `[workspace.dependencies]`、禁止存在 `src/lib.rs`。
- **可见性与行数上限**：默认使用私有或 `pub(crate)` 可见性（开启 `unreachable_pub = "deny"`）；每个 `.rs`、`.lua` 或 `.ts` 文件的纯代码行数（不含注释与空行）不得超过 `800` 行。
- **SPDX 许可证头**：所有 `.rs`、`.lua`、`.ts` 源文件前两行必须包含 `Copyright 2026 ByteLand Technology Limited` 与 `SPDX-License-Identifier: MIT`。
- **Markdown 代码围栏禁令（`xtask/src/examples.rs`）**：因 `rustdoc` 会将裸代码块或 Rust 代码块作为测试执行，`xtask` 扫描全部非隐藏 `.md` 文件，拒绝任意不带语言标记的裸 ` ``` ` 围栏、任意 `rust`/`ignore`/`no_run`/`should_panic`/`compile_fail` 围栏以及任意 4 空格缩进块。

### 运行 CI 检查

执行完整构建与 CI 前，请确保当前磁盘至少有 `20 GiB` 可用空间，然后依次运行或一键执行：

```sh
cargo xtask ci
```

该命令按严格顺序执行以下 6 步：

1. `cargo fmt --all -- --check`
2. `cargo xtask check`（验证许可证头、800 行限制与禁写规则 / Markdown 示例检查）
3. `cargo clippy --locked --workspace --all-targets -- -D warnings`
4. `cargo doc --locked --workspace --no-deps --document-private-items`
5. `cargo build --locked --workspace`
6. `cargo deny --locked --workspace check`

---

## 外部黑盒测试边界

依据 `AGENTS.md` 规定，本仓库**禁止**包含任何测试目录（`test/`、`tests/`、`benches/`、`__tests__/`）、`[dev-dependencies]`、`#[test]` / `#[cfg(test)]` 或专用于测试的 Mock / Fake 生产代码。所有端到端测试、测试数据与测试夹具均须存放在仓库外部，通过编译后的 `ghidra-lsp` 二进制进程经由 `stdin` / `stdout` 收发真实 LSP JSON-RPC 帧进行黑盒验证。

前端扩展类型检查与打包验证命令：

```sh
npm --prefix editors/vscode run check
npm --prefix editors/vscode run package
```
