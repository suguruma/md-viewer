import * as chokidarNS from 'chokidar'
import path from 'node:path'
import { isMarkdownPath } from './safe-path.js'

const chokidarWatch = chokidarNS.watch ?? chokidarNS.default?.watch

// ファイル監視。エディタのアトミック保存対策に awaitWriteFinish を入れる。
// OneDrive 等で変更イベントが拾えない場合は usePolling(--poll)で回避する。
export function startWatcher({ watchTarget, root, usePolling, onDocChanged, onTreeChanged }) {
  const watcher = chokidarWatch(watchTarget, {
    ignoreInitial: true,
    usePolling,
    interval: usePolling ? 400 : undefined,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    ignored: (p) => {
      const rel = path.relative(root, p)
      if (rel === '' || rel === '.') return false
      return rel.split(path.sep).some((seg) => seg === 'node_modules' || seg.startsWith('.'))
    },
  })

  let treeTimer = null
  const scheduleTree = () => {
    clearTimeout(treeTimer)
    treeTimer = setTimeout(onTreeChanged, 300)
  }

  watcher.on('all', (event, p) => {
    const rel = path.relative(root, p).split(path.sep).join('/')
    const md = isMarkdownPath(p)
    if (md && (event === 'change' || event === 'add' || event === 'unlink')) {
      onDocChanged(rel)
    }
    if ((md && (event === 'add' || event === 'unlink')) || event === 'addDir' || event === 'unlinkDir') {
      scheduleTree()
    }
  })
  watcher.on('error', (e) => console.error('[watch]', e?.message ?? e))
  return watcher
}
