import { parseDollars } from './money.mjs';

const $ = selector => document.querySelector(selector);
const content = $('#view-content');
const dialog = $('#dialog');
const dialogContent = $('#dialog-content');
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const amount = cents => currency.format((Number(cents) || 0) / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateText = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '—'; };
const dollars = cents => ((Number(cents) || 0) / 100).toFixed(2);
const percent = bps => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const rateText = rate => `${percent(rate.percentBps)}${rate.fixedCents ? ` + ${amount(rate.fixedCents)}` : ''}`;
const feeCents = (cents, rate) => Number((BigInt(cents) * BigInt(rate.percentBps) + 5000n) / 10000n) + rate.fixedCents;
const allowedRoutes = ['overview', 'links', 'payments', 'payouts', 'account', 'settings'];
let route = allowedRoutes.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let mode = 'test';
try { if (localStorage.getItem('harbor-workspace-mode') === 'live') mode = 'live'; } catch { /* A browser preference is optional. */ }
let workspace = null;
let accountProfile = null;
let query = '';
let paymentFilter = 'all';
let loadEpoch = 0;
let loading = false;
let backgroundStopped = false;
let dialogBusy = false;
let toastTimer;
let settingsDirty = false;
let profileDirty = false;
let profileSaving = false;
let sessionCheck = null;

function icon(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    wallet: '<path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v9H6a3 3 0 0 1-3-3V7"/><path d="M20 13h-5v4h5"/>',
    bank: '<path d="m3 9 9-6 9 6H3ZM5 10v9m7-9v9m7-9v9M3 21h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  };
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
}

async function api(path, { method = 'GET', body } = {}) {
  const expectedAccountId = accountProfile?.id;
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method !== 'GET' && expectedAccountId ? { 'X-Harbor-Account-Id': expectedAccountId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    const error = new Error('Could not reach Harbor. Check your connection and try again.');
    error.code = 'network_error';
    throw error;
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('Harbor returned an unexpected response. Please refresh and try again.'); }
  if (!response.ok || data.error) {
    const error = new Error((typeof data.error === 'string' ? data.error : data.error?.message) || 'This action could not be completed. Please try again.');
    error.code = data.code || data.error?.code;
    error.status = response.status;
    handleAccountAccessError(error);
    throw error;
  }
  if (expectedAccountId && accountProfile?.id !== expectedAccountId) {
    const error = new Error('Your signed-in account changed. Sign in again to open the correct workspace.');
    error.code = 'account_changed';
    handleAccountAccessError(error);
    throw error;
  }
  return data;
}

function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4200);
}

function setMenu(open) {
  $('#sidebar')?.classList.toggle('open', open);
  document.body.classList.toggle('menu-open', open);
  $('#mobile-menu-toggle')?.setAttribute('aria-expanded', String(open));
  $('#mobile-menu-toggle')?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}

function safeLinkURL(link) {
  const token = String(link.token || '');
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(token)) throw new Error('This payment link has an invalid address.');
  return `${location.origin}/pay/${encodeURIComponent(token)}`;
}

function engineText() {
  if (!workspace) return mode === 'test' ? 'Test workspace' : 'Live workspace';
  return mode === 'test' ? (workspace.config.engines.test === 'stripe' ? 'Stripe test payments' : 'Test payment simulation') : (workspace.config.liveReady ? 'Live payments enabled' : 'Payments not connected');
}

