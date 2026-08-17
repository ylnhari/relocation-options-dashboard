import assert from "node:assert/strict";
import test from "node:test";

import {
  baseToLocalAmount,
  formatEditableAmount,
  fxAfterCurrencyChange,
  hasUsableFxRate,
  localToBaseAmount,
  parseMoneyInput,
} from "../app/currency-input.ts";

test("converts between option and comparison currencies without changing the canonical local amount", () => {
  const local = 2_000;
  const rate = 61.25;
  const base = localToBaseAmount(local, rate);

  assert.equal(base, 122_500);
  assert.equal(baseToLocalAmount(base, rate), local);
  assert.equal(local, 2_000);
});

test("keeps equal currencies as an identity conversion", () => {
  assert.equal(localToBaseAmount(12_345.67, 1), 12_345.67);
  assert.equal(baseToLocalAmount(12_345.67, 1), 12_345.67);
});

test("editable text preserves the number needed for a round trip", () => {
  const local = baseToLocalAmount(100, 3);

  assert.equal(local, 100 / 3);
  assert.equal(formatEditableAmount(local), "33.333333333333336");
  assert.equal(parseMoneyInput(formatEditableAmount(local)), local);
  assert.ok(Math.abs(localToBaseAmount(local, 3) - 100) < 1e-10);
});

test("rejects unusable rates and incomplete or invalid money text", () => {
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(hasUsableFxRate(rate), false);
    assert.equal(localToBaseAmount(100, rate), null);
    assert.equal(baseToLocalAmount(100, rate), null);
  }

  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("   "), null);
  assert.equal(parseMoneyInput("not money"), null);
  assert.equal(parseMoneyInput("-1"), null);
  assert.equal(parseMoneyInput("0"), 0);
  assert.equal(parseMoneyInput("123.45"), 123.45);
});

test("repeated display conversion does not mutate or progressively round stored values", () => {
  const originalLocal = 987.654321987;
  const rate = 0.731234567;
  let storedLocal = originalLocal;

  for (let index = 0; index < 25; index += 1) {
    formatEditableAmount(localToBaseAmount(storedLocal, rate));
    formatEditableAmount(storedLocal);
  }

  assert.equal(storedLocal, originalLocal);
});

test("changing an option currency cannot reuse a stale exchange rate", () => {
  const currentFx = { rateToBase: 61.25, asOf: "2026-01-01", source: "Synthetic FX" };

  assert.equal(fxAfterCurrencyChange("CAD", "CAD", "INR", currentFx), currentFx);
  assert.deepEqual(fxAfterCurrencyChange("CAD", "INR", "INR", currentFx), {
    rateToBase: 1,
    asOf: null,
    source: "Base currency",
  });
  assert.deepEqual(fxAfterCurrencyChange("CAD", "AED", "INR", currentFx), {
    rateToBase: 0,
    asOf: null,
    source: "",
  });
});
