# Product acceptance checklist

This is the release checklist for Wayfinder: a local-first tool for comparing
life and work choices. It is written for a person who has never used the app
and for an agent that creates the same comparison file.

## What a new person must be able to do

- Start with an empty dashboard that contains no household numbers, locations,
  sources, or conclusions.
- Understand the first screen without product jargon. It must explain that the
  person can compare their current situation with one or more possible moves.
- Create a comparison, add a job, move, or household plan, and enter every visible number, note,
  source, and assumption through the UI.
- Enter the current job and home-country household position first, then add one
  or more possible jobs, moves, or household arrangements. The dashboard must
  identify which entry is the current reference without relying on a custom
  status sentence supplied by one particular user.
- Add another choice at any time. The action must name what is being added—for
  example, **Add a job or move**—and explain that each saved choice is one
  possible place, job, or household arrangement being compared.
- Export the complete editable comparison, clear it, and restore it from the
  exported file without lost values or changed calculations.
- Share a readable, family-safe report without exposing editable browser data
  or loading external scripts.

## Plain-language rules for the interface

Every heading, field label, help text, button, error, and empty state must make
sense to a first-time user without this document or a prior conversation.

- Prefer a direct action and outcome: **Add a job or move**, **Monthly household
  costs**, **Money left after planned investing**, and **Where this number came
  from**.
- Never use internal implementation terms such as “model,” “schema,” “agentic
  document,” “migration,” “shared setting,” or an unexplained field count as
  primary user-facing copy.
- Do not use vague labels such as “continued investment” or “continued
  commitments.” Use a specific, user-editable label and a short definition; for
  example, **Monthly loan payments that continue after a move** or **Monthly
  investments you plan to keep making**.
- Explain whether an amount is entered once for every plan or separately for
  each plan. An amount entered once must say both what it covers and that it
  applies once to every plan.
- Explain derived totals in place. A user must be able to see what is included
  and what is deliberately excluded before relying on a ranking.
- Use expandable sections only for long or optional detail. The section summary
  must state what is inside and remain meaningful while collapsed.

## Complete comparison data

The UI, public JSON template, schema, validator, import path, export path, CLI,
and optional local runtime starter must represent the same complete document.

### Comparison-wide information

A person can set and later edit:

- comparison title, home/comparison currency, number format, projection years,
  annual income growth, and annual expense inflation;
- which saved plan is the current job and home-country household position;
- monthly financial categories and their specific names, explanations, and
  whether each is entered once for every plan or separately for each plan;
- monthly amounts entered once for every plan, their evidence, and their currency;
- contextual family support, research findings, assumptions, sources, and
  review dates.

### Current position and possible plans

For the current position and every possible plan, a person can set and later edit:

- name, location, plan currency, household earners, colour, and employment
  details;
- gross compensation and evidence;
- every tax or other deduction, automatic investment, living cost, continuing payment, and
  planned investment with amount, evidence, and an explicit zero where
  applicable;
- non-financial notes such as work, family, visa, transport, childcare,
  benefits, risks, and uncertain compensation.

No user-specific number, field value, exchange rate, source, plan, research
finding, score, or conclusion may be embedded in public source code, examples,
tests, or starter data. Built-in neutral categories and empty evidence shells
are allowed; they are structure, not facts.

## Currency and evidence

- Each plan clearly displays its local currency and the home/comparison currency.
  A number can be entered in either currency and the linked value updates using
  the plan’s conversion ratio.
- The home/comparison currency anchors totals and charts. Each possible plan's
  own currency is converted to it; the relationship is never left implicit.
- A plan using a different currency requires a positive conversion ratio,
  conversion date, and source before it is valid or shown in comparisons.
- The app labels both currencies beside amounts. It never leaves a person to
  infer whether a number is local or comparison currency.
- Important estimates and research have an accuracy/status, source, and date.
  Sources and assumptions are editable, visible in exports, and never silently
  fetched or replaced.

