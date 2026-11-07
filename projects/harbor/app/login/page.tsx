import BrowserModule from "../browser-module";

export const dynamic = "force-dynamic";
export const metadata = {title: "Sign in — Harbor"};

export default function Login() {
  return <>
    <link rel="stylesheet" href="/account.css" />
    <div id="account-root" data-screen="login"><main className="account-loading" aria-live="polite">Loading your Harbor account…</main></div>
    <BrowserModule src="/account.js" />
  </>;
}
