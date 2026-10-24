import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, startServer, request, getConfig } from '../test-helpers/server.js'

// 同梱の sample/ を開いてサーバーを起動し、主な API が期待どおり応答すること
// (ツリー、Markdown・KaTeX・Shiki の描画、.md 以外・ルート外・存在しないファイルの扱い)を確かめる。
// 描画のパイプライン(remark/rehype のプラグイン)の組み込みが壊れていないかを見る、粗い回帰テスト。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mdv = path.join(root, 'bin', 'mdv.js')

let server // { port, stop }

before(async () => {
  server = await startServer({
    command: process.execPath,
    args: [mdv, path.join(root, 'sample'), '--port', String(await freePort()), '--no-open'],
    cwd: root,
  })
})

after(async () => {
  await server?.stop()
})

const getJson = async (url) => {
  const res = await request(server.port, { url })
  return { status: res.status, json: JSON.parse(res.text) }
}

test('トップページが HTML を返す', async () => {
  const res = await request(server.port, { url: '/' })
  assert.equal(res.status, 200)
  assert.match(res.text, /<html/)
})

test('フォルダを開いたときの設定とファイルツリー', async () => {
  assert.equal((await getConfig(server.port)).mode, 'dir')
  const { status, json } = await getJson('/api/tree')
  assert.equal(status, 200)
  assert.ok(json.count > 0, 'ファイル数が 0')
})

test('Markdown・数式（KaTeX）・コード（Shiki）が描画される', async () => {
  for (const [file, marker] of [
    ['index.md', '<h1'],
    ['math.md', 'katex'],
    ['code.md', 'shiki'],
  ]) {
    const { status, json } = await getJson(`/api/doc?path=${file}`)
    assert.equal(status, 200, file)
    assert.ok(json.html.includes(marker), `${file} に ${marker} が無い`)
  }
})

test('.md 以外・ルート外・存在しないファイルを、それぞれ 400・403・404 で断る', async () => {
  assert.equal((await getJson('/api/doc?path=../package.json')).status, 400)
  assert.equal((await getJson('/api/doc?path=../README.md')).status, 403)
  assert.equal((await getJson('/api/doc?path=no-such-file.md')).status, 404)
})
