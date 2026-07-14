#!/usr/bin/env node
// ポータブル版exeのビルドスクリプト。
// mdv.exe(Node SEA)+ app/(server, public, sample, 依存パッケージ) を dist/portable/ に組み立て、
// zip に固める。Windows専用(signtool/postjectの都合、対象もWin x64)。
import { existsSync, mkdirSync, rmSync, cpSync, copyFileSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

const distDir = path.join(root, 'dist')
const portableDir = path.join(distDir, 'portable')
const appDir = path.join(portableDir, 'app')

// mermaid / markmap-lib / markmap-view はいずれもサーバーコードから require/import されず、
// ビルド済みの dist 配下を express.static で静的配信されるだけ(server/index.js 参照)。
// 実際に配信するファイル(mermaid.min.js、d3の dist、markmap-lib/markmap-view の dist/browser)
// 以外の、ビルド専用の巨大な依存(@mermaid-js, cytoscape*, dompurify, es-toolkit, d3-*サブパッケージ,
// markdown-it/highlight.js/prismjs等)はポータブル版から除外し、必要ファイルだけ個別配置する
// (npm ls で mermaid/markmap以外から参照されないことを確認済み)。
const EXCLUDE_DIRS = new Set([
  '@mermaid-js', 'cytoscape', 'cytoscape-fcose', 'dompurify', 'es-toolkit', 'mermaid',
  'd3', 'd3-array', 'd3-axis', 'd3-brush', 'd3-chord', 'd3-color', 'd3-contour', 'd3-delaunay',
  'd3-dispatch', 'd3-drag', 'd3-dsv', 'd3-ease', 'd3-fetch', 'd3-force', 'd3-format', 'd3-geo',
  'd3-hierarchy', 'd3-interpolate', 'd3-path', 'd3-polygon', 'd3-quadtree', 'd3-random',
  'd3-sankey', 'd3-scale', 'd3-scale-chromatic', 'd3-selection', 'd3-shape', 'd3-time',
  'd3-time-format', 'd3-timer', 'd3-transition', 'd3-zoom',
  'markmap-lib', 'markmap-view', 'markmap-common', 'markmap-html-parser',
  'markdown-it', 'markdown-it-ins', 'markdown-it-mark', 'markdown-it-sub', 'markdown-it-sup',
  '@vscode', 'highlight.js', 'prismjs',
  '@types', '.bin', '.package-lock.json',
])

function log(msg) {
  console.log(`[build-portable] ${msg}`)
}

function run(cmd, args, opts = {}) {
  log(`> ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
}

function dirSizeMB(dir) {
  let total = 0
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else total += st.size
    }
  }
  walk(dir)
  return Math.round((total / 1024 / 1024) * 10) / 10
}

// 一般ユーザー向けの「はじめにお読みください」テキスト。
// ポータブル版・インストーラー版のどちらでも通用するよう、起動方法は両方を併記する。
function buildReadMeFirstText(version) {
  return `MD Viewer(バージョン ${version})をご利用いただきありがとうございます
========================================

これは、お手元のパソコンにある Markdown ファイル(.md)を、きれいに整形して
読むための「閲覧専用」アプリです。インターネット接続やアカウント登録は不要です。

----------------------------------------
■ 起動方法
----------------------------------------

・インストーラー版をお使いの場合
  デスクトップまたはスタートメニューの「MD Viewer」アイコンをダブルクリック
  してください。

・ポータブル版(zipを解凍しただけ)をお使いの場合
  フォルダ内の mdv.exe をダブルクリックしてください。

どちらも、最初は同梱のサンプルが表示されます。
起動すると既定のブラウザでアプリの画面が自動的に開きます。同時に黒い
ウィンドウ(コマンドプロンプトのような画面)も表示されますが、これは
アプリを動かすための画面です。閉じないでください。

----------------------------------------
■ 自分のノート・メモを開く
----------------------------------------

サンプルではなく、自分の Markdown ファイルが入ったフォルダを見たい場合:

  1. 画面左上の「フォルダを開く」ボタンをクリック
  2. フォルダの場所(例: C:\\Users\\自分の名前\\Documents\\notes)を入力してOK

一度開くと、次回からダブルクリックするだけで同じフォルダが自動的に
開きます(前回開いていた場所を記憶します)。

フォルダの代わりに、mdv.exe のアイコンに Markdown ファイルやフォルダを
直接ドラッグ&ドロップしても開けます。

----------------------------------------
■ 終了方法
----------------------------------------

ブラウザのタブを閉じるだけでなく、起動時に表示された黒いウィンドウも
閉じてください(またはその画面で Ctrl+C を押してください)。
黒いウィンドウを閉じないと、アプリはバックグラウンドで動き続けます。

----------------------------------------
■ 主な機能
----------------------------------------

・左側のツリーからファイルを切り替えて閲覧(矢印キーでも操作できます)
・画面右上のボタンでダーク/ライトモード切替
・ページ内検索(ツールバーの検索欄、または「/」キー)
・フォルダ横断検索(左側の検索欄)
・図(Mermaid)・数式(KaTeX)・絵文字・シンタックスハイライトに対応
・見出しやリストをマインドマップとして俯瞰表示(ツールバーのボタンで切替)
・タスクリストのチェックボックスは画面上でクリックしてオン/オフを切替可能
  (元のファイルの [ ]/[x] が書き換わります)
・プレビュー上でテキストを選択し、Ctrl+Shift+X で打ち消し線、
  Ctrl+Shift+U で下線を付与(単一の段落・見出し内の選択のみ対応)
・ファイルを保存すると自動で画面が更新される(ライブリロード)
・印刷・PDF保存にも対応(ブラウザの印刷機能をお使いください)

----------------------------------------
■ ご注意
----------------------------------------

・初回起動時に「Windows によって PC が保護されました」という警告が表示
  される場合があります。これは個人が配布している未署名のソフトのため
  表示されるもので、ウイルス等ではありません。
  「詳細情報」→「実行」を選択すると起動できます。

・このアプリは基本的に閲覧用です。上記のチェックボックス操作と
  打ち消し線・下線のショートカット以外に、ファイルを書き換える機能は
  ありません(自由な文章の編集や保存には、お使いのテキストエディタを
  ご利用ください)。

・表示できるのは、お使いのパソコン内でこのアプリが読み取れるファイルの
  みです。社外・社内ネットワークなど外部からアクセスできる設定
  (--host オプション)で起動する場合は、フォルダ内の全ファイルが他の
  人からも読める状態になるため注意してください(通常の使い方であれば
  問題ありません)。

----------------------------------------
■ アンインストール方法(インストーラー版のみ)
----------------------------------------

Windows の「設定」→「アプリ」→「インストールされているアプリ」から
「MD Viewer」を選び、「アンインストール」を選択してください。
インストールフォルダ内の unins000.exe を直接実行しても構いません。

ポータブル版は、フォルダごと削除するだけでアンインストールできます。

----------------------------------------
■ 不具合の報告・ご意見
----------------------------------------

https://github.com/suguruma/md-viewer/issues

開発者向けの詳しい情報(README、機能仕様書など)は以下から確認できます。
https://github.com/suguruma/md-viewer
`
}

function findSigntool() {
  const bases = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin',
  ]
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const ver of readdirSync(base)) {
      const p = path.join(base, ver, 'x64', 'signtool.exe')
      if (existsSync(p)) return p
    }
  }
  return null
}

// ---------- 1. クリーン ----------
log('dist/portable をクリーンアップ')
rmSync(portableDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })
mkdirSync(path.join(distDir), { recursive: true })

// ---------- 2. SEA blob 生成 ----------
log('SEA blob を生成')
run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'])

// ---------- 3. node.exe を複製し mdv.exe を作成 ----------
const mdvExe = path.join(portableDir, 'mdv.exe')
copyFileSync(process.execPath, mdvExe)
log(`node.exe を複製: ${process.execPath} -> ${mdvExe}`)

const signtool = findSigntool()
if (signtool) {
  try {
    run(signtool, ['remove', '/s', mdvExe])
    log('元の署名を除去しました(postject推奨手順)')
  } catch {
    log('署名除去に失敗しましたが続行します(postjectは無署名exeにも注入可能)')
  }
} else {
  log('signtool が見つからないため署名除去をスキップ(動作に支障なし)')
}

// ---------- 4. postject で blob を注入 ----------
// Windows の npx.cmd はバッチファイルのため shell 経由でないと EINVAL になる。
// 引数はすべて本スクリプト内で組み立てた固定値(パスに空白なし)でユーザー入力を含まないため、
// shell:true によるエスケープ省略のリスクはない。
run('npx', [
  '--yes', 'postject',
  mdvExe, 'NODE_SEA_BLOB', 'build/sea-prep.blob',
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  '--overwrite',
], { shell: true })

// ---------- 5. app/ 一式をコピー ----------
log('app/ 一式をコピー')
for (const name of ['bin', 'server', 'public', 'sample', 'md-viewer.config.mjs', 'package.json', 'README.md', 'README.ja.md', 'LICENSE']) {
  const src = path.join(root, name)
  if (!existsSync(src)) continue
  const dest = path.join(appDir, name)
  cpSync(src, dest, { recursive: true })
}

log('node_modules をコピー(mermaid関連の巨大な未使用ファイルは除外)')
cpSync(path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src)
    if (EXCLUDE_DIRS.has(base)) return false
    return true
  },
})
// mermaid は実配信に使う mermaid.min.js だけを個別配置する
mkdirSync(path.join(appDir, 'node_modules', 'mermaid', 'dist'), { recursive: true })
copyFileSync(
  path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
  path.join(appDir, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
)
// d3 / markmap-view / markmap-lib も、server/index.js が実際に static 配信するディレクトリ
// (d3の dist 一式、markmap-view・markmap-lib の dist/browser)だけを個別配置する
cpSync(
  path.join(root, 'node_modules', 'd3', 'dist'),
  path.join(appDir, 'node_modules', 'd3', 'dist'),
  { recursive: true },
)
cpSync(
  path.join(root, 'node_modules', 'markmap-view', 'dist', 'browser'),
  path.join(appDir, 'node_modules', 'markmap-view', 'dist', 'browser'),
  { recursive: true },
)
cpSync(
  path.join(root, 'node_modules', 'markmap-lib', 'dist', 'browser'),
  path.join(appDir, 'node_modules', 'markmap-lib', 'dist', 'browser'),
  { recursive: true },
)

// ---------- 6. 一般ユーザー向けの説明書き ----------
writeFileSync(
  path.join(portableDir, 'はじめにお読みください.txt'),
  buildReadMeFirstText(version),
)

// sample フォルダを exe と同じ階層からも辿れるよう、ダブルクリック起動時の
// 既定パス(カレントディレクトリ)を sample に向ける薄いランチャーを用意する。
writeFileSync(
  path.join(portableDir, 'Open Sample (サンプルを開く).bat'),
  `@echo off\r\n"%~dp0mdv.exe" "%~dp0app\\sample" %*\r\n`,
)

// ---------- 7. zip ----------
const zipName = `md-viewer-portable-win-x64-v${version}.zip`
const zipPath = path.join(distDir, zipName)
rmSync(zipPath, { force: true })
log(`zip 作成: ${zipName}`)
run('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${portableDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`,
])

const finalMB = dirSizeMB(portableDir)
const zipMB = Math.round((statSync(zipPath).size / 1024 / 1024) * 10) / 10
log(`完了: dist/portable (${finalMB} MB) / ${zipName} (${zipMB} MB)`)
