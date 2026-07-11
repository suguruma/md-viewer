---
title: MD Viewer サンプル
tags: [demo, markdown]
created: 2026-01-15
author: suguruma
---

# MD Viewer サンプル

このフォルダは MD Viewer の全機能を確認するためのサンプル集です。
左のツリーからファイルを切り替えられます。

![ロゴ](assets/logo.svg)

## 収録ファイル

| ファイル | 確認できる機能 |
| --- | --- |
| [code.md](code.md) | シンタックスハイライト、コピー機能 |
| [mermaid.md](mermaid.md) | Mermaid ダイアグラム |
| [math.md](math.md) | KaTeX 数式 |
| [notes/tips.md](notes/tips.md) | 相対リンク、階層ナビゲーション |

## GFM(GitHub Flavored Markdown)

### タスクリスト

- [x] 単一ファイルモード
- [x] フォルダツリー表示
- [x] ライブリロード
- [ ] 将来: プラグインをもっと追加する

### 打ち消し線・自動リンク

~~この行は取り消し済み~~ で、URL は自動でリンクになります: https://github.github.com/gfm/

外部リンクは新規タブで開きます(md-viewer.config.mjs のプラグイン実証): [unified](https://unifiedjs.com/)

### 引用と脚注

> Markdown は「書くこと」に集中するためのフォーマット。
> 表示の面倒はビューアーに任せる[^1]。

[^1]: これは脚注のサンプルです。クリックで本文と往復できます。

## インライン要素

`インラインコード`、**強調**、*イタリック*、そして数式 $E = mc^2$ も本文中に書けます。

絵文字ショートコードも標準で有効です: `:smile:` :smile: `:+1:` :+1: `:tada:` :tada:

<details>
<summary>生の HTML も展開できます(rehype-raw)</summary>

この部分は Markdown 内に直接書いた `<details>` タグです。

</details>

## 編集して試す

このファイルをエディタで編集して保存すると、**ブラウザが自動で再描画**されます(ライブリロード)。
