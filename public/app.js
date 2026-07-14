// MD Viewer クライアント。ビルド工程なしの素のESモジュール。
// レンダリング済みHTMLをサーバーから受け取り、mermaid描画・目次・検索・ライブリロードを担当する。

const $ = (sel) => document.querySelector(sel)

const state = {
  mode: 'dir',
  initialFile: null,
  rootPath: null,        // 現在のルートの絶対パス(フォルダ切替ダイアログの初期値に使う)
  current: null,        // 表示中ファイルの相対パス
  payload: null,        // /api/doc のレスポンス(テーマ切替時の再描画に使う)
  treeData: null,
  expanded: new Set(),  // 展開中フォルダの相対パス
  theme: 'light',
  findMatches: [],
  findIndex: -1,
  wsBackoff: 500,
  wsWasConnected: false,
  pendingFind: null,    // 横断検索から遷移した際にページ内検索へ引き継ぐ語
  mindmapInstance: null, // Markmap インスタンス(ファイル切替時は setData で使い回す)
}

let mermaidSeq = 0
let mindmapSeq = 0

// ---------- ユーティリティ ----------

function encodePath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/')
}

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function debounce(fn, ms) {
  let t = null
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

// ---------- テーマ ----------

function initTheme() {
  const saved = localStorage.getItem('mdv.theme')
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  state.theme = saved ?? (preferDark ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', state.theme === 'dark')
}

async function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.classList.toggle('dark', state.theme === 'dark')
  localStorage.setItem('mdv.theme', state.theme)
  // mermaid はテーマをSVGに焼き込むため、本文を作り直して再描画する
  if (state.payload) await applyDoc(state.payload, null, { preserveScroll: true })
}

// ---------- ルーティング(location.hash = "#/相対パス#見出しID") ----------

function parseHash() {
  const h = location.hash
  if (!h.startsWith('#/')) return null
  const body = h.slice(2)
  const sep = body.indexOf('#')
  const encPath = sep === -1 ? body : body.slice(0, sep)
  let frag = sep === -1 ? null : body.slice(sep + 1)
  let rel
  try {
    rel = decodeURIComponent(encPath)
  } catch {
    rel = encPath
  }
  // Markdown パーサが日本語見出しIDを %XX に変換するため復号してから照合する
  if (frag) {
    try {
      frag = decodeURIComponent(frag)
    } catch {}
  }
  return { rel, frag }
}

function setHash(rel, frag) {
  const next = '#/' + encodePath(rel) + (frag ? '#' + frag : '')
  if (location.hash === next) {
    onHashChange() // 同一ハッシュだと hashchange が発火しないため直接ロード
  } else {
    location.hash = next
  }
}

async function onHashChange() {
  const parsed = parseHash()
  if (!parsed) return
  await loadDoc(parsed.rel, parsed.frag)
}

// ---------- ドキュメント表示 ----------

async function loadDoc(rel, frag, opts = {}) {
  let payload
  try {
    payload = await fetchJSON('/api/doc?path=' + encodeURIComponent(rel))
  } catch (e) {
    renderDocError(rel, e.status)
    state.current = rel
    return
  }
  state.current = rel
  state.payload = payload
  $('#mdv-doc-title').textContent = rel
  document.title = `${rel.split('/').pop()} - MD Viewer`
  markActiveTreeItem(rel)
  await applyDoc(payload, frag, opts)
}

async function applyDoc(payload, frag, { preserveScroll = false } = {}) {
  const content = $('#mdv-content')
  const prevScroll = content.scrollTop
  const art = $('#mdv-doc')

  clearFindMarks()
  art.innerHTML = payload.html
  const fmCard = buildFrontmatterCard(payload.frontmatter)
  if (fmCard) art.prepend(fmCard)
  buildOutline(payload.headings)
  interceptInPageAnchors(art)
  addCopyButtons(art)
  await renderMermaidBlocks(art)
  if (isMindmapMode()) await refreshMindmap()

  if (preserveScroll) {
    content.scrollTop = prevScroll
  } else if (frag) {
    document.getElementById(frag)?.scrollIntoView()
  } else {
    content.scrollTop = 0
  }

  // 横断検索からの遷移、またはリロード前の検索語を再適用
  const q = state.pendingFind ?? $('#mdv-find-input').value.trim()
  if (state.pendingFind) {
    $('#mdv-find-input').value = state.pendingFind
    state.pendingFind = null
  }
  if (q) runFind(q, { jump: !preserveScroll && !frag })
  updateScrollSpy()
}

function renderDocError(rel, status) {
  const art = $('#mdv-doc')
  const msg =
    status === 404
      ? 'ファイルが見つかりません(削除または移動された可能性があります)'
      : `読み込みエラー (HTTP ${status ?? '不明'})`
  art.innerHTML = `<div class="mdv-error"><strong>${msg}</strong><div class="mdv-error-path"></div></div>`
  art.querySelector('.mdv-error-path').textContent = rel
  $('#mdv-doc-title').textContent = rel
  buildOutline([])
}

function renderEmptyState() {
  $('#mdv-doc').innerHTML = '<div class="mdv-error">対象フォルダに .md ファイルがありません</div>'
  $('#mdv-doc-title').textContent = '(ファイルなし)'
}

// ページ内アンカー(#foo)はハッシュルーティングを壊さないよう自前でスクロール
function interceptInPageAnchors(root) {
  for (const a of root.querySelectorAll('a[href^="#"]')) {
    const href = a.getAttribute('href')
    if (href.startsWith('#/')) continue // ファイル遷移リンクは既定動作(hashchange)に任せる
    a.addEventListener('click', (e) => {
      e.preventDefault()
      let id = href.slice(1)
      try {
        id = decodeURIComponent(id)
      } catch {}
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    })
  }
}

// ---------- タスクリストの同期 ----------
// プレビューのチェックボックスをクリックした際、サーバー経由で元のMarkdownの [ ]/[x] を書き換える。
// #mdv-doc は再描画のたびに innerHTML ごと差し替わるため、リスナーは親要素に一度だけ委譲で登録する。

async function handleTaskCheckboxChange(e) {
  const checkbox = e.target
  if (!checkbox.matches?.('.mdv-task-checkbox')) return
  const li = checkbox.closest('li[data-task-start][data-task-end]')
  if (!li) return

  const start = Number(li.dataset.taskStart)
  const end = Number(li.dataset.taskEnd)
  const wasChecked = !checkbox.checked // change 発火時には既に反転済みなので、反転前はその逆
  const rel = state.current

  checkbox.disabled = true
  try {
    const res = await fetch('/api/doc/toggle-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rel, start, end, wasChecked }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      checkbox.checked = wasChecked
      window.alert(data.error ?? `更新に失敗しました (HTTP ${res.status})`)
    }
    // 成功時はファイル監視経由の doc-changed 通知で再描画される
  } catch (err) {
    checkbox.checked = wasChecked
    window.alert('更新に失敗しました: ' + (err?.message ?? err))
  } finally {
    checkbox.disabled = false
  }
}

// ---------- Mermaid ----------

async function renderMermaidBlocks(root) {
  const blocks = root.querySelectorAll('.mermaid-block')
  if (blocks.length === 0) return
  if (!window.mermaid) {
    // defer 読み込みが間に合っていない場合は少し待つ
    await new Promise((r) => setTimeout(r, 300))
    if (!window.mermaid) return // ソース表示のまま(フォールバック)
  }
  window.mermaid.initialize({
    startOnLoad: false,
    theme: state.theme === 'dark' ? 'dark' : 'default',
  })
  for (const block of blocks) {
    const srcEl = block.querySelector('.mermaid-src')
    const src = (srcEl ? srcEl.textContent : block.dataset.src ?? '').trim()
    if (!src) continue
    block.dataset.src = src
    const id = 'mdv-mmd-' + ++mermaidSeq
    try {
      const { svg } = await window.mermaid.render(id, src)
      block.innerHTML = svg
      block.classList.add('rendered')
    } catch (e) {
      document.getElementById('d' + id)?.remove() // mermaidが残すエラー用要素を掃除
      block.innerHTML = ''
      const err = document.createElement('div')
      err.className = 'mermaid-error'
      err.textContent = 'Mermaid 構文エラー: ' + (e?.message ?? e)
      const pre = document.createElement('pre')
      pre.className = 'mermaid-src'
      pre.textContent = src
      block.append(err, pre)
    }
  }
}

// ---------- マインドマップ表示 ----------
// markmap-lib(markdown-it 独自パーサー)で生 Markdown を階層データに変換し、
// markmap-view(d3ベース)で #mdv-mindmap-svg に描画する。本文のremarkパイプラインとは独立。

function isMindmapMode() {
  return document.body.classList.contains('mindmap-mode')
}

async function setMindmapMode(on) {
  document.body.classList.toggle('mindmap-mode', on)
  $('#mdv-mindmap-toggle').setAttribute('aria-pressed', String(on))
  if (on) await refreshMindmap()
}

async function refreshMindmap() {
  if (!state.current) return
  if (!window.markmap?.Transformer || !window.markmap?.Markmap) {
    $('#mdv-mindmap-svg').replaceChildren()
    return
  }
  const seq = ++mindmapSeq
  const targetPath = state.current
  let raw
  try {
    const res = await fetch('/raw/' + encodePath(targetPath))
    if (!res.ok) throw new Error('HTTP ' + res.status)
    raw = await res.text()
  } catch {
    return
  }
  // 取得中に別のファイルへ遷移していたら古い結果は捨てる
  if (seq !== mindmapSeq || state.current !== targetPath) return

  const transformer = new window.markmap.Transformer()
  const { root } = transformer.transform(raw)

  if (state.mindmapInstance) {
    await state.mindmapInstance.setData(root)
    state.mindmapInstance.fit()
  } else {
    state.mindmapInstance = window.markmap.Markmap.create($('#mdv-mindmap-svg'), {
      autoFit: true,
      duration: 200,
    }, root)
  }
}

// ---------- コードブロックのコピー ----------

function addCopyButtons(root) {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.closest('.mermaid-block')) continue
    const wrap = document.createElement('div')
    wrap.className = 'mdv-codeblock'
    pre.replaceWith(wrap)
    wrap.appendChild(pre)
    const btn = document.createElement('button')
    btn.className = 'mdv-copy-btn'
    btn.type = 'button'
    btn.textContent = 'コピー'
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent)
        btn.textContent = 'コピー済'
        setTimeout(() => (btn.textContent = 'コピー'), 1200)
      } catch {
        btn.textContent = '失敗'
        setTimeout(() => (btn.textContent = 'コピー'), 1200)
      }
    })
    wrap.appendChild(btn)
  }
}

