# Calculations

All input values are monthly. An option's local-currency values are converted using its recorded exchange rate; shared values already use the document base currency. The rate is a user-recorded snapshot, not a live quote.

## Monthly flow

For an option, let `fx` be its rate to the base currency. The dashboard derives these base-currency values:

```text
gross                 = grossMonthly × fx
deductions            = sum(deduction fields)
automatic saving      = sum(automaticInvestment fields)
net cash              = gross − deductions − automatic saving
living costs          = sum(livingCost fields)
commitments           = per-option commitments + shared commitments
planned investments   = per-option planned investments + shared planned investments
total investments     = automatic saving + planned investments
total saving          = automatic saving + net cash − living costs − commitments
cash remaining        = total saving − total investments
saving rate           = total saving ÷ gross, when gross is positive
```

Automatic retirement or pension contributions reduce take-home cash, but they are still saving. They are therefore included in both total saving and total investments, never treated as a living expense. Planned investments are post-tax saving choices: they reduce cash remaining, but not total saving before investment allocation.

The identity is intentional: total saving equals gross less cash deductions, living costs, and commitments. It is not reduced twice for automatic saving.

## What belongs where

- **Gross income:** recurring compensation included in the option.
- **Deductions:** income tax, payroll deductions, and other non-saving cash deductions.
- **Automatic investments:** payroll retirement or pension saving.
- **Living costs:** regular option-specific household spending.
- **Commitments:** ongoing obligations. Use shared scope only when the same base-currency obligation applies to every option.
- **Planned investments:** voluntary post-tax investments.

External Help / Family Support is deliberately excluded. It is neither baseline income nor baseline expense, and it does not change gross, net cash, commitments, investments, total saving, cash remaining, or saving rate. Record it separately only to make uncertainty visible.

## Projection

The projection produces one row for each selected year. The first row is the baseline. In later rows, gross income, deductions, and automatic saving grow with the income-growth assumption; living costs and commitments grow with the expense-inflation assumption. Planned investments remain at the baseline value. Each projected monthly value is also presented annually.

The projection is a scenario exercise, not a forecast. It does not recompute tax brackets, benefit rules, currency conversion, investment returns, debt amortization, one-time payments, or changes in household circumstances. Review assumptions whenever the underlying facts change.

## No arbitrary scores

Wayfinder does not combine money, research, or qualitative notes into an opaque score. Compare the transparent outputs alongside evidence status, sources, dates, risks, and scenario assumptions.
