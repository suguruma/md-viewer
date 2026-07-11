'use strict'
// Node SEA(Single Executable Application)のブートストラップ。
// exe本体には最小限のこのコードだけを埋め込み、実処理は exe と同じフォルダの
// app/bin/mdv.js(ESM)を動的importで読み込む。
// 実機検証済み: SEA実行時の process.argv は [execPath, execPath, ...userArgs] となり、
// 通常の `node script.js arg...`([node, script, ...args])と同じく slice(2) の位置に
// ユーザー引数が並ぶため、bin/mdv.js 側は無改造で動作する。
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const exeDir = path.dirname(process.execPath)
const entry = path.join(exeDir, 'app', 'bin', 'mdv.js')

import(pathToFileURL(entry).href).catch((err) => {
  console.error('起動に失敗しました:', err?.stack ?? err)
  console.error('exe と同じ場所に app フォルダがあるか確認してください。')
  process.exitCode = 1
})
