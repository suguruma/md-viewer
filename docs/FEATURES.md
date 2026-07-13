# Feature Specification

[日本語版はこちら / Japanese version](FEATURES.ja.md)

Version: 1.2.0
Scope: Windows-focused local Markdown viewer (also runs on macOS/Linux from source)

## 1. Overview

MD Viewer is a local, read-only Markdown viewer. It renders a single `.md` file or an entire folder tree of `.md` files as browsable HTML in the default web browser, with GitHub-flavored rendering, diagrams, math, search, and live reload. It is not an editor.

Two runtime forms are provided:

| Form | Requirement | Use case |
| --- | --- | --- |
| From source | Node.js ≥ 20.6 | Development, non-Windows platforms, customization |
| Portable `.exe` | None (self-contained) | Windows, no install, USB/drag-and-drop friendly |
| Installer `.exe` | None (self-contained) | Windows, Start Menu / Desktop shortcuts, optional PATH |

## 2. Functional Requirements

### 2.1 Viewing modes

- **Single-file mode**: `mdv <file>.md` renders one file. The sidebar tree is hidden (the "Open folder" button remains available). Relative links/images resolve against the file's parent folder.
- **Folder mode**: `mdv <folder>` builds a tree of every `.md`/`.markdown` file under the folder (dotfiles, `node_modules`, and folders with no Markdown descendants are excluded). Clicking a tree entry swaps the displayed document without a full page reload (hash-based routing: `#/relative/path.md#heading-id`).
- **Switching folders at runtime**: an "Open folder" button at the top of the sidebar prompts for an absolute path and calls `POST /api/change-dir` (see §3) to re-root the server without restarting the process — the file watcher is torn down and re-created for the new root, the render cache is cleared, and the client rebuilds the tree and resets the URL hash to the new root's initial document.
- **Remembering the last folder**: every successful folder switch is saved to `localStorage`. On a fresh launch with no URL fragment, the client automatically re-issues the switch to that remembered folder before rendering anything — so double-clicking the app (which always starts pointed at its own sample/working directory) reopens whatever you last had open instead of the sample. If the remembered folder no longer exists, the attempt fails silently, the stale entry is cleared, and the server's own startup folder is shown instead.

### 2.2 Markdown rendering pipeline

