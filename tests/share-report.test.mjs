import assert from "node:assert/strict";
import test from "node:test";

import { createFamilyShareHtml } from "../app/share-report.ts";
import { createCurrentScenario, createWayfinderDocument } from "../app/scenarios.ts";

function testDocument() {
  const document = createWayfinderDocument("EUR");
  document.title = "Family <script>alert(1)</script> plan";
  document.locale = "de-DE";
  document.projectionAssumptions = {
    incomeGrowthPct: 4.5,
    expenseInflationPct: 2.4,
    years: 5,
  };
  document.sharedValues["shared-debt"] = 300;
  document.sharedValues["shared-market-investing"] = 250;
  document.sharedEvidence["shared-debt"] = {
    status: "confirmed",
    asOf: "2026-08-01",
    source: "Loan statement",
    note: "Monthly repayment",
  };
  document.excludedSupport = [{
    id: "support-1",
    label: "Family contribution",
    monthlyBase: 600,
    note: "Discussed separately",
  }];
  document.researchItems = [{
    id: "research-1",
    topic: "housing",
    title: "Housing <script>alert(1)</script>",
    finding: "Sample finding <img src=x onerror=alert(1)>",
    appliesToScenarioIds: ["family-view-test"],
    status: "verified",
    publisher: "Sample publisher",
    sourceTitle: "Rental guide <b>2026</b>",
    sourceUrl: "https://research.example/rent?city=sample&year=2026",
    asOf: "2026-08-14",
    note: "Reviewed for this option",
  }, {
    id: "research-2",
    topic: "tax",
    title: "Untrusted source URL",
    finding: "Kept as text only",
    appliesToScenarioIds: [],
    status: "question",
    publisher: "Sample publisher",
    sourceTitle: "Unsafe URL",
    sourceUrl: "javascript:alert(1)<script>",
    asOf: null,
    note: "Needs verification",
  }];

  const scenario = {
    ...createCurrentScenario(document),
    id: "family-view-test",
    label: "Berlin <script>alert(1)</script>",
    location: "Example City",
    employment: "Sample role",
    status: "Estimate",
    currency: "GBP",
    fx: { rateToBase: 1.2, asOf: "2026-08-15", source: "Sample FX source" },
    grossMonthly: 5_000,
    earners: 2,
    color: "not-a-color",
    spouseJob: "Included in gross income",
    values: {
      ...createCurrentScenario(document).values,
      "deduction-income-tax": 900,
      "automatic-retirement": 250,
      "living-housing": 1_400,
      "living-groceries": 500,
    },
    evidence: {
      ...createCurrentScenario(document).evidence,
      grossMonthly: { status: "confirmed", asOf: "2026-08-10", source: "Offer letter", note: "Monthly equivalent" },
      "living-housing": { status: "estimate", asOf: "2026-08-12", source: "Rental research", note: "Two-bedroom estimate" },
    },
  };
  document.scenarios = [scenario];
  document.currentScenarioId = scenario.id;
  return document;
}

