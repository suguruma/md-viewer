// MD Viewer プラグイン設定
//
// remark(Markdown構文木)/ rehype(HTML構文木)のプラグインを、
// アプリ本体のコードを変更せずにここへ追加できる。
// 要素は「プラグイン関数」または「[プラグイン関数, オプション]」。
//
// 絵文字ショートコード(:smile: など)は remark-emoji によって標準で有効。
//
// npm パッケージのプラグインを使う例:
//   1) このフォルダで `npm install remark-github`
//   2) 先頭に `import remarkGithub from 'remark-github'` を追加
//   3) remarkPlugins: [[remarkGithub, { repository: 'owner/repo' }]] に追加
//
// 実行位置: 組み込みプラグイン(GFM/絵文字/数式/ハイライト等)の後、HTML出力の直前。

// 動作実証用の自作プラグイン: 外部リンク(http/https)を新規タブで開く
function rehypeExternalLinksNewTab() {
  return (tree) => {
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'a') {
        const href = String(node.properties?.href ?? '')
        if (/^https?:\/\//i.test(href)) {
          node.properties.target = '_blank'
          node.properties.rel = ['noopener', 'noreferrer']
          const cls = node.properties.className
          node.properties.className = Array.isArray(cls) ? [...cls, 'external-link'] : ['external-link']
        }
      }
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
  }
}

export default {
  remarkPlugins: [],
  rehypePlugins: [rehypeExternalLinksNewTab],

  // シンタックスハイライトのテーマ変更例(shiki のテーマ名):
  // shiki: { themes: { light: 'vitesse-light', dark: 'vitesse-dark' } },
  shiki: {},
}