// ---------- フロントマター ----------

const FM_TITLE_KEYS = ['title']
const FM_TAG_KEYS = ['tags', 'tag', 'categories', 'category']
const FM_DATE_KEYS = ['date', 'created', 'created_at', 'createdAt', 'updated', 'updated_at', 'updatedAt']
const FM_DATE_LABELS = { date: '日付', created: '作成', created_at: '作成', createdAt: '作成', updated: '更新', updated_at: '更新', updatedAt: '更新' }

function fmToArray(v) {
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim())
  if (v == null || v === '') return []
  return [String(v)]
}

function fmFormatDate(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

// payload.frontmatter(YAML由来のプレーンオブジェクト)からタイトル/タグ/日付/その他のカードを組み立てる。
// 該当フィールドが一つもなければ null(カードなし)。
function buildFrontmatterCard(fm) {
  if (!fm || typeof fm !== 'object') return null

  const usedKeys = new Set()
  const titleKey = FM_TITLE_KEYS.find((k) => typeof fm[k] === 'string' && fm[k].trim())
  const tagKey = FM_TAG_KEYS.find((k) => fmToArray(fm[k]).length > 0)
  const dateEntries = FM_DATE_KEYS.filter((k) => fm[k] != null && fm[k] !== '').map((k) => [k, fm[k]])
  if (titleKey) usedKeys.add(titleKey)
  if (tagKey) usedKeys.add(tagKey)
  for (const [k] of dateEntries) usedKeys.add(k)

  const otherEntries = Object.entries(fm).filter(([k, v]) => !usedKeys.has(k) && v != null && v !== '')
  if (!titleKey && !tagKey && dateEntries.length === 0 && otherEntries.length === 0) return null

  const card = document.createElement('div')
  card.className = 'mdv-frontmatter'

  if (titleKey) {
    const h = document.createElement('div')
    h.className = 'mdv-fm-title'
    h.textContent = fm[titleKey]
    card.appendChild(h)
  }

  if (dateEntries.length > 0 || tagKey) {
    const meta = document.createElement('div')
    meta.className = 'mdv-fm-meta'
    for (const [k, v] of dateEntries) {
      const span = document.createElement('span')
      span.className = 'mdv-fm-date'
      span.textContent = fmFormatDate(v)
      span.title = FM_DATE_LABELS[k] ?? k
      meta.appendChild(span)
    }
    if (tagKey) {
      for (const tag of fmToArray(fm[tagKey])) {
        const badge = document.createElement('span')
        badge.className = 'mdv-fm-tag'
        badge.textContent = tag
        meta.appendChild(badge)
      }
    }
    card.appendChild(meta)
  }

  if (otherEntries.length > 0) {
    const table = document.createElement('table')
    table.className = 'mdv-fm-table'
    for (const [k, v] of otherEntries) {
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = k
      const td = document.createElement('td')
      td.textContent = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
      tr.append(th, td)
      table.appendChild(tr)
    }
    card.appendChild(table)
  }

  return card
}

// ---------- アウトライン(目次) ----------

function buildOutline(headings) {
  const nav = $('#mdv-outline')
  nav.innerHTML = ''
  if (!headings || headings.length === 0) {
    nav.innerHTML = '<div class="mdv-outline-empty">見出しなし</div>'
    return
  }
  const minDepth = Math.min(...headings.map((h) => h.depth))
  for (const h of headings) {
    const a = document.createElement('a')
    a.href = '#' + h.id
    a.textContent = h.text || '(無題)'
    a.className = 'mdv-outline-item'
    a.style.paddingLeft = 8 + (h.depth - minDepth) * 14 + 'px'
    a.dataset.target = h.id
    a.addEventListener('click', (e) => {
      e.preventDefault()
      document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      toggleOutlineDrawer(false)
    })
    nav.appendChild(a)
  }
}

function updateScrollSpy() {
  const headings = state.payload?.headings ?? []
  if (headings.length === 0) return
  const content = $('#mdv-content')
  const contentTop = content.getBoundingClientRect().top
  let activeId = null
  for (const h of headings) {
    const el = document.getElementById(h.id)
    if (!el) continue
    if (el.getBoundingClientRect().top - contentTop <= 90) activeId = h.id
  }
  for (const item of document.querySelectorAll('.mdv-outline-item')) {
    item.classList.toggle('active', item.dataset.target === activeId)
  }
}

// ---------- 目次ドロワー(狭幅画面) ----------

function isOutlineDrawerOpen() {
  return $('#mdv-outline-panel').classList.contains('drawer-open')
}

function toggleOutlineDrawer(force) {
  const open = force ?? !isOutlineDrawerOpen()
  $('#mdv-outline-panel').classList.toggle('drawer-open', open)
  $('#mdv-outline-backdrop').classList.toggle('show', open)
}

// ---------- ファイルツリー ----------

async function refreshTree(preserve = false) {
  const data = await fetchJSON('/api/tree')
  state.treeData = data.nodes
  $('#mdv-file-count').textContent = `${data.count} 件`
  if (!preserve) {
    // 初回はトップレベルのフォルダだけ展開
    for (const n of data.nodes) if (n.type === 'dir') state.expanded.add(n.path)
  }
  renderTree()
  if (state.current) markActiveTreeItem(state.current)
}

function renderTree() {
  const container = $('#mdv-tree')
  container.innerHTML = ''
  if (!state.treeData || state.treeData.length === 0) {
    container.innerHTML = '<div class="mdv-tree-empty">.md ファイルがありません</div>'
    return
  }
  renderNodes(state.treeData, container, 0)
  ensureRovingTabIndex()
}

// フォルダは展開時に初めて子を描画する(数百ファイル規模でも初期描画を軽くする)
function renderNodes(nodes, container, depth) {
  for (const node of nodes) {
    if (node.type === 'dir') {
      const row = document.createElement('div')
      row.className = 'mdv-tree-row mdv-tree-dir'
      row.style.paddingLeft = 8 + depth * 14 + 'px'
      row.dataset.path = node.path
      row.tabIndex = -1
      row.setAttribute('role', 'treeitem')
      row.setAttribute('aria-expanded', 'false')
      const caret = document.createElement('span')
      caret.className = 'mdv-caret'
      row.appendChild(caret)
      const name = document.createElement('span')
      name.textContent = node.name
      row.appendChild(name)
      container.appendChild(row)

      const childBox = document.createElement('div')
      childBox.className = 'mdv-tree-children'
      childBox.setAttribute('role', 'group')
      childBox.dataset.rendered = 'false'
      container.appendChild(childBox)

      const setOpen = (open) => {
        row.classList.toggle('open', open)
        row.setAttribute('aria-expanded', String(open))
        childBox.style.display = open ? '' : 'none'
        if (open && childBox.dataset.rendered === 'false') {
          renderNodes(node.children, childBox, depth + 1)
          childBox.dataset.rendered = 'true'
        }
      }
      row.addEventListener('click', () => {
        const open = !state.expanded.has(node.path)
        if (open) state.expanded.add(node.path)
        else state.expanded.delete(node.path)
        setOpen(open)
        setRovingTabIndex(row)
      })
      setOpen(state.expanded.has(node.path))
    } else {
      const row = document.createElement('a')
      row.className = 'mdv-tree-row mdv-tree-file'
      row.style.paddingLeft = 8 + depth * 14 + 'px'
      row.dataset.path = node.path
      row.href = '#/' + encodePath(node.path)
      row.tabIndex = -1
      row.setAttribute('role', 'treeitem')
      const name = document.createElement('span')
      name.textContent = node.name
      row.appendChild(name)
      container.appendChild(row)
      row.addEventListener('click', () => setRovingTabIndex(row))
    }
  }
}

// ---------- ツリーのキーボード操作(roving tabindex) ----------

function getVisibleTreeRows() {
  return Array.from(document.querySelectorAll('#mdv-tree .mdv-tree-row')).filter((el) => el.offsetParent !== null)
}

function setRovingTabIndex(row) {
  for (const r of getVisibleTreeRows()) r.tabIndex = -1
  row.tabIndex = 0
}

function focusTreeRow(row) {
  setRovingTabIndex(row)
  row.focus()
}

// 初回Tab進入時にどこへフォーカスするかのマーカーを設定する(実際にはfocus()しない)
function ensureRovingTabIndex() {
  const rows = getVisibleTreeRows()
  if (rows.length === 0) return
  if (rows.some((r) => r.tabIndex === 0)) return
  const active = document.querySelector('.mdv-tree-file.active')
  setRovingTabIndex(active && rows.includes(active) ? active : rows[0])
}

// row を含む mdv-tree-children の直前の兄弟要素(=そのフォルダ自身の行)を返す
function findParentTreeRow(row) {
  const childBox = row.closest('.mdv-tree-children')
  if (!childBox) return null
  const owner = childBox.previousElementSibling
  return owner && owner.classList.contains('mdv-tree-row') ? owner : null
}

function initTreeKeyboardNav() {
  $('#mdv-tree').addEventListener('keydown', (e) => {
    const rows = getVisibleTreeRows()
    if (rows.length === 0) return
    const current = e.target.closest('.mdv-tree-row')
    const idx = current ? rows.indexOf(current) : -1

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusTreeRow(rows[Math.min(rows.length - 1, idx + 1)])
        break
      case 'ArrowUp':
        e.preventDefault()
        focusTreeRow(rows[Math.max(0, idx - 1)])
        break
      case 'ArrowRight':
        if (!current) return
        e.preventDefault()
        if (current.classList.contains('mdv-tree-dir')) {
          if (!current.classList.contains('open')) {
            current.click()
          } else if (rows[idx + 1]) {
            focusTreeRow(rows[idx + 1])
          }
        }
        break
      case 'ArrowLeft': {
        if (!current) return
        e.preventDefault()
        const isOpenDir = current.classList.contains('mdv-tree-dir') && current.classList.contains('open')
        if (isOpenDir) {
          current.click()
        } else {
          const parentRow = findParentTreeRow(current)
          if (parentRow) focusTreeRow(parentRow)
        }
        break
      }
      case 'Home':
        e.preventDefault()
        focusTreeRow(rows[0])
        break
      case 'End':
        e.preventDefault()
        focusTreeRow(rows[rows.length - 1])
        break
      case 'Enter':
      case ' ':
        if (!current) return
        e.preventDefault()
        current.click()
        break
    }
  })
}

