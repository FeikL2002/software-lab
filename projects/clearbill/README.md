# Clearbill

Identifies subscription clues in imported billing messages and supports an optional Gmail connection and cancellation checklist.

## Status

Source archive. Existing framework commands depend on Sites runtime adapters/configuration omitted from this archive; they are reference commands, not a verified portable startup. Recreate the hosting adapter and private OAuth configuration before launch. No imported mailbox data or OAuth tokens are included. Cancellation is a checklist, not an automatic account cancellation service.

## Stack

React/TypeScript, Vinext, Cloudflare Workers/D1; Node.js 22.13+.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
npm ci
npm run dev
```

## Checks

`See the tests/ directory where present; no complete test suite was run as part of archival staging.`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Original configuration variable names include: `APP_ORIGIN`, `MAIL_SESSION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
