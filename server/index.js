import http from 'node:http'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import express from 'express'
import { WebSocketServer } from 'ws'
import { loadConfig } from './config.js'
import { createProcessor, renderDoc, invalidateCache, clearCache } from './render.js'
import { toggleTask, wrapSelection } from './write.js'
import { buildTree, countFiles, listMarkdownFiles } from './tree.js'
import { searchAll } from './search.js'
import { startWatcher } from './watch.js'
import { resolveWithin, isMarkdownPath } from './safe-path.js'
import { createRequestGuard } from './request-guard.js'
import { securityHeaders } from './security-headers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const { version: appVersion } = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'))

export async function startServer(opts) {
  const {
    targetPath,
    port: basePort = 8931,
    host = '127.0.0.1',
    allowedHosts = [],
    open = true,
    poll = false,
  } = opts

  const absTarget = path.resolve(targetPath)
  const targetStat = await stat(absTarget).catch(() => null)
  if (!targetStat) {
    throw new Error(`パスが見つかりません: ${absTarget}`)
  }
  const initialMode = targetStat.isDirectory() ? 'dir' : 'file'
  if (initialMode === 'file' && !isMarkdownPath(absTarget)) {
    throw new Error(`Markdownファイル(.md / .markdown)を指定してください: ${absTarget}`)
  }

  // クライアントに配るベンダー資産(CDN不使用・オフライン動作)
  const katexDist = path.join(appRoot, 'node_modules', 'katex', 'dist')
  const mermaidDist = path.join(appRoot, 'node_modules', 'mermaid', 'dist')
  const d3Dist = path.join(appRoot, 'node_modules', 'd3', 'dist')
  const markmapViewDist = path.join(appRoot, 'node_modules', 'markmap-view', 'dist', 'browser')
  const markmapLibDist = path.join(appRoot, 'node_modules', 'markmap-lib', 'dist', 'browser')
  if (!existsSync(katexDist) || !existsSync(mermaidDist) || !existsSync(d3Dist) || !existsSync(markmapViewDist) || !existsSync(markmapLibDist)) {
    throw new Error('依存パッケージが見つかりません。先に `npm install` を実行してください。')
  }

  const config = await loadConfig(appRoot)
  const processor = createProcessor(config)
  // root/mode/initialFile はフォルダ切替(POST /api/change-dir)で書き換わる可変状態。
  // 以降のルートハンドラは必ず ctx.xxx 経由で参照し、リクエスト時点の最新値を読むこと。
  const ctx = {
    root: initialMode === 'dir' ? absTarget : path.dirname(absTarget),
    mode: initialMode,
    initialFile: initialMode === 'file' ? path.basename(absTarget) : null,
    processor,
  }

  // shiki の初期化は重い(実測 約4.5秒)ため、起動直後に裏でウォームアップし
  // 最初のドキュメント表示を高速化する。失敗しても実リクエスト時に再初期化される。
  processor.process({ value: '```js\nconst warmup = 1\n```\n$x$\n', data: { relDir: '' } }).catch(() => {})

  // Host / Origin の検査(DNS リバインディング・他サイトからの要求の対策。詳細は request-guard.js)
  const guard = createRequestGuard({ host, allowedHosts })
  const reportedRejections = new Set()
  const logRejection = (verdict) => {
    const key = `${verdict.reason}:${verdict.value}`
    if (reportedRejections.has(key)) return
    if (reportedRejections.size >= 100) reportedRejections.clear()
    reportedRejections.add(key)
    console.warn(`[guard] 拒否: ${verdict.message}`)
  }

  const app = express()
  app.disable('x-powered-by')
  // 以下の 2 つは、静的配信を含むすべてのリクエストの前に置く。ヘッダーは、検査で断る応答にも付ける
  app.use(securityHeaders)
  app.use((req, res, next) => {
    const verdict = guard.check(req)
    if (verdict.ok) return next()
    logRejection(verdict)
    res.status(403).json({ error: verdict.message })
  })
  app.use(express.json({ limit: '10kb' }))
  app.use(express.static(path.join(appRoot, 'public')))
  app.use('/vendor/katex', express.static(katexDist))
  app.use('/vendor/mermaid', express.static(mermaidDist))
  app.use('/vendor/d3', express.static(d3Dist))
  app.use('/vendor/markmap-view', express.static(markmapViewDist))
  app.use('/vendor/markmap-lib', express.static(markmapLibDist))

  app.get('/api/config', (req, res) => {
    res.json({
      mode: ctx.mode,
      rootName: path.basename(ctx.root) || ctx.root,
      rootPath: ctx.root,
      initialFile: ctx.initialFile,
    })
  })

  app.get('/api/tree', async (req, res, next) => {
    try {
      const nodes =
        ctx.mode === 'dir'
          ? await buildTree(ctx.root)
          : [{ type: 'file', name: ctx.initialFile, path: ctx.initialFile }]
      res.json({ nodes, count: countFiles(nodes) })
    } catch (e) {
      next(e)
    }
  })

  app.post('/api/change-dir', async (req, res) => {
    const requested = req.body?.path
    if (typeof requested !== 'string' || requested.trim() === '') {
      return res.status(400).json({ error: 'path を指定してください' })
    }
    if (!path.isAbsolute(requested)) {
      return res.status(400).json({ error: '絶対パスを指定してください' })
    }
    const resolved = path.resolve(requested)
    const st = await stat(resolved).catch(() => null)
    if (!st) return res.status(404).json({ error: '指定されたパスが見つかりません' })
    if (!st.isDirectory()) return res.status(400).json({ error: 'フォルダ(ディレクトリ)を指定してください' })

    ctx.root = resolved
    ctx.mode = 'dir'
    ctx.initialFile = null
    clearCache()
    await restartWatcher(resolved)

    console.log(`[change-dir] ルートを変更しました: ${resolved}`)
    res.json({ mode: ctx.mode, rootName: path.basename(resolved) || resolved, rootPath: resolved })
  })

  app.get('/api/doc', async (req, res) => {
    const rel = String(req.query.path ?? '')
    if (!rel || !isMarkdownPath(rel)) {
      return res.status(400).json({ error: 'path には .md ファイルを指定してください' })
    }
    try {
      res.json(await renderDoc(ctx, rel))
    } catch (e) {
      if (e?.code === 'ENOENT') return res.status(404).json({ error: 'ファイルが見つかりません' })
      if (e?.status === 403) return res.status(403).json({ error: 'アクセスできないパスです' })
      console.error('[render]', rel, e)
      res.status(500).json({ error: String(e?.message ?? e) })
    }
  })

  // プレビューのタスクリストチェックボックスをクリックした際、元のMarkdownの
  // [ ]/[x] を書き換える(このアプリで唯一のファイル書き込み系API)。
  app.post('/api/doc/toggle-task', async (req, res) => {
    const { path: rel, start, end, wasChecked } = req.body ?? {}
    if (typeof rel !== 'string' || typeof wasChecked !== 'boolean') {
      return res.status(400).json({ error: 'path / start / end / wasChecked を指定してください' })
    }
    try {
      const result = await toggleTask(ctx, rel, start, end, wasChecked)
      res.json({ ok: true, ...result })
    } catch (e) {
      if (e?.code === 'ENOENT') return res.status(404).json({ error: 'ファイルが見つかりません' })
      if (e?.status) return res.status(e.status).json({ error: e.message })
      console.error('[toggle-task]', rel, e)
      res.status(500).json({ error: String(e?.message ?? e) })
    }
  })

  // プレビューで選択したテキストをショートカットキーで装飾する(打ち消し線・下線)。
  // start/end はクライアント側で段落/見出しの原文オフセットから逆算した範囲。
  app.post('/api/doc/wrap-selection', async (req, res) => {
    const { path: rel, start, end, expectedText, style } = req.body ?? {}
    if (typeof rel !== 'string' || typeof expectedText !== 'string' || typeof style !== 'string') {
      return res.status(400).json({ error: 'path / start / end / expectedText / style を指定してください' })
    }
    try {
      await wrapSelection(ctx, rel, start, end, expectedText, style)
      res.json({ ok: true })
    } catch (e) {
      if (e?.code === 'ENOENT') return res.status(404).json({ error: 'ファイルが見つかりません' })
      if (e?.status) return res.status(e.status).json({ error: e.message })
      console.error('[wrap-selection]', rel, e)
      res.status(500).json({ error: String(e?.message ?? e) })
    }
  })

  app.get('/api/search', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (q.length < 2) return res.json({ query: q, results: [] })
      const files = ctx.mode === 'file' ? [ctx.initialFile] : null
      const results = await searchAll(ctx.root, q, { files })
      res.json({ query: q, results })
    } catch (e) {
      next(e)
    }
  })

  // 画像などの生ファイル配信(docs ルート配下限定)
  app.use('/raw', async (req, res) => {
    let rel
    try {
      rel = decodeURIComponent(req.path)
    } catch {
      return res.status(400).json({ error: '不正なパスです' })
    }
    const abs = resolveWithin(ctx.root, rel)
    if (!abs) return res.status(403).json({ error: 'アクセスできないパスです' })
    const st = await stat(abs).catch(() => null)
    if (!st || !st.isFile()) return res.status(404).json({ error: 'ファイルが見つかりません' })
    res.sendFile(abs)
  })

  // 未定義のパス。Express 標準の 404 は CSP を `default-src 'none'` に上書きし、frame-ancestors を外してしまうため、自前で返す
  app.use((req, res) => {
    res.status(404).json({ error: '見つかりません' })
  })

  app.use((err, req, res, next) => {
    console.error('[server]', err)
    res.status(500).json({ error: String(err?.message ?? err) })
  })

  const server = http.createServer(app)
  // WebSocket は CORS の対象外で、他サイトのページからも接続できてしまうため、ハンドシェイクで同じ検査をする
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }, done) => {
      const verdict = guard.check(req)
      if (verdict.ok) return done(true)
      logRejection(verdict)
      done(false, 403, 'Forbidden')
    },
  })
  // ws は HTTP サーバーのエラーを WebSocketServer からも再送出する。ポートが使用中のときの listen の失敗(EADDRINUSE)は
  // listenWithRetry が次のポートを試して処理するが、ここに受け手が無いと未処理のエラーでプロセスが落ち、
  // 「使用中なら +1 で起動する」が働かない。EADDRINUSE 以外は握りつぶさず記録する
  wss.on('error', (err) => {
    if (err?.code !== 'EADDRINUSE') console.error('[ws]', err)
  })
  const broadcast = (msg) => {
    const s = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(s)
    }
  }

  const handleDocChanged = (rel) => {
    invalidateCache(rel)
    broadcast({ type: 'doc-changed', path: rel })
  }
  const handleTreeChanged = () => broadcast({ type: 'tree-changed' })

  // フォルダ切替(POST /api/change-dir)のたびに古い監視インスタンスを破棄し、
  // 新しいルート向けに作り直す。
  let watcher = startWatcher({
    watchTarget: ctx.mode === 'dir' ? ctx.root : absTarget,
    root: ctx.root,
    usePolling: poll,
    onDocChanged: handleDocChanged,
    onTreeChanged: handleTreeChanged,
  })

  async function restartWatcher(watchTarget) {
    await watcher.close().catch(() => {})
    watcher = startWatcher({
      watchTarget,
      root: ctx.root,
      usePolling: poll,
      onDocChanged: handleDocChanged,
      onTreeChanged: handleTreeChanged,
    })
  }

  const port = await listenWithRetry(server, host, basePort)
  const url = `http://${host}:${port}/`

  const fileCount = ctx.mode === 'dir' ? countFiles(await buildTree(ctx.root)) : 1
  console.log(`MD Viewer v${appVersion}`)
  console.log(`  モード : ${ctx.mode === 'dir' ? 'フォルダ' : '単一ファイル'}`)
  console.log(`  対象   : ${absTarget}`)
  console.log(`  ファイル: ${fileCount} 件`)
  console.log(`  URL    : ${url}`)
  console.log('  終了   : Ctrl+C')

  if (open) openBrowser(url)

  const shutdown = async () => {
    await watcher.close().catch(() => {})
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return { server, port, url }
}

// 指定ポートが使用中なら +1 しながら最大10ポート試す
async function listenWithRetry(server, host, basePort) {
  for (let p = basePort; p < basePort + 10; p++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (e) => reject(e)
        server.once('error', onError)
        server.listen(p, host, () => {
          server.removeListener('error', onError)
          resolve()
        })
      })
      if (p !== basePort) console.log(`ポート ${basePort} は使用中のため ${p} で起動します`)
      return p
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e
    }
  }
  throw new Error(`空きポートが見つかりません(${basePort}〜${basePort + 9})`)
}

function openBrowser(url) {
  let cmd, args
  if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // ブラウザ起動失敗は致命ではない(URLは表示済み)
  }
}
