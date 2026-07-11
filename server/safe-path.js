import path from 'node:path'

// クライアントから受け取った相対パスを docs ルート配下に限定して解決する。
// ルート外へ抜ける場合は null を返す(パストラバーサル対策)。
export function resolveWithin(root, rel) {
  const cleaned = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const abs = path.resolve(root, cleaned)
  const rootNorm = path.resolve(root)
  if (abs === rootNorm) return abs
  if (!abs.startsWith(rootNorm + path.sep)) return null
  return abs
}

// OS依存の区切りを URL/API 用の posix 形式に揃える
export function toPosix(p) {
  return p.split(path.sep).join('/')
}

// 'a/b/../c' → 'c' などを正規化。ルート外('..'開始)なら null。
export function normalizeRel(rel) {
  const cleaned = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const norm = path.posix.normalize(cleaned)
  if (norm === '..' || norm.startsWith('../')) return null
  return norm === '.' ? '' : norm
}

export function isMarkdownPath(p) {
  return /\.(md|markdown)$/i.test(p)
}
