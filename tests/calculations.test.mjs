import assert from "node:assert/strict";
import test from "node:test";

import { deriveScenario, projectScenario } from "../app/scenario-math.ts";
import { baseToLocalAmount } from "../app/currency-input.ts";
import {
  DEFAULT_SCENARIOS,
  createBlankScenario,
  createCurrentScenario,
  createScenarioId,
  createWayfinderDocument,
} from "../app/scenarios.ts";

function createDocument(overrides = {}) {
  return { ...createWayfinderDocument("USD"), ...overrides };
}

function createScenario(document, overrides = {}) {
  const scenario = createCurrentScenario(document);
  return {
    ...scenario,
    id: "synthetic-option",
    label: "Synthetic option",
    ...overrides,
    values: { ...scenario.values, ...overrides.values },
  };
}

function rounded(value) {
  return Number(value.toFixed(8));
}

test("new documents have no household financial defaults", () => {
  const document = createWayfinderDocument();
  const starter = createCurrentScenario(document);
  const alternative = createBlankScenario(document);

  assert.deepEqual(DEFAULT_SCENARIOS, []);
  assert.equal(document.baseCurrency, "USD");
  assert.equal(document.scenarios.length, 0);
  assert.ok(Object.values(document.sharedValues).every((value) => value === 0));
  assert.equal(starter.grossMonthly, 0);
  assert.ok(Object.values(starter.values).every((value) => value === 0));
  assert.equal(deriveScenario(document, starter).totalSavingBase, 0);
  for (const scenario of [starter, alternative]) {
    assert.equal(scenario.label, "");
    assert.equal(scenario.location, "");
    assert.equal(scenario.employment, "");
    assert.equal(scenario.spouseJob, "");
    assert.equal(scenario.childcare, "");
    assert.equal(scenario.transport, "");
    assert.equal(scenario.residency, "");
    assert.equal(scenario.bonus, "");
  }
});

test("creates scenario IDs when randomUUID is unavailable", () => {
  assert.equal(
    createScenarioId({ randomUUID: () => "fixed-uuid" }),
    "option-fixed-uuid",
  );

  const fallbackId = createScenarioId({
    getRandomValues(values) {
      values.fill(0);
      return values;
    },
  });
  assert.equal(fallbackId, "option-00000000-0000-4000-8000-000000000000");
  assert.match(createScenarioId(null), /^option-[a-z0-9]+-[a-z0-9]+$/);
});

test("derives gross-to-net cash while counting payroll retirement as savings", () => {
  const document = createDocument({
    sharedValues: {
      "shared-debt": 300,
      "shared-remittances": 0,
      "shared-other-commitment": 0,
      "shared-market-investing": 100,
      "shared-other-investing": 0,
    },
  });
  const scenario = createScenario(document, {
    currency: "EUR",
    fx: { rateToBase: 1.25, asOf: "2026-01-01", source: "Synthetic FX" },
    grossMonthly: 10_000,
    values: {
      "deduction-income-tax": 2_000,
      "deduction-payroll": 500,
      "deduction-other": 100,
      "automatic-retirement": 600,
      "living-housing": 2_000,
      "living-groceries": 900,
    },
  });

  const result = deriveScenario(document, scenario);

  assert.equal(result.grossBase, 12_500);
  assert.equal(result.deductionMonthly, 2_600);
  assert.equal(result.deductionBase, 3_250);
  assert.equal(result.automaticInvestmentMonthly, 600);
  assert.equal(result.automaticInvestmentBase, 750);
  assert.equal(result.netCashMonthly, 6_800);
  assert.equal(result.netCashBase, 8_500);
  assert.equal(result.livingBase, 3_625);
  assert.equal(result.sharedCommitmentBase, 300);
  assert.equal(result.sharedPlannedInvestmentBase, 100);
  assert.equal(result.totalInvestmentBase, 850);
  assert.equal(result.totalSavingBase, 5_325);
  assert.equal(result.cashRemainingBase, 4_475);
  assert.equal(
    result.totalSavingBase,
    result.totalInvestmentBase + result.cashRemainingBase,
  );
});

test("applies shared commitments and planned investments once in base currency", () => {
  const document = createDocument({
    sharedValues: {
      "shared-debt": 800,
      "shared-remittances": 125,
      "shared-other-commitment": 0,
      "shared-market-investing": 300,
      "shared-other-investing": 50,
    },
  });
  const cad = deriveScenario(
    document,
    createScenario(document, {
      id: "synthetic-cad",
      currency: "CAD",
      fx: { rateToBase: 0.75, asOf: "2026-01-01", source: "Synthetic FX" },
    }),
  );
  const inr = deriveScenario(
    document,
    createScenario(document, {
      id: "synthetic-inr",
      currency: "INR",
      fx: { rateToBase: 0.0125, asOf: "2026-01-01", source: "Synthetic FX" },
    }),
  );

  assert.equal(cad.sharedCommitmentBase, 925);
  assert.equal(inr.sharedCommitmentBase, 925);
  assert.equal(cad.sharedPlannedInvestmentBase, 350);
  assert.equal(inr.sharedPlannedInvestmentBase, 350);
  assert.equal(cad.breakdown.commitment[0].localAmount, 800 / 0.75);
  assert.equal(inr.breakdown.commitment[0].localAmount, 800 / 0.0125);
});

