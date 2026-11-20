# クイックスタート

このガイドでは、`ghidra-lsp` のビルドに必要な前提環境、`ghidra-lsp` バイナリの構築、コマンドラインフラグ、VS Code および Neovim での最初のバイナリ解析手順を説明します。

## 前提条件

`ghidra-lsp` を動作させるには次の 3 点が必要です。

| コンポーネント | 要件 | 確認・入手方法 |
| --- | --- | --- |
| **Rust ツールチェイン** | Rust `1.88` 以上（`Cargo.toml` の `rust-version = "1.88"`、Edition `2024`） | `rustc --version` で確認 |
| **Ghidra** | `ghidra-mcp` が対応する Ghidra インストール環境 | `GHIDRA_INSTALL_DIR` 等の環境変数を `ghidra-mcp` の手順に従い構成 |
| **`ghidra-mcp`** | MCP 標準入出力トランスポートに対応した独立バイナリ | `ghidra-mcp` が `PATH` 上にあるか、設定でフルパスを指定可能であること |

> [!NOTE]
> `ghidra-lsp` は `ghidra-mcp` を Rust クレートとして依存に含めません。実行時に `ghidra-mcp` を子プロセスとして起動し、Model Context Protocol（MCP）の標準入出力経由で `ghidra_*` ツールを呼び出します。

また、VS Code 拡張機能をソースからビルド・パッケージングする場合は **Node.js**（`npm`）が必要です。Neovim プラグインを使用する場合は **Neovim 0.10 以上** が必要です。

## `ghidra-lsp` のビルド

リポジトリのルートでロックファイルを厳守したリリースビルドを実行します。

```sh
cargo build --locked --release
```

ビルドが完了すると、実行ファイルが `target/release/ghidra-lsp` に生成されます。`PATH` の通ったディレクトリ（例: `~/.local/bin/`）に配置するか、各エディタ設定の `serverPath` / `server_path` にフルパスを指定してください。

リポジトリ全体の整合性やルール検査（`cargo xtask ci`）を行う場合は、ビルド前に作業ディレクトリに十分な空きディスク容量（20 GiB 以上推奨）があることを確認してください。

```sh
df -h .
cargo xtask ci
```

## CLI オプション

`ghidra-lsp` は `src/main.rs` で以下のコマンドライン引数を解析し、標準入力・標準出力で LSP JSON-RPC メッセージを送受信します。

```text
ghidra-lsp [OPTIONS]
```

| オプション | 型 / デフォルト | 説明 |
| --- | --- | --- |
| `--mcp-command <MCP_COMMAND>` | `"ghidra-mcp"` | 起動する `ghidra-mcp` 子プロセスのコマンド名または実行ファイルパス |
| `--mcp-arg <MCP_ARG>` | 空リスト（複数回指定可） | `ghidra-mcp` へ渡す追加引数。`allow_hyphen_values = true` のため `-` で始まるフラグも渡せます |
| `--request-timeout-ms <REQUEST_TIMEOUT_MS>` | `35000` | 個々の MCP バックエンドリクエストのタイムアウト（ミリ秒）。内部で `100`〜`300000` ms に制限されます |
| `-h`, `--help` | - | ヘルプ表示 |
| `-V`, `--version` | - | バージョン表示（`0.1.0`） |

バックエンド操作（シンボル全量スキャンや大規模な逆コンパイル等）でリクエスト側が `scan.timeout_ms` を指定した場合、タイムアウト上限は `max(request_timeout_ms, scan.timeout_ms)` を `300000` ms（5 分）以下にクランプした値が適用されます。

また、LSP の `initialize` リクエストでクライアントが `initializationOptions`（`mcpCommand`、`mcpArgs`、`requestTimeoutMs`、`templateArguments`、`readonlyDocuments`）を渡すと、サーバー設定が上書き・マージされます。

## バックエンド単体疎通テスト

エディタを起動する前に、同じシェル環境で `ghidra-mcp` 単体が動作するか確認しておくと問題の切り分けが容易になります。

```sh
ghidra-mcp call ghidra_session '{"operation":"list"}'
```

`ghidra-lsp` バイナリ自体は標準入出力で `Content-Length:` ヘッダ付きの LSP JSON-RPC メッセージを待ち受け、ログと子プロセスの `stderr` のみを標準エラー出力に出力します。起動確認だけを行いたい場合は `--version` を実行してください。

