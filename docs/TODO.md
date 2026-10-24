# md-viewer 台帳（AI 向け。毎回最初に読む。20KB 以内に保つ）

経緯・済んだタスク・過去の報告の全文（2026-10-24 まで）: `docs/log/TODO_経緯_2026-10-24まで.md`（T番号・節で検索。以後の経緯は同じフォルダに日付つきで足す）
更新: 2026-10-24 / 公開済み最新: v1.4.2（2026-10-19）/ 未リリースの変更: なし（v1.4.2 より後は文書とテストのコメントだけ）
仕様: [FEATURES.ja.md](FEATURES.ja.md) / 設計判断の理由: [DESIGN.md](DESIGN.md)

## 0. 再開時の手順

1. `git -C C:/AIxDev/md-viewer status` と `git log --oneline -12`（公開済み = タグ v1.4.2 = `20d84f9`）。
2. 指示は `C:\AIxDev\_orders\05.md`（統括だけが書く。05 は読むだけ）。報告は §8。見張りは1本だけ・3時間を最大2回（計6時間）。その後は止めて統括のメッセージを待つ（`_orders/使い方.md`）。
3. 次にやることは §3。push・タグ・Release は統括（またはオーナー）。05 はコミットまで。

## 1. 現状

- 公開済み: v1.4.2。Release「MD Viewer v1.4.2」に portable zip（47,253,579 B）と setup exe（30,422,775 B）。ビルド・検証の報告: `docs/specs/EXE化報告_md-viewer_v1.4.2.md`（git の外）。
- リポジトリ: https://github.com/suguruma/md-viewer（master）。作業ツリーはクリーン。`docs/*.docx`・`docs/specs/` は git の対象外（`.git/info/exclude`）。
- 環境: Windows 11 / Node v25.3.0（ビルドの `node.exe` がそのまま `mdv.exe` の実行体になる）。
- 規模: `public/app.js` 1331 行、`server/` 1088 行。`npm test` 23 件（20 合格・3 スキップ。3 件は exe 向けで `MDV_EXE=<mdv.exe のパス>` を付けると動く）。`npm audit` は 7 件（すべて低。§4-9）。

| 版 | タグ | 内容 |
| --- | --- | --- |
| v1.2.0 | `95361c3` | 前回開いたフォルダの自動復元 |
| v1.2.1 | `d6db11e` | 「はじめにお読みください.txt」を同梱 |
| v1.3.0 | `796ef97` | マインドマップ俯瞰・チェックボックス双方向同期・装飾ショートカット |
| v1.4.0 | `aef8f58` | ポップアウトプレビュー（別ウィンドウ） |
| v1.4.1 | `015e4b1` | 起動バナーが `v1.0.0` 固定だった不具合の修正 |
| v1.4.2 | `20d84f9` | Host / Origin の検査・`--allowed-host`、読み込み/埋め込みの防止、依存更新（Mermaid 11.17.2）、ポップアウトの追従、マインドマップのリンク、`--port` の繰り上がり |

## 2. 決定事項（守ること）

