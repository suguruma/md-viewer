import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { isMarkdownPath } from './safe-path.js'

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

// docs ルート配下の .md をツリー構造で返す。
// - ドットで始まるファイル/フォルダと node_modules は除外
// - .md を1つも含まないフォルダは枝刈り
export async function buildTree(root) {
  async function walk(absDir, relDir) {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }
    const dirNames = []
    const fileNames = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue
        dirNames.push(e.name)
      } else if (e.isFile() && isMarkdownPath(e.name)) {
        fileNames.push(e.name)
      }
    }
    dirNames.sort(collator.compare)
    fileNames.sort(collator.compare)

    const nodes = []
    for (const d of dirNames) {
      const rel = relDir ? `${relDir}/${d}` : d
      const children = await walk(path.join(absDir, d), rel)
      if (children.length > 0) {
        nodes.push({ type: 'dir', name: d, path: rel, children })
      }
    }
    for (const f of fileNames) {
      nodes.push({ type: 'file', name: f, path: relDir ? `${relDir}/${f}` : f })
    }
    return nodes
  }
  return walk(root, '')
}

export function countFiles(nodes) {
  let n = 0
  for (const node of nodes) {
    n += node.type === 'dir' ? countFiles(node.children) : 1
  }
  return n
}

// 横断検索用のフラットな相対パス一覧
export async function listMarkdownFiles(root) {
  const out = []
  const rec = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'dir') rec(n.children)
      else out.push(n.path)
    }
  }
  rec(await buildTree(root))
  return out
}
