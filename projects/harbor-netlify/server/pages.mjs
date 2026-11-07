import { dashboardShell } from "./dashboard-template.mjs";

const logout = `<main class="account-logout-page"><div class="account-logout-panel" aria-live="polite"><span class="account-ready-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5m5 5H3m12-8h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></svg></span><h1 id="logout-heading">Sign out of Harbor</h1><p id="logout-status">End your Harbor session on this browser.</p><button type="button" class="account-button account-button-primary" id="logout-button">Sign out</button><p class="account-secondary-prompt"><a href="/">Return to dashboard</a></p></div></main>`;

export function renderPage(screen) {
  const account = screen === "login" || screen === "signup";
  const title = screen === "login" ? "Sign in" : screen === "signup" ? "Create your account" : screen === "logout" ? "Sign out" : screen === "checkout" ? "Payment link" : "Your payment workspace";
  const body = account ? `<div id="account-root" data-screen="${screen}"><main class="account-loading" aria-live="polite">Loading your Harbor account…</main></div>` : screen === "logout" ? logout : screen === "checkout" ? `<div id="checkout-root" aria-live="polite"><div class="checkout-loading">Loading payment link…</div></div>` : dashboardShell;
  const extraStyle = account || screen === "logout" ? "/account.css" : screen === "checkout" ? "/checkout.css" : null;
  const module = account ? "/account.js" : screen === "logout" ? "/logout.js" : screen === "checkout" ? "/checkout.js" : "/app.js";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${title} — Harbor</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/styles.css">${extraStyle ? `<link rel="stylesheet" href="${extraStyle}">` : ""}</head><body>${body}<noscript><div class="noscript-notice">Enable JavaScript to use your private Harbor workspace.</div></noscript><script type="module" src="${module}"></script></body></html>`;
}

export function unavailablePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Harbor — Temporarily unavailable</title><link rel="stylesheet" href="/account.css"></head><body><main class="account-logout-page"><div class="account-logout-panel"><h1>Harbor is temporarily unavailable</h1><p>Private account access has not been configured. Please try again later.</p></div></main></body></html>`;
}