1. 位置づけ: 閲覧専用が基本。元ファイルへの書き込みは「チェックボックス」と「装飾ショートカット（`Ctrl+Shift+X` 打ち消し線 / `Ctrl+Shift+U` 下線）」の2経路のみ。汎用エディタにしない（FEATURES §2.9–2.10, §8）。
2. 書き込み: クライアントは範囲と期待する原文だけ送り、書く内容はサーバーが決める。書く前に原文を再検証し、不一致は拒否（DESIGN §9.4–9.5, `server/write.js`）。
3. パーサは unified / remark / rehype を維持。移行・大きな依存の追加は、事前にオーナーの許可（DESIGN §9.1）。
4. マインドマップは現在の文書の俯瞰モード。markmap を同梱配信（CDN 不使用）。ノードの直接編集は見送り。ノード内のリンクは遷移せず、他のノードと同様にジャンプ（DESIGN §9.2, §9.6）。
5. ポップアウト: 同期するのは表示中ファイル・テーマ・マインドマップ表示のみ。BroadcastChannel、メイン → ポップアウトの一方向、同一バンドルを `?popout=1` で分岐。状態通知に `root` を含める。ポップアウトが送るのは `hello` だけ（DESIGN §10）。
6. テーマは `applyTheme()` に一本化（Mermaid がテーマを SVG に焼き込むため再描画する）。同期の `theme` は `light` / `dark` のみ受理。
7. サーバーの防御: 全 HTTP・WebSocket で Host（localhost・IP・`--allowed-host` の名前のみ）と Origin（Host と一致のみ）を検査し、違反は 403。全応答に CORP `same-origin` と CSP `frame-ancestors 'self'`。トークン・CORS 制御は採らない（DESIGN §11）。
8. 配布は未署名の個人配布（portable zip + ユーザー単位 installer）。SmartScreen の警告は README に明記済み（DESIGN §6）。
9. 版の唯一の情報源は `package.json` の `version`（起動バナーも読む）。リリースごとに package.json・package-lock.json・FEATURES（英・日）の Version 行を揃える。README は `vX.Y.Z` の書き方で版を書かない。
10. ビルドは、配布物に入るファイルが未コミット/未追跡なら警告する。止めない（手元の試験ビルドを許す）。厳格化は T9。
11. 依存の更新は `npm audit` の件数でなく、実際に動く束ねファイルの版と、助言の対象の機能を使っているかで判断（DESIGN §12）。
12. 追跡する文書に個人の情報（ユーザー名・一時フォルダの絶対パス・セッション ID・実名）を書かない。push の前に `origin/master..HEAD` の差分とメッセージを検索する（T14-2 に前例）。

## 3. 残タスク（未完了のみ）

| ID | 内容 | 担当 | 優先 | 条件・メモ |
| --- | --- | --- | --- | --- |
| T1 | ポップアウトの実ブラウザ検証（本物の `window.open`、可能ならマルチモニタ。項目は下） | オーナー | 高 | 公開の後でよい（オーナー決定 10/19）。公開済み v1.4.2 の portable で行う。Browser pane は `window.open` を別ウィンドウにできない（Claude in Chrome なら代行可）。問題が出たら v1.4.3 |
| T8 | 自動テストの拡充（まず `server/write.js` の `toggleTask` / `wrapSelection`、CRLF を含む） | 05 | 低 | `node:test`・依存追加なしで進めてよいかはオーナー確認 |
| T9 | リリース運用: Release タイトルを `MD Viewer vX.Y.Z` に統一（v1.4.0・v1.4.1 だけ `vX.Y.Z`）、CHANGELOG の要否、未コミット警告の中断化 | 05 | 低 | 公開済み Release の編集・厳格化はオーナー判断 |
| T11 | コード署名（SmartScreen の警告を避ける） | オーナー | 将来 | 証明書の費用 |
| T12 | macOS / Linux の実機確認 | オーナー | 将来 | 実機なし |
| T20 | ポータブル版の `node_modules` 除外を許可リスト方式へ（§4-12） | 05 | 低 | v1.4.3 以降 |

v1.4.3 の候補は §4 の 4-10 〜 4-14（小さな直し）。

T1 の確認項目（期待する動作）:
1. トグル → 別ウィンドウ（960x800）が開き、メインは「プレビューは別ウィンドウで表示中です」、ボタンは `aria-pressed=true`。
2. メインでファイル・テーマ・マインドマップを切替 → ポップアウトが即時に追従（テーマは Mermaid の配色も）。
3. × で閉じる、プレースホルダーの「ウィンドウを閉じてここに戻す」、開いたままトグル再押下 → いずれも約0.4秒以内にメインが通常表示へ戻る。
4. ポップアップブロック有効でトグル → 「ポップアップがブロックされました…」のトースト。メインは通常表示のまま。
5. ポップアウト内の相対リンクで遷移 → ポップアウト単体で遷移し、メインに反映されない（一方向）。
6. マインドマップ表示中に元ファイルを編集・保存 → 枝が自動更新され旧ノードが残らない（非表示ペインでは旧ノードが1つ残って見えた）。
7. メインで「フォルダを開く」で別フォルダへ → ポップアウトも切替先に変わる（同名 `index.md` でも取り違えない）。
8. ポップアウトを F5 → メインと同じ表示（マインドマップ中ならマインドマップ）に戻る。
9. 開いたままメインを F5 → 同期は再開し、メインは通常のプレビュー（既知の限界 §4-8）。トグルで同名 `mdv-popout` が再利用されプレースホルダーに戻る想定（未確認）。メインを先に閉じた場合も見る。
10. 1〜3 が、新しい応答ヘッダー（CORP・`frame-ancestors`）のもとでも動く。