function updateShell() {
  document.body.dataset.mode = mode;
  $('#mode-test')?.setAttribute('aria-pressed', String(mode === 'test'));
  $('#mode-live')?.setAttribute('aria-pressed', String(mode === 'live'));
  $('#mode-test')?.classList.toggle('active', mode === 'test');
  $('#mode-live')?.classList.toggle('active', mode === 'live');
  if ($('#mode-label')) $('#mode-label').textContent = mode === 'test' ? 'TEST MODE' : 'LIVE MODE';
  if ($('#mode-detail')) $('#mode-detail').textContent = mode === 'test' ? `${engineText()}. No real money moves.` : (workspace?.config.liveReady ? 'Customer payments are processed by the connected provider.' : 'Connect payment processing and complete seller verification before accepting real money.');
  if ($('#connection-status')) $('#connection-status').textContent = loading ? 'Syncing workspace…' : (workspace ? engineText() : 'Workspace connection');
  const name = workspace?.merchant.name || 'Your workspace';
  if ($('#workspace-name')) $('#workspace-name').textContent = name;
  if ($('#workspace-avatar')) $('#workspace-avatar').textContent = name.slice(0, 1).toUpperCase();
  const accountName = accountProfile?.displayName || 'Your account';
  const initials = accountName.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  if ($('#account-display-name')) $('#account-display-name').textContent = accountName;
  if ($('#account-email')) $('#account-email').textContent = accountProfile?.email || 'Sign in to Harbor';
  if ($('#account-avatar')) $('#account-avatar').textContent = initials || 'H';
  if ($('#topbar-account-avatar')) $('#topbar-account-avatar').textContent = initials || 'H';
  document.querySelectorAll('[data-route]').forEach(node => {
    const active = node.dataset.route === route;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
  const titles = {
    overview: ['Overview', 'Your payment links, earnings, and payouts in one place.'],
    links: ['Payment links', 'Create a checkout. Share a link. See the payment arrive here.'],
    payments: ['Payments', 'Every checkout attempt, with its recorded status and fee breakdown.'],
    payouts: ['Bank payouts', 'Manage earnings and see your payout history.'],
    account: ['Your account', 'Manage your profile and the business behind your payment links.'],
    settings: ['Workspace settings', 'Your business name, platform fees, and payment connection.'],
  };
  if ($('#page-title')) $('#page-title').textContent = titles[route][0];
  if ($('#page-subtitle')) $('#page-subtitle').textContent = titles[route][1];
  const action = $('#primary-action');
  if (action) {
    action.hidden = route === 'settings' || route === 'account';
    action.innerHTML = route === 'payouts' ? `${icon('bank')} ${mode === 'test' && workspace?.config.engines.test === 'simulation' ? 'Request test payout' : 'Set up payouts'}` : `${icon('plus')} Create payment link`;
    action.disabled = !workspace || loading;
  }
}

function showLoadError(error) {
  const signin = error.status === 401 || ['unauthorized', 'auth_required', 'authentication_required', 'auth_missing', 'account_changed'].includes(error.code);
  content.innerHTML = `<section class="panel empty-state"><span class="badge ${signin ? 'neutral' : 'danger'}">${signin ? 'Sign in required' : 'Connection interrupted'}</span><h3>${signin ? 'Open your Harbor workspace' : 'Your workspace could not load'}</h3><p>${esc(error.message)}</p><div class="empty-actions">${signin ? '<a class="btn primary" target="_top" href="/login">Sign in to Harbor</a>' : '<button class="btn primary" data-action="refresh">Try again</button>'}</div></section>`;
}

function clearAccountWorkspace() {
  ++loadEpoch;
  workspace = null;
  accountProfile = null;
  loading = false;
  backgroundStopped = true;
  settingsDirty = false;
  profileDirty = false;
  profileSaving = false;
  dialogBusy = false;
  query = '';
  paymentFilter = 'all';
  clearTimeout(toastTimer);
  $('#toast')?.classList.remove('visible');
  if ($('#toast')) $('#toast').textContent = '';
  if ($('#global-search')) $('#global-search').value = '';
  if (dialog.open) dialog.close();
  dialogContent.replaceChildren();
  setMenu(false);
  updateShell();
}

async function verifyAccountSession() {
  if (!accountProfile) return false;
  if (sessionCheck) return sessionCheck;
  const expectedId = accountProfile.id;
  sessionCheck = (async () => {
    try {
      const data = await api('/api/account');
      if (!accountProfile || accountProfile.id !== expectedId) return false;
      if (data.registrationRequired) {
        const error = new Error('Finish creating your Harbor account to open your workspace.');
        error.code = 'account_setup_required';
        handleAccountAccessError(error);
        return false;
      }
      if (!data.authenticated || data.account?.id !== expectedId) {
        const error = new Error('Your signed-in account changed. Sign in again to open the correct workspace.');
        error.code = 'account_changed';
        handleAccountAccessError(error);
        return false;
      }
      return true;
    } catch (error) {
      if (accountProfile) toast(error.message);
      return false;
    }
  })();
  try { return await sessionCheck; } finally { sessionCheck = null; }
}

function hidePrivateView() {
  clearAccountWorkspace();
  content.innerHTML = '<section class="panel empty-state" role="status"><h3>Opening your Harbor workspace…</h3><p>Checking your sign-in before showing account details.</p></section>';
}

function handleAccountAccessError(error) {
  const signin = error.status === 401 || ['unauthorized', 'auth_required', 'authentication_required', 'auth_missing', 'account_changed'].includes(error.code);
  if (!signin && error.code !== 'account_setup_required') return false;
  clearAccountWorkspace();
  if (error.code === 'account_setup_required') {
    content.innerHTML = '<section class="panel empty-state"><h3>Create your Harbor account</h3><p>Finish your account profile to manage your own payment links and earnings.</p><a class="btn primary" href="/signup">Continue account setup</a></section>';
    location.assign('/signup');
  } else showLoadError(error);
  return true;
}

async function refresh({ quiet = false, force = false } = {}) {
  if (loading && !force) return;
  const epoch = ++loadEpoch;
  const requestedMode = mode;
  loading = true;
  updateShell();
  if (!quiet && !workspace) content.innerHTML = '<section class="panel empty-state" role="status"><h3>Loading your workspace…</h3><p>Connecting to the saved payment ledger.</p></section>';
  try {
    const [accountData, data] = await Promise.all([api('/api/account'), api(`/api/workspace?mode=${requestedMode}`)]);
    if (epoch !== loadEpoch || requestedMode !== mode) return;
    if (accountData.registrationRequired) {
      const error = new Error('Finish creating your Harbor account to open your workspace.');
      error.code = 'account_setup_required';
      handleAccountAccessError(error);
      return;
    }
    if (!accountData.account?.id || accountData.account.id !== data.merchant?.id || (accountProfile && accountProfile.id !== accountData.account.id)) {
      const error = new Error('Your signed-in account changed. Sign in again to open the correct workspace.');
      error.code = 'account_changed';
      handleAccountAccessError(error);
      return;
    }
    if (!data.config?.fees || !Array.isArray(data.links) || !Array.isArray(data.payments) || !data.summary) throw new Error('Workspace data is incomplete. Please try again.');
    workspace = data;
    accountProfile = accountData.account;
    backgroundStopped = false;
    if (!(settingsDirty && route === 'settings') && !(profileDirty && route === 'account') && !profileSaving) render();
  } catch (error) {
    if (epoch !== loadEpoch || requestedMode !== mode) return;
    backgroundStopped = true;
    if (!quiet || !workspace) showLoadError(error); else toast(error.message);
  } finally {
    if (epoch === loadEpoch) { loading = false; updateShell(); }
  }
}

function empty(title, description, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon('link')}</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<div class="empty-actions">${action}</div>` : ''}</div>`;
}

function setupCard(compact = false) {
  if (workspace?.config.liveReady) return '<section class="panel"><span class="badge success">Live connection configured</span><h2 style="margin:12px 0">Live payment processing</h2><p class="muted">Live checkout uses the connected Stripe provider. Bank payouts still need seller onboarding, settlement reconciliation, and the provider payout integration.</p></section>';
  const requirements = ['Connect Harbor to a payment provider.', 'Complete business verification and connect a payout bank account.', 'Confirm supported countries and finish live payment approval.'];
  return `<section class="panel setup-panel"><div class="section-heading"><div><span class="badge pending">Setup required</span><h2 style="margin-top:12px">Start accepting real payments</h2></div>${icon('arrow')}</div><p class="muted">Your live workspace is separate from test activity. Finish the payment connection to accept real charges.</p>${compact ? '' : `<ol class="setup-steps">${requirements.map(item => `<li>${esc(item)}</li>`).join('')}</ol>`}<button class="btn secondary" data-action="setup">View connection checklist ${icon('arrow')}</button></section>`;
}

function metric(label, value, note, symbol) {
  return `<div class="stat-card"><div class="stat-label">${esc(label)}<span class="metric-icon">${icon(symbol)}</span></div><div class="stat-value">${amount(value)}</div><div class="stat-meta">${esc(note)}</div></div>`;
}

function renderOverview() {
  const s = workspace.summary;
  const test = mode === 'test';
  const simulation = test && workspace.config.engines.test === 'simulation';
  const paid = workspace.payments.filter(row => row.status === 'paid');
  const active = workspace.links.filter(link => link.active).length;
  const stats = `<div class="stats-grid">${metric(test ? 'Test payment volume' : 'Payment volume', s.grossCents, `${paid.length} recorded successful payment${paid.length === 1 ? '' : 's'}`, 'wallet')}${metric(test ? 'Available test earnings' : 'Available earnings', s.availableCents, test ? 'Fictional funds in this workspace' : 'Provider settlement required', 'bank')}${metric('Pending earnings', s.pendingCents, 'Awaiting provider settlement', 'clock')}${metric('Platform fees', s.platformRevenueCents, test ? 'Test fees recorded' : 'Gross platform revenue', 'plus')}</div>`;
  const onboarding = `<section class="panel onboarding-panel"><div class="section-heading"><div><span class="badge ${test ? 'success' : 'neutral'}">${test ? 'Your test workspace' : 'Your live workspace'}</span><h2 style="margin-top:11px">Your next payment starts with a link</h2><p>Create a checkout for a product, service, or invoice.</p></div><span class="link-illustration">${icon('link')}</span></div><div class="payment-steps"><div><span>1</span><strong>Create a payment link</strong><small>Set a name and price.</small></div><div><span>2</span><strong>Share your checkout</strong><small>Send the link to your customer.</small></div><div><span>3</span><strong>Track your earnings</strong><small>Payments appear in Harbor.</small></div></div><button class="btn primary" data-action="create-link">${icon('plus')} Create payment link</button></section>`;
  const activity = workspace.payments.slice(0, 6).map(row => `<button class="activity-item activity-button" data-action="payment-detail" data-id="${esc(row.id)}"><div><strong>${esc(row.linkTitle)}</strong><p>${esc(dateText(row.createdAt))}</p></div><div><strong>${amount(row.grossCents)}</strong><p>${statusBadge(row.status)}</p></div></button>`).join('');
  return `${stats}<div class="overview-grid"><div class="overview-main">${mode === 'live' && !workspace.config.liveReady ? setupCard() : onboarding}<section class="panel"><div class="section-heading"><div><h2>Recent payments</h2><p>Recorded checkout activity in ${test ? 'test' : 'live'} mode.</p></div><a href="#payments" class="btn small">View all ${icon('arrow')}</a></div>${activity ? `<div class="activity-list">${activity}</div>` : empty('Your first payment belongs here', 'Create a payment link and open its checkout to start.', '<button class="btn secondary" data-action="create-link">Create a link</button>')}</section></div><aside class="overview-aside"><section class="panel balance-card"><div class="balance-icon">${icon('bank')}</div><h2>${test ? 'Available test balance' : 'Available balance'}</h2><div class="balance-amount">${amount(s.availableCents)}</div><p>${simulation ? 'Simulation earnings can be used to test the payout flow. No funds reach a bank.' : test ? 'Stripe test earnings await provider settlement. Bank payouts require a verified seller account.' : 'Live balances come from verified provider activity. Bank payouts require seller onboarding.'}</p><button class="btn primary" data-action="payout">${simulation ? 'Request test payout' : 'Set up payouts'} ${icon('arrow')}</button><span class="balance-note">${amount(s.paidOutCents)} ${test ? 'simulated payouts' : 'paid out'}</span></section><section class="panel"><div class="section-heading"><h2>Workspace at a glance</h2></div><div class="list-row"><strong>Active payment links</strong><span class="badge success">${active}</span></div><div class="list-row"><strong>Checkout engine</strong><span class="muted">${test ? (workspace.config.engines.test === 'stripe' ? 'Stripe test' : 'Simulation') : (workspace.config.liveReady ? 'Stripe' : 'Not connected')}</span></div><div class="list-row"><strong>Payment fee</strong><span class="rate-text">${mode === 'live' && !workspace.config.liveFees?.payment ? 'Not configured' : esc(rateText(workspace.config.fees.payment))}</span></div><a class="btn ghost" href="#settings">Manage workspace ${icon('arrow')}</a></section></aside></div>`;
}

function matchingLinks() {
  const search = query.trim().toLowerCase();
  return workspace.links.filter(link => !search || `${link.title} ${link.description} ${link.id}`.toLowerCase().includes(search));
}

function renderLinks() {
  const links = matchingLinks();
  const header = `<div class="notice">This preview is private. Public customer access is part of live setup.</div><div class="table-toolbar"><p class="muted">${workspace.links.length} payment link${workspace.links.length === 1 ? '' : 's'} · ${mode === 'test' ? 'Test' : 'Live'} mode</p><button class="btn small" data-action="refresh">Refresh</button></div>`;
  if (!links.length) return `<section class="panel">${header}${empty(query ? 'No matching payment links' : 'Make getting paid as simple as a link', query ? 'Try a different search.' : 'Create a product or service checkout, then share its unique URL.', '<button class="btn primary" data-action="create-link">Create payment link</button>')}</section>${mode === 'live' && !workspace.config.liveReady ? setupCard() : ''}`;
  return `<section class="panel">${header}<div class="link-grid">${links.map(link => {
    const payments = workspace.payments.filter(row => row.linkId === link.id && row.status === 'paid');
    return `<article class="payment-link-card"><div class="split"><span class="link-card-icon">${icon('link')}</span><span class="badge ${link.active ? 'success' : 'neutral'}">${link.active ? 'Active' : 'Inactive'}</span></div><h3>${esc(link.title)}</h3><p class="link-description">${esc(link.description || 'Payment link')}</p><div class="link-price">${amount(link.amountCents)} <small>USD</small></div><div class="link-meta"><span>${payments.length} paid</span><span>${amount(payments.reduce((sum, row) => sum + row.grossCents, 0))} volume</span></div><p class="link-created">Created ${esc(dateText(link.createdAt))}</p><div class="link-card-actions"><button class="btn secondary" data-action="copy-link" data-id="${esc(link.id)}">${icon('copy')} Copy link</button><a class="btn small" href="${esc(safeLinkURL(link))}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(link.title)} checkout">${icon('arrow')}</a></div><button class="link-toggle" data-action="toggle-link" data-id="${esc(link.id)}">${link.active ? 'Deactivate link' : 'Reactivate link'}</button></article>`;
  }).join('')}</div></section>`;
}

function statusBadge(status) {
  const names = { paid: 'Paid', declined: 'Declined', pending: 'Pending', created: 'Awaiting payment' };
  const styles = { paid: 'success', declined: 'danger', pending: 'pending', created: 'neutral' };
  return `<span class="badge ${styles[status] || 'neutral'}">${esc(names[status] || status)}</span>`;
}

function filteredPayments() {
  const search = query.trim().toLowerCase();
  return workspace.payments.filter(row => (paymentFilter === 'all' || row.status === paymentFilter) && (!search || `${row.id} ${row.linkTitle} ${row.status}`.toLowerCase().includes(search)));
}

function renderPayments() {
  const payments = filteredPayments();
  return `<section class="panel"><div class="table-toolbar"><div class="toolbar-actions"><select id="payment-filter" aria-label="Filter payment status">${[['all', 'All statuses'], ['paid', 'Paid'], ['created', 'Awaiting payment'], ['pending', 'Pending'], ['declined', 'Declined']].map(([value, label]) => `<option value="${value}" ${paymentFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="muted">${payments.length} payment${payments.length === 1 ? '' : 's'}</span></div><button class="btn small" data-action="export-payments">${icon('download')} Export CSV</button></div>${payments.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Payment</th><th>Status</th><th>Amount</th><th>Platform fee</th><th>Earnings</th><th>Created</th></tr></thead><tbody>${payments.map(row => `<tr><td><button class="table-button" data-action="payment-detail" data-id="${esc(row.id)}">${esc(row.linkTitle)}</button><small>${esc(row.id)}</small></td><td>${statusBadge(row.status)}<small>${row.engine === 'stripe' ? 'Stripe' : 'Test simulation'}</small></td><td class="amount">${amount(row.grossCents)}</td><td class="amount">${amount(row.platformFeeCents)}</td><td class="amount">${amount(row.netCents)}</td><td>${esc(dateText(row.createdAt))}</td></tr>`).join('')}</tbody></table></div><p class="muted table-note">Platform fees are recorded per payment. Actual provider processing costs and settlement are handled separately by the payment provider.</p>` : empty('No payments to show yet', query || paymentFilter !== 'all' ? 'Try another search or status filter.' : 'Successful and declined checkout attempts will appear here.', '<a class="btn secondary" href="#links">View payment links</a>')}</section>`;
}

function renderPayouts() {
  const simulation = mode === 'test' && workspace.config.engines.test === 'simulation';
  const payouts = workspace.payouts || [];
  return `<div class="payout-top-grid"><section class="panel balance-card"><h2>${mode === 'test' ? 'Available test earnings' : 'Available earnings'}</h2><div class="balance-amount">${amount(workspace.summary.availableCents)}</div><p>${simulation ? 'Test a withdrawal from the earnings recorded in this workspace.' : 'Bank payout availability is determined by the payment provider and completed seller onboarding.'}</p><button class="btn primary" data-action="payout">${simulation ? 'Request test payout' : 'View payout setup'} ${icon('arrow')}</button></section><section class="panel destination-panel"><h2>${simulation ? 'Test destination' : 'Bank account connection'}</h2><div class="bank-destination"><span class="bank-icon">${icon('bank')}</span><div><strong>${simulation ? 'Simulated bank payout' : 'No payout account connected'}</strong><span class="muted">${simulation ? 'No bank details required. No money moves.' : 'Seller accounts and bank verification are required.'}</span></div><span class="badge ${simulation ? 'neutral' : 'pending'}">${simulation ? 'TEST' : 'Setup'}</span></div><div class="fee-row"><span>${mode === 'live' ? 'Live payout fee collection' : 'Platform withdrawal fee'}</span><strong>${mode === 'live' ? 'Integration required' : esc(rateText(workspace.config.fees.withdrawal))}</strong></div><p class="muted">${simulation ? 'The amount leaving your test balance includes the platform fee.' : 'Live payout fees need a supported collection arrangement with the provider.'}</p></section></div><section class="panel"><div class="section-heading"><div><h2>Payout history</h2><p>${mode === 'test' ? 'Recorded test payouts.' : 'Verified provider payout activity.'}</p></div>${payouts.length ? '<button class="btn small" data-action="export-payouts">Export CSV</button>' : ''}</div>${payouts.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Payout</th><th>Status</th><th>Balance debit</th><th>Platform fee</th><th>Destination amount</th><th>Created</th></tr></thead><tbody>${payouts.map(row => `<tr><td><strong>${esc(row.id)}</strong></td><td><span class="badge neutral">${row.status === 'simulated' ? 'Simulated' : esc(row.status)}</span></td><td class="amount">${amount(row.debitCents)}</td><td class="amount">${amount(row.platformFeeCents)}</td><td class="amount">${amount(row.bankReceivesCents)}</td><td>${esc(dateText(row.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : empty('Your payouts will appear here', simulation ? 'First collect a test payment, then request a test payout.' : 'Finish the live payment and seller account connection to enable bank payouts.')}<p class="muted table-note">Test payouts update only the simulation ledger. They never send money to a bank account.</p></section>`;
}

function rateFields(kind, label, note) {
  const rate = workspace.config.fees[kind];
  return `<section class="rate-section"><div class="section-heading"><div><h3>${esc(label)}</h3><p>${esc(note)}</p></div><span class="badge neutral">Configurable</span></div><div class="form-grid"><div class="field"><label for="${kind}-percent">Percentage</label><div class="input-affix"><input id="${kind}-percent" name="${kind}Percent" inputmode="decimal" type="text" value="${(rate.percentBps / 100).toFixed(2)}" required maxlength="6"><span>%</span></div></div><div class="field"><label for="${kind}-fixed">Fixed amount</label><div class="input-affix"><span>$</span><input id="${kind}-fixed" name="${kind}Fixed" inputmode="decimal" type="text" value="${dollars(rate.fixedCents)}" required maxlength="10"><span>USD</span></div></div></div></section>`;
}

function accountSummaryCard() {
  return `<section class="panel account-summary"><div class="section-heading"><div><span class="badge success">Account active</span><h2 style="margin-top:12px">${esc(accountProfile?.businessName || workspace.merchant.name)}</h2></div>${icon('check')}</div><p class="muted">Your payment links and earnings belong to your Harbor account.</p><div class="list-row"><strong>Account holder</strong><span>${esc(accountProfile?.displayName)}</span></div><div class="list-row"><strong>Joined Harbor</strong><span>${esc(dateText(accountProfile?.registeredAt))}</span></div><a class="btn secondary" href="#account">Manage your account ${icon('arrow')}</a></section>`;
}

function renderAccount() {
  const account = accountProfile;
  if (!account) return '';
  return `<div class="settings-layout"><form class="panel profile-form" id="profile-form"><div class="section-heading"><div><h2>Account profile</h2><p>Your account details are shared across Test and Live mode.</p></div><span class="badge success">Account active</span></div><div class="field"><label for="profile-display-name">Your name</label><input id="profile-display-name" name="displayName" value="${esc(account.displayName)}" required maxlength="100" autocomplete="name"><small>Used inside your Harbor account.</small></div><div class="field"><label for="profile-email">Sign-in email</label><input id="profile-email" class="account-email-value" value="${esc(account.email)}" readonly type="email" autocomplete="email"><small>Email used to sign in to Harbor.</small></div><div class="field"><label for="profile-business-name">Business name</label><input id="profile-business-name" name="businessName" value="${esc(account.businessName)}" required maxlength="100" autocomplete="organization"><small>Shown to customers on your payment-link checkout.</small></div><div class="form-grid"><div class="field"><label for="profile-business-type">Account type</label><select id="profile-business-type" name="businessType" required><option value="individual" ${account.businessType === 'individual' ? 'selected' : ''}>Individual</option><option value="company" ${account.businessType === 'company' ? 'selected' : ''}>Company</option></select></div><div class="field"><label for="profile-country">Business country</label><input id="profile-country" name="country" value="${esc(account.country)}" required maxlength="2" minlength="2" pattern="[A-Za-z]{2}" list="profile-country-codes" autocomplete="country" autocapitalize="characters"><datalist id="profile-country-codes"><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="AU">Australia</option><option value="NZ">New Zealand</option><option value="DE">Germany</option><option value="FR">France</option><option value="IE">Ireland</option></datalist><small>Two-letter country code, such as US or CA.</small></div></div><div class="form-error" id="profile-error" role="alert" hidden></div><div class="settings-actions"><button class="btn primary" type="submit">Save profile</button><span class="field-hint profile-save-status" id="profile-save-status">Profile saved to your account</span></div></form><div class="stack"><section class="panel account-summary"><div class="section-heading"><h2>Your Harbor account</h2><span class="badge success">Account active</span></div><p class="muted">You can manage your own links, payment history, and earnings after signing in.</p><div class="list-row"><div><strong>Email verification pending</strong><small>Email verification will be added before live payments are enabled.</small></div><span class="badge pending">Pending</span></div><div class="list-row"><strong>Account created</strong><span>${esc(dateText(account.registeredAt))}</span></div><div class="field"><label for="profile-account-id">Harbor account ID</label><input id="profile-account-id" readonly value="${esc(account.id)}"></div><div class="empty-actions"><a class="btn secondary" href="/login">Sign-in page ${icon('arrow')}</a><a class="btn ghost" href="/logout" target="_top">Sign out</a></div></section><section class="panel account-status-list"><div class="section-heading"><h2>Payments and bank payouts</h2><span class="badge pending">${workspace.config.liveReady ? 'Payout setup required' : 'Payments not connected'}</span></div><div class="list-row"><div><strong>Harbor account</strong><small>Your profile and workspace are ready.</small></div><span class="badge success">Active</span></div><div class="list-row"><div><strong>Payment provider</strong><small>${workspace.config.liveReady ? 'Live payment processing is configured.' : 'Connect payment processing to accept real customer payments.'}</small></div><span class="badge ${workspace.config.liveReady ? 'success' : 'pending'}">${workspace.config.liveReady ? 'Connected' : 'Pending'}</span></div><div class="list-row"><div><strong>Business and bank verification</strong><small>Complete provider onboarding to receive real bank payouts.</small></div><span class="badge pending">Pending</span></div><p class="settings-note">Your Harbor profile does not complete payment-provider verification. Seller countries and payout availability will be checked during provider onboarding.</p><button class="btn secondary" data-action="setup" type="button">View payment setup ${icon('arrow')}</button></section><section class="panel"><h2>Private while we build</h2><p class="muted">Only authorized visitors can access this preview. Your workspace shows the links and earnings associated with your signed-in account.</p></section></div></div>`;
}

function renderSettings() {
  if (mode === 'live') return `<div class="settings-layout"><section class="panel"><div class="section-heading"><div><h2>Live platform fees</h2><p>Live fees are set by Harbor's platform owner.</p></div><span class="badge neutral">Read only</span></div><div class="list-row"><strong>Business name</strong><span>${esc(workspace.merchant.name)}</span></div><div class="fee-row"><span>Customer payment fee</span><strong>${workspace.config.liveFees?.payment ? esc(rateText(workspace.config.fees.payment)) : 'Not configured'}</strong></div><div class="fee-row"><span>Live withdrawal fee collection</span><strong>Integration required</strong></div><div class="notice" style="margin-top:20px">Switch to Test mode to edit example rates and try the fee flow. Live fee collection requires a provider-approved arrangement.</div><button class="btn secondary" data-action="switch-test">Switch to Test mode</button></section><div class="stack">${setupCard()}${accountSummaryCard()}</div></div>`;
  return `<div class="settings-layout"><form class="panel" id="settings-form"><div class="section-heading"><div><h2>Business and test fees</h2><p>Example fees are saved to your test workspace and apply to new links.</p></div></div><div class="field"><label for="business-name">Business name</label><input id="business-name" name="name" value="${esc(workspace.merchant.name)}" required maxlength="100" autocomplete="organization"><small>Shown to customers on payment link checkouts.</small></div>${rateFields('payment', 'On customer payments', 'A percentage, a fixed amount, or both.')}${rateFields('withdrawal', 'On withdrawals', 'Used by the test payout flow. Live collection requires provider setup.')}<div class="notice">Example rates are configurable. Platform fee revenue is gross revenue; provider costs and business expenses are separate.</div><div class="form-error" id="settings-error" role="alert" hidden></div><div class="settings-actions"><button class="btn primary" type="submit">Save settings</button><span class="field-hint" id="settings-save-status">Test workspace settings saved</span></div></form><div class="stack"><section class="panel"><div class="section-heading"><h2>Payment connection</h2><span class="badge ${workspace.config.liveReady ? 'success' : 'pending'}">${workspace.config.liveReady ? 'Connected' : 'Not connected'}</span></div><div class="list-row"><div><strong>Test mode</strong><small>${workspace.config.engines.test === 'stripe' ? 'Stripe test checkout is configured.' : 'Built-in simulation; no card or bank information.'}</small></div><span class="badge neutral">${workspace.config.engines.test === 'stripe' ? 'Stripe test' : 'Simulation'}</span></div><div class="list-row"><div><strong>Live mode</strong><small>${workspace.config.liveReady ? 'Live payment configuration is available.' : 'Provider and seller onboarding are required.'}</small></div></div><button class="btn secondary" data-action="setup" type="button">View connection checklist ${icon('arrow')}</button></section>${accountSummaryCard()}<section class="panel"><h2>Launch scope</h2><div class="country-row"><div><strong>United States company</strong><small>USD payment links in this version</small></div><span class="badge neutral">Initial scope</span></div><p class="settings-note">Additional seller countries and currencies require provider support and a defined launch-country list.</p></section></div></div>`;
}

function render() {
  if (!workspace) return;
  updateShell();
  const views = { overview: renderOverview, links: renderLinks, payments: renderPayments, payouts: renderPayouts, settings: renderSettings, account: renderAccount };
  content.innerHTML = views[route]();
  $('#payment-filter')?.addEventListener('change', event => { paymentFilter = event.target.value; render(); });
  $('#settings-form')?.addEventListener('submit', saveSettings);
  $('#settings-form')?.addEventListener('input', () => { settingsDirty = true; $('#settings-save-status').textContent = 'Unsaved changes'; });
  $('#profile-form')?.addEventListener('submit', saveProfile);
  $('#profile-form')?.addEventListener('input', () => { profileDirty = true; $('#profile-save-status').textContent = 'Unsaved changes'; });
}

function showDialog(title, subtitle, html) {
  if (dialogBusy) return;
  dialogContent.innerHTML = `<div class="dialog-header"><div><span class="dialog-badge">${mode === 'test' ? 'TEST MODE' : 'LIVE MODE'}</span><h2 id="dialog-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="dialog-close" data-action="close-dialog" aria-label="Close dialog" type="button">×</button></div>${html}`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
}

function closeDialog() { if (!dialogBusy) dialog.close(); }

function showSetup() {
  if (mode === 'live' && workspace?.config.liveReady) { showDialog('Connect bank payouts', 'Live charges and bank payouts have separate setup.', '<div class="dialog-body"><p class="muted">Live bank payouts require verified seller accounts, connected bank details, provider settlement reconciliation, and a supported payout fee collection arrangement.</p><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Done</button></div></div>'); return; }
  const requirements = ['Connect Harbor to a payment provider.', 'Verify your business and connect a payout bank account.', 'Confirm supported seller countries and complete live payment approval.'];
  showDialog('Connect live payments', 'Your Harbor account is ready. Payment processing is the next step.', `<div class="dialog-body"><div class="notice warning"><strong>Real charges are not enabled.</strong> This platform needs a verified provider connection before a live checkout can collect money.</div><ol class="onboarding-steps">${requirements.map(item => `<li>${esc(item)}</li>`).join('')}</ol><p class="muted">You can create test payment links and manage your account now. Provider verification and bank connection will be available after the payment integration.</p><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Got it</button></div></div>`);
}

function openCreateLink() {
  if (!workspace) return;
  if (mode === 'live' && !workspace.config.liveReady) { showSetup(); return; }
  showDialog('Create payment link', 'A reusable checkout for your product or service.', `<form id="create-link-form" class="dialog-body"><div class="field"><label for="link-title">What are you selling?</label><input id="link-title" name="title" placeholder="e.g. Website design deposit" required maxlength="100" autocomplete="off"></div><div class="field"><label for="link-description">Description <span class="muted">(optional)</span></label><textarea id="link-description" name="description" rows="3" maxlength="500" placeholder="Let your customer know what is included."></textarea></div><div class="field"><label for="link-amount">Price</label><div class="input-affix"><span>$</span><input id="link-amount" name="amount" inputmode="decimal" placeholder="0.00" required maxlength="12"><span>USD</span></div></div><div id="link-quote" class="quote-preview"><p class="muted">Enter a price to see your fee and earnings.</p></div><div class="form-error" id="link-error" role="alert" hidden></div><p class="dialog-note">${mode === 'test' ? (workspace.config.engines.test === 'stripe' ? 'This link opens a Stripe test checkout. No real charge is made.' : 'This link opens a test simulation. Customers choose a successful or declined test payment; no card details or real money are used.') : 'This is a live payment link. Customers will pay through the configured payment provider.'}</p><div class="dialog-actions"><button class="btn secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit">Create link ${icon('arrow')}</button></div></form>`);
  const form = $('#create-link-form');
  $('#link-amount').addEventListener('input', () => {
    const node = $('#link-quote');
    try {
      const cents = parseDollars($('#link-amount').value);
      const fee = feeCents(cents, workspace.config.fees.payment);
      if (fee >= cents) throw new Error('Increase the price or lower the platform fee.');
      node.innerHTML = `<div class="fee-row"><span>Customer pays</span><strong>${amount(cents)}</strong></div><div class="fee-row"><span>Platform fee (${esc(rateText(workspace.config.fees.payment))})</span><strong>${amount(fee)}</strong></div><div class="fee-row total"><span>Earnings before provider costs</span><strong>${amount(cents - fee)}</strong></div>`;
    } catch (error) { node.innerHTML = `<p class="muted">${esc($('#link-amount').value ? error.message : 'Enter a price to see your fee and earnings.')}</p>`; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (dialogBusy) return;
    const errorNode = $('#link-error');
    errorNode.hidden = true;
    const button = form.querySelector('[type="submit"]');
    try {
      const title = form.elements.title.value.trim();
      if (!title) throw new Error('Give your payment link a name.');
      const amountCents = parseDollars(form.elements.amount.value);
      if (feeCents(amountCents, workspace.config.fees.payment) >= amountCents) throw new Error('The price must be greater than the platform fee.');
      dialogBusy = true;
      button.disabled = true;
      button.textContent = 'Creating…';
      const { link } = await api('/api/links', { method: 'POST', body: { mode, title, description: form.elements.description.value.trim(), amountCents, currency: 'usd' } });
      dialogBusy = false;
      showLinkCreated(link);
      await refresh({ quiet: true, force: true });
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
    } finally { dialogBusy = false; button.disabled = false; button.innerHTML = `Create link ${icon('arrow')}`; }
  });
}

function showLinkCreated(link) {
  const url = safeLinkURL(link);
  showDialog('Your payment link is ready', 'Copy the link and share it with your customer.', `<div class="dialog-body"><div class="created-link-summary"><span class="link-card-icon">${icon('check')}</span><h3>${esc(link.title)}</h3><strong>${amount(link.amountCents)}</strong></div><div class="field"><label for="created-link-url">Payment link</label><input id="created-link-url" readonly value="${esc(url)}"></div><p class="dialog-note">${mode === 'test' ? 'This is a test checkout. Successful test payments appear in this workspace’s test ledger.' : 'This link uses live mode and the configured payment provider.'}</p><div class="dialog-actions"><button class="btn primary" data-action="copy-created-link" data-token="${esc(link.token)}">${icon('copy')} Copy link</button><a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open checkout ${icon('arrow')}</a></div><button class="btn ghost" data-action="view-links">View payment links</button></div>`);
  $('#created-link-url')?.addEventListener('click', event => event.target.select());
}

async function copyLink(link) {
  const url = safeLinkURL(link);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(url);
    toast('Payment link copied');
  } catch {
    showDialog('Copy your payment link', 'Select and copy this address.', `<div class="field"><label for="copy-link-url">Checkout URL</label><input id="copy-link-url" value="${esc(url)}" readonly></div><div class="dialog-actions"><a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open checkout ${icon('arrow')}</a><button class="btn primary" data-action="close-dialog">Done</button></div>`);
    $('#copy-link-url')?.select();
  }
}

function paymentDetail(id) {
  const row = workspace.payments.find(item => item.id === id);
  if (!row) return;
  showDialog('Payment details', row.linkTitle, `<div class="dialog-body"><div class="split">${statusBadge(row.status)}<span class="badge neutral">${row.engine === 'stripe' ? (mode === 'test' ? 'Stripe test' : 'Stripe live') : 'Test simulation'}</span></div><div class="quote-preview"><div class="fee-row"><span>Customer payment</span><strong>${amount(row.grossCents)}</strong></div><div class="fee-row"><span>Platform fee</span><strong>${amount(row.platformFeeCents)}</strong></div><div class="fee-row total"><span>Earnings before provider costs</span><strong>${amount(row.netCents)}</strong></div></div><div class="dialog-details"><p class="muted">Payment ID: ${esc(row.id)}</p><p class="muted">Created: ${esc(dateText(row.createdAt))}</p></div><div class="notice">${row.status !== 'paid' ? 'Only a verified successful payment adds earnings. This attempt has not completed successfully.' : row.engine === 'simulation' ? 'This successful test payment added fictional earnings to the test workspace. No real money moved.' : 'This payment was recorded from verified provider activity. Settlement and provider fees are determined separately by Stripe.'}</div><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Done</button></div></div>`);
}

function openPayout() {
  if (!workspace) return;
  if (mode !== 'test') { showSetup(); return; }
  if (workspace.config.engines.test !== 'simulation') { showDialog('Payout account setup required', 'Stripe payouts need a verified seller account.', '<div class="dialog-body"><p class="muted">The built-in payout simulation is available when the test payment engine is Simulation. Stripe bank payouts need seller onboarding and a supported provider payout flow.</p><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Done</button></div></div>'); return; }
  if (!workspace.summary.availableCents) { showDialog('Collect a test payment first', 'Your available test balance is $0.00.', `<div class="dialog-body"><p class="muted">Create a payment link and complete a successful test checkout to add earnings to this workspace.</p><div class="dialog-actions"><button class="btn secondary" data-action="close-dialog">Close</button><button class="btn primary" data-action="create-link">Create payment link</button></div></div>`); return; }
  showDialog('Request a test payout', 'Simulate transferring earnings from your Harbor balance.', `<form id="payout-form" class="dialog-body"><div class="notice">Simulation only. No bank account is charged or credited.</div><div class="field"><label for="payout-amount">Amount leaving your test balance</label><div class="input-affix"><span>$</span><input id="payout-amount" name="amount" inputmode="decimal" placeholder="0.00" required maxlength="12"><span>USD</span></div><small>Available: ${amount(workspace.summary.availableCents)}</small></div><div id="payout-quote" class="quote-preview"><p class="muted">Enter an amount to preview the payout.</p></div><div class="form-error" id="payout-error" role="alert" hidden></div><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Cancel</button><button type="submit" class="btn primary">Record test payout</button></div></form>`);
  const form = $('#payout-form');
  const quote = () => {
    const debitCents = parseDollars(form.elements.amount.value);
    const platformFeeCents = feeCents(debitCents, workspace.config.fees.withdrawal);
    if (debitCents > workspace.summary.availableCents) throw new Error('This amount is greater than your available test balance.');
    if (platformFeeCents >= debitCents) throw new Error('The payout must be greater than its platform fee.');
    return { debitCents, platformFeeCents, bankReceivesCents: debitCents - platformFeeCents };
  };
  form.elements.amount.addEventListener('input', () => {
    try {
      const row = quote();
      $('#payout-quote').innerHTML = `<div class="fee-row"><span>Test balance debit</span><strong>${amount(row.debitCents)}</strong></div><div class="fee-row"><span>Platform fee</span><strong>${amount(row.platformFeeCents)}</strong></div><div class="fee-row total"><span>Simulated destination amount</span><strong>${amount(row.bankReceivesCents)}</strong></div>`;
    } catch (error) { $('#payout-quote').innerHTML = `<p class="muted">${esc(error.message)}</p>`; }
  });
  const requestId = crypto.randomUUID();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (dialogBusy) return;
    const errorNode = $('#payout-error');
    errorNode.hidden = true;
    const button = form.querySelector('[type="submit"]');
    try {
      const { debitCents } = quote();
      dialogBusy = true;
      button.disabled = true;
      button.textContent = 'Recording…';
      const { payout } = await api('/api/payouts', { method: 'POST', body: { mode, debitCents, requestId } });
      dialogBusy = false;
      showDialog('Test payout recorded', 'The simulation ledger has been updated.', `<div class="dialog-body"><span class="badge success">Simulated</span><div class="fee-row"><span>Balance debit</span><strong>${amount(payout.debitCents)}</strong></div><div class="fee-row"><span>Platform fee</span><strong>${amount(payout.platformFeeCents)}</strong></div><div class="fee-row total"><span>Simulated destination amount</span><strong>${amount(payout.bankReceivesCents)}</strong></div><p class="dialog-note">Payout ID: ${esc(payout.id)}. No money was sent to a bank.</p><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Done</button></div></div>`);
      await refresh({ quiet: true, force: true });
    } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; } finally { dialogBusy = false; button.disabled = false; button.textContent = 'Record test payout'; }
  });
}

function parseBps(value, maxBps) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a percentage with up to two decimal places.');
  const [whole, decimal = ''] = value.trim().split('.');
  const result = Number(BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0')));
  if (result > maxBps) throw new Error(`This fee percentage must be between 0 and ${maxBps / 100}.`);
  return result;
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  if (button.disabled || mode !== 'test') return;
  const errorNode = $('#settings-error');
  errorNode.hidden = true;
  try {
    const name = form.elements.name.value.trim();
    if (!name) throw new Error('Enter your business name.');
    const fees = {};
    for (const kind of ['payment', 'withdrawal']) fees[kind] = { percentBps: parseBps(form.elements[`${kind}Percent`].value, kind === 'payment' ? 2000 : 1000), fixedCents: parseDollars(form.elements[`${kind}Fixed`].value, { allowZero: true }) };
    if (Object.values(fees).some(rate => rate.fixedCents > 10000)) throw new Error('Fixed fees must be no more than $100.00.');
    button.disabled = true;
    button.textContent = 'Saving…';
    await api('/api/settings', { method: 'POST', body: { fees, name } });
    settingsDirty = false;
    toast('Workspace settings saved');
    await refresh({ quiet: true, force: true });
  } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; } finally { button.disabled = false; button.textContent = 'Save settings'; }
}

async function saveProfile(event) {
  event.preventDefault();
  if (profileSaving || !accountProfile || !workspace) return;
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const errorNode = $('#profile-error');
  const accountId = accountProfile.id;
  errorNode.hidden = true;
  try {
    const displayName = form.elements.displayName.value.trim();
    const businessName = form.elements.businessName.value.trim();
    const businessType = form.elements.businessType.value;
    const country = form.elements.country.value.trim().toUpperCase();
    if (!displayName || displayName.length > 100) throw new Error('Enter your name using up to 100 characters.');
    if (!businessName || businessName.length > 100) throw new Error('Enter a business name using up to 100 characters.');
    if (!['individual', 'company'].includes(businessType)) throw new Error('Choose an individual or company account.');
    if (!/^[A-Z]{2}$/.test(country)) throw new Error('Use a two-letter business country code, such as US.');
    profileSaving = true;
    button.disabled = true;
    button.textContent = 'Saving…';
    const result = await api('/api/account/profile', { method: 'POST', body: { displayName, businessName, businessType, country } });
    if (!accountProfile || accountProfile.id !== accountId || result.account?.id !== accountId) {
      const error = new Error('Your signed-in account changed. Sign in again to open the correct workspace.');
      error.code = 'account_changed';
      handleAccountAccessError(error);
      return;
    }
    accountProfile = result.account;
    workspace.merchant.name = result.account.businessName;
    profileDirty = false;
    profileSaving = false;
    toast('Account profile saved');
    await refresh({ quiet: true, force: true });
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    profileSaving = false;
    button.disabled = false;
    button.textContent = 'Save profile';
  }
}

function exportCSV(kind) {
  const isPayment = kind === 'payments';
  const headers = isPayment ? ['Payment ID', 'Title', 'Mode', 'Engine', 'Status', 'Gross USD', 'Platform fee USD', 'Earnings USD', 'Created'] : ['Payout ID', 'Mode', 'Status', 'Debit USD', 'Platform fee USD', 'Destination USD', 'Created'];
  const records = isPayment ? filteredPayments() : workspace.payouts;
  if (!records.length) { toast('There are no records to export'); return; }
  const rows = records.map(row => isPayment ? [row.id, row.linkTitle, mode, row.engine, row.status, dollars(row.grossCents), dollars(row.platformFeeCents), dollars(row.netCents), row.createdAt] : [row.id, mode, row.status, dollars(row.debitCents), dollars(row.platformFeeCents), dollars(row.bankReceivesCents), row.createdAt]);
  const csvCell = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `harbor-${mode}-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleAction(event) {
  const node = event.target.closest('[data-action]');
  if (!node) return;
  const action = node.dataset.action;
  if (!workspace && !['close-dialog', 'refresh'].includes(action)) return;
  if (!['close-dialog', 'refresh'].includes(action) && !await verifyAccountSession()) return;
  if (action === 'close-dialog') closeDialog();
  else if (action === 'create-link') openCreateLink();
  else if (action === 'refresh') await refresh();
  else if (action === 'setup') showSetup();
  else if (action === 'switch-test') await selectMode('test');
  else if (action === 'payout') openPayout();
  else if (action === 'payment-detail') paymentDetail(node.dataset.id);
  else if (action === 'copy-link') { const link = workspace.links.find(row => row.id === node.dataset.id); if (link) await copyLink(link); }
  else if (action === 'copy-created-link') await copyLink({ token: node.dataset.token });
  else if (action === 'view-links') { closeDialog(); location.hash = 'links'; }
  else if (action === 'export-payments') exportCSV('payments');
  else if (action === 'export-payouts') exportCSV('payouts');
  else if (action === 'toggle-link') {
    const link = workspace.links.find(row => row.id === node.dataset.id);
    if (!link || node.disabled) return;
    node.disabled = true;
    try { await api(`/api/links/${encodeURIComponent(link.id)}`, { method: 'PATCH', body: { active: !link.active } }); toast(link.active ? 'Payment link deactivated' : 'Payment link reactivated'); await refresh({ quiet: true, force: true }); } catch (error) { toast(error.message); node.disabled = false; }
  }
}

async function selectMode(next) {
  if (next === mode || dialogBusy || profileSaving) return;
  if (dialog.open) dialog.close();
  mode = next;
  try { localStorage.setItem('harbor-workspace-mode', mode); } catch { /* Preference only. */ }
  ++loadEpoch;
  loading = false;
  workspace = null;
  settingsDirty = false;
  profileDirty = false;
  paymentFilter = 'all';
  query = '';
  if ($('#global-search')) $('#global-search').value = '';
  updateShell();
  await refresh();
}

content.addEventListener('click', handleAction);
dialogContent.addEventListener('click', handleAction);
$('#primary-action')?.addEventListener('click', async () => { if (await verifyAccountSession()) route === 'payouts' ? openPayout() : openCreateLink(); });
$('#refresh-workspace')?.addEventListener('click', () => refresh());
$('#mode-test')?.addEventListener('click', () => selectMode('test'));
$('#mode-live')?.addEventListener('click', () => selectMode('live'));
$('#mobile-menu-toggle')?.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
$('#global-search')?.addEventListener('input', event => { query = event.target.value; if (route !== 'links' && route !== 'payments') { route = 'payments'; location.hash = 'payments'; } render(); });
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  route = allowedRoutes.includes(next) ? next : 'overview';
  settingsDirty = false;
  profileDirty = false;
  setMenu(false);
  render();
  refresh({ quiet: Boolean(workspace) });
});
dialog.addEventListener('cancel', event => { if (dialogBusy) event.preventDefault(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });
document.addEventListener('click', event => { if (document.body.classList.contains('menu-open') && !event.target.closest('#sidebar') && !event.target.closest('#mobile-menu-toggle')) setMenu(false); });
async function resumeWorkspace() {
  if (!workspace) { if (!loading) refresh(); return; }
  if (!await verifyAccountSession()) return;
  if (!dialog.open && !settingsDirty && !profileDirty && !profileSaving && !loading) refresh({ quiet: true });
}
window.addEventListener('focus', resumeWorkspace);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeWorkspace(); });
document.addEventListener('click', event => {
  const anchor = event.target.closest('a[href="/logout"]');
  if (anchor && !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) hidePrivateView();
});
window.addEventListener('pagehide', hidePrivateView);
window.addEventListener('pageshow', event => { if (event.persisted) { hidePrivateView(); refresh({ force: true }); } });
setInterval(() => { if (workspace && !backgroundStopped && !loading && !dialog.open && !settingsDirty && !profileDirty && !profileSaving && document.visibilityState === 'visible' && !['settings', 'account'].includes(route)) refresh({ quiet: true }); }, 10000);
updateShell();
refresh();
