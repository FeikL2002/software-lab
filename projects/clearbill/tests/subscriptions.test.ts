import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSubscriptions, monthlyCost, parseEmailFiles } from "../lib/subscriptions";
import type { EmailMessage } from "../lib/subscriptions";
import { DEMO_DATE, sampleEmails } from "../lib/sample-emails";

const now = new Date("2026-10-28T12:00:00Z");
const message = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "receipt", from: "Acme Billing <billing@acme.example>", to: "dad@example.com",
  subject: "Your monthly subscription receipt", date: "2026-10-26T12:00:00Z",
  body: "Your subscription renewed. Total charged: USD 12.00/month. Next billing date: November 26, 2026.",
  ...overrides,
});

test("reads RFC email headers, quoted printable, encoded subject, and safe plain text", () => {
  const [email] = parseEmailFiles("From: Acme <billing@acme.example>\r\nTo: dad@example.com\r\nSubject: =?UTF-8?Q?Your_=E2=82=AC_subscription?=\r\nDate: Mon, 26 Oct 2026 09:00:00 +0000\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTotal charged: =E2=82=AC12.99/month.\r\nYour subscription re=\r\nnewed.", "receipt.eml");
  assert.equal(email.subject, "Your € subscription");
  assert.match(email.body, /€12.99\/month/);
  assert.match(email.body, /renewed/);
  assert.equal(email.date, "2026-10-26T09:00:00.000Z");
});