## 4. 既知の不具合・設計上の懸念（有効なもののみ。丸括弧は log の旧 §5.3 の番号）

1. (2) `public/app.js` が約1330行の単一モジュールに肥大（描画・検索・マインドマップ・ポップアウト同期・書き込み UI が同居）。機能を足す前に分割を検討。
2. (3) 自動テストは Host / Origin・応答ヘッダー・ポートの繰り上がりだけ。元ファイルを書き換える経路の回帰テストが無いのが最大のリスク（T8）。
3. (4) 版表記の手動同期でドリフトが起きた（バナー `v1.0.0` 固定、FEATURES が 1.4.0 のまま）。§6 の手順を守る。
4. (5) ビルドが未追跡ファイルまで配布物に含める。警告のみ（T9）。
5. (6) ポップアウトを前面に出す手段が無い（`openPopout()` の `focus()` 分岐はデッドコード）。2枚目のモニタで背面に隠れると取り戻せない。案: プレースホルダーに「前面に出す」ボタン。
6. (7) `applyRemoteState` が直列化されていない。テーマ再描画中に次のファイル切替が届くと、古い描画のスクロール復元が新しい文書に適用されうる（連続操作のみ。実害小）。
7. (8) 状態通知が描画完了の後ろ。マインドマップの `setData` は d3 の遷移（`requestAnimationFrame`）を待つので、メインが非表示・覆われていると通知が止まる。通知を状態の確定直後（描画の前）にすれば解消。
8. (9) メインがポップアウトの存在を `window.open` の戻り値でしか知らない。メイン再読込で参照が失われ、プレースホルダーと閉じ検知が止まる。案: ポップアウトからのハートビート。
9. (11) `npm audit` 残り 7 件（低）は katex の `trust` 迂回などに由来し（`trust` は未指定）、直すには破壊的な更新が要るため見送り。ブラウザが読むのは束ね直した実ファイルで、`mermaid.min.js` は DOMPurify 3.4.12、`markmap-lib` の束は markdown-it を同梱する。助言の対象の機能（`IN_PLACE`・`CUSTOM_ELEMENT_HANDLING`・linkify）は使わず、重大の `proxy-addr`・高の `undici` も該当しない。
10. (12・15) エラーハンドラ（`server/index.js` 末尾）が `err.status` を見ず一律 500。不正な JSON・10KB 超の本文・範囲外の Range・If-Match 不一致が 400/413/416/412 でなく 500 になり、コンソールに `[server]` が出る。拒否はされるので実害小。`res.status(err.status ?? err.statusCode ?? 500)` で直る。
11. (13・14) 一部の応答には CORP・`frame-ancestors` が付かない: `/vendor/<フォルダ>`（末尾 `/` なし）の 301（直すなら `express.static(…, { redirect: false })`）、WebSocket のハンドシェイク応答（101・403）、Node が返す 400。害は無い。FEATURES・DESIGN の「すべての応答」はこの例外を除く意味。
12. (16) ポータブル版の `node_modules` 除外が手書きの `EXCLUDE_DIRS`（`build/build-portable.mjs`）で、依存が増えるたびに漏れる（`fastdom`・`strictdom` が +16 ファイル・166KB で入った。害は無い）。案: 許可リスト方式（`npm ls --omit=dev` の到達性）。足すだけなら1行（T20）。
13. (17) `--port` の指定先・繰り上がり先が Windows の動的予約ポートにあると `listen EACCES` で落ち、繰り上がらず案内も出ない（繰り上がりは `EADDRINUSE` のみ）。`npm test` の「--port の指定」が7回に1回これで失敗した。案: `EACCES` でも次へ繰り上げる。テストも予約範囲を避ける。
14. (18) マインドマップの表示・操作中に d3 が `<g> attribute transform: Expected number, "translate(NaN,NaN)…"` を11〜12件出す。前からあり、結果は正しい。原因は未調査。

