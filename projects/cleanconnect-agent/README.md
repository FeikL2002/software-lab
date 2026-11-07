# CleanConnect Agent

A Python CLI that generates cleaning-business marketing and outreach drafts for human review.

## Status

Prepared CLI source; no provider requests were made during staging. Actual generation requires a privately configured OPENAI_API_KEY and an available model. Leads and generated marketing/customer files are omitted. Drafting does not publish or send outreach.

## Stack

Python 3 and the OpenAI Python SDK.

## Local startup

Run these commands from this project directory. Read the status above first; source archives with omitted hosting adapters require restoration before these framework commands can succeed.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python cleanconnect_agent.py --help
```

## Checks

`See the tests/ directory where present; no complete test suite was run as part of archival staging.`

Actual staging check results are recorded in [../../VALIDATION.md](../../VALIDATION.md). No hosted deployment, external provider request, camera capture, email access, or payment was performed by the staging process.

## Configuration and data

Dependencies, private environment files, credentials, hosting identities, runtime state, account records, captured output, and customer data are excluded. Configure credentials privately. Original configuration variable names include: `OPENAI_API_KEY`, `OPENAI_MODEL`. Existing first-party source may still call documented external service endpoints when a user runs it. Personal deployment URLs in the copied source were replaced with `https://example.invalid`.

## Source and rights

This is a source snapshot collected on November 6, 2026. No new license grant is made. No root project license was present in the source root. Third-party dependency licenses remain applicable; retained font license files accompany their font assets. See [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