test("a comparison-currency edit produces the same canonical option totals", () => {
  const document = createDocument({
    sharedValues: {
      "shared-debt": 175.25,
      "shared-remittances": 0,
      "shared-other-commitment": 0,
      "shared-market-investing": 0,
      "shared-other-investing": 0,
    },
  });
  const rateToBase = 0.731234567;
  const grossBaseInput = 8_765.43;
  const housingBaseInput = 1_987.65;
  const grossLocal = baseToLocalAmount(grossBaseInput, rateToBase);
  const housingLocal = baseToLocalAmount(housingBaseInput, rateToBase);
  const result = deriveScenario(document, createScenario(document, {
    currency: "CAD",
    fx: { rateToBase, asOf: "2026-01-01", source: "Synthetic FX" },
    grossMonthly: grossLocal,
    values: { "living-housing": housingLocal },
  }));

  assert.equal(rounded(result.grossBase), rounded(grossBaseInput));
  assert.equal(rounded(result.livingBase), rounded(housingBaseInput));
  assert.equal(result.sharedCommitmentBase, 175.25);
  assert.equal(
    rounded(result.totalSavingBase),
    rounded(result.totalInvestmentBase + result.cashRemainingBase),
  );
});

test("includes option-specific commitments and planned investments only for that option", () => {
  const base = createDocument();
  const document = {
    ...base,
    fieldDefinitions: [
      ...base.fieldDefinitions,
      {
        id: "option-child-support",
        label: "Option child support",
        description: "Synthetic option-specific commitment.",
        group: "commitment",
        scope: "perOption",
      },
      {
        id: "option-brokerage",
        label: "Option brokerage",
        description: "Synthetic option-specific investment.",
        group: "plannedInvestment",
        scope: "perOption",
      },
    ],
  };
  const scenario = createScenario(document, {
    values: { "option-child-support": 125, "option-brokerage": 200 },
  });

  const result = deriveScenario(document, scenario);

  assert.equal(result.optionCommitmentMonthly, 125);
  assert.equal(result.optionCommitmentBase, 125);
  assert.equal(result.plannedInvestmentMonthly, 200);
  assert.equal(result.optionPlannedInvestmentBase, 200);
  assert.equal(result.breakdown.commitment.at(-1)?.scope, "perOption");
  assert.equal(result.breakdown.plannedInvestment.at(-1)?.scope, "perOption");
});

test("leaves External Help and Family Support excluded from baseline math", () => {
  const document = createDocument();
  const scenario = createScenario(document, {
    grossMonthly: 1_000,
    values: { "living-housing": 250 },
  });
  const withoutSupport = deriveScenario(document, scenario);
  const withExcludedSupport = deriveScenario(
    {
      ...document,
      excludedSupport: [
        {
          id: "synthetic-support",
          label: "External Help / Family Support",
          monthlyBase: 99_999,
          note: "Explicitly excluded from baseline income and expense math.",
        },
      ],
    },
    scenario,
  );

  assert.equal(withExcludedSupport.totalSavingBase, withoutSupport.totalSavingBase);
  assert.equal(withExcludedSupport.cashRemainingBase, withoutSupport.cashRemainingBase);
});

test("keeps the saving identity true for negative cash after over-investment", () => {
  const document = createDocument({
    sharedValues: {
      "shared-debt": 0,
      "shared-remittances": 0,
      "shared-other-commitment": 0,
      "shared-market-investing": 900,
      "shared-other-investing": 0,
    },
  });
  const result = deriveScenario(
    document,
    createScenario(document, { grossMonthly: 1_000, values: { "living-housing": 250 } }),
  );

  assert.equal(result.totalSavingBase, 750);
  assert.equal(result.totalInvestmentBase, 900);
  assert.equal(result.cashRemainingBase, -150);
  assert.equal(
    result.totalSavingBase,
    result.totalInvestmentBase + result.cashRemainingBase,
  );
});

test("projects gross, net cash, savings, investments, and cash without mutation", () => {
  const document = createDocument({
    sharedValues: {
      "shared-debt": 100,
      "shared-remittances": 0,
      "shared-other-commitment": 0,
      "shared-market-investing": 50,
      "shared-other-investing": 0,
    },
    projectionAssumptions: {
      incomeGrowthPct: 10,
      expenseInflationPct: 5,
      years: 3,
    },
  });
  const scenario = createScenario(document, {
    grossMonthly: 1_000,
    values: {
      "deduction-income-tax": 100,
      "automatic-retirement": 100,
      "living-housing": 200,
    },
  });
  const beforeDocument = structuredClone(document);
  const beforeScenario = structuredClone(scenario);

  const projection = projectScenario(document, scenario);

  assert.deepEqual(projection.map((item) => item.year), [1, 2, 3]);
  assert.deepEqual(
    projection.map((item) => ({
      gross: rounded(item.grossBase),
      net: rounded(item.netCashBase),
      saving: rounded(item.totalSavingBase),
      investment: rounded(item.totalInvestmentBase),
      cash: rounded(item.cashRemainingBase),
    })),
    [
      { gross: 1_000, net: 800, saving: 600, investment: 150, cash: 450 },
      { gross: 1_100, net: 880, saving: 675, investment: 160, cash: 515 },
      {
        gross: 1_210,
        net: 968,
        saving: 758.25,
        investment: 171,
        cash: 587.25,
      },
    ],
  );
  assert.deepEqual(document, beforeDocument);
  assert.deepEqual(scenario, beforeScenario);
});