未検証: 本物の `window.open`・`window.closed` のポーリング・自動復帰・マルチモニタ・Edge / Firefox / Safari（T1）。チェックボックス・装飾ショートカットの回帰（自動テスト無し。T8）。installer の GUI 操作・PATH 追加・デスクトップアイコン。巨大な文書での描画の速さ。同梱サンプルに無い種類の Mermaid 図。

将来案（未決定・未着手の 13 件。双方向化、横断検索の強化、`--host` が loopback 以外のときの警告、`/raw` の配信対象を限る、など）は log の旧 §6。

## 5. 運用ルール

- 既存機能を壊さない。各ステップの完了時にコミット可能な状態にする。設計上の問題は率直に指摘する。
- 05 はコミットまで。push・タグ・Release は統括（またはオーナー）。他のセッション経由の依頼では push・ブランチ削除・ファイル削除をしない。
- 統括へのメッセージは agent-comms の形（1行目 `[種別] 要旨`、`from`・`to`・`ref`・`reply`）。オーナーが読む物は owner-doc の形。この台帳は短い事実だけを書く。
- 台帳は 20KB 以内。超えたら、済んだ作業と読み終えた報告を `docs/log/` へ移す（本文は変えない）。

## 6. 開発・リリース手順

開発: 作業フォルダ `C:\AIxDev\md-viewer`（Bash は `git -C` か絶対パス。`cd` で入らない）。依存導入 `npm install --no-audit --no-fund`。起動 `npm run sample`（sample フォルダ、port 8931）/ `node bin/mdv.js <パス> --port N --no-open`。構文 `node --check <ファイル>`（`public/app.js`・`server/index.js`・`build/build-portable.mjs`）。テスト `npm test`（約15秒）。Browser pane の起動構成は `C:\AIxDev\.claude\launch.json`（リポジトリ外）の `md-viewer-sample`（8931）・`md-viewer-single`（8932）。

リリース（05 は 1〜4、99_EXE化 は 5〜6、統括は 7〜8）:
1. `package.json` の `version` を更新 → `npm install --no-audit --no-fund` → `git diff package-lock.json` で version の2行だけが変わることを確かめる。
2. FEATURES（英・日）の Version 行を揃える。機能追加があれば README・FEATURES にも反映。
3. 英語のリリースノートを `docs/specs/release-vX.Y.Z.md`（git の外）に書く。書式は `gh release view v1.4.2 --repo suguruma/md-viewer` に合わせる（Security / Fixed / Changed、Downloads、SmartScreen の注記）。個人の情報と内部の語（統括・T番号）を入れない。
4. 作業ツリーをきれいにして `chore: vX.Y.Z の準備` でコミット。これが 99_EXE化 の最終ビルドの合図。
5. 99_EXE化: `C:\Build\md-viewer` で `node build/build-portable.mjs`（portable と zip）と Inno Setup（PowerShell で `ISCC.exe /DAppVersion=X.Y.Z installer\setup.iss`）。
6. 検証: バナーが `MD Viewer vX.Y.Z`、`/`・`/app.js`・`/?popout=1` が200、`MDV_EXE=<mdv.exe> npm test`。installer は試験用コピー（AppId・AppName・DefaultGroupName・アイコン名を変える）でサイレントの install / uninstall（実際のインストールには触れない）。
7. 統括: push の直前に `origin/master..HEAD` の個人情報検査 → `git push origin master` → `git tag -a vX.Y.Z -m "..."` → `git push origin vX.Y.Z` → `gh release create vX.Y.Z <zip> <exe> --title "MD Viewer vX.Y.Z" --notes-file docs/specs/release-vX.Y.Z.md`。
8. `gh release view vX.Y.Z --json isDraft,isPrerelease,assets` で確かめ、「公開済み最新」と §1 の版の表を更新する。

