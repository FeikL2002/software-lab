import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { siteConfig } from '../../../../src/config/site.js'

const SESSION_SECONDS = 8 * 60 * 60
const LOGIN_WINDOW = 15 * 60 * 1000
const LOGIN_LIMIT = 8
const PRESENCE_TTL = 70 * 1000
const MAX_BODY_BYTES = 12 * 1024
const MUX_BASE = 'https://api.mux.com/video/v1'
const SERVER_URL = 'rtmps://global-live.mux.com:443/app'

// One public config supplies the initial metadata on both the server and client.
export const DEFAULT_SETTINGS = Object.freeze({
  ...siteConfig.defaultStream,
  nextStream: null,
})

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function hash(value) { return createHash('sha256').update(value).digest('hex') }
function sign(value, secret) { return createHmac('sha256', secret).update(value).digest('base64url') }
function safeEqual(a, b) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))) }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,255}$/.test(value) }
function isoFromSeconds(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null
}

export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_SETTINGS', 'Provide stream settings as a JSON object.')
  const text = (key, max, required = false) => {
    if (typeof input[key] !== 'string') throw new ApiError(400, 'INVALID_SETTINGS', `${key} must be text.`)
    const value = input[key].trim()
    if ((required && !value) || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
      throw new ApiError(400, 'INVALID_SETTINGS', `${key} must contain ${required ? '1' : '0'}–${max} characters.`)
    }
    return value
  }
  let nextStream = null
  if (input.nextStream !== null && input.nextStream !== undefined) {
    const next = input.nextStream
    if (!next || typeof next !== 'object' || typeof next.title !== 'string' || !next.title.trim() || next.title.trim().length > 120 || typeof next.startsAt !== 'string') {
      throw new ApiError(400, 'INVALID_SCHEDULE', 'A scheduled stream needs a title and an ISO date with a timezone.')
    }
    // Reject timezone-less dates, whose interpretation otherwise depends on the server.
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(next.startsAt) || !Number.isFinite(Date.parse(next.startsAt))) {
      throw new ApiError(400, 'INVALID_SCHEDULE', 'Use a valid scheduled date including its timezone.')
    }
    nextStream = { title: next.title.trim(), startsAt: new Date(next.startsAt).toISOString() }
  }
  return { title: text('title', 160, true), category: text('category', 64, true), description: text('description', 2000), nextStream }
}

export function authConfiguration(env) {
  return (env('ADMIN_SECRET') || '').length >= 16 && (env('SESSION_SECRET') || '').length >= 32
}

function cookieName(request) { return new URL(request.url).protocol === 'https:' ? '__Host-signal_session' : 'signal_session' }
function cookieHeader(request, token, seconds) {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}

export function issueSession(request, env, now) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(now / 1000) + SESSION_SECONDS,
    iat: Math.floor(now / 1000),
    aud: new URL(request.url).origin,
    v: sign(env('ADMIN_SECRET'), env('SESSION_SECRET')),
    nonce: randomBytes(18).toString('base64url'),
  })).toString('base64url')
  return `${payload}.${sign(payload, env('SESSION_SECRET'))}`
}

export function hasSession(request, env, now) {
  if (!authConfiguration(env)) return false
  try {
    const name = cookieName(request)
    const cookie = (request.headers.get('cookie') || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1)
    if (!cookie || cookie.length > 1500) return false
    const [payload, signature, extra] = cookie.split('.')
    if (!payload || !signature || extra || !safeEqual(signature, sign(payload, env('SESSION_SECRET')))) return false
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return Number.isSafeInteger(data.exp) && data.exp > Math.floor(now / 1000) && data.exp <= Math.floor(now / 1000) + SESSION_SECONDS && data.aud === new URL(request.url).origin && safeEqual(String(data.v), sign(env('ADMIN_SECRET'), env('SESSION_SECRET')))
  } catch { return false }
}

function secureMutation(request) {
  const origin = request.headers.get('origin')
  if (origin !== new URL(request.url).origin || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'This action must be submitted from this website.')
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new ApiError(415, 'JSON_REQUIRED', 'Send this request as application/json.')
  }
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new ApiError(413, 'BODY_TOO_LARGE', 'The request is too large.')
  const reader = request.body?.getReader()
  const chunks = []
  let length = 0
  if (reader) {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', 'The request is too large.') }
      chunks.push(value)
    }
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Object required')
    return data
  } catch { throw new ApiError(400, 'INVALID_JSON', 'The request body must be a valid JSON object.') }
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      ...headers,
    },
  })
}

