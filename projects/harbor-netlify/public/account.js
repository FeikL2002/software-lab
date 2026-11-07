const accountRoot = document.getElementById('account-root');
const accountScreen = accountRoot?.dataset.screen === 'signup' ? 'signup' : 'login';
const accountIcons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 13 4-4m-5 8H7a4 4 0 0 1-3-7l4-4a4 4 0 0 1 6 0m-4 12a4 4 0 0 0 6 0l4-4a4 4 0 0 0-3-7h-2"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h13v11H6a3 3 0 0 1-3-3V6m16 6h-5v5h5m-2-2.5h.01"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16h16M8 16v-3m4 3V8m4 8v-5"/></svg>',
};
const accountCountries = [['US','United States'],['CA','Canada'],['GB','United Kingdom'],['AU','Australia'],['AT','Austria'],['BE','Belgium'],['BR','Brazil'],['DK','Denmark'],['FI','Finland'],['FR','France'],['DE','Germany'],['HK','Hong Kong'],['IN','India'],['IE','Ireland'],['IT','Italy'],['JP','Japan'],['MX','Mexico'],['NL','Netherlands'],['NZ','New Zealand'],['NO','Norway'],['PT','Portugal'],['SG','Singapore'],['ZA','South Africa'],['ES','Spain'],['SE','Sweden'],['CH','Switzerland']];

function accountEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function accountReturnPath() {
  const requested = new URLSearchParams(window.location.search).get('return_to') || '/';
  if (!requested.startsWith('/') || requested.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(requested)) return '/';
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin !== window.location.origin || !/^(?:\/|\/pay\/[a-zA-Z0-9_-]{12,160}\/?)$/.test(destination.pathname)) return '/';
    return destination.pathname + destination.search + destination.hash;
  } catch { return '/'; }
}

function accountAuthPath(path) {
  const returnTo = accountReturnPath();
  return returnTo === '/' ? path : `${path}?return_to=${encodeURIComponent(returnTo)}`;
}

function accountLayout(content, {signup = false} = {}) {
  if (!accountRoot) return;
  accountRoot.innerHTML = `<a class="account-skip" href="#account-content">Skip to ${signup ? 'account setup' : 'sign in'}</a>
    <div class="account-page">
      <aside class="account-story" aria-label="About Harbor">
        <a href="/" class="account-brand" aria-label="Harbor home"><span class="account-brand-symbol" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M4 27V10h7v17m7 0V5h7v22m7 0V15h-7"/><path d="M3 31h30"/></svg></span>harbor<span class="account-brand-dot">.</span></a>
        <div class="account-story-content">
          <span class="account-eyebrow account-story-eyebrow">YOUR BUSINESS, IN ONE PLACE</span>
          <h2>Your links.<br>Your payments.<br><span>Your Harbor.</span></h2>
          <p>A workspace for the business you’re building, from your first payment link to your next payout.</p>
          <div class="account-feature-list">
            <div><span>${accountIcons.link}</span><p><strong>Create a link</strong><small>Give your products and services a checkout.</small></p></div>
            <div><span>${accountIcons.wallet}</span><p><strong>Receive payments</strong><small>Keep payments connected to your business.</small></p></div>
            <div><span>${accountIcons.chart}</span><p><strong>Track earnings</strong><small>See fees, balances, and payout activity.</small></p></div>
          </div>
        </div>
        <p class="account-private">${accountIcons.lock}<span>Private preview · Access by invitation</span></p>
      </aside>
      <main class="account-main" id="account-content" tabindex="-1">
        <nav class="account-topnav" aria-label="Account navigation"><span>${signup ? 'Already have an account?' : 'New to Harbor?'}</span><a href="${accountEscape(accountAuthPath(signup ? '/login' : '/signup'))}">${signup ? 'Sign in' : 'Create an account'} ${accountIcons.arrow}</a></nav>
        <div class="account-panel ${signup ? 'account-panel-signup' : ''}">${content}</div>
        <p class="account-main-footer">Harbor account access is separate from payment-provider verification.</p>
      </main>
    </div>`;
  window.scrollTo(0, 0);
}

function accountIdentity(account) {
  return `<div class="account-identity"><span class="account-identity-icon">${accountIcons.check}</span><div><strong>${accountEscape(account?.displayName || 'Your Harbor account')}</strong>${account?.email ? `<span>${accountEscape(account.email)}</span>` : ''}</div><span class="account-identity-status">Signed in</span></div>`;
}

