import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// scrypt parameters meet OWASP's N=2^15,r=8,p=3 profile. Limit active hashes
// rather than queue cross-request promises in a function process.
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 });
const SESSION_MS = 24 * 60 * 60 * 1000;
const PROD_COOKIE = "__Host-harbor_session";
const DEV_COOKIE = "harbor_dev_session";
const DUMMY_HASH = "scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
let activeHashes = 0;

class AuthError extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}
const fail = (status, code, message, retryAfter) => { throw new AuthError(status, code, message, retryAfter); };
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra } });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const now = (deps) => deps.now?.() ?? Date.now();
const stmt = (db, sql, values = []) => db.prepare(sql).bind(...values);
const first = (db, sql, values = []) => stmt(db, sql, values).first();

function objectFields(body, fields) {
  if (!body || typeof body !== "object" || Array.isArray(body) || fields.some((field) => !(field in body)) || Object.keys(body).some((field) => !fields.includes(field))) fail(400, "invalid_request", "The request fields do not match this operation.");
}
export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[\x21-\x7e]+$/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2 || parts[0].length > 64 || !parts[0] || parts[0].startsWith(".") || parts[0].endsWith(".") || parts[0].includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])) return null;
  const labels = parts[1].split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return email;
}
function profileFields(body) {
  const field = (value, label) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) fail(400, "invalid_request", `${label} must contain between 1 and 100 characters.`);
    return value.trim();
  };
  if (body.businessType !== "individual" && body.businessType !== "company") fail(400, "invalid_request", "Choose an individual or company account.");
  if (typeof body.country !== "string" || !/^[a-zA-Z]{2}$/.test(body.country.trim())) fail(400, "invalid_request", "Use a two-letter country code.");
  return { displayName: field(body.displayName, "Your name"), businessName: field(body.businessName, "Business name"), businessType: body.businessType, country: body.country.trim().toUpperCase() };
}
async function payload(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail(415, "json_required", "Send this request as application/json.");
  const maxBytes = 8192; const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) fail(413, "request_too_large", "The request body is too large.");
  const reader = request.body?.getReader(); if (!reader) fail(400, "invalid_request", "A request body is required.");
  let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); fail(413, "request_too_large", "The request body is too large."); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(400, "invalid_request", "The request body must be valid UTF-8 JSON."); }
}
function cookieSettings(url, deps = {}, required = true) {
  const local = deps.allowDevCookie === true && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) { if (!required) return null; fail(400, "https_required", "Account access requires HTTPS."); }
  return { name: local ? DEV_COOKIE : PROD_COOKIE, secure: !local };
}
function cookieValue(header, name) {
  const values = (header || "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  // Duplicate cookies are ambiguous; never let cookie ordering pick a seller.
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function sessionCookie(url, token, clear = false, deps = {}) {
  const { name, secure } = cookieSettings(url, deps);
  return `${name}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_MS / 1000}${secure ? "; Secure" : ""}`;
}
function sessionToken(header, deps = {}) {
  const parts = (header || "").split(";").map((part) => part.trim());
  if (parts.some((part) => part.startsWith(`${PROD_COOKIE}=`)) && parts.some((part) => part.startsWith(`${DEV_COOKIE}=`))) return null;
  if (deps.url) { const settings = cookieSettings(new URL(deps.url), deps, false); return settings ? cookieValue(header, settings.name) : null; }
  // Server-rendered pages pass their actual request protocol explicitly.
  return cookieValue(header, PROD_COOKIE);
}
async function derive(password, salt) {
  if (activeHashes >= 1) fail(503, "auth_busy", "Account access is busy. Please try again shortly.", 2);
  activeHashes++;
  try { return await new Promise((resolve, reject) => scrypt(password, salt, 32, SCRYPT, (error, result) => error ? reject(error) : resolve(result))); }
  finally { activeHashes--; }
}
export async function hashPassword(password) {
  const salt = randomBytes(16); const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(password, encoded) {
  const fields = typeof encoded === "string" ? encoded.split("$") : [];
  const valid = fields.length === 6 && fields.slice(0, 4).join("$") === "scrypt$32768$8$3" && /^[A-Za-z0-9_-]{22}$/.test(fields[4]) && /^[A-Za-z0-9_-]{43}$/.test(fields[5]);
  const source = valid ? fields : DUMMY_HASH.split("$");
  const expected = Buffer.from(source[5], "base64url"); const actual = await derive(password, Buffer.from(source[4], "base64url"));
  return valid && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function getSessionUser(db, cookieHeader, deps = {}) {
  if (!db) return null;
  const token = sessionToken(cookieHeader, deps); if (!token) return null;
  const row = await first(db, `SELECT u.owner_user_id,u.email,u.email_verified,m.account_display_name FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id LEFT JOIN merchants m ON m.owner_user_id=u.owner_user_id WHERE s.token_hash=? AND s.expires_at>?`, [sha256(token), now(deps)]);
  if (row && deps.isEmailAllowed && !deps.isEmailAllowed(row.email)) return null;
  return row ? { userId: row.owner_user_id, email: row.email, displayName: row.account_display_name || row.email, authProvider: "email", emailVerified: row.email_verified === 1 } : null;
}

async function consumeRate(db, key, limit, windowMs, timestamp) {
  const result = await first(db, `INSERT INTO auth_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.expires_at<=? THEN 1 ELSE auth_rate_limits.attempts+1 END,expires_at=CASE WHEN auth_rate_limits.expires_at<=? THEN excluded.expires_at ELSE auth_rate_limits.expires_at END RETURNING attempts,expires_at`, [sha256(key), timestamp + windowMs, timestamp, timestamp]);
  if (!result || !Number.isSafeInteger(result.attempts)) fail(503, "auth_unavailable", "Account access is temporarily unavailable.");
  if (result.attempts > limit) fail(429, "auth_rate_limited", "Too many attempts. Please try again later.", Math.max(1, Math.ceil((result.expires_at - timestamp) / 1000)));
}
async function rateLimit(db, operation, email, request, deps) {
  // The hosting adapter supplies its trusted client IP. Missing metadata
  // shares one bucket, so absent metadata never disables the limit.
  const ip = deps.clientIp?.(request) || "unavailable";
  const timestamp = now(deps); const signup = operation === "signup"; const windowMs = signup ? 60 * 60 * 1000 : 15 * 60 * 1000;
  await consumeRate(db, `${operation}:ip:${ip}`, signup ? 10 : 30, windowMs, timestamp);
  await consumeRate(db, `${operation}:email:${email || "invalid"}`, signup ? 5 : 10, windowMs, timestamp);
}
async function legacyAccount(db, deps) {
  const identity = await deps.getLegacyIdentity?.();
  if (!identity?.userId || !normalizeEmail(identity.email)) return null;
  const merchant = await first(db, `SELECT m.* FROM merchants m WHERE m.owner_user_id=? AND NOT EXISTS(SELECT 1 FROM auth_users u WHERE u.owner_user_id=m.owner_user_id)`, [identity.userId]);
  return merchant ? { identity, merchant } : null;
}
async function newSession(db, authUserId, request, url, deps) {
  const token = randomBytes(32).toString("hex"); const timestamp = now(deps); const oldToken = sessionToken(request.headers.get("cookie"), { ...deps, url: url.href });
  const statements = [stmt(db, "INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)", [sha256(token), authUserId, timestamp, timestamp + SESSION_MS])];
  if (oldToken) statements.push(stmt(db, "DELETE FROM auth_sessions WHERE token_hash=?", [sha256(oldToken)]));
  await db.batch(statements);
  return sessionCookie(url, token, false, deps);
}

/** App credentials use only server-issued email/password sessions. */
export async function handleAuthRequest(request, env, deps = {}) {
  try {
    const url = new URL(request.url); const path = url.pathname.replace(/\/$/, "");
    if (!env.DB) fail(503, "auth_unavailable", "Account access needs its server database.");
    const db = env.DB; cookieSettings(url, deps);
    if (path === "/api/auth/context" && request.method === "GET") {
      const legacy = await legacyAccount(db, deps);
      return json({ legacyAccount: legacy ? { email: normalizeEmail(legacy.identity.email), displayName: legacy.merchant.account_display_name || legacy.identity.displayName || "", businessName: legacy.merchant.name, businessType: legacy.merchant.business_type || "individual", country: legacy.merchant.country || "US" } : null });
    }
    if (!["/api/auth/signup", "/api/auth/login", "/api/auth/logout"].includes(path) || request.method !== "POST") fail(405, "method_not_allowed", "This operation is not supported.");
    if (request.headers.get("origin") !== url.origin) fail(403, "invalid_origin", "This operation must be requested from the app's own origin.");
    const body = await payload(request);
    if (path === "/api/auth/logout") {
      objectFields(body, []); const token = sessionToken(request.headers.get("cookie"), { ...deps, url: url.href });
      if (token) await stmt(db, "DELETE FROM auth_sessions WHERE token_hash=?", [sha256(token)]).run();
      return json({ ok: true, next: "/login" }, 200, { "Set-Cookie": sessionCookie(url, "", true, deps) });
    }
    const signup = path.endsWith("/signup"); objectFields(body, signup ? ["email", "password", "displayName", "businessName", "businessType", "country"] : ["email", "password"]);
    if (signup && await getSessionUser(db, request.headers.get("cookie"), { ...deps, url: url.href })) fail(409, "already_signed_in", "You are already signed in. Sign out before creating another account.");
    const email = normalizeEmail(body.email); await rateLimit(db, signup ? "signup" : "login", email, request, deps);
    if (signup) {
      if (!email) fail(400, "invalid_request", "Enter a valid email address.");
      if (typeof body.password !== "string" || [...body.password].length < 15 || [...body.password].length > 128 || body.password.length > 256) fail(400, "invalid_request", "Use a password between 15 and 128 characters.");
      const profile = profileFields(body); const passwordHash = await hashPassword(body.password); const legacy = await legacyAccount(db, deps);
      const safeLegacy = legacy && normalizeEmail(legacy.identity.email) === email ? legacy : null;
      const ownerId = safeLegacy ? safeLegacy.identity.userId : `harbor_${randomUUID()}`;
      const authUserId = randomUUID(); const timestamp = new Date(now(deps)).toISOString();
      // The database enforces ownership and normalized-email uniqueness.
      // A single transaction preserves the old seller or creates a full new
      // workspace, and never leaves a credential without its merchant.
      try {
        const statements = [stmt(db, "INSERT INTO auth_users(id,email,password_hash,owner_user_id,email_verified,created_at) VALUES(?,?,?,?,0,?)", [authUserId, email, passwordHash, ownerId, timestamp])];
        if (safeLegacy) statements.push(stmt(db, "UPDATE merchants SET name=CASE WHEN onboarding_completed_at IS NULL THEN ? ELSE name END,account_display_name=CASE WHEN onboarding_completed_at IS NULL THEN ? ELSE account_display_name END,contact_email=?,business_type=CASE WHEN onboarding_completed_at IS NULL THEN ? ELSE business_type END,country=CASE WHEN onboarding_completed_at IS NULL THEN ? ELSE country END,onboarding_completed_at=COALESCE(onboarding_completed_at,?),updated_at=? WHERE owner_user_id=?", [profile.businessName, profile.displayName, email, profile.businessType, profile.country, timestamp, timestamp, ownerId]));
        else statements.push(stmt(db, "INSERT INTO merchants(id,owner_user_id,name,created_at,account_display_name,contact_email,business_type,country,onboarding_completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [randomUUID(), ownerId, profile.businessName, timestamp, profile.displayName, email, profile.businessType, profile.country, timestamp, timestamp]));
        await db.batch(statements);
      } catch (error) {
        if (error?.code === "23505" || /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(error?.message || "")) fail(409, "signup_unavailable", "Unable to create an account with those details. If you already have an account, sign in.");
        throw error;
      }
      const cookie = await newSession(db, authUserId, request, url, deps);
      return json({ ok: true, next: "/" }, 201, { "Set-Cookie": cookie });
    }
    // Bad syntax still pays the same hashing cost as an unknown email. A
    // malformed stored hash also uses the dummy derivation and cannot log in.
    const user = email ? await first(db, "SELECT id,password_hash FROM auth_users WHERE email=?", [email]) : null;
    const password = typeof body.password === "string" && body.password.length <= 256 ? body.password : "invalid password input";
    const verified = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
    if (!user || typeof body.password !== "string" || [...body.password].length < 15 || [...body.password].length > 128 || !verified) fail(401, "invalid_credentials", "Email or password is incorrect.");
    return json({ ok: true, next: "/" }, 200, { "Set-Cookie": await newSession(db, user.id, request, url, deps) });
  } catch (error) {
    if (error instanceof AuthError) return json({ code: error.code, error: error.message }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
    // Storage and cryptographic errors fail closed. Never log credentials,
    // bodies, cookies, addresses, or database rows from an auth request.
    console.error("Harbor authentication operation failed.");
    return json({ code: "auth_unavailable", error: "Account access is temporarily unavailable. Please try again." }, 503);
  }
}
