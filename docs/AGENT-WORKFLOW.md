# Safe agent workflow

Agents can help prepare a v4 document, but the user remains responsible for the decision and the final import. Use the empty v4 template or a user-authorized editable export as the contract. Do not ask an agent to invent missing household facts.

## Recommended sequence

1. Start from `examples/wayfinder.template.json` or an exported v4 document supplied by the user.
2. Ask for missing inputs that materially affect the comparison. Keep unknown values as zero only when that is the user's intentional placeholder, and mark their evidence as `unknown`.
3. For public research, record a concise finding, publisher, source title and URL, date, scope, and status. Use `verified`, `estimate`, or `question` honestly; a source citation does not make an estimate certain.
4. Separate shared obligations from option-specific inputs. Record automatic saving as `automaticInvestment`, never as a deduction or living cost.
5. Keep external help separate in `excludedSupport`; do not use it to improve baseline savings.
6. Run `npm run validate:data -- <document.json>`, correct every reported issue, and give the user the complete validated file. For v4 documents the CLI checks the Draft 2020-12 JSON Schema before semantic validation; supported legacy documents are migrated to v4 and then schema-checked. Its JSON output uses only a safe relative path or basename, so do not rely on it to reveal a local absolute path.
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