function accountPasswordField({id, label, name, signup = false, help = ''}) {
  return `<div class="account-field"><label for="${id}">${label}</label><div class="account-password-field"><input id="${id}" name="${name}" type="password" autocapitalize="none" spellcheck="false" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="15"' : ''} maxlength="128" required ${help ? `aria-describedby="${id}-help"` : ''}><button class="account-password-toggle" type="button" data-password-toggle="${id}" aria-controls="${id}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">Show</button></div>${help ? `<small id="${id}-help">${help}</small>` : ''}</div>`;
}

function accountBindPasswordToggles() {
  accountRoot.querySelectorAll('[data-password-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(show));
      const label = document.querySelector(`label[for="${input.id}"]`)?.textContent || 'password';
      button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${label.toLowerCase()}`);
    });
  });
}

function accountLoginForm() {
  accountLayout(`<span class="account-eyebrow">WELCOME BACK</span>
    <h1>Back to your<br>business.</h1>
    <p class="account-intro">Sign in with your Harbor email and password to manage your payment links and earnings.</p>
    <form id="harbor-login-form" class="account-form">
      <div class="account-field"><label for="account-email">Email address</label><input id="account-email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="you@example.com"></div>
      ${accountPasswordField({id:'account-password',label:'Password',name:'password'})}
      <p id="account-form-error" class="account-error" role="alert" hidden></p>
      <button class="account-button account-button-primary" type="submit" id="account-submit-button">Sign in ${accountIcons.arrow}</button>
    </form>
    <p class="account-secondary-prompt">Have an invitation? <a href="${accountEscape(accountAuthPath('/signup'))}">Create your account</a></p>
    <div class="account-auth-note"><strong>Private access for approved accounts.</strong><p>Sign in with the email and password you registered with Harbor. New accounts require an invitation from the preview owner.</p></div>`);
  accountBindPasswordToggles();
  accountBindSubmit('harbor-login-form', '/api/auth/login', form => {
    const data = new FormData(form);
    return {email:String(data.get('email') || '').trim(),password:String(data.get('password') || '')};
  }, {working:'Signing in…',label:'Sign in'});
}

function accountSignupForm() {
  accountLayout(`<span class="account-eyebrow">CREATE YOUR ACCOUNT</span>
    <h1>Make Harbor yours.</h1>
    <p class="account-intro account-intro-compact">Your email, your password, and a workspace for your business.</p>
    <div class="account-invitation-note"><strong>Access by invitation</strong><p>Harbor is currently invitation-only. Use the email and code approved for this preview.</p></div>
    <form id="harbor-signup-form" class="account-form">
      <div class="account-field"><label for="account-email">Email address</label><input id="account-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="you@example.com"><small>Use the email approved for this private preview.</small></div>
      <div class="account-field account-invite-field"><label for="account-invite-code">Private invitation code</label><div class="account-password-field"><input id="account-invite-code" name="inviteCode" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="256" required aria-describedby="account-invite-code-help" data-1p-ignore data-lpignore="true" data-bwignore="true"><button class="account-password-toggle" type="button" data-password-toggle="account-invite-code" aria-controls="account-invite-code" aria-label="Show private invitation code" aria-pressed="false">Show</button></div><small id="account-invite-code-help">Paste the invitation code provided by the preview owner. You only need it when creating your account.</small></div>
      <div class="account-password-grid">
        ${accountPasswordField({id:'account-password',label:'Password',name:'password',signup:true,help:'Use 15–128 characters. A long, unique passphrase works well.'})}
        ${accountPasswordField({id:'account-password-confirm',label:'Confirm password',name:'passwordConfirm',signup:true})}
      </div>
      <div class="account-field"><label for="account-display-name">Your name</label><input id="account-display-name" name="displayName" type="text" autocomplete="name" maxlength="100" required placeholder="Your full name"></div>
      <div class="account-field"><label for="account-business-name">Business name</label><input id="account-business-name" name="businessName" type="text" autocomplete="organization" maxlength="100" required placeholder="The name your customers know"><small>You can use your own name if you sell as an individual.</small></div>
      <fieldset class="account-business-type"><legend>Business type</legend><div class="account-type-options"><label><input type="radio" name="businessType" value="individual" checked required><span><strong>Individual</strong><small>I sell under my own name</small></span></label><label><input type="radio" name="businessType" value="company"><span><strong>Company</strong><small>I have a registered business</small></span></label></div></fieldset>
      <div class="account-field"><label for="account-country">Business country</label><select id="account-country" name="country" autocomplete="country">${accountCountries.map(([code,name]) => `<option value="${accountEscape(code)}" ${code === 'US' ? 'selected' : ''}>${accountEscape(name)}</option>`).join('')}</select><small>This is a profile detail. Payment and bank availability will be checked when you connect a provider.</small></div>
      <p id="account-form-error" class="account-error" role="alert" hidden></p>
      <button class="account-button account-button-primary" type="submit" id="account-submit-button">Create Harbor account ${accountIcons.arrow}</button>
      <p class="account-product-note">Your account is created in Harbor’s private preview. Real payments require a connected payment provider.</p>
    </form>`, {signup:true});
  accountBindPasswordToggles();
  const password = document.getElementById('account-password');
  const confirm = document.getElementById('account-password-confirm');
  password.addEventListener('input', () => confirm.setCustomValidity(''));
  confirm.addEventListener('input', () => confirm.setCustomValidity(''));
  accountBindSubmit('harbor-signup-form', '/api/auth/signup', form => {
    const data = new FormData(form);
    const passwordValue = String(data.get('password') || '');
    if (passwordValue !== String(data.get('passwordConfirm') || '')) {
      confirm.setCustomValidity('Your passwords do not match.');
      confirm.reportValidity();
      return null;
    }
    const body = {email:String(data.get('email') || '').trim(),password:passwordValue,displayName:String(data.get('displayName') || '').trim(),businessName:String(data.get('businessName') || '').trim(),businessType:String(data.get('businessType') || ''),country:String(data.get('country') || '').toUpperCase(),inviteCode:String(data.get('inviteCode') || '').trim()};
    if (!body.displayName || !body.businessName) {
      showAccountFormError('Enter your name and business name to continue.');
      return null;
    }
    return body;
  }, {working:'Creating your account…',label:'Create Harbor account'});
}

function accountBindSubmit(formId, endpoint, getBody, {working,label}) {
  const form = document.getElementById(formId);
  const button = document.getElementById('account-submit-button');
  const error = document.getElementById('account-form-error');
  let saving = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    error.hidden = true;
    const body = getBody(form);
    if (!body) return;
    saving = true;
    button.disabled = true;
    form.setAttribute('aria-busy','true');
    button.textContent = working;
    try {
      const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
      const result = await accountResponse(response);
      if (response.status === 409 && result.code === 'already_signed_in') {
        accountAlreadySignedIn();
        return;
      }
      if (!response.ok) throw new Error(accountAuthError(response, result, endpoint));
      if (result.ok !== true) throw new Error('We couldn’t confirm your sign-in. Please try again.');
      // The server sets a secure session cookie; never store credentials in the browser.
      form.reset();
      window.location.replace(accountReturnPath());
    } catch (failure) {
      showAccountFormError(failure instanceof Error ? failure.message : 'We couldn’t connect to Harbor. Please try again.');
      saving = false;
      button.disabled = false;
      button.innerHTML = `${label} ${accountIcons.arrow}`;
      form.removeAttribute('aria-busy');
    }
  });
}

function accountAuthError(response, result, endpoint) {
  if (response.status === 429 || result.code === 'auth_rate_limited') return 'Too many attempts. Wait a few minutes, then try again.';
  if (response.status === 503 || result.code === 'auth_busy') return 'Sign-in is busy right now. Please try again in a moment.';
  if (endpoint.endsWith('/login') && (response.status === 401 || result.code === 'invalid_credentials')) return 'Email or password is incorrect. Please try again.';
  if (result.code === 'signup_unavailable') return 'We couldn’t create an account with those details. If you already have a Harbor account, sign in.';
  if (result.code === 'invalid_origin') return 'Reload this page, then try again.';
  if (endpoint.endsWith('/signup') && (response.status === 403 || ['private_access_required', 'invitation_invalid'].includes(result.code))) return 'This private preview requires an approved email and invitation code. Check your invitation.';
  if (result.code === 'private_access_required') return 'Only approved accounts can access this private preview. Contact the preview owner for access.';
  return accountErrorText(result, endpoint.endsWith('/signup') ? 'Your account could not be created. Please try again.' : 'You could not be signed in. Please try again.');
}

function accountAlreadySignedIn() {
  accountLayout(`<span class="account-eyebrow">YOU’RE ALREADY SIGNED IN</span>
    <h1>Your session<br>has changed.</h1>
    <p class="account-intro" role="alert">You’re already signed in to Harbor. Open your current workspace or sign out before creating another account.</p>
    <a class="account-button account-button-primary" href="/">Open current workspace ${accountIcons.arrow}</a>
    <div class="account-return-actions"><a href="/logout">Sign out</a><a href="/signup">Reload account setup</a></div>`, {signup:true});
}

function accountNeedsSetup(payload) {
  accountLayout(`<span class="account-eyebrow">ACCOUNT SETUP NEEDED</span>
    <h1>Let’s finish<br>your account.</h1>
    <p class="account-intro">Your Harbor profile isn’t complete yet. Contact the private preview owner for help finishing your account setup, then reload this page.</p>
    ${accountIdentity(payload.account)}
    <a class="account-button account-button-primary" href="${accountScreen === 'signup' ? '/signup' : '/login'}">Reload account ${accountIcons.arrow}</a>
    <p class="account-secondary-prompt"><a href="/logout">Sign out</a></p>`, {signup:accountScreen === 'signup'});
}

function registeredAccount(payload) {
  const account = payload.account;
  accountLayout(`<span class="account-ready-icon">${accountIcons.check}</span>
    <span class="account-eyebrow">${accountScreen === 'signup' ? 'YOUR HARBOR ACCOUNT' : 'WELCOME BACK'}</span>
    <h1>${accountScreen === 'signup' ? 'Your Harbor<br>is ready.' : 'Back to your<br>business.'}</h1>
    <p class="account-intro">Continue to ${accountEscape(account.businessName || 'your business workspace')} to manage your own payment links and earnings.</p>
    ${accountIdentity(account)}
    <a class="account-button account-button-primary" href="/">Open dashboard ${accountIcons.arrow}</a>
    <div class="account-return-actions"><a href="/#account">Manage account</a><a href="/logout">Sign out</a></div>
    <p class="account-product-note">Your Harbor account is ready. Connect a payment provider before receiving real payments.</p>`, {signup:accountScreen === 'signup'});
}

function showAccountFormError(message) {
  const error = document.getElementById('account-form-error');
  error.textContent = message;
  error.hidden = false;
  error.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function accountErrorText(payload, fallback) {
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

async function accountResponse(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return {};
  try { return await response.json(); } catch { return {}; }
}

function accountLoadError(message) {
  accountLayout(`<span class="account-eyebrow">ACCOUNT ACCESS</span><h1>Let’s reconnect.</h1><p class="account-intro">${accountEscape(message)}</p><button class="account-button account-button-primary" id="account-retry" type="button">Try again ${accountIcons.arrow}</button><div class="account-return-actions"><a href="/logout">Sign out</a><a href="/login">Sign-in page</a></div>`, {signup:accountScreen === 'signup'});
  document.getElementById('account-retry').addEventListener('click', loadHarborAccount);
}

async function loadHarborAccount() {
  if (!accountRoot) return;
  const retry = document.getElementById('account-retry');
  if (retry) {retry.disabled=true;retry.textContent='Connecting…';}
  try {
    const response = await fetch('/api/account', {credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
    const payload = await accountResponse(response);
    if (response.status === 401) {
      if (accountScreen === 'login') {accountLoginForm();return;}
      accountSignupForm();
      return;
    }
    if (!response.ok) throw new Error(accountErrorText(payload, 'We couldn’t load your account. Try again in a moment.'));
    if (!payload.authenticated || !payload.account) throw new Error('We couldn’t confirm your account. Please try again.');
    if (payload.registrationRequired) {accountNeedsSetup(payload);return;}
    registeredAccount(payload);
  } catch (error) {
    accountLoadError(error instanceof Error ? error.message : 'We couldn’t load your account. Try again in a moment.');
  }
}

window.addEventListener('pagehide', () => {
  if (accountRoot) accountRoot.innerHTML = '<div class="account-loading" role="status">Checking your Harbor account…</div>';
});
window.addEventListener('pageshow', event => { if (event.persisted) loadHarborAccount(); });
loadHarborAccount();
