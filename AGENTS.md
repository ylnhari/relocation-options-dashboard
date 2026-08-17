# Wayfinder agent instructions

## Product contract

Wayfinder is an open-source, local-first relocation decision studio. A clean
clone starts without household figures. Manual entry and agent-authored JSON
are equal first-class input paths.

The versioned Wayfinder document is the single source of truth:

- types and neutral starter fields: `app/scenarios.ts`;
- validation, migration, and field synchronization: `app/document.ts`;
- derived calculations and projections: `app/scenario-math.ts`;
- browser UI and import preview: `app/page.tsx`;
- standalone read-only report: `app/share-report.ts`;
- public contract: `schemas/wayfinder-document.v4.schema.json`;
- fictional examples: `examples/`;
- CLI validation: `scripts/validate-data.mjs`.

Do not add a second calculation path or a private data format.

A clean browser must be able to recreate every user-authored value visible on a
populated dashboard through the UI. An agent must be able to create the same
canonical document through the public template, schema, validator, and runtime
starter. Product labels and neutral starter categories/placeholders may be built
in; personal figures, user-specific assumptions, findings, sources, and option
facts may not be.

## Financial invariants

- Common field definitions are edited once. Per-option fields appear in every
  option; shared fields have one base-currency value applied to every option.
- Gross compensation is explicit. Non-saving deductions and automatic payroll
  investments reconcile gross to net cash.
- Automatic payroll investments and planned post-tax investments are savings,
  never expenses.
- `total saving = total investments + cash remaining` for every option,
  including negative-cash cases.
- Incoming External Help / Family Support may be recorded for context but must
  never change income, expenses, savings, charts, or rankings.
- Qualitative research and career/visa/lifestyle notes never become arbitrary
  certainty or quality scores.
- Derived values are recomputed locally and are rejected if supplied as trusted
  agent inputs.
- Every option in a currency other than the comparison currency requires an
  explicit positive conversion ratio, date, and source. Missing linked values,
  evidence, or conversion inputs invalidate the whole option/document before it
  can be saved or displayed.

## Agentic-first workflow

- Agents create or update the same document exported by the browser.
- Validate agent output against both the JSON Schema and the semantic parser
  before import. Never silently coerce invalid or missing money values.
- Every high-impact estimate should include status, source, and as-of metadata.
- Research records should prefer official or primary sources, include a dated
  finding, and identify the options they affect.
- Import remains atomic. Show validation issues and a preview before replacing
  browser data. Do not invent partial merge behavior without deterministic,
  tested conflict rules.

## Privacy and public-repository boundary

- Never add payslips, transaction records, names, account details, credentials,
  real household figures, private URLs, browser exports, or machine paths to
  tracked files, examples, tests, screenshots, logs, or documentation.
- Personal/runtime documents belong only in ignored paths such as
  `private-data/`; `.gitignore` is not a substitute for inspecting the staged
  tree and unpublished history before a public push.
- Browser data stays on the device. Do not add analytics, telemetry, cloud
  persistence, authentication, or automatic research fetching.
- The family report must remain escaped, script-free, self-contained, and
  protected by a restrictive Content Security Policy. Source links may use
  explicit safe HTTPS anchors; nothing loads automatically.

## Repository portability

- Use repository-relative paths. Keep optional ports and machine settings in
  ignored environment/local overlays.
- The app binds to `127.0.0.1`. `scripts/dev.py` resolves an explicit port,
  `WAYFINDER_PORT`, an optional generic `ports.json`, then fallback `8780`.
- Never scan for a free port or silently change ports.
- Keep `.openai/hosting.json` D1/R2 bindings `null`; Wayfinder does not need a
  database or object storage.
- `CLAUDE.md` remains the one-line adapter `@AGENTS.md`.

## Quality and release gates

- Run `npm run validate:examples`, `npm test`, `npm run lint`,
  `npm run test:e2e`, and `git diff --check` after material changes.
- Preserve keyboard access, focus visibility, reduced-motion behavior,
  responsive layouts, readable contrast, empty/error states, and safe import
  confirmation.
- Test only fictional or aggregate values.
- Before a public push, scan the entire candidate tree and all unpublished
  history for credentials, identifiers, absolute paths, private infrastructure,
  and real financial values. Require a clean-context review of the exact tree.
- Do not commit, push, publish, deploy, or change repository visibility without
  explicit user authorization.
