import test from 'node:test'
import assert from 'node:assert/strict'
import { createApi, issueSession, hasSession, validateSettings, DEFAULT_SETTINGS } from '../netlify/functions/api/lib/core.mjs'
import { storeName } from '../netlify/functions/api/lib/storage.mjs'

const ORIGIN = 'https://signal.example'
const credentials = {
  ADMIN_SECRET: 'test-password-that-is-private',
  SESSION_SECRET: 'a-random-test-session-secret-over-thirty-two-characters',
}
const muxCredentials = { MUX_TOKEN_ID: 'test-token-id', MUX_TOKEN_SECRET: 'server-secret-not-public' }

function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: async (key) => values.has(key) ? structuredClone(values.get(key)) : null,
    set: async (key, value, options) => {
      if (options?.onlyIfNew && values.has(key)) return { modified: false }
      values.set(key, structuredClone(value))
      return { modified: true }
    },
    list: async (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
    listPrefixes: async (prefix) => [...new Set([...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => `${prefix}${key.slice(prefix.length).split('/')[0]}/`))],
    delete: async (key) => { values.delete(key) },
  }
}

function harness({ vars = {}, initial = {}, fetcher } = {}) {
  const store = memoryStore(initial)
  const config = { ...credentials, ...vars }
  const env = (key) => config[key]
  let timestamp = Date.parse('2026-10-16T20:00:00Z')
  let providerCalls = 0
  const api = createApi({ env, storage: store, now: () => timestamp, fetcher: async (...args) => { providerCalls++; if (fetcher) return fetcher(...args); throw new Error('unexpected provider fetch') } })
  const request = (route, { method = 'GET', body, cookie, origin = ORIGIN, headers = {} } = {}) => {
    return new Request(`${ORIGIN}/.netlify/functions/api/${route}`, {
      method,
      headers: { ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
  }
  const call = (route, options) => api(request(route, options), { ip: '203.0.113.9' })
  const login = async () => {
    const response = await call('login', { method: 'POST', body: { password: credentials.ADMIN_SECRET } })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie').split(';')[0]
  }
  return { api, store, config, env, request, call, login, advance: (ms) => { timestamp += ms }, get providerCalls() { return providerCalls } }
}

function muxStub({ status = 'idle', playback = 'public-playback', activeAsset = null, recentAssets = [] } = {}) {
  const stream = { id: 'stream-one', status, stream_key: 'secret-encoder-key', playback_ids: playback ? [{ id: playback, policy: 'public' }] : [], active_asset_id: activeAsset, recent_asset_ids: recentAssets }
  const calls = []
  return {
    stream,
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options })
      if (url.endsWith('/live-streams') && options.method === 'POST') return Response.json({ data: stream }, { status: 201 })
      if (url.endsWith('/enable')) { stream.status = 'idle'; return Response.json({ data: {} }) }
      if (url.endsWith('/disable')) { stream.status = 'disabled'; return Response.json({ data: {} }) }
      if (url.includes('/assets/')) return Response.json({ data: { id: 'asset-one', created_at: '1792180800', status: 'ready' } })
      return Response.json({ data: stream })
    },
  }
}

test('demo mode returns honest offline metadata and never calls Mux or invents viewers', async () => {
  const h = harness()
  const response = await h.call('status')
  assert.equal(response.status, 200)
  const status = await response.json()
  assert.equal(status.mode, 'demo')
  assert.equal(status.status, 'offline')
  assert.equal(status.viewerCount, null)
  assert.equal(status.startedAt, null)
  assert.equal(status.playbackUrl, null)
  assert.equal(status.title, DEFAULT_SETTINGS.title)
  assert.equal(h.providerCalls, 0)
  assert.match(response.headers.get('cache-control'), /no-store/)
})

test('demo presence returns null without persisting fake visits', async () => {
  const h = harness()
  const response = await h.call('presence', { method: 'POST', body: { viewerId: 'anonymous-viewer-1234' } })
  assert.deepEqual(await response.json(), { viewerCount: null, approximate: true })
  assert.equal(h.store.values.size, 0)
})

