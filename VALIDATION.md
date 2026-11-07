# Validation — November 6, 2026

The checks below were performed on the staged copies using Node.js v24.11.0 and Python. They do not validate hosted deployments, production integrations, physical device behavior, payments, email access, or data delivery.

## Parsing

All 225 staged `.js`, `.mjs`, and `.py` files passed parsing: JavaScript through `node --check`, Python through `ast.parse`. JSX, TSX, and TypeScript were not typechecked; dependency trees were intentionally not installed.

## Selected isolated unit checks

The passing subsets below contain **178 passing tests**, zero failures, and zero skipped tests. These are selected subsets, not a claim that every project’s full suite passes. Tests used an environment with secret-related variables removed and a default fetch guard; tests may replace fetch with their own mocks. No application server was launched.

| Project | Passing tests | Command |
| --- | ---: | --- |
| cleanquote | 9 | `node --test --test-reporter=tap tests/engine.test.mjs` |
| signal-live | 3 | `node --test --test-reporter=tap tests/chat.test.mjs` |
| oddsscout | 122 | `node --test --test-reporter=tap tests/odds.test.mjs tests/parlay.test.mjs tests/bets.test.mjs tests/calendar.test.mjs tests/analytics-integrity.test.mjs` |
| harbor | 5 | `node --test --test-reporter=tap tests/money.test.mjs` |
| harbor-netlify | 5 | `node --test --test-reporter=tap tests/money.test.mjs` |
| joes-lotto | 27 | `node --test --test-reporter=tap tests/ticket-text-reader.test.mjs tests/remembered-games.test.mjs tests/draw-ticket.test.mjs` |
| snail-grove | 7 | `node --test --test-reporter=tap engine.test.mjs` |

## Known check limitations

- SIGNAL LIVE backend tests could not load `@netlify/blobs` because dependencies are not installed. Its separate chat unit suite passed.
- Joe’s Lotto ticket-recognition and ticket-text-match tests could not load the deliberately omitted `dist/data/ohio-games.json` cached public dataset. The text-reader, remembered-games, and draw-ticket subsets passed.
- Clearbill, the six customized Sites product prototypes, framework builds, provider-backed checks, browser QA, payment/auth integration suites, OCR vendor integration, and physical camera flows were not run.
- Harbor/Clearbill and the six Sites prototypes retain application source but need omitted Sites runtime adapters/private hosting configuration restored. Some preserved framework configuration references those missing files; this is an explicit source-archive limitation.
- Harbor Netlify remains an unfinished migration. An encrypted migration bundle and a record-seeding SQL file were excluded. Only schema migrations were retained.

## Content checks

The staged tree was scanned for private filesystem paths, personal mailbox addresses, owner hosting endpoints, common API/private-key shapes, runtime databases, environment files, logs, captures, and nested dependency/Git trees. No matching private paths, personal mailbox addresses, owner deployment hostnames or credential-shaped strings remained after sanitization. Credential-like literals in tests are synthetic fixtures. This scan is a bounded automated check, not a guarantee that every possible secret format is detectable.

Personal deployment links were replaced with example.invalid, and the Underground Coins hardcoded Stripe checkout link was replaced with an inert placeholder. Private environment values, hosting metadata, lead/customer/mail/ticket records, cached feed data and provider snapshots were omitted. Existing source can contact documented external providers when deliberately run with appropriate configuration.

## Rights

No project license was added. Existing font notices were retained. Third-party dependencies and remotely referenced media remain subject to upstream terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Privacy scan review

The SIGNAL LIVE HTTP request/error utility received five person-name substring matches within its `AdminApiError` identifier. They are false positives crossing the `Api`/`Error` words; the file contains no person/customer mock records or email addresses. The original export, error name, and constructor uses were preserved. Its staged contents are byte-identical to the original source. The file passed `node --check`, four isolated mocked request/error checks passed, and the three existing chat unit tests passed again during this review. No provider requests were made.