test("prefers multipart plain text and skips attachments", () => {
  const raw = "From: Billing <billing@acme.example>\nSubject: Receipt\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=outer\n\n--outer\nContent-Type: multipart/alternative; boundary=inner\n\n--inner\nContent-Type: text/plain\n\nYour subscription renewed. USD 7/month.\n--inner\nContent-Type: text/html\n\n<script>fetch('https://bad.example')</script><p>Duplicate USD 7/month</p>\n--inner--\n--outer\nContent-Type: text/plain\nContent-Disposition: attachment; filename=passwords.txt\n\nDO NOT READ THIS ATTACHMENT\n--outer--";
  const [email] = parseEmailFiles(raw, "receipt.eml");
  assert.match(email.body, /USD 7\/month/);
  assert.doesNotMatch(email.body, /Duplicate|DO NOT|<script|fetch\(/);
});

test("decodes base64 HTML without rendering scripts or remote images", () => {
  const html = "<html><head><style>body{display:none}</style></head><body><script>alert(1)</script><p>Your subscription renewed.</p><p>Total charged: &pound;9.99/month.</p><img src='https://tracker.example/open'></body></html>";
  const [email] = parseEmailFiles(`From: billing@acme.example\nSubject: Receipt\nContent-Type: text/html; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n${btoa(html)}`, "receipt.eml");
  assert.match(email.body, /£9.99\/month/);
  assert.doesNotMatch(email.body, /alert|tracker|display:none|<[^>]+>/);
});

test("parses MBOX and leaves escaped From body lines intact", () => {
  const raw = "From sender@example.com Mon Oct 26 10:00:00 2026\nFrom: billing@acme.example\nSubject: One\nDate: Mon, 26 Oct 2026 10:00:00 +0000\n\nYour subscription renewed.\n>From the billing team\nFrom sender@example.com Tue Oct 27 10:00:00 2026\nFrom: billing@second.example\nSubject: Two\n\nYour monthly subscription receipt.";
  const parsed = parseEmailFiles(raw, "mail.mbox");
  assert.equal(parsed.length, 2);
  assert.match(parsed[0].body, /From the billing team/);
  assert.equal(parsed[1].subject, "Two");
});

test("accepts JSON email exports and rejects unsupported object shapes", () => {
  const parsed = parseEmailFiles(JSON.stringify([{ from: "hello@acme.example", subject: "Receipt", date: "2026-10-27", html: "<p>Paid &euro;4.00</p>" }]), "emails.json");
  assert.equal(parsed[0].body, "Paid €4.00");
  assert.throws(() => parseEmailFiles('{"emails":42}', "bad.json"), /JSON array/);
  assert.throws(() => parseEmailFiles("not JSON", "bad.json"), /could not be read/);
});

test("understands webmail pasted headers without an empty line before the body", () => {
  const [email] = parseEmailFiles("From: Netflix <info@account.netflix.com>\nTo: Dad <owner@example.com>\nSubject: Your monthly subscription receipt\nDate: October 26, 2026\nYour subscription renewed.\nTotal charged: USD 15.49/month.\n\nThank you for your payment.", "email.txt");
  assert.equal(email.from, "Netflix <info@account.netflix.com>");
  assert.equal(email.subject, "Your monthly subscription receipt");
  assert.match(email.body, /Total charged: USD 15.49/);
  const [subscription] = detectSubscriptions([email], now);
  assert.equal(subscription.name, "Netflix");
  assert.equal(subscription.status, "likely_active");
});

test("excludes newsletters, promotional trials, and one-time orders with marketing footers", () => {
  const emails = [
    message({ subject: "Your weekly newsletter", body: "Thank you for your subscription. Unsubscribe here. USD 25/month offer available." }),
    message({ subject: "Start your free trial today", body: "Your subscription could be USD 15/month. Trial starts when you join." }),
    message({ subject: "Your order receipt", body: "Your order total is USD 49.00. Subscribe to our monthly newsletter. Receipt attached. Subscription offers available." }),
  ];
  assert.deepEqual(detectSubscriptions(emails, now), []);
});

test("latest cancellation supersedes receipts and later renewal restores likely active", () => {
  const cancelled = message({ id: "cancel", subject: "Your subscription has been canceled", date: "2026-10-27T12:00:00Z", body: "Cancellation confirmation. Your subscription has been canceled and will not renew." });
  const [subscription] = detectSubscriptions([message(), cancelled, { ...message(), id: "same-email-duplicate" }], now);
  assert.equal(subscription.status, "cancelled");
  assert.equal(subscription.evidence.length, 2);
  assert.equal(subscription.amount, 12);
  assert.equal(subscription.nextBilling, null);
  assert.equal(monthlyCost(subscription), null);
  const [resumed] = detectSubscriptions([message(), cancelled, message({ id: "renew", date: "2026-10-28T10:00:00Z" })], now);
  assert.equal(resumed.status, "likely_active");
  assert.equal(resumed.confidence, "high");
});

test("deduplicates the same receipt across CRLF and wrapped export formats", () => {
  const receipt = message({ body: "Your subscription renewed.\r\nTotal charged: USD 12.00/month." });
  const equivalent = { ...receipt, id: "other-export", body: "Your subscription renewed.\nTotal charged: USD 12.00/month." };
  const [subscription] = detectSubscriptions([receipt, equivalent], now);
  assert.equal(subscription.evidence.length, 1);
  assert.equal(subscription.confidence, "medium");
});

test("keeps currencies and mailbox accounts separate without double counting duplicate exports", () => {
  const [usd, eur, secondAccount] = [
    message(),
    message({ id: "eur", body: "Your subscription renewed. Total charged: EUR 9,99/month." }),
    message({ id: "other", to: "other@example.com" }),
  ];
  const subscriptions = detectSubscriptions([usd, eur, secondAccount, { ...usd, id: "duplicate-import" }], now);
  assert.equal(subscriptions.length, 3);
  assert.deepEqual(subscriptions.map(item => item.currency).sort(), ["EUR", "USD", "USD"]);
  assert.equal(subscriptions.find(item => item.currency === "EUR")?.amount, 9.99);
  assert.equal(subscriptions.reduce((sum, item) => sum + item.evidence.length, 0), 3);
  assert.equal(subscriptions.filter(item => item.status === "needs_review").length, 2);
  assert.equal(subscriptions.filter(item => monthlyCost(item) !== null).length, 1);
});

test("prefers charged totals over tax and avoids invoice IDs", () => {
  const [subscription] = detectSubscriptions([message({ body: "Subscription invoice #123456789. Monthly plan USD 10.00. Tax: USD 0.80. Total charged: USD 10.80. You saved USD 5.00." })], now);
  assert.equal(subscription.amount, 10.80);
  assert.equal(subscription.interval, "month");
});

test("does not assume missing dates, stale receipts, failed payments, or expired trials are active", () => {
  for (const email of [
    message({ date: "" }),
    message({ date: "2025-01-01" }),
    message({ subject: "Your subscription payment failed", body: "Your monthly subscription payment failed. Unable to charge USD 12.00." }),
    message({ subject: "Your trial has started", body: "Your free trial has started. Trial ends on October 20, 2026. USD 60/year thereafter." }),
  ]) assert.equal(detectSubscriptions([email], now)[0].status, "needs_review");
});

test("Apple receipts identify named service and billing provider", () => {
  const [subscription] = detectSubscriptions([message({ from: "Apple <no_reply@email.apple.com>", subject: "Your Apple receipt", body: "Subscription: Calm\nYour subscription renewed. Total charged: USD 69.99/year." })], now);
  assert.equal(subscription.name, "Calm");
  assert.equal(subscription.billingVia, "apple");
  assert.equal(subscription.domain, "calm.com");
  assert.equal(subscription.interval, "year");
});

test("respects explicit currencies beside dollar symbols and prices with trailing euro symbols", () => {
  const [cad] = detectSubscriptions([message({ body: "Your subscription renewed. Total charged: $14.99 CAD/month." })], now);
  assert.equal(cad.currency, "CAD");
  assert.equal(cad.amount, 14.99);
  const [eur] = detectSubscriptions([message({ body: "Your subscription renewed. Total charged: 12,99 €/month." })], now);
  assert.equal(eur.currency, "EUR");
  assert.equal(eur.amount, 12.99);
});

test("does not turn a negated cancellation into a cancelled subscription", () => {
  const [subscription] = detectSubscriptions([message({ subject: "Your subscription is active", body: "Your subscription has not been canceled. Your monthly payment was received. Total charged: USD 12.00." })], now);
  assert.equal(subscription.status, "likely_active");
});

test("weekly and annual normalization stay in original currency; trials have no current cost", () => {
  const [annual] = detectSubscriptions([message({ body: "Your subscription renewed. Total charged: GBP 120.00/year." })], now);
  assert.equal(monthlyCost(annual), 10);
  const [weekly] = detectSubscriptions([message({ body: "Your subscription renewed. Total charged: USD 3/week." })], now);
  assert.equal(monthlyCost(weekly), 13);
  const [trial] = detectSubscriptions([message({ subject: "Your trial has started", body: "Your free trial has started. Trial ends on November 3, 2026. USD 60/year thereafter." })], now);
  assert.equal(trial.status, "trial");
  assert.equal(monthlyCost(trial), null);
});

test("demo fixture is explicit, deterministic, and exercises eight distinct subscriptions", () => {
  const subscriptions = detectSubscriptions(sampleEmails, DEMO_DATE);
  assert.equal(subscriptions.length, 8);
  assert.equal(subscriptions.filter(item => item.status === "likely_active").length, 5);
  assert.equal(subscriptions.find(item => item.name === "Disney+")?.status, "cancelled");
  assert.equal(subscriptions.find(item => item.name === "Calm")?.status, "trial");
  assert.equal(subscriptions.find(item => item.name === "Dropbox")?.status, "needs_review");
  assert.ok(sampleEmails.every(item => item.body.includes("SAMPLE EMAIL")));
});