test("creates a self-contained, generic-currency family report", () => {
  const html = createFamilyShareHtml(testDocument(), new Date("2026-08-16T10:00:00.000Z"));

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Wayfinder · family report \(read-only\)/);
  assert.match(html, /EUR/);
  assert.match(html, /GBP 5[,.]000/);
  assert.match(html, /1 GBP = 1\.2 EUR/);
  assert.match(html, /Each plan shows its local currency first and EUR underneath\. EUR is the home\/comparison currency chosen to compare every plan on the same basis\./);
  assert.match(html, /Current job and home-country position/);
  assert.match(html, /Monthly income before tax and deductions/);
  assert.match(html, /Tax and other deductions/);
  assert.match(html, /Take-home cash after deductions and automatic savings/);
  assert.match(html, /Monthly household costs/);
  assert.match(html, /Loan payments, money sent home, and other obligations outside this household plan/);
  assert.match(html, /Total saved or left each month/);
  assert.match(html, /This is made up of monthly investments and cash left after costs and planned investments\./);
  assert.match(html, /Monthly investments/);
  assert.match(html, /Cash left after costs and planned investments/);
  assert.match(html, /<small>Automatic payroll savings plus planned investments<\/small>/);
  assert.match(html, /<details class="scenario-details">\s*<summary>Monthly amounts, sources, and what each amount means<\/summary>/);
  assert.match(html, /<details class="scenario-details scenario-assumptions">\s*<summary>Important non-financial details<\/summary>/);
  assert.match(html, /2 earners/);
  assert.match(html, /Same amount in every plan/);
  assert.match(html, /Loan statement/);
  assert.match(html, /2026-08-01/);
  assert.match(html, /Possible family help \(shown separately; not included in calculations\)/);
  assert.match(html, /not added to income or subtracted from costs, and does not change saving, charts, future estimates, or rankings/i);
  assert.match(html, /Future-estimate assumptions/);
  assert.match(html, /EUR [\d.]+ in the comparison currency/);
  assert.doesNotMatch(html, /Continuing commitments/);
  assert.doesNotMatch(html, /Scenario assumptions/);
  assert.doesNotMatch(html, /base equivalent/);
  assert.match(html, /#7cb8ff/);
  assert.match(html, /Research and sources/);
  assert.match(html, /Applies to<\/dt><dd>Berlin &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/dd>/);
  assert.match(html, /href="https:\/\/research\.example\/rent\?city=sample&amp;year=2026"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test("shows a balanced savings parent and two-currency children", () => {
  const document = createWayfinderDocument("KWD");
  document.locale = "en-US";
  const scenario = {
    ...createCurrentScenario(document),
    id: "precision-example",
    label: "Precision example",
    currency: "JPY",
    fx: { rateToBase: 0.0025, asOf: "2026-08-15", source: "Example rate" },
    grossMonthly: 10_000.5,
    values: {
      ...createCurrentScenario(document).values,
      "automatic-retirement": 4_000.4,
    },
  };
  document.scenarios = [scenario];
  document.currentScenarioId = scenario.id;

  const html = createFamilyShareHtml(document, new Date("2026-08-16T10:00:00.000Z"));
  const savings = html.slice(html.indexOf('<div class="total-saving">'), html.indexOf('</section>', html.indexOf('<div class="total-saving">')));

  assert.match(savings, /JPY 10,001<small>KWD 25\.001 in the comparison currency<\/small>/);
  assert.match(savings, /Monthly investments<\/span><strong>JPY 4,000<small>KWD 10\.001 in the comparison currency<\/small>/);
  assert.match(savings, /Cash left after costs and planned investments<\/span><strong>JPY 6,001<small>KWD 15 in the comparison currency<\/small>/);
  assert.match(savings, /Cash shown is the balancing remainder after currency rounding; calculations retain full precision\./);
});

test("keeps a rounded negative cash remainder visible in both report currencies", () => {
  const document = createWayfinderDocument("KWD");
  document.locale = "en-US";
  const scenario = {
    ...createCurrentScenario(document),
    id: "negative-cash-example",
    label: "Negative cash example",
    currency: "USD",
    fx: { rateToBase: 0.5, asOf: "2026-08-15", source: "Example rate" },
    grossMonthly: 10.004,
    values: {
      ...createCurrentScenario(document).values,
      "automatic-retirement": 12.006,
    },
  };
  document.scenarios = [scenario];
  document.currentScenarioId = scenario.id;

  const html = createFamilyShareHtml(document, new Date("2026-08-16T10:00:00.000Z"));

  assert.match(html, /Cash left after costs and planned investments<\/span><strong>−USD 2\.01<small>−KWD 1\.001 in the comparison currency<\/small>/);
  assert.doesNotMatch(html, /−(?:USD|KWD) 0(?:\D|$)/);
});

test("marks the selected current position even when plans are reordered", () => {
  const document = testDocument();
  const current = document.scenarios[0];
  const alternative = {
    ...current,
    id: "family-view-alternative",
    label: "Later offer",
  };

  document.scenarios = [alternative, current];
  document.currentScenarioId = current.id;

  const html = createFamilyShareHtml(document, new Date("2026-08-16T10:00:00.000Z"));
  const currentCard = html.slice(html.indexOf("Berlin &lt;script&gt;alert(1)&lt;/script&gt;") - 350, html.indexOf("Berlin &lt;script&gt;alert(1)&lt;/script&gt;") + 100);
  const alternativeCard = html.slice(html.indexOf("Later offer") - 350, html.indexOf("Later offer") + 100);

  assert.match(currentCard, /Current job and home-country position/);
  assert.match(alternativeCard, /Possible job, move, or household plan/);
  assert.equal((html.match(/Current job and home-country position/g) ?? []).length, 1);
  assert.equal((html.match(/Possible job, move, or household plan/g) ?? []).length, 1);
});

test("escapes inputs and contains no active or remote content", () => {
  const html = createFamilyShareHtml(testDocument(), new Date("2026-08-16T10:00:00.000Z"));

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /Berlin &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script[\s>]/i);
  assert.doesNotMatch(html, /<(?:img|link|iframe|form)[\s>]/i);
  assert.match(html, /Housing &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /javascript:alert\(1\)&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /\b(?:owner|network)\b/i);
});
