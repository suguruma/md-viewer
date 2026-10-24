import net from 'node:net'

// ループバックにバインドしたローカルサーバーでも、悪意のある Web ページ経由で到達されうる。
//   - DNS リバインディング: 攻撃者のドメインを 127.0.0.1 に解決させ、ブラウザ上は同一オリジンとして API を叩く
//   - 他サイトからのリクエスト・WebSocket 接続(WebSocket は CORS の対象外)
// そこで、すべての HTTP リクエストと WebSocket のハンドシェイクで次の2点を検査する。
//   1. Host ヘッダーのホスト名が、localhost・IP アドレス(リテラル)・明示的に許可した名前のどれかであること。
//      ブラウザは URL のホスト名をそのまま Host に載せ、JS からは書き換えられない。攻撃者のドメイン名は
//      IP でも localhost でもないため弾ける(IP アドレスでの接続は、攻撃者のドメインを経由できないので安全)
//   2. Origin ヘッダーがあるときは、Host と同じオリジンであること。ブラウザは他サイトからの要求に必ず
//      Origin を付ける。Origin の無い要求(アドレスバーへの直接入力、curl など)は通す

// host[:port]。ホスト名は [IPv6]、または英数字・ハイフン・ドット。userinfo(@)・空白・スラッシュは通さない
const HOST_PATTERN = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+))(?::(\d{1,5}))?$/

// Host ヘッダー(または --allowed-host の値)を { name, ipv6 } に分解する。形式が不正なら null
export function parseHost(value) {
  if (typeof value !== 'string') return null
  const m = HOST_PATTERN.exec(value.trim().toLowerCase())
  if (!m) return null
  return m[1] !== undefined ? { name: m[1], ipv6: true } : { name: m[2], ipv6: false }
}

// allowedNames: 正規化済み(小文字・末尾のドットなし)の名前の集合。localhost と IP アドレスは常に許可される
export function isHostAllowed(hostHeader, allowedNames = new Set()) {
  const host = parseHost(hostHeader)
  if (!host) return false
  if (host.ipv6) return net.isIPv6(host.name)
  if (net.isIPv4(host.name)) return true
  // 完全修飾名の末尾のドット(localhost.)は1つだけ許す。IP アドレスには付けられない
  const name = host.name.endsWith('.') ? host.name.slice(0, -1) : host.name
  return name === 'localhost' || allowedNames.has(name)
}

// Origin が無ければ許可(ブラウザ以外、または同一オリジンの GET)。あれば Host と同じオリジンのときだけ許可。
// 'null'(sandbox された iframe など)や他のオリジンは弾く
export function isOriginAllowed(originHeader, hostHeader) {
  if (originHeader === undefined) return true
  if (typeof originHeader !== 'string' || typeof hostHeader !== 'string') return false
  const origin = originHeader.trim().toLowerCase()
  const host = hostHeader.trim().toLowerCase()
  return origin === `http://${host}` || origin === `https://${host}`
}

// 要求の Host / Origin を検査するガードを作る。
//   host: バインド先(--host)。名前(PC 名など)ならその名前も許可する。0.0.0.0 などの IP は影響しない
//   allowedHosts: --allowed-host で追加で許可する名前(localhost・IP 以外の名前でアクセスするとき用)
export function createRequestGuard({ host, allowedHosts = [] } = {}) {
  const allowed = new Set()
  for (const value of allowedHosts) {
    const parsed = parseHost(value)
    if (!parsed) throw new Error(`--allowed-host の値が不正です(ホスト名を指定してください): ${value}`)
    // IP アドレスは常に許可されるため、指定されても何もしない
    if (!parsed.ipv6 && !net.isIP(parsed.name)) allowed.add(parsed.name.replace(/\.$/, ''))
  }
  const bound = parseHost(host)
  if (bound && !bound.ipv6 && !net.isIP(bound.name)) allowed.add(bound.name.replace(/\.$/, ''))

  // 画面やログに出す値は長さを切り詰める(JSON として出力されるため、制御文字はエスケープされる)
  const shown = (value) => JSON.stringify(String(value).slice(0, 100))

  return {
    // req: http.IncomingMessage。{ ok: true } または { ok: false, reason, value, message } を返す
    check(req) {
      const hostHeader = req.headers.host
      if (!isHostAllowed(hostHeader, allowed)) {
        return {
          ok: false,
          reason: 'host',
          value: String(hostHeader),
          message:
            `Host ヘッダー ${shown(hostHeader)} は許可されていません(DNS リバインディング対策)。` +
            'localhost や IP アドレス以外の名前でアクセスするときは、起動時に --allowed-host <名前> を指定してください',
        }
      }
      if (!isOriginAllowed(req.headers.origin, hostHeader)) {
        return {
          ok: false,
          reason: 'origin',
          value: String(req.headers.origin),
          message: `Origin ヘッダー ${shown(req.headers.origin)} が Host と一致しません(他のサイトからの要求は受け付けません)`,
        }
      }
      return { ok: true }
    },
  }
}
