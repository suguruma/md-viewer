import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { freePort, startServer, request, getConfig, connectWs, waitFor } from '../test-helpers/server.js'

// 実際にサーバーを起動し、偽の Host / 他サイトの Origin を付けた要求が HTTP・WebSocket の両方で拒否されること、
// 既存の使い方(ブラウザで開く・ポップアウト・--port の指定・ライブリロード)は壊れないことを確かめる
// (request-guard.js の単体テストでは見えない、組み込みの抜けを防ぐ)。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mdv = path.join(root, 'bin', 'mdv.js')

let docsDir
let otherDir
let main // { port, stop }

// node bin/mdv.js を起動する。port を省略すると、空きポートを指定する
async function startMdv({ args = [], port } = {}) {
  return startServer({
    command: process.execPath,
    args: [mdv, docsDir, '--port', String(port ?? (await freePort())), '--no-open', ...args],
    cwd: root,
  })
}

before(async () => {
  docsDir = mkdtempSync(path.join(tmpdir(), 'mdv-guard-docs-'))
  otherDir = mkdtempSync(path.join(tmpdir(), 'mdv-guard-other-'))
  writeFileSync(path.join(docsDir, 'a.md'), '# a\n')
  writeFileSync(path.join(docsDir, 'secret.txt'), 'TOP-SECRET-DUMMY')
  writeFileSync(path.join(otherDir, 'b.md'), '# b\n')
  main = await startMdv()
})

after(async () => {
  await main?.stop()
  rmSync(docsDir, { recursive: true, force: true })
  rmSync(otherDir, { recursive: true, force: true })
})

test('ブラウザでの通常の使い方: localhost・127.0.0.1・[::1] の Host で、画面・ポップアウト・API が取得できる', async () => {
  const urls = [
    '/', '/?popout=1', '/app.js', '/style.css', '/vendor/katex/katex.min.css',
    '/api/config', '/api/tree', '/api/doc?path=a.md', '/api/search?q=secret', '/raw/secret.txt',
  ]
  for (const host of [`127.0.0.1:${main.port}`, `localhost:${main.port}`, `[::1]:${main.port}`]) {
    for (const url of urls) {
      const res = await request(main.port, { url, headers: { Host: host } })
      assert.equal(res.status, 200, `${host} ${url}`)
    }
  }
  const config = await getConfig(main.port)
  assert.equal(config.rootPath, docsDir)
})

test('DNS リバインディング(偽の Host)は、API・静的ファイル・生ファイル・フォルダ切替のすべてで 403 になる', async () => {
  const evil = { Host: `evil.example:${main.port}`, Origin: `http://evil.example:${main.port}` }
  for (const url of ['/', '/app.js', '/api/config', '/api/tree', '/raw/secret.txt', '/vendor/katex/katex.min.css']) {
    assert.equal((await request(main.port, { url, headers: evil })).status, 403, url)
  }
  const change = await request(main.port, { method: 'POST', url: '/api/change-dir', headers: evil, body: { path: otherDir } })
  assert.equal(change.status, 403)
  assert.match(JSON.parse(change.text).error, /--allowed-host/)

  assert.equal((await getConfig(main.port)).rootPath, docsDir, 'ルートが変わっていない')
})

test('他サイトの Origin は、Host が正しくても POST を拒否し、状態を変えない', async () => {
  for (const origin of ['https://evil.example', 'http://127.0.0.1:3000', 'null']) {
    const res = await request(main.port, {
      method: 'POST',
      url: '/api/change-dir',
      headers: { Origin: origin },
      body: { path: otherDir },
    })
    assert.equal(res.status, 403, origin)
  }
  assert.equal((await getConfig(main.port)).rootPath, docsDir)
})

test('同一オリジンの POST は通る(フォルダを切り替えて、元に戻せる)', async () => {
  const origin = `http://127.0.0.1:${main.port}`
  const to = await request(main.port, { method: 'POST', url: '/api/change-dir', headers: { Origin: origin }, body: { path: otherDir } })
  assert.equal(to.status, 200)
  assert.equal((await getConfig(main.port)).rootPath, otherDir)

  const back = await request(main.port, { method: 'POST', url: '/api/change-dir', headers: { Origin: origin }, body: { path: docsDir } })
  assert.equal(back.status, 200)
  assert.equal((await getConfig(main.port)).rootPath, docsDir)
})

test('WebSocket: 偽の Host・他サイトの Origin は拒否し、正しい接続は通る', async () => {
  const sameOrigin = `http://127.0.0.1:${main.port}`
  assert.equal(await connectWs(main.port, {}), 'open')
  assert.equal(await connectWs(main.port, { origin: sameOrigin }), 'open')
  assert.equal(await connectWs(main.port, { origin: 'https://evil.example' }), 403)
  assert.equal(await connectWs(main.port, { host: `evil.example:${main.port}` }), 403)
  assert.equal(
    await connectWs(main.port, { host: `evil.example:${main.port}`, origin: `http://evil.example:${main.port}` }),
    403,
  )
})

test('ライブリロード: 許可された WebSocket 接続に、ファイルの変更が通知される', async () => {
  const ws = new WebSocket(`ws://localhost:${main.port}/ws`, { origin: `http://localhost:${main.port}` })
  const messages = []
  ws.on('message', (data) => messages.push(JSON.parse(String(data))))
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  try {
    writeFileSync(path.join(docsDir, 'a.md'), '# a(変更後)\n')
    await waitFor(() => messages.some((m) => m.type === 'doc-changed' && m.path === 'a.md'))
  } finally {
    ws.close()
  }
})

test('--port の指定: 使用中なら自動で繰り上がり、繰り上がった実際のポートで Host を検査する', async () => {
  const second = await startMdv({ port: main.port }) // main が使用中のポートを指定する
  try {
    assert.notEqual(second.port, main.port)
    for (const host of [`127.0.0.1:${second.port}`, `localhost:${second.port}`]) {
      assert.equal((await request(second.port, { url: '/api/config', headers: { Host: host } })).status, 200, host)
    }
    assert.equal((await request(second.port, { url: '/api/config', headers: { Host: `evil.example:${second.port}` } })).status, 403)
  } finally {
    await second.stop()
  }
})

test('--allowed-host で許可した名前だけが追加で通る', async () => {
  const server = await startMdv({ args: ['--allowed-host', 'mypc'] })
  try {
    assert.equal((await request(server.port, { url: '/api/config', headers: { Host: `mypc:${server.port}` } })).status, 200)
    assert.equal((await request(server.port, { url: '/api/config', headers: { Host: `other:${server.port}` } })).status, 403)
    assert.equal(
      await connectWs(server.port, { host: `mypc:${server.port}`, origin: `http://mypc:${server.port}` }),
      'open',
    )
  } finally {
    await server.stop()
  }
})

test('--allowed-host に不正な値を渡すと、起動に失敗して終了コード 1 を返す', () => {
  const res = spawnSync(process.execPath, [mdv, docsDir, '--allowed-host', 'a/b', '--no-open'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /--allowed-host/)
})

test('--help に --allowed-host の説明が出る', () => {
  const res = spawnSync(process.execPath, [mdv, '--help'], { cwd: root, encoding: 'utf8', timeout: 30000 })
  assert.equal(res.status, 0)
  assert.match(res.stdout, /--allowed-host/)
})
