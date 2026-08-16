# Product roadmap

Wayfinder 0.1 compares recurring monthly steady-state scenarios. This roadmap
records important relocation decisions that should become first-class product
features without pretending the current model already calculates them.

## Current 0.1 contract

- One centrally defined field model shared by every option.
- Gross-to-net reconciliation, itemized recurring costs, continuing
  commitments, automatic payroll investments, planned investments, total
  saving, and cash remaining.
- Dated FX, evidence, qualitative assumptions, and research records.
- Manual setup and validated agent-authored JSON import using one portable
  document format.
- Explicit projection series for gross compensation, net cash, total saving,
  investments, and cash remaining.
- Local browser persistence plus editable JSON and read-only family exports.

## Planned modelling extensions

1. **Transition timelines** — solo-first, family-join, second-income start,
   probation, permit expiry, and return checkpoints in one dated plan.
2. **One-time cash flows** — relocation bonus, tax treatment, visa and ticket
   costs, deposits, shipping, temporary housing, setup costs, and recoverable
   employer reimbursements.
3. **Ranges and sensitivity** — low/base/high rent and spending, spouse-job
   timing, income growth such as 5% and 10%, FX movement, and job-loss cases.
4. **Runway and return plan** — starting liquid cash, emergency-fund floor,
   six-month trial, exit costs, and a dated stop/continue gate.
5. **Benefits ledger** — employer-paid insurance, pension match, schooling,
   travel, leave, relocation, and repayment clauses without counting benefits
   as spendable salary.
6. **Tax and payroll adapters** — transparent, versioned country modules whose
   formulas, tax year, jurisdiction, sources, and limitations are visible.
7. **Research refresh workflow** — flag stale evidence, assign open questions,
   and revalidate material official rules before a decision.
8. **Optional scenario packs** — reusable, fictional starter structures for a
   stay-put baseline, one-income move, two-income move, solo-first trial, and
   return path. Packs must never contain a real household's data.

Until these extensions land, model materially different recurring phases as
separate scenarios and record transition or one-time facts as research and
assumption notes. Do not spread a one-time cost across monthly living expenses
without stating the chosen period and method.

## Guardrails for every extension

- Preserve `total saving = total investments + cash remaining`.
- Keep investments separate from consumption expenses.
- Keep incoming External Help / Family Support outside every calculation.
- Never replace conditions and evidence with an opaque certainty, career, or
  lifestyle score.
- Migrate documents explicitly and losslessly; reject unsupported versions.
- Keep browser data local and public examples entirely fictional.
