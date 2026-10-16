# 現状・残タスク・再開用メモ

最終更新: 2026-10-17 / 対象バージョン: v1.4.1(公開済み)

セッション圧縮・引き継ぎ用。このファイルだけで作業を再開できるようにまとめている。仕様は [FEATURES.ja.md](FEATURES.ja.md)、設計判断の理由は [DESIGN.md](DESIGN.md) を参照。

## 0. 再開時の最初の一手

1. `git status` と `git log --oneline -5` で状態を確認する(公開済み最新は v1.4.1 = `015e4b1`。それ以降のコミットがあれば内容を確認してから進める)
2. 着手順の推奨は T2(ポップアウトのテーマ同期不具合、修正は数行)→ T4 → T3・T6 → T5(リリース承認)。T1 は実ブラウザが必要なのでオーナーの都合に合わせる
3. リリースする場合は §7.2 の手順に従う。公開系の操作(push / タグ / GitHub Release)は実行前に必ずオーナーへ確認する

## 1. 現状スナップショット

| 項目 | 内容 |
| --- | --- |
| 公開済み最新 | v1.4.1(2026-07-14)。GitHub Releases に portable zip と setup exe を添付済み |
| リポジトリ | https://github.com/suguruma/md-viewer(ブランチ master)。v1.4.1 タグ = `015e4b1` |
| 作業ツリー | 未追跡 `sample/mindmap.md` のみ(判断は §4) |
| 実行環境 | Windows 11 / Node v25.3.0(ビルドに使った `node.exe` がそのまま `mdv.exe` の実行体になる) |
| 規模 | `public/app.js` 約1300行、`server/` 約940行。自動テストなし |

### リリース履歴

| 版 | タグのコミット | 内容 |
| --- | --- | --- |
| v1.2.0 | `95361c3` | 前回開いたフォルダの自動復元 |
| v1.2.1 | `d6db11e` | 一般利用者向け「はじめにお読みください.txt」を同梱 |
| v1.3.0 | `796ef97` | マインドマップ俯瞰表示 / タスクのチェックボックス双方向同期 / 選択範囲の装飾ショートカット(元ファイルへ書き込む最初の版) |
| v1.4.0 | `aef8f58` | ポップアウトプレビュー(別ウィンドウ、BroadcastChannel によるメイン→ポップアウトの一方向同期) |
| v1.4.1 | `015e4b1` | 起動バナーが `v1.0.0` 固定だった不具合を修正(`package.json` の version を読む) |

## 2. 決定事項

| 項目 | 決定内容 | 根拠 |
| --- | --- | --- |
| 位置づけ | 閲覧専用が基本。元ファイルへの書き込みは「タスクのチェックボックス切替」と「装飾ショートカット(`Ctrl+Shift+X` 打ち消し線 / `Ctrl+Shift+U` 下線)」の2経路のみ。汎用エディタにはしない | FEATURES §2.9–2.10, §8 |
| 書き込みの信頼モデル | クライアントは「どこ(範囲)」と「期待する原文」だけを送り、書き込む内容は常にサーバーが決める。書き込み前に対象位置の原文を再検証し、不一致なら書かずに拒否する。CRLF ファイルで位置がずれる不具合は修正済み | DESIGN §9.4, §9.5 / `server/write.js` |
| Markdownパーサ | unified / remark / rehype を維持。移行は不要と判断。今後移行が必要になったら事前にオーナーの許可を取る | DESIGN §9.1 |
| マインドマップ | 現在の文書の「俯瞰モード」。markmap-lib / markmap-view / d3 を同梱配信(CDN 不使用)。ノードの直接編集は見送り、代わりに「ノードをクリック→プレビューの該当箇所へジャンプ」 | DESIGN §9.2, §9.6 |
| ポップアウト | md-viewer にはエディタ画面がなく「エディタのテキスト変更の同期」は成立しないため、同期対象は「表示中ファイル・テーマ・マインドマップ表示」のみ。ファイル内容は各ウィンドウが持つ既存の WebSocket ライブリロードで独立に反映される。通信は BroadcastChannel でメイン→ポップアウトの一方向。別ビルドにせず `?popout=1` で同一バンドルをレイアウト分岐。開閉検知は `window.closed` の 400ms ポーリング | DESIGN §10 / FEATURES §2.11 |
| 配布 | 未署名の個人配布(portable zip + ユーザー単位インストーラー、管理者権限不要)。SmartScreen の警告は README に明記済み | DESIGN §6 |
| バージョン | `package.json` の `version` が唯一の情報源(起動バナーもここから読む)。リリースごとに package.json・package-lock.json・`docs/FEATURES.md` と `docs/FEATURES.ja.md` の Version 行を揃える | v1.4.1 で是正 |
| 公開操作 | push・タグ・GitHub Release は都度オーナーに確認してから実行する(v1.4.0 は「リリースまで」の明示指示、v1.4.1 は確認の上で実施) | — |

