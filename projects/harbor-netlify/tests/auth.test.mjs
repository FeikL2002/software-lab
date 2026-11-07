import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { getSessionUser, handleAuthRequest, hashPassword, verifyPassword, normalizeEmail } from "../server/auth.mjs";
import { handleRequest } from "../server/harbor.mjs";

const ORIGIN = "https://harbor.example";
const START = 1_800_000_000_000;
const PASSWORD = "A harbor password with spaces!";
const fields = { displayName: "Seller One", businessName: "Seller Studio", businessType: "individual", country: "US" };
function setup(t) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='auth_users'").get(), "Generate the auth schema migration first.");
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args) }; }, async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; } }; },
    async batch(statements) { sqlite.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
  };
  const env = { DB: db }; let timestamp = START; let platform = null;
  const deps = { now: () => timestamp, clientIp: (request) => request.headers.get("cf-connecting-ip") || "unavailable", getLegacyIdentity: async () => platform };
  async function auth(path, body, options = {}) {
    const url = `${options.origin || ORIGIN}${path}`; const headers = { "CF-Connecting-IP": options.ip || "203.0.113.1", ...(options.headers || {}) };
    if (body !== undefined) { headers["Content-Type"] = "application/json"; if (options.csrfOrigin !== null) headers.Origin = options.csrfOrigin || new URL(url).origin; }
    if (options.cookie) headers.Cookie = options.cookie;
    const response = await handleAuthRequest(new Request(url, { method: options.method || (body === undefined ? "GET" : "POST"), headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { ...deps, allowDevCookie: options.allowDevCookie === true });
    return { response, status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || null };
  }
  async function signup(email = "seller@example.test", overrides = {}, options = {}) { return auth("/api/auth/signup", { email, password: PASSWORD, ...fields, ...overrides }, options); }
  async function login(email = "seller@example.test", password = PASSWORD, options = {}) { return auth("/api/auth/login", { email, password }, options); }
  function user(cookie, options = {}) { return getSessionUser(db, cookie, { ...deps, ...options }); }
  async function workspace(cookie, path = "/api/workspace?mode=test", body, options = {}) {
    const identity = await user(cookie); const merchant = identity ? sqlite.prepare("SELECT id FROM merchants WHERE owner_user_id=?").get(identity.userId) : null;
    const headers = { ...(body ? { Origin: ORIGIN, "Content-Type": "application/json", "X-Harbor-Account-Id": merchant?.id || "" } : {}), ...(options.headers || {}) };
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, { method: options.method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined }), env, { ...deps, getUser: async () => identity });
    return { status: response.status, body: await response.json() };
  }
  return { sqlite, db, env, deps, auth, signup, login, user, workspace, advance(ms) { timestamp += ms; }, platform(value) { platform = value; } };
}

test("passwords use unique salted scrypt hashes and compare without trimming", async () => {
  const a = await hashPassword(PASSWORD); const b = await hashPassword(PASSWORD);
  assert.notEqual(a, b); assert.equal(a.includes(PASSWORD), false); assert.ok(a.startsWith("scrypt$32768$8$3$"));
  assert.equal(await verifyPassword(PASSWORD, a), true); assert.equal(await verifyPassword(`${PASSWORD} `, a), false); assert.equal(await verifyPassword(PASSWORD, "malformed"), false);
});

