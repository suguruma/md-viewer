import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkEmoji from 'remark-emoji'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import rehypeKatex from 'rehype-katex'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import { bundledLanguages } from 'shiki'
import { parse as parseYaml } from 'yaml'
import { resolveWithin, normalizeRel } from './safe-path.js'

// これを超えるファイルは装飾なしのプレーン表示にフォールバックする
const MAX_RENDER_BYTES = 2 * 1024 * 1024
const CACHE_MAX_ENTRIES = 50

const knownLangs = new Set(Object.keys(bundledLanguages))

function textOf(node) {
  if (node.type === 'text') return node.value
  return (node.children ?? []).map(textOf).join('')
}

// YAMLフロントマター(remark-frontmatterが切り出した生テキスト)を解析し file.data.frontmatter に格納する。
// ノード自体は本文から除去する(remark-rehypeの未対応ノード無視挙動に依存しないための明示的な対応)。
function remarkExtractFrontmatter() {
  return (tree, file) => {
    const idx = tree.children.findIndex((n) => n.type === 'yaml')
    if (idx === -1) return
    const raw = tree.children[idx].value
    tree.children.splice(idx, 1)
    try {
      const data = parseYaml(raw)
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        file.data.frontmatter = data
      }
    } catch {
      // 不正なYAMLは無視し、本文のレンダリングは継続する
    }
  }
}

// GFMタスクリストの listItem に、チェックボックス記号([ ]/[x])の原文中の正確な
// 文字オフセットを data-task-start/data-task-end として付与する(<li>に反映される)。
// プレビュー側のクリックから元のMarkdownを書き換えるための位置情報。
function remarkTagTaskCheckboxes() {
  return (tree, file) => {
    const raw = String(file.value)
    visit(tree, 'listItem', (node) => {
      if (node.checked !== true && node.checked !== false) return
      if (!node.position) return
      const start = node.position.start.offset
      const window = raw.slice(start, start + 12)
      const m = /\[[ xX]\]/.exec(window)
      if (!m) return
      const markStart = start + m.index
      const markEnd = markStart + 3
      node.data ??= {}
      node.data.hProperties = {
        ...(node.data.hProperties ?? {}),
        'data-task-start': markStart,
        'data-task-end': markEnd,
      }
    })
  }
}

// 段落・見出しに、原文中の開始/終了オフセットを data-src-start/data-src-end として付与する。
// プレビュー側でのテキスト選択位置を元のMarkdown文字位置に逆算するための土台。
function remarkTagBlockPositions() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'paragraph' && node.type !== 'heading') return
      if (!node.position) return
      node.data ??= {}
      node.data.hProperties = {
        ...(node.data.hProperties ?? {}),
        'data-src-start': node.position.start.offset,
        'data-src-end': node.position.end.offset,
      }
    })
  }
}

// remarkTagTaskCheckboxes が付けた <li> の子 <input type="checkbox"> から disabled を外し、
// クリック操作でチェック状態を変更できるようにする。クラスは委譲イベントの目印。
function rehypeEnableTaskCheckboxes() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'input') return
      if (node.properties?.type !== 'checkbox') return
      delete node.properties.disabled
      const cls = Array.isArray(node.properties.className) ? node.properties.className : []
      node.properties.className = [...cls, 'mdv-task-checkbox']
    })
  }
}

// ```mermaid ブロックを <div class="mermaid-block"><pre class="mermaid-src">…</pre></div> に変換。
// レンダリングはクライアント側(mermaid.js は DOM が必要)。pre はJS無効時のフォールバック表示を兼ねる。
function rehypeMermaidBlocks() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return
      const code = (node.children ?? []).find((c) => c.type === 'element' && c.tagName === 'code')
      if (!code) return
      const cls = code.properties?.className
      if (!Array.isArray(cls) || !cls.includes('language-mermaid')) return
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['mermaid-block'] },
        children: [
          {
            type: 'element',
            tagName: 'pre',
            properties: { className: ['mermaid-src'] },
            children: [{ type: 'text', value: textOf(code).trim() }],
          },
        ],
      }
    })
  }
}

// shiki が知らない言語指定(```hoge 等)はクラスを外してプレーン表示にする。
// 未知言語で例外を出さないための防御。あわせて大文字言語名(```JS)を小文字に正規化。
function rehypeStripUnknownLangs() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'code') return
      const cls = node.properties?.className
      if (!Array.isArray(cls)) return
      const idx = cls.findIndex((c) => typeof c === 'string' && c.startsWith('language-'))
      if (idx === -1) return
      const lang = cls[idx].slice('language-'.length).toLowerCase()
      if (!knownLangs.has(lang)) {
        cls.splice(idx, 1)
        if (cls.length === 0) delete node.properties.className
      } else {
        cls[idx] = 'language-' + lang
      }
    })
  }
}