test('explicit demo mode suppresses Mux calls and viewer statistics even if credentials exist', async () => {
  const h = harness({ vars: { ...muxCredentials, STREAM_PROVIDER: 'demo' } })
  const data = await (await h.call('status')).json()
  assert.equal(data.mode, 'demo')
  assert.equal(data.viewerCount, null)
  assert.equal(h.providerCalls, 0)
})

test('admin endpoints reject unauthenticated access and missing config never enables a default password', async () => {
  const h = harness({ vars: { ADMIN_SECRET: '', SESSION_SECRET: '' } })
  assert.deepEqual(await (await h.call('session')).json(), { authenticated: false, configured: false })
  for (const endpoint of ['admin', 'ingest']) assert.equal((await h.call(endpoint)).status, 401)
  const response = await h.call('login', { method: 'POST', body: { password: 'admin' } })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'AUTH_UNCONFIGURED')
})

test('login sets an HttpOnly Secure SameSite strict host-only cookie and session authenticates', async () => {
  const h = harness()
  const response = await h.call('login', { method: 'POST', body: { password: credentials.ADMIN_SECRET } })
  const setCookie = response.headers.get('set-cookie')
  assert.match(setCookie, /^__Host-signal_session=/)
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)
  assert.match(setCookie, /Secure/)
  assert.doesNotMatch(setCookie, /Domain=/)
  const cookie = setCookie.split(';')[0]
  assert.deepEqual(await (await h.call('session', { cookie })).json(), { authenticated: true, configured: true })
  assert.equal((await h.call('admin', { cookie })).status, 200)
  const publicResponse = await response.text()
  assert.ok(!publicResponse.includes(credentials.ADMIN_SECRET))
  assert.ok(!publicResponse.includes(credentials.SESSION_SECRET))
})

test('invalid login returns no session and login attempts are limited across instances', async () => {
  const h = harness()
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await h.call('login', { method: 'POST', body: { password: 'incorrect' } })
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('set-cookie'), null)
  }
  // A fresh warm instance shares the same persistent attempt records.
  const fresh = createApi({ env: h.env, storage: h.store, now: () => Date.parse('2026-10-16T20:00:00Z') })
  const blocked = await fresh(h.request('login', { method: 'POST', body: { password: credentials.ADMIN_SECRET } }), { ip: '203.0.113.9' })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('retry-after'), '900')
  h.advance(15 * 60 * 1000 + 1)
  assert.equal((await h.call('login', { method: 'POST', body: { password: credentials.ADMIN_SECRET } })).status, 200)
})

test('sessions reject tampering, expiry, password rotation, and another origin', async () => {
  const h = harness()
  const cookie = await h.login()
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')
  assert.equal((await (await h.call('session', { cookie: tampered })).json()).authenticated, false)
  const token = cookie.split('=')[1]
  const other = new Request('https://another.example/.netlify/functions/api/admin', { headers: { Cookie: `__Host-signal_session=${token}` } })
  assert.equal(hasSession(other, h.env, Date.parse('2026-10-16T20:00:00Z')), false)
  h.config.ADMIN_SECRET = 'another-new-private-admin-password'
  assert.equal((await (await h.call('session', { cookie })).json()).authenticated, false)
  h.config.ADMIN_SECRET = credentials.ADMIN_SECRET
  h.advance(8 * 60 * 60 * 1000)
  assert.equal((await (await h.call('session', { cookie })).json()).authenticated, false)
})

test('localhost cookies permit Netlify Dev without requiring HTTPS', () => {
  const h = harness()
  const request = new Request('http://localhost:8888/.netlify/functions/api/session')
  const timestamp = Date.parse('2026-10-16T20:00:00Z')
  const token = issueSession(request, h.env, timestamp)
  const signed = new Request(request.url, { headers: { Cookie: `signal_session=${token}` } })
  assert.equal(hasSession(signed, h.env, timestamp), true)
})

