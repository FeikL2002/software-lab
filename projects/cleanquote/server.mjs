import http from 'node:http';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STRIPE_API_VERSION = '2026-09-30.endive';
export const PRODUCT_AMOUNT = 2900;
const ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9]{16,200}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const fail = (status, message) => Object.assign(new Error(message), { status });

export function configuration(env = process.env) {
  let origin = '';
  try {
    const u = new URL(env.PUBLIC_ORIGIN || '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if ((u.protocol === 'https:' || (u.protocol === 'http:' && local)) && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/') origin = u.origin;
  } catch {}
  return {
    origin, key: env.STRIPE_RESTRICTED_KEY || '', priceId: env.STRIPE_PRICE_ID || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '', supportEmail: env.SUPPORT_EMAIL || '',
    salesEnabled: env.SALES_ENABLED === 'true', policyReady: env.SALES_POLICY_READY === 'true',
    distDir: resolve(ROOT, 'dist'), dataDir: resolve(ROOT, '.data'),
    zipPath: resolve(ROOT, 'release/cleanquote-customer.zip'),
  };
}

export function isReady(config) {
  return Boolean(config.salesEnabled && config.policyReady && config.origin &&
    /^rk_(?:test|live)_[A-Za-z0-9_]+$/.test(config.key) && /^price_[A-Za-z0-9]+$/.test(config.priceId) &&
    config.webhookSecret.startsWith('whsec_') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail) && existsSync(config.zipPath));
}

export function verifySignature(raw, header, secret, now = Date.now()) {
  if (typeof header !== 'string' || !secret) return false;
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  return parts.filter(([key]) => key === 'v1').some(([, signature]) => {
    if (!/^[a-f0-9]{64}$/i.test(signature || '')) return false;
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  });
}

