# Add European Portuguese (pt-PT) localization

## Summary

Add all 724 English-source keys in natural European Portuguese and register Português (Portugal) in the language picker. Preserve interpolation variables, single-brace settings markers, line breaks and singular/plural variants. Use bebé, biberão, fralda, comprimento, perímetro cefálico, palavra-passe and guardar consistently.

Retain the separate regional-detection commit e025cb9. Match pt-PT case-insensitively, preserve browser preference order and stored selections, and keep English fallback. Update its test to use the real dictionary rather than temporarily replacing and deleting it.

Route remaining date/time calls in the gallery, picture frame, growth, journal, overview and settings through the selected display locale. Localize decimal durations and overview temperatures; use Portuguese age units on WHO chart ticks. Machine-readable dates, numeric form values, API enums and stored measurements retain their original formats.

## Validation

- Frontend: `npm test --prefix frontend` — 202 tests passed in 16 files.
- Frontend: `npm run build --prefix frontend` — passed.
- Backend: `go vet ./...` — passed.
- Backend: `go test -race ./...` — passed. Database-dependent integration tests skip without TEST_DATABASE_URL; no PostgreSQL integration instance was configured.
- Translation coverage, empty values, interpolation parity, single-brace markers, line breaks, plural pairs, registration, detection, storage/remount and English/key fallback are covered by tests.
- Portuguese date/time and decimal formatting are covered by tests.
- Browser smoke check (agent-browser): Portuguese login labels rendered correctly and remained Portuguese after reload with the stored pt-PT locale. The API backend was unavailable (502); attempts to enable demo mode via request stubs and browser-only module imports failed. The actual settings picker, dashboard navigation, forms, charts, responsive layout and picture-frame presentation were therefore not manually verified. Provider selection/persistence is covered by automated tests.

## Scope and maintainer decisions

- pt-BR and bare pt intentionally retain English fallback: no generic Portuguese dictionary exists. Should bare pt resolve to pt-PT in a follow-up? This change avoids silently treating Brazilian Portuguese as European Portuguese.
- Existing `_one`/`_other` selection remains in place; no new plural engine is introduced.
- Existing administration UI still has hardcoded English in SettingsModal (server/TLS and DNS configuration, software updates, display control and some error messages), plus error/API messages and demo content elsewhere. These require new shared keys across all locales and are outside this dictionary contribution.
- Some numeric values, generic chart ticks/tooltips, file sizes and measurement summaries still use raw values or toFixed. Decimal durations and overview temperatures are localized here; a comprehensive number-formatting pass should distinguish display values from numeric inputs and chart data.
- Native date/number input presentation and validation messages follow the browser/OS locale. Stored data and API formats are deliberately unchanged.
- Nara's Activity and Export Data labels remain in their original spelling to identify controls in the external app; product names, protocols and technical identifiers remain unchanged.

## Local history

1. e025cb9 — Support regional language detection.
2. Add complete European Portuguese localization (this contribution).

No push, fork or pull request has been created.
