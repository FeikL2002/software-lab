import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, parameterize } from '../server/postgres.mjs';
import { handleRequest } from '../server/harbor.mjs';
import { getSessionUser, handleAuthRequest } from '../server/auth.mjs';

const ORIGIN = 'https://harbor.example';
const NOW = 1_800_000_000_000;
const PASSWORD = 'A local integration password!';
const migration = readFileSync(new URL('../netlify/database/migrations/20261014070000_harbor_schema.sql', import.meta.url), 'utf8');

// PGlite is only a local test backend. Its single embedded connection needs a
// test mutex; production always uses the native Netlify Postgres pool.
async function fixture(t) {
  const engine = new PGlite();
  await engine.exec(migration);
  t.after(() => engine.close());
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }
  async function query(text, values = []) {
    const result = await engine.query(text, values);
    return { rows: result.rows, fields: result.fields, rowCount: result.affectedRows ?? result.rows.length };
  }
  const pool = {
    async query(text, values) { const release = await acquire(); try { return await query(text, values); } finally { release(); } },
    async connect() { const release = await acquire(); return { query, release }; },
  };
  return { engine, pool, db: createDatabase(pool, { sleep: async () => {} }) };
}
function apiContext(db) {
  const env = { DB: db };
  let ipSuffix = 0;
  const deps = { now: () => NOW, clientIp: () => `203.0.113.${++ipSuffix}` };
  async function auth(path, body, cookie) {
    const response = await handleAuthRequest(new Request(`${ORIGIN}${path}`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
    }), env, deps);
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function signup(email, title) {
    return auth('/api/auth/signup', { email, password: PASSWORD, displayName: title, businessName: `${title} shop`, businessType: 'individual', country: 'US' });
  }
  async function merchant(cookie) {
    const user = await getSessionUser(db, cookie, { now: () => NOW, url: ORIGIN });
    return user ? await db.prepare('SELECT * FROM merchants WHERE owner_user_id=?').bind(user.userId).first() : null;
  }
  async function req(cookie, path, body, { method = body === undefined ? 'GET' : 'POST', assertedAccount } = {}) {
    const user = await getSessionUser(db, cookie, { now: () => NOW, url: ORIGIN });
    const seller = user ? await merchant(cookie) : null;
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, {
      method, headers: { ...(body === undefined ? {} : { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Harbor-Account-Id': assertedAccount ?? seller?.id ?? '' }) }, body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { ...deps, getUser: async () => user });
    return { status: response.status, body: await response.json() };
  }
  return { auth, signup, merchant, req };
}

test('bind-marker conversion preserves quoted question marks and comments', () => {
  const sql = `SELECT ?, '?' AS literal, 'it''s ?' AS escaped, "?" AS identifier, $$?$$, $tag$?$tag$, E'\\\'?' -- ?\n/* ? /* nested ? */ ? */ WHERE id=?`;
  const converted = parameterize(sql);
  assert.equal(converted.parameterCount, 2);
  assert.equal(converted.text, sql.replace('SELECT ?', 'SELECT $1').replace('WHERE id=?', 'WHERE id=$2'));
  assert.throws(() => parameterize('SELECT $$unclosed'), /Unclosed/);
});

test('the complete Postgres schema enforces foreign keys, uniqueness, exact integers, and batch rollback', async (t) => {
  const { db, engine } = await fixture(t);
  const tables = await db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema='public'").all();
  assert.deepEqual(tables.results.map((row) => row.table_name).sort(), ['auth_rate_limits', 'auth_sessions', 'auth_users', 'merchants', 'orders', 'payment_links', 'test_payouts', 'webhook_events']);
  const values = await db.prepare("SELECT ?::bigint AS timestamp, ?::text AS text, '?' AS literal").bind(NOW, '123').first();
  assert.equal(values.timestamp, NOW);
  assert.equal(values.text, '123');
  assert.equal(values.literal, '?');
  assert.equal(await db.prepare('SELECT 1 AS absent WHERE false').first(), null);
  assert.throws(() => db.prepare('SELECT ?').bind(), /bind count/);
  assert.throws(() => db.prepare('SELECT ?').bind(Number.MAX_SAFE_INTEGER + 1), /exact integers/);
  await assert.rejects(db.prepare('SELECT 9007199254740992::bigint AS corrupt').first(), /safe numeric range/);
  await assert.rejects(db.prepare('SELECT 9007199254740992::numeric AS corrupt').first(), /safe numeric range/);
  await assert.rejects(db.prepare('SELECT 1.5::numeric AS corrupt').first(), /integer/);
  const owner = db.prepare('INSERT INTO merchants(id,owner_user_id,name,created_at) VALUES(?,?,?,?)').bind('rollback-owner', 'rollback-user', 'Rollback', 'now');
  const badForeignKey = db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind('rollback-session', 'missing-user', NOW, NOW + 1000);
  await assert.rejects(db.batch([owner, badForeignKey]), (error) => error.code === '23503');
  assert.equal(await db.prepare('SELECT id FROM merchants WHERE id=?').bind('rollback-owner').first(), null);
  const result = await owner.run(); assert.equal(result.meta.changes, 1);
  await assert.rejects(owner.run(), (error) => error.code === '23505' && error.message === 'UNIQUE constraint failed');
  assert.equal(await db.prepare('SELECT payment_fixed_cents FROM merchants WHERE id=?').bind('rollback-owner').first('payment_fixed_cents'), 0);
  await engine.exec("INSERT INTO orders(id,merchant_id,link_id,link_title,mode,engine,gross_cents,platform_fee_cents,net_cents,receipt_token,request_id,created_at,updated_at) SELECT 'invalid','rollback-owner','nonexistent','Bad','test','simulation',10,0,10,'bad-receipt','bad-request','now','now'").then(() => assert.fail('missing link FK accepted'), (error) => assert.equal(error.code, '23503'));
});

test('real Postgres SQL handles email accounts, seller isolation, payment replay, earnings, and conditional payouts', async (t) => {
  const { db } = await fixture(t);
  const ctx = apiContext(db);
  const a = await ctx.signup('seller-a@example.test', 'Seller A');
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await ctx.signup('seller-b@example.test', 'Seller B');
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const duplicate = await ctx.signup('seller-a@example.test', 'Spoofed');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'signup_unavailable');
  const accountA = await ctx.merchant(a.cookie);
  const accountB = await ctx.merchant(b.cookie);
  assert.notEqual(accountA.id, accountB.id);
  const session = await db.prepare('SELECT created_at,expires_at FROM auth_sessions LIMIT 1').first();
  assert.equal(session.created_at, NOW); assert.equal(session.expires_at, NOW + 86_400_000);
  const created = await ctx.req(a.cookie, '/api/links', { mode: 'test', title: 'Postgres service', description: 'Local integration check', amountCents: 10_000, currency: 'usd' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const link = created.body.link;
  assert.deepEqual((await ctx.req(b.cookie, '/api/workspace')).body.links, []);
  const forbidden = await ctx.req(b.cookie, `/api/links/${link.id}`, { active: false }, { method: 'PATCH' });
  assert.equal(forbidden.status, 404);
  const stale = await ctx.req(b.cookie, '/api/links', { mode: 'test', title: 'Stale tab', description: '', amountCents: 1000, currency: 'usd' }, { assertedAccount: accountA.id });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'account_changed');
  const checkoutId = randomUUID();
  const checkout = await ctx.req(null, `/api/pay/${link.token}/checkout`, { requestId: checkoutId });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const replay = await ctx.req(null, `/api/pay/${link.token}/checkout`, { requestId: checkoutId });
  assert.equal(replay.body.orderId, checkout.body.orderId);
  const outcome = { receiptToken: checkout.body.receiptToken, outcome: 'paid' };
  await Promise.all([ctx.req(null, `/api/pay/${link.token}/simulate`, outcome), ctx.req(null, `/api/pay/${link.token}/simulate`, outcome)]);
  const earnings = await ctx.req(a.cookie, '/api/workspace');
  assert.equal(earnings.status, 200, JSON.stringify(earnings.body));
  assert.equal(earnings.body.summary.grossCents, 10_000);
  assert.equal(earnings.body.summary.availableCents, 9900);
  assert.equal(earnings.body.summary.platformRevenueCents, 100);
  const requests = [randomUUID(), randomUUID()];
  const withdrawals = await Promise.all(requests.map((requestId) => ctx.req(a.cookie, '/api/payouts', { mode: 'test', debitCents: 6000, requestId })));
  assert.deepEqual(withdrawals.map((result) => result.status).sort(), [201, 409]);
  assert.equal(withdrawals.find((result) => result.status === 409).body.code, 'insufficient_balance');
  const available = await ctx.req(a.cookie, '/api/workspace');
  assert.equal(available.body.summary.availableCents, 3900);
  const persisted = await db.prepare('SELECT request_id FROM test_payouts WHERE merchant_id=?').bind(accountA.id).first();
  const payoutReplay = await ctx.req(a.cookie, '/api/payouts', { mode: 'test', debitCents: 6000, requestId: persisted.request_id });
  assert.equal(payoutReplay.status, 200);
  assert.equal((await ctx.req(a.cookie, '/api/workspace')).body.summary.availableCents, 3900);
  assert.equal((await ctx.req(b.cookie, '/api/workspace')).body.summary.availableCents, 0);
  const wrong = await ctx.auth('/api/auth/login', { email: 'seller-a@example.test', password: 'An incorrect password!' });
  assert.equal(wrong.status, 401);
  const login = await ctx.auth('/api/auth/login', { email: 'seller-a@example.test', password: PASSWORD }, a.cookie);
  assert.equal(login.status, 200);
  assert.equal(await getSessionUser(db, a.cookie, { now: () => NOW, url: ORIGIN }), null);
  assert.equal((await ctx.req(login.cookie, '/api/workspace')).body.summary.availableCents, 3900);
  assert.equal((await ctx.auth('/api/auth/logout', {}, login.cookie)).status, 200);
  assert.equal((await ctx.req(login.cookie, '/api/workspace')).status, 401);
});

test('mutating first and all use same-client SERIALIZABLE transactions; retries are bounded and results come from committed attempts', async () => {
  const events = [];
  let connects = 0;
  const pool = {
    async query() { assert.fail('A mutation must never use a pooled query outside its transaction.'); },
    async connect() {
      const attempt = ++connects;
      return {
        async query(sql) {
          events.push([attempt, sql]);
          if (sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE' || sql === 'ROLLBACK') return { rows: [], fields: [], rowCount: 0 };
          if (sql === 'COMMIT') {
            if (attempt < 3) { const error = new Error('retry'); error.code = attempt === 1 ? '40001' : '40P01'; throw error; }
            return { rows: [], fields: [], rowCount: 0 };
          }
          return { rows: [{ attempts: attempt, expires_at: String(NOW) }], fields: [{ name: 'attempts', dataTypeID: 23 }, { name: 'expires_at', dataTypeID: 20 }], rowCount: 1 };
        },
        release() { events.push([attempt, 'release']); },
      };
    },
  };
  const db = createDatabase(pool, { sleep: async () => {} });
  const row = await db.prepare('INSERT INTO auth_rate_limits(key,attempts,expires_at) VALUES(?,1,?) RETURNING attempts,expires_at').bind('rate', NOW).first();
  assert.deepEqual(row, { attempts: 3, expires_at: NOW });
  assert.equal(connects, 3);
  assert.equal(events.filter(([, sql]) => sql === 'ROLLBACK').length, 2);
  assert.equal(events.filter(([, sql]) => sql === 'release').length, 3);
  const all = await db.prepare('UPDATE auth_rate_limits SET attempts=attempts+1 RETURNING attempts').all();
  assert.equal(all.results[0].attempts, 4);
  const exhausted = createDatabase({ ...pool, async connect() { return { async query(sql) { if (sql === 'ROLLBACK') return {}; const error = new Error('retry exhausted'); error.code = '40001'; throw error; }, release() {} }; } }, { maxAttempts: 2, sleep: async () => {} });
  await assert.rejects(exhausted.prepare('UPDATE auth_rate_limits SET attempts=0').run(), (error) => error.code === '40001');
});
