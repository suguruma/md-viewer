import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'

// 実サーバー(node bin/mdv.js、またはビルド済みの mdv.exe)を子プロセスで起動して試すためのヘルパー。

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// サーバーを子プロセスで起動し、起動バナーの URL から、実際に待ち受けているポートを読み取る
// (使用中のポートを指定したときは、自動で繰り上がった後のポートになる)
export async function startServer({ command, args, cwd, timeoutMs = 30000 }) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let output = ''
  child.stderr.on('data', (d) => (output += d))
  const port = await new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message}:\n${output}`))
    }
    const timer = setTimeout(() => fail('サーバーが起動しませんでした'), timeoutMs)
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
    output: () => output,
    async stop() {
      child.kill()
      await exited
    },
  }
}

// Host ヘッダーは headers で自由に上書きできる(接続先は常に 127.0.0.1)
export function request(port, { method = 'GET', url, headers = {}, body }) {
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

export const getConfig = async (port) => JSON.parse((await request(port, { url: '/api/config' })).text)

// WebSocket の接続結果: 'open'(接続できた)か、拒否されたときの HTTP ステータス
export function connectWs(port, { host, origin }) {
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

// 条件が満たされるまで待つ(満たされなければ例外)
export async function waitFor(condition, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`${timeoutMs}ms 以内に条件が満たされませんでした`)
}