## 3. 残タスク

優先度の目安: 高=ユーザーに見える不具合・検証漏れ / 中=次回リリース(v1.4.2)までに / 低=余力で / 将来=案

| ID | 内容 | 担当 | 優先度 | ブロッカー |
| --- | --- | --- | --- | --- |
| T1 | ポップアウトの実ブラウザ検証(本物の `window.open`、可能ならマルチモニタ) | オーナー | 高 | 実ブラウザ+実機が必要(Browser pane は `window.open` を別ウィンドウにできない) |
| T2 | ポップアウトでテーマ同期時に Mermaid 図が再描画されない不具合の修正 | Claude | 高 | なし |
| T3 | `sample/mindmap.md` を日本語サンプルへ差し替えてコミット(§4) | Claude | 中 | なし(配布物への反映は次回リリース) |
| T4 | ポップアウトの未検証ケース確認(単一ファイルモード・フォルダ切替・メイン再読込) | Claude | 中 | なし |
| T5 | v1.4.2 のリリース要否判断と公開承認(T2・T3・T6 をまとめる想定) | オーナー | 中 | T2 の完了 |
| T6 | 利用者向け「はじめにお読みください.txt」(`build/build-portable.mjs` 内の生成テキスト)にポップアウト機能の説明を追記 | Claude | 低 | なし |
| T7 | ビルド前に作業ツリーの clean を確認する、または git 管理ファイルだけをコピーする(§5.3-5) | Claude | 低 | なし(方式はオーナー確認が望ましい) |
| T8 | 自動テストの導入(まず `server/write.js` の `toggleTask` / `wrapSelection`、CRLF ケース含む) | Claude | 低 | 方針合意(`node:test` 標準・依存追加なしでよいか) |
| T9 | リリース運用の整備: Release タイトル表記の統一(v1.4.0・v1.4.1 のみ `vX.Y.Z`、過去は `MD Viewer vX.Y.Z`)、CHANGELOG.md の要否 | Claude | 低 | 公開済み Release の編集と CHANGELOG の要否はオーナー判断 |
| T10 | `build-portable.mjs` が出す `DEP0190` 警告(`shell: true` で引数配列を渡している)の解消 | Claude | 低 | なし |
| T11 | コード署名(SmartScreen 警告の回避) | オーナー | 将来 | 証明書の調達(費用) |
| T12 | macOS / Linux 実機での動作確認 | オーナー | 将来 | 実機なし |

### T1 の確認項目(実装上の期待動作)

1. トグルボタンを押す → 別ウィンドウ(960x800)が開き、メイン側は「プレビューは別ウィンドウで表示中です」に切り替わり、ボタンが押下状態(`aria-pressed=true`)になる
2. メインでファイル切替・テーマ切替・マインドマップ切替をする → ポップアウトが即時に追従する
3. ポップアウトを × で閉じる → 約0.4秒以内にメインが通常表示へ自動復帰する
4. プレースホルダー内の「ウィンドウを閉じてここに戻す」を押す → ポップアウトが閉じてメインが復帰する
5. ポップアウトを開いたままトグルボタンを再度押す → ポップアウトが閉じてメインが復帰する(再押下は「閉じる」動作。`openPopout()` 内の `focus()` 分岐は現状到達しない)
6. ポップアップブロックを有効にして押す → 「ポップアップがブロックされました…」のトーストが出て、メインは通常表示のまま
7. ポップアウト内の相対リンクで遷移する → ポップアウト単体で遷移し、メインには反映されない(一方向の仕様)

