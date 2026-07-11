# 設計文書

## 1. 技術スタック比較(3案)

| 観点 | 案A: Node + Express + unified SSR + 素のJS | 案B: Vite + React SPA + Node API | 案C: Tauri デスクトップアプリ |
| --- | --- | --- | --- |
| 起動の手軽さ | ◎ `npm start` のみ、ビルド工程なし | △ ビルドまたは dev サーバー2層 | × Rust ツールチェーン+ビルド必須 |
| プラグイン拡張性 | ◎ サーバー側パイプラインに直挿し | ○ 可能だがバンドルに巻き込む必要 | ○ 同左 |
| 実装・保守コスト | ◎ 依存少、全コードが可読な素のJS | △ React+ビルド設定の維持 | × 最重量 |
| UIリッチさ | ○ 個人用途には十分 | ◎ | ◎ |
| 配布 | ○ フォルダごとコピーで動く | ○ | ◎ 単一exe |
| 主リスク | UIが素朴になりがち | 「1コマンド起動」要件を汚す | 個人メモビューアーに過剰 |

**採用: 案A。** 決め手は (1) ビルド無しで1コマンド起動、(2) remark/rehype プラグインを Node 側で `processor.use()` するだけの最短拡張経路、(3) 数百ファイル・個人利用というスケールに対する適正コスト。

### 却下した代替案

| 代替案 | 却下理由 |
| --- | --- |
| 案B(React SPA) | ビルド層が起動要件と保守性を悪化。UIの複雑さが要件にない |
| 案C(Tauri/Electron) | 配布は良いが開発・更新の重量が個人ツールに見合わない |
| クライアントサイドレンダリング(unifiedをバンドル) | esbuild等のビルド工程が必須になり、プラグイン追加=再バンドルで拡張性が悪化 |
| 既存OSS利用(docsify / mdBook / VSCodeプレビュー / Obsidian) | mdBookはSUMMARY.md必須のビルド型、docsifyはツリー自動生成が弱い。単一ファイルモード+任意フォルダCLI+remark互換プラグイン+横断検索+ライブリロードの**組み合わせ**を満たすものがなく、自作の拡張基盤を持つこと自体が本タスクの目的 |
| markdown-it / marked | プラグイン資産とAST変換の柔軟性で unified(remark/rehype)が要件に合致 |
| 検索のインデックス化(lunr等) | 500ファイル実測75msの逐次スキャンで十分。索引の鮮度管理コストが割に合わない |

## 2. アーキテクチャ

```
ブラウザ (public/: 素のJS + CSS)
  │  GET /api/tree /api/doc /api/search /raw/*      WebSocket /ws
  ▼                                                    ▲
Express (server/index.js) ── chokidar 監視 (watch.js) ─┘
  │
  ├─ render.js: unified パイプライン + mtimeキャッシュ(50件)
  ├─ tree.js / search.js: フォルダ走査・横断検索
  └─ config.js: md-viewer.config.mjs 読み込み(ユーザープラグイン)
```

