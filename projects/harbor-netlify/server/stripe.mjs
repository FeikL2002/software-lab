/** Server-only Stripe REST adapter. No credentials or account mappings reach browsers. */
export class ProviderError extends Error {
  constructor(message, code = "provider_unavailable", status = 503) { super(message); this.code = code; this.status = status; }
}
export function modeCredentials(env, mode) {
  const secretKey = mode === "live" ? env.STRIPE_LIVE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY;
  const webhookSecret = mode === "live" ? env.STRIPE_LIVE_WEBHOOK_SECRET : env.STRIPE_TEST_WEBHOOK_SECRET;
  const expected = mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  return { secretKey, webhookSecret, keyValid: typeof secretKey === "string" && expected.test(secretKey) };
}
export function engineFor(env, mode) { return mode === "live" ? "stripe" : env.STRIPE_TEST_SECRET_KEY ? "stripe" : "simulation"; }
export function livePaymentFee(env) {
  const percentBps = Number(env.HARBOR_LIVE_PAYMENT_PERCENT_BPS);
  const fixedCents = Number(env.HARBOR_LIVE_PAYMENT_FIXED_CENTS);
  const valid = typeof env.HARBOR_LIVE_PAYMENT_PERCENT_BPS === "string" && /^\d+$/.test(env.HARBOR_LIVE_PAYMENT_PERCENT_BPS) && typeof env.HARBOR_LIVE_PAYMENT_FIXED_CENTS === "string" && /^\d+$/.test(env.HARBOR_LIVE_PAYMENT_FIXED_CENTS) && Number.isSafeInteger(percentBps) && percentBps >= 0 && percentBps <= 2000 && Number.isSafeInteger(fixedCents) && fixedCents >= 0 && fixedCents <= 10000;
  return valid ? { percentBps, fixedCents } : null;
}
export function requirementsFor(env, merchant, mode) {
  const requirements = [];
  if (mode === "test" && !env.STRIPE_TEST_SECRET_KEY) return requirements;
  const { keyValid, webhookSecret } = modeCredentials(env, mode);
  if (!keyValid) requirements.push(`Configure the server's ${mode} Stripe secret key.`);
  if (typeof webhookSecret !== "string" || !webhookSecret.startsWith("whsec_")) requirements.push(`Configure and register a signed Stripe ${mode} webhook endpoint.`);
  const account = mode === "live" ? merchant.stripe_live_account_id : merchant.stripe_test_account_id;
  if (!account || !/^acct_[A-Za-z0-9]+$/.test(account)) requirements.push(`Complete seller onboarding and link a verified Stripe ${mode} account on the server.`);
  if (mode === "live") {
    if (!livePaymentFee(env)) requirements.push("Configure platform-owned live payment percentage and fixed fees on the server.");
    if (env.HARBOR_LIVE_ENABLED !== "true") requirements.push("Enable live payments on the server after payment-provider approval.");
    if (env.HARBOR_PUBLIC_CHECKOUT_ENABLED !== "true") requirements.push("Configure public checkout access before accepting customers.");
    if (env.HARBOR_LIVE_APPROVED !== "true") requirements.push("Complete the production account, refund, dispute, and payout review before live activation.");
  }
  return requirements;
}
export function requireProviderReady(env, merchant, mode) {
  const requirements = requirementsFor(env, merchant, mode);
  if (requirements.length) throw new ProviderError(requirements.join(" "), "setup_required");
}
async function stripeRequest(env, mode, path, { fetchImpl = fetch, body, idempotencyKey } = {}) {
  const { secretKey, keyValid } = modeCredentials(env, mode);
  if (!keyValid) throw new ProviderError("This payment mode needs a matching server-side Stripe secret key.", "setup_required");
  const headers = { Authorization: `Bearer ${secretKey}` };
  if (env.STRIPE_API_VERSION) headers["Stripe-Version"] = env.STRIPE_API_VERSION;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response;
  try { response = await fetchImpl(`https://api.stripe.com${path}`, { method: body ? "POST" : "GET", headers, body, signal: AbortSignal.timeout(15000) }); }
  catch { throw new ProviderError("The payment provider could not be reached. Retry using the same checkout request."); }
  let data;
  try { data = await response.json(); } catch { throw new ProviderError("The payment provider returned an unreadable response."); }
  if (!response.ok) throw new ProviderError("The payment provider rejected this request. Check server configuration and seller onboarding before retrying.");
  return data;
}
export async function validateDestination(env, merchant, mode, fetchImpl) {
  requireProviderReady(env, merchant, mode);
  const id = mode === "live" ? merchant.stripe_live_account_id : merchant.stripe_test_account_id;
  const account = await stripeRequest(env, mode, `/v1/accounts/${encodeURIComponent(id)}`, { fetchImpl });
  if (account.id !== id || account.charges_enabled !== true || account.capabilities?.transfers !== "active" || account.capabilities?.card_payments !== "active") {
    throw new ProviderError("The seller's linked Stripe account is not ready to receive payments. Complete payment-provider verification.", "setup_required");
  }
  return id;
}
export async function createCheckout(env, mode, order, link, origin, fetchImpl) {
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": order.currency,
    "line_items[0][price_data][product_data][name]": link.title,
    "line_items[0][price_data][unit_amount]": String(order.gross_cents),
    "line_items[0][quantity]": "1",
    "payment_intent_data[application_fee_amount]": String(order.platform_fee_cents),
    "payment_intent_data[transfer_data][destination]": order.destination_account_id,
    "metadata[harbor_payment_id]": order.id,
    "metadata[harbor_link_id]": link.id,
    client_reference_id: order.id,
    success_url: `${origin}/pay/${link.token}?receipt=${order.receipt_token}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pay/${link.token}`,
  });
  const session = await stripeRequest(env, mode, "/v1/checkout/sessions", { body, fetchImpl, idempotencyKey: `harbor-checkout-${order.id}` });
  let checkoutUrl;
  try { checkoutUrl = new URL(session.url); } catch { throw new ProviderError("The payment provider did not return a hosted checkout URL."); }
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id) || checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com" || session.livemode !== (mode === "live")) {
    throw new ProviderError("The payment provider returned an unexpected checkout session.");
  }
  if (session.amount_total !== order.gross_cents || session.currency !== order.currency || session.client_reference_id !== order.id || session.metadata?.harbor_payment_id !== order.id || session.metadata?.harbor_link_id !== link.id) {
    throw new ProviderError("The payment provider session did not match the saved payment order.");
  }
  return { sessionId: session.id, checkoutUrl: session.url };
}
/** Reuse only an open, unexpired session verified against the saved order. */
export async function retrieveCheckout(env, mode, order, fetchImpl, now = Date.now()) {
  const session = await stripeRequest(env, mode, `/v1/checkout/sessions/${encodeURIComponent(order.session_id)}`, { fetchImpl });
  if (session.id !== order.session_id || session.object !== "checkout.session" || session.mode !== "payment" || session.livemode !== (mode === "live") || session.amount_total !== order.gross_cents || session.currency !== order.currency || session.client_reference_id !== order.id || session.metadata?.harbor_payment_id !== order.id || session.metadata?.harbor_link_id !== order.link_id) {
    throw new ProviderError("The retrieved checkout session does not match the saved payment order.");
  }
  if (session.status === "complete") return { complete: true };
  if (session.status === "expired" || (Number.isSafeInteger(session.expires_at) && session.expires_at * 1000 <= now)) throw new ProviderError("This checkout has expired. Start a new checkout attempt to continue.", "checkout_expired", 409);
  if (session.status !== "open" || !Number.isSafeInteger(session.expires_at)) throw new ProviderError("The payment provider returned an unexpected checkout status.");
  let checkoutUrl;
  try { checkoutUrl = new URL(session.url); } catch { throw new ProviderError("The payment provider did not return an active hosted checkout URL."); }
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com" || session.url !== order.checkout_url) throw new ProviderError("The active checkout URL does not match the saved payment order.");
  return { complete: false };
}
export async function verifyStripeSignature(raw, signatureHeader, secret, now = Date.now()) {
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim().split("="));
  const timestamps = parts.filter(([name]) => name === "t").map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0])) return false;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const signatures = parts.filter(([name, value]) => name === "v1" && /^[a-fA-F0-9]{64}$/.test(value || "")).map(([, value]) => value.toLowerCase());
  if (!signatures.length) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${raw}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let accepted = 0;
  for (const supplied of signatures) { let diff = 0; for (let index = 0; index < expected.length; index++) diff |= expected.charCodeAt(index) ^ supplied.charCodeAt(index); accepted |= Number(diff === 0); }
  return accepted === 1;
}