function markActiveTreeItem(rel) {
  // 祖先フォルダを展開状態にしてから再描画し、該当行を強調
  const parts = rel.split('/')
  let acc = ''
  let needRender = false
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    if (!state.expanded.has(acc)) {
      state.expanded.add(acc)
      needRender = true
    }
  }
  if (needRender) renderTree()
  for (const row of document.querySelectorAll('.mdv-tree-file')) {
    row.classList.toggle('active', row.dataset.path === rel)
  }
  document.querySelector('.mdv-tree-file.active')?.scrollIntoView({ block: 'nearest' })
}

function firstFile(nodes) {
  for (const n of nodes) {
    if (n.type === 'file') return n.path
    const found = firstFile(n.children)
    if (found) return found
  }
  return null
}

// 初期表示: ルート直下の index.md / README.md を優先し、なければルート直下→DFS順
function pickInitialFile(nodes) {
  const preferred = ['index.md', 'readme.md', 'home.md']
  for (const name of preferred) {
    const hit = nodes.find((n) => n.type === 'file' && n.name.toLowerCase() === name)
    if (hit) return hit.path
  }
  const rootFile = nodes.find((n) => n.type === 'file')
  return rootFile ? rootFile.path : firstFile(nodes)
}

// ---------- フォルダ切替 ----------