test('cross-origin, missing-Origin, same-site-subdomain, and non-JSON mutations are rejected', async () => {
  const h = harness()
  const body = { password: credentials.ADMIN_SECRET }
  assert.equal((await h.call('login', { method: 'POST', body, origin: 'https://evil.example' })).status, 403)
  const noOrigin = new Request(`${ORIGIN}/.netlify/functions/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await h.api(noOrigin)).status, 403)
  assert.equal((await h.call('login', { method: 'POST', body, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403)
  assert.equal((await h.call('login', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })).status, 415)
})

test('malformed and oversized bodies fail without processing credentials', async () => {
  const h = harness()
  assert.equal((await h.call('login', { method: 'POST', body: '{' })).status, 400)
  assert.equal((await h.call('login', { method: 'POST', body: 'null' })).status, 400)
  assert.equal((await h.call('login', { method: 'POST', body: 'x'.repeat(13 * 1024) })).status, 413)
})

test('logout clears the session cookie', async () => {
  const h = harness()
  const response = await h.call('logout', { method: 'POST', body: {} })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
})

test('settings and timezone-aware schedules persist in storage and are read by viewers', async () => {
  const h = harness()
  const cookie = await h.login()
  const settings = { title: 'Community night', category: 'Technology', description: 'Building something together.', nextStream: { title: 'Friday stream', startsAt: '2026-10-23T19:30:00-04:00' } }
  const response = await h.call('settings', { method: 'PUT', cookie, body: settings })
  assert.equal(response.status, 200)
  const saved = (await response.json()).settings
  assert.equal(saved.nextStream.startsAt, '2026-10-23T23:30:00.000Z')
  assert.deepEqual(h.store.values.get('settings'), saved)
  const publicStatus = await (await h.call('status')).json()
  assert.equal(publicStatus.title, settings.title)
  assert.deepEqual(publicStatus.nextStream, saved.nextStream)
})

test('settings reject missing titles, oversized descriptions, and timezone-less schedules', () => {
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, title: '' }), /title/)
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, description: 'x'.repeat(2001) }), /description/)
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, nextStream: { title: 'Hello', startsAt: '2026-10-17T20:00' } }), /timezone/)
})

test('storage failures surface a sanitized actionable error', async () => {
  const api = createApi({ storage: () => { throw new Error('private service credential') } })
  const response = await api(new Request(`${ORIGIN}/.netlify/functions/api/status`))
  const data = await response.json()
  assert.equal(response.status, 503)
  assert.equal(data.error.code, 'STORAGE_UNAVAILABLE')
  assert.ok(!JSON.stringify(data).includes('private service credential'))
})

test('partial and unsupported provider configurations produce explicit error state', async () => {
  for (const vars of [{ MUX_TOKEN_ID: 'incomplete' }, { STREAM_PROVIDER: 'livekit' }, { ...muxCredentials, MUX_LIVE_STREAM_ID: '../escape' }]) {
    const h = harness({ vars })
    const response = await h.call('status')
    const data = await response.json()
    assert.equal(data.mode, 'error')
    assert.equal(data.status, 'offline')
    assert.ok(data.configurationError)
    assert.equal(h.providerCalls, 0)
  }
})

test('public status never creates a paid provider resource', async () => {
  const h = harness({ vars: muxCredentials })
  assert.equal((await (await h.call('status')).json()).status, 'offline')
  assert.equal(h.providerCalls, 0)
})

test('prepare creates a real Mux resource only for an authenticated admin and persists its ID', async () => {
  const provider = muxStub()
  const h = harness({ vars: muxCredentials, fetcher: provider.fetcher })
  const cookie = await h.login()
  const response = await h.call('stream', { method: 'POST', cookie, body: { action: 'prepare' } })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.stream.status, 'preparing')
  assert.equal(payload.stream.viewerCount, 0)
  assert.equal(h.store.values.get('stream-lifecycle').liveStreamId, 'stream-one')
  const create = provider.calls.find(({ options }) => options.method === 'POST')
  assert.equal(create.url, 'https://api.mux.com/video/v1/live-streams')
  assert.deepEqual(JSON.parse(create.options.body).playback_policies, ['public'])
  assert.match(create.options.headers.Authorization, /^Basic /)
  assert.ok(!JSON.stringify(payload).includes('secret-encoder-key'))
  assert.ok(!JSON.stringify(payload).includes(muxCredentials.MUX_TOKEN_SECRET))
})

test('concurrent prepare double-clicks share one creation in a warm instance', async () => {
  const provider = muxStub()
  const h = harness({ vars: muxCredentials, fetcher: provider.fetcher })
  const cookie = await h.login()
  const responses = await Promise.all([h.call('stream', { method: 'POST', cookie, body: { action: 'prepare' } }), h.call('stream', { method: 'POST', cookie, body: { action: 'prepare' } })])
  assert.equal(responses[0].status, 200)
  assert.equal(responses[1].status, 200)
  assert.equal(provider.calls.filter(({ options }) => options.method === 'POST').length, 1)
})

test('live status is based on Mux activity, exposes public HLS only, and uses actual asset start time', async () => {
  const provider = muxStub({ status: 'active', activeAsset: 'asset-one' })
  const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one' }, fetcher: provider.fetcher })
  const response = await h.call('status')
  const data = await response.json()
  assert.equal(data.mode, 'configured')
  assert.equal(data.status, 'live')
  assert.equal(data.playbackUrl, 'https://stream.mux.com/public-playback.m3u8')
  assert.equal(data.startedAt, new Date(1792180800 * 1000).toISOString())
  assert.ok(!JSON.stringify(data).includes(provider.stream.stream_key))
  assert.ok(!JSON.stringify(data).includes(muxCredentials.MUX_TOKEN_SECRET))
})

test('idle Mux state with a previous recording becomes ended, never live', async () => {
  const provider = muxStub({ recentAssets: ['asset-one'] })
  const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one' }, fetcher: provider.fetcher })
  const data = await (await h.call('status')).json()
  assert.equal(data.status, 'ended')
  assert.equal(data.playbackUrl, null)
  assert.equal(data.startedAt, null)
})

test('ending disables the actual Mux input and preparing later re-enables it', async () => {
  const provider = muxStub({ status: 'active' })
  const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one' }, fetcher: provider.fetcher })
  const cookie = await h.login()
  const ended = await h.call('stream', { method: 'POST', cookie, body: { action: 'end' } })
  assert.equal(ended.status, 200)
  assert.equal((await ended.json()).stream.status, 'ended')
  assert.ok(provider.calls.some(({ url, options }) => url.endsWith('/disable') && options.method === 'PUT'))
  const prepared = await h.call('stream', { method: 'POST', cookie, body: { action: 'prepare' } })
  assert.equal(prepared.status, 200)
  assert.equal((await prepared.json()).stream.status, 'preparing')
  assert.ok(provider.calls.some(({ url, options }) => url.endsWith('/enable') && options.method === 'PUT'))
})

test('only explicit authenticated ingest endpoint returns a stream key with no-store headers', async () => {
  const provider = muxStub()
  const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one' }, fetcher: provider.fetcher })
  assert.equal((await h.call('ingest')).status, 401)
  const cookie = await h.login()
  const admin = await (await h.call('admin', { cookie })).json()
  assert.ok(!JSON.stringify(admin).includes(provider.stream.stream_key))
  const ingest = await h.call('ingest', { cookie })
  assert.match(ingest.headers.get('cache-control'), /no-store/)
  assert.equal((await ingest.json()).streamKey, provider.stream.stream_key)
})

test('private signed playback IDs and mismatched playback IDs are not exposed as usable public HLS', async () => {
  for (const scenario of ['signed', 'mismatch']) {
    const provider = muxStub({ status: 'active' })
    if (scenario === 'signed') provider.stream.playback_ids[0].policy = 'signed'
    const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one', ...(scenario === 'mismatch' ? { MUX_PLAYBACK_ID: 'another-id' } : {}) }, fetcher: provider.fetcher })
    const data = await (await h.call('status')).json()
    assert.equal(data.mode, 'error')
    assert.equal(data.playbackUrl, null)
    assert.ok(data.configurationError.includes('public'))
  }
})

test('provider credentials and raw error bodies never reach the browser', async () => {
  const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one' }, fetcher: async () => new Response('secret-encoder-key server-secret-not-public stack trace', { status: 401 }) })
  const response = await h.call('status')
  const text = await response.text()
  assert.ok(text.includes('Mux rejected'))
  assert.ok(!text.includes('server-secret-not-public'))
  assert.ok(!text.includes('secret-encoder-key'))
  assert.ok(!text.includes('stack trace'))
})

test('network failures return an explicit status error instead of fake live data', async () => {
  const h = harness({ vars: { ...muxCredentials, MUX_LIVE_STREAM_ID: 'stream-one' }, fetcher: async () => { throw new Error('private network debug') } })
  const data = await (await h.call('status')).json()
  assert.equal(data.mode, 'error')
  assert.equal(data.playbackUrl, null)
  assert.match(data.configurationError, /could not be reached/)
})

test('presence counts only distinct recent real heartbeat IDs and expires disconnected viewers', async () => {
  const h = harness({ vars: muxCredentials })
  const heartbeat = (viewerId) => h.call('presence', { method: 'POST', body: { viewerId } })
  assert.equal((await (await heartbeat('viewer-one-123456789')).json()).viewerCount, 1)
  assert.equal((await (await heartbeat('viewer-one-123456789')).json()).viewerCount, 1)
  assert.equal((await (await heartbeat('viewer-two-123456789')).json()).viewerCount, 2)
  assert.ok([...h.store.values.keys()].every((key) => !key.includes('viewer-one')))
  h.advance(71 * 1000)
  assert.equal((await (await heartbeat('viewer-two-123456789')).json()).viewerCount, 1)
  const invalid = await heartbeat('../../not-anonymous')
  assert.equal(invalid.status, 400)
  assert.equal((await (await h.call('status')).json()).viewerCount, 1)
})

test('heartbeat activity cleans fully expired presence buckets without deleting recent visitors', async () => {
  const oldBucket = Math.floor(Date.parse('2026-10-16T19:00:00Z') / 60000)
  const oldKey = `presence/${oldBucket}/old-device-hash`
  const h = harness({ vars: muxCredentials, initial: { [oldKey]: { expiresAt: Date.parse('2026-10-16T19:01:10Z') } } })
  await h.call('presence', { method: 'POST', body: { viewerId: 'current-viewer-123456789' } })
  assert.equal(h.store.values.has(oldKey), false)
  assert.equal([...h.store.values.keys()].filter((key) => key.startsWith('presence/')).length, 1)
})

test('production and preview stores stay isolated but production store survives deploys', () => {
  const name = (vars) => storeName((key) => vars[key])
  assert.equal(name({ CONTEXT: 'production' }), name({ CONTEXT: 'production', DEPLOY_ID: 'new-deploy' }))
  assert.notEqual(name({ CONTEXT: 'production' }), name({ CONTEXT: 'deploy-preview', REVIEW_ID: '24' }))
  assert.notEqual(name({ CONTEXT: 'deploy-preview', REVIEW_ID: '24' }), name({ CONTEXT: 'deploy-preview', REVIEW_ID: '25' }))
  assert.notEqual(name({ CONTEXT: 'branch-deploy', BRANCH: 'alpha' }), name({ CONTEXT: 'branch-deploy', BRANCH: 'beta' }))
  assert.equal(storeName(() => undefined, { deploy: { context: 'production', id: 'deploy-one' } }), name({ CONTEXT: 'production' }))
  assert.notEqual(storeName(() => undefined, { deploy: { context: 'deploy-preview', id: 'deploy-one' } }), storeName(() => undefined, { deploy: { context: 'deploy-preview', id: 'deploy-two' } }))
})
