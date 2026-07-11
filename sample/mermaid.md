# Mermaid ダイアグラム

コードブロックに `mermaid` を指定すると図として描画されます。
テーマ切替(ライト/ダーク)にも追従します。

## フローチャート

```mermaid
flowchart TD
    A[Markdown ファイル] --> B{サイズ 2MB 以下?}
    B -- はい --> C[unified パイプライン]
    B -- いいえ --> D[プレーン表示]
    C --> E[GFM / 数式 / ハイライト]
    E --> F[HTML をブラウザへ]
    D --> F
    F --> G[mermaid をクライアントで描画]
```

## シーケンス図

```mermaid
sequenceDiagram
    participant E as エディタ
    participant W as chokidar(監視)
    participant S as サーバー
    participant B as ブラウザ
    E->>W: ファイル保存
    W->>S: change イベント
    S->>B: WebSocket "doc-changed"
    B->>S: GET /api/doc
    S-->>B: 再レンダリング済み HTML
```

## 円グラフ

```mermaid
pie title 実装工数の内訳
    "レンダリング" : 35
    "UI" : 30
    "監視・検索" : 20
    "ドキュメント" : 15
```

## 構文エラーの扱い

構文が壊れている場合は、エラーメッセージと元ソースが表示されます(画面全体は壊れません):

```mermaid
flowchart TD
    A --> ここは不正な構文 --> --> B
```