test("signup stores normalized credentials, a completed seller, and a secure hashed session", async (t) => {
  const ctx = setup(t); const registered = await ctx.signup("  SELLER@EXAMPLE.TEST  "); assert.equal(registered.status, 201); assert.deepEqual(registered.body, { ok: true, next: "/" });
  const cookie = registered.response.headers.get("set-cookie"); assert.match(cookie, /^__Host-harbor_session=[a-f0-9]{64};/); for (const flag of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure", "Max-Age=86400"]) assert.ok(cookie.includes(flag));
  const record = ctx.sqlite.prepare("SELECT * FROM auth_users").get(); assert.equal(record.email, "seller@example.test"); assert.equal(record.email_verified, 0); assert.equal(record.password_hash.includes(PASSWORD), false);
  const session = ctx.sqlite.prepare("SELECT * FROM auth_sessions").get(); const token = registered.cookie.split("=")[1]; assert.notEqual(session.token_hash, token); assert.equal(session.token_hash, createHash("sha256").update(token).digest("hex"));
  const identity = await ctx.user(registered.cookie); assert.equal(identity.authProvider, "email"); assert.equal(identity.emailVerified, false); assert.equal(identity.email, record.email);
  const account = await ctx.workspace(registered.cookie, "/api/account"); assert.equal(account.body.registrationRequired, false); assert.equal(account.body.authProvider, "email"); assert.equal(account.body.emailVerified, false);
  assert.equal((await ctx.workspace(registered.cookie)).status, 200);
});

test("login verifies credentials generically, creates a fresh session, and revokes a prior cookie", async (t) => {
  const ctx = setup(t); const first = await ctx.signup(); const bad = await ctx.login(undefined, "incorrect password long enough"); const unknown = await ctx.login("unknown@example.test");
  assert.equal(bad.status, 401); assert.equal(unknown.status, 401); assert.deepEqual(bad.body, unknown.body); assert.equal(bad.cookie, null); assert.equal(unknown.cookie, null);
  const second = await ctx.login("SELLER@EXAMPLE.TEST", PASSWORD, { cookie: first.cookie }); assert.equal(second.status, 200); assert.notEqual(first.cookie, second.cookie); assert.equal(await ctx.user(first.cookie), null); assert.ok(await ctx.user(second.cookie));
});

test("session expiry, logout revocation, and duplicate cookie rejection fail closed", async (t) => {
  const ctx = setup(t); const first = await ctx.signup(); assert.equal(await ctx.user(`${first.cookie}; ${first.cookie}`), null);
  assert.equal(await ctx.user(`${first.cookie}; harbor_dev_session=${"a".repeat(64)}`), null);
  const logout = await ctx.auth("/api/auth/logout", {}, { cookie: first.cookie }); assert.equal(logout.status, 200); assert.ok(logout.response.headers.get("set-cookie").includes("Max-Age=0")); assert.equal(await ctx.user(first.cookie), null);
  const second = await ctx.login(); ctx.advance(24 * 60 * 60 * 1000); assert.equal(await ctx.user(second.cookie), null); assert.equal((await ctx.workspace(second.cookie)).status, 401);
});

test("HTTP development cookies work only for actual loopback, never production", async (t) => {
  const ctx = setup(t); const local = await ctx.signup(undefined, {}, { origin: "http://127.0.0.1:8765", allowDevCookie: true }); assert.equal(local.status, 201); assert.match(local.cookie, /^harbor_dev_session=/); assert.equal(local.response.headers.get("set-cookie").includes("Secure"), false);
  assert.ok(await ctx.user(local.cookie, { url: "http://127.0.0.1:8765", allowDevCookie: true })); assert.equal(await ctx.user(local.cookie), null); assert.equal(await ctx.user(local.cookie, { url: ORIGIN, allowDevCookie: true }), null); assert.equal(await ctx.user(local.cookie, { url: "http://127.0.0.1:8765" }), null);
  const blockedLocal = await ctx.login(undefined, PASSWORD, { origin: "http://127.0.0.1:8765" }); assert.equal(blockedLocal.status, 400); assert.equal(blockedLocal.cookie, null);
  assert.equal((await ctx.login(undefined, PASSWORD, { origin: "http://remote.example" })).status, 400);
});

test("all credential mutations require exact same-origin strict bounded JSON", async (t) => {
  const ctx = setup(t); for (const path of ["/api/auth/signup", "/api/auth/login", "/api/auth/logout"]) {
    assert.equal((await ctx.auth(path, {}, { csrfOrigin: "https://attacker.example" })).status, 403);
    assert.equal((await ctx.auth(path, {}, { csrfOrigin: null })).status, 403);
  }
  assert.equal((await ctx.signup(undefined, { ownerUserId: "attacker" })).status, 400); assert.equal((await ctx.signup(undefined, { emailVerified: true })).status, 400); assert.equal((await ctx.signup(undefined, { password: "short password" })).status, 400);
  const huge = await ctx.auth("/api/auth/login", { email: "seller@example.test", password: "x".repeat(9000) }); assert.equal(huge.status, 413);
  assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM auth_users").get().n, 0);
});

test("normalized duplicate email never creates another merchant or credential", async (t) => {
  const ctx = setup(t); const registered = await ctx.signup(); const duplicate = await ctx.signup(" SELLER@EXAMPLE.TEST "); assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, "signup_unavailable");
  assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM auth_users").get().n, 1); assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM merchants").get().n, 1); assert.ok(await ctx.user(registered.cookie));
});

