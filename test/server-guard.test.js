import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

// 実際にサーバーを起動し、偽の Host / 他サイトの Origin を付けた要求が HTTP・WebSocket の両方で拒否されること、
// 通常の要求は通ることを確かめる(request-guard.js の単体テストでは見えない、組み込みの抜けを防ぐ)。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mdv = path.join(root, 'bin', 'mdv.js')

let docsDir
let otherDir
let main // { port, stop }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// サーバーを子プロセスで起動し、起動バナーの URL からポートを読み取る
async function startMdv(extraArgs = []) {
  const child = spawn(process.execPath, [mdv, docsDir, '--port', String(await freePort()), '--no-open', ...extraArgs], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let output = ''
  child.stderr.on('data', (d) => (output += d))
  const port = await new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message}:\n${output}`))
    }
    const timer = setTimeout(() => fail('サーバーが起動しませんでした'), 30000)
    exited.then((code) => fail(`サーバーが起動前に終了しました(code ${code})`))
    child.stdout.on('data', (d) => {
      output += d
      const m = /URL\s*: http:\/\/127\.0\.0\.1:(\d+)\//.exec(output)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
  })
  return {
    port,
    async stop() {
      child.kill()
      await exited
    },
  }
}

function request(port, { method = 'GET', url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: url,
        headers: {
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (d) => (text += d))
        res.on('end', () => resolve({ status: res.statusCode, text }))
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

const getConfig = async (port) => JSON.parse((await request(port, { url: '/api/config' })).text)

// WebSocket の接続結果: 'open'(接続できた)か、拒否されたときの HTTP ステータス
function connectWs(port, { host, origin }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers: host ? { Host: host } : {} })
    ws.on('open', () => {
      ws.close()
      resolve('open')
    })
    ws.on('unexpected-response', (_req, res) => {
      res.resume()
      resolve(res.statusCode)
    })
    ws.on('error', () => resolve('error'))
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

test('localhost と IP アドレスの Host は通る', async () => {
  for (const host of [`127.0.0.1:${main.port}`, `localhost:${main.port}`]) {
    const res = await request(main.port, { url: '/api/config', headers: { Host: host } })
    assert.equal(res.status, 200, host)
    assert.equal(JSON.parse(res.text).rootPath, docsDir)
  }
  assert.equal((await request(main.port, { url: '/' })).status, 200)
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

test('--allowed-host で許可した名前だけが追加で通る', async () => {
  const server = await startMdv(['--allowed-host', 'mypc'])
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
