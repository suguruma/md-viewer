import { readFile, writeFile } from 'node:fs/promises'
import { resolveWithin, normalizeRel, isMarkdownPath } from './safe-path.js'
import { invalidateCache } from './render.js'

// 書き込み系APIの共通のパス解決。読み取り専用だったAPIと同じ安全境界(ルート外禁止・.md限定)を適用する。
function resolveMarkdownFile(ctx, relInput) {
  const rel = normalizeRel(relInput)
  if (rel === null || rel === '' || !isMarkdownPath(rel)) {
    const err = new Error('path には .md ファイルを指定してください')
    err.status = 400
    throw err
  }
  const abs = resolveWithin(ctx.root, rel)
  if (!abs) {
    const err = new Error('アクセスできないパスです')
    err.status = 403
    throw err
  }
  return { rel, abs }
}

function assertRange(content, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > content.length) {
    const err = new Error('範囲が不正です')
    err.status = 400
    throw err
  }
}

// チェックボックス([ ]/[x])を1箇所トグルする。
// クライアントは「クリック直前(トグル前)のチェック状態」を渡す。サーバー側で
// 実ファイルの該当範囲が本当にその状態か検証してから書き換える(外部エディタでの
// 同時編集や、表示が古い状態でのクリックによる事故を防ぐ)。
export async function toggleTask(ctx, relInput, start, end, wasChecked) {
  const { rel, abs } = resolveMarkdownFile(ctx, relInput)
  const content = await readFile(abs, 'utf8') // ENOENTは呼び出し側で404に変換
  assertRange(content, start, end)

  const marker = content.slice(start, end)
  const m = /^\[([ xX])\]$/.exec(marker)
  const isChecked = m ? m[1] !== ' ' : null
  if (!m || isChecked !== wasChecked) {
    const err = new Error('内容が変更されています。再読み込みしてください')
    err.status = 409
    throw err
  }

  const next = wasChecked ? '[ ]' : '[x]'
  await writeFile(abs, content.slice(0, start) + next + content.slice(end), 'utf8')
  invalidateCache(rel)
  return { checked: !wasChecked }
}

// サーバー側で許可する装飾の語彙。クライアントには「どの装飾か」だけを送らせ、
// 実際に書き込むマークアップ文字列は常にここで決める(クライアント指定の任意文字列は書き込まない)。
const WRAP_STYLES = {
  strike: { before: '~~', after: '~~' },
  underline: { before: '<u>', after: '</u>' },
}

// 選択範囲のテキストを装飾記法で囲む(打ち消し線・下線)。
// start/end は該当ブロック(段落・見出し)の原文オフセットから逆算した選択範囲。
// expectedText と実ファイルの内容が完全一致する場合のみ書き換える(ズレていれば409)。
export async function wrapSelection(ctx, relInput, start, end, expectedText, style) {
  const wrap = WRAP_STYLES[style]
  if (!wrap) {
    const err = new Error('style が不正です')
    err.status = 400
    throw err
  }
  const { rel, abs } = resolveMarkdownFile(ctx, relInput)
  const content = await readFile(abs, 'utf8')
  assertRange(content, start, end)

  if (!expectedText || content.slice(start, end) !== expectedText) {
    const err = new Error('内容が変更されています。再読み込みしてください')
    err.status = 409
    throw err
  }

  const next = content.slice(0, start) + wrap.before + expectedText + wrap.after + content.slice(end)
  await writeFile(abs, next, 'utf8')
  invalidateCache(rel)
  return {}
}