Server-side rendering via a [unified](https://unifiedjs.com/) (remark → rehype) pipeline, in this fixed order:

```
remark-parse → remark-frontmatter → frontmatter extraction → remark-gfm → remark-emoji → remark-math
  → [user remark plugins] → remark-rehype (allowDangerousHtml)
  → rehype-raw → rehype-slug → rehype-katex
  → mermaid block extraction → unknown-language class stripping
  → @shikijs/rehype (dual light/dark theme) → relative link/image rewriting
  → heading collection → [user rehype plugins] → rehype-stringify
```

- **GFM**: tables, task lists (checkboxes), strikethrough, autolinks, footnotes (with back-references).
- **Raw HTML**: `rehype-raw` allows inline HTML in Markdown (e.g. `<details>`) to render as-is. No sanitization is applied (see §5 Security model).
- **Syntax highlighting**: [Shiki](https://shiki.style/), dual-themed (`github-light` / `github-dark` by default) — both themes are computed in a single pass and embedded as CSS custom properties, so switching UI theme requires no server round-trip for code blocks. Unrecognized language identifiers are stripped of their `language-*` class before highlighting so rendering never throws; the block falls back to plain `<pre>`.
- **Mermaid**: fenced ` ```mermaid ` blocks are extracted into `<div class="mermaid-block"><pre class="mermaid-src">…</pre></div>` server-side (Mermaid itself requires a DOM, so actual rendering happens client-side via the bundled `mermaid.min.js`). A syntax error in a diagram renders an inline error message plus the raw source, without breaking the rest of the page.
- **Math**: `remark-math` + `rehype-katex` (KaTeX). Inline `$...$` and block `$$...$$`. Render errors are shown inline (`errorColor` styling) rather than throwing.
- **Emoji**: `remark-emoji` is enabled by default (`{ accessible: true }`, wrapping each replacement in `<span role="img" aria-label="…">`) — GitHub-style shortcodes like `:smile:` render as Unicode emoji, with no configuration needed.
- **Frontmatter**: YAML frontmatter is parsed (via the `yaml` package) and removed from the rendered body, but the parsed object is returned to the client as `payload.frontmatter` and rendered as a card above the document (see §2.3).
- **Large files**: files over 2 MB skip the full pipeline and render as an escaped `<pre>` block with a notice banner, to bound worst-case render latency.

### 2.3 Navigation

- **Sidebar file tree**: lazy-expanded (a folder's children are only rendered into the DOM the first time it's opened), sorted with a locale-aware (Japanese) collator, folders before files. Opening a document expands and highlights its ancestor chain automatically.
- **Tree keyboard navigation**: the tree implements a roving-tabindex `role="tree"` pattern. `↑`/`↓` move focus between visible rows; `→` expands a collapsed folder or moves into its first child if already open; `←` collapses an open folder or moves focus to the parent folder; `Home`/`End` jump to the first/last visible row; `Enter`/`Space` activate the focused row (open a file, or toggle a folder). Folder rows expose `aria-expanded`.
- **Relative links**: links to other `.md`/`.markdown` files are rewritten to the app's hash router (`#/path.md` or `#/path.md#fragment`) so navigation stays inside the SPA shell. Links to non-Markdown files are rewritten to `/raw/<path>` and open in a new tab. In-page anchors (`#fragment` with no path) are intercepted and scrolled to client-side.
- **Images**: relative image paths are rewritten to `/raw/<resolved-path>`, served from disk with path-traversal protection (see §5).
- **Outline / table of contents**: lists all headings (h1–h6) of the current document with indentation by depth; clicking scrolls to the heading; the currently-visible heading is highlighted via scroll-spy as the user scrolls. Above ~1100px viewport width it is a persistent right-hand panel; below that width it becomes a slide-in drawer (toggled by a toolbar button, dismissed via its backdrop, the `Esc` key, or picking an outline entry).
- **Frontmatter card**: when a document has YAML frontmatter, a card is prepended above its content showing a recognized `title` field as a heading, recognized date fields (`date`/`created(_at)`/`updated(_at)`) formatted in `ja-JP` locale, recognized tag fields (`tags`/`tag`/`categories`/`category`, string or array) as pill badges, and any other scalar/array fields as a plain key/value table. A document with no frontmatter (or none of these fields) shows no card.
- **Print stylesheet**: `@media print` removes the toolbar/sidebar/outline panel/copy buttons, disables the screen-only scroll-shell layout so the full document flows across pages, forces light, high-contrast colors regardless of the active theme, reflows code blocks to wrap instead of scrolling, scales Mermaid SVGs to the page width, appends external link URLs after the link text, and hints the browser to avoid breaking headings/tables/code blocks/frontmatter cards/diagrams across a page boundary.

### 2.4 Search

| Type | Scope | Behavior |
| --- | --- | --- |
| In-page find | Current document | Case-insensitive substring match over rendered text nodes (skips SVG/KaTeX/Mermaid internals). Highlights all matches, `Enter`/`Shift+Enter` cycle, capped at 500 highlighted matches. Shortcut: `/`. |
| Cross-file search | All `.md` files under the root | Case-insensitive substring match, sequential file scan (no index). Returns up to 5 matched lines per file and 200 total matches, with `before/after` snippet context. Clicking a result opens that file and re-runs in-page find with the same query. |

### 2.5 Theming

Light/dark toggle in the toolbar, persisted in `localStorage`. Switching theme re-renders the current document from its cached payload (no network round-trip) so Mermaid diagrams (which bake theme into the SVG at render time) redraw correctly; Shiki code blocks switch instantly via CSS variables without any re-render.

### 2.6 Live reload

A `chokidar` file watcher (with `awaitWriteFinish` debouncing for editors that write in multiple steps) pushes two message types over a WebSocket (`/ws`):

- `doc-changed`: the currently open document is invalidated in the render cache and re-fetched/re-rendered in place, preserving scroll position.
- `tree-changed`: the sidebar tree is rebuilt (debounced 300 ms) when files/folders are added or removed.

The WebSocket client reconnects with exponential backoff (500 ms → 5 s cap) on disconnect, and on reconnect re-syncs the tree and current document in case changes were missed while offline. A `--poll` CLI flag switches the watcher to polling mode for filesystems where native change events are unreliable (e.g. some cloud-synced folders).

### 2.7 Extensibility

`md-viewer.config.mjs` at the app root, loaded at startup, can register additional remark/rehype plugins and override Shiki theme options without touching application source:

```js
export default {
  remarkPlugins: [somePlugin, [anotherPlugin, { option: true }]],
  rehypePlugins: [aRehypePlugin],
  shiki: { themes: { light: 'vitesse-light', dark: 'vitesse-dark' } },
}
```

User plugins run after all built-in processing and before final HTML serialization. A working example (`rehypeExternalLinksNewTab`, opens external `http(s)` links in a new tab) ships in the default config file. A missing or malformed config fails startup with an explicit error rather than silently ignoring it.

## 3. HTTP API

All endpoints are served from the bound host/port (default `127.0.0.1:8931`).

| Endpoint | Description |
| --- | --- |
| `GET /api/config` | `{ mode, rootName, rootPath, initialFile }` |
| `GET /api/tree` | `{ nodes: TreeNode[], count }` — recursive tree, empty-of-Markdown folders pruned |
| `POST /api/change-dir` | Body `{ path: "<absolute path>" }`. Validates the path is an existing directory, re-roots the server (watcher restart + full render-cache clear), returns `{ mode, rootName, rootPath }`. `400` for a non-absolute path or a path that isn't a directory, `404` if it doesn't exist. |
| `GET /api/doc?path=<rel>` | `{ path, html, headings[], frontmatter, plain, mtimeMs }` — rendered document |
| `GET /api/search?q=<query>` | `{ query, results: [{ path, matches: [{line, snippet}], total }] }` |
| `GET /raw/<path>` | Static file (images etc.), path-confined to the root |
| `WS /ws` | Live-reload event stream (`doc-changed`, `tree-changed`) |

## 4. Command-line interface

```
mdv [path] [options]

  path            .md file or folder to open (default: current directory)

  -p, --port N    Port (default 8931; auto-increments up to +9 if busy)
      --host H    Bind address (default 127.0.0.1)
      --no-open   Do not auto-open a browser on start
      --poll      Use polling for file watching
  -h, --help      Show help
```

Identical CLI surface across `npm start -- <args>`, the globally-installed `mdv` command, and the packaged `mdv.exe` (portable and installer builds) — see §6.

## 5. Security model

MD Viewer is designed for browsing **the user's own local files**, bound to `127.0.0.1` by default:

- **No HTML sanitization** — `rehype-raw` allows arbitrary inline HTML from the Markdown source to render as-is. This is intentional (keeps GFM/HTML authoring power) but means the tool should not be pointed at untrusted Markdown without adding `rehype-sanitize` via `md-viewer.config.mjs`.
- **Path traversal protection** — every filesystem read triggered by a request (`/api/doc`, `/raw/*`) resolves the requested relative path with `path.resolve` and verifies the result stays under the configured root before touching disk; `..`-escaping requests receive `400`/`403`.
- **No authentication** — there is no login; anyone able to reach the bound host/port can read any file under the configured root. Do not bind `--host 0.0.0.0` on an untrusted network.
- **`POST /api/change-dir` re-roots the server to any directory on disk** the process' OS user can read — it only checks that the path exists and is a directory, with no allowlist. This is consistent with the tool's threat model (a personal, loopback-bound viewer with no auth), but it means the "do not bind to a untrusted network" rule above is even more load-bearing than before: on a reachable host, this endpoint would let a remote visitor point the file browser at any readable folder on the machine.

## 6. Distribution formats

### 6.1 From source

`npm install && npm start -- <path>`. Requires Node.js ≥ 20.6.

### 6.2 Portable (`.zip`)

A self-contained folder: `mdv.exe` (a genuine single Windows executable built with Node's official [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) feature — a copy of the Node.js binary with a small bootstrap blob injected via `postject`) plus an adjacent `app/` folder containing the server, client assets, and a trimmed `node_modules` (Mermaid's large build-only transitive dependencies — `@mermaid-js/parser`, `cytoscape`, `cytoscape-fcose`, `d3`, `dompurify`, `es-toolkit` — are excluded since only the precompiled `mermaid.min.js` is ever served, never `require()`d). No installation, no admin rights, no registry changes. Supports drag-and-drop of a folder or `.md` file onto the `mdv.exe` icon.

### 6.3 Installer (`.exe`)

Built with [Inno Setup](https://jrsoftware.org/isinfo.php). Per-user install (no admin rights required) to `%LOCALAPPDATA%\Programs\MDViewer` by default, with:

- Start Menu shortcuts (app + sample + uninstaller)
- Optional Desktop shortcut (unchecked by default)
- Optional "Add to PATH" task (unchecked by default) enabling a plain `mdv` command from any terminal
- Standard Windows uninstaller entry (Apps & Features), which also removes the PATH entry if it was added

Both packages are unsigned (no code-signing certificate); Windows SmartScreen may warn on first launch ("Windows protected your PC") — this is expected for an independently distributed hobby tool and is resolved via "More info" → "Run anyway".

## 7. Performance characteristics (measured)

Measured on Windows 11 / Node 25, 500-file synthetic corpus (20 folders × 25 files, ~2 KB each):

| Operation | Measured |
| --- | --- |
| `GET /api/tree` (full 500-file scan) | 5–6 ms |
| `GET /api/search` (500-file cross-file scan) | 74–79 ms |
| `GET /api/doc`, first render after startup warmup | ~223 ms |
| `GET /api/doc`, subsequent uncached files | 8–16 ms |
| `GET /api/doc`, cache hit (mtime+size unchanged) | ~2 ms |

Shiki's grammar/theme engine initialization (~4.5 s cold) is paid once at server startup via a background warmup render, not on the first real request. Rendered documents are cached (mtime+size keyed, 50-entry LRU-ish eviction) and invalidated precisely by the file watcher.

## 8. Known limitations

- Cross-file search is a plain case-insensitive substring scan — no regex, no ranking, no index.
- No document editing; view-only by design.
- No automated test suite; verification is manual/scripted smoke testing (API responses, DOM assertions, real file-system edit-and-observe cycles).
- Verified on Windows 11 only; source-based runs should work on macOS/Linux (standard Node APIs throughout) but are untested.
- Unsigned Windows binaries trigger SmartScreen's "unrecognized app" warning.