## 7. 検証時の落とし穴

- Browser pane の `window.open` は別ウィンドウにならず同一タブを遷移させる。ポップアウトの同期は `tabs_create` の2タブ（片方を `/?popout=1#/index.md`）で見る。
- コードを変えたら開いている全タブを読み直す（古いタブは `hello` などに応答しない）。ハッシュだけの `navigate` は再読込されない（query を変える）。
- Browser pane が非表示だと `getBoundingClientRect`・`innerHeight` が 0 になり、`requestAnimationFrame` が止まって d3 の遷移が進まない。寸法を除いた署名（要素数・文字・色）で比べる。実際のホイールは反応しないことがある（合成 `WheelEvent` は動く）。d3-zoom のドラッグは `view: window` 付きか実際のマウス操作で。
- Mermaid の SVG 全体のハッシュは class・ER・gitGraph・sankey が描画のたびに変わる（乱数の ID）。比較に使えない。
- 「フォルダを開く」は `window.prompt`。`window.prompt = () => '<絶対パス>'` とスタブしてから `#mdv-open-folder-btn` を押し、後で `localStorage` の `mdv.lastRoot`・`mdv.theme` を消す。
- `read_page` の `filter:"all"` は `display:none` も列挙する。スクリーンショットは30秒でタイムアウトすることがある（DOM で代替）。
- ビルドは `dist/md-viewer-portable-win-x64-vX.Y.Z.zip` を上書きする。試験ビルドは `C:\Build\md-viewer`（クローン。版表記だけ `1.4.2-rc1` のように変える）で行い、公開済みの `dist/` を壊さない。
- Windows では cwd にしているフォルダは消せない。Git Bash で `&` 起動した `mdv.exe` は `kill $!` で終わらないことがある（PowerShell で `Get-NetTCPConnection -LocalPort <port>` から特定して `Stop-Process`）。新しい場所の `mdv.exe`（約91MB）の初回起動は、ウイルス対策の走査で数秒〜6秒以上かかる。
- 配布用の `installer/setup.iss` のまま検証しない（この PC には MD Viewer が実際にインストール済みで、AppId・グループ名・デスクトップアイコン名が同じだと上書き・削除する）。試験用コピーに `/TASKS=` を付ける。
- `core.autocrlf=true`。コミット時の「LF will be replaced by CRLF」は無害。

## 8. 統括への報告（直近の節のみ。読み終えた報告は log へ移す）

### 報告: TODO.md の整理（指示8）

日付: 2026-10-24 / 担当: 05 / ref: `_orders/05.md#指示8`
結果: 済み。TODO.md を 143,113 B（660 行）→ 19,825 B（134 行）。経緯は無変更で `docs/log/TODO_経緯_2026-10-24まで.md`（143,867 B）へ移した。
コミット: `e5d35cb`（整理・log の追加・参照 2 か所の直し）。この報告は次のコミット。push していない。
確認: log の本文は元とバイト単位で一致（先頭の見出し 748 B と相対リンク 2 か所を除く）。個人の情報（パス・ユーザー名・実名・セッション ID・メール）の検査は TODO.md・log とも 0 件。`npm test` 23 件（20 合格・3 スキップ）と `npm audit` 7 件（低）は今日の実測。
直した参照: `docs/DESIGN.md` の「TODO.md の T4」と `test/server-headers.test.js` のコメントの「docs/TODO.md の T13-2」を log に向けた（動作は変えていない）。
残した: 残タスク（T1・T8・T9・T11・T12・T20）、有効な懸念 14 件、決定事項 12 件、手順、落とし穴。log へ移した: 完了タスクの詳細、更新履歴、過去の報告 5 件、将来案 13 件、T5（公開済み）。
運用: 報告は §8 に直近の節だけ置き、読み終えた報告は log へ移す。