test("durable email and IP rate limits resist attempts and expire by the fixed window", async (t) => {
  const ctx = setup(t); const key = (value) => createHash("sha256").update(value).digest("hex");
  ctx.sqlite.prepare("INSERT INTO auth_rate_limits(key,attempts,expires_at) VALUES(?,?,?)").run(key("login:email:missing@example.test"), 9, START + 15 * 60 * 1000);
  assert.equal((await ctx.login("missing@example.test", "wrong password long enough", { ip: "203.0.113.2" })).status, 401);
  const blocked = await ctx.login("missing@example.test", PASSWORD, { ip: "203.0.113.99" }); assert.equal(blocked.status, 429); assert.equal(blocked.body.code, "auth_rate_limited"); assert.ok(Number(blocked.response.headers.get("retry-after")) > 0);
  const before = ctx.sqlite.prepare("SELECT count(*) n FROM auth_rate_limits").get().n; assert.ok(before > 0); ctx.advance(15 * 60 * 1000); assert.equal((await ctx.login("missing@example.test", PASSWORD, { ip: "203.0.113.99" })).status, 401);
  ctx.sqlite.prepare("INSERT INTO auth_rate_limits(key,attempts,expires_at) VALUES(?,?,?)").run(key("login:ip:203.0.113.250"), 30, START + 30 * 60 * 1000);
  assert.equal((await ctx.login("another@example.test", PASSWORD, { ip: "203.0.113.250" })).status, 429);
  assert.equal(ctx.sqlite.prepare("SELECT attempts FROM auth_rate_limits WHERE key=?").get(key("login:ip:203.0.113.250")).attempts, 31);
});

test("email-only knowledge cannot claim legacy earnings and platform headers cannot sign in", async (t) => {
  const ctx = setup(t); ctx.sqlite.prepare("INSERT INTO merchants(id,owner_user_id,name,created_at,account_display_name,contact_email,business_type,country,onboarding_completed_at) VALUES(?,?,?,?,?,?,?,?,?)").run("legacy", "platform-owner", "Legacy Studio", new Date(START).toISOString(), "Original Owner", "seller@example.test", "company", "US", new Date(START).toISOString());
  const signup = await ctx.signup(); const identity = await ctx.user(signup.cookie); assert.notEqual(identity.userId, "platform-owner"); assert.notEqual((await ctx.workspace(signup.cookie)).body.merchant.id, "legacy");
  ctx.platform({ userId: "platform-owner", email: "seller@example.test", displayName: "Original Owner" }); assert.equal(await ctx.user(null), null); assert.equal((await ctx.workspace(null)).status, 401);
});

