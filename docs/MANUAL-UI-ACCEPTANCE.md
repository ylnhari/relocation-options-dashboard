# Manual UI acceptance

Use only fictional figures. This checklist proves that a complete comparison can
be created, reviewed, exported, cleared, and restored without editing JSON.

## Fresh setup

1. Open a clean browser origin and choose **Enter my details**.
2. Set the comparison currency to `USD`, number format to `en-US`, income growth
   to `5`, expense inflation to `3`, and projection length to `5` years.
3. Add, rename, and remove one field in each available category. Confirm shared
   commitments and shared planned investments ask for amounts in `USD` once.
4. Enter a shared amount and confirm the comparison currency locks before any
   option exists. Set every shared and excluded-support amount back to zero and
   confirm it unlocks; no entered number may silently change currency.
   Open the restart prompt while an unsaved fictional amount is present, cancel,
   and confirm the same draft value returns. Repeat and download the draft backup
   before cancelling.
5. Expand **External Help / Family Support received**, add a fictional context
   note, and confirm the UI says it is excluded from every total.
6. Expand **Research and sources**, add a fictional official HTTPS source, and
   choose which options it applies to.

## Option and currency entry

1. Add a `USD` current option. Confirm each amount has one input labelled as both
   the option and comparison currency.
2. Add a fictional `CAD` option with `1 CAD = 0.73 USD`, a fictional source, and
   a date.
3. Enter gross pay in the `CAD` input and confirm the linked `USD` input changes.
4. Enter housing in the `USD` input and confirm the linked `CAD` input changes.
5. Repeat with a deduction, automatic investment, and any custom per-option
   commitment or planned investment.
6. Change the FX rate to `0.71`. Confirm stored CAD amounts do not move, linked
   USD amounts and calculated USD totals do, and shared USD amounts remain fixed.
7. Save, reopen the option, and confirm the linked inputs, preview, card, expanded
   calculation, and comparison table agree.

## Progressive disclosure and validation

1. Confirm a long category such as standard living costs is collapsed initially
   and its summary shows the item count and entered total.
2. Confirm short required categories remain open.
3. Use Tab, Enter, and Space on every disclosure summary. Focus must be visible.
4. Clear a required value inside a collapsed section and submit. The section must
   open, the error summary must be announced, and focus must move to the field.
5. At widths of `320px` and `650px`, confirm linked currency inputs stack without
   horizontal page overflow and Save/Cancel remain reachable.

## Full round trip

1. Add qualitative assumptions, benefits, uncertainties, field-level evidence,
   and at least one source through the UI.
2. Confirm External Help / Family Support is visible as context on the dashboard
   but does not alter income, expenses, savings, charts, or rankings.
3. Download the editable comparison file and the family view.
4. Clear only this fictional browser dashboard, import the editable file, review
   the complete-replacement preview, and confirm it.
5. Compare all inputs and totals before and after. Invalid imports must leave the
   existing dashboard unchanged.
6. Start removal of a populated field and of an option. Each confirmation must
   name the scope and offer a saved backup, Cancel, and a distinct final removal
   action. Cancel both operations and confirm nothing changed.
