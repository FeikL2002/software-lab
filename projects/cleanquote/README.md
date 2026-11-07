# CleanQuote

A browser quote calculator and actual-job cost comparison, with a separate optional payment and delivery server.

## Status

Prepared local preview. Payment operations need private server configuration, a delivery archive, persistent storage, and independent Stripe verification. No production payment or delivery readiness is claimed. The npm packaging script points to an unavailable packaging file.

## Stack

Browser JavaScript; dependency-free Node.js 24+ backend.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
node server.mjs
```

## Checks

`npm test`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

The `dist/` directory is retained because it contains the original editable application source, rather than a disposable bundle.