function providerConfiguration(env) {
  const provider = (env('STREAM_PROVIDER') || 'mux').toLowerCase()
  const id = env('MUX_TOKEN_ID') || ''
  const secret = env('MUX_TOKEN_SECRET') || ''
  if (provider === 'demo') return { mode: 'demo', message: 'Demo mode is enabled. Set STREAM_PROVIDER=mux and configure Mux to broadcast.' }
  if (provider !== 'mux') return { mode: 'error', message: 'This build supports Mux. Set STREAM_PROVIDER=mux or add a provider adapter.' }
  if (!id && !secret) return { mode: 'demo', message: 'Mux is not connected. Add MUX_TOKEN_ID and MUX_TOKEN_SECRET to enable broadcasting.' }
  if (!id || !secret) return { mode: 'error', message: 'Mux configuration is incomplete. Both MUX_TOKEN_ID and MUX_TOKEN_SECRET are required.' }
  for (const key of ['MUX_LIVE_STREAM_ID', 'MUX_PLAYBACK_ID']) {
    if (env(key) && !validId(env(key))) return { mode: 'error', message: `${key} is not a valid Mux identifier.` }
  }
  return { mode: 'configured', message: 'Mux API credentials are configured.' }
}

export function createApi({ env = (key) => process.env[key], storage, fetcher = fetch, now = Date.now, onError = () => {} }) {
  // These caches reduce repeat provider reads within a warm instance. They are not state storage.
  const muxCache = new Map()
  const loginBursts = new Map()
  let preparingPromise = null
  let nextPresenceCleanup = 0

  async function getStorage(context) {
    try { return typeof storage === 'function' ? await storage(context) : storage } catch { throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Persistent storage is unavailable. Run with Netlify Dev or check the deployed function configuration.') }
  }
  async function readStore(store, key) {
    try { return await store.get(key) } catch { throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Persistent storage could not be read. Please try again.') }
  }
  async function writeStore(store, key, value) {
    try { await store.set(key, value) } catch { throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Persistent storage could not be updated. Your changes were not saved.') }
  }
  async function settingsFor(store) { return { ...DEFAULT_SETTINGS, ...await readStore(store, 'settings') } }
  async function mux(path, { method = 'GET', body, cache = true } = {}) {
    if (!/^\/(live-streams|assets)(?:\/[a-zA-Z0-9_-]+){0,2}$/.test(path)) throw new ApiError(500, 'INTERNAL_ERROR', 'The provider request could not be prepared.')
    const cached = muxCache.get(path)
    if (method === 'GET' && cache && cached?.until > now()) return cached.data
    let response
    try {
      response = await fetcher(`${MUX_BASE}${path}`, {
        method,
        headers: { Authorization: `Basic ${Buffer.from(`${env('MUX_TOKEN_ID')}:${env('MUX_TOKEN_SECRET')}`).toString('base64')}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(9000),
      })
    } catch { throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Mux could not be reached. Check your connection and try again.') }
    if (!response.ok) {
      const status = response.status
      if (status === 401 || status === 403) throw new ApiError(502, 'PROVIDER_AUTH', 'Mux rejected the server credentials or their video permissions. Check the Netlify environment variables.')
      if (status === 404) throw new ApiError(502, 'STREAM_NOT_FOUND', 'The configured Mux stream was not found. Check MUX_LIVE_STREAM_ID.')
      if (status === 429) throw new ApiError(503, 'PROVIDER_RATE_LIMIT', 'Mux is temporarily rate limiting requests. Please wait and try again.')
      throw new ApiError(502, 'PROVIDER_ERROR', 'Mux could not complete this request. Check your provider dashboard and try again.')
    }
    let data
    try { data = (await response.json()).data } catch { throw new ApiError(502, 'PROVIDER_RESPONSE', 'Mux returned an unreadable response. Please try again.') }
    if (!data || typeof data !== 'object') throw new ApiError(502, 'PROVIDER_RESPONSE', 'Mux returned an incomplete response. Please try again.')
    if (method === 'GET') muxCache.set(path, { until: now() + (path.startsWith('/assets/') ? 30000 : 4000), data })
    else muxCache.clear()
    return data
  }

  async function configuredStream(store, force = false) {
    const lifecycle = await readStore(store, 'stream-lifecycle') || {}
    const id = env('MUX_LIVE_STREAM_ID') || lifecycle.liveStreamId
    if (id && !validId(id)) throw new ApiError(503, 'STREAM_CONFIGURATION', 'The stored stream identifier is invalid. Check your Mux configuration.')
    return { lifecycle, id: id || null, data: id ? await mux(`/live-streams/${id}`, { cache: !force }) : null }
  }

  async function viewerCount(store) {
    // Independent records avoid a racy global counter. Each real page sends a heartbeat
    // every 25 s. Distinct IDs seen in the last 70 s are an approximate device count,
    // not Mux analytics, unique people, or a bot-resistant billing measurement.
    const buckets = [Math.floor(now() / 60000), Math.floor((now() - PRESENCE_TTL) / 60000)]
    const unique = new Set()
    for (let bucket = Math.min(...buckets); bucket <= Math.max(...buckets); bucket++) {
      const records = await store.list(`presence/${bucket}/`)
      for (const record of records) {
        const entry = await readStore(store, record.key)
        if (entry?.expiresAt > now()) unique.add(record.key.split('/').at(-1))
      }
    }
    return unique.size
  }

  async function cleanupPresence(store) {
    if (now() < nextPresenceCleanup || !store.listPrefixes) return
    nextPresenceCleanup = now() + 5000
    // Blobs has no automatic TTL. Discover only bucket names first, then delete a
    // bounded batch from fully expired buckets. Regular heartbeat traffic drains
    // old records without scanning every stored viewer or blocking on a full purge.
    const oldestActiveBucket = Math.floor((now() - PRESENCE_TTL) / 60000)
    const prefixes = await store.listPrefixes('presence/')
    const stale = prefixes.filter((prefix) => /^presence\/\d+\/$/.test(prefix) && Number(prefix.split('/')[1]) < oldestActiveBucket).sort((a, b) => Number(a.split('/')[1]) - Number(b.split('/')[1])).slice(0, 2)
    for (const prefix of stale) {
      const entries = (await store.list(prefix)).slice(0, 100)
      // Limit parallel storage operations, and retain any failures for the next pass.
      for (let index = 0; index < entries.length; index += 10) await Promise.all(entries.slice(index, index + 10).map(({ key }) => store.delete(key).catch(() => {})))
    }
  }

  async function publicStatus(store, settings) {
    const configuration = providerConfiguration(env)
    const base = { ...settings, mode: configuration.mode, provider: 'mux', status: 'offline', playbackUrl: null, startedAt: null, viewerCount: null, viewerCountApproximate: true }
    if (configuration.mode !== 'configured') return { ...base, ...(configuration.mode === 'error' ? { configurationError: configuration.message } : {}) }
    try {
      const { data, lifecycle } = await configuredStream(store)
      if (!data) return { ...base, viewerCount: await viewerCount(store) }
      const publicPlayback = data.playback_ids?.find((item) => item.policy === 'public')?.id
      const playbackId = env('MUX_PLAYBACK_ID') || publicPlayback
      if (playbackId && !data.playback_ids?.some((item) => item.id === playbackId && item.policy === 'public')) {
        throw new ApiError(503, 'PLAYBACK_CONFIGURATION', 'MUX_PLAYBACK_ID must be a public playback ID belonging to the configured live stream.')
      }
      if (!playbackId) throw new ApiError(503, 'PLAYBACK_CONFIGURATION', 'This Mux stream needs a public playback ID. Add one in the Mux dashboard.')
      const assetId = data.active_asset_id || data.recent_asset_ids?.at(-1)
      let asset = null
      if (assetId && validId(assetId)) asset = await mux(`/assets/${assetId}`)
      const assetStartedAt = isoFromSeconds(asset?.created_at)
      let status = 'offline'
      if (data.status === 'active') status = 'live'
      else if (lifecycle.intent === 'ended' || data.status === 'disabled') status = 'ended'
      else if (lifecycle.intent === 'preparing') {
        status = assetStartedAt && Date.parse(assetStartedAt) >= Math.floor(Date.parse(lifecycle.preparedAt) / 1000) * 1000 ? 'ended' : 'preparing'
      } else if (data.recent_asset_ids?.length) status = 'ended'
      return {
        ...base,
        status,
        playbackUrl: status === 'live' ? `https://stream.mux.com/${playbackId}.m3u8` : null,
        startedAt: status === 'live' ? assetStartedAt : null,
        viewerCount: await viewerCount(store),
      }
    } catch (error) {
      if (!(error instanceof ApiError)) onError({ code: 'STATUS_ERROR' })
      return { ...base, mode: 'error', configurationError: error instanceof ApiError ? error.message : 'Stream status is temporarily unavailable. Please try again.' }
    }
  }

  async function limitLogin(request, context, store) {
    // Immutable attempt records work across instances without a transactional counter.
    // The edge IP limit is additional protection; this window can permit a small
    // parallel-request overshoot and should be replaced by a transactional limiter
    // or managed identity provider for a large, hostile public deployment.
    const ip = context?.ip || 'local'
    const ipHash = sign(`login:${ip}`, env('SESSION_SECRET')).slice(0, 40)
    const cutoff = now() - LOGIN_WINDOW
    const recent = (loginBursts.get(ipHash) || []).filter((time) => time > cutoff)
    if (recent.length >= LOGIN_LIMIT) throw new ApiError(429, 'LOGIN_RATE_LIMIT', 'Too many sign-in attempts. Try again in 15 minutes.')
    recent.push(now())
    loginBursts.set(ipHash, recent)
    if (loginBursts.size > 2000) loginBursts.delete(loginBursts.keys().next().value)
    const records = await store.list(`login-attempts/${ipHash}/`)
    const active = records.filter(({ key }) => Number(key.split('/').at(-1).split('-')[0]) > cutoff)
    if (active.length >= LOGIN_LIMIT) throw new ApiError(429, 'LOGIN_RATE_LIMIT', 'Too many sign-in attempts. Try again in 15 minutes.')
    await writeStore(store, `login-attempts/${ipHash}/${now()}-${randomBytes(8).toString('hex')}`, { expiresAt: now() + LOGIN_WINDOW })
    // Best-effort expiry cleanup is bounded so an old login history cannot slow a login.
    await Promise.all(records.filter(({ key }) => Number(key.split('/').at(-1).split('-')[0]) <= cutoff).slice(0, 50).map(({ key }) => store.delete(key).catch(() => {})))
  }

  async function prepare(store) {
    const { data, lifecycle, id } = await configuredStream(store, true)
    let stream = data
    if (!id) {
      stream = await mux('/live-streams', { method: 'POST', body: {
        playback_policies: ['public'], new_asset_settings: { playback_policies: ['public'] }, latency_mode: 'low', reconnect_window: 60,
      } })
      if (!validId(stream.id)) throw new ApiError(502, 'PROVIDER_RESPONSE', 'Mux did not return a usable stream identifier.')
    } else if (stream.status === 'disabled') {
      await mux(`/live-streams/${id}/enable`, { method: 'PUT' })
    }
    await writeStore(store, 'stream-lifecycle', { ...lifecycle, liveStreamId: stream.id || id, intent: 'preparing', preparedAt: new Date(now()).toISOString(), endedAt: null })
    return stream.id || id
  }

  return async function handler(request, context = {}) {
    try {
      const url = new URL(request.url)
      const route = (url.pathname.replace(/^\/\.netlify\/functions\/api\/?/, '') || url.searchParams.get('route') || 'status').replace(/\/$/, '')
      const method = request.method.toUpperCase()
      if (!['GET', 'POST', 'PUT'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.')
      if (method !== 'GET') secureMutation(request)
      const authenticated = hasSession(request, env, now())
      if (route === 'session' && method === 'GET') return json({ authenticated, configured: authConfiguration(env) })
      if (route === 'logout' && method === 'POST') return json({ authenticated: false }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) })
      if (route === 'login' && method === 'POST') {
        if (!authConfiguration(env)) throw new ApiError(503, 'AUTH_UNCONFIGURED', 'Admin sign-in needs ADMIN_SECRET (at least 16 characters) and SESSION_SECRET (at least 32 characters) in Netlify environment variables.')
        const body = await readBody(request)
        if (typeof body?.password !== 'string' || body.password.length > 256) throw new ApiError(400, 'INVALID_LOGIN', 'Enter a valid admin password.')
        const store = await getStorage(context)
        await limitLogin(request, context, store)
        if (!safeEqual(body.password, env('ADMIN_SECRET'))) throw new ApiError(401, 'INVALID_LOGIN', 'The password is incorrect.')
        return json({ authenticated: true, configured: true }, 200, { 'Set-Cookie': cookieHeader(request, issueSession(request, env, now()), SESSION_SECONDS) })
      }
      if (['admin', 'settings', 'stream', 'ingest'].includes(route) && !authenticated) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to the admin dashboard first.')
      const store = await getStorage(context)
      const settings = await settingsFor(store)
      if (route === 'status' && method === 'GET') return json(await publicStatus(store, settings))
      if (route === 'presence' && method === 'POST') {
        const configuration = providerConfiguration(env)
        if (configuration.mode !== 'configured') return json({ viewerCount: null, approximate: true })
        const { viewerId } = await readBody(request)
        if (typeof viewerId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(viewerId)) throw new ApiError(400, 'INVALID_VIEWER', 'A valid anonymous viewer identifier is required.')
        const viewerHash = hash(viewerId).slice(0, 40)
        const bucket = Math.floor(now() / 60000)
        await writeStore(store, `presence/${bucket}/${viewerHash}`, { expiresAt: now() + PRESENCE_TTL })
        await cleanupPresence(store).catch(() => {})
        return json({ viewerCount: await viewerCount(store), approximate: true })
      }
      if (route === 'admin' && method === 'GET') {
        const stream = await publicStatus(store, settings)
        const configuration = providerConfiguration(env)
        const lifecycle = await readStore(store, 'stream-lifecycle') || {}
        return json({
          settings,
          stream,
          provider: { name: 'mux', configured: configuration.mode === 'configured', liveStreamId: env('MUX_LIVE_STREAM_ID') || lifecycle.liveStreamId || null, health: stream.mode === 'error' ? 'error' : configuration.mode === 'configured' ? 'ready' : 'unconfigured', message: stream.configurationError || configuration.message },
          auth: { configured: true },
          ingest: { available: configuration.mode === 'configured' && Boolean(env('MUX_LIVE_STREAM_ID') || lifecycle.liveStreamId), serverUrl: SERVER_URL },
          broadcastMode: 'obs',
        })
      }
      if (route === 'settings' && method === 'PUT') {
        const nextSettings = validateSettings(await readBody(request))
        await writeStore(store, 'settings', nextSettings)
        return json({ settings: nextSettings })
      }
      if (['stream', 'ingest'].includes(route)) {
        const configuration = providerConfiguration(env)
        if (configuration.mode !== 'configured') throw new ApiError(503, 'PROVIDER_UNCONFIGURED', configuration.message)
      }
      if (route === 'stream' && method === 'POST') {
        const { action } = await readBody(request)
        if (action === 'prepare') {
          // Collapse double-clicks within a warm instance. Never create streams on a
          // public request; use MUX_LIVE_STREAM_ID to pin a stream in multi-admin use.
          if (!preparingPromise) preparingPromise = prepare(store).finally(() => { preparingPromise = null })
          await preparingPromise
          return json({ stream: await publicStatus(store, settings), message: 'Mux is ready. Start streaming in OBS with the private encoder settings.' })
        }
        if (action === 'end') {
          const { id, lifecycle } = await configuredStream(store, true)
          if (!id) throw new ApiError(409, 'NO_STREAM', 'Prepare a stream before ending it.')
          await mux(`/live-streams/${id}/disable`, { method: 'PUT' })
          await writeStore(store, 'stream-lifecycle', { ...lifecycle, liveStreamId: id, intent: 'ended', endedAt: new Date(now()).toISOString() })
          return json({ stream: await publicStatus(store, settings), message: 'The Mux input is disabled. Stop OBS before preparing the next stream.' })
        }
        throw new ApiError(400, 'INVALID_ACTION', 'Choose prepare or end.')
      }
      if (route === 'ingest' && method === 'GET') {
        const { id, data } = await configuredStream(store, true)
        if (!id || !data?.stream_key) throw new ApiError(409, 'NO_STREAM', 'Prepare a stream before viewing encoder settings.')
        return json({ serverUrl: SERVER_URL, streamKey: data.stream_key, liveStreamId: id, playbackId: env('MUX_PLAYBACK_ID') || data.playback_ids?.find((item) => item.policy === 'public')?.id || null })
      }
      throw new ApiError(404, 'NOT_FOUND', 'This API endpoint does not exist.')
    } catch (error) {
      if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status, error.status === 429 ? { 'Retry-After': '900' } : {})
      // Never return provider response bodies, tokens, cookies, request bodies, or stack traces.
      onError({ code: 'UNEXPECTED_API_ERROR' })
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again.' } }, 503)
    }
  }
}
