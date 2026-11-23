# 快速上手

本指南介绍如何构建 `ghidra-lsp` 可执行文件、配置 `ghidra-mcp` 后端环境，并在 Visual Studio Code 或 Neovim 中完成首次反编译与重命名冒烟测试。

---

## 前置依赖

在开始前，请确认系统满足以下条件：

| 组件 | 要求说明 |
| --- | --- |
| Rust 工具链 | Rust `1.88` 及以上（`Cargo.toml` 指定 `edition = "2024"` 与 `rust-version = "1.88"`） |
| `ghidra-mcp` | 可正常运行的 `ghidra-mcp` MCP 服务端，且已在 `PATH` 中或可通过绝对路径调用 |
| Ghidra 安装 | 由 `ghidra-mcp` 使用的本地 Ghidra 运行环境与项目目录 |
| 编辑器客户端 | Visual Studio Code `^1.96.0`（含 Node.js / npm 用于打包扩展）或 Neovim `>= 0.10` |
| 磁盘空间 | 完整执行 `cargo xtask ci` 前建议确保至少 `20 GiB` 可用空间 |

验证 `ghidra-mcp` 在当前环境变量下可用：

```sh
ghidra-mcp call ghidra_session '{"operation":"list"}'
```

若该命令返回 JSON 会话列表（即使列表为空），说明 `ghidra-mcp` 及其底层 Ghidra 守护进程可正常通信。

---

## 使用 npm 安装

若已安装 Node.js 18 或更高版本，可通过 npm 全局安装 `@ghidra-lsp/cli`，或直接使用 `npx` 运行：

```sh
npm install --global @ghidra-lsp/cli
ghidra-lsp --version
```

npm 会通过可选依赖安装匹配当前平台的包（`@ghidra-lsp/darwin-arm64`、`@ghidra-lsp/darwin-x64`、`@ghidra-lsp/linux-arm64`、`@ghidra-lsp/linux-x64`、`@ghidra-lsp/win32-arm64` 或 `@ghidra-lsp/win32-x64`），请勿传入 `--omit=optional`。Linux 平台包依赖 glibc。

## 使用预构建的可执行文件

