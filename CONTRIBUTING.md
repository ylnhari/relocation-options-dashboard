# Contributing

Thanks for improving Wayfinder. It is a local-first comparison tool, not financial, legal, tax, immigration, or investment advice.

## Ground rules

- Never add real household records, exports, credentials, or copied private research to the repository, tests, fixtures, issues, or screenshots.
- Use only fictional or aggregate test data. Keep `DEFAULT_SCENARIOS` empty.
- Preserve the semantic distinctions documented in [Calculations](docs/CALCULATIONS.md). In particular, investments are savings and external help is excluded from the baseline.
- Keep the application local-first. Do not introduce network persistence, tracking, or account requirements without an explicit, separately reviewed decision.
- Do not add an opaque recommendation score. Comparisons must remain traceable to recorded inputs, calculations, evidence, and research.

## Before proposing a change

1. Read [Architecture](docs/ARCHITECTURE.md) and the canonical v4 schema at `schemas/wayfinder-document.v4.schema.json`.
2. Make small, focused changes. Preserve validation, import preview, accessibility, and readable labels.
3. Add or update aggregate/fake tests where behavior changes.
4. Run `npm test` and `npm run lint`.
5. Validate each public example with `node scripts/validate-data.mjs examples/<file>.json`.

Explain any change to the document format, calculations, migration, or privacy posture in the pull request. Format or behavior changes to a saved document require migration and backwards-compatibility review.

## Pull requests

Describe the user-visible effect, the data-model effect, validation performed, and any known limitations. Do not commit or publish a user-created export. Security reports belong in the process in [SECURITY.md](SECURITY.md), not in a public issue.
