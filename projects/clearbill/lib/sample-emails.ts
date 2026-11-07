import type { EmailMessage } from "./subscriptions";

/** Fictional receipts. Prices and dates illustrate the app; they are not vendor quotes. */
export const DEMO_DATE = new Date("2026-10-28T12:00:00.000Z");
export const DEMO_ACCOUNT = "dad@example.com";

export const sampleEmails: EmailMessage[] = [
  {
    id: "demo-netflix-oct", from: "Netflix <info@account.netflix.com>", to: DEMO_ACCOUNT,
    subject: "Your Netflix monthly subscription receipt", date: "2026-10-26T09:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour Netflix subscription payment was received. Total charged: USD 15.49. Billed monthly. Next billing date: November 26, 2026.",
  },
  {
    id: "demo-netflix-sep", from: "Netflix <info@account.netflix.com>", to: DEMO_ACCOUNT,
    subject: "Your Netflix monthly subscription receipt", date: "2026-09-26T09:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour Netflix subscription payment was received. Total charged: USD 15.49. Billed monthly. Next billing date: October 26, 2026.",
  },
  {
    id: "demo-spotify", from: "Spotify <no-reply@spotify.com>", to: DEMO_ACCOUNT,
    subject: "Spotify Premium — your payment receipt", date: "2026-10-24T11:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour Premium subscription renewed. Total paid: USD 11.99. Monthly plan. Renews on November 24, 2026.",
  },
  {
    id: "demo-icloud", from: "Apple <no_reply@email.apple.com>", to: DEMO_ACCOUNT,
    subject: "Your iCloud+ subscription receipt", date: "2026-10-23T13:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nSubscription: iCloud+\nYour subscription renewed. Total charged: USD 2.99/month. Next payment: November 23, 2026. Billing is managed by Apple.",
  },
  {
    id: "demo-adobe", from: "Adobe <mail@email.adobe.com>", to: DEMO_ACCOUNT,
    subject: "Adobe Creative Cloud subscription renewal", date: "2026-10-20T10:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour subscription renewed. Plan: Creative Cloud. Total charged: USD 59.99. Billed monthly. Next billing date: November 20, 2026. Check your account for any annual commitment or cancellation charge.",
  },
  {
    id: "demo-prime", from: "Amazon <auto-confirm@amazon.com>", to: DEMO_ACCOUNT,
    subject: "Your Amazon Prime membership renewed", date: "2026-08-15T10:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour Amazon Prime membership renewed. Total paid: USD 139.00. Annual membership. Renewal date: August 15, 2027.",
  },
  {
    id: "demo-calm", from: "Calm <support@calm.com>", to: DEMO_ACCOUNT,
    subject: "Your Calm free trial has started", date: "2026-10-27T15:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour free trial has started. Trial ends on November 3, 2026. After the trial, your subscription is USD 69.99/year unless you cancel. No payment has been taken today.",
  },
  {
    id: "demo-disney-old", from: "Disney+ <disneyplus@mail.disneyplus.com>", to: DEMO_ACCOUNT,
    subject: "Disney+ monthly subscription receipt", date: "2026-10-04T09:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour Disney+ subscription payment was received. Total charged: USD 10.99/month.",
  },
  {
    id: "demo-disney-cancelled", from: "Disney+ <disneyplus@mail.disneyplus.com>", to: DEMO_ACCOUNT,
    subject: "Your Disney+ subscription has been cancelled", date: "2026-10-22T09:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account.\nCancellation confirmation: your subscription has been cancelled. You can continue watching until November 4, 2026. Your subscription will not renew.",
  },
  {
    id: "demo-dropbox", from: "Dropbox <no-reply@dropbox.com>", to: DEMO_ACCOUNT,
    subject: "Your Dropbox annual subscription receipt", date: "2024-06-01T09:00:00.000Z",
    body: "SAMPLE EMAIL — fictional account and illustrative price.\nYour subscription renewed. Total charged: USD 119.88. Billed annually. Next billing date: June 1, 2025. This old receipt does not establish whether the account is still active.",
  },
  {
    id: "demo-one-time-order", from: "Amazon <auto-confirm@amazon.com>", to: DEMO_ACCOUNT,
    subject: "Your order of a desk lamp has shipped", date: "2026-10-27T18:00:00.000Z",
    body: "SAMPLE EMAIL — fictional purchase.\nOrder #113-1234567-1234567. Total: USD 24.99. This is a one-time purchase. Explore our subscription offers and unsubscribe from marketing in your preferences.",
  },
];

/** Alternative spelling kept explicit for callers importing the sample fixture. */
export const SAMPLE_EMAILS = sampleEmails;
