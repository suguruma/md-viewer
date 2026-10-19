import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, startServer, request, getConfig, connectWs } from '../test-helpers/server.js'

// ビルド済みの mdv.exe(Node SEA)でも、Host / Origin の検査と通常の使い方が同じように動くことを確かめる。
// 既定は dist/portable/mdv.exe。別の場所の exe は、環境変数 MDV_EXE で指定する
// (例: MDV_EXE=C:\Build\md-viewer\dist\portable\mdv.exe npm test)。
// exe が無い、または検査を含まない古い版(app/server/request-guard.js が無い)のときは、スキップする。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.env.MDV_EXE ?? path.join(root, 'dist', 'portable', 'mdv.exe')
const exeDir = path.dirname(exe)

let skip = false
if (!existsSync(exe)) skip = `ビルド済みの exe が無い(${exe})`
else if (!existsSync(path.join(exeDir, 'app', 'server', 'request-guard.js'))) {
  skip = 'Host / Origin の検査を含まない古い版の exe(app/server/request-guard.js が無い)'
}

test('ビルド済みの mdv.exe: 通常の使い方は通り、偽の Host・他サイトの Origin は拒否される', { skip }, async () => {
  const server = await startServer({
    command: exe,
    args: [path.join(exeDir, 'app', 'sample'), '--port', String(await freePort()), '--no-open'],
    cwd: exeDir,
    timeoutMs: 90000, // 新しい場所に置いた exe の初回起動は、ウイルス対策ソフトの走査で遅いことがある
  })
  try {
    const p = server.port
    for (const host of [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]) {
      for (const url of ['/', '/?popout=1', '/app.js', '/api/config', '/api/tree', '/api/doc?path=index.md', '/raw/assets/logo.svg']) {
        assert.equal((await request(p, { url, headers: { Host: host } })).status, 200, `${host} ${url}`)
      }
    }

    const evil = { Host: `evil.example:${p}`, Origin: `http://evil.example:${p}` }
    for (const url of ['/', '/api/config', '/raw/assets/logo.svg']) {
      assert.equal((await request(p, { url, headers: evil })).status, 403, url)
    }
    const before = (await getConfig(p)).rootPath
    const change = await request(p, { method: 'POST', url: '/api/change-dir', headers: evil, body: { path: 'C:/Windows' } })
    assert.equal(change.status, 403)
    const crossSite = await request(p, {
      method: 'POST',
      url: '/api/change-dir',
      headers: { Origin: 'https://evil.example' },
      body: { path: 'C:/Windows' },
    })
    assert.equal(crossSite.status, 403)
    assert.equal((await getConfig(p)).rootPath, before, 'ルートが変わっていない')

    assert.equal(await connectWs(p, {}), 'open')
    assert.equal(await connectWs(p, { origin: `http://127.0.0.1:${p}` }), 'open')
    assert.equal(await connectWs(p, { origin: 'https://evil.example' }), 403)
    assert.equal(await connectWs(p, { host: `evil.example:${p}` }), 403)
  } finally {
    await server.stop()
  }
})

test('ビルド済みの mdv.exe: --help に --allowed-host の説明が出る', { skip }, () => {
  const res = spawnSync(exe, ['--help'], { cwd: exeDir, encoding: 'utf8', timeout: 90000 })
  assert.equal(res.status, 0)
  assert.match(res.stdout, /--allowed-host/)
})
