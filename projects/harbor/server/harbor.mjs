import { ProviderError, createCheckout, retrieveCheckout, engineFor, requirementsFor, requireProviderReady, validateDestination, verifyStripeSignature, modeCredentials, livePaymentFee } from "./stripe.mjs";

const MAX_CENTS = 100_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
const nowISO = (deps) => new Date(deps.now?.() ?? Date.now()).toISOString();
const unique = () => crypto.randomUUID();
const secretToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((n) => n.toString(16).padStart(2, "0")).join("");
const cents = (value, field = "Amount") => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CENTS) fail(400, "invalid_amount", `${field} must be a whole number of cents between 1 and ${MAX_CENTS}.`);
  return value;
};
const modeValue = (value) => { if (value !== "test" && value !== "live") fail(400, "invalid_mode", "Choose test or live mode."); return value; };
function shape(object, required, optional = []) {
  if (!object || typeof object !== "object" || Array.isArray(object) || required.some((key) => !(key in object)) || Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key))) fail(400, "invalid_request", "The request fields do not match this operation.");
}
function string(value, field, limit, blank = false) {
  if (typeof value !== "string" || value.trim().length > limit || (!blank && !value.trim())) fail(400, "invalid_request", `${field} must be ${blank ? "at most" : "between 1 and"} ${limit} characters.`);
  return value.trim();
}
function requestId(value) { if (typeof value !== "string" || !UUID.test(value)) fail(400, "invalid_request", "Use a UUID requestId for this operation."); return value; }
export function calculateFee(amount, percentBps, fixedCents) { return Number((BigInt(amount) * BigInt(percentBps) + 5000n) / 10000n) + fixedCents; }
function rate(value, name, maxBps) {
  shape(value, ["percentBps", "fixedCents"]);
  if (!Number.isSafeInteger(value.percentBps) || value.percentBps < 0 || value.percentBps > maxBps || !Number.isSafeInteger(value.fixedCents) || value.fixedCents < 0 || value.fixedCents > 10_000) fail(400, "invalid_fee", `${name} fees exceed the supported rate limits.`);
  return value;
}
async function rawBody(request, maxBytes = 8192) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) fail(413, "request_too_large", "The request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_request", "A request body is required.");
  let total = 0; const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); fail(413, "request_too_large", "The request body is too large."); } chunks.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(400, "invalid_request", "The request body must be UTF-8."); }
}
async function payload(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail(415, "json_required", "Send this request as application/json.");
  try { return JSON.parse(await rawBody(request)); } catch (error) { if (error instanceof ApiError) throw error; fail(400, "invalid_json", "The request body is not valid JSON."); }
}
function requireOrigin(request, url) {
  if (request.headers.get("origin") !== url.origin) fail(403, "invalid_origin", "This operation must be requested from the app's own origin.");
}
function statement(db, sql, args = []) { return db.prepare(sql).bind(...args); }
async function first(db, sql, args = []) { return statement(db, sql, args).first(); }
async function all(db, sql, args = []) { return (await statement(db, sql, args).all()).results; }
function authenticatedUser(user) {
  // Only the validated server session can select a merchant. The browser
  // cannot supply an owner or sign-in email to these operations.
  if (typeof user?.userId !== "string" || !user.userId.trim() || typeof user.email !== "string" || !user.email.trim()) fail(401, "auth_missing", "Sign in to Harbor to manage your payment workspace.");
  return user;
}
async function merchantFor(db, user) {
  authenticatedUser(user);
  const merchant = await first(db, "SELECT * FROM merchants WHERE owner_user_id=?", [user.userId]);
  if (!merchant?.onboarding_completed_at) fail(403, "account_setup_required", "Create your Harbor account to manage your payment links and earnings.");
  return merchant;
}
function requireAccountAssertion(request, merchant) {
  // A dashboard retained in another tab must never apply its action to a
  // newly signed-in seller. This is an assertion, not an ownership selector.
  if (request.headers.get("X-Harbor-Account-Id") !== merchant.id) fail(409, "account_changed", "Your signed-in Harbor account changed. Reload the app before making changes.");
}
function requireIdentityAssertion(request, user) {
  const expectedEmail = request.headers.get("X-Harbor-Account-Email");
  if (!expectedEmail || expectedEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) fail(409, "account_changed", "Your signed-in Harbor account changed. Reload the app before making changes.");
}
function accountView(merchant, user) {
  const identityName = typeof user.displayName === "string" ? user.displayName.trim().slice(0, 100) : "";
  return {
    authenticated: true,
    registrationRequired: !merchant?.onboarding_completed_at,
    account: {
      ...(merchant ? { id: merchant.id } : {}),
      displayName: merchant?.account_display_name || identityName,
      email: user.email,
      businessName: merchant?.name || "",
      businessType: merchant?.business_type || null,
      country: merchant?.country || null,
      createdAt: merchant?.created_at || null,
      registeredAt: merchant?.onboarding_completed_at || null,
    },
    authProvider: "email",
    emailVerified: user.emailVerified === true,
    signInUrl: "/login",
    signOutUrl: "/api/auth/logout",
  };
}
function accountFields(body) {
  shape(body, ["displayName", "businessName", "businessType", "country"]);
  const displayName = string(body.displayName, "Your name", 100);
  const businessName = string(body.businessName, "Business name", 100);
  if (body.businessType !== "individual" && body.businessType !== "company") fail(400, "invalid_request", "Choose an individual or company account.");
  const country = string(body.country, "Country", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fail(400, "invalid_request", "Use a two-letter country code.");
  return { displayName, businessName, businessType: body.businessType, country };
}
async function accountRequest(db, user, request, path, method, deps) {
  authenticatedUser(user);
  if (path === "/api/account/register" && method === "POST") requireIdentityAssertion(request, user);
  const merchant = await first(db, "SELECT * FROM merchants WHERE owner_user_id=?", [user.userId]);
  if (path === "/api/account" && method === "GET") return json(accountView(merchant, user));
  if ((path === "/api/account/register" || path === "/api/account/profile") && method === "POST") {
    const fields = accountFields(await payload(request));
    const timestamp = nowISO(deps);
    if (path === "/api/account/register") {
      // Returning an existing account is idempotent and never resets its
      // profile, fees, provider mappings, payment links, or money history.
      if (merchant?.onboarding_completed_at) return json(accountView(merchant, user));
      await statement(db, `INSERT INTO merchants(id,owner_user_id,name,created_at,account_display_name,contact_email,business_type,country,onboarding_completed_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id) DO UPDATE SET name=excluded.name,account_display_name=excluded.account_display_name,contact_email=excluded.contact_email,business_type=excluded.business_type,country=excluded.country,onboarding_completed_at=excluded.onboarding_completed_at,updated_at=excluded.updated_at WHERE merchants.onboarding_completed_at IS NULL`, [unique(), user.userId, fields.businessName, timestamp, fields.displayName, user.email, fields.businessType, fields.country, timestamp, timestamp]).run();
      return json(accountView(await first(db, "SELECT * FROM merchants WHERE owner_user_id=?", [user.userId]), user), 201);
    }
    if (!merchant?.onboarding_completed_at) fail(403, "account_setup_required", "Create your Harbor account before editing your profile.");
    requireAccountAssertion(request, merchant);
    await statement(db, "UPDATE merchants SET name=?,account_display_name=?,contact_email=?,business_type=?,country=?,updated_at=? WHERE id=? AND owner_user_id=? AND onboarding_completed_at IS NOT NULL", [fields.businessName, fields.displayName, user.email, fields.businessType, fields.country, timestamp, merchant.id, user.userId]).run();
    return json(accountView(await first(db, "SELECT * FROM merchants WHERE owner_user_id=?", [user.userId]), user));
  }
  fail(405, "method_not_allowed", "This operation is not supported.");
}
function configFor(env, merchant, mode = "test") {
  const requirements = requirementsFor(env, merchant, "live");
  return { liveFees: { payment: livePaymentFee(env) }, liveFeesControlled: true, feeEditingAllowed: mode === "test", feeScope: mode === "live" ? "platform-live" : "test-preview", fees: { payment: mode === "live" ? livePaymentFee(env) || { percentBps: 0, fixedCents: 0 } : { percentBps: merchant.payment_percent_bps, fixedCents: merchant.payment_fixed_cents }, withdrawal: { percentBps: merchant.withdrawal_percent_bps, fixedCents: merchant.withdrawal_fixed_cents } }, engines: { test: engineFor(env, "test"), live: requirements.length ? "unavailable" : "stripe" }, liveReady: requirements.length === 0, requirements, testRequirements: requirementsFor(env, merchant, "test") };
}
function linkView(row, origin) { return { id: row.id, token: row.token, title: row.title, description: row.description, amountCents: row.amount_cents, currency: row.currency, mode: row.mode, active: row.active === 1, createdAt: row.created_at, url: `${origin}/pay/${row.token}` }; }
function paymentView(row, publicReceipt = false) {
  const customer = { id: row.id, status: row.status, grossCents: row.gross_cents, mode: row.mode, engine: row.engine, createdAt: row.created_at };
  if (publicReceipt) return customer;
  return { ...customer, linkId: row.link_id, linkTitle: row.link_title, platformFeeCents: row.platform_fee_cents, netCents: row.net_cents, processorFeeCents: row.engine === "simulation" ? 0 : null };
}
function payoutView(row) { return { id: row.id, debitCents: row.debit_cents, platformFeeCents: row.platform_fee_cents, bankReceivesCents: row.bank_receives_cents, createdAt: row.created_at, status: row.status }; }
async function publicLink(db, token) {
  if (!/^[0-9a-f]{48}$/.test(token)) fail(404, "link_not_found", "This payment link does not exist.");
  const link = await first(db, "SELECT * FROM payment_links WHERE token=?", [token]);
  if (!link) fail(404, "link_not_found", "This payment link does not exist.");
  return link;
}
async function orderForReceipt(db, linkId, receiptToken) {
  if (typeof receiptToken !== "string" || !/^[0-9a-f]{48}$/.test(receiptToken)) fail(404, "receipt_not_found", "This payment receipt does not exist.");
  const order = await first(db, "SELECT * FROM orders WHERE link_id=? AND receipt_token=?", [linkId, receiptToken]);
  if (!order) fail(404, "receipt_not_found", "This payment receipt does not exist.");
  return order;
}
async function workspace(db, env, merchant, mode, origin) {
  const payments = await all(db, "SELECT * FROM orders WHERE merchant_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 500", [merchant.id, mode]);
  const links = await all(db, "SELECT * FROM payment_links WHERE merchant_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 500", [merchant.id, mode]);
  const payouts = await all(db, "SELECT * FROM test_payouts WHERE merchant_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 500", [merchant.id, mode]);
  const totals = await first(db, "SELECT COALESCE(SUM(gross_cents),0) gross,COALESCE(SUM(platform_fee_cents),0) fees,COALESCE(SUM(CASE WHEN engine='simulation' THEN net_cents ELSE 0 END),0) available,COALESCE(SUM(CASE WHEN engine='stripe' THEN net_cents ELSE 0 END),0) pending FROM orders WHERE merchant_id=? AND mode=? AND status='paid'", [merchant.id, mode]);
  const withdrawals = await first(db, "SELECT COALESCE(SUM(debit_cents),0) debit,COALESCE(SUM(platform_fee_cents),0) fees,COALESCE(SUM(bank_receives_cents),0) paid FROM test_payouts WHERE merchant_id=? AND mode=?", [merchant.id, mode]);
  return { mode, merchant: { id: merchant.id, name: merchant.name }, config: configFor(env, merchant, mode), summary: { grossCents: totals.gross, availableCents: mode === "test" ? totals.available - withdrawals.debit : 0, pendingCents: totals.pending, platformRevenueCents: totals.fees + withdrawals.fees, paidOutCents: withdrawals.paid }, links: links.map((link) => linkView(link, origin)), payments: payments.map((order) => paymentView(order)), payouts: payouts.map(payoutView) };
}
async function checkout(db, env, link, request, url, deps) {
  const body = await payload(request); shape(body, ["requestId"]); requestId(body.requestId);
  if (!link.active) fail(410, "link_inactive", "The seller has deactivated this payment link.");
  const merchant = await first(db, "SELECT * FROM merchants WHERE id=?", [link.merchant_id]);
  const engine = engineFor(env, link.mode);
  if (engine === "stripe") requireProviderReady(env, merchant, link.mode);
  let order = await first(db, "SELECT * FROM orders WHERE link_id=? AND request_id=?", [link.id, body.requestId]);
  if (order && order.engine !== engine) fail(409, "checkout_engine_changed", "Payment setup changed. Start a new checkout request.");
  if (!order) {
    const destination = engine === "stripe" ? await validateDestination(env, merchant, link.mode, deps.fetch) : null;
    const fee = calculateFee(link.amount_cents, link.payment_percent_bps, link.payment_fixed_cents);
    const timestamp = nowISO(deps);
    await statement(db, `INSERT INTO orders(id,merchant_id,link_id,link_title,mode,engine,status,gross_cents,platform_fee_cents,net_cents,currency,receipt_token,request_id,destination_account_id,created_at,updated_at)
      SELECT ?,merchant_id,id,title,mode,?,'created',amount_cents,?,amount_cents-?,currency,?,?,?, ?,? FROM payment_links WHERE id=? AND active=1 ON CONFLICT(link_id,request_id) DO NOTHING`, [unique(), engine, fee, fee, secretToken(), body.requestId, destination, timestamp, timestamp, link.id]).run();
    order = await first(db, "SELECT * FROM orders WHERE link_id=? AND request_id=?", [link.id, body.requestId]);
    if (!order) fail(410, "link_inactive", "The seller has deactivated this payment link.");
  }
  if (engine === "simulation") return json({ engine, orderId: order.id, receiptToken: order.receipt_token, status: order.status }, 201);
  if (!order.session_id) {
    const session = await createCheckout(env, link.mode, order, link, url.origin, deps.fetch);
    await statement(db, "UPDATE orders SET session_id=?,checkout_url=?,updated_at=? WHERE id=? AND session_id IS NULL", [session.sessionId, session.checkoutUrl, nowISO(deps), order.id]).run();
    order = await first(db, "SELECT * FROM orders WHERE id=?", [order.id]);
  } else {
    const session = await retrieveCheckout(env, link.mode, order, deps.fetch, deps.now?.() ?? Date.now());
    if (session.complete) return json({ engine, orderId: order.id, receiptToken: order.receipt_token, status: order.status === "paid" ? "paid" : "pending", checkoutCompleted: true });
  }
  return json({ engine, checkoutUrl: order.checkout_url, orderId: order.id, receiptToken: order.receipt_token }, 201);
}
async function stripeWebhook(db, env, request, mode, deps) {
  const raw = await rawBody(request, 262_144);
  const { webhookSecret } = modeCredentials(env, mode);
  if (!await verifyStripeSignature(raw, request.headers.get("stripe-signature"), webhookSecret, deps.now?.() ?? Date.now())) fail(400, "invalid_signature", "The payment event signature is invalid or expired.");
  let event; try { event = JSON.parse(raw); } catch { fail(400, "invalid_event", "The payment event is invalid."); }
  if (typeof event.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(event.id) || event.livemode !== (mode === "live")) fail(400, "mode_mismatch", "The payment event does not match this endpoint's mode.");
  if (event.account != null) fail(400, "unexpected_account", "This endpoint accepts only platform checkout events for destination charges.");
  const allowed = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"];
  if (!allowed.includes(event.type)) return json({ received: true, ignored: true });
  const session = event.data?.object;
  if (!session || session.object !== "checkout.session" || session.livemode !== (mode === "live")) fail(400, "invalid_event", "The payment event contains an invalid checkout session.");
  const order = await first(db, "SELECT * FROM orders WHERE session_id=? AND mode=? AND engine='stripe'", [session.id, mode]);
  if (!order) fail(409, "order_not_ready", "The checkout session is not attached to a saved payment order yet.");
  if (session.amount_total !== order.gross_cents || session.currency !== order.currency || session.client_reference_id !== order.id || session.metadata?.harbor_payment_id !== order.id || session.metadata?.harbor_link_id !== order.link_id) fail(400, "order_mismatch", "The payment event does not match the saved payment order.");
  let status;
  if (event.type === "checkout.session.async_payment_succeeded") { if (session.payment_status !== "paid") fail(400, "invalid_event", "The success event does not contain a paid checkout session."); status = "paid"; }
  else if (event.type === "checkout.session.async_payment_failed") status = "declined";
  else status = session.payment_status === "paid" ? "paid" : "pending";
  const timestamp = nowISO(deps); const eventRowId = unique();
  // D1 batch is transactional. Each financial order contributes to the ledger once,
  // regardless of distinct/replayed webhook event IDs; no receipt creates availability.
  await db.batch([
    statement(db, "INSERT INTO webhook_events(id,mode,event_id,event_type,session_id,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(event_id,mode) DO NOTHING", [eventRowId, mode, event.id, event.type, session.id, timestamp]),
    statement(db, `UPDATE orders SET status=?,updated_at=? WHERE id=? AND status!='paid' AND (status!='declined' OR ?='paid') AND EXISTS(SELECT 1 FROM webhook_events WHERE id=?)`, [status, timestamp, order.id, status, eventRowId]),
  ]);
  return json({ received: true });
}

/** Request handler is independent of the framework. getUser is trusted server auth. */
export async function handleRequest(request, env, deps = {}) {
  try {
    const url = new URL(request.url); const path = url.pathname.replace(/\/$/, ""); const method = request.method;
    if (!env.DB) fail(503, "storage_unavailable", "The payment workspace needs its server database binding and migrations.");
    const db = env.DB;
    const webhookMatch = /^\/api\/webhooks\/stripe\/(test|live)$/.exec(path);
    if (webhookMatch && method === "POST") return await stripeWebhook(db, env, request, webhookMatch[1], deps);
    if (method === "POST" || method === "PATCH") requireOrigin(request, url);
    if (path === "/api/account" || path === "/api/account/register" || path === "/api/account/profile") return await accountRequest(db, await deps.getUser?.(), request, path, method, deps);
    const payMatch = /^\/api\/pay\/([a-z0-9]+)(?:\/(checkout|simulate|receipt))?$/.exec(path);
    if (payMatch) {
      const link = await publicLink(db, payMatch[1]); const action = payMatch[2];
      if (!action && method === "GET") {
        const merchant = await first(db, "SELECT * FROM merchants WHERE id=?", [link.merchant_id]);
        return json({ link: linkView(link, url.origin), merchantName: merchant.name, engine: engineFor(env, link.mode), liveReady: requirementsFor(env, merchant, "live").length === 0, requirements: requirementsFor(env, merchant, link.mode) });
      }
      if (action === "checkout" && method === "POST") return await checkout(db, env, link, request, url, deps);
      if (action === "receipt" && method === "GET") return json({ payment: paymentView(await orderForReceipt(db, link.id, url.searchParams.get("receipt")), true) });
      if (action === "simulate" && method === "POST") {
        const body = await payload(request); shape(body, ["receiptToken", "outcome"]);
        if (!["paid", "declined"].includes(body.outcome)) fail(400, "invalid_outcome", "Choose a paid or declined simulated outcome.");
        const order = await orderForReceipt(db, link.id, body.receiptToken);
        if (order.mode !== "test" || order.engine !== "simulation") fail(403, "simulation_forbidden", "Only an internal test checkout can be simulated.");
        if (!link.active && order.status === "created") fail(410, "link_inactive", "The seller has deactivated this payment link.");
        await statement(db, "UPDATE orders SET status=?,updated_at=? WHERE id=? AND status='created' AND mode='test' AND engine='simulation'", [body.outcome, nowISO(deps), order.id]).run();
        return json({ payment: paymentView(await first(db, "SELECT * FROM orders WHERE id=?", [order.id]), true), receiptToken: body.receiptToken });
      }
      fail(405, "method_not_allowed", "This operation is not supported.");
    }
    const knownMerchantPath = path === "/api/workspace" || path === "/api/links" || /^\/api\/links\/[^/]+$/.test(path) || path === "/api/settings" || path === "/api/payouts";
    if (!knownMerchantPath) fail(404, "not_found", "This API route does not exist.");
    const merchant = await merchantFor(db, await deps.getUser?.());
    if (method === "POST" || method === "PATCH") requireAccountAssertion(request, merchant);
    if (path === "/api/workspace" && method === "GET") return json(await workspace(db, env, merchant, modeValue(url.searchParams.get("mode") || "test"), url.origin));
    if (path === "/api/links" && method === "POST") {
      const body = await payload(request); shape(body, ["mode", "title", "description", "amountCents", "currency"]);
      const mode = modeValue(body.mode); const title = string(body.title, "Title", 100); const description = string(body.description, "Description", 500, true); const amount = cents(body.amountCents);
      if (body.currency !== "usd") fail(400, "unsupported_currency", "Payment links currently support USD only.");
      if (mode === "live") requireProviderReady(env, merchant, mode);
      const paymentFee = mode === "live" ? livePaymentFee(env) : { percentBps: merchant.payment_percent_bps, fixedCents: merchant.payment_fixed_cents };
      const fee = calculateFee(amount, paymentFee.percentBps, paymentFee.fixedCents);
      if (fee >= amount) fail(400, "fee_exceeds_amount", "The payment amount must exceed its configured platform fee.");
      const id = unique(); await statement(db, "INSERT INTO payment_links(id,merchant_id,token,title,description,amount_cents,currency,mode,payment_percent_bps,payment_fixed_cents,created_at) VALUES(?,?,?,?,?,?,'usd',?,?,?,?)", [id, merchant.id, secretToken(), title, description, amount, mode, paymentFee.percentBps, paymentFee.fixedCents, nowISO(deps)]).run();
      return json({ link: linkView(await first(db, "SELECT * FROM payment_links WHERE id=?", [id]), url.origin) }, 201);
    }
    const linkMatch = /^\/api\/links\/([^/]+)$/.exec(path);
    if (linkMatch && method === "PATCH") {
      const body = await payload(request); shape(body, ["active"]); if (typeof body.active !== "boolean") fail(400, "invalid_request", "active must be true or false.");
      const link = await first(db, "SELECT * FROM payment_links WHERE id=? AND merchant_id=?", [linkMatch[1], merchant.id]); if (!link) fail(404, "link_not_found", "This payment link does not exist in your workspace.");
      await statement(db, "UPDATE payment_links SET active=? WHERE id=? AND merchant_id=?", [Number(body.active), link.id, merchant.id]).run();
      return json({ link: linkView(await first(db, "SELECT * FROM payment_links WHERE id=?", [link.id]), url.origin) });
    }
    if (path === "/api/settings" && method === "POST") {
      const body = await payload(request); shape(body, ["fees"], ["name"]); shape(body.fees, ["payment", "withdrawal"]);
      const payment = rate(body.fees.payment, "Payment", 2000); const withdrawal = rate(body.fees.withdrawal, "Withdrawal", 1000);
      const name = body.name === undefined ? merchant.name : string(body.name, "Business name", 100);
      await statement(db, "UPDATE merchants SET name=?,payment_percent_bps=?,payment_fixed_cents=?,withdrawal_percent_bps=?,withdrawal_fixed_cents=?,updated_at=? WHERE id=?", [name, payment.percentBps, payment.fixedCents, withdrawal.percentBps, withdrawal.fixedCents, nowISO(deps), merchant.id]).run();
      return json({ config: configFor(env, await first(db, "SELECT * FROM merchants WHERE id=?", [merchant.id])) });
    }
    if (path === "/api/payouts" && method === "POST") {
      const body = await payload(request); shape(body, ["mode", "debitCents", "requestId"]); const mode = modeValue(body.mode); const debit = cents(body.debitCents, "Withdrawal"); requestId(body.requestId);
      if (mode !== "test" || engineFor(env, mode) !== "simulation") fail(503, "setup_required", "Bank payouts need verified accounts, settlement reconciliation, and a payment-provider payout integration. Only internal test withdrawals are available.");
      const existing = await first(db, "SELECT * FROM test_payouts WHERE merchant_id=? AND mode=? AND request_id=?", [merchant.id, mode, body.requestId]);
      if (existing) { if (existing.debit_cents !== debit) fail(409, "idempotency_conflict", "This withdrawal requestId was already used with another amount."); return json({ payout: payoutView(existing) }); }
      const fee = calculateFee(debit, merchant.withdrawal_percent_bps, merchant.withdrawal_fixed_cents); if (fee >= debit) fail(400, "fee_exceeds_amount", "The withdrawal amount must exceed its configured platform fee.");
      // Single atomic statement serializes concurrent withdrawals in D1/SQLite.
      await statement(db, `INSERT INTO test_payouts(id,merchant_id,mode,debit_cents,platform_fee_cents,bank_receives_cents,request_id,created_at)
        SELECT ?,?,'test',?,?,?,?,? WHERE ? <=
        (SELECT COALESCE(SUM(net_cents),0) FROM orders WHERE merchant_id=? AND mode='test' AND engine='simulation' AND status='paid')-
        (SELECT COALESCE(SUM(debit_cents),0) FROM test_payouts WHERE merchant_id=? AND mode='test') ON CONFLICT(merchant_id,mode,request_id) DO NOTHING`, [unique(), merchant.id, debit, fee, debit - fee, body.requestId, nowISO(deps), debit, merchant.id, merchant.id]).run();
      const payout = await first(db, "SELECT * FROM test_payouts WHERE merchant_id=? AND mode=? AND request_id=?", [merchant.id, mode, body.requestId]);
      if (!payout) fail(409, "insufficient_balance", "The available test balance is too low for this withdrawal.");
      if (payout.debit_cents !== debit) fail(409, "idempotency_conflict", "This withdrawal requestId was already used with another amount.");
      return json({ payout: payoutView(payout) }, 201);
    }
    fail(405, "method_not_allowed", "This operation is not supported.");
  } catch (error) {
    if (error instanceof ApiError || error instanceof ProviderError) return json({ error: error.message, code: error.code }, error.status);
    // Deliberately do not serialize provider errors, SQL, credentials, or identities.
    return json({ error: "The payment workspace could not complete this operation. Retry, or check the server database setup.", code: "server_error" }, 500);
  }
}
