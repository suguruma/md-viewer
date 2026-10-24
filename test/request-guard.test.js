import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHostAllowed, isOriginAllowed, createRequestGuard } from '../server/request-guard.js'

const req = (headers) => ({ headers })

test('Host: localhost と IP アドレスは、大文字小文字・ポートの有無にかかわらず許可する', () => {
  for (const host of [
    'localhost', 'localhost:8931', 'LOCALHOST:8931', 'localhost.:8931',
    '127.0.0.1', '127.0.0.1:8931', '192.168.1.5:8931', '0.0.0.0:8931',
    '[::1]', '[::1]:8931', '[::ffff:127.0.0.1]:8931', '[FE80::1]:8931',
  ]) {
    assert.equal(isHostAllowed(host), true, host)
  }
})

test('Host: 攻撃者のドメイン名や、IP・localhost に見せかけた名前は拒否する', () => {
  for (const host of [
    undefined, '', ' ', ['localhost'],
    'evil.example', 'evil.example:8931',
    'localhost.evil.example', '127.0.0.1.evil.example', '127.0.0.1.nip.io:8931',
    'evil.example@127.0.0.1', '127.0.0.1@evil.example', '127.0.0.1:8931@evil.example',
    'localhost:', 'localhost:abc', 'localhost:8931/', 'localhost/', 'local host', 'foo.localhost',
    'localhost..', '[::1', '::1', '[::1]x', '[localhost]', '2130706433', '0x7f.1', '127.1',
  ]) {
    assert.equal(isHostAllowed(host), false, String(host))
  }
})

test('createRequestGuard: --allowed-host と、名前で指定した --host だけが追加で許可される', () => {
  const guard = createRequestGuard({ host: '127.0.0.1', allowedHosts: ['MyPC', 'nas.local:9000', '192.168.1.5'] })
  for (const host of ['mypc:8931', 'MYPC', 'mypc.:8931', 'nas.local:8931', '192.168.1.9:8931']) {
    assert.equal(guard.check(req({ host })).ok, true, host)
  }
  for (const host of ['other:8931', 'mypc.evil.example', 'nas']) {
    assert.equal(guard.check(req({ host })).ok, false, host)
  }

  assert.equal(createRequestGuard({ host: 'devbox' }).check(req({ host: 'devbox:1' })).ok, true)
  assert.equal(createRequestGuard({ host: '0.0.0.0' }).check(req({ host: 'devbox:1' })).ok, false)
  assert.equal(createRequestGuard({ host: '::' }).check(req({ host: 'devbox:1' })).ok, false)
})

test('createRequestGuard: --allowed-host に不正な値を渡すと起動時に失敗する', () => {
  for (const bad of ['', 'a/b', 'evil.example@x', 'x y', 'http://mypc']) {
    assert.throws(() => createRequestGuard({ allowedHosts: [bad] }), /--allowed-host/, bad)
  }
})

test('Origin: 無ければ許可、あれば Host と同じオリジンのときだけ許可する', () => {
  assert.equal(isOriginAllowed(undefined, '127.0.0.1:8931'), true)
  assert.equal(isOriginAllowed('http://127.0.0.1:8931', '127.0.0.1:8931'), true)
  assert.equal(isOriginAllowed('HTTP://LOCALHOST:8931', 'localhost:8931'), true)
  assert.equal(isOriginAllowed('https://mdv.example', 'mdv.example'), true)

  for (const origin of [
    'null', '', 'https://evil.example', 'http://evil.example:8931',
    'http://localhost:8931', 'http://127.0.0.1:9999',
    'http://127.0.0.1:8931@evil.example', 'http://127.0.0.1:8931/x', 'file://', 'ftp://127.0.0.1:8931',
    ['http://127.0.0.1:8931'],
  ]) {
    assert.equal(isOriginAllowed(origin, '127.0.0.1:8931'), false, String(origin))
  }
  assert.equal(isOriginAllowed('http://127.0.0.1:8931', undefined), false)
})

test('createRequestGuard: DNS リバインディングと他サイトからの要求を拒否し、通常の要求は通す', () => {
  const guard = createRequestGuard({ host: '127.0.0.1' })

  // 通常のブラウザ操作(同一オリジンの POST・WebSocket、アドレスバーからの GET)
  assert.deepEqual(guard.check(req({ host: '127.0.0.1:8931', origin: 'http://127.0.0.1:8931' })), { ok: true })
  assert.deepEqual(guard.check(req({ host: 'localhost:8931' })), { ok: true })

  // DNS リバインディング: ブラウザ上は同一オリジンだが、Host が攻撃者のドメイン
  const rebinding = guard.check(req({ host: 'evil.example:8931', origin: 'http://evil.example:8931' }))
  assert.equal(rebinding.ok, false)
  assert.equal(rebinding.reason, 'host')

  // 他サイトのページからの要求: Host は正しいが Origin が違う
  const crossSite = guard.check(req({ host: '127.0.0.1:8931', origin: 'https://evil.example' }))
  assert.equal(crossSite.ok, false)
  assert.equal(crossSite.reason, 'origin')

  // 別のローカルサービス(別ポート)のページからの要求も拒否する
  assert.equal(guard.check(req({ host: '127.0.0.1:8931', origin: 'http://127.0.0.1:3000' })).ok, false)

  // Host が無い要求は拒否する
  assert.equal(guard.check(req({})).ok, false)
})

test('拒否メッセージは、値の制御文字をそのまま出さず、長さも切り詰める', () => {
  const guard = createRequestGuard({})
  const verdict = guard.check(req({ host: 'evil\r\nX-Injected: 1' }))
  assert.equal(verdict.ok, false)
  assert.ok(!/[\r\n]/.test(verdict.message))

  const long = guard.check(req({ host: 'a'.repeat(5000) }))
  assert.ok(long.message.length < 400)
})
