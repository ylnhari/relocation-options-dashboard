# Safe agent workflow

Agents can help prepare a v4 document, but the user remains responsible for the decision and the final import. The browser and agents create the same canonical v4 editable document; there is no agent-only format, calculated-input field, or merge path. Use the empty v4 template or a user-authorized editable export as the contract. Do not ask an agent to invent missing household facts.

## Empty-start contract

`examples/wayfinder.template.json` is a schema-valid empty start, not an
illustrative plan: it contains no options, household facts, research records,
support entries, sources, or qualitative claims. Its standard field definitions
and zero/`unknown` placeholders are structural only. The user or the agent
acting on the user's supplied information authors every plan title, option,
amount, assumption, evidence status, date, source, note, research record, and
other dynamic value before a comparison is relied on.

When adding an option, supply every required option field and every value and
evidence entry linked to its active per-option field definitions. A
non-comparison-currency option must supply its own three-letter currency, a
strictly positive conversion ratio to the comparison currency, an as-of date,
and a source. Do not borrow a rate, date, or source from another option. Any
missing linked field or non-comparison-currency conversion component invalidates the whole document;
fix all reported issues before offering it for import.

The manual UI starts every new option amount blank. A literal zero is valid only
after the user types it or explicitly applies the section's **Use 0** action.
Agents must follow the same intent rule: zero may represent not applicable or an
intentional unknown placeholder, never an unreviewed template fact.
Shared amounts and excluded-support amounts also start blank in a clean manual
setup and require the same deliberate value or explicit zero decision.

## Recommended sequence

1. Start from `examples/wayfinder.template.json` or an exported v4 document supplied by the user.
2. Ask for missing inputs that materially affect the comparison. Keep unknown values as zero only when that is the user's intentional placeholder, and mark their evidence as `unknown`; do not turn a template default into a user fact. In particular, replace the template's neutral 0% growth, 0% inflation, and one-year period with the user's choices.
3. For public research, record a concise finding, publisher, source title and URL, date, scope, and status. Use `verified`, `estimate`, or `question` honestly; a source citation does not make an estimate certain.
4. Separate shared obligations from option-specific inputs. Record automatic saving as `automaticInvestment`, never as a deduction or living cost.
5. Keep external help separate in `excludedSupport`; do not use it to improve baseline savings.
6. Run `npm run validate:data -- <document.json>`, correct every reported issue, and give the user the complete validated file. For v4 documents the CLI checks the Draft 2020-12 JSON Schema before semantic validation; supported older documents are migrated to v4 and then schema-checked. Validation is atomic: one malformed option, including a missing linked value/evidence or required non-comparison-currency conversion field, rejects the complete import. Its JSON output uses only a safe relative path or basename, so do not rely on it to reveal a local absolute path.
7. The user previews the import and explicitly confirms replacement in the dashboard. Keep the previous export as a backup if needed.

## Privacy and safety

Agents should receive the minimum information needed. Do not place credentials, full financial statements, transaction-level data, identity numbers, or unredacted documents in prompts, public artifacts, or version control. Prefer aggregate monthly inputs and short source references. Never overwrite a user's browser data directly; import confirmation is the ownership boundary.

## Research discipline

Research records provide context, not automatic truth. State what the source establishes, what it does not establish, which options it applies to, and when it was current. Preserve unresolved questions. Refresh time-sensitive material before acting on it, and do not represent immigration, tax, employment, housing, or investment information as professional advice.

## What agents must not do

- Fabricate a rate, tax treatment, eligibility outcome, or research source.
- Blend possible support into normal income or expenses.
- Replace transparent inputs with a recommendation score.
- Remove migration notes or evidence merely to make a comparison look cleaner.
- Commit, publish, or share an editable user document without the user's explicit approval.
