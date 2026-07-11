import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { listMarkdownFiles } from './tree.js'

const MAX_TOTAL_MATCHES = 200
const MAX_MATCHES_PER_FILE = 5
const MAX_FILE_SIZE = 5 * 1024 * 1024

// 全 .md ファイルの逐次スキャン(大文字小文字を無視した部分一致)。
// 数百ファイル×数十KB規模なら索引なしで実用速度が出る前提。実測は PROCESS.md 参照。
export async function searchAll(root, query, { files = null } = {}) {
  const q = String(query).toLowerCase()
  const targets = files ?? (await listMarkdownFiles(root))
  const results = []
  let total = 0

  for (const rel of targets) {
    if (total >= MAX_TOTAL_MATCHES) break
    let text
    try {
      const abs = path.join(root, rel)
      const st = await stat(abs)
      if (st.size > MAX_FILE_SIZE) continue
      text = await readFile(abs, 'utf8')
    } catch {
      continue
    }
    const lower = text.toLowerCase()
    if (!lower.includes(q)) continue

    const lines = text.split(/\r?\n/)
    const matches = []
    let totalInFile = 0
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase()
      let idx = lineLower.indexOf(q)
      if (idx === -1) continue
      // 行内の出現数もカウント
      while (idx !== -1) {
        totalInFile++
        idx = lineLower.indexOf(q, idx + q.length)
      }
      if (matches.length < MAX_MATCHES_PER_FILE) {
        matches.push({ line: i + 1, snippet: makeSnippet(lines[i], lineLower.indexOf(q), q.length) })
      }
    }
    results.push({ path: rel, matches, total: totalInFile })
    total += matches.length
  }
  return results
}

function makeSnippet(line, idx, len) {
  const before = 40
  const after = 80
  const start = Math.max(0, idx - before)
  const end = Math.min(line.length, idx + len + after)
  let s = line.slice(start, end).trim()
  if (start > 0) s = '…' + s
  if (end < line.length) s = s + '…'
  return s
}