Claude in Chrome(`mcp__claude-in-chrome__*`)が接続できる環境なら、実際の Chrome で Claude が代行することも可能。

### T2 の詳細

- 事象: メインでテーマを切り替えると、ポップアウト側は `html.dark` クラスが切り替わるだけで本文が再描画されない。Mermaid はテーマを SVG に焼き込むため、ポップアウト内の図が旧テーマの配色のまま残る(次にファイルを切り替えるか WebSocket 更新で再描画されるまで)
- 原因: テーマ適用処理が `toggleTheme()`(`public/app.js` 約68行)と `applyRemoteState()`(同約459行)に重複しており、後者だけ `applyDoc(state.payload, null, { preserveScroll: true })` を呼んでいない
- 修正案: `applyTheme(theme)` のような共通関数に一本化し、リモート適用側でも再描画する。`sample/mermaid.md` をポップアウトで開いた状態でメインのテーマを切り替えて確認する
- 状況: コード読解で確認した不具合で、実機での再現確認は未実施

### T4 の詳細

- 単一ファイルモード: 起動構成 `md-viewer-single`(§7.1)で確認する。ポップアウトの `boot()` は `/api/config` を読まないが、`state.mode` が読まれるのは起動時の初期ファイル選択(`public/app.js` 約1289行)だけなのでリスクは低い(確認のみ)
- 「フォルダを開く」でサーバーのルートを切り替えた場合のポップアウト側の挙動(パス解決、WebSocket の再接続)
- メインを再読込、またはメインを先に閉じた場合: 再読込で `popoutWin` の参照が失われ、プレースホルダーが解除されてポップアウトは開いたまま残る想定。ボタン再押下で同名 `mdv-popout` のウィンドウが再利用されるか確認する

## 4. `sample/mindmap.md` の判断

結論: **コミットすべき(ただし日本語のサンプル内容へ差し替えてから)**。現時点では未コミット・未削除のまま。

- 内容は6行の英語プレースホルダー(`# Main Topic` / `## Subtopic 1` / `## Subtopic 2` と `- Detail 1`〜`4`)。git 未追跡で履歴なし。docs・コード・`sample/index.md` の「収録ファイル」表のどこからも参照されていない
- `build/build-portable.mjs` は `sample/` を作業ツリーからそのままコピーするため、v1.4.0・v1.4.1 の配布物にはこのファイルが入っている(起動バナーのファイル数 7 件 = 追跡6件 + 本ファイル)
- 配布物に入っているのに git に無い状態は、ソースから再ビルドすると配布物と中身が食い違う(再現性の欠落)。削除すると得るものが少ない
- 一方、中身は他のサンプル(日本語・機能解説つき)と作風が合わず、2階層+リストだけでマインドマップの見栄えも出ない
- 推奨対応(T3): 見出し3〜4階層+入れ子リスト+リンク/強調を含む日本語の内容へ差し替え、`sample/index.md` の「収録ファイル」表に1行追加してコミットする

## 5. 既知の不具合・未検証の点・設計上の懸念

### 5.1 検証状況

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| ポップアウト専用レイアウト(`?popout=1`: ツールバー・サイドバー・アウトライン非表示、本文のみ) | 検証済み | Browser pane で computed style を確認 |
| `?popout=1&mindmap=1` で初期からマインドマップ表示 | 検証済み | SVG 描画まで確認 |
| BroadcastChannel 同期(ファイル切替・テーマ・マインドマップ切替) | 検証済み | 別々の2タブ(メイン / ポップアウト)でメイン操作→ポップアウトの DOM を確認 |
| メイン側プレースホルダー(`popout-active`)の表示切替、ツールバー・サイドバーの維持 | 検証済み(CSS のみ) | クラスを手動付与して確認。実際の open→クラス付与の経路は未検証 |
| プレースホルダーのボタン(ポップアウト無し時) | 検証済み | no-op でコンソールエラー無し |
| portable / installer 版の起動、`/`・`/app.js`・`/?popout=1` が200、バナー表示 | 検証済み | installer はサイレントインストール先で確認し、アンインストールまで実施 |
| 本物の `window.open`、`window.closed` ポーリング、自動復帰、ブロック時トースト | **未検証** | Browser pane は別ウィンドウを作らず同一タブ遷移させる。`popoutWin === window` のガードを追加したが当環境では効果を再現できなかった → T1 |
| マルチモニタ実機、Edge / Firefox / Safari | **未検証** | T1 |
| 単一ファイルモード / フォルダ切替中 / メイン再読込 | **未検証** | T4 |
| v1.4.x 後のチェックボックス切替・装飾ショートカットの回帰 | **未検証** | ポップアウトは該当コードに触れていない(追加のみ)。自動テストが無い → T8 |
| インストーラーの GUI 操作、PATH 追加タスク、デスクトップアイコン | **未検証**(v1.4.x) | サイレントインストールのみ確認 |

