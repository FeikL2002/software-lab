import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { handlePrivateRequest, privatePolicy } from "../server/private-http.mjs";

const ORIGIN = "https://harbor.example";
const CODE = "private-test-invitation-code-123456";
const PASSWORD = "A strong private harbor password!";
const profile = { displayName: "Private Owner", businessName: "Owner Studio", businessType: "individual", country: "US" };
const HASH = createHash("sha256").update(CODE).digest("hex");

function setup(t) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const DB = {
    prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args) }; }, async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; } }; },
    async batch(statements) { sqlite.exec("BEGIN"); try { const rows = []; for (const statement of statements) rows.push(await statement.run()); sqlite.exec("COMMIT"); return rows; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
  };
  const env = { DB, HARBOR_ALLOWED_EMAILS: "owner@example.test,other@example.test", HARBOR_INVITE_CODE_HASH: HASH };
  async function request(path, body, options = {}) {
    const headers = { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: options.origin || ORIGIN }), ...(options.headers || {}) };
    if (options.cookie) headers.Cookie = options.cookie;
    const response = await handlePrivateRequest(new Request(`${ORIGIN}${path}`, { method: options.method || (body === undefined ? "GET" : "POST"), headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { clientIp: "203.0.113.42", now: () => 1_800_000_000_000 });
    const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch {}
    return { response, status: response.status, text, data, cookie: response.headers.get("set-cookie")?.split(";")[0] || null };
  }
  const signup = (email = "owner@example.test", override = {}, options) => request("/api/auth/signup", { email, password: PASSWORD, inviteCode: CODE, ...profile, ...override }, options);
  const login = (email = "owner@example.test", options) => request("/api/auth/login", { email, password: PASSWORD }, options);
  return { sqlite, env, request, signup, login };
}

test("private configuration is strict and missing settings fail closed", async (t) => {
  const ctx = setup(t);
  for (const value of [undefined, "", "owner@example.test,", "broken", "owner@example.test\nother@example.test"]) assert.equal(privatePolicy({ ...ctx.env, HARBOR_ALLOWED_EMAILS: value }), null);
  assert.equal(privatePolicy({ ...ctx.env, HARBOR_INVITE_CODE_HASH: "invalid" }), null);
  ctx.env.HARBOR_ALLOWED_EMAILS = "";
  for (const path of ["/", "/signup", "/login", "/pay/abc", "/api/account", "/api/auth/context"]) assert.equal((await ctx.request(path)).status, 503);
  assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM auth_users").get().n, 0);
});

test("anonymous users can reach credential pages but private HTML and all payment data require an app session", async (t) => {
  const ctx = setup(t);
  for (const path of ["/login", "/signup"]) { const page = await ctx.request(path); assert.equal(page.status, 200); assert.ok(page.text.includes("/account.js")); assert.equal(/chatgpt|signin-with|oai-user/i.test(page.text), false); }
  const root = await ctx.request("/"); assert.equal(root.status, 303); assert.equal(root.response.headers.get("location"), "/login?return_to=%2F"); assert.equal(root.text, "");
  const checkout = await ctx.request("/pay/abcdef?receipt=123"); assert.equal(checkout.status, 303); assert.equal(checkout.response.headers.get("location"), "/login?return_to=%2Fpay%2Fabcdef%3Freceipt%3D123");
  for (const path of ["/api/account", "/api/workspace?mode=test", "/api/pay/abcdef", "/api/pay/abcdef/receipt"]) assert.equal((await ctx.request(path)).status, 401);
  assert.equal((await ctx.request("/api/pay/abcdef/checkout", { requestId: "123" })).status, 401);
});

test("anonymous auth context never exposes imported merchant data or trusts platform headers", async (t) => {
  const ctx = setup(t); ctx.sqlite.prepare("INSERT INTO merchants(id,owner_user_id,name,created_at,contact_email) VALUES(?,?,?,?,?)").run("legacy", "old-owner", "Secret Business", "2026-01-01", "owner@example.test");
  ctx.env.HARBOR_OWNER_EMAIL = "owner@example.test"; ctx.env.HARBOR_OWNER_MERCHANT_ID = "legacy";
  const headers = { "x-oai-user-id": "old-owner", "x-oai-user-email": "owner@example.test", "x-chatgpt-user-id": "old-owner", Authorization: "Bearer old-session", "CF-Connecting-IP": "trusted-owner" };
  const context = await ctx.request("/api/auth/context", undefined, { headers }); assert.deepEqual(context.data, { legacyAccount: null }); assert.equal(context.text.includes("Secret Business"), false);
  assert.equal((await ctx.request("/api/account", undefined, { headers })).status, 401); assert.equal((await ctx.request("/", undefined, { headers })).status, 303);
  assert.equal((await ctx.request("/.netlify/functions/harbor", undefined, { headers })).status, 404);
});

