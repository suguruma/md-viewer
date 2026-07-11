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

// mermaid はサーバーコードから require/import されず、静的配信されるだけ(server/index.js 参照)。
// 実体は mermaid.min.js の1ファイルのみで十分なため、mermaid本体+専用の巨大な依存(@mermaid-js,
// cytoscape*, d3, dompurify, es-toolkit)はポータブル版から除外し、必要ファイルだけ個別配置する。
const EXCLUDE_DIRS = new Set(['@mermaid-js', 'cytoscape', 'cytoscape-fcose', 'd3', 'dompurify', 'es-toolkit', '@types', 'mermaid', '.bin', '.package-lock.json'])

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

// ---------- 6. ポータブル版の説明書き ----------
writeFileSync(
  path.join(portableDir, 'README-portable.txt'),
  `MD Viewer ${version} — Portable / ポータブル版
========================================

[日本語]
インストール不要でそのまま動きます。

使い方:
  1. mdv.exe をダブルクリック
     -> このフォルダを起点に "sample" フォルダのサンプルが表示されます。
  2. 自分の Markdown フォルダ、または .md ファイルを mdv.exe の
     アイコンにドラッグ&ドロップすると、そのフォルダ/ファイルが開きます。
  3. コマンドラインから使う場合:
       mdv.exe "C:\\path\\to\\notes"
       mdv.exe "C:\\path\\to\\notes\\memo.md"
       mdv.exe --help

初回起動時に Windows SmartScreen の警告が出ることがあります(未署名の
個人配布ソフトのため)。「詳細情報」→「実行」で起動できます。

同梱の app フォルダは削除・移動しないでください(mdv.exe が参照します)。

[English]
No installation required.

Usage:
  1. Double-click mdv.exe
     -> Opens the bundled "sample" folder relative to this location.
  2. Drag & drop your own Markdown folder or .md file onto the mdv.exe
     icon to open it directly.
  3. From a terminal:
       mdv.exe "C:\\path\\to\\notes"
       mdv.exe "C:\\path\\to\\notes\\memo.md"
       mdv.exe --help

Windows SmartScreen may warn on first launch because this is an
unsigned, independently distributed binary. Click "More info" ->
"Run anyway" to proceed.

Do not move or delete the "app" folder next to mdv.exe; it is required
at runtime.
`,
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
