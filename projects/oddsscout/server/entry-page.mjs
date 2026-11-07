export const ENTRY_SECURITY_HEADERS={
 'Cache-Control':'private, no-store',
 'Netlify-CDN-Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Vary':'Cookie'
};

export function entryPage({configured=true}={}) {
 const disabled=configured?'':' disabled';
 return `<!doctype html>
<html lang="en" data-entry-configured="${configured?'true':'false'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex,nofollow"><title>Enter OddsScout</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/entry.css"><script type="module" src="/entry.mjs"></script></head>
<body class="entry-page"><main class="entry-shell"><section class="entry-card" role="dialog" aria-modal="true" aria-labelledby="entry-title" aria-describedby="entry-description">
<a class="entry-brand" href="/" aria-label="OddsScout home">Odds<span>Scout</span></a>
<div class="entry-lock" aria-hidden="true">⌑</div><p class="entry-kicker">PRIVATE ACCESS</p><h1 id="entry-title">Enter your access code</h1>
<p id="entry-description" class="entry-description">Enter the code shared by the site owner to open OddsScout.</p>
<form id="entry-form" method="post" action="/api/access"><div class="entry-field"><label for="entry-code">Access code</label><div class="entry-input-row"><input id="entry-code" name="code" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" maxlength="256" required aria-describedby="entry-error entry-status"${disabled}><button id="entry-toggle" type="button" aria-controls="entry-code" aria-label="Show access code" aria-pressed="false"${disabled}>Show</button></div></div>
<p id="entry-error" class="entry-error" role="alert">${configured?'':'Private access has not been configured. Ask the site owner to set ACCESS_CODE and ENTRY_SESSION_SECRET in Netlify, then redeploy.'}</p><p id="entry-status" class="entry-status" role="status" aria-live="polite"></p><button id="entry-submit" class="entry-submit" type="submit"${disabled}>Open OddsScout</button></form>
<p class="entry-footnote">Access lasts up to 8 hours on this device. Your user account and saved bets remain separate.</p><noscript><p class="entry-error">JavaScript is required to securely submit your code. Enable it and reload this page.</p></noscript>
</section></main></body></html>`;
}
