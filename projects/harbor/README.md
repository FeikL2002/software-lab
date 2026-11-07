# Harbor — Sites/Cloudflare source

An account and merchant dashboard for reusable payment links, checkout, and separate test/live earnings records.

## Status

Source archive of the Sites/Cloudflare version. Framework startup depends on omitted Sites build adapters and hosting configuration. Restore a suitable secure adapter and private Stripe/database configuration before serving. No financial records, merchant accounts, migration payloads, credentials, or proof of checkout/payout readiness are included. The sibling harbor-netlify project is an unfinished migration, not a replacement verified here.

## Stack

React/TypeScript, Vinext, Cloudflare Workers/D1, Stripe; Node.js 22.13+.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
npm ci
npm run dev
```

## Checks

`npm test`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Original configuration variable names include: `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_WEBHOOK_SECRET`, `STRIPE_API_VERSION`, `HARBOR_LIVE_ENABLED`, `HARBOR_PUBLIC_CHECKOUT_ENABLED`, `HARBOR_LIVE_APPROVED`, `HARBOR_LIVE_PAYMENT_PERCENT_BPS`, `HARBOR_LIVE_PAYMENT_FIXED_CENTS`. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
