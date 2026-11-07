import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { handleRequest } from '../server/harbor.mjs';

const ORIGIN = 'https://harbor.example';
const timestamp = 1_800_000_000_000;
function database(beforeAdditionalMigrations) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const files = readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.length, 'Generate the checked-in database migration before running backend tests.');
  for (const [index, file] of files.entries()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
    if (index === 0) beforeAdditionalMigrations?.(sqlite);
  }
  const adapter = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql); let values = [];
      return { bind(...args) { values = args; return this; }, async first() { return stmt.get(...values) ?? null; }, async all() { return { results: stmt.all(...values) }; }, async run() { const r = stmt.run(...values); return { success: true, meta: { changes: r.changes } }; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const stmt of statements) results.push(await stmt.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, adapter };
}
function setup(t, envExtra = {}, { registered = true, beforeAdditionalMigrations } = {}) {
  const { sqlite, adapter } = database(beforeAdditionalMigrations); t.after(() => sqlite.close());
  let user = { userId: 'owner-A', displayName: 'Test Studio', email: 'owner@example.test' };
  const env = { DB: adapter, ...envExtra };
  const deps = { getUser: async () => user, now: () => timestamp };
  const initialUser = user;
  const accountBody = { displayName: 'Test owner', businessName: 'Test Studio', businessType: 'individual', country: 'US' };
  const ready = registered ? handleRequest(new Request(`${ORIGIN}/api/account/register`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Harbor-Account-Email': initialUser.email }, body: JSON.stringify(accountBody) }), env, { ...deps, getUser: async () => initialUser }).then(async (response) => assert.equal(response.status, 201, JSON.stringify(await response.json()))) : Promise.resolve();
  async function req(path, body, { method = body === undefined ? 'GET' : 'POST', origin = ORIGIN, headers = {} } = {}) {
    await ready;
    const h = { ...headers }; if (body !== undefined) { h['Content-Type'] = 'application/json'; if (origin !== null) h.Origin = origin; }
    if (path === '/api/account/register' && method === 'POST' && user?.email && !Object.keys(h).some((key) => key.toLowerCase() === 'x-harbor-account-email')) h['X-Harbor-Account-Email'] = user.email;
    const registeredWrite = path === '/api/account/profile' || path === '/api/links' || /^\/api\/links\/[^/]+$/.test(path) || path === '/api/settings' || path === '/api/payouts';
    if (registeredWrite && (method === 'POST' || method === 'PATCH') && !Object.keys(h).some((key) => key.toLowerCase() === 'x-harbor-account-id')) {
      const currentMerchant = user?.userId ? sqlite.prepare('SELECT id FROM merchants WHERE owner_user_id=?').get(user.userId) : null;
      if (currentMerchant) h['X-Harbor-Account-Id'] = currentMerchant.id;
    }
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps);
    return { status: response.status, body: await response.json() };
  }
  async function link(amountCents = 10000, mode = 'test') { const result = await req('/api/links', { mode, title: 'Design session', description: 'A product/service checkout', amountCents, currency: 'usd' }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.link; }
  async function paid(paymentLink) { const checkout = await req(`/api/pay/${paymentLink.token}/checkout`, { requestId: randomUUID() }); assert.equal(checkout.status, 201); const result = await req(`/api/pay/${paymentLink.token}/simulate`, { receiptToken: checkout.body.receiptToken, outcome: 'paid' }); assert.equal(result.status, 200); return { checkout: checkout.body, payment: result.body.payment }; }
  const register = (fields = {}) => req('/api/account/register', { ...accountBody, ...fields });
  return { sqlite, env, deps, req, link, paid, register, as(next) { user = next; } };
}
function sign(raw, secret, seconds = timestamp / 1000) { return `t=${seconds},v1=${createHmac('sha256', secret).update(`${seconds}.${raw}`).digest('hex')}`; }
async function webhook(ctx, event, mode = 'test', signature) {
  const raw = JSON.stringify(event); const response = await handleRequest(new Request(`${ORIGIN}/api/webhooks/stripe/${mode}`, { method: 'POST', headers: { 'stripe-signature': signature ?? sign(raw, ctx.env[`STRIPE_${mode.toUpperCase()}_WEBHOOK_SECRET`]) }, body: raw }), ctx.env, ctx.deps);
  return { status: response.status, body: await response.json() };
}
function stripeEnv() { return { STRIPE_TEST_SECRET_KEY: 'sk_test_serverfixture', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_testfixture' }; }
async function prepareStripe(ctx) {
  await ctx.req('/api/workspace?mode=test');
  ctx.sqlite.prepare("UPDATE merchants SET stripe_test_account_id='acct_testfixture'").run();
  let calls = 0;
  const providerState = { status: "open", expiresAt: timestamp / 1000 + 3600 };
  ctx.deps.fetch = async (url, options) => {
    if (url.endsWith('/v1/accounts/acct_testfixture')) return Response.json({ id: 'acct_testfixture', charges_enabled: true, capabilities: { transfers: 'active', card_payments: 'active' } });
    if (options.method === 'GET') {
      const row = ctx.sqlite.prepare('SELECT * FROM orders WHERE session_id=?').get(url.split('/').pop());
      return Response.json({ object: 'checkout.session', id: row.session_id, mode: 'payment', status: providerState.status, expires_at: providerState.expiresAt, url: row.checkout_url, livemode: false, amount_total: row.gross_cents, currency: row.currency, client_reference_id: row.id, metadata: { harbor_payment_id: row.id, harbor_link_id: row.link_id }, ...providerState.overrides });
    }
    calls++;
    const body = options.body;
    assert.equal(options.headers['Stripe-Account'], undefined);
    assert.equal(body.get('payment_intent_data[transfer_data][destination]'), 'acct_testfixture');
    assert.equal(body.get('payment_intent_data[application_fee_amount]'), '100');
    assert.equal(body.get('line_items[0][price_data][unit_amount]'), '10000');
    assert.ok(body.get('success_url').startsWith(`${ORIGIN}/pay/`));
    const sessionId = calls === 1 ? 'cs_test_fixture' : `cs_test_fixture${calls}`;
    return Response.json({ id: sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}`, livemode: false, amount_total: Number(body.get('line_items[0][price_data][unit_amount]')), currency: 'usd', client_reference_id: body.get('client_reference_id'), metadata: { harbor_payment_id: body.get('metadata[harbor_payment_id]'), harbor_link_id: body.get('metadata[harbor_link_id]') } });
  };
  const link = await ctx.link(); const checkout = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() }); assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const session = { object: 'checkout.session', id: 'cs_test_fixture', livemode: false, amount_total: 10000, currency: 'usd', client_reference_id: checkout.body.orderId, metadata: { harbor_payment_id: checkout.body.orderId, harbor_link_id: link.id }, payment_status: 'paid' };
  return { link, checkout: checkout.body, session, providerState, calls: () => calls };
}

test('new authenticated merchant has zero persisted money; unauthenticated workspace is rejected', async (t) => {
  const ctx = setup(t); const first = await ctx.req('/api/workspace?mode=test');
  assert.equal(first.status, 200); assert.deepEqual(first.body.summary, { grossCents: 0, availableCents: 0, pendingCents: 0, platformRevenueCents: 0, paidOutCents: 0 });
  assert.equal(first.body.config.engines.test, 'simulation'); assert.equal(first.body.config.liveReady, false);
  const second = await ctx.req('/api/workspace'); assert.equal(second.body.merchant.id, first.body.merchant.id);
  ctx.as(null); const missing = await ctx.req('/api/workspace'); assert.equal(missing.status, 401); assert.equal(missing.body.code, 'auth_missing');
});

test('merchant ownership and mode filtering never expose another merchant records', async (t) => {
  const ctx = setup(t); const link = await ctx.link(); await ctx.paid(link);
  ctx.as({ userId: 'owner-B', displayName: 'Other merchant', email: 'other@example.test' });
  assert.equal((await ctx.register({ displayName: 'Other owner', businessName: 'Other merchant' })).status, 201);
  assert.deepEqual((await ctx.req('/api/workspace?mode=test')).body.links, []);
  assert.equal((await ctx.req(`/api/links/${link.id}`, { active: false }, { method: 'PATCH' })).status, 404);
  assert.equal((await ctx.req('/api/workspace?mode=live')).body.summary.availableCents, 0);
  ctx.as(null); const publicData = await ctx.req(`/api/pay/${link.token}`);
  assert.equal(publicData.status, 200); assert.equal(publicData.body.link.title, link.title); assert.equal(publicData.body.merchantName, 'Test Studio');
  assert.equal(JSON.stringify(publicData.body).includes('owner-A'), false); assert.equal('merchantId' in publicData.body.link, false);
});

test('checkout uses stored prices and modes and rejects browser tampering', async (t) => {
  const ctx = setup(t); const link = await ctx.link();
  for (const extra of [{ amountCents: 1 }, { mode: 'live' }, { merchantId: 'another' }, { platformFeeCents: 0 }]) {
    const result = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID(), ...extra }); assert.equal(result.status, 400);
  }
  const { payment } = await ctx.paid(link); assert.equal(payment.grossCents, 10000);
  const merchantPayment = (await ctx.req('/api/workspace')).body.payments.find((record) => record.id === payment.id); assert.equal(merchantPayment.platformFeeCents, 100); assert.equal(merchantPayment.netCents, 9900); assert.equal(merchantPayment.processorFeeCents, 0);
});

test('successful simulated checkout credits once across duplicate checkout and outcome replays', async (t) => {
  const ctx = setup(t); const link = await ctx.link(); const requestId = randomUUID();
  const a = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId }); const b = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId });
  assert.equal(a.body.orderId, b.body.orderId); assert.equal(a.body.receiptToken, b.body.receiptToken);
  const body = { receiptToken: a.body.receiptToken, outcome: 'paid' };
  await Promise.all([ctx.req(`/api/pay/${link.token}/simulate`, body), ctx.req(`/api/pay/${link.token}/simulate`, body)]);
  const replay = await ctx.req(`/api/pay/${link.token}/simulate`, { ...body, outcome: 'declined' }); assert.equal(replay.body.payment.status, 'paid');
  assert.equal((await ctx.req('/api/workspace')).body.summary.availableCents, 9900);
  assert.equal((await ctx.req(`/api/pay/${link.token}/receipt?receipt=${a.body.receiptToken}`)).body.payment.status, 'paid');
});

test('declined simulation produces no earnings and cannot be changed to paid by replay', async (t) => {
  const ctx = setup(t); const link = await ctx.link(); const checkout = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() });
  const path = `/api/pay/${link.token}/simulate`; const body = { receiptToken: checkout.body.receiptToken, outcome: 'declined' };
  await ctx.req(path, body); const replay = await ctx.req(path, { ...body, outcome: 'paid' }); assert.equal(replay.body.payment.status, 'declined');
  assert.equal((await ctx.req('/api/workspace')).body.summary.availableCents, 0);
});

test('inactive payment link rejects checkout and unsettled simulation; receipts remain available', async (t) => {
  const ctx = setup(t); const link = await ctx.link(); const checkout = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() });
  await ctx.req(`/api/links/${link.id}`, { active: false }, { method: 'PATCH' });
  assert.equal((await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() })).status, 410);
  assert.equal((await ctx.req(`/api/pay/${link.token}/simulate`, { receiptToken: checkout.body.receiptToken, outcome: 'paid' })).status, 410);
  assert.equal((await ctx.req(`/api/pay/${link.token}/receipt?receipt=${checkout.body.receiptToken}`)).status, 200);
});

test('all browser mutations enforce same-origin CSRF and bounded JSON shape', async (t) => {
  const ctx = setup(t); const link = await ctx.link();
  assert.equal((await ctx.req('/api/links', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() }, { origin: null })).status, 403);
  assert.equal((await ctx.req('/api/settings', { fees: {}, unrelated: true })).status, 400);
  assert.equal((await ctx.req('/api/links', { mode: 'test', title: 'a'.repeat(10000), description: '', amountCents: 1000, currency: 'usd' })).status, 413);
  const currentAccountId = (await ctx.req('/api/account')).body.account.id;
  const response = await handleRequest(new Request(`${ORIGIN}/api/links`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'X-Harbor-Account-Id': currentAccountId }, body: '{}' }), ctx.env, ctx.deps); assert.equal(response.status, 415);
});

test('fee changes apply to new links and payouts without changing historical link snapshots', async (t) => {
  const ctx = setup(t); const link = await ctx.link();
  const fees = { payment: { percentBps: 200, fixedCents: 30 }, withdrawal: { percentBps: 100, fixedCents: 20 } };
  assert.equal((await ctx.req('/api/settings', { fees, name: 'New studio' })).status, 200);
  const old = await ctx.paid(link); assert.equal((await ctx.req('/api/workspace')).body.payments.find((record) => record.id === old.payment.id).platformFeeCents, 100);
  const newer = await ctx.paid(await ctx.link()); assert.equal((await ctx.req('/api/workspace')).body.payments.find((record) => record.id === newer.payment.id).platformFeeCents, 230);
  const payout = await ctx.req('/api/payouts', { mode: 'test', debitCents: 5000, requestId: randomUUID() }); assert.equal(payout.body.payout.platformFeeCents, 70); assert.equal(payout.body.payout.bankReceivesCents, 4930);
  assert.equal((await ctx.req('/api/settings', { fees: { ...fees, payment: { percentBps: 2001, fixedCents: 0 } } })).status, 400);
  assert.equal((await ctx.req('/api/links', { mode: 'test', title: 'Tiny', description: '', amountCents: 1, currency: 'usd' })).body.code, 'fee_exceeds_amount');
});

test('atomic concurrent withdrawals cannot overdraw; same request replay cannot debit twice', async (t) => {
  const ctx = setup(t); await ctx.paid(await ctx.link());
  const bodyA = { mode: 'test', debitCents: 7000, requestId: randomUUID() }; const bodyB = { ...bodyA, requestId: randomUUID() };
  const results = await Promise.all([ctx.req('/api/payouts', bodyA), ctx.req('/api/payouts', bodyB)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winner = results[0].status === 201 ? bodyA : bodyB;
  assert.equal((await ctx.req('/api/payouts', winner)).status, 200);
  assert.equal((await ctx.req('/api/payouts', { ...winner, debitCents: 1000 })).body.code, 'idempotency_conflict');
  const workspace = (await ctx.req('/api/workspace')).body; assert.equal(workspace.summary.availableCents, 2900); assert.equal(workspace.payouts.length, 1); assert.equal(workspace.summary.paidOutCents, 6940);
});

test('live creation and live payouts reject missing provider activation; configured test key never silently simulates', async (t) => {
  const ctx = setup(t); const result = await ctx.req('/api/links', { mode: 'live', title: 'Live service', description: '', amountCents: 10000, currency: 'usd' }); assert.equal(result.status, 503); assert.equal(result.body.code, 'setup_required');
  assert.equal((await ctx.req('/api/payouts', { mode: 'live', debitCents: 1000, requestId: randomUUID() })).status, 503);
  const link = await ctx.link(); ctx.env.STRIPE_TEST_SECRET_KEY = 'sk_test_fixture';
  const checkout = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() }); assert.equal(checkout.status, 503); assert.equal(checkout.body.code, 'setup_required');
  assert.equal((await ctx.req('/api/workspace')).body.config.engines.test, 'stripe');
});

test('Stripe checkout adapter uses saved destination, amount, fees, stable idempotency and blocks simulation', async (t) => {
  const ctx = setup(t, stripeEnv()); const { link, checkout, calls } = await prepareStripe(ctx);
  assert.equal(checkout.engine, 'stripe'); assert.equal(calls(), 1);
  const record = ctx.sqlite.prepare('SELECT request_id FROM orders WHERE id=?').get(checkout.orderId);
  const retry = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: record.request_id }); assert.equal(retry.body.checkoutUrl, checkout.checkoutUrl); assert.equal(calls(), 1);
  assert.equal((await ctx.req(`/api/pay/${link.token}/simulate`, { receiptToken: checkout.receiptToken, outcome: 'paid' })).status, 403);
  assert.equal((await ctx.req('/api/workspace')).body.summary.availableCents, 0);
});

test('Stripe webhook validates raw signature, endpoint mode, recorded amount and order metadata', async (t) => {
  const ctx = setup(t, stripeEnv()); const { session } = await prepareStripe(ctx);
  const event = { id: 'evt_signaturefixture', type: 'checkout.session.completed', livemode: false, data: { object: session } };
  assert.equal((await webhook(ctx, event, 'test', 't=0,v1=' + '0'.repeat(64))).status, 400);
  assert.equal((await webhook(ctx, { ...event, livemode: true })).body.code, 'mode_mismatch');
  assert.equal((await webhook(ctx, { ...event, data: { object: { ...session, amount_total: 1 } } })).body.code, 'order_mismatch');
  assert.equal((await webhook(ctx, { ...event, data: { object: { ...session, metadata: { ...session.metadata, harbor_link_id: 'wrong' } } } })).status, 400);
  assert.equal((await ctx.req('/api/workspace')).body.summary.grossCents, 0);
});

test('Stripe signed paid event is idempotent pending-only earnings and never becomes spendable or downgraded', async (t) => {
  const ctx = setup(t, stripeEnv()); const { session, link, checkout } = await prepareStripe(ctx);
  const event = { id: 'evt_paidfixture', type: 'checkout.session.completed', livemode: false, data: { object: session } };
  assert.equal((await webhook(ctx, event)).status, 200); assert.equal((await webhook(ctx, event)).status, 200);
  assert.equal((await webhook(ctx, { ...event, id: 'evt_asyncfixture', type: 'checkout.session.async_payment_succeeded' })).status, 200);
  assert.equal((await webhook(ctx, { ...event, id: 'evt_failedfixture', type: 'checkout.session.async_payment_failed' })).status, 200);
  const w = (await ctx.req('/api/workspace')).body; assert.equal(w.summary.grossCents, 10000); assert.equal(w.summary.pendingCents, 9900); assert.equal(w.summary.availableCents, 0); assert.equal(w.payments[0].status, 'paid');
  assert.equal((await ctx.req(`/api/pay/${link.token}/receipt?receipt=${checkout.receiptToken}`)).body.payment.status, 'paid');
  assert.equal((await ctx.req('/api/payouts', { mode: 'test', debitCents: 1000, requestId: randomUUID() })).status, 503);
});

test('Stripe unpaid completion stays pending; success settles once; stale signature never transitions', async (t) => {
  const ctx = setup(t, stripeEnv()); const { session } = await prepareStripe(ctx);
  const event = { id: 'evt_unpaidfixture', type: 'checkout.session.completed', livemode: false, data: { object: { ...session, payment_status: 'unpaid' } } };
  assert.equal((await webhook(ctx, event)).status, 200); assert.equal((await ctx.req('/api/workspace')).body.payments[0].status, 'pending');
  const paid = { ...event, id: 'evt_successfixture', type: 'checkout.session.async_payment_succeeded', data: { object: session } };
  assert.equal((await webhook(ctx, paid, 'test', sign(JSON.stringify(paid), ctx.env.STRIPE_TEST_WEBHOOK_SECRET, timestamp / 1000 - 301))).status, 400);
  assert.equal((await webhook(ctx, paid)).status, 200); assert.equal((await ctx.req('/api/workspace')).body.summary.pendingCents, 9900);
});

test('live platform fee policy is server-owned and unaffected by seller preview settings', async (t) => {
  const ctx = setup(t, { STRIPE_LIVE_SECRET_KEY: 'sk_live_fixture', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_livefixture', HARBOR_LIVE_ENABLED: 'true', HARBOR_PUBLIC_CHECKOUT_ENABLED: 'true', HARBOR_LIVE_APPROVED: 'true', HARBOR_LIVE_PAYMENT_PERCENT_BPS: '250', HARBOR_LIVE_PAYMENT_FIXED_CENTS: '30' });
  await ctx.req('/api/workspace'); ctx.sqlite.prepare("UPDATE merchants SET stripe_live_account_id='acct_livefixture'").run();
  await ctx.req('/api/settings', { fees: { payment: { percentBps: 0, fixedCents: 0 }, withdrawal: { percentBps: 0, fixedCents: 0 } } });
  const link = await ctx.link(10000, 'live'); const row = ctx.sqlite.prepare('SELECT * FROM payment_links WHERE id=?').get(link.id);
  assert.equal(row.payment_percent_bps, 250); assert.equal(row.payment_fixed_cents, 30);
  const workspace = (await ctx.req('/api/workspace?mode=live')).body;
  assert.equal(workspace.config.feeEditingAllowed, false); assert.equal(workspace.config.liveFeesControlled, true); assert.deepEqual(workspace.config.liveFees.payment, { percentBps: 250, fixedCents: 30 }); assert.deepEqual(workspace.config.fees.payment, workspace.config.liveFees.payment);
  assert.equal((await ctx.req('/api/workspace?mode=test')).body.config.fees.payment.percentBps, 0);
});

test('receipts are scoped to their saved link and Stripe connected-account events are rejected', async (t) => {
  const ctx = setup(t, stripeEnv()); const { link, checkout, session } = await prepareStripe(ctx); const other = await ctx.link();
  assert.equal((await ctx.req(`/api/pay/${other.token}/receipt?receipt=${checkout.receiptToken}`)).status, 404);
  const event = { id: 'evt_connectedfixture', type: 'checkout.session.completed', livemode: false, account: 'acct_other', data: { object: session } };
  assert.equal((await webhook(ctx, event)).body.code, 'unexpected_account');
  assert.equal((await ctx.req(`/api/pay/${link.token}/receipt?receipt=${checkout.receiptToken}`)).body.payment.status, 'created');
});

test('blank or nonnumeric live fee configuration never silently enables zero-fee live payments', async (t) => {
  const ctx = setup(t, { STRIPE_LIVE_SECRET_KEY: 'sk_live_fixture', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_livefixture', HARBOR_LIVE_ENABLED: 'true', HARBOR_PUBLIC_CHECKOUT_ENABLED: 'true', HARBOR_LIVE_APPROVED: 'true', HARBOR_LIVE_PAYMENT_PERCENT_BPS: '', HARBOR_LIVE_PAYMENT_FIXED_CENTS: '0' });
  await ctx.req('/api/workspace'); ctx.sqlite.prepare("UPDATE merchants SET stripe_live_account_id='acct_livefixture'").run();
  for (const value of ['', null, false, '1.5', '-1', ' 0 ']) {
    ctx.env.HARBOR_LIVE_PAYMENT_PERCENT_BPS = value;
    const workspace = (await ctx.req('/api/workspace?mode=live')).body;
    assert.equal(workspace.config.liveReady, false); assert.equal(workspace.config.liveFees.payment, null);
  }
});

test('public simulate and receipt project only customer fields, while merchant records retain financials', async (t) => {
  const ctx = setup(t); const link = await ctx.link(); const { checkout, payment } = await ctx.paid(link);
  const keys = ['createdAt', 'engine', 'grossCents', 'id', 'mode', 'status'];
  assert.deepEqual(Object.keys(payment).sort(), keys);
  ctx.as(null); const receipt = (await ctx.req(`/api/pay/${link.token}/receipt?receipt=${checkout.receiptToken}`)).body.payment;
  assert.deepEqual(Object.keys(receipt).sort(), keys);
  for (const field of ['platformFeeCents', 'netCents', 'processorFeeCents', 'merchantId', 'linkId', 'requestId', 'sessionId']) { assert.equal(field in payment, false); assert.equal(field in receipt, false); }
  ctx.as({ userId: 'owner-A', displayName: 'Test Studio', email: 'owner@example.test' });
  const owned = (await ctx.req('/api/workspace')).body.payments[0]; assert.equal(owned.platformFeeCents, 100); assert.equal(owned.netCents, 9900); assert.equal(owned.processorFeeCents, 0);
});

test('Stripe reuse verifies expiration and permits explicit new checkout attempt instead of dead URL', async (t) => {
  const ctx = setup(t, stripeEnv()); const { link, checkout, providerState } = await prepareStripe(ctx);
  const requestId = ctx.sqlite.prepare('SELECT request_id FROM orders WHERE id=?').get(checkout.orderId).request_id;
  providerState.status = 'expired';
  const expired = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId }); assert.equal(expired.status, 409); assert.equal(expired.body.code, 'checkout_expired'); assert.equal('checkoutUrl' in expired.body, false);
  providerState.status = 'open'; providerState.expiresAt = timestamp / 1000 - 1;
  assert.equal((await ctx.req(`/api/pay/${link.token}/checkout`, { requestId })).body.code, 'checkout_expired');
  const fresh = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId: randomUUID() }); assert.equal(fresh.status, 201); assert.notEqual(fresh.body.orderId, checkout.orderId); assert.notEqual(fresh.body.checkoutUrl, checkout.checkoutUrl);
  assert.equal((await ctx.req('/api/workspace')).body.summary.grossCents, 0);
});

test('Stripe completed-session recovery returns receipt without crediting unsigned customer callbacks', async (t) => {
  const ctx = setup(t, stripeEnv()); const { link, checkout, providerState } = await prepareStripe(ctx);
  const requestId = ctx.sqlite.prepare('SELECT request_id FROM orders WHERE id=?').get(checkout.orderId).request_id;
  providerState.status = 'complete';
  const recovered = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId }); assert.equal(recovered.status, 200); assert.equal(recovered.body.checkoutCompleted, true); assert.equal(recovered.body.receiptToken, checkout.receiptToken); assert.equal(recovered.body.status, 'pending'); assert.equal('checkoutUrl' in recovered.body, false);
  const workspace = (await ctx.req('/api/workspace')).body; assert.equal(workspace.summary.grossCents, 0); assert.equal(workspace.summary.availableCents, 0); assert.equal(workspace.summary.pendingCents, 0);
});

test('Stripe retrieved-session mismatch refuses redirect or receipt recovery', async (t) => {
  const ctx = setup(t, stripeEnv()); const { link, checkout, providerState } = await prepareStripe(ctx);
  const requestId = ctx.sqlite.prepare('SELECT request_id FROM orders WHERE id=?').get(checkout.orderId).request_id;
  for (const overrides of [{ amount_total: 1 }, { livemode: true }, { metadata: { harbor_payment_id: checkout.orderId, harbor_link_id: 'wrong' } }, { url: 'https://evil.example/pay' }]) {
    providerState.overrides = overrides;
    const response = await ctx.req(`/api/pay/${link.token}/checkout`, { requestId }); assert.equal(response.status, 503); assert.equal('checkoutUrl' in response.body, false); assert.equal('receiptToken' in response.body, false);
  }
});

test('account lookup is read-only and unregistered identities cannot open or mutate a merchant workspace', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  const before = await ctx.req('/api/account');
  assert.equal(before.status, 200);
  assert.equal(before.body.authenticated, true);
  assert.equal(before.body.registrationRequired, true);
  assert.equal(before.body.authProvider, 'email');
  assert.equal(before.body.emailVerified, false);
  assert.equal(before.body.account.email, 'owner@example.test');
  assert.equal(before.body.account.displayName, 'Test Studio');
  assert.equal(before.body.account.registeredAt, null);
  assert.equal('id' in before.body.account, false);
  assert.equal(before.body.signInUrl, '/login');
  assert.equal(before.body.signOutUrl, '/api/auth/logout');
  for (const [path, body, method] of [
    ['/api/workspace'],
    ['/api/links', { mode: 'test', title: 'Blocked link', description: '', amountCents: 1000, currency: 'usd' }],
    ['/api/links/unknown', { active: false }, 'PATCH'],
    ['/api/settings', { fees: { payment: { percentBps: 1, fixedCents: 0 }, withdrawal: { percentBps: 1, fixedCents: 0 } } }],
    ['/api/payouts', { mode: 'test', debitCents: 1000, requestId: randomUUID() }],
    ['/api/account/profile', { displayName: 'A', businessName: 'B', businessType: 'individual', country: 'US' }],
  ]) {
    const response = await ctx.req(path, body, method ? { method } : {});
    assert.equal(response.status, 403, path);
    assert.equal(response.body.code, 'account_setup_required', path);
  }
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 0);
});

test('merchant and account endpoints deny anonymous or incomplete identity without exposing account data', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  for (const identity of [null, {}, { userId: 'owner-A' }, { email: 'owner@example.test' }, { userId: '', email: 'owner@example.test' }, { userId: 'owner-A', email: '' }]) {
    ctx.as(identity);
    for (const [path, body] of [
      ['/api/account'], ['/api/workspace'],
      ['/api/account/register', { displayName: 'Owner', businessName: 'Business', businessType: 'individual', country: 'US' }],
      ['/api/account/profile', { displayName: 'Owner', businessName: 'Business', businessType: 'individual', country: 'US' }],
    ]) {
      const result = await ctx.req(path, body);
      assert.equal(result.status, 401, path);
      assert.equal(result.body.code, 'auth_missing');
      assert.deepEqual(Object.keys(result.body).sort(), ['code', 'error']);
    }
  }
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 0);
});

test('registration validates and persists a trusted identity account that survives logout and return sign-in', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  const result = await ctx.register({ displayName: '  Alex Seller  ', businessName: '  Alex Studio  ', businessType: 'company', country: ' us ' });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.registrationRequired, false);
  assert.equal(result.body.account.displayName, 'Alex Seller');
  assert.equal(result.body.account.businessName, 'Alex Studio');
  assert.equal(result.body.account.country, 'US');
  assert.equal(result.body.account.businessType, 'company');
  assert.equal(result.body.account.email, 'owner@example.test');
  assert.equal(result.body.account.registeredAt, new Date(timestamp).toISOString());
  const accountId = result.body.account.id;
  const workspace = await ctx.req('/api/workspace');
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.merchant.id, accountId);
  assert.equal(workspace.body.merchant.name, 'Alex Studio');
  ctx.as(null);
  assert.equal((await ctx.req('/api/account')).status, 401);
  ctx.as({ userId: 'owner-A', email: 'owner@example.test', displayName: 'A different identity display name' });
  assert.deepEqual((await ctx.req('/api/account')).body, result.body);
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 1);
});

test('registration rejects browser-selected identity, email, merchant ids, and fee policy', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  for (const extra of [{ ownerUserId: 'other-owner' }, { owner_user_id: 'other-owner' }, { userId: 'other-owner' }, { email: 'attacker@example.test' }, { contactEmail: 'attacker@example.test' }, { merchantId: randomUUID() }, { id: randomUUID() }, { fees: { payment: 0 } }]) {
    const response = await ctx.register(extra);
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.equal(response.body.code, 'invalid_request');
  }
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 0);
  assert.equal((await ctx.req('/api/account')).body.registrationRequired, true);
});

test('account mutations enforce same-origin JSON, bounded names, strict country and business type', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  for (const fields of [{ displayName: '' }, { displayName: 'a'.repeat(101) }, { businessName: '  ' }, { businessName: 'a'.repeat(101) }, { businessType: 'bank' }, { country: 'USA' }, { country: '1A' }, { country: '' }, { country: null }]) assert.equal((await ctx.register(fields)).status, 400, JSON.stringify(fields));
  const body = { displayName: 'Seller', businessName: 'Studio', businessType: 'individual', country: 'US' };
  assert.equal((await ctx.req('/api/account/register', body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await ctx.req('/api/account/register', body, { origin: null })).status, 403);
  assert.equal((await ctx.req('/api/account/register')).status, 405);
  const textResponse = await handleRequest(new Request(`${ORIGIN}/api/account/register`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'X-Harbor-Account-Email': 'owner@example.test' }, body: JSON.stringify(body) }), ctx.env, ctx.deps);
  assert.equal(textResponse.status, 415);
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 0);
});

test('registration replay and concurrent registration retain one account and never reset existing profile or fees', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  const results = await Promise.all([ctx.register(), ctx.register()]);
  assert.ok(results.every((response) => response.status === 201 || response.status === 200));
  const original = (await ctx.req('/api/account')).body.account;
  assert.equal(results[0].body.account.id, results[1].body.account.id);
  const fees = { payment: { percentBps: 200, fixedCents: 30 }, withdrawal: { percentBps: 100, fixedCents: 20 } };
  await ctx.req('/api/settings', { fees });
  const link = await ctx.link();
  await ctx.paid(link);
  const before = (await ctx.req('/api/workspace')).body;
  const replay = await ctx.register({ displayName: 'Replacement', businessName: 'Replacement business', country: 'CA', businessType: 'company' });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.account, original);
  assert.deepEqual((await ctx.req('/api/workspace')).body, before);
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 1);
});

test('profile changes stay within the signed-in owner and use only trusted identity email', async (t) => {
  const ctx = setup(t);
  const alice = (await ctx.req('/api/account')).body.account;
  const aliceFees = (await ctx.req('/api/workspace')).body.config.fees;
  ctx.as({ userId: 'owner-B', displayName: 'Bob', email: 'bob@example.test' });
  assert.equal((await ctx.register({ displayName: 'Bob', businessName: 'Bob Studio', country: 'CA', businessType: 'company' })).status, 201);
  const bob = (await ctx.req('/api/account')).body.account;
  const changed = { displayName: 'Alex Updated', businessName: 'Updated Studio', country: 'GB', businessType: 'company' };
  ctx.as({ userId: 'owner-A', displayName: 'Provider name', email: 'updated-owner@example.test' });
  for (const extra of [{ id: bob.id }, { email: 'spoof@example.test' }, { ownerUserId: 'owner-B' }, { fees: aliceFees }]) assert.equal((await ctx.req('/api/account/profile', { ...changed, ...extra })).status, 400);
  const response = await ctx.req('/api/account/profile', changed);
  assert.equal(response.status, 200);
  assert.equal(response.body.account.id, alice.id);
  assert.equal(response.body.account.email, 'updated-owner@example.test');
  assert.equal(response.body.account.registeredAt, alice.registeredAt);
  assert.equal(response.body.account.displayName, changed.displayName);
  assert.equal(response.body.account.businessName, changed.businessName);
  assert.deepEqual((await ctx.req('/api/workspace')).body.config.fees, aliceFees);
  assert.equal(ctx.sqlite.prepare('SELECT contact_email FROM merchants WHERE id=?').get(alice.id).contact_email, 'updated-owner@example.test');
  ctx.as({ userId: 'owner-B', displayName: 'Bob', email: 'bob@example.test' });
  assert.deepEqual((await ctx.req('/api/account')).body.account, bob);
});

test('two registered sellers manage only their own links, earnings and payouts through returning identities', async (t) => {
  const ctx = setup(t);
  const aliceId = (await ctx.req('/api/account')).body.account.id;
  const aliceLink = await ctx.link(10000);
  await ctx.paid(aliceLink);
  ctx.as({ userId: 'owner-B', displayName: 'Bob', email: 'bob@example.test' });
  await ctx.register({ displayName: 'Bob', businessName: 'Bob Studio' });
  const bobId = (await ctx.req('/api/account')).body.account.id;
  assert.notEqual(bobId, aliceId);
  let bobWorkspace = (await ctx.req('/api/workspace')).body;
  assert.equal(bobWorkspace.links.length, 0);
  assert.equal(bobWorkspace.payments.length, 0);
  assert.equal(bobWorkspace.summary.availableCents, 0);
  assert.equal((await ctx.req(`/api/links/${aliceLink.id}`, { active: false }, { method: 'PATCH' })).status, 404);
  assert.equal((await ctx.req('/api/payouts', { mode: 'test', debitCents: 1000, requestId: randomUUID() })).status, 409);
  const bobLink = await ctx.link(5000);
  await ctx.paid(bobLink);
  await ctx.req('/api/payouts', { mode: 'test', debitCents: 1000, requestId: randomUUID() });
  bobWorkspace = (await ctx.req('/api/workspace')).body;
  assert.deepEqual(bobWorkspace.links.map((link) => link.id), [bobLink.id]);
  assert.equal(bobWorkspace.summary.availableCents, 3950);
  assert.equal((await ctx.req('/api/workspace?mode=live')).body.payments.length, 0);
  ctx.as(null);
  assert.equal((await ctx.req('/api/workspace')).status, 401);
  ctx.as({ userId: 'owner-A', displayName: 'Alice', email: 'owner@example.test' });
  const aliceWorkspace = (await ctx.req('/api/workspace')).body;
  assert.deepEqual(aliceWorkspace.links.map((link) => link.id), [aliceLink.id]);
  assert.equal(aliceWorkspace.payments.length, 1);
  assert.equal(aliceWorkspace.payouts.length, 0);
  assert.equal(aliceWorkspace.summary.availableCents, 9900);
  assert.equal((await ctx.req(`/api/links/${bobLink.id}`, { active: false }, { method: 'PATCH' })).status, 404);
});

test('additive account migration keeps legacy ids, links, payment history and fees through explicit account setup', async (t) => {
  const merchantId = randomUUID(); const linkId = randomUUID(); const token = 'b'.repeat(48); const receipt = 'c'.repeat(48);
  const oldTimestamp = '2026-09-01T00:00:00.000Z';
  const ctx = setup(t, {}, { registered: false, beforeAdditionalMigrations(sqlite) {
    sqlite.prepare('INSERT INTO merchants(id,owner_user_id,name,payment_percent_bps,payment_fixed_cents,withdrawal_percent_bps,withdrawal_fixed_cents,stripe_test_account_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(merchantId, 'owner-A', 'Legacy Studio', 250, 30, 75, 20, 'acct_legacyfixture', oldTimestamp);
    sqlite.prepare("INSERT INTO payment_links(id,merchant_id,token,title,description,amount_cents,currency,mode,payment_percent_bps,payment_fixed_cents,created_at) VALUES(?,?,?,?,?,?,'usd','test',?,?,?)").run(linkId, merchantId, token, 'Existing service', 'Saved before accounts', 10000, 250, 30, oldTimestamp);
    sqlite.prepare("INSERT INTO orders(id,merchant_id,link_id,link_title,mode,engine,status,gross_cents,platform_fee_cents,net_cents,currency,receipt_token,request_id,created_at,updated_at) VALUES(?,?,?,?,'test','simulation','paid',10000,280,9720,'usd',?,?,?,?)").run(randomUUID(), merchantId, linkId, 'Existing service', receipt, randomUUID(), oldTimestamp, oldTimestamp);
    sqlite.prepare("INSERT INTO test_payouts(id,merchant_id,mode,debit_cents,platform_fee_cents,bank_receives_cents,request_id,created_at) VALUES(?,?,'test',1000,28,972,?,?)").run(randomUUID(), merchantId, randomUUID(), oldTimestamp);
  } });
  const lookup = await ctx.req('/api/account');
  assert.equal(lookup.body.registrationRequired, true);
  assert.equal(lookup.body.account.id, merchantId);
  assert.equal(lookup.body.account.businessName, 'Legacy Studio');
  assert.equal((await ctx.req('/api/workspace')).status, 403);
  ctx.as(null);
  assert.equal((await ctx.req(`/api/pay/${token}`)).status, 200);
  assert.equal((await ctx.req(`/api/pay/${token}/receipt?receipt=${receipt}`)).body.payment.status, 'paid');
  ctx.as({ userId: 'owner-A', displayName: 'Owner', email: 'owner@example.test' });
  const registered = await ctx.register({ businessName: 'Legacy Studio' });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.account.id, merchantId);
  assert.equal(registered.body.account.createdAt, oldTimestamp);
  const workspace = (await ctx.req('/api/workspace')).body;
  assert.equal(workspace.links[0].id, linkId);
  assert.equal(workspace.payments[0].platformFeeCents, 280);
  assert.equal(workspace.payouts.length, 1);
  assert.equal(workspace.summary.availableCents, 8720);
  assert.deepEqual(workspace.config.fees, { payment: { percentBps: 250, fixedCents: 30 }, withdrawal: { percentBps: 75, fixedCents: 20 } });
  assert.equal(ctx.sqlite.prepare('SELECT stripe_test_account_id FROM merchants WHERE id=?').get(merchantId).stripe_test_account_id, 'acct_legacyfixture');
});

test('stale account assertions and missing assertions cannot mutate the new signed-in seller', async (t) => {
  const ctx = setup(t);
  const aliceId = (await ctx.req('/api/account')).body.account.id;
  ctx.as({ userId: 'owner-B', displayName: 'Bob', email: 'bob@example.test' });
  const bob = await ctx.register({ displayName: 'Bob', businessName: 'Bob Studio' });
  const bobId = bob.body.account.id;
  const bobLink = await ctx.link();
  await ctx.paid(bobLink);
  const beforeWorkspace = (await ctx.req('/api/workspace')).body;
  const beforeAccount = (await ctx.req('/api/account')).body;
  const operations = [
    ['/api/links', { mode: 'test', title: 'Stale dashboard link', description: '', amountCents: 2500, currency: 'usd' }, 'POST'],
    [`/api/links/${bobLink.id}`, { active: false }, 'PATCH'],
    ['/api/settings', { name: 'Stale dashboard name', fees: { payment: { percentBps: 0, fixedCents: 0 }, withdrawal: { percentBps: 0, fixedCents: 0 } } }, 'POST'],
    ['/api/payouts', { mode: 'test', debitCents: 1000, requestId: randomUUID() }, 'POST'],
    ['/api/account/profile', { displayName: 'Stale owner', businessName: 'Stale business', businessType: 'company', country: 'CA' }, 'POST'],
  ];
  for (const [path, body, method] of operations) {
    const stale = await ctx.req(path, body, { method, headers: { 'X-Harbor-Account-Id': aliceId } });
    assert.equal(stale.status, 409, path);
    assert.equal(stale.body.code, 'account_changed', path);
    const missing = await handleRequest(new Request(`${ORIGIN}${path}`, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx.env, ctx.deps);
    assert.equal(missing.status, 409, path);
    assert.equal((await missing.json()).code, 'account_changed');
  }
  assert.deepEqual((await ctx.req('/api/workspace')).body, beforeWorkspace);
  assert.deepEqual((await ctx.req('/api/account')).body, beforeAccount);
  const allowed = await ctx.req(`/api/links/${bobLink.id}`, { active: false }, { method: 'PATCH', headers: { 'X-Harbor-Account-Id': bobId } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.link.active, false);
  ctx.as({ userId: 'owner-A', displayName: 'Alice', email: 'owner@example.test' });
  const forged = await ctx.req('/api/settings', { fees: beforeWorkspace.config.fees }, { headers: { 'X-Harbor-Account-Id': bobId } });
  assert.equal(forged.status, 409);
  assert.equal(forged.body.code, 'account_changed');
  assert.equal((await ctx.req('/api/workspace')).body.links.length, 0);
});

test('settings business names use the same 100-character boundary as account registration and profile', async (t) => {
  const ctx = setup(t);
  const fees = (await ctx.req('/api/workspace')).body.config.fees;
  const longestName = 'B'.repeat(100);
  assert.equal((await ctx.req('/api/settings', { name: longestName, fees })).status, 200);
  assert.equal((await ctx.req('/api/account')).body.account.businessName, longestName);
  const rejected = await ctx.req('/api/settings', { name: 'B'.repeat(101), fees });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'invalid_request');
  assert.equal((await ctx.req('/api/account')).body.account.businessName, longestName);
});

test('a stale signup identity assertion cannot provision the newly signed-in user', async (t) => {
  const ctx = setup(t, {}, { registered: false });
  const aliceIdentity = (await ctx.req('/api/account')).body.account;
  const body = { displayName: 'Alice', businessName: 'Alice Studio', businessType: 'individual', country: 'US' };
  ctx.as({ userId: 'owner-B', displayName: 'Bob', email: 'bob@example.test' });
  const stale = await ctx.req('/api/account/register', body, { headers: { 'X-Harbor-Account-Email': aliceIdentity.email } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'account_changed');
  const missing = await handleRequest(new Request(`${ORIGIN}/api/account/register`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx.env, ctx.deps);
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).code, 'account_changed');
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) count FROM merchants').get().count, 0);
  assert.equal((await ctx.req('/api/account')).body.registrationRequired, true);
  const fresh = await ctx.req('/api/account/register', { ...body, displayName: 'Bob', businessName: 'Bob Studio' }, { headers: { 'X-Harbor-Account-Email': 'BOB@EXAMPLE.TEST' } });
  assert.equal(fresh.status, 201);
  assert.equal(fresh.body.account.email, 'bob@example.test');
  assert.equal(fresh.body.account.businessName, 'Bob Studio');
  const saved = ctx.sqlite.prepare('SELECT owner_user_id,contact_email FROM merchants').all();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].owner_user_id, 'owner-B');
  assert.equal(saved[0].contact_email, 'bob@example.test');
  ctx.as({ userId: 'owner-A', displayName: 'Alice', email: 'owner@example.test' });
  assert.equal((await ctx.req('/api/account')).body.registrationRequired, true);
});
