# Wayfinder — Relocation Decision Studio

Wayfinder is an open-source, local-first dashboard for deciding whether a move,
job offer, or household-income change is financially worthwhile. It compares
every option with the same fields and formulas while keeping the user's data in
their browser.

It is built for two equally supported workflows:

- **Manual:** enter shared settings once, then fill the current situation and each alternative.
- **Agentic:** give an agent the versioned template and JSON Schema, validate
  the completed document, preview it, and import it atomically.

The repository contains no household defaults. A clean browser opens empty.

## What makes the comparison auditable

- One user-selected comparison currency and an explicit, dated conversion ratio per option.
- Gross compensation visible on every tile.
- Itemized non-saving deductions, automatic payroll investments, living costs,
  continuing commitments, and planned investments.
- Common field definitions managed once instead of being hard-coded inside
  every option.
- Shared commitments and shared investment targets entered once in the base
  currency and applied equally to every option.
- Expandable tiles that show every line item, source status, and subtotal.
- A strict visual and mathematical hierarchy:

  ```text
  total saving
  ├─ total investments
  └─ cash remaining
  ```

- Five-year charts with an explicit selector and legend for gross compensation,
  net cash, total saving, investments, or cash remaining.
- Structured, dated research records for tax, immigration, housing, childcare,
  transport, healthcare, weather, careers, and family travel.
- No arbitrary career, certainty, or lifestyle scores.

## Financial model

All calculations are monthly and converted to the chosen comparison currency:

```text
net cash = gross − non-saving deductions − automatic investments

total saving = automatic investments
             + net cash
             − living costs
             − continuing commitments

total investments = automatic investments + planned post-tax investments
cash remaining = total saving − total investments
```

Investments are savings, not expenses. Incoming External Help / Family Support
can be recorded as excluded context but never changes a total, chart, or rank.

See [calculation details](docs/CALCULATIONS.md) and the
[architecture](docs/ARCHITECTURE.md).

Version 0.1 models recurring monthly steady-state scenarios. Transition dates,
one-time relocation cash flows, and uncertainty ranges are preserved as
explicit future work in the [product roadmap](docs/ROADMAP.md); until then,
represent materially different phases as separate scenarios and document the
transition assumptions.

## Quick start

Requirements: Node.js 22.13 or newer and npm. Python 3 is optional for the
portable launcher, but required by the portable port-resolution tests in
`npm test`.

```bash
npm ci
npm run dev -- --port 8780
```

Open `http://127.0.0.1:8780`.

Portable launcher:

```bash
python scripts/dev.py --port 8780
```

On Windows, `./start.ps1` calls the same launcher. Without `--port`, the
launcher checks `WAYFINDER_PORT`, an optional generic `ports.json`, then uses
the clone-safe fallback `8780`. It binds to loopback and never scans for a
different port.

### Optional Windows runtime starter comparison

To open one local running instance with an already-validated v4 document:

```bash
python scripts/dev.py --document path/to/wayfinder-document.json
```

This launcher feature is available on Windows only. On macOS and Linux, use the
browser's **Import complete comparison** flow instead; browser import works on
every supported platform. `WAYFINDER_DOCUMENT=path/to/wayfinder-document.json` is the equivalent when
the flag is omitted; `--document` wins when both are present. The launcher
copies the exact bounded input into an ignored local runtime artifact, validates
it with the same schema and semantic path as imports, and enables it only for
that child development process. Production builds and previews ignore seed
control variables, so a starter comparison cannot be compiled into public assets.
A normal `npm run dev`, `npm run build`, `npm start`, or launcher run without a
document remains empty.

The seed is delivered to every browser that can reach that running instance.
Use it only on loopback or behind a trusted authenticated gateway. A valid
saved browser plan always wins; otherwise the starter is saved to that browser
through the normal guarded local-storage path, and later edits remain there.
Each launcher owns and cleans up only its own opaque ignored seed artifact, so
concurrent or unseeded starts do not delete another running instance's file. A
per-seed process lease lets a later launcher reclaim an artifact left by a
crashed process without touching a live owner.

On Windows, the seeded launcher also establishes kill-on-close process-tree
containment before it creates the artifact and records the launcher's process
creation identity to distinguish PID reuse. If containment is unavailable, the
seeded start fails closed; manual browser import remains available.

### Optional public metadata origin

Hosted deployments may set the public, non-secret `WAYFINDER_PUBLIC_ORIGIN`
environment variable (see [`.env.example`](.env.example)) to an `http` or
`https` origin such as `https://wayfinder.example`. It must contain no
credentials, path, query, or fragment. When valid, Wayfinder uses the
normalized origin only to emit absolute `/og.png` Open Graph and Twitter image
metadata. When it is absent or invalid, those absolute image URLs are omitted;
request `Host` and forwarded-host headers are never used.

## First run

### Manual setup

1. Choose **Enter my details**.
2. Select the comparison currency, review the standard fields, and enter every
   assumption, source, and dynamic value yourself. The clean start has no
   option or household data. Shared amounts also start blank; type the value or
   explicitly apply **Use 0** before saving.
3. Enter the current situation, including gross, deductions, automatic
   investments, local costs, field evidence, and qualitative assumptions. New
   option amounts start blank. Type the amount, type `0`, or use the section's
   explicit **Use 0** action; untouched zeroes cannot be saved as facts.