async function openFolderDialog() {
  const input = window.prompt(
    '開くフォルダの絶対パスを入力してください\n(例: C:\\Users\\you\\notes)',
    state.rootPath ?? '',
  )
  if (input === null) return
  const trimmed = input.trim()
  if (!trimmed) return
  await changeDir(trimmed)
}

// silent: true の場合、失敗してもアラートを出さない(起動時の自動復元用)。
// 戻り値は切替に成功したかどうか。
async function changeDir(absPath, { silent = false } = {}) {
  let res, data
  try {
    res = await fetch('/api/change-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absPath }),
    })
    data = await res.json()
  } catch (e) {
    if (!silent) window.alert('フォルダの切り替えに失敗しました: ' + (e?.message ?? e))
    return false
  }
  if (!res.ok) {
    if (!silent) {
      window.alert(data.error ?? `フォルダの切り替えに失敗しました (HTTP ${res.status})`)
    } else {
      // 復元先が削除・移動されている等の場合、次回以降は自動復元を試みない
      localStorage.removeItem('mdv.lastRoot')
    }
    return false
  }

  state.mode = data.mode
  state.rootPath = data.rootPath
  state.initialFile = null
  state.current = null
  state.payload = null
  state.expanded.clear()
  document.body.classList.remove('single-file')
  $('#mdv-root-name').textContent = data.rootName
  $('#mdv-root-name').title = data.rootPath
  localStorage.setItem('mdv.lastRoot', data.rootPath)

  await refreshTree(false)
  const first = pickInitialFile(state.treeData ?? [])
  if (first) {
    setHash(first)
  } else {
    history.replaceState(null, '', location.pathname + location.search)
    renderEmptyState()
  }
  return true
}

