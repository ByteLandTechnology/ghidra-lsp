# LSP と開発規約

この章では、`ghidra-lsp` が公開する LSP ケーパビリティの完全一覧、49 個のカスタムコマンド（`workspace/executeCommand`）、ワークベンチ操作の許可リスト、`AGENTS.md` の設計規約、および `cargo xtask ci` 検証パイプラインをまとめます。

## LSP ケーパビリティ一覧

`src/server/lsp.rs` の `Server::initialize` がクライアントへ通知する `ServerCapabilities` と対応実装です。

| ケーパビリティ | 設定値 / 仕様 | 備考 |
| --- | --- | --- |
| `positionEncoding` | `utf-16` | すべての行／文字位置およびトークン長を UTF-16 コード単位で計算 |
| `textDocumentSync` | `openClose: true`, `change: FULL`, `save: { includeText: true }` | 全文同期＋保存時テキスト検証 |
| `hoverProvider` | `true` | シンボル種別、アドレス、デマングル／生マングル名、型・ストレージ／表現、コメント、またはデータ型詳細を表示 |
| `definitionProvider` | `true` | 関数・グローバル・ラベル・型・ローカル定義へジャンプ |
| `declarationProvider` | `true` | `goto_definition` へ委譲 |
| `implementationProvider` | `true` | `goto_definition` へ委譲 |
| `typeDefinitionProvider` | `true` | カーソル位置シンボル／型の定義ドキュメントへジャンプ |
| `referencesProvider` | `true` | 関数内／プログラム全体の相互参照先を検索（宣言含む切り替え対応） |
| `documentHighlightProvider` | `true` | 同一ドキュメント内の同一シンボル ID または同一型トークンをハイライト |
| `documentSymbolProvider` | `true` | 関数ルート配下にローカル・参照シンボルをネストした `DocumentSymbol` を返却 |
| `workspaceSymbolProvider` | `resolveProvider: true` | クライアントが `location.range` 解決に対応している場合、`symbol/resolve` で遅延位置解決 |
| `renameProvider` | `prepareProvider: true` | 識別子の範囲とプレースホルダを事前確認し、スコープ付きプレビュー `WorkspaceEdit` を生成 |
| `completionProvider` | `resolveProvider: false` | ローカル変数・プログラムシンボル・組み込み C 型 32 種を補完 |
| `signatureHelpProvider` | `triggerCharacters: ["(", ","]`, `retriggerCharacters: [","]` | 呼び出し先関数のシグネチャと現在引数インデックスを強調表示 |
| `semanticTokensProvider` | `full: true` | `keyword`, `comment`, `type`, `function`, `variable`, `parameter`, `number`, `string`（修飾子: `readonly`） |
| `codeActionProvider` | `codeActionKinds: ["quickfix", "refactor"]`, `resolveProvider: false` | Quickfix: `ghidraLsp.editComment`、Refactor: 型検査・関数／変数編集・各種ビュー起動（9 項目） |
| `inlayHintProvider` | `true` | ローカル変数／パラメータのストレージヒント（`: <storage>`）および呼び出し先アドレスヒント（`[<addr>]`） |
| `callHierarchyProvider` | `true` | `prepareCallHierarchy` / `incomingCalls` / `outgoingCalls` を実装 |
| `codeLensProvider` | `resolveProvider: false` | 関数ヘッダ上に `Listing`, `Call Graph`, `Control Flow`, `Callers`, `Callees`, `References` を表示 |
| `foldingRangeProvider` | `true` | `{ ... }` ブロックおよび複数行 `//`・`/* ... */` コメントの折りたたみ範囲を返却 |
| `documentLinkProvider` | `resolveProvider: false` | 本文やコメント内の `ghidra://`、`ram:...`、`0x...` をクリック可能リンクに変換 |
| `executeCommandProvider` | 全 49 個の `ghidra.*` コマンド | セッション、チェックポイント、ナビゲーション、ビュー、グラフ、安全編集を実行 |

### カスタム LSP 通知

サーバーは、セッションのバックエンド解析状態やシンボル・データ型・コメントが変更されたとき、クライアントへ次のカスタム通知を送信します。

```json
{
  "method": "ghidra/changed",
  "params": {
    "md5": "<32桁小文字MD5>"
  }
}
```

## `workspace/executeCommand` カタログ（全 49 コマンド）

`src/server/mod.rs` の `COMMANDS` 配列で公開され、`commands.rs` / `checkpoint_commands.rs` / `domain_commands.rs` / `edit_commands.rs` / `view_commands.rs` にディスパッチされる全 49 コマンドです。

