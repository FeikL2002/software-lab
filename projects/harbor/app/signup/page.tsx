import BrowserModule from "../browser-module";

export const dynamic = "force-dynamic";
export const metadata = {title: "Create your account — Harbor"};

export default function Signup() {
  return <>
    <link rel="stylesheet" href="/account.css" />
    <div id="account-root" data-screen="signup"><main className="account-loading" aria-live="polite">Loading your Harbor account…</main></div>
    <BrowserModule src="/account.js" />
  </>;
}
