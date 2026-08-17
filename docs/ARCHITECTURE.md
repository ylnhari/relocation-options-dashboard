# Architecture

Wayfinder is a local-first relocation comparison dashboard. The v5 document is the editable source of truth; totals, views, and projections are derived from it rather than saved as independent values.

## Data model

The canonical contract is [`schemas/wayfinder-document.v5.schema.json`](../schemas/wayfinder-document.v5.schema.json), maintained as Draft 2020-12. A valid document has kind `wayfinder-relocation-plan`, schema version `5`, field definitions, values and evidence for amounts entered once for every plan, excluded support, research records, projection assumptions, saved plans, an explicit current-position reference, migration notes, and an update timestamp. The runtime validator in `app/document.ts` applies the same constraints and rejects unknown fields.

`currentScenarioId` identifies the saved plan that represents the person's current job and home-country household position. It is `null` while the comparison has no plans; otherwise it must be the unique ID of one saved plan. It is a reference only: it does not add income, expenses, assumptions, or calculated totals.

Each current or possible plan has a local currency, an exchange-rate snapshot, gross monthly income, plan-specific values, per-input evidence, and qualitative assumptions. The document's base currency is the user-selected home/comparison currency that anchors totals and charts. A field definition assigns one calculation group and one scope:

- `deduction`, `automaticInvestment`, and `livingCost` are always plan-specific.
- `commitment` and `plannedInvestment` may be plan-specific or entered once for every plan.
- Plan-specific values are expressed in that plan's currency. Amounts entered once for every plan are expressed in the home/comparison currency and counted once in each plan.

This prevents a recurring home obligation from being accidentally converted or duplicated. Custom fields retain the same group-and-scope rules.

## Local persistence and exchange

The dashboard restores its v5 document from browser storage and writes changes back there. Export produces the complete editable JSON document. The family export is a read-only HTML rendering of the same model; it has no interactive controls and uses a restrictive content policy.

An explicitly launched Windows runtime seed is an optional local bootstrap, not another
storage or document format. `scripts/dev.py --document <path>` first makes a
bounded exact copy in an opaque per-launch file under the user's Windows Local
AppData `Wayfinder/runtime-seeds` directory, never in the repository, validates
that copy through `validateWayfinderInput`, then passes the exact directory and
opaque artifact identifier only to its child development process for build-time
injection. The launcher rejects this seed mode on non-Windows platforms; browser
import remains the portable path. Client initialization validates and synchronizes the injected v5
document again. A valid browser plan wins; an empty or damaged browser store may
receive the seed only through the existing locked, validated persistence path.
The seed source path is never part of client code, and public builds remain
empty unless the launcher explicitly enables a seed. Each launcher removes
only its own artifact. An exclusive per-seed PID lease distinguishes a live owner
from a dead process during later cleanup, so concurrent launches never share a
mutable manifest or delete each other's files.

Windows seeded launches establish `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
containment before writing a seed and keep the lease owned by that launcher for
its full lifetime. Its npm and Node descendants therefore cannot outlive a
forcibly terminated launcher. The lease also stores the Windows process
creation time, preventing PID reuse from masquerading as the original owner.
Vite accepts runtime starter injection only for `serve` in development mode;
build and preview paths ignore the seed controls even when inherited from an
operator environment. When seed mode is enabled, Vite requires a valid opaque
identifier and absolute runtime-seeds directory, then reads only the exact
bounded regular artifact file named by that identifier; otherwise it fails
closed.

Import parses the selected JSON, validates it or migrates a supported legacy shape, synchronizes document fields, and shows a summary for confirmation. The existing dashboard is unchanged until confirmation. Confirmation replaces the full document atomically; v5 does not partially merge fields because that could double-count a recurring amount entered once for every plan.

## Compatibility

`parseWayfinderDocument` accepts valid v5 documents, migrates a recognized v4 document, or migrates the supported legacy scenario shape. A v4 candidate is accepted only when it satisfies the released v4 Draft 2020-12 schema and semantic rules, including its closed list of allowed fields. Migration preserves the released dashboard convention that the first plan in a v4 `scenarios` array is the current position, so that ID becomes `currentScenarioId` (or `null` for an empty comparison). Every original v4 migration note is preserved, in order, in `legacyMigrationNotes`; v5 `migrationNotes` remain reserved for exact system-generated provenance. A historical one- or three-character country badge cannot safely become a two-letter country code, so migration stops with a repair issue and leaves the original file unchanged rather than substituting a value that could appear in a plan card or calculation. Legacy migration likewise creates the current-position reference without inventing a plan, income, expense, source, or other user fact. Every migration result must then satisfy the v5 schema and semantic validation.

Document authors should validate a file before import:

```sh
node scripts/validate-data.mjs examples/wayfinder.template.json
```

For v5 input, the CLI applies the v5 JSON Schema before semantic parsing. Recognized v4 input is first checked against the retained v4 schema and semantic rules, then migrated and checked against v5. Supported legacy input is migrated to v5 and then schema-checked. The validator reports structured paths and messages, and reports only a safe relative path or basename rather than a resolved absolute file path. `examples/` contains fictional public-safe documents only.

## Deliberate boundaries

Wayfinder does not persist calculated totals as source inputs, automatically fetch sources, determine legal or tax outcomes, or rank options with an arbitrary score. It makes inputs, evidence, trade-offs, and calculation rules visible so the user can make the decision.
