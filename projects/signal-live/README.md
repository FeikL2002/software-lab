# SIGNAL LIVE

A livestream site with a player, studio, chat, share controls, and a local camera preview.

## Status

Source snapshot from the main working tree. Real broadcasting requires a configured Mux account, server credentials, deployed backend, and an encoder. Browser camera preview alone does not broadcast. Hosted endpoints have been replaced with placeholders.

## Stack

React, Vite, Netlify Functions/Blobs, optional Mux; Node.js 22.12+.

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

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Original configuration variable names include: `STREAM_PROVIDER`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_LIVE_STREAM_ID`, `MUX_PLAYBACK_ID`, `ADMIN_SECRET`, `SESSION_SECRET`, `SITE_URL`. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
