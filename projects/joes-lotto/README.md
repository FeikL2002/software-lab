# Joe’s Lotto

A personal ticket companion with barcode/text entry, local ticket records, public draw-result helpers, and potential match review.

## Status

Source snapshot. The local static command serves the UI; API features require Netlify setup. Cached public feed datasets, ticket records, OCR vendor bundles, and captured output are omitted. OCR and offline feed fallbacks therefore need separate restoration. Potential matches do not validate a prize. No lottery purchases or user ticket data are included.

## Stack

Browser JavaScript, Node.js build/tests, Netlify Functions.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

## Checks

`npm test`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

The `dist/` directory is retained because it contains the original editable application source, rather than a disposable bundle.
