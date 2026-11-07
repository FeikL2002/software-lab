import BrowserModule from "../../browser-module";
export const dynamic = "force-dynamic";
export default function CheckoutPage() {return <><link rel="stylesheet" href="/checkout.css"/><div id="checkout-root" aria-live="polite"><div className="checkout-loading">Loading payment link…</div></div><BrowserModule src="/checkout.js"/></>;}
