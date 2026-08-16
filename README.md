# Wayfinder — Relocation Decision Studio

Wayfinder is an open-source, local-first dashboard for deciding whether a move,
job offer, or household-income change is financially worthwhile. It compares
every option with the same fields and formulas while keeping the user's data in
their browser.

It is built for two equally supported workflows:

- **Manual:** define the comparison model once, then fill each option.
- **Agentic:** give an agent the versioned template and JSON Schema, validate
  the completed document, preview it, and import it atomically.

The repository contains no household defaults. A clean browser opens empty.

## What makes the comparison auditable

- One user-selected base currency and an explicit, dated FX rate per option.
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

All calculations are monthly and converted to the document's base currency:

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

1. Choose **Set up manually**.
2. Select the base currency, review the standard fields, and enter shared
   commitments and investment targets once.
3. Enter the current situation, including gross, deductions, automatic
   investments, local costs, FX evidence, and qualitative assumptions.
4. Add or duplicate alternatives. Expanding a tile reveals the exact split.

### Agent setup

1. Give the agent [`examples/wayfinder.template.json`](examples/wayfinder.template.json),
   [`schemas/wayfinder-document.v4.schema.json`](schemas/wayfinder-document.v4.schema.json),
   and [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md).
2. Ask it to use official/primary sources, mark estimates, and fill every
   standard field with zero where it does not apply.
3. Validate the result:

   ```bash
   npm run validate:data -- path/to/wayfinder-document.json
   ```

4. Import it. Wayfinder validates the entire document and shows a summary before
   any existing browser data is replaced.

The browser export and agent document are the same format. There is no hidden
agent API or alternate data model.

## Standard contract files

- [JSON Schema](schemas/wayfinder-document.v4.schema.json)
- [Fictional worked example](examples/wayfinder.example.json)
- [Empty agent template](examples/wayfinder.template.json)
- [Agent workflow](docs/AGENT-WORKFLOW.md)
- [Research methodology](docs/RESEARCH-METHODOLOGY.md)
- [Official-source directory](docs/OFFICIAL-SOURCE-DIRECTORY.md)
- [Country research packs](docs/COUNTRY-RESEARCH-PACKS.md)
- [Relocation decision checklist](docs/RELOCATION-DECISION-CHECKLIST.md)
- [Product roadmap](docs/ROADMAP.md)
- [Asset provenance](docs/ASSETS.md)
- [Privacy model](PRIVACY.md)

`npm run validate:data -- <document.json>` first checks a v4 document against
the maintained Draft 2020-12 JSON Schema, then applies semantic rules that are
awkward to express in JSON Schema, including field references, scope,
base-currency FX, gross reconciliation, and research applicability. Supported
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
- **Editable document:** the complete versioned JSON source of truth.
- **Agent template:** an empty document with the standard field model.

These files can contain sensitive financial data. The user chooses when and
with whom to share them. GitHub hosts only the application code, schema,
documentation, and fictional examples—never browser data.

## Verify

```bash
npm run validate:examples
npm test
npm run lint
npm run build
```

`npm test` includes type checking, a production build, financial invariants,
schema/semantic CLI and migration/import tests, rendered privacy checks, report
hardening, and Python-backed portable port-resolution tests.

## Project structure

```text
app/           document types, validation, math, UI, and family report
docs/          architecture, calculations, agent and research guidance
examples/      fictional and blank v4 documents
schemas/       public JSON Schema
scripts/       portable launcher and document validator
tests/         calculation, contract, rendering, report, and port tests
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