// ---------- 横断検索(サイドバー) ----------

async function runGlobalSearch(q) {
  const box = $('#mdv-search-results')
  const tree = $('#mdv-tree')
  if (q.length < 2) {
    box.hidden = true
    tree.hidden = false
    return
  }
  let data
  try {
    data = await fetchJSON('/api/search?q=' + encodeURIComponent(q))
  } catch {
    return
  }
  // 入力が進んで古いレスポンスが返ってきた場合は捨てる
  if ($('#mdv-search-input').value.trim() !== q) return

  box.innerHTML = ''
  box.hidden = false
  tree.hidden = true
  if (data.results.length === 0) {
    box.innerHTML = '<div class="mdv-tree-empty">該当なし</div>'
    return
  }
  for (const r of data.results) {
    const head = document.createElement('div')
    head.className = 'mdv-result-file'
    head.textContent = `${r.path} (${r.total})`
    head.addEventListener('click', () => openSearchResult(r.path, q))
    box.appendChild(head)
    for (const m of r.matches) {
      const line = document.createElement('div')
      line.className = 'mdv-result-line'
      const ln = document.createElement('span')
      ln.className = 'mdv-result-ln'
      ln.textContent = m.line
      line.appendChild(ln)
      line.appendChild(buildSnippet(m.snippet, q))
      line.addEventListener('click', () => openSearchResult(r.path, q))
      box.appendChild(line)
    }
  }
}

