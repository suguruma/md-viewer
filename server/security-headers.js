// 他サイトのページからの読み込み・埋め込みを、ブラウザ側で止めるための応答ヘッダー(DESIGN §11)。
//
// request-guard.js の Host / Origin の検査は、ブラウザが Origin を付ける要求(fetch・XHR・WebSocket・フォームの POST)にしか効かない。
// 他サイトのページが <script>・<img> で読み込む要求には Origin が付かず、Host もビューアー自身のものなので、検査を通ってしまう。
// そこで応答にヘッダーを付け、他サイトからの利用をブラウザに拒否させる。
export const SECURITY_HEADERS = Object.freeze({
  // 他のオリジンのページからの <script>・<img>・<link>・no-cors の fetch による読み込みを、ブラウザが応答の段階で破棄する
  // (内容を読めないだけでなく、ファイルの有無も onload / onerror の違いから分からなくなる)。
  // same-site は別ポートの別サーバーのページを許してしまうため、ポートまで比べる same-origin にする
  'Cross-Origin-Resource-Policy': 'same-origin',
  // 他サイトのページの <iframe> などに埋め込まれない(クリックジャッキングの対策)。
  // アプリ自身は iframe を使わず、ポップアウトも window.open なので、自分自身('self')だけ許せばよい
  'Content-Security-Policy': "frame-ancestors 'self'",
})

// 検査で断る 403 や、見つからない 404 を含むすべての応答に付けるため、Express の最初のミドルウェアとして使う
export function securityHeaders(req, res, next) {
  res.set(SECURITY_HEADERS)
  next()
}