### セッション・プログラムライフサイクル

| コマンド名 | 主な入力パラメータ | 動作概要 |
| --- | --- | --- |
| `ghidra.sessions` | `{}` | `ghidra-mcp` 上の全セッション一覧を取得 |
| `ghidra.selectSession` | `{ md5 }` | 指定 `md5` が `ready` であることを確認してアクティブセッションに設定 |
| `ghidra.openBinary` | `{ path \| md5, analyze? }` | バイナリパスまたは保存済み `md5` を同期オープンし、必要に応じて自動解析完了まで待機 |
| `ghidra.beginOpenBinary` | `{ path \| md5, analyze? }` | 非同期でバイナリオープン／解析を開始し、ポーリング用 `token` を返却 |
| `ghidra.pollOpenBinary` | `{ token }` | 非同期オープン／再解析ジョブの進捗（`opening` / `analysis` / `ready` / `failed`）をポーリング |
| `ghidra.beginReanalyze` | `{ md5?, analyzers? }` | 非同期でプログラム再解析ジョブを開始し、ポーリング用 `token` を返却 |
| `ghidra.reanalyze` | `{ md5?, analyzers?, wait? }` | プログラム再解析を開始（既定で `wait: true`、完了後 `program.save` と文書更新） |
| `ghidra.cancelJob` | `{}` | 現在の `ghidra-mcp` に `job.cancel` がないことを明示通知（解析自体の中断は不可） |
| `ghidra.closeSession` | `{ md5?, force? }` | 保留中リネームや未保存編集がないことを確認してセッションを閉じ、キャッシュを破棄 |
| `ghidra.checkpoints` | `{ md5? }` | セッションの保存済みチェックポイント一覧（`items`、`maxPerBinary`）を取得 |
| `ghidra.createCheckpoint` | `{ md5?, name? }` | クリーンなセッションを永続化してプロジェクトチェックポイントを作成 |
| `ghidra.restoreCheckpoint` | `{ md5?, id?, name? }` | Ghidra を保存せず停止してチェックポイントを復元・再起動し、全ビューを再同期 |
| `ghidra.resetSession` | `{ md5?, reopen?, analyze? }` | `binary` と `binary.json` を残して `ghidra/` とチェックポイントを削除し、必要に応じて再インポート・解析 |
| `ghidra.configure` | `{ templateArguments? }` | 表示設定（`"omit"` / `"show"`）を動的更新 |

### カタログ・検索・ドキュメント管理

| コマンド名 | 主な入力パラメータ | 動作概要 |
| --- | --- | --- |
| `ghidra.program` | `{ md5? }` | `program.get` メタデータを取得 |
| `ghidra.programMeta` | `{ md5?, showTemplateArguments? }` | エンディアン、ビット幅、メモリブロック、関数インデックス等を一括取得・キャッシュ |
| `ghidra.functions` | `{ md5? }` | 全関数をページング取得し、カバレッジ情報付きで返却 |
| `ghidra.symbols` | `{ md5? }` | 全シンボルをページング取得し、カバレッジ情報付きで返却 |
| `ghidra.types` | `{ md5? }` | 全データ型をページング取得し、カバレッジ情報付きで返却 |
| `ghidra.type` | `{ md5?, path }` | 指定 `path` の生データ型定義を取得 |
| `ghidra.strings` | `{ md5? }` | `listing.data_unit.list` から定義済み文字列一覧を抽出 |
| `ghidra.binaryInterface` | `{ md5? }` | Ghidra セッション（`import.list` / `export.list`）から Import / Export 表を取得（旧版ブリッジ時はローカル `object` 解析へフォールバック） |
| `ghidra.openFunction` | `{ md5?, entry }` | 指定関数を逆コンパイルし、正規 `ghidra://` URI を返却 |
| `ghidra.openSymbol` | `{ md5?, id }` | シンボル ID を解決して開く対象 URI を返却 |
| `ghidra.document` | `{ uri, includePending? }` | 仮想ドキュメント（`function` / `symbol` / `references` / `type`）のテキストと警告を返却 |
| `ghidra.saveDocument` | `{ uri, text }` | 仮想 C ドキュメント保存（有効なリネームプレビューまたは単一識別子リネームのみ許可） |
| `ghidra.refreshDocument` | `{ uri }` | 未変更の単一仮想ドキュメントを再生成・更新 |
| `ghidra.refresh` | `{ md5? }` | 指定セッションの未変更ドキュメントをすべて再生成してエディタへ反映 |