// 相対リンク・相対画像を書き換える:
//   - 画像: /raw/<解決済みパス> でサーバーから配信
//   - .md へのリンク: #/<パス> のハッシュルーティングでビューア内遷移
//   - その他ファイル: /raw/ で新規タブ表示
function rehypeRewriteLinks() {
  const isRelative = (u) =>
    !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/') && !u.startsWith('#') && !u.startsWith('//')
  const tryDecode = (s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/')

  return (tree, file) => {
    const relDir = file.data.relDir ?? ''
    const resolveRel = (href) => path.posix.normalize(relDir ? `${relDir}/${href}` : href)

    visit(tree, 'element', (node) => {
      const p = node.properties ?? {}
      if (node.tagName === 'img' && typeof p.src === 'string' && isRelative(p.src)) {
        p.src = '/raw/' + encodePath(resolveRel(tryDecode(p.src)))
      }
      if (node.tagName === 'a' && typeof p.href === 'string' && isRelative(p.href)) {
        const hashIdx = p.href.indexOf('#')
        const pathPart = hashIdx === -1 ? p.href : p.href.slice(0, hashIdx)
        const frag = hashIdx === -1 ? '' : p.href.slice(hashIdx + 1)
        if (pathPart === '') return // ページ内アンカーはクライアントで処理
        const resolved = resolveRel(tryDecode(pathPart))
        if (/\.(md|markdown)$/i.test(pathPart)) {
          p.href = '#/' + encodePath(resolved) + (frag ? '#' + frag : '')
        } else {
          p.href = '/raw/' + encodePath(resolved)
          p.target = '_blank'
        }
      }
    })
  }
}

// 見出し(h1〜h6)を収集してアウトライン用データにする。rehype-slug の後に実行すること。
function rehypeCollectHeadings() {
  return (tree, file) => {
    const headings = []
    visit(tree, 'element', (node) => {
      const m = /^h([1-6])$/.exec(node.tagName)
      if (!m) return
      headings.push({
        depth: Number(m[1]),
        id: String(node.properties?.id ?? ''),
        text: textOf(node).trim(),
      })
    })
    file.data.headings = headings
  }
}

// レンダリングパイプライン本体。
// 組み込みの後・stringify の前に md-viewer.config.mjs のユーザープラグインを挿入する。
export function createProcessor(config) {
  const shikiOptions = {
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    ...config.shiki,
  }

  const p = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkExtractFrontmatter)
    .use(remarkGfm)
    .use(remarkEmoji, { accessible: true })
    .use(remarkMath)
    .use(remarkTagTaskCheckboxes)
    .use(remarkTagBlockPositions)

  for (const [fn, opts] of config.remarkPlugins) p.use(fn, opts)

  p.use(remarkRehype, {
    allowDangerousHtml: true,
    footnoteLabel: '脚注',
    footnoteBackLabel: '本文に戻る',
  })
    .use(rehypeRaw)
    .use(rehypeEnableTaskCheckboxes)
    .use(rehypeSlug)
    .use(rehypeKatex, { errorColor: '#d73a49' })
    .use(rehypeMermaidBlocks)
    .use(rehypeStripUnknownLangs)
    .use(rehypeShiki, shikiOptions)
    .use(rehypeRewriteLinks)
    .use(rehypeCollectHeadings)

  for (const [fn, opts] of config.rehypePlugins) p.use(fn, opts)

  p.use(rehypeStringify)
  return p
}

// mtime+size ベースの単純キャッシュ(挿入順で古いものから追い出し)
const cache = new Map()

export function invalidateCache(rel) {
  const norm = normalizeRel(rel)
  if (norm !== null) cache.delete(norm)
}

// ルート切替時など、相対パスキーの意味が変わる場合に全消去する
export function clearCache() {
  cache.clear()
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

export async function renderDoc(ctx, relInput) {
  const rel = normalizeRel(relInput)
  if (rel === null || rel === '') {
    const err = new Error('FORBIDDEN')
    err.status = 403
    throw err
  }
  const abs = resolveWithin(ctx.root, rel)
  if (!abs) {
    const err = new Error('FORBIDDEN')
    err.status = 403
    throw err
  }

  const st = await stat(abs) // ENOENT はルート側で 404 に変換
  const hit = cache.get(rel)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.payload

  const md = await readFile(abs, 'utf8')
  let payload
  if (st.size > MAX_RENDER_BYTES) {
    payload = {
      path: rel,
      html:
        '<div class="mdv-notice">2MB を超えるため装飾なしで表示しています。</div>' +
        `<pre class="mdv-plain">${escapeHtml(md)}</pre>`,
      headings: [],
      frontmatter: null,
      plain: true,
      mtimeMs: st.mtimeMs,
    }
  } else {
    const relDirRaw = path.posix.dirname(rel)
    const relDir = relDirRaw === '.' ? '' : relDirRaw
    const file = await ctx.processor.process({ value: md, data: { relDir } })
    payload = {
      path: rel,
      html: String(file),
      headings: file.data.headings ?? [],
      frontmatter: file.data.frontmatter ?? null,
      plain: false,
      mtimeMs: st.mtimeMs,
    }
  }

  cache.set(rel, { mtimeMs: st.mtimeMs, size: st.size, payload })
  if (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
  return payload
}