也可以从 [GitHub Releases](https://github.com/ByteLandTechnology/ghidra-lsp/releases) 下载对应平台产物（`ghidra-lsp-macos-x86_64`、`ghidra-lsp-macos-arm64`、`ghidra-lsp-linux-x86_64`、`ghidra-lsp-linux-arm64`、`ghidra-lsp-windows-x86_64.exe`、`ghidra-lsp-windows-arm64.exe`），重命名为 `ghidra-lsp`（Windows 为 `ghidra-lsp.exe`），在 Unix 系统执行 `chmod +x ghidra-lsp` 并放入 `PATH`。

## 从源代码构建 `ghidra-lsp`

在仓库根目录执行锁定依赖的 Release 构建：

```sh
cargo build --locked --release
```

编译产物位于 `target/release/ghidra-lsp`。可将该路径加入 `PATH`，或在编辑器配置中直接指向该二进制文件。

如需运行静态检查与构建验证（包括格式、许可证头、行高上限、禁写检查、Clippy、私有文档生成与 `cargo deny`）：

```sh
cargo xtask ci
```

---

## 命令行参数与初始化选项

`ghidra-lsp` 通过标准输入输出（`stdin` / `stdout`）提供 LSP 服务，所有诊断日志均写入 `stderr`。在 `src/main.rs` 中定义了以下命令行参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--mcp-command <MCP_COMMAND>` | `"ghidra-mcp"` | `ghidra-mcp` 子进程的可执行文件名称或绝对路径 |
| `--mcp-arg <MCP_ARG>` | 空列表 | 传递给 `ghidra-mcp` 子进程的额外参数；可多次指定，支持以 `-` 开头的值 |
| `--request-timeout-ms <REQUEST_TIMEOUT_MS>` | `35000` | 单次后端 MCP 请求的超时时间（毫秒）；内部钳制在 `100` 到 `300000` 毫秒之间 |
| `-V`, `--version` | — | 打印 `ghidra-lsp` 版本号 |
| `-h`, `--help` | — | 打印命令行帮助信息 |

示例：使用自定义 `ghidra-mcp` 路径与较长的 60 秒请求超时启动：

```sh
ghidra-lsp --mcp-command /opt/bin/ghidra-mcp --mcp-arg --project-dir --mcp-arg /data/ghidra --request-timeout-ms 60000
```

在 LSP `initialize` 阶段，客户端还可通过 `initializationOptions` 覆盖上述默认配置并控制展示行为：

```json
{
  "readonlyDocuments": true,
  "mcpCommand": "ghidra-mcp",
  "mcpArgs": [],
  "requestTimeoutMs": 35000,
  "templateArguments": "omit"
}
```

- `readonlyDocuments`：设为 `true` 时（VS Code 扩展默认开启），保留待提交重命名预览即使临时关闭选项卡也不会丢失草稿，直至显式保存或放弃。
- `templateArguments`：设为 `"omit"` 时折叠 C++ 外层模板参数为 `<…>`；设为 `"show"` 时完整展示。

---

## 编辑器客户端安装与冒烟测试

### 方案 A：Visual Studio Code

1. 进入扩展目录安装依赖、编译 TypeScript 并打包 VSIX：

```sh
npm --prefix editors/vscode install
npm --prefix editors/vscode run check
npm --prefix editors/vscode run package
```

2. 通过命令行或 VS Code UI 安装生成的 `.vsix` 包：

```sh
code --install-extension editors/vscode/ghidra-lsp-<version>.vsix
```

3. 配置 `settings.json`（若 `ghidra-lsp` 或 `ghidra-mcp` 不在系统默认 `PATH` 中，请填写绝对路径；若希望手动确认每次重命名与类型保存，请关闭自动保存）：

```json
{
  "ghidraLsp.serverPath": "/path/to/ghidra-lsp/target/release/ghidra-lsp",
  "ghidraLsp.mcpCommand": "ghidra-mcp",
  "ghidraLsp.mcpArgs": [],
  "ghidraLsp.requestTimeoutMs": 35000,
  "ghidraLsp.liveRefreshIntervalMs": 2000,
  "ghidraLsp.templateArguments": "omit",
  "ghidraLsp.views.syncCursor": true,
  "files.autoSave": "off",
  "files.refactoring.autoSave": false
}
```

4. 冒烟验证：
- 点击左侧活动栏的 **Ghidra** 图标，在 **Symbols** 欢迎视图点击 **Open Binary** 选择待分析二进制文件。
- 待分析完成并选中会话后，展开函数树打开任意函数，确认出现 `ghidra://` 只读反编译标签页且包含语义高亮与 CodeLens。
- 移动光标至局部变量或函数名，按下 `F2` 预览重命名，观察状态栏与标签页 `M` 徽标；在源视图按 `Ctrl+S`（macOS 为 `Cmd+S`）提交，或执行 **Ghidra: Discard Pending Rename** 取消。

### 方案 B：Neovim（`>= 0.10`）

1. 使用 `lazy.nvim` 添加本地插件路径并配置 `ghidra-lsp`：

```lua
{
    'ghidra-lsp',
    dir = '/path/to/ghidra-lsp/editors/nvim',
    config = function()
        require('ghidra-lsp').setup({
            server_path = '/path/to/ghidra-lsp/target/release/ghidra-lsp',
            mcp_command = 'ghidra-mcp',
            mcp_args = {},
            request_timeout_ms = 35000,
            template_arguments = 'omit',
            auto_attach = true,
        })
    end,
}
```

2. 冒烟验证：
- 启动 Neovim 并运行 `:checkhealth ghidra-lsp`，确认 Neovim 版本、`ghidra-lsp` 可执行文件、LSP 客户端状态均为 `OK`。
- 执行 `:GhidraOpenBinary /path/to/binary` 打开二进制文件。若程序尚未分析，根据提示选择启动分析；若已分析，将静默恢复会话。
- 运行 `:GhidraFunctions` 打开一个函数，在 `ghidra://` 缓冲区内使用 `K` 查看悬浮信息、`<leader>gl` 打开汇编清单、`<leader>gc` 打开 5 类注释浮窗。

---

## 常见问题排查

| 现象 | 可能原因与处理方法 |
| --- | --- |
| 打开任意二进制均报错 `request failed; inspect daemon.log` | 在与编辑器完全相同的 shell 环境中执行 `ghidra-mcp call ghidra_session '{"operation":"list"}'`。在 Linux 下检查 `$XDG_RUNTIME_DIR/ghidra-mcp-<uid>/daemon.log` 或 `/tmp/ghidra-mcp-<uid>/daemon.log`。 |
| LSP 无法启动或报错找不到可执行文件 | 检查 `ghidraLsp.serverPath`（VS Code）或 `server_path`（Neovim）与 `mcpCommand` 是否在 GUI 启动器可见的 `PATH` 中，建议改用绝对路径。 |
| 报错 `Upgrade ghidra-mcp for native GUI cursor locations` | 当前连接的 `ghidra-mcp` 版本未返回 `decompilation.get` 的 `lines` 原生布局结构，无法执行行内位置反查与全 5 类注释显示，请升级 `ghidra-mcp`。 |
| 重命名无法保存，提示 `Save or discard the pending rename` | 会话中已存在未决重命名预览。在 VS Code 状态栏点击待保存条目回到原始文档并按 `Ctrl+S`/`Cmd+S`，或执行放弃重命名后再继续其他编辑。 |
| 写操作超时报错 `a write may have completed. Refresh before retrying.` | 写请求可能已在后端生效但响应超时。切勿盲目重试，应先刷新视图（`:GhidraRefresh` 或 **Ghidra: Refresh Documents**）并核对当前 Ghidra 真实状态。 |
| `ghidra-lsp` 经由 `stdio` 启动失败 | 检查是否有包装脚本向 `stdout` 输出了横幅或调试信息。`ghidra-lsp` 将 `stdout` 严格保留给带 `Content-Length` 帧头的 LSP JSON-RPC 消息，日志仅输出至 `stderr`。 |
| 长分析等待超出客户端超时 | 大型二进制文件的导入与自动分析通过 `ghidra.beginOpenBinary`、`ghidra.beginReanalyze` 与 `ghidra.pollOpenBinary` 异步推进；同步等待（`Server::wait_job`）最长支持 10 分钟，超时后后端任务仍继续运行，可在 VS Code **Sessions** 视图或 Neovim `:GhidraSelectSession` 重新连接已完成会话。 |

下一章：[系统架构与核心不变量](architecture.md)。