async function body(req, max = 524_288) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(413, 'Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createApp(options = {}) {
  const config = { ...configuration(), ...(options.config || {}) };
  const fetchStripe = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const integration = 'cleanquote_' + [...randomBytes(8)].map(n => String.fromCharCode(97 + n % 26)).join('');

  async function stripe(path, params) {
    const response = await fetchStripe('https://api.stripe.com/v1/' + path, {
      method: params ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + config.key, 'Stripe-Version': STRIPE_API_VERSION, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(params ? { body: params.toString() } : {}), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw fail(502, 'Payment provider is temporarily unavailable. Please try again.');
    return response.json();
  }

  async function persist(kind, id, value) {
    const folder = resolve(config.dataDir, kind);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const target = resolve(folder, id + '.json');
    const temporary = target + '.' + randomBytes(8).toString('hex') + '.tmp';
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, target);
  }

  async function paidSession(id) {
    if (!SESSION_ID.test(id || '')) throw fail(400, 'A valid checkout reference is required.');
    const session = await stripe('checkout/sessions/' + encodeURIComponent(id) + '?expand%5B%5D=line_items&expand%5B%5D=payment_intent.latest_charge');
    const item = session.line_items?.data?.[0];
    if (session.id !== id || session.mode !== 'payment' || session.metadata?.product !== 'cleanquote-v1' ||
        session.currency !== 'usd' || session.amount_total !== PRODUCT_AMOUNT ||
        session.line_items?.data?.length !== 1 || session.line_items?.has_more ||
        item?.price?.id !== config.priceId || item?.quantity !== 1 || item?.amount_total !== PRODUCT_AMOUNT) {
      throw fail(403, 'This payment does not match the CleanQuote purchase.');
    }
    if (session.payment_status !== 'paid' || session.status !== 'complete') throw fail(409, 'Payment is still pending. Return here after your payment clears.');
    const intent = session.payment_intent;
    const charge = intent?.latest_charge;
    if (typeof intent !== 'object' || intent.status !== 'succeeded' || intent.currency !== 'usd' || intent.amount_received !== PRODUCT_AMOUNT ||
        typeof charge !== 'object' || !charge || charge.refunded || charge.amount_refunded > 0 || charge.disputed || charge.paid !== true) {
      throw fail(403, 'This payment cannot currently be fulfilled. Contact support with your order reference.');
    }
    const order = { sessionId: id, status: 'paid', amount: PRODUCT_AMOUNT, currency: 'usd', verifiedAt: new Date(now()).toISOString() };
    await persist('orders', id, order);
    return order;
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { ready: isReady(config), amount: PRODUCT_AMOUNT, currency: 'usd' });
      if (url.pathname.startsWith('/api/')) {
        if (!isReady(config)) throw fail(503, 'Purchases are not enabled. This preview does not accept payment.');
        if (req.method === 'POST' && url.pathname === '/api/checkout') {
          if (req.headers.origin !== config.origin) throw fail(403, 'Checkout must start from the sales website.');
          const raw = await body(req, 8192);
          if (raw.length) {
            let input;
            try { input = JSON.parse(raw); } catch { throw fail(400, 'Invalid checkout request.'); }
            if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw fail(400, 'Checkout does not accept client prices or redirects.');
          }
          const params = new URLSearchParams({ mode: 'payment', 'line_items[0][price]': config.priceId, 'line_items[0][quantity]': '1',
            success_url: config.origin + '/success.html?session_id={CHECKOUT_SESSION_ID}', cancel_url: config.origin + '/?checkout=canceled#pricing',
            'metadata[product]': 'cleanquote-v1', integration_identifier: integration });
          const session = await stripe('checkout/sessions', params);
          if (!session.url?.startsWith('https://checkout.stripe.com/')) throw fail(502, 'Payment provider returned an invalid checkout URL.');
          return json(res, 200, { url: session.url });
        }
        if (req.method === 'POST' && url.pathname === '/api/webhook') {
          const raw = await body(req);
          if (!verifySignature(raw, req.headers['stripe-signature'], config.webhookSecret, now())) throw fail(400, 'Invalid webhook signature.');
          let event;
          try { event = JSON.parse(raw); } catch { throw fail(400, 'Invalid webhook JSON.'); }
          if (!/^evt_[A-Za-z0-9]{1,200}$/.test(event.id || '')) throw fail(400, 'Invalid event reference.');
          if (existsSync(resolve(config.dataDir, 'events', event.id + '.json'))) return json(res, 200, { received: true });
          const supported = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
          if (supported.includes(event.type)) {
            const id = event.data?.object?.id;
            if (!SESSION_ID.test(id || '')) throw fail(400, 'Invalid checkout reference.');
            if (event.type !== 'checkout.session.async_payment_failed') {
              try { await paidSession(id); }
              catch (error) { if (error.status !== 409) throw error; }
            }
            await persist('events', event.id, { type: event.type, sessionId: id, receivedAt: new Date(now()).toISOString() });
          }
          return json(res, 200, { received: true });
        }
        if (req.method === 'GET' && ['/api/fulfillment', '/api/download'].includes(url.pathname)) {
          const id = url.searchParams.get('session_id');
          await paidSession(id);
          if (url.pathname === '/api/fulfillment') return json(res, 200, { ready: true, downloadUrl: '/api/download?session_id=' + encodeURIComponent(id) });
          const info = await stat(config.zipPath);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="cleanquote-customer.zip"', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
          return createReadStream(config.zipPath).pipe(res);
        }
        throw fail(404, 'API route not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method not allowed.');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw fail(400, 'Invalid path.'); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p => p.startsWith('.'))) throw fail(404, 'Not found.');
      const target = resolve(config.distDir, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(resolve(config.distDir) + sep)) throw fail(404, 'Not found.');
      let data;
      try { data = await readFile(target); } catch { throw fail(404, 'Not found.'); }
      res.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3211);
  createApp().listen(port, host, () => console.log(`CleanQuote server at http://${host}:${port}; checkout ${isReady(configuration()) ? 'configured' : 'disabled'}.`));
}
