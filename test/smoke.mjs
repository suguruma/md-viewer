// スモークテスト: sample/ を開いてサーバを起動し、主要な API が期待どおり応答するかを確かめる。
// 依存パッケージを追加せず、Windows と Linux の両方で動くように Node 標準機能だけで書く。
// 使い方: node test/smoke.mjs
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 18931
const base = `http://127.0.0.1:${port}`

const server = spawn(process.execPath, ['bin/mdv.js', 'sample', '--port', String(port), '--no-open'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/config`)
      if (res.ok) return
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`サーバが ${timeoutMs}ms 以内に起動しませんでした\n${serverLog}`)
}

const failures = []
async function check(name, url, expectStatus, inspect) {
  const res = await fetch(base + url)
  const body = await res.text()
  let problem = null
  if (res.status !== expectStatus) {
    problem = `status ${res.status}（期待値 ${expectStatus}）`
  } else if (inspect) {
    problem = inspect(body)
  }
  if (problem) failures.push(`${name}: ${problem}`)
  console.log(`${problem ? 'NG' : 'OK'}  ${name}`)
}

const json = (body) => JSON.parse(body)

try {
  await waitForServer()

  await check('トップページ', '/', 200, (b) => (b.includes('<html') ? null : 'HTML が返っていない'))
  await check('設定', '/api/config', 200, (b) => (json(b).mode === 'dir' ? null : 'mode が dir ではない'))
  await check('ファイルツリー', '/api/tree', 200, (b) => (json(b).count > 0 ? null : 'ファイル数が 0'))
  await check('Markdown の描画', '/api/doc?path=index.md', 200, (b) =>
    json(b).html.includes('<h1') ? null : '見出しが描画されていない',
  )
  await check('数式の描画（KaTeX）', '/api/doc?path=math.md', 200, (b) =>
    json(b).html.includes('katex') ? null : 'KaTeX の出力がない',
  )
  await check('コードの色付け（Shiki）', '/api/doc?path=code.md', 200, (b) =>
    json(b).html.includes('shiki') ? null : 'Shiki の出力がない',
  )
  await check('.md 以外は拒否', '/api/doc?path=../package.json', 400)
  await check('ルート外へのアクセスは拒否', '/api/doc?path=../README.md', 403)
  await check('存在しないファイル', '/api/doc?path=no-such-file.md', 404)
} catch (e) {
  failures.push(String(e?.stack ?? e))
} finally {
  server.kill()
}

if (failures.length > 0) {
  console.error(`\n失敗 ${failures.length} 件:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\nすべて成功')