### 5.2 既知の不具合

- T2(ポップアウトのテーマ同期で Mermaid 図が再描画されない)。ほかに確認済みの不具合は無い

### 5.3 設計上の懸念(率直な指摘)

1. テーマ適用処理の重複が T2 の根本原因。同じ処理が2箇所に分かれて片方だけ再描画が抜けた。共通関数に一本化する
2. `public/app.js` が約1300行の単一モジュールに肥大している(描画・検索・マインドマップ・ポップアウト同期・書き込み UI が同居)。次に機能を足す前に、テーマ・同期・マインドマップなどの分割を検討する
3. 自動テストが無い。元ファイルを書き換える経路に回帰テストが無いのが最大のリスクで、CRLF バグも手動検証で偶然見つかった(T8)
4. バージョン表記の手動同期(`package.json` / FEATURES の Version 行 / インストーラーの `/DAppVersion`)でドリフトが実際に発生した(起動バナー `v1.0.0` 固定、v1.4.1 時点で FEATURES が 1.4.0 のまま)。§7.2 をチェックリストとして守るか、スクリプト化する
5. ビルドが作業ツリーの未追跡ファイルまで配布物に含める(`sample/mindmap.md` の例)。ビルド前の clean 確認か、git 管理ファイルのみのコピーにする(T7)
6. ポップアウトを前面に出す手段が無い。再押下は「閉じる」動作で、`openPopout()` 内の `focus()` 分岐はデッドコード。2枚目のモニタで他ウィンドウの背面に隠れると取り戻せないため、プレースホルダーに「前面に出す」ボタンを足して `focus()` を活用する案(§6)

## 6. 将来案(未決定・未着手)

- ポップアウトの UX: プレースホルダーに「ウィンドウを前面に出す」ボタンを追加(§5.3-6)
- ポップアウトの独立表示モード: ミラー(現状)と独立を選べるようにする。例: メインは本文、サブはマインドマップやアウトラインを常時表示
- スクロール位置・ページ内検索状態の同期(スクロールは比率 + throttle)
- 双方向化(ポップアウト側のリンク遷移をメインへ反映)。送信元 ID・連番によるループ防止が必要になるため、これまで一方向に留めてきた(DESIGN §10.3)
- ポップアウトの位置・サイズの記憶(localStorage)
- 横断検索の強化(正規表現 / AND 検索)。PROCESS.md の旧改善候補のうち未着手分
- マインドマップのノード直接編集。markmap は一方向の可視化ライブラリのため見送り中(DESIGN §9.6)。再検討するなら別ライブラリか自前描画が前提で、費用対効果の判断が要る
- コード署名、winget 等での配布(T11)

## 7. 開発・リリース手順

### 7.1 開発・動作確認

- 作業フォルダは `C:\AIxDev\md-viewer`。セッションの既定 cwd が `C:\AIxDev` の場合があるため、Bash では `cd /c/AIxDev/md-viewer` を付けるか絶対パスで操作する
- 依存導入: `npm install --no-audit --no-fund`
- 起動: `npm run sample`(sample フォルダ、port 8931)/ `node bin/mdv.js <パス> --port N --no-open`
- 構文チェック: `node --check public/app.js` / `node --check server/index.js`(自動テストが無いため)
- Browser pane の起動構成は `C:\AIxDev\.claude\launch.json`(リポジトリ外。`.claude/` は .gitignore 済み)にあり、`preview_start` の `name` で指定する。`md-viewer-sample`(port 8931、フォルダ)と `md-viewer-single`(port 8932、`sample/math.md` の単一ファイル)

