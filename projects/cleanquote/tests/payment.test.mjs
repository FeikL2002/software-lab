import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, verifySignature, STRIPE_API_VERSION } from '../server.mjs';

const id = 'cs_test_abcdefghijklmnopqrstuvwxyz';
const epoch = 1_800_000_000_000;
const secret = 'whsec_exampleNotARealCredential';
const paid = () => ({ id, mode: 'payment', status: 'complete', metadata: { product: 'cleanquote-v1' }, currency: 'usd', amount_total: 2900, payment_status: 'paid',
  line_items: { has_more: false, data: [{ price: { id: 'price_example' }, quantity: 1, amount_total: 2900 }] },
  payment_intent: { status: 'succeeded', currency: 'usd', amount_received: 2900, latest_charge: { paid: true, refunded: false, amount_refunded: 0, disputed: false } } });
function signature(raw, timestamp = epoch / 1000) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(timestamp + '.').update(raw).digest('hex')}`;
}
async function fixture(t, session = paid(), overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cleanquote-payment-'));
  const zipPath = join(directory, 'customer.zip');
  const distDir = join(directory, 'dist');
  await mkdir(distDir);
  await writeFile(zipPath, 'private customer ZIP fixture');
  await writeFile(join(distDir, 'index.html'), '<h1>Preview</h1>');
  const calls = [];
  const config = { salesEnabled: true, policyReady: true, origin: 'https://cleanquote.example', supportEmail: 'support@example.com',
    key: 'rk_test_example', priceId: 'price_example', webhookSecret: secret, zipPath, distDir, dataDir: join(directory, '.data'), ...overrides };
  const server = createApp({ config, now: () => epoch, fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => options.method === 'POST' ? { url: 'https://checkout.stripe.com/c/pay/example' } : session };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { config, calls, origin: `http://127.0.0.1:${server.address().port}` };
}

test('signature requires original raw bytes, a current timestamp and v1 signature', () => {
  const raw = Buffer.from('{"hello":"world"}');
  assert.equal(verifySignature(raw, signature(raw), secret, epoch), true);
  assert.equal(verifySignature(Buffer.from('{ "hello":"world" }'), signature(raw), secret, epoch), false);
  assert.equal(verifySignature(raw, signature(raw, epoch / 1000 - 301), secret, epoch), false);
  assert.equal(verifySignature(raw, signature(raw).replace('v1=', 'v0='), secret, epoch), false);
});

test('unconfigured server advertises checkout disabled and rejects purchases/downloads', async t => {
  const f = await fixture(t, paid(), { salesEnabled: false });
  assert.equal((await (await fetch(f.origin + '/api/status')).json()).ready, false);
  assert.equal((await fetch(f.origin + '/api/checkout', { method: 'POST' })).status, 503);
  assert.equal((await fetch(f.origin + '/api/download?session_id=' + id)).status, 503);
  assert.equal(f.calls.length, 0);
});

test('checkout uses fixed price, quantity and canonical callbacks; rejects CSRF and client redirects', async t => {
  const f = await fixture(t);
  const request = { method: 'POST', headers: { Origin: f.config.origin } };
  assert.equal((await fetch(f.origin + '/api/checkout', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(f.origin + '/api/checkout', { ...request, body: JSON.stringify({ price: 1, return_url: 'https://attacker.example' }) })).status, 400);
  assert.equal((await fetch(f.origin + '/api/checkout', request)).status, 200);
  const params = new URLSearchParams(f.calls[0].options.body);
  assert.equal(params.get('line_items[0][price]'), 'price_example');
  assert.equal(params.get('line_items[0][quantity]'), '1');
  assert.equal(params.get('success_url'), 'https://cleanquote.example/success.html?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(params.has('payment_method_types'), false);
  assert.match(params.get('integration_identifier'), /^cleanquote_[a-z]{8}$/);
  assert.equal(f.calls[0].options.headers['Stripe-Version'], STRIPE_API_VERSION);
});

test('paid server-verified session creates an order and delivers the private ZIP', async t => {
  const f = await fixture(t);
  const response = await fetch(f.origin + '/api/fulfillment?session_id=' + id);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ready, true);
  const download = await fetch(f.origin + result.downloadUrl);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'private customer ZIP fixture');
  const record = JSON.parse(await readFile(join(f.config.dataDir, 'orders', id + '.json')));
  assert.equal(record.status, 'paid');
  assert.equal((await fetch(f.origin + '/release/cleanquote-customer.zip')).status, 404);
  assert.equal((await fetch(f.origin + '/.data/orders/' + id + '.json')).status, 404);
});

test('unpaid, wrong amount, wrong price and refunded payments never deliver downloads', async t => {
  for (const mutation of [s => { s.payment_status = 'unpaid'; }, s => { s.amount_total = 1; },
    s => { s.line_items.data[0].price.id = 'price_other'; }, s => { s.payment_intent.latest_charge.refunded = true; }]) {
    const session = paid(); mutation(session);
    const f = await fixture(t, session);
    const response = await fetch(f.origin + '/api/download?session_id=' + id);
    assert.ok([403, 409].includes(response.status));
    assert.equal((await response.json()).error.includes('ZIP'), false);
  }
});

test('webhook rejects forged signatures; paid event is durable and idempotent', async t => {
  const f = await fixture(t);
  const raw = JSON.stringify({ id: 'evt_testOne', type: 'checkout.session.completed', data: { object: { id } } });
  const request = { method: 'POST', body: raw, headers: { 'Stripe-Signature': signature(raw) } };
  assert.equal((await fetch(f.origin + '/api/webhook', { ...request, headers: {} })).status, 400);
  assert.equal((await fetch(f.origin + '/api/webhook', request)).status, 200);
  assert.equal((await fetch(f.origin + '/api/webhook', request)).status, 200);
  assert.equal(f.calls.length, 1);
});

test('async failure never fulfills, and pending completion waits for later paid reconciliation', async t => {
  const session = paid(); session.payment_status = 'unpaid';
  const f = await fixture(t, session);
  for (const [eventId, type] of [['evt_pending', 'checkout.session.completed'], ['evt_failed', 'checkout.session.async_payment_failed']]) {
    const raw = JSON.stringify({ id: eventId, type, data: { object: { id } } });
    assert.equal((await fetch(f.origin + '/api/webhook', { method: 'POST', body: raw, headers: { 'Stripe-Signature': signature(raw) } })).status, 200);
  }
  assert.equal((await fetch(f.origin + '/api/fulfillment?session_id=' + id)).status, 409);
  session.payment_status = 'paid';
  assert.equal((await fetch(f.origin + '/api/fulfillment?session_id=' + id)).status, 200);
});
