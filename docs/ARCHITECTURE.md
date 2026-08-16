# Architecture

Wayfinder is a local-first relocation comparison dashboard. The v4 document is the editable source of truth; totals, views, and projections are derived from it rather than saved as independent values.

## Data model

The canonical contract is [`schemas/wayfinder-document.v4.schema.json`](../schemas/wayfinder-document.v4.schema.json), maintained as Draft 2020-12. A valid document has kind `wayfinder-relocation-plan`, schema version `4`, model metadata, field definitions, shared values and evidence, excluded support, research records, projection assumptions, options, migration notes, and an update timestamp. The runtime validator in `app/document.ts` applies the same constraints and rejects unknown fields.

Each option has local currency, an exchange-rate snapshot, gross monthly income, per-option values, per-input evidence, and qualitative assumptions. A field definition assigns one calculation group and one scope:

- `deduction`, `automaticInvestment`, and `livingCost` are always per-option.
- `commitment` and `plannedInvestment` may be per-option or shared.
- Per-option values are expressed in that option's currency. Shared values are expressed in the document base currency and apply once to every option.

This prevents a continuing obligation from being accidentally converted or duplicated in every option. Custom fields retain the same group-and-scope rules.

## Local persistence and exchange

The dashboard restores its v4 document from browser storage and writes changes back there. Export produces the complete editable JSON document. The family export is a read-only HTML rendering of the same model; it has no interactive controls and uses a restrictive content policy.

Import parses the selected JSON, validates it or migrates a supported legacy shape, synchronizes document fields, and shows a summary for confirmation. The existing dashboard is unchanged until confirmation. Confirmation replaces the full document atomically; v4 does not partially merge fields because that could double-count shared entries.

## Compatibility

`parseWayfinderDocument` accepts valid v4 documents or migrates the supported legacy scenario shape. Migration preserves available values, adds required v4 structures, marks migrated evidence for review, and records migration notes. It cannot infer missing categories, original evidence, or a trustworthy exchange-rate date; users must review those notes before relying on the result.

Document authors should validate a file before import:

```sh
node scripts/validate-data.mjs examples/wayfinder.template.json
```

For v4 input, the CLI applies the JSON Schema before semantic parsing. Supported legacy input is migrated to v4 and then schema-checked. The validator reports structured paths and messages, and reports only a safe relative path or basename rather than a resolved absolute file path. `examples/` contains fictional public-safe documents only.

## Deliberate boundaries

Wayfinder does not persist calculated totals as source inputs, automatically fetch sources, determine legal or tax outcomes, or rank options with an arbitrary score. It makes inputs, evidence, trade-offs, and calculation rules visible so the user can make the decision.