## Calculation and display contract

- Gross compensation is visible for the current position and every possible plan.
- Deductions, automatic payroll investments, household costs, continuing
  payments, and planned investments are separate, named categories.
- A recurring obligation that truly remains identical after every move—such as
  money sent home, a loan payment, or continuing insurance—can be entered once
  in the home/comparison currency and is counted exactly once in every plan.
  If it changes by plan, the UI directs the user to enter it separately instead.
- Automatic payroll investments and planned investments count as saving, not
  household spending.
- Total monthly saving is visually the parent amount. Its two visible parts are
  total investments and cash remaining after planned investments.
- For every plan, total saving equals total investments plus cash remaining,
  even if cash remaining is negative.
- Projections identify the measure, currency, time period, growth assumptions,
  and legend. Claims such as “best” or “strongest” say exactly which measured
  value they compare.
- Family support can be recorded as context, but is excluded from income,
  outflow, saving, projections, charts, and rankings. The UI says this plainly.
- Bonuses, relocation money, deposits, visas, furniture, and other one-time or
  uncertain values are clearly identified. They cannot silently become recurring
  monthly income or spending.
- Career, lifestyle, immigration, and family observations remain sourced notes;
  they must not become opaque certainty or quality scores.

## Validation and safe changes

- Required values, linked values, dates, sources, and conversion inputs are
  validated before a plan can appear in a comparison.
- A user must explicitly provide a value or choose an explicit **Use 0** action;
  adding a field never silently creates zero-valued data in existing plans.
- Invalid imports show actionable issues and preserve the existing dashboard.
  Import is all-or-nothing: the app does not partially merge unknown data.
- Derived totals are always recomputed locally. Imported or agent-supplied
  derived totals are not trusted.
- If an older supported file needs repair, the app makes the needed user action
  clear without presenting old technical history as a current financial
  assumption.

## Manual entry and agent entry are equal

- A user can build the complete dashboard through the UI from an empty start.
- An agent can produce the exact same public versioned JSON using the template,
  schema, validation command, and documented workflow.
- The app validates both routes identically, previews an import before it
  replaces browser data, and exports the same editable structure created by the
  UI.
- Local prefilling, when deliberately configured by the device owner, uses an
  ignored local document and never changes the public repository or default
  empty start.

## Privacy, sharing, and portability

- The app keeps comparison data in the user’s browser unless the user chooses
  to download, import, or locally prefill a file.
- It has no analytics, telemetry, account requirement, cloud database, or
  automatic research collection.
- The shared report escapes user text, blocks scripts, uses a restrictive
  content security policy, and loads no resources automatically.
- The public repository contains only fictional examples. It is cloneable and
  works without a personal account, private network address, private file, or
  machine-specific path.

## Release evidence required

Before release, retain evidence that:

1. The public examples validate with the documented command.
2. Unit, lint, type, and calculation tests pass using fictional data.
3. A clean browser creates a complete comparison through the UI, exports it,
   clears it, imports it, and confirms equivalent results.
4. Tests cover invalid import preservation, conversion requirements, amounts
   entered once and per-plan fields, explicit-zero behaviour, support exclusion, calculation
   invariants, projections, and family-report export.
5. Browser checks cover narrow mobile and desktop layouts, keyboard access,
   visible focus, readable contrast, reduced motion, long user text, collapsed
   details, empty states, and validation errors.
6. The staged tree and unpublished history are scanned for credentials,
   personal financial data, private links, private infrastructure, and absolute
   machine paths.
7. A separate reviewer checks the exact release candidate against this
   checklist. Evidence belongs in the repository’s tests, documented manual UI
   acceptance procedure, and release/CI record; it must never include private
   household data.

Wayfinder passes acceptance only when a first-time user can reproduce every
visible part of a completed comparison through the UI, an agent can create the
same validated file, and the resulting dashboard is understandable without
hidden assumptions or product-specific vocabulary.
