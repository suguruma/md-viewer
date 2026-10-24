import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, startServer, request, assertSecurityHeaders } from '../test-helpers/server.js'

// 他サイトのページの <script>・<img> による読み込みには Origin が付かず、request-guard の Host / Origin の検査を通ってしまう。
// それをブラウザに止めさせる応答ヘッダー(Cross-Origin-Resource-Policy)と、<iframe> への埋め込みを止めるヘッダー
// (frame-ancestors)が、すべての応答に付くことを固定する。実際に遮断するのはブラウザなので、ここで確かめるのはヘッダーまで
// (遮断そのものは、実ブラウザでの確認。docs/log/TODO_経緯_2026-10-24まで.md の T13-2)。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mdv = path.join(root, 'bin', 'mdv.js')

let docsDir
let server // { port, stop }

before(async () => {
  docsDir = mkdtempSync(path.join(tmpdir(), 'mdv-headers-docs-'))
  writeFileSync(path.join(docsDir, 'a.md'), '# a\n')
  writeFileSync(path.join(docsDir, 'secret.txt'), 'TOP-SECRET-DUMMY')
  server = await startServer({
    command: process.execPath,
    args: [mdv, docsDir, '--port', String(await freePort()), '--no-open'],
    cwd: root,
  })
})

after(async () => {
  await server?.stop()
  rmSync(docsDir, { recursive: true, force: true })
})

test('静的ファイル・API・生ファイル・エラーの、すべての応答に CORP と frame-ancestors が付く', async () => {
  const cases = [
    // 200: 画面・ポップアウト・静的ファイル・ベンダー資産・API・生ファイル
    ['/', 200],
    ['/?popout=1', 200],
    ['/app.js', 200],
    ['/style.css', 200],
    ['/vendor/katex/katex.min.css', 200],
    ['/api/config', 200],
    ['/api/tree', 200],
    ['/api/doc?path=a.md', 200],
    ['/api/search?q=a', 200],
    ['/raw/secret.txt', 200],
    // エラー応答にも付く(付かないと、ファイルの有無が onload / onerror の違いで他サイトに分かってしまう)
    ['/api/doc?path=a.txt', 400],
    ['/raw/%E0%A4%A', 400],
    ['/raw/..%2F..%2Fsecret.txt', 403],
    ['/raw/none.txt', 404],
    ['/api/doc?path=none.md', 404],
    ['/no-such-page', 404],
  ]
  for (const [url, status] of cases) {
    const res = await request(server.port, { url })
    assert.equal(res.status, status, url)
    assertSecurityHeaders(res, `${status} ${url}`)
  }
})

test('Host・Origin の検査で断った 403 にも付く', async () => {
  const evilHost = { Host: `evil.example:${server.port}` }
  for (const url of ['/', '/app.js', '/api/config', '/raw/secret.txt']) {
    const res = await request(server.port, { url, headers: evilHost })
    assert.equal(res.status, 403, url)
    assertSecurityHeaders(res, `403(Host) ${url}`)
  }
  const crossSite = await request(server.port, {
    method: 'POST',
    url: '/api/change-dir',
    headers: { Origin: 'https://evil.example' },
    body: { path: docsDir },
  })
  assert.equal(crossSite.status, 403)
  assertSecurityHeaders(crossSite, '403(Origin) POST /api/change-dir')
})

test('304(変更なし)の応答にも付く', async () => {
  const first = await request(server.port, { url: '/app.js' })
  assert.equal(first.status, 200)
  assert.ok(first.headers.etag, 'ETag が付く')
  const second = await request(server.port, { url: '/app.js', headers: { 'If-None-Match': first.headers.etag } })
  assert.equal(second.status, 304)
  assertSecurityHeaders(second, '304 /app.js')
})
