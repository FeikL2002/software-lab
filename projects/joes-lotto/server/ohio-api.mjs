// Adapter for the same anonymous, read-only feeds used by Ohio Lottery's website.
// Guest credentials are read from the current public script, never shipped here.
const OFFICIAL_ORIGIN = 'https://www.ohiolottery.com';
const API_ORIGIN = 'https://api-solutions.ohiolottery.com';
const AUTH_URL = 'https://authapi-solutions.ohiolottery.com/1.0/Authentication/Login';
const PUBLIC_SCRIPT_URL = `${OFFICIAL_ORIGIN}/global.js`;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_DATA_BYTES = 12 * 1024 * 1024;
const PUBLIC_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0',
  Origin: OFFICIAL_ORIGIN,
  Referer: `${OFFICIAL_ORIGIN}/`,
  Accept: 'application/json, text/javascript, */*; q=0.1',
});

let token = null;
let tokenExpiresAt = 0;
let tokenPromise = null;

export class OhioDataError extends Error {
  constructor(message, { code = 'OHIO_UNAVAILABLE', status = 502 } = {}) {
    super(message);
    this.name = 'OhioDataError';
    this.code = code;
    this.status = status;
  }
}

async function readBounded(response, maxBytes) {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel();
    throw new OhioDataError('The official Ohio response was too large.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new OhioDataError('The official Ohio response was too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function requestText(url, options = {}, maxBytes = MAX_DATA_BYTES) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...PUBLIC_HEADERS, ...options.headers },
    });
    const text = await readBounded(response, maxBytes);
    return { response, text };
  } catch (error) {
    if (error instanceof OhioDataError) throw error;
    throw new OhioDataError('The official Ohio service could not be reached.', {
      code: 'OHIO_NETWORK_ERROR',
      status: 503,
    });
  }
}

function parseJSON(text) {
  try {
    const result = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new OhioDataError('The official Ohio response was not valid data.');
  }
}

async function acquireToken() {
  const script = await requestText(PUBLIC_SCRIPT_URL, {}, 512 * 1024);
  if (!script.response.ok) throw new OhioDataError('Ohio public data setup is unavailable.');
  // Limit extraction to the official anonymous guest initializer; never evaluate remote JS.
  const initializer = script.text.match(/mtllc_getAPItoken\s*=\s*\([^)]*\)\s*=>\s*\{([\s\S]{0,1400})/);
  const user = initializer?.[1].match(/\blet\s+username\s*=\s*(['"])([^'"\r\n]{1,200})\1/);
  const password = initializer?.[1].match(/\blet\s+password\s*=\s*(['"])([^'"\r\n]{1,200})\1/);
  if (!user || !password) throw new OhioDataError('Ohio has changed its public data setup.');
  const result = await requestText(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify({ userName: user[2], password: password[2] }),
  }, 256 * 1024);
  if (!result.response.ok) throw new OhioDataError('Ohio public data access is temporarily unavailable.');
  const payload = parseJSON(result.text);
  const guestToken = payload.data?.token;
  if (typeof guestToken !== 'string' || guestToken.length < 16 || guestToken.length > 16_384) {
    throw new OhioDataError('Ohio public data access is temporarily unavailable.');
  }
  const officialExpiry = Date.parse(payload.data?.expires);
  const maxExpiry = Date.now() + 30 * 60_000;
  token = guestToken;
  tokenExpiresAt = Number.isFinite(officialExpiry) ? Math.min(officialExpiry - 60_000, maxExpiry) : maxExpiry;
  return token;
}

async function getToken() {
  if (token && tokenExpiresAt > Date.now()) return token;
  if (!tokenPromise) tokenPromise = acquireToken().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

function officialURL(path) {
  if (typeof path !== 'string' || path.length > 3000 || !path.startsWith('/') || path.startsWith('//')) {
    throw new OhioDataError('Invalid official data path.', { code: 'INVALID_PATH', status: 400 });
  }
  const normalized = path.startsWith('/1.0/') ? path : `/1.0${path}`;
  const url = new URL(normalized, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !/^\/1\.0\/(Games|Retailer)\//.test(url.pathname) || url.hash) {
    throw new OhioDataError('Invalid official data path.', { code: 'INVALID_PATH', status: 400 });
  }
  return url;
}

/** Fetch anonymous public lottery data. Tokens and upstream bodies never enter errors. */
export async function ohioData(path, { method = 'GET', body } = {}) {
  const url = officialURL(path);
  if (!['GET', 'POST'].includes(method)) {
    throw new OhioDataError('Unsupported official data method.', { code: 'INVALID_METHOD', status: 400 });
  }
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && serialized.length > 64 * 1024) {
    throw new OhioDataError('Official query is too large.', { code: 'INVALID_QUERY', status: 400 });
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const guestToken = await getToken();
    const result = await requestText(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guestToken}` },
      body: serialized,
    });
    // Ohio occasionally reports an expired token in an HTTP-200 JSON envelope.
    let payload;
    if (result.response.status !== 401) payload = parseJSON(result.text);
    const upstreamStatus = Number(payload?.statusCode);
    if ((result.response.status === 401 || upstreamStatus === 401) && attempt === 0) {
      token = null;
      tokenExpiresAt = 0;
      continue;
    }
    if (!result.response.ok || upstreamStatus >= 400 || !Object.hasOwn(payload ?? {}, 'data')) {
      throw new OhioDataError('The official Ohio feed is temporarily unavailable.', {
        code: result.response.status === 429 || upstreamStatus === 429 ? 'OHIO_RATE_LIMITED' : 'OHIO_UNAVAILABLE',
        status: 503,
      });
    }
    return payload.data;
  }
  throw new OhioDataError('Ohio public data access could not be renewed.', { status: 503 });
}