```sh
./target/release/ghidra-lsp --version
```

## VS Code でのスモークテスト

VS Code 拡張機能は `editors/vscode/` にあります。拡張機能をビルド・パッケージングする手順は次のとおりです。

```sh
npm --prefix editors/vscode install
npm --prefix editors/vscode run check
npm --prefix editors/vscode run package
```

生成された `.vsix` ファイルを VS Code にインストールするか、`editors/vscode` を Extension Development Host で起動します。

1. VS Code の `settings.json` で `ghidraLsp.serverPath`（未登録ならビルドした `ghidra-lsp` のパス）と `ghidraLsp.mcpCommand` を設定します。
2. アクティビティバーの **Ghidra** アイコンをクリックしてサイドバーを開きます。
3. **Open Binary** ボタン（またはコマンドパレット `Ghidra: Open Binary`）から解析対象の実行ファイルを選択し、自動解析を実行します。
4. **Symbols** ツリーから任意の関数をクリックすると、`ghidra://<md5>/function/<entry>` 仮想ファイルとして逆コンパイル済み C 擬似コードが開きます。
5. 関数ヘッダ上の **Control Flow** または **Listing** コードレンズをクリックし、グラフやアセンブリとのカーソル同期が動作することを確認します。

詳細な画面説明や設定項目は [VS Code ガイド](vscode-guide.md) を参照してください。

## Neovim でのスモークテスト

Neovim 0.10 以上で [`lazy.nvim`](https://github.com/folke/lazy.nvim) を使う場合の最小設定例です。

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
        })
    end,
}
```

設定後、Neovim 上で次の手順で動作確認を行います。

1. `:checkhealth ghidra-lsp` を実行し、Neovim バージョン、`ghidra-lsp` バイナリ、および `ghidra-mcp` が検出されることを確認します。
2. `:GhidraOpenBinary /path/to/binary` を実行してプログラムを読み込みます（未解析の場合は自動解析の実行を確認するプロンプトが表示されます）。
3. `:GhidraFunctions` または `:GhidraOpenFunction main` で関数を開きます。
4. シンボル上で `K`（ホバー）や `gd`（定義ジャンプ）、`<leader>gl`（Listing）、`<leader>gm`（Hex メモリビュー）を試します。

全コマンドとキーマップの詳細は [Neovim ガイド](neovim-guide.md) を参照してください。

## トラブルシューティング

### バイナリを開くたびに `request failed; inspect daemon.log` で失敗する

VS Code または Neovim と同じ環境変数（`PATH`、`GHIDRA_INSTALL_DIR`、Java 環境変数など）のままターミナルで次を実行してください。

```sh
ghidra-mcp call ghidra_session '{"operation":"list"}'
```

Linux 環境における `ghidra-mcp` のデーモンログは、通常 `$XDG_RUNTIME_DIR/ghidra-mcp-<uid>` または `/tmp/ghidra-mcp-<uid>` 配下の `daemon.log` に出力されます。

### 関数を開いたときに「Upgrade ghidra-mcp for native GUI cursor locations」警告が出る

`ghidra-lsp` は `decompilation.get` を `format: "document"`, `include_comments: true` で呼び出し、GUI の行・トークン座標と 5 種類のコメントを 1 回の通信で取得します。古いバージョンの `ghidra-mcp` が `document` 形式に対応していない場合、サーバーは `text` / `tokens` 形式へフォールバックし、診断警告（WARNING）を発行します。この場合カーソル位置の精密アライメントやフルコメント表示が制限されるため、最新の `ghidra-mcp` へ更新してください。

### `ghidra-lsp` 起動エラーやタイムアウト

- エディタから起動する `ghidra-lsp` に `ghidra-mcp` の `PATH` が引き継がれていない場合は、絶対パスを `ghidraLsp.mcpCommand`（VS Code）または `mcp_command`（Neovim）へ設定してください。
- 大規模バイナリの初回シンボル列挙や逆コンパイルに時間がかかる場合は、`--request-timeout-ms`（または設定の `requestTimeoutMs`）を増やしてください（最大 `300000` ms）。
- バックエンドとの通信タイムアウトや切断が発生すると、`McpBackend` はアクティブな MCP セッションを破棄し、次回リクエスト時に `ghidra-mcp` 子プロセスを遅延再起動します。

次の章: [アーキテクチャ](architecture.md)。
