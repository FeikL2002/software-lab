# Harbor — unfinished Netlify migration

A separate private email/password implementation of Harbor using Netlify Functions and Postgres.

## Status

Unfinished migration source. Original documentation reported unavailable hosted functions and no production publication; this staging task did not recheck hosting. The encrypted record bundle and record-seeding migration are omitted. Private auth, database schema, payment/webhook configuration and deployment need independent verification. No account/financial records or functioning payment service is promised.

## Stack

Browser JavaScript, Node.js, Netlify Functions/Database, Stripe.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
npm ci
npm run build
npm run dev
```

## Checks

`npm test`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Original configuration variable names include: `HARBOR_ALLOWED_EMAILS`, `HARBOR_INVITE_CODE_HASH`, `HARBOR_OWNER_EMAIL`, `HARBOR_OWNER_MERCHANT_ID`, `HARBOR_MIGRATION_KEY`. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
