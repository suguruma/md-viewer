# シンタックスハイライト

shiki によるハイライト。ライト/ダークで別テーマが適用されます(右上のボタンで切替)。

## JavaScript

```js
// フィボナッチ(メモ化)
const memo = new Map()
function fib(n) {
  if (n <= 1) return n
  if (memo.has(n)) return memo.get(n)
  const v = fib(n - 1) + fib(n - 2)
  memo.set(n, v)
  return v
}
console.log(fib(40))
```

## TypeScript

```ts
interface TreeNode {
  name: string
  path: string
  children?: TreeNode[]
}

function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (acc, n) => acc + (n.children ? countFiles(n.children) : 1),
    0,
  )
}
```

## Python

```python
from pathlib import Path

def find_markdown(root: Path) -> list[Path]:
    """指定フォルダ配下の .md を列挙する"""
    return sorted(p for p in root.rglob("*.md") if not p.name.startswith("."))

for p in find_markdown(Path.cwd()):
    print(p.relative_to(Path.cwd()))
```

## シェルと差分

```bash
npm start -- ~/notes --port 9000
```

```diff
- const theme = 'light'
+ const theme = localStorage.getItem('mdv.theme') ?? 'light'
```

## JSON

```json
{
  "name": "md-viewer",
  "features": ["tree", "search", "mermaid", "katex"],
  "port": 8931
}
```

## 未知の言語(フォールバック確認)

言語名が不明な場合は例外を出さず、プレーン表示になります:

```hogehoge
これは存在しない言語指定のコードブロック。
ハイライトなしでそのまま表示されれば正常。
```
