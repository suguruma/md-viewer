import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// アプリルートの md-viewer.config.mjs を読み込む(なければ既定値)。
// 設定ミスは黙って無視せず、起動時に明示的に失敗させる。
export async function loadConfig(appRoot) {
  const file = path.join(appRoot, 'md-viewer.config.mjs')
  const base = { remarkPlugins: [], rehypePlugins: [], shiki: {} }
  if (!existsSync(file)) return base

  let mod
  try {
    mod = await import(pathToFileURL(file).href)
  } catch (e) {
    throw new Error(`md-viewer.config.mjs の読み込みに失敗しました: ${e?.message ?? e}`)
  }
  const raw = mod.default ?? {}
  const norm = (list, label) =>
    (list ?? []).map((entry) => {
      const pair = Array.isArray(entry) ? entry : [entry]
      if (typeof pair[0] !== 'function') {
        throw new Error(`md-viewer.config.mjs: ${label} の要素はプラグイン関数(または [関数, オプション])で指定してください`)
      }
      return pair
    })

  return {
    remarkPlugins: norm(raw.remarkPlugins, 'remarkPlugins'),
    rehypePlugins: norm(raw.rehypePlugins, 'rehypePlugins'),
    shiki: raw.shiki ?? {},
  }
}