function buildSnippet(snippet, q) {
  const span = document.createElement('span')
  span.className = 'mdv-result-snippet'
  const lower = snippet.toLowerCase()
  const ql = q.toLowerCase()
  let pos = 0
  let idx = lower.indexOf(ql)
  while (idx !== -1) {
    span.appendChild(document.createTextNode(snippet.slice(pos, idx)))
    const b = document.createElement('b')
    b.textContent = snippet.slice(idx, idx + q.length)
    span.appendChild(b)
    pos = idx + q.length
    idx = lower.indexOf(ql, pos)
  }
  span.appendChild(document.createTextNode(snippet.slice(pos)))
  return span
}

function openSearchResult(rel, q) {
  state.pendingFind = q
  setHash(rel)
}

// ---------- ページ内検索 ----------

const FIND_LIMIT = 500

function runFind(q, { jump = true } = {}) {
  clearFindMarks()
  state.findMatches = []
  state.findIndex = -1
  if (!q) {
    updateFindCount()
    return
  }
  const root = $('#mdv-doc')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement
      if (!p) return NodeFilter.FILTER_REJECT
      // SVG内・数式内・mermaid内は DOM を壊すためマークしない
      if (p.closest('script, style, svg, .katex, .mermaid-block, mark')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const textNodes = []
  let n
  while ((n = walker.nextNode())) textNodes.push(n)

  const ql = q.toLowerCase()
  let count = 0
  for (const t of textNodes) {
    if (count >= FIND_LIMIT) break
    const val = t.nodeValue
    const low = val.toLowerCase()
    let idx = low.indexOf(ql)
    if (idx === -1) continue
    const frag = document.createDocumentFragment()
    let pos = 0
    while (idx !== -1 && count < FIND_LIMIT) {
      frag.appendChild(document.createTextNode(val.slice(pos, idx)))
      const mark = document.createElement('mark')
      mark.className = 'mdv-find-mark'
      mark.textContent = val.slice(idx, idx + q.length)
      frag.appendChild(mark)
      state.findMatches.push(mark)
      count++
      pos = idx + q.length
      idx = low.indexOf(ql, pos)
    }
    frag.appendChild(document.createTextNode(val.slice(pos)))
    t.parentNode.replaceChild(frag, t)
  }
  updateFindCount()
  if (jump && state.findMatches.length > 0) jumpToMatch(0)
}

function clearFindMarks() {
  const doc = $('#mdv-doc')
  for (const mark of doc.querySelectorAll('mark.mdv-find-mark')) {
    mark.replaceWith(document.createTextNode(mark.textContent))
  }
  doc.normalize()
  state.findMatches = []
  state.findIndex = -1
  updateFindCount()
}

function jumpToMatch(i) {
  const list = state.findMatches
  if (list.length === 0) return
  const idx = ((i % list.length) + list.length) % list.length
  list[state.findIndex]?.classList.remove('active')
  state.findIndex = idx
  list[idx].classList.add('active')
  list[idx].scrollIntoView({ block: 'center' })
  updateFindCount()
}

function updateFindCount() {
  const el = $('#mdv-find-count')
  const total = state.findMatches.length
  if (total === 0) {
    el.textContent = $('#mdv-find-input').value.trim() ? '0件' : ''
  } else {
    const capped = total >= FIND_LIMIT ? `${FIND_LIMIT}+` : String(total)
    el.textContent = `${state.findIndex + 1}/${capped}`
  }
}

// ---------- WebSocket(ライブリロード) ----------

function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`)
  ws.onopen = () => {
    setConnState(true)
    state.wsBackoff = 500
    if (state.wsWasConnected) {
      // 切断中の変更を取りこぼしている可能性があるため再同期
      refreshTree(true)
      if (state.current) loadDoc(state.current, null, { preserveScroll: true })
    }
    state.wsWasConnected = true
  }
  ws.onmessage = (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.type === 'doc-changed' && msg.path === state.current) {
      loadDoc(state.current, null, { preserveScroll: true })
    }
    if (msg.type === 'tree-changed') refreshTree(true)
  }
  ws.onclose = () => {
    setConnState(false)
    setTimeout(connectWS, state.wsBackoff)
    state.wsBackoff = Math.min(state.wsBackoff * 2, 5000)
  }
  ws.onerror = () => ws.close()
}

function setConnState(ok) {
  const el = $('#mdv-conn')
  el.classList.toggle('down', !ok)
  el.title = ok ? 'ライブリロード: 接続中' : 'ライブリロード: 切断(再接続中)'
}

// ---------- UI イベント ----------

function bindUI() {
  $('#mdv-theme-toggle').addEventListener('click', toggleTheme)

  $('#mdv-sidebar-toggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden')
    localStorage.setItem('mdv.sidebar', document.body.classList.contains('sidebar-hidden') ? 'hidden' : '')
  })
  if (localStorage.getItem('mdv.sidebar') === 'hidden') {
    document.body.classList.add('sidebar-hidden')
  }

  $('#mdv-open-folder-btn').addEventListener('click', openFolderDialog)
  initTreeKeyboardNav()

  $('#mdv-outline-toggle').addEventListener('click', () => toggleOutlineDrawer())
  $('#mdv-outline-backdrop').addEventListener('click', () => toggleOutlineDrawer(false))

  $('#mdv-mindmap-toggle').addEventListener('click', () => setMindmapMode(!isMindmapMode()))
  $('#mdv-mindmap-fit').addEventListener('click', () => state.mindmapInstance?.fit())

  $('#mdv-doc').addEventListener('change', handleTaskCheckboxChange)

  const findInput = $('#mdv-find-input')
  findInput.addEventListener(
    'input',
    debounce(() => runFind(findInput.value.trim()), 150),
  )
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      jumpToMatch(state.findIndex + (e.shiftKey ? -1 : 1))
    } else if (e.key === 'Escape') {
      findInput.value = ''
      clearFindMarks()
      findInput.blur()
    }
  })
  $('#mdv-find-next').addEventListener('click', () => jumpToMatch(state.findIndex + 1))
  $('#mdv-find-prev').addEventListener('click', () => jumpToMatch(state.findIndex - 1))

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) {
      e.preventDefault()
      findInput.focus()
      findInput.select()
    } else if (e.key === 'Escape' && isOutlineDrawerOpen()) {
      toggleOutlineDrawer(false)
    }
  })

  const searchInput = $('#mdv-search-input')
  searchInput.addEventListener(
    'input',
    debounce(() => runGlobalSearch(searchInput.value.trim()), 300),
  )
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = ''
      runGlobalSearch('')
      searchInput.blur()
    }
  })

  $('#mdv-content').addEventListener(
    'scroll',
    () => requestAnimationFrame(updateScrollSpy),
    { passive: true },
  )
}

// ---------- 起動 ----------

async function boot() {
  initTheme()
  bindUI()

  const cfg = await fetchJSON('/api/config')
  state.mode = cfg.mode
  state.initialFile = cfg.initialFile
  state.rootPath = cfg.rootPath
  document.body.classList.toggle('single-file', cfg.mode === 'file')
  $('#mdv-root-name').textContent = cfg.rootName
  $('#mdv-root-name').title = cfg.rootPath

  connectWS()
  window.addEventListener('hashchange', onHashChange)

  // URLに遷移先の指定がなくフォルダモードなら、前回開いていたフォルダへ自動復元する
  // (ダブルクリック起動のたびに「フォルダを開く」をやり直さずに済むようにするため)。
  const hasHash = !!parseHash()
  const lastRoot = !hasHash && cfg.mode === 'dir' ? localStorage.getItem('mdv.lastRoot') : null
  if (lastRoot && lastRoot !== cfg.rootPath && (await changeDir(lastRoot, { silent: true }))) {
    return
  }

  await refreshTree()
  if (hasHash) {
    await onHashChange()
  } else {
    const first = state.mode === 'file' ? state.initialFile : pickInitialFile(state.treeData ?? [])
    if (first) setHash(first)
    else renderEmptyState()
  }
}

boot().catch((e) => {
  $('#mdv-doc').innerHTML = '<div class="mdv-error">初期化に失敗しました</div>'
  console.error(e)
})
