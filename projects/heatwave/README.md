# HEATWAVE Camera Lab

A browser-local camera and photo brightness-to-color visual effect.

## Status

Static source snapshot. It simulates thermal-style colors from visible light; it does not measure temperature, body energy, or see through walls. Camera/photo processing stays in the browser. No physical camera behavior was tested during staging.

## Stack

Plain JavaScript, HTML, CSS; camera requires browser permission and a secure context or localhost.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

## Checks

`See the tests/ directory where present; no complete test suite was run as part of archival staging.`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

The `dist/` directory is retained because it contains the original editable application source, rather than a disposable bundle.
