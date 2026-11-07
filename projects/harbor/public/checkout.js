const root = document.querySelector('#checkout-root');
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const amount = cents => currency.format((Number(cents) || 0) / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const token = /^\/pay\/([a-zA-Z0-9_-]{12,160})\/?$/.exec(location.pathname)?.[1];
const storageKey = `harbor-checkout-attempt:${token}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT = /^[a-f0-9]{48}$/;
let checkout = null;
let attempt = null;
let busy = false;
let receiptPoll = null;
let receiptPollCount = 0;

function icon(name) {
  const paths = { arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', check: '<path d="m5 12 4 4L19 6"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>', cross: '<path d="m6 6 12 12M6 18 18 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' };
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
}

async function api(path, { method = 'GET', body } = {}) {
  let response;
  try { response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new Error('Could not reach Harbor. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('The checkout returned an unexpected response. Please try again.'); }
  if (!response.ok || data.error) {
    const error = new Error((typeof data.error === 'string' ? data.error : data.error?.message) || 'This payment could not be completed. Please try again.');
    error.code = data.code || data.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function saveAttempt() {
  // This stores only a retry key and receipt capability. The server owns payment status and money.
  try { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); } catch { /* Checkout still works without browser retry persistence. */ }
}

function readAttempt() {
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey));
    if (data && UUID.test(data.requestId) && (!data.receiptToken || RECEIPT.test(data.receiptToken)) && ['paid', 'declined'].includes(data.outcome)) return data;
  } catch { /* Ignore malformed browser retry state. */ }
  return null;
}

function clearAttempt() {
  attempt = null;
  try { sessionStorage.removeItem(storageKey); } catch { /* Optional retry state. */ }
  const url = new URL(location.href);
  url.searchParams.delete('receipt');
  url.searchParams.delete('session_id');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function setReceiptURL(receiptToken) {
  if (!RECEIPT.test(receiptToken)) return;
  const url = new URL(location.href);
  url.searchParams.set('receipt', receiptToken);
  url.searchParams.delete('session_id');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function frame(body) {
  const link = checkout?.link;
  const mode = link?.mode || 'test';
  const test = mode === 'test';
  document.body.dataset.mode = mode;
  document.title = link ? `${link.title} — Harbor checkout` : 'Harbor checkout';
  const merchantName = checkout?.merchantName || 'Merchant checkout';
  root.innerHTML = `<div class="checkout-page"><header class="checkout-header"><a class="checkout-brand" href="/" aria-label="Harbor"><span class="checkout-brand-mark">h</span>harbor<span>.</span></a><span class="checkout-environment ${test ? 'is-test' : 'is-live'}"><i></i>${test ? 'TEST CHECKOUT' : 'LIVE CHECKOUT'}</span></header><main class="checkout-shell"><section class="order-summary"><div class="merchant-chip"><span class="merchant-avatar">${esc(merchantName.slice(0, 1).toUpperCase())}</span><span>Pay <strong>${esc(merchantName)}</strong></span></div><div class="product-visual">${icon('link')}<span>Payment link</span><div class="product-spark spark-one"></div><div class="product-spark spark-two"></div></div><div class="order-eyebrow">${test ? 'TEST ORDER' : 'YOUR ORDER'}</div><h1>${esc(link?.title || 'Customer checkout')}</h1>${link?.description ? `<p class="product-description">${esc(link.description)}</p>` : ''}<div class="order-amount">${link ? amount(link.amountCents) : '—'}<span>USD</span></div><div class="order-total"><span>Total due</span><strong>${link ? amount(link.amountCents) : '—'}</strong></div><p class="order-footnote">${test ? 'Test checkout uses fictional money. No card or bank account is charged.' : 'This payment is processed by the merchant’s connected payment provider.'}</p></section><section class="payment-area">${body}</section></main><footer class="checkout-footer"><span>Powered by <strong>harbor.</strong></span><span>${test ? 'Test environment · No real money moves' : 'Payments through Stripe Checkout'}</span></footer></div>`;
}

function renderCheckout() {
  if (!checkout?.link) return;
  const link = checkout.link;
  const test = link.mode === 'test';
  if (!link.active) {
    frame(`<div class="checkout-state"><span class="state-icon muted-icon">${icon('lock')}</span><h2>This payment link is closed</h2><p>The merchant has deactivated this link. Contact them for a new payment link.</p></div>`);
    return;
  }
  if ((!test && !checkout.liveReady) || (checkout.engine === 'stripe' && checkout.requirements?.length)) {
    frame(`<div class="checkout-state"><span class="state-icon pending-icon">${icon('clock')}</span><span class="payment-badge pending">Setup required</span><h2>${test ? 'Test payments are being connected' : 'Live payments are not available yet'}</h2><p>This business needs to finish connecting its ${test ? 'test' : 'live'} payment provider before this checkout can accept a payment. Please contact the seller.</p><button type="button" class="checkout-button secondary" id="reload-checkout">Check again</button></div>`);
    document.querySelector('#reload-checkout')?.addEventListener('click', load);
    return;
  }
  if (!['simulation', 'stripe'].includes(checkout.engine) || (!test && checkout.engine !== 'stripe')) {
    renderFatal('Checkout unavailable', 'This payment provider is not configured for the selected mode. Please contact the merchant.');
    return;
  }
  const simulation = checkout.engine === 'simulation';
  const selectedOutcome = attempt?.outcome || 'paid';
  frame(`<form class="checkout-form" id="checkout-form"><div class="payment-form-heading"><span class="payment-badge ${test ? 'test' : 'live'}">${test ? (simulation ? 'Test simulation' : 'Stripe test mode') : 'Secure payment'}</span><h2>${simulation ? 'Try the payment flow' : 'Complete your payment'}</h2><p>${simulation ? 'Choose a test result. The merchant will see this attempt in their Harbor test workspace.' : `Continue to Stripe’s hosted checkout to pay ${esc(checkout.merchantName)}.`}</p></div>${simulation ? `<fieldset class="test-outcomes"><legend>Test payment outcome</legend><label class="outcome-option"><input type="radio" name="outcome" value="paid" ${selectedOutcome === 'paid' ? 'checked' : ''}><span class="outcome-icon">${icon('check')}</span><span><strong>Successful payment</strong><small>Add test earnings to the merchant’s dashboard.</small></span><span class="outcome-dot"></span></label><label class="outcome-option"><input type="radio" name="outcome" value="declined" ${selectedOutcome === 'declined' ? 'checked' : ''}><span class="outcome-icon">${icon('cross')}</span><span><strong>Declined payment</strong><small>Record a failed attempt. No earnings are added.</small></span><span class="outcome-dot"></span></label></fieldset><div class="test-disclosure">${icon('shield')}<span>No payment information needed. This simulation does not charge a card or transfer money.</span></div>` : `<div class="provider-checkout-card"><span class="provider-logo">stripe</span><div><strong>${test ? 'Stripe test checkout' : 'Stripe Checkout'}</strong><p>${test ? 'Use Stripe test payment information on the next screen. No real charge is made.' : 'Enter your payment information on Stripe’s secure checkout.'}</p></div>${icon('lock')}</div>`}<div class="payment-error" id="checkout-error" role="alert" hidden></div><button class="checkout-button" id="pay-button" type="submit">${simulation ? `Pay ${amount(link.amountCents)} in test mode` : `${test ? 'Continue to test checkout' : `Pay ${amount(link.amountCents)}`}`} ${icon('arrow')}</button><p class="checkout-button-note">${simulation ? 'Saved as a test payment in Harbor.' : `You’ll continue to checkout.stripe.com${test ? ' in test mode' : ''}.`}</p><div class="checkout-security">${icon('lock')}<span>${simulation ? 'Server recorded test activity' : 'Hosted payment processing by Stripe'}</span></div></form>`);
  document.querySelector('#checkout-form').addEventListener('submit', pay);
}

function renderFatal(title, message) {
  frame(`<div class="checkout-state"><span class="state-icon muted-icon">${icon('link')}</span><h2>${esc(title)}</h2><p>${esc(message)}</p><button class="checkout-button secondary" type="button" id="reload-checkout">Try again</button></div>`);
  document.querySelector('#reload-checkout')?.addEventListener('click', load);
}

function renderReceipt(payment, receiptToken) {
  clearTimeout(receiptPoll);
  if (!payment || !['paid', 'declined', 'pending', 'created'].includes(payment.status)) { renderFatal('Receipt unavailable', 'The server could not confirm this payment receipt.'); return; }
  if (payment.mode && payment.mode !== checkout.link.mode) { renderFatal('Receipt unavailable', 'This receipt does not match the checkout mode.'); return; }
  if (payment.grossCents !== checkout.link.amountCents) { renderFatal('Receipt unavailable', 'This receipt does not match the checkout amount.'); return; }
  const test = checkout.link.mode === 'test';
  const simulated = payment.engine === 'simulation';
  const paid = payment.status === 'paid';
  const declined = payment.status === 'declined';
  const title = paid ? (test ? 'Test payment complete' : 'Payment complete') : declined ? (test ? 'Test payment declined' : 'Payment declined') : 'Confirming your payment';
  const description = paid ? (simulated ? 'Recorded in the merchant’s test dashboard. No money moved.' : test ? 'This verified Stripe test payment was recorded in the merchant’s test dashboard. No real money moved.' : 'Your payment has been verified by the payment provider and recorded for the merchant.') : declined ? (test ? 'This declined test attempt was recorded. No earnings were added and no money moved.' : 'The payment provider declined this attempt. No earnings were added for the merchant.') : 'We are waiting for the payment provider to confirm the result. Closing this page does not create or cancel a charge.';
  frame(`<div class="checkout-state receipt-state" role="status" aria-live="polite"><span class="state-icon ${paid ? 'success-icon' : declined ? 'declined-icon' : 'pending-icon'}">${icon(paid ? 'check' : declined ? 'cross' : 'clock')}</span><span class="payment-badge ${paid ? 'test' : declined ? 'declined' : 'pending'}">${test ? 'TEST MODE' : 'LIVE MODE'}</span><h2>${title}</h2><p>${description}</p><div class="receipt-card"><div><span>${paid ? 'Paid to' : 'Merchant'}</span><strong>${esc(checkout.merchantName)}</strong></div><div><span>${paid ? 'Amount' : 'Order total'}</span><strong>${amount(payment.grossCents)}</strong></div><div><span>Status</span><strong>${paid ? 'Paid' : declined ? 'Declined' : 'Awaiting verification'}</strong></div><div class="receipt-id"><span>Receipt</span><strong>${esc(payment.id)}</strong></div></div>${paid && test ? '<button type="button" class="checkout-button secondary" id="new-test-payment">Make another test payment</button>' : declined ? `<button type="button" class="checkout-button" id="retry-payment">${test ? 'Try another test payment' : 'Try again'}</button>` : !paid ? '<button type="button" class="checkout-button secondary" id="refresh-receipt">Check payment status</button>' : ''}<p class="receipt-footnote">${test ? 'Keep this receipt for your testing.' : 'Keep this receipt for your records.'}</p><div id="receipt-error" class="payment-error" role="alert" hidden></div></div>`);
  setReceiptURL(receiptToken);
  const startNew = () => { clearTimeout(receiptPoll); clearAttempt(); renderCheckout(); };
  document.querySelector('#new-test-payment')?.addEventListener('click', startNew);
  document.querySelector('#retry-payment')?.addEventListener('click', startNew);
  document.querySelector('#refresh-receipt')?.addEventListener('click', () => refreshReceipt(receiptToken));
  if (!paid && !declined && payment.engine === 'stripe' && receiptPollCount < 12) {
    receiptPoll = setTimeout(() => { if (document.visibilityState === 'visible') { receiptPollCount++; refreshReceipt(receiptToken); } }, 5000);
  }
}

async function refreshReceipt(receiptToken) {
  if (busy) return;
  const button = document.querySelector('#refresh-receipt');
  if (button) { button.disabled = true; button.textContent = 'Checking…'; }
  try {
    busy = true;
    const { payment } = await api(`/api/pay/${encodeURIComponent(token)}/receipt?receipt=${encodeURIComponent(receiptToken)}`);
    renderReceipt(payment, receiptToken);
  } catch (error) {
    clearTimeout(receiptPoll);
    const node = document.querySelector('#receipt-error');
    if (node) { node.textContent = error.message; node.hidden = false; }
  } finally { busy = false; if (button) { button.disabled = false; button.textContent = 'Check payment status'; } }
}

async function pay(event) {
  event.preventDefault();
  if (busy) return;
  const form = event.currentTarget;
  const button = document.querySelector('#pay-button');
  const errorNode = document.querySelector('#checkout-error');
  const initialText = button.innerHTML;
  errorNode.hidden = true;
  if (!attempt) {
    attempt = { requestId: crypto.randomUUID(), outcome: form.elements.outcome?.value === 'declined' ? 'declined' : 'paid' };
    saveAttempt();
  }
  busy = true;
  button.disabled = true;
  button.textContent = 'Processing…';
  form.querySelectorAll('input').forEach(input => { input.disabled = true; });
  try {
    const order = await api(`/api/pay/${encodeURIComponent(token)}/checkout`, { method: 'POST', body: { requestId: attempt.requestId } });
    if (!RECEIPT.test(order.receiptToken)) throw new Error('The server did not return a valid payment receipt.');
    attempt = { ...attempt, receiptToken: order.receiptToken, orderId: order.orderId, engine: order.engine };
    saveAttempt();
    if (order.engine === 'stripe') {
      if (order.checkoutCompleted === true) {
        const { payment } = await api(`/api/pay/${encodeURIComponent(token)}/receipt?receipt=${encodeURIComponent(order.receiptToken)}`);
        renderReceipt(payment, order.receiptToken);
        return;
      }
      const destination = new URL(order.checkoutUrl);
      if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' || destination.username || destination.password || destination.port) throw new Error('The payment provider returned an unexpected checkout address. Please contact the merchant.');
      location.assign(destination.href);
      return;
    }
    if (checkout.link.mode !== 'test' || order.engine !== 'simulation') throw new Error('This payment mode cannot use the test simulation.');
    const { payment, receiptToken } = await api(`/api/pay/${encodeURIComponent(token)}/simulate`, { method: 'POST', body: { receiptToken: attempt.receiptToken, outcome: attempt.outcome } });
    renderReceipt(payment, receiptToken || attempt.receiptToken);
  } catch (error) {
    if (error.code === 'checkout_expired') {
      errorNode.innerHTML = `${esc(error.message)}<button class="checkout-button secondary" type="button" id="start-new-checkout">Start a new checkout</button>`;
      document.querySelector('#start-new-checkout').addEventListener('click', () => { clearAttempt(); renderCheckout(); });
      button.disabled = true;
    } else {
      errorNode.textContent = error.message;
      button.disabled = false;
    }
    errorNode.hidden = false;
    button.innerHTML = initialText;
    form.querySelectorAll('input').forEach(input => { input.disabled = false; });
    // An unknown network result keeps the same request key. Retrying cannot create a second order.
  } finally { busy = false; }
}

async function load() {
  if (busy) return;
  clearTimeout(receiptPoll);
  receiptPollCount = 0;
  root.innerHTML = '<div class="checkout-loading" role="status"><span class="loading-orbit"></span><h1>Opening your checkout…</h1><p>Fetching this payment link from Harbor.</p></div>';
  if (!token) { renderFatal('Payment link not found', 'The address does not contain a valid payment link.'); return; }
  try {
    const data = await api(`/api/pay/${encodeURIComponent(token)}`);
    if (!data.link || !['test', 'live'].includes(data.link.mode) || !Number.isSafeInteger(data.link.amountCents) || data.link.amountCents < 1) throw new Error('This payment link is incomplete. Please contact the merchant.');
    checkout = data;
    attempt = readAttempt();
    const fromURL = new URL(location.href).searchParams.get('receipt');
    const receiptToken = RECEIPT.test(fromURL || '') ? fromURL : attempt?.receiptToken;
    if (receiptToken) {
      try {
        const { payment } = await api(`/api/pay/${encodeURIComponent(token)}/receipt?receipt=${encodeURIComponent(receiptToken)}`);
        if (payment.status !== 'created' || fromURL) { renderReceipt(payment, receiptToken); return; }
        // An unfinished simulation can resume the same attempt after a reload.
      } catch (error) {
        if (fromURL) { renderFatal('Receipt could not be verified', error.message); return; }
        if (error.status !== 404) { renderFatal('Payment status unavailable', error.message); return; }
        clearAttempt();
      }
    }
    renderCheckout();
  } catch (error) { renderFatal('Checkout could not load', error.message); }
}

window.addEventListener('pagehide', () => clearTimeout(receiptPoll));
if (root) load();
