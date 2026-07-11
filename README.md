# MD Viewer

[日本語 README はこちら](README.ja.md)

A local, read-only Markdown viewer for Windows (and any Node.js platform). Open a single `.md` file or browse a whole folder of notes as a live-reloading, GitHub-flavored, syntax-highlighted, diagram-and-math-rendering site — no build step, no account, no cloud.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![Node.js >= 20.6](https://img.shields.io/badge/node-%3E%3D20.6-339933.svg)

## Features

- **Single-file or folder mode** — open one `.md` or an entire tree, with a lazy-expanding sidebar
- **Switch folders without restarting** — an "Open folder" button re-roots the running server to any absolute path
- **GitHub Flavored Markdown** — tables, task lists, strikethrough, autolinks, footnotes, raw HTML
- **Syntax highlighting** — [Shiki](https://shiki.style/), dual light/dark theme baked in at render time
- **Mermaid diagrams** and **KaTeX math**, both with graceful error display instead of crashing the page
- **Emoji shortcodes** (`:smile:`) rendered as Unicode emoji, on by default
- **Frontmatter card** — YAML `title`/`tags`/dates render as a badge card above the document
- **Dark / light mode**, persisted, with theme-aware diagrams and code blocks
- **Search** — in-page find and folder-wide cross-file search
- **Heading outline** with scroll-spy — a persistent panel on wide screens, a slide-in drawer on narrow ones
- **Full keyboard navigation** — arrow keys, Home/End, and Enter/Space drive the file tree
- **Print-friendly** — a dedicated print stylesheet for clean PDF export / hard copies
- **Live reload** — save a file, the browser updates in place
- **Plugin-friendly** — add remark/rehype plugins via a config file, no source changes needed

See [docs/FEATURES.md](docs/FEATURES.md) for the full specification (architecture, HTTP API, security model, measured performance).

## Download (Windows, no Node.js required)

Grab the latest release from **[GitHub Releases](../../releases/latest)**:

| Package | What it is | Best for |
| --- | --- | --- |
| `md-viewer-portable-win-x64-vX.Y.Z.zip` | Unzip and run — no install | USB drives, no-admin machines, trying it out |
| `md-viewer-setup-win-x64-vX.Y.Z.exe` | Guided installer (per-user, no admin needed) | Regular use, Start Menu / Desktop shortcuts, optional `mdv` PATH command |

Both are unsigned independent builds — Windows SmartScreen may show "Windows protected your PC" on first run. Click **More info → Run anyway** to proceed.

**Portable usage**: double-click `mdv.exe` to open the bundled sample, or drag a folder / `.md` file onto its icon to open that instead. From a terminal: `mdv.exe "C:\path\to\notes"`.

**Installer usage**: run the installer, optionally check "Add to PATH", then launch from the Start Menu or a terminal (`mdv <path>`).

## Run from source (any OS)

Requires Node.js ≥ 20.6.

```bash
git clone https://github.com/suguruma/md-viewer.git
cd md-viewer
npm install
npm start -- <folder-or-file>     # or: npm run sample
```

### CLI options

```
mdv [path] [options]

  path            .md file or folder to open (default: current directory)

  -p, --port N    Port (default 8931, auto-increments if busy)
      --host H    Bind address (default 127.0.0.1)
      --no-open   Do not auto-open a browser
      --poll      Use polling for file watching (e.g. some cloud-synced folders)
  -h, --help      Show help
```

## Usage

| Action | How |
| --- | --- |
| Switch file | Click the sidebar tree, or focus it and use `↑`/`↓`/`→`/`←`/`Home`/`End`/`Enter` |
| Open a different folder | "Open folder" button at the top of the sidebar (prompts for an absolute path) |
| Find in page | Toolbar search box (shortcut `/`); `Enter`/`Shift+Enter` to cycle, `Esc` to clear |
| Search all files | Sidebar search box (2+ characters); click a result to open and highlight |
| Jump to heading | Click an entry in the outline panel (or open it from the toolbar button on narrow screens) |
| Toggle theme | Top-right button |
| Copy code | Hover a code block, click "Copy" |
| Print / export PDF | Your browser's print dialog — a dedicated stylesheet hides the UI chrome |

Relative links (`./other.md`, `../index.md#heading`) navigate inside the viewer; relative images render directly.

## Extending with plugins

Rendering runs through a [unified](https://unifiedjs.com/) (remark/rehype) pipeline. Add plugins by editing `md-viewer.config.mjs` at the project root — **no application code changes needed**:

```js
// md-viewer.config.mjs
import remarkGithub from 'remark-github'   // npm install remark-github

export default {
  remarkPlugins: [[remarkGithub, { repository: 'owner/repo' }]],
  rehypePlugins: [rehypeExternalLinksNewTab],  // ships by default
  shiki: {},                                    // override theme names here
}
```

Emoji shortcodes (`:smile:`) are already built in via `remark-emoji`, no config needed. Restart the server to apply config changes. User plugins run after all built-in processing, right before HTML serialization.

## Limitations (by design)

- Files over 2 MB render as plain text (no highlighting/math) to bound worst-case latency
- Cross-file search is a plain substring scan — no regex, no index
- No HTML sanitization (`rehype-raw` allows raw HTML) — this is a viewer for **your own local files**, bound to `127.0.0.1` by default; add `rehype-sanitize` via the config if you'll open untrusted Markdown
- The "Open folder" feature can re-root the server to any directory the OS user can read, with no allowlist — another reason not to bind beyond `127.0.0.1` on an untrusted network
- View-only; there is no editor

## Documentation

- [docs/FEATURES.md](docs/FEATURES.md) / [docs/FEATURES.ja.md](docs/FEATURES.ja.md) — full feature specification (English / Japanese)
- [docs/DESIGN.md](docs/DESIGN.md) — technology choices, architecture, rationale
- [docs/PROCESS.md](docs/PROCESS.md) — development process log

## License

[MIT](LICENSE)