test("signup requires both approved email and private code before creating credentials", async (t) => {
  const ctx = setup(t);
  for (const attempt of [await ctx.signup("outsider@example.test"), await ctx.signup(undefined, { inviteCode: "wrong code long enough" }), await ctx.signup(undefined, { inviteCode: undefined })]) { assert.equal(attempt.status, 403); assert.equal(attempt.data.code, "private_access_required"); }
  assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM auth_users").get().n, 0); assert.equal(ctx.sqlite.prepare("SELECT count(*) n FROM merchants").get().n, 0);
  const foreign = await ctx.signup(undefined, {}, { origin: "https://evil.example" }); assert.equal(foreign.status, 403); assert.equal(foreign.data.code, "invalid_origin");
  const wrongFields = await ctx.signup(undefined, { owner_user_id: "override" }); assert.equal(wrongFields.status, 400);
  const owner = await ctx.signup("  OWNER@EXAMPLE.TEST  "); assert.equal(owner.status, 201); assert.ok(owner.cookie); assert.equal(owner.text.includes(CODE), false);
  assert.equal((await ctx.request("/api/account", undefined, { cookie: owner.cookie })).status, 200);
});

test("removing an approved email immediately invalidates its existing sessions and login", async (t) => {
  const ctx = setup(t); const signup = await ctx.signup(); assert.equal(signup.status, 201);
  assert.equal((await ctx.request("/", undefined, { cookie: signup.cookie })).status, 200);
  ctx.env.HARBOR_ALLOWED_EMAILS = "other@example.test";
  assert.equal((await ctx.request("/api/account", undefined, { cookie: signup.cookie })).status, 401); assert.equal((await ctx.request("/pay/abcdef", undefined, { cookie: signup.cookie })).status, 303); assert.equal((await ctx.login()).status, 403);
  const logout = await ctx.request("/api/auth/logout", {}, { cookie: signup.cookie }); assert.equal(logout.status, 200); assert.ok(logout.response.headers.get("set-cookie").includes("Max-Age=0"));
  ctx.env.HARBOR_ALLOWED_EMAILS = "owner@example.test"; assert.equal((await ctx.request("/api/account", undefined, { cookie: signup.cookie })).status, 401);
});

test("operator owner mapping preserves imported financial ownership only with the matching invite and email", async (t) => {
  const ctx = setup(t); const created = "2026-01-01T00:00:00.000Z";
  ctx.sqlite.prepare("INSERT INTO merchants(id,owner_user_id,name,created_at,account_display_name,contact_email,business_type,country,onboarding_completed_at,payment_percent_bps) VALUES(?,?,?,?,?,?,?,?,?,?)").run("legacy", "original-owner", "Existing Business", created, "Existing Name", "owner@example.test", "company", "US", created, 250);
  ctx.sqlite.prepare("INSERT INTO payment_links(id,merchant_id,token,title,amount_cents,currency,mode,payment_percent_bps,payment_fixed_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("original-link", "legacy", "a".repeat(48), "Existing service", 2500, "usd", "test", 250, 0, created);
  ctx.env.HARBOR_OWNER_EMAIL = "owner@example.test"; ctx.env.HARBOR_OWNER_MERCHANT_ID = "legacy";
  const other = await ctx.signup("other@example.test"); assert.equal(other.status, 201); assert.notEqual((await ctx.request("/api/account", undefined, { cookie: other.cookie })).data.account.id, "legacy");
  const owner = await ctx.signup(); assert.equal(owner.status, 201);
  const workspace = await ctx.request("/api/workspace?mode=test", undefined, { cookie: owner.cookie }); assert.equal(workspace.status, 200); assert.equal(workspace.data.merchant.id, "legacy"); assert.equal(workspace.data.links[0].id, "original-link");
  const row = ctx.sqlite.prepare("SELECT * FROM merchants WHERE id='legacy'").get(); assert.equal(row.owner_user_id, "original-owner"); assert.equal(row.created_at, created); assert.equal(row.name, "Existing Business"); assert.equal(row.payment_percent_bps, 250);
  const otherWorkspace = await ctx.request("/api/workspace?mode=test", undefined, { cookie: other.cookie }); assert.deepEqual(otherWorkspace.data.links, []);
});

test("approved password login and logout work without invitation or external identity after signup", async (t) => {
  const ctx = setup(t); const first = await ctx.signup(); const logout = await ctx.request("/api/auth/logout", {}, { cookie: first.cookie }); assert.equal(logout.status, 200);
  const loggedIn = await ctx.login(); assert.equal(loggedIn.status, 200); assert.notEqual(first.cookie, loggedIn.cookie);
  const page = await ctx.request("/", undefined, { cookie: loggedIn.cookie }); assert.equal(page.status, 200); assert.ok(page.text.includes("Your payment workspace")); assert.ok(page.text.includes("/app.js"));
  const checkout = await ctx.request("/pay/abcdef", undefined, { cookie: loggedIn.cookie }); assert.equal(checkout.status, 200); assert.ok(checkout.text.includes("/checkout.js"));
});

test("private responses disable caching, indexing, and embedding; provider callbacks remain disabled", async (t) => {
  const ctx = setup(t); const response = (await ctx.request("/login")).response;
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow"); assert.equal(response.headers.get("x-frame-options"), "DENY"); assert.ok(response.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  assert.equal((await ctx.request("/api/webhooks/stripe/live", {})).status, 503); assert.equal((await ctx.request("/api/webhooks/stripe/test", {})).status, 503);
  const head = await ctx.request("/login", undefined, { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(head.text, "");
});