4. Add or duplicate alternatives. Expanding a tile reveals the exact split.
   For every non-comparison-currency option, supply its currency, a positive
   conversion ratio to the comparison currency, an as-of date, and a source.
   A missing linked option field or any of those conversion fields rejects the complete
   option/document rather than creating a partial comparison.

If an older browser-saved migration predates conversion dates, Wayfinder keeps
that option locally but excludes it from cards, totals, charts, rankings, and
family views until the user supplies both a date and a real source. Editable
exports are also blocked until that repair is complete, because an incomplete
file would fail strict re-import. New files, agent output, the CLI, and normal
imports remain strict.

### Agent setup

1. Give the agent [`examples/wayfinder.template.json`](examples/wayfinder.template.json),
   [`schemas/wayfinder-document.v4.schema.json`](schemas/wayfinder-document.v4.schema.json),
   and [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md).
2. Give it only user-authorized inputs; ask it to use official/primary sources,
   mark estimates, and fill every standard field with zero only where that is
   the user's intentional placeholder. The agent must author the same canonical
   v4 document the browser exports, not a separate agent format. The blank
   template's 0% growth, 0% inflation, and one-year period are neutral structural
   placeholders, not forecasts; replace them with the user's choices.
3. Validate the result:

   ```bash
   npm run validate:data -- path/to/wayfinder-document.json
   ```

4. Import it. Wayfinder validates the entire document and shows a summary before
   any existing browser data is replaced.

The browser export and an agent-completed comparison use the same canonical v4
format. Export, clear, import, and export again must be equal after replacing
only `updatedAt` with a fixed token and normalizing JSON keys; calculated totals
and projections are never editable file fields. There is no hidden agent API or
alternate calculation path.

## Standard contract files

- [JSON Schema](schemas/wayfinder-document.v4.schema.json)
- [Fictional worked example](examples/wayfinder.example.json)
- [Empty comparison template](examples/wayfinder.template.json)
- [Agent workflow](docs/AGENT-WORKFLOW.md)
- [Research methodology](docs/RESEARCH-METHODOLOGY.md)
- [Official-source directory](docs/OFFICIAL-SOURCE-DIRECTORY.md)
- [Country research packs](docs/COUNTRY-RESEARCH-PACKS.md)
- [Relocation decision checklist](docs/RELOCATION-DECISION-CHECKLIST.md)
- [Manual UI acceptance](docs/MANUAL-UI-ACCEPTANCE.md)
- [Product roadmap](docs/ROADMAP.md)
- [Asset provenance](docs/ASSETS.md)
- [Privacy model](PRIVACY.md)

`npm run validate:data -- <document.json>` first checks a v4 document against
the maintained Draft 2020-12 JSON Schema, then applies semantic rules that are
awkward to express in JSON Schema, including field references, scope,
comparison-currency conversion details, gross reconciliation, and research applicability. Supported
legacy documents are migrated to v4 before their resulting document is checked
against the schema. CLI JSON output reports a safe relative path or basename,
never an absolute machine path.

The browser and CLI execute a committed static validator generated from the
canonical schema. After changing the schema, run
`npm run generate:schema-validator`; `npm run validate:examples` also performs a
byte-for-byte drift check so an outdated generated validator cannot pass CI.

## Share and back up

- **Family view:** a self-contained, read-only HTML report with calculations,
  breakdowns, evidence, research, and assumptions.
- **Editable comparison file:** the complete versioned JSON containing shared
  settings, the current situation, every alternative, assumptions, evidence,
  and sources.
- **Blank comparison template:** an empty JSON file with the standard fields.

These files can contain sensitive financial data. The user chooses when and
with whom to share them. GitHub hosts only the application code, schema,
documentation, and fictional examples—never browser data.

## Verify

```bash
npm run validate:examples
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` includes type checking, a production build, financial invariants,
schema/semantic CLI and migration/import tests, rendered privacy checks, report
hardening, and Python-backed portable port-resolution tests.
`npm run test:e2e` starts a separate loopback-only test server and proves a
fictional comparison can be built from an empty browser, exported, validated,
cleared, restored, and protected from an invalid replacement. It never reuses
an existing server; set `WAYFINDER_E2E_PORT` when the default isolated test port
`8792` is already assigned on your machine.

## Project structure

```text
app/           document types, validation, math, UI, and family report
docs/          architecture, calculations, agent and research guidance
examples/      fictional and blank v4 documents
schemas/       public JSON Schema
scripts/       portable launcher and document validator
tests/         calculation, contract, rendering, browser, report, and port tests
worker/        stateless application worker entry point
```

Wayfinder uses browser storage only. It has no analytics, authentication,
database, object storage, or automatic web research. A static/stateless hosted
copy still keeps each visitor's data in that visitor's browser.

The official-source directory is a reusable starting point, not a live legal or
market database. Agents and users must open the exact official page, record its
as-of date and conditions, and refresh consequential findings before acting.

## Limitations

Wayfinder is a planning tool, not tax, immigration, legal, investment, or
employment advice. Projections do not forecast future tax rules, exchange
rates, investment returns, bonuses, or job changes. Inputs are only as reliable
as their recorded sources and as-of dates. The current financial engine models
recurring steady-state months; it does not yet natively schedule one-time costs
or household phases on a timeline.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Wayfinder
is available under the [MIT License](LICENSE).