### 位置解決・型情報・リネーム状態

| コマンド名 | 主な入力パラメータ | 動作概要 |
| --- | --- | --- |
| `ghidra.location` | `{ uri, position?, address?, version? }` | カーソル UTF-16 位置 ↔ コードユニットアドレス／GUI 位置を相互変換、または `position` と `address` 省略時に順序付き UTF-16 スパン位置スナップショットを返却 |
| `ghidra.reveal` | `{ md5?, address }` | アドレスを所有する関数を開き、該当トークン範囲と一致精度（`exact`）を返却 |
| `ghidra.resolveTarget` | `{ md5?, input, currentAddress? }` | 入力文字列（アドレス、オフセット式、シンボル名）をターゲットアドレスへ解決 |
| `ghidra.typeAtPosition` | `{ uri, position }` | カーソル位置のシンボルまたはトークンに対応するデータ型定義を取得 |
| `ghidra.renameState` | `{ md5? }` | 保留中リネームのオリジン、旧名／新名、対象ドキュメント一覧、適用状態を返却 |
| `ghidra.discardRename` | `{ md5? }` | 未パッチの保留中リネームを取り消し、エディタバッファを復元 |

### ビュー・グラフ・構造化編集・ワークベンチゲート

| コマンド名 | 主な入力パラメータ | 動作概要 |
| --- | --- | --- |
| `ghidra.listingWindow` | `{ md5?, address?, cursor?, limit?, showTemplateArguments?, exactStart? }` | ウィンドウ付きアセンブリリスティングと折りたたみ済み未定義バイト列を構築 |
| `ghidra.memoryWindow` | `{ md5?, address?, length?, bytesPerRow?, endian?, inspectAddress?, selectionLength? }` | 境界付き 16 進バイトウィンドウ（既定 256 B）と初期 Data Inspector 結果を構築 |
| `ghidra.inspectBytes` | `{ md5?, bytes, endian?, addressSizeBits?, blocks?, defaultSpace?, addressWidth? }` | 最大 16 バイト配列を整数・浮動小数点・ポインタ・文字列へデコード |
| `ghidra.controlFlowGraph` | `{ md5?, entry?, address?, showTemplateArguments? }` | 命令と参照から基本ブロック CFG ノード・エッジを構築 |
| `ghidra.callGraph` | `{ md5?, entry?, address?, callersDepth?, calleesDepth?, expansion?, refresh?, showTemplateArguments? }` | 深さ指定探索（`callersDepth` / `calleesDepth`）またはノード単位の対話的展開集合（`expansion.callers` / `expansion.callees`）により、境界付き（最大 80 ノード / 240 エッジ / 40 クエリ）のコールグラフを構築 |
| `ghidra.commentsAt` | `{ md5?, address }` | 指定アドレスの 5 種コメント（`plate`, `pre`, `eol`, `post`, `repeatable`）を取得 |
| `ghidra.saveComment` | `{ md5?, address, kind, text, expected? }` | 楽観的競合検査付きでコメント作成・更新・削除（空文字）し、`program.save` を実行 |
| `ghidra.functionPrototype` | `{ md5?, entry }` | 関数シグネチャ、属性、パラメータ、ローカル変数および元スナップショットを取得 |
| `ghidra.saveFunctionPrototype` | `{ md5?, entry, original, ... }` | 競合検査後、`all_or_none` バッチで関数シグネチャ／パラメータを更新し永続化 |
| `ghidra.saveVariables` | `{ md5?, entry, original, parameters?, locals? }` | 競合検査後、`all_or_none` バッチでパラメータ／ローカル変数を更新し永続化 |
| `ghidra.typeDocument` | `{ md5?, path }` | `.ghidra-type` JSONC テキスト、読み取り専用理由、`original`、`model` を取得 |
| `ghidra.validateTypeDocument` | `{ text, original }` | JSONC 構文・重複キー・スキーマ・型記法を検査し UTF-16 エラー範囲を返却 |
| `ghidra.saveTypeDocument` | `{ md5?, path, text, original }` | 競合検査、型差分パッチ適用、`program.save`、正規化読み戻しを実行 |
| `ghidra.query` | `{ md5?, domain, operation, params? }` | `workbench::READ` 許可リスト（32 操作）に含まれる読み取り MCP 操作のみ実行 |
| `ghidra.mutate` | `{ md5?, domain, operation, params? }` | `workbench::WRITE` 許可リスト（25 操作）に含まれる書き込み操作を実行後に永続化・更新 |