### 7.2 リリース手順(すべて `C:\AIxDev\md-viewer` で)

1. `package.json` の `version` を更新し、`npm install --no-audit --no-fund` で `package-lock.json` に反映する
2. `docs/FEATURES.md` と `docs/FEATURES.ja.md` の Version 行を更新する。機能追加があれば README(英・日)と FEATURES にも反映する
3. 変更をコミットする(`feat:` / `fix:` / `docs:` / `chore:` + 日本語の要約)
4. `node build/build-portable.mjs` → `dist/portable/` と `dist/md-viewer-portable-win-x64-vX.Y.Z.zip`(約45MB)。Windows SDK の `signtool` で node.exe の署名を除去し、`npx postject` で SEA を注入する
5. PowerShell で `& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" /DAppVersion=X.Y.Z installer\setup.iss` → `dist\md-viewer-setup-win-x64-vX.Y.Z.exe`(約30MB)
   - Inno Setup 6.7.3 は winget でユーザー単位にインストール済み(Program Files にも PATH にも無い)。Git Bash から呼ぶとパス変換で「指定されたファイルが見つかりません」になるため PowerShell で実行する
6. 検証する
   - ポータブル版: `dist/portable/mdv.exe app/sample --port <空き> --no-open` を起動し、バナーが `MD Viewer vX.Y.Z` であること、`/`・`/app.js`・`/?popout=1` が200であることを確認
   - インストーラー: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=<一時フォルダ>` でサイレントインストールして同様に確認し、一時フォルダ内の `unins*.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` でアンインストール(スタートメニューのグループが消えることも確認)
7. オーナーに確認してから `git push origin master` → `git tag -a vX.Y.Z -m "..."` → `git push origin vX.Y.Z` → `gh release create vX.Y.Z <zip> <exe> --title "MD Viewer vX.Y.Z" --notes ...`
   - ノートは既存リリースの書式に合わせる(英語。`### New in this release` または `### Fixed`、`### Downloads`、SmartScreen の注記)
8. `gh release view vX.Y.Z --json isDraft,isPrerelease,assets` で公開状態とアセットを確認する

### 7.3 検証時の落とし穴

- Browser pane の `window.open` は別ウィンドウにならず同一タブを遷移させる。ポップアウトの同期検証は `tabs_create` で2タブを作り、片方を `/?popout=1#/index.md` にして行う(open / close の挙動は実ブラウザで)
- `javascript_tool` はトップレベル `await` が使えない。`read_page` の `filter:"all"` は `display:none` の要素も列挙するため、表示状態は `getComputedStyle` で確認する
- `navigate` でハッシュだけ変えてもページは再読込されず状態が残る(SPA)。クリーンな状態が必要なら query を変えて再読込させる
- スクリーンショットが30秒でタイムアウトすることがある(PROCESS.md にも同様の記録)。DOM 検証で代替する
- Git Bash でバックグラウンド起動した exe の標準出力ログは数秒遅れて書かれる(`sleep` してから読む)。PowerShell の `Start-Process -RedirectStandardOutput` は直後に `Stop-Process` すると空になる
- 自動モードの安全判定が「claude-sonnet-5 is temporarily unavailable」で Bash / Browser 系ツールを断続的に拒否することがある(コードの問題ではない)。読み取り系の作業を挟みながら再試行する
- Git の改行は `core.autocrlf=true`(Windows)。コミット時の「LF will be replaced by CRLF」警告は無害

## 8. 運用ルール(オーナーの指示)

- 既存機能を壊さない。各ステップが完了した時点でコミット可能な状態にする
- Markdown パーサの移行や大きな依存追加は事前にオーナーの許可を取る
- 公開系操作(push / タグ / GitHub Release)は都度確認する(§2)
- 設計上の問題を見つけたら率直に指摘する

## 9. 更新履歴

| 日付 | 内容 |
| --- | --- |
| 2026-10-17 | 初版(v1.4.1 時点)。現状・決定事項・残タスク・未検証点・リリース手順を集約 |