- **サーバーサイドレンダリング**: Markdown→HTML は Node 側。クライアントは受け取ったHTMLの後処理(mermaid描画・目次・検索)のみ
- **mermaid だけクライアント描画**: mermaid は DOM 必須のため。サーバーは ```mermaid ブロックを `<div class="mermaid-block"><pre>ソース</pre></div>` に変換して渡す(JS無効時はソース表示のフォールバックになる)
- **単一ファイルモード**: ルート=親フォルダとして相対画像を解決しつつ、UI はサイドバー非表示

### レンダリングパイプライン(順序が重要)

```
remark-parse → remark-frontmatter → remark-gfm → remark-math
  → [ユーザーremarkプラグイン] → remark-rehype(allowDangerousHtml)
  → rehype-raw → rehype-slug → rehype-katex
  → mermaidブロック分離(shikiに食わせない)
  → 未知言語のクラス除去(shiki例外防止)
  → @shikijs/rehype(ライト/ダーク両テーマをCSS変数で焼き込み)
  → 相対リンク書換(画像→/raw、.md→#/ハッシュ遷移)
  → 見出し収集(アウトラインAPI用)
  → [ユーザーrehypeプラグイン] → rehype-stringify
```

### API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/config` | モード(dir/file)、ルート名、初期ファイル |
| `GET /api/tree` | .md のツリー(空フォルダは枝刈り) |
| `GET /api/doc?path=` | `{html, headings[], plain, mtimeMs}` |
| `GET /api/search?q=` | 横断検索。ファイルごとの行スニペット(上限200件) |
| `GET /raw/<path>` | 画像等の生ファイル(ルート配下限定) |
| `WS /ws` | `doc-changed` / `tree-changed` を配信 |

## 3. 主要な設計判断と理由

| 判断 | 理由 |
| --- | --- |
| shiki(dual theme, `defaultColor:false`) | ライト/ダーク両テーマの色をCSS変数として1回のレンダリングで埋め込み、テーマ切替時に再レンダリング不要(mermaidのみ再描画) |
| テーマ切替時は保持済みHTMLから本文を再構築 | mermaidはテーマをSVGに焼き込むため。`state.payload` から innerHTML を張り直して再描画する |
| mtime+size キャッシュ(最大50件) | ライブリロードや再訪時の再レンダリングを2ms程度に。監視イベントでも明示的に無効化 |
| 起動時ウォームアップ | shiki初期化は実測4.5秒。起動直後に裏でダミーレンダリングし、初回表示を223msに短縮 |
| 2MB超はプレーン表示 | ハイライト・数式処理の時間暴走を防ぐ。通知バナー付き |
| HTMLサニタイズなし + 127.0.0.1 バインド | 対象は自分のローカルファイル。XSS脅威モデルが成立しない一方、rehype-raw による生HTML表現力を優先。不信文書用に rehype-sanitize を config で追加可能 |
| パストラバーサル防御 | `path.resolve` 後にルートプレフィックス検証(`/api/doc`・`/raw` 共通)。実測: `../../package.json` → 400/403 |
| 検索は索引なしの逐次スキャン | 500ファイル実測75ms。複雑さを増やす根拠がない |
| ツリーは展開時に子を遅延描画 | 数百〜数千ノードでも初期描画を軽く保つ |
| CDN不使用(katex/mermaidをnode_modulesから配信) | オフラインで完全動作 |
| Express採用(素のhttpでなく) | static配信・sendFile・Content-Type処理の実績を4ルートのために自作しない |

## 4. 性能実測(2026-07-11, Windows 11 / Node 25)

対象: 500ファイル(20フォルダ×25、各約2KB)

| 操作 | 実測 |
| --- | --- |
| `/api/tree`(500ファイル走査) | 5〜6ms |
| `/api/search`(500ファイル横断) | 74〜79ms |
| `/api/doc` 初回(ウォームアップ後) | 223ms |
| `/api/doc` 2回目以降(非キャッシュ) | 8〜16ms |
| `/api/doc` キャッシュヒット | 2ms |

勝利条件「500ファイルで1秒未満」を全項目で達成。

## 5. 破壊者指摘と対処(全周分)

| # | 指摘 | 対処 |
| --- | --- | --- |
| 1 | 既存OSSの車輪の再発明では | §1の通り要件の組み合わせを満たす既存物がない。拡張基盤の自作が目的そのもの |
| 2 | 4ルートにExpressは過剰 | static/sendFileの実績と実装リスク低減を優先(§3) |
| 3 | 毎リクエストSSRのコスト | mtimeキャッシュ+ウォームアップで解消(実測§4) |
| 4 | サニタイズなしはXSS | ローカル・自己文書・ループバック限定を明文化。config で sanitize 追加可能 |
| 5 | 巨大ファイルでフリーズ | 2MB超はプレーン表示にフォールバック |
| 6 | OneDriveで監視が不安定 | awaitWriteFinish + `--poll` オプション |
| 7 | mermaid構文エラーで画面崩壊 | ブロック単位で捕捉し、エラー文+ソース表示。残骸要素も掃除(実測済み) |
| 8 | 未知言語でshiki例外 | レンダリング前に未知の language- クラスを除去(```hogehoge で実証) |
| 9 | テーマ切替でmermaid/コード色が破綻 | shiki dual theme + payload再適用で再描画(実測済み) |
| 10 | WS切断でライブリロード停止 | 指数バックオフ再接続+再接続時にツリー・本文を再同期 |
| 11 | 検索マーク過多でDOM凍結 | ページ内検索は500件で打ち切り「500+」表示 |
| 12 | config設定ミスで無言起動 | 起動時に検証し、明確なエラーメッセージで停止 |
| 13 | 初回表示4.5秒(第3周で発見) | 起動時ウォームアップで223msに短縮 |
| 14 | 深い階層のファイルが初期表示される(第3周で発見) | ルート直下の index.md / README.md を優先選択 |
| 15 | 日本語見出しアンカーがジャンプしない(第3周で発見) | ハッシュのフラグメントを復号してから照合 |

## 6. Windows配布(exe化)の設計判断(追記, 2026-07-11)

初回納品後、Windows向けのポータブル版・インストーラー版の要望を受けて追加した部分。

### 6.1 exe化方式の比較

| 方式 | 概要 | 判定 |
| --- | --- | --- |
| **Node SEA(採用)** | Node公式のSingle Executable Applications。node.exeに小さなブートストラップblobをpostjectで注入 | ◎ 公式機能、node_modulesは通常ファイルのまま隣に置けるため資産埋め込み不要 |
| pkg / nexe | 旧来のJSバンドル型exe化ツール | △ vercel/pkgは非推奨化。shikiの動的import(言語文法の遅延読み込み)と相性が悪い |
| Electron/Tauri再検討 | GUIシェルで包む | × 既にブラウザ+HTTPサーバー構成が動いており、GUIシェル化は要件にない過剰投資 |

**設計**: `mdv.exe`(SEA)は最小のブートストラップのみを内蔵し、`import()` で隣接する `app/bin/mdv.js` を動的読み込みする。サーバー本体・クライアント資産・`node_modules` はexeに埋め込まず隣接フォルダに通常ファイルとして配置する。理由: shikiの言語文法・mermaid資産などをSEAのアセット埋め込みAPI(`sea.getAsset()`)向けに全面書き換えするコストとリスクが、通常ファイル配置のシンプルさに見合わない。

**実機検証で判明した重要事実**: SEA実行時の `process.argv` は `[execPath, execPath, ...userArgs]`(先頭が重複)であり、通常の `node script.js args...`(`[node, script, ...args]`)と同じ `slice(2)` 位置にユーザー引数が並ぶ。この事実により `bin/mdv.js` の `util.parseArgs` 呼び出しは**無改造**でexe版・ソース版の両方に対応できた(検証: `build/sea-test` プロトタイプで `test.exe foo bar baz` の実際の argv を出力して確認)。

### 6.2 ポータブル版のnode_modules軽量化

`node_modules` の実測143.7MBのうち、`mermaid` パッケージ単体が79.7MB(依存の `@mermaid-js/parser` 等を含めると約100MB)を占めていた。調査の結果、mermaidはサーバーコードから一度も `require`/`import` されておらず、`express.static()` で `node_modules/mermaid/dist` を配信しているだけと判明(`server/index.js` 参照)。実際にクライアントが読み込むのは `mermaid.min.js` 1ファイル(3.4MB)のみで、`.map` ファイルや非min版、ESM分割版は不要。

**対処**: ポータブル/インストーラー版のビルド時のみ、`mermaid.min.js` 以外のmermaid関連ファイル一式(`@mermaid-js`, `cytoscape`, `cytoscape-fcose`, `d3`, `dompurify`, `es-toolkit`)を除外し、必要な1ファイルだけを配置。`npm ls --all` でこれらのパッケージがmermaid以外から参照されていないことを確認済み。結果: dist/portable 121.7MB(zip 43.5MB)。開発用の `node_modules` 自体は変更していない(ビルドスクリプトのコピー処理のみで除外)。

### 6.3 インストーラーの権限モデル

Inno Setupの `PrivilegesRequired=lowest` を採用し、管理者権限なしで `%LOCALAPPDATA%\Programs\MDViewer` にユーザー単位インストールする設計とした。理由: 個人の閲覧ツールに管理者権限を要求するのは過剰であり、UAC昇格プロンプトはインストール障壁になる。PATH追加はデフォルトでは行わず、タスク選択(既定オフ)にした上で、アンインストール時に追加分だけを正確に削除するPascalScriptを実装(単純な文字列連結ではなく `Pos` で重複チェック・部分削除)。

### 6.4 署名について

コード署名証明書は取得していない(個人の無料配布ツールに対して費用対効果が見合わない判断)。`signtool remove /s` で元のnode.exeの署名を明示的に除去してから `postject` で注入することで、「署名が壊れている」という不整合な状態を避けた(除去しない場合、postjectが "signature seems corrupted" 警告を出すことをプロトタイプ検証で確認済み)。Windows SmartScreenの初回警告は避けられないため、README/インストーラー双方に対処方法(詳細情報→実行)を明記した。

## 7. フォルダ切替・アクセシビリティ・メタデータ機能の設計判断(追記, 2026-07-11)

### 7.1 フォルダ選択に `window.prompt()` を採用した理由

ブラウザの File System Access API(`showDirectoryPicker()`)はサンドボックス化されたハンドルを返すのみで、実OSの絶対パス文字列を取得できない。本アプリのサーバーはNodeの `fs` で実パスを直接読むアーキテクチャのため、ハンドルベースのAPIとは根本的に相性が悪い(ハンドル→絶対パスの変換手段がブラウザ標準には存在しない)。よって絶対パスをテキストで直接受け取れる `prompt()` を採用した。ネイティブのフォルダ選択ダイアログ相当のUXは失うが、要件(サーバー側で実パスを扱う)を満たす現実的な選択肢はこれのみだった。

### 7.2 フォルダ切替時のキャッシュ・監視の扱い

`POST /api/change-dir` はレンダリングキャッシュを**全消去**し、chokidarの監視インスタンスを**破棄して作り直す**方式にした。相対パスキー(例: `index.md`)は新旧ルートで意味が変わるため、部分的な無効化では新ルートの同名ファイルが誤って旧ルートのキャッシュを返すリスクがある。監視インスタンスも同様に、生きたままターゲットだけ変える chokidar API は存在しないため、破棄→再生成が唯一の正しい方法。実装は `restartWatcher()` に集約し、初回起動時のwatcher生成とフォルダ切替時のwatcher再生成で同じコールバック(`handleDocChanged`/`handleTreeChanged`)を共有する。

### 7.3 ツリーのキーボード操作は roving tabindex パターン

各行に個別の `tabindex="0"` を与えず、常に1行だけが `tabindex="0"` を持ち、他は `-1`(roving tabindex、WAI-ARIA Authoring Practices の tree パターンに準拠)。理由: ツリー全体を1回の `Tab` で通過できるようにするため(行数分Tabを押させるのは数百ファイル規模で破綻する)。矢印キーでのフォーカス移動時に `setRovingTabIndex()` で「次にTabで入ってくる位置」を更新する。フォルダは遅延DOM生成(初回展開まで子要素が存在しない)のため、「表示中の行」は `offsetParent !== null` で都度再計算しており、事前に構造をインデックス化していない(数百ファイル規模でも実用速度である前提、実装複雑化を避けた)。

### 7.4 フロントマターの解析ライブラリに `yaml` を採用

`remark-frontmatter` は生YAML文字列をAST上に保持するだけで構造化はしない。パース専用に `js-yaml` ではなく `yaml`(eemeli/yaml)を選定した理由: 依存が0でモダン、YAML 1.2準拠、メンテナンスが活発。パース結果はremarkプラグイン内でASTノードから直接除去し、`file.data.frontmatter` に格納する(remark-rehypeの「未知ノードは無視される」という暗黙の挙動に依存しない明示的な実装とした)。

### 7.5 絵文字はオプトインではなく既定で有効化

要求は「デフォルトでオンにするか、UIトグルを用意するか」の二択だったが、デフォルトオンを選んだ。理由: UIトグルはサーバー側の再レンダリング設定を実行時に切り替える仕組み(設定の永続化、キャッシュ無効化、UIの追加)を必要とし、GFM相当の期待値(GitHub上で `:smile:` が絵文字になるのと同じ体験)に対して実装コストが見合わない。`remark-emoji` は既存のプラグイン注入ポイント(`config.remarkPlugins`)ではなく、GFM/数式と同格の**組み込み機能**としてパイプラインに直接追加した。

### 7.6 フォルダ切替がもたらすセキュリティ境界の変化

`POST /api/change-dir` は許可リストなしで「存在するディレクトリか」のみを検証する。これにより、`--host 0.0.0.0` で起動された場合の攻撃対象範囲が、起動時に固定されたルート配下から「OSユーザーが読み取れる任意のディレクトリ」に拡大する。既存の脅威モデル(認証なし・ループバック前提)そのものは変えず、この拡大をREADME/FEATURESの両方に明記する対処とした。追加の許可リストや確認フローは、個人用ツールの手軽さを損なうため見送った。
