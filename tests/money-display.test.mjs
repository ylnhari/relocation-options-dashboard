import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceSavingsDisplay,
  currencyMinorUnitDigits,
  formatMoney,
  roundMoneyToMinorUnit,
} from "../app/money-display.ts";

test("resolves currency minor units without hardcoded currency branches", () => {
  assert.equal(currencyMinorUnitDigits("USD"), 2);
  assert.equal(currencyMinorUnitDigits("JPY"), 0);
  assert.equal(currencyMinorUnitDigits("KWD"), 3);
  assert.equal(currencyMinorUnitDigits("not-a-code"), 2);
});

test("formats ordinary money with locale separators and meaningful currency precision", () => {
  assert.equal(formatMoney(125, "USD", "en-US"), "USD 125");
  assert.equal(formatMoney(1234.567, "USD", "en-US"), "USD 1,234.57");
  assert.equal(formatMoney(1234.567, "USD", "de-DE"), "USD 1.234,57");
  assert.equal(formatMoney(1234.567, "JPY", "en-US"), "JPY 1,235");
  assert.equal(formatMoney(1234.5678, "KWD", "en-US"), "KWD 1,234.568");
  assert.equal(formatMoney(1_250_000, "USD", "en-US", true), "USD 1.3M");
});

test("normalizes negative zero after currency rounding", () => {
  assert.equal(roundMoneyToMinorUnit(-0.001, "USD"), 0);
  assert.equal(Object.is(roundMoneyToMinorUnit(-0.001, "USD"), -0), false);
  assert.equal(formatMoney(-0.001, "USD", "en-US"), "USD 0");
  assert.equal(formatMoney(-12.345, "USD", "en-US"), "−USD 12.35");
});

test("balances savings independently in local and comparison currencies", () => {
  const local = balanceSavingsDisplay(10_000.5, 4_000.4, "JPY");
  const comparison = balanceSavingsDisplay(30.0015, 12.0012, "KWD");

  assert.deepEqual(local, { total: 10_001, investments: 4_000, cash: 6_001 });
  assert.deepEqual(comparison, { total: 30.002, investments: 12.001, cash: 18.001 });
  assert.equal(
    roundMoneyToMinorUnit(local.investments + local.cash, "JPY"),
    local.total,
  );
  assert.equal(
    roundMoneyToMinorUnit(comparison.investments + comparison.cash, "KWD"),
    comparison.total,
  );
});

test("derives negative displayed cash from the rounded parent and investments", () => {
  const display = balanceSavingsDisplay(10.004, 12.006, "USD");

  assert.deepEqual(display, { total: 10, investments: 12.01, cash: -2.01 });
  assert.equal(
    roundMoneyToMinorUnit(display.investments + display.cash, "USD"),
    display.total,
  );
});