### `workbench` 許可リスト（`src/workbench.rs`）

- **`ghidra.query`（32 種の読み取り操作）**:
  `address.resolve`、`address_space.list`、`analysis.get`、`code_unit.list`、`comment.get`、`comment.list`、`data_type.get`、`data_type.list`、`data_type_category.list`、`data_unit.list`、`decompilation.get`、`flow_override.list`、`function.get`、`function.list`、`function_call.list`、`global_variable.get`、`global_variable.list`、`instruction.get`、`instruction.list`、`interface.get`、`job.get`、`job.wait`、`memory.read`、`memory_block.get`、`memory_block.list`、`program.get`、`program_language.get`、`reference.list`、`session.get`、`session.list`、`symbol.get`、`symbol.list`
- **`ghidra.mutate`（25 種の書き込み操作）**:
  `code_unit.clear`、`comment.{create,delete,patch,upsert}`、`data_type.{create,delete,patch,upsert}`、`flow_override.patch`、`function.patch`、`function_local_variable.patch`、`function_parameter.{create,delete,patch}`、`global_variable.{create,delete,patch,upsert}`、`instruction.{assemble,disassemble}`、`memory.write`、`program.save`、`symbol.{patch,demangle}`

## 開発規約と CI（`AGENTS.md` / `cargo xtask ci`）

このリポジトリに貢献する際は、[AGENTS.md](../../AGENTS.md) に定義された厳格な設計ルールと品質ゲートを遵守する必要があります。

### コア設計ルール

- **ライセンスヘッダ**: すべての `.rs`、`.lua`、`.ts` ファイルの先頭に `Copyright 2026 ByteLand Technology Limited` と `SPDX-License-Identifier: MIT` の 2 行ヘッダを必須とします。
- **コード制限**:
  - `unsafe` コード禁止（`unsafe_code = "forbid"`）。
  - `unwrap()`・`expect()`・`#[allow(...)]`・`#[expect(...)]` 禁止。
  - `async-trait` クレート禁止（具体型またはネイティブ `async fn` を使用）。
  - すべてのクレート・モジュール・構造体・列挙型・バリアント・フィールド・定数・型エイリアス・関数（プライベート含む）に完全なドキュメントコメントが必須。
  - 各 `.rs`、`.lua`、`.ts` ファイルはコメントと空行を除き **800 行以内**。
  - バイナリ専用構成（`src/main.rs` のみ、`src/lib.rs` 禁止）、デフォルトはプライベートまたは `pub(crate)`（`unreachable_pub = "deny"`）。
- **ドキュメント・Markdown ルール**:
  - すべての英語テキスト（`AGENTS.md`、コード内コメント、doc コメント、コミットメッセージ、英語版ドキュメント）は **ASD-STE100 Simplified Technical English** で記述します。
  - `xtask/src/examples.rs` がすべての非隠し `.md` ファイルと Rust doc コメントを検査するため、言語タグのない裸のコードフェンス、Rust コードブロック（`rust`、`ignore`、`no_run`、`should_panic`、`compile_fail`）、および段落外の 4 スペースインデントブロックは一切許可されません。

### テスト境界（External Black-Box Testing）

このリポジトリの内部にはテストコード、テストデータ、`tests/`・`benches/` ディレクトリ、`[dev-dependencies]`、およびテスト専用のモックやダミーコードを一切置かない規則になっています。検証はビルド済みの `ghidra-lsp` バイナリの標準入出力に対してリポジトリ外部のテストハーネスからブラックボックステストを実行します。

### `cargo xtask ci` 実行順序

コミット前に必ず `cargo xtask ci` を実行します（20 GiB 以上の空き容量を確保してください）。

```sh
cargo xtask ci
```

`xtask/src/ci.rs` は次の 6 段階を厳密な順番で実行します。

1. `cargo fmt --all -- --check`
2. `cargo xtask check`（ライセンスヘッダ検査、800 行コード上限検査、禁止構文・依存・Markdown コードブロック検査）
3. `cargo clippy --locked --workspace --all-targets -- -D warnings`
4. `cargo doc --locked --workspace --no-deps --document-private-items`
5. `cargo build --locked --workspace`
6. `cargo deny --locked --workspace check`

VS Code 拡張機能を更新した場合は、さらに型チェックとパッケージング検証を実行します。

```sh
npm --prefix editors/vscode run check
npm --prefix editors/vscode run package
```
