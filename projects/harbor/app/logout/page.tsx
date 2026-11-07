import BrowserModule from "../browser-module";

export const dynamic = "force-dynamic";
export const metadata = {title: "Sign out — Harbor"};

export default function Logout() {
  return <>
    <link rel="stylesheet" href="/account.css" />
    <main className="account-logout-page">
      <div className="account-logout-panel" aria-live="polite">
        <span className="account-ready-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5m5 5H3m12-8h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></svg></span>
        <h1 id="logout-heading">Sign out of Harbor</h1>
        <p id="logout-status">End your Harbor session on this browser.</p>
        <button type="button" className="account-button account-button-primary" id="logout-button">Sign out</button>
        <p className="account-secondary-prompt"><a href="/">Return to dashboard</a></p>
        <noscript><p>JavaScript is needed to close your session. Enable it, then reload this page.</p></noscript>
      </div>
    </main>
    <BrowserModule src="/logout.js" />
  </>;
}