test("trusted matching legacy identity links credentials without changing financial ownership", async (t) => {
  const ctx = setup(t); const created = new Date(START - 5000).toISOString(); ctx.sqlite.prepare("INSERT INTO merchants(id,owner_user_id,name,created_at,account_display_name,contact_email,business_type,country,onboarding_completed_at,payment_percent_bps) VALUES(?,?,?,?,?,?,?,?,?,?)").run("legacy", "platform-owner", "Legacy Studio", created, "Original Owner", "seller@example.test", "company", "CA", created, 250);
  ctx.sqlite.prepare("INSERT INTO payment_links(id,merchant_id,token,title,amount_cents,currency,mode,payment_percent_bps,payment_fixed_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("old-link", "legacy", "a".repeat(48), "Original link", 2500, "usd", "test", 250, 0, created);
  ctx.platform({ userId: "platform-owner", email: "SELLER@example.test", displayName: "Original Owner" });
  const context = await ctx.auth("/api/auth/context"); assert.equal(context.body.legacyAccount.email, "seller@example.test"); assert.equal(context.body.legacyAccount.businessName, "Legacy Studio");
  const signup = await ctx.signup(); assert.equal(signup.status, 201); const identity = await ctx.user(signup.cookie); assert.equal(identity.userId, "platform-owner");
  const workspace = await ctx.workspace(signup.cookie); assert.equal(workspace.body.merchant.id, "legacy"); assert.equal(workspace.body.links[0].id, "old-link");
  const merchant = ctx.sqlite.prepare("SELECT * FROM merchants WHERE id='legacy'").get(); assert.equal(merchant.name, "Legacy Studio"); assert.equal(merchant.created_at, created); assert.equal(merchant.payment_percent_bps, 250); assert.equal(merchant.account_display_name, "Original Owner"); assert.equal(merchant.country, "CA");
  assert.equal((await ctx.auth("/api/auth/context")).body.legacyAccount, null);
});

test("two real credential accounts keep links, earnings and profile writes separate", async (t) => {
  const ctx = setup(t); const a = await ctx.signup("a@example.test"); const b = await ctx.signup("b@example.test", { displayName: "Seller Two", businessName: "Other Studio" });
  const aIdentity = await ctx.user(a.cookie); const bIdentity = await ctx.user(b.cookie); assert.notEqual(aIdentity.userId, bIdentity.userId);
  const created = await ctx.workspace(a.cookie, "/api/links", { mode: "test", title: "A service", description: "", amountCents: 2500, currency: "usd" }); assert.equal(created.status, 201);
  const link = created.body.link; const checkout = await ctx.workspace(null, `/api/pay/${link.token}/checkout`, { requestId: randomUUID() }); assert.equal(checkout.status, 201);
  assert.equal((await ctx.workspace(null, `/api/pay/${link.token}/simulate`, { receiptToken: checkout.body.receiptToken, outcome: "paid" })).status, 200);
  assert.equal((await ctx.workspace(a.cookie)).body.summary.availableCents, 2475); const other = await ctx.workspace(b.cookie); assert.deepEqual(other.body.links, []); assert.equal(other.body.summary.availableCents, 0);
  assert.equal((await ctx.workspace(b.cookie, `/api/links/${link.id}`, { active: false }, { method: "PATCH" })).status, 404);
  const merchantA = ctx.sqlite.prepare("SELECT id FROM merchants WHERE owner_user_id=?").get(aIdentity.userId);
  assert.equal((await ctx.workspace(b.cookie, "/api/account/profile", fields, { headers: { "X-Harbor-Account-Id": merchantA.id } })).status, 409);
  const publicData = await ctx.workspace(null, `/api/pay/${link.token}`); assert.equal(JSON.stringify(publicData.body).includes("a@example.test"), false);
});

test("concurrent signup is bounded and leaves exactly one consistent account", async (t) => {
  const ctx = setup(t); const [a, b] = await Promise.all([ctx.signup(), ctx.signup("SELLER@example.test")]);
  assert.equal([a.status, b.status].filter((status) => status === 201).length, 1); assert.ok([a.status, b.status].some((status) => [409, 503].includes(status)));
  assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM auth_users").get().n, 1); assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM merchants").get().n, 1);
  const retry = await ctx.login(); assert.equal(retry.status, 200);
});

test("stale signup cannot switch or overwrite an already signed-in account", async (t) => {
  const ctx = setup(t); const first = await ctx.signup(); const oldIdentity = await ctx.user(first.cookie);
  const stale = await ctx.signup("another@example.test", {}, { cookie: first.cookie }); assert.equal(stale.status, 409); assert.equal(stale.body.code, "already_signed_in"); assert.equal(stale.cookie, null);
  assert.deepEqual(await ctx.user(first.cookie), oldIdentity); assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM auth_users").get().n, 1); assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM merchants").get().n, 1);
});

test("legacy signup completes an unfinished profile while retaining merchant identity", async (t) => {
  const ctx = setup(t); ctx.sqlite.prepare("INSERT INTO merchants(id,owner_user_id,name,created_at) VALUES(?,?,?,?)").run("legacy", "platform-owner", "Old automatic name", new Date(START).toISOString());
  ctx.platform({ userId: "platform-owner", email: "seller@example.test", displayName: "Original Owner" });
  const registered = await ctx.signup(); assert.equal(registered.status, 201); const account = await ctx.workspace(registered.cookie, "/api/account"); assert.equal(account.body.registrationRequired, false); assert.equal(account.body.account.id, "legacy"); assert.equal(account.body.account.businessName, fields.businessName); assert.equal(account.body.account.displayName, fields.displayName);
});

test("email normalization rejects control characters, non-ASCII and malformed addresses", () => {
  assert.equal(normalizeEmail(" A.User+tag@Example.TEST "), "a.user+tag@example.test");
  for (const value of ["a..b@example.test", ".a@example.test", "a@-bad.test", "a@example", "ü@example.test", "a\n@example.test", "a@@example.test", null]) assert.equal(normalizeEmail(value), null);
});
