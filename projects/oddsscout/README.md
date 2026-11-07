# OddsScout 9

Sports odds comparison, research, calendar, and a self-reported bet ledger.

## Status

Version 9 source snapshot. Private-entry configuration is required and missing values fail closed. External odds, context, AI, account, and database features require independent setup. It does not place wagers, move funds, or validate sportsbook results. No hosted/provider success is claimed.

## Stack

Browser JavaScript modules, Node.js 22.12+, Netlify Functions and Edge Functions; optional Identity/database/provider integrations.

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

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Original configuration variable names include: `ODDS_API_KEY`, `ODDS_REGIONS`, `ODDS_BOOKMAKERS`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `ACCESS_CODE`, `ENTRY_SESSION_SECRET`, `FORM_PROVIDER`, `BALLDONTLIE_API_KEY`, `ACCOUNTS_PROVIDER`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
