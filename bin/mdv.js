#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { startServer } from '../server/index.js'

const HELP = `MD Viewer - ローカルMarkdownビューアー

使い方: mdv [パス] [オプション]
       npm start -- [パス] [オプション]

  パス            表示する .md ファイル、またはフォルダ(省略時: カレントフォルダ)

オプション:
  -p, --port N    ポート番号(既定 8931。使用中なら自動で +1)
      --host H    バインド先アドレス(既定 127.0.0.1)。名前を指定した場合は、その名前も許可される
      --allowed-host NAME
                  localhost・IP アドレス以外の名前(PC 名など)でのアクセスを許可する(複数指定可)。
                  それ以外の Host ヘッダーの要求は、DNS リバインディング対策として拒否される
      --no-open   起動時にブラウザを開かない
      --poll      ポーリングでファイル監視(OneDrive等で更新検知が効かない場合)
  -h, --help      このヘルプを表示

例:
  mdv docs                 docs フォルダをツリー表示
  mdv README.md            単一ファイルモード
  mdv notes --port 9000    ポート指定
`

let parsed
try {
  parsed = parseArgs({
    options: {
      port: { type: 'string', short: 'p', default: '8931' },
      host: { type: 'string', default: '127.0.0.1' },
      'allowed-host': { type: 'string', multiple: true, default: [] },
      'no-open': { type: 'boolean', default: false },
      poll: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })
} catch (e) {
  console.error(`引数エラー: ${e.message}`)
  console.error(HELP)
  process.exit(1)
}

if (parsed.values.help) {
  console.log(HELP)
  process.exit(0)
}

const port = Number(parsed.values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`ポート番号が不正です: ${parsed.values.port}`)
  process.exit(1)
}

try {
  await startServer({
    targetPath: parsed.positionals[0] ?? '.',
    port,
    host: parsed.values.host,
    allowedHosts: parsed.values['allowed-host'],
    open: !parsed.values['no-open'],
    poll: parsed.values.poll,
  })
} catch (e) {
  console.error(`起動に失敗しました: ${e?.message ?? e}`)
  process.exit(1)
}
