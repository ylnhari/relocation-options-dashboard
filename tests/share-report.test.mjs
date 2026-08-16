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
  return document;
}

test("creates a self-contained, generic-currency family report", () => {
  const html = createFamilyShareHtml(testDocument(), new Date("2026-08-16T10:00:00.000Z"));

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Wayfinder · read-only family view/);
  assert.match(html, /EUR/);
  assert.match(html, /GBP 5[,.]000/);
  assert.match(html, /1 GBP = 1\.2 EUR/);
  assert.match(html, /Total monthly saving/);
  assert.match(html, /Total investments/);
  assert.match(html, /Cash remaining/);
  assert.match(html, /2 earners/);
  assert.match(html, /Shared/);
  assert.match(html, /Loan statement/);
  assert.match(html, /2026-08-01/);
  assert.match(html, /External help \/ family support — excluded/);
  assert.match(html, /not counted in gross income, deductions, net cash, living costs, commitments, investments, or total saving/i);
  assert.match(html, /Projection assumptions/);
  assert.match(html, /#7cb8ff/);
  assert.match(html, /Research and sources/);
  assert.match(html, /Applies to<\/dt><dd>Berlin &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/dd>/);
  assert.match(html, /href="https:\/\/research\.example\/rent\?city=sample&amp;year=2026"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
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
