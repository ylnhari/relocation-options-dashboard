import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const extensionlessTypeScriptResolver = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (/^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(\`${"${specifier}"}.ts\`, context);
    }
    throw error;
  }
}
`;

register(
  `data:text/javascript,${encodeURIComponent(extensionlessTypeScriptResolver)}`,
  import.meta.url,
);

const {
  isLegacyUndatedConversion,
  parseWayfinderDocument,
  validateWayfinderDocument,
} = await import("../app/document.ts");
const { createCurrentScenario, createWayfinderDocument } = await import("../app/scenarios.ts");
const execFile = promisify(execFileCallback);

const unknownEvidence = {
  status: "unknown",
  asOf: null,
  source: "",
  note: "",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentDocument() {
  const document = createWayfinderDocument("USD");
  const scenario = createCurrentScenario(document);
  scenario.id = "option-current";
  scenario.flag = "EX";
  scenario.label = "Fictional current option";
  scenario.location = "Example City";
  scenario.employment = "One fictional income";
  scenario.status = "Current test";
  document.scenarios = [scenario];
  document.currentScenarioId = scenario.id;
  return document;
}

function legacyScenario(overrides = {}) {
  return {
    id: "legacy-one",
    flag: "EX",
    label: "Legacy illustration",
    location: "Old Example",
    employment: "Illustrative role",
    status: "Legacy",
    currency: "INR",
    fxToInr: 1,
    grossMonthly: 1000,
    netMonthly: 800,
    localLiving: 300,
    indiaCommitments: 100,
    investmentTarget: 200,
    earners: 1,
    ...overrides,
  };
}

async function example(name) {
  return JSON.parse(
    await readFile(new URL(`../examples/${name}`, import.meta.url), "utf8"),
  );
}

test("validates the current v5 document shape and both public-safe examples", async () => {
  const result = validateWayfinderDocument(currentDocument());
  assert.equal(result.ok, true);

  for (const name of ["wayfinder.example.json", "wayfinder.template.json"]) {
    const fixture = await example(name);
    const parsed = parseWayfinderDocument(fixture);
    assert.equal(parsed.ok, true, name);
    assert.equal(parsed.migrated, false, name);
    if (name === "wayfinder.template.json") {
      assert.deepEqual(fixture.scenarios, []);
      assert.deepEqual(fixture.researchItems, []);
      assert.deepEqual(fixture.excludedSupport, []);
    }
  }
});

test("requires a current-position reference only when options exist", () => {
  const empty = createWayfinderDocument("USD");
  assert.equal(empty.currentScenarioId, null);
  assert.equal(validateWayfinderDocument(empty).ok, true);

  const missing = currentDocument();
  delete missing.currentScenarioId;
  const missingResult = validateWayfinderDocument(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.issues.some((issue) => issue.path === "$.currentScenarioId"));

  const unknown = currentDocument();
  unknown.currentScenarioId = "option-not-saved";
  const unknownResult = validateWayfinderDocument(unknown);
  assert.equal(unknownResult.ok, false);
  assert.ok(unknownResult.issues.some((issue) => (
    issue.path === "$.currentScenarioId"
    && issue.message.includes("saved place, job, or plan")
  )));

  const mismatched = currentDocument();
  mismatched.currentScenarioId = null;
  const mismatchedResult = validateWayfinderDocument(mismatched);
  assert.equal(mismatchedResult.ok, false);
  assert.ok(mismatchedResult.issues.some((issue) => issue.path === "$.currentScenarioId"));

  const nonNullEmpty = createWayfinderDocument("USD");
  nonNullEmpty.currentScenarioId = "option-current";
  assert.equal(validateWayfinderDocument(nonNullEmpty).ok, false);
});

test("rejects explicitly unsupported kinds or schemas and calculated or otherwise unknown fields", () => {
  const wrongVersion = currentDocument();
  wrongVersion.schemaVersion = 3;
  const versionResult = parseWayfinderDocument(wrongVersion);
  assert.equal(versionResult.ok, false);

  const wrongKind = currentDocument();
  wrongKind.kind = "unrelated-document";
  const kindResult = parseWayfinderDocument(wrongKind);
  assert.equal(kindResult.ok, false);

  const withCalculatedField = currentDocument();
  withCalculatedField.scenarios[0].netCashMonthly = 1234;
  const calculatedResult = validateWayfinderDocument(withCalculatedField);
  assert.equal(calculatedResult.ok, false);
  assert.ok(
    calculatedResult.issues.some((issue) => issue.path.endsWith(".netCashMonthly") && issue.message === "Unknown field."),
  );
});

test("requires provenance for financial evidence, research, and ordinary non-base FX", () => {
  const financial = currentDocument();
  financial.scenarios[0].evidence.grossMonthly = {
    status: "confirmed",
    asOf: null,
    source: "",
    note: "",
  };
  const financialResult = validateWayfinderDocument(financial);
  assert.equal(financialResult.ok, false);
  assert.ok(financialResult.issues.some((issue) => issue.path.endsWith("evidence.grossMonthly.source")));
  assert.ok(financialResult.issues.some((issue) => issue.path.endsWith("evidence.grossMonthly.asOf")));

  const research = currentDocument();
  research.researchItems = [{
    id: "research-provenance",
    topic: "housing",
    title: "Illustrative research",
    finding: "Test-only provenance check.",
    appliesToScenarioIds: ["option-current"],
    status: "verified",
    publisher: "",
    sourceTitle: "",
    sourceUrl: "http://example.com/source",
    asOf: null,
    note: "",
  }];
  const researchResult = validateWayfinderDocument(research);
  assert.equal(researchResult.ok, false);
  for (const suffix of ["publisher", "sourceTitle", "sourceUrl", "asOf"]) {
    assert.ok(researchResult.issues.some((issue) => issue.path.endsWith(suffix)));
  }

  const nonBaseFx = currentDocument();
  nonBaseFx.scenarios[0].currency = "CAD";
  nonBaseFx.scenarios[0].fx = { rateToBase: 0.74, asOf: null, source: "" };
  const fxResult = validateWayfinderDocument(nonBaseFx);
  assert.equal(fxResult.ok, false);
  assert.ok(fxResult.issues.some((issue) => issue.path.endsWith("fx.source")));
  assert.ok(fxResult.issues.some((issue) => issue.path.endsWith("fx.asOf")));
});

test("requires real Gregorian as-of dates for evidence, research, and FX", () => {
  const invalidDates = ["0000-01-01", "2026-99-99", "2025-02-29", "2026-02-29"];
  for (const asOf of invalidDates) {
    const financial = currentDocument();
    financial.scenarios[0].evidence.grossMonthly = {
      status: "confirmed",
      asOf,
      source: "Illustrative financial source",
      note: "",
    };
    const financialResult = validateWayfinderDocument(financial);
    assert.equal(financialResult.ok, false, `financial evidence ${asOf}`);
    assert.ok(financialResult.issues.some((issue) => issue.path.endsWith("evidence.grossMonthly.asOf")));

    const research = currentDocument();
    research.researchItems = [{
      id: "research-calendar",
      topic: "housing",
      title: "Illustrative calendar research",
      finding: "Test-only finding.",
      appliesToScenarioIds: ["option-current"],
      status: "verified",
      publisher: "Example publisher",
      sourceTitle: "Example source",
      sourceUrl: "https://example.com/calendar",
      asOf,
      note: "",
    }];
    const researchResult = validateWayfinderDocument(research);
    assert.equal(researchResult.ok, false, `research ${asOf}`);
    assert.ok(researchResult.issues.some((issue) => issue.path.endsWith("researchItems[0].asOf")));

    const fx = currentDocument();
    fx.scenarios[0].currency = "CAD";
    fx.scenarios[0].fx = { rateToBase: 0.74, asOf, source: "Illustrative FX source" };
    const fxResult = validateWayfinderDocument(fx);
    assert.equal(fxResult.ok, false, `FX ${asOf}`);
    assert.ok(fxResult.issues.some((issue) => issue.path.endsWith("fx.asOf")));
  }

  const leapDay = currentDocument();
  leapDay.scenarios[0].evidence.grossMonthly = {
    status: "estimate",
    asOf: "2024-02-29",
    source: "Illustrative financial source",
    note: "",
  };
  leapDay.scenarios[0].currency = "CAD";
  leapDay.scenarios[0].fx = {
    rateToBase: 0.74,
    asOf: "2024-02-29",
    source: "Illustrative FX source",
  };
  leapDay.researchItems = [{
    id: "research-leap-day",
    topic: "housing",
    title: "Illustrative leap-day research",
    finding: "Test-only finding.",
    appliesToScenarioIds: ["option-current"],
    status: "estimate",
    publisher: "Example publisher",
    sourceTitle: "Example source",
    sourceUrl: "https://example.com/leap-day",
    asOf: "2024-02-29",
    note: "",
  }];
  assert.equal(validateWayfinderDocument(leapDay).ok, true);
});

test("requires shared and per-option values and evidence to use their declared scopes", () => {
  const document = currentDocument();
  document.fieldDefinitions.push(
    {
      id: "option-local-commitment",
      label: "Local commitment",
      description: "A test-only per-option commitment.",
      group: "commitment",
      scope: "perOption",
    },
    {
      id: "shared-test-investment",
      label: "Shared investment",
      description: "A test-only shared planned investment.",
      group: "plannedInvestment",
      scope: "shared",
    },
  );
  document.scenarios[0].values["option-local-commitment"] = 25;
  document.scenarios[0].evidence["option-local-commitment"] = unknownEvidence;
  document.sharedValues["shared-test-investment"] = 50;
  document.sharedEvidence["shared-test-investment"] = unknownEvidence;
  assert.equal(validateWayfinderDocument(document).ok, true);

  const badOptionReference = clone(document);
  badOptionReference.scenarios[0].values["shared-test-investment"] = 50;
  const optionResult = validateWayfinderDocument(badOptionReference);
  assert.equal(optionResult.ok, false);
  assert.ok(optionResult.issues.some((issue) => issue.path.endsWith("values.shared-test-investment")));

  const badSharedReference = clone(document);
  badSharedReference.sharedValues["option-local-commitment"] = 25;
  const sharedResult = validateWayfinderDocument(badSharedReference);
  assert.equal(sharedResult.ok, false);
  assert.ok(sharedResult.issues.some((issue) => issue.path.endsWith("sharedValues.option-local-commitment")));
});

test("rejects an option atomically when a linked value or evidence entry is missing", () => {
  const missingValue = currentDocument();
  delete missingValue.scenarios[0].values["living-housing"];
  const valueResult = validateWayfinderDocument(missingValue);
  assert.equal(valueResult.ok, false);
  assert.ok(valueResult.issues.some((issue) =>
    issue.path.endsWith("values.living-housing") && issue.message === "Option field is missing.",
  ));

  const missingEvidence = currentDocument();
  delete missingEvidence.scenarios[0].evidence["living-housing"];
  const evidenceResult = validateWayfinderDocument(missingEvidence);
  assert.equal(evidenceResult.ok, false);
  assert.ok(evidenceResult.issues.some((issue) =>
    issue.path.endsWith("evidence.living-housing") && issue.message === "Input evidence is missing.",
  ));
});

test("validates structured research and rejects unknown scenario references or non-HTTPS URLs", () => {
  const document = currentDocument();
  document.researchItems = [{
    id: "research-housing",
    topic: "housing",
    title: "Illustrative housing research",
    finding: "This is a test-only finding.",
    appliesToScenarioIds: ["option-current"],
    status: "estimate",
    publisher: "Example publisher",
    sourceTitle: "Example source",
    sourceUrl: "https://example.com/housing",
    asOf: "2026-08-01",
    note: "",
  }];
  assert.equal(validateWayfinderDocument(document).ok, true);

  const unknownScenario = clone(document);
  unknownScenario.researchItems[0].appliesToScenarioIds = ["option-missing"];
  const referenceResult = validateWayfinderDocument(unknownScenario);
  assert.equal(referenceResult.ok, false);
  assert.ok(referenceResult.issues.some((issue) => issue.path.endsWith("appliesToScenarioIds[0]") && issue.message === "Unknown scenario ID."));

  const insecureSource = clone(document);
  insecureSource.researchItems[0].sourceUrl = "http://example.com/housing";
  const sourceResult = validateWayfinderDocument(insecureSource);
  assert.equal(sourceResult.ok, false);
  assert.ok(sourceResult.issues.some((issue) => issue.path.endsWith("sourceUrl") && issue.message.includes("HTTPS")));
});

test("CLI validates an example containing structured research", async () => {
  const script = fileURLToPath(new URL("../scripts/validate-data.mjs", import.meta.url));
  const fixture = fileURLToPath(new URL("../examples/wayfinder.example.json", import.meta.url));
  const { stdout, stderr } = await execFile(process.execPath, [script, fixture]);
  assert.equal(stderr, "");
  const output = JSON.parse(stdout);
  assert.equal(output.ok, true);
  assert.equal(output.migrated, false);
});

test("enforces base FX and prevents deductions plus automatic saving from exceeding gross", () => {
  const fxMismatch = currentDocument();
  fxMismatch.scenarios[0].fx.rateToBase = 1.01;
  const fxResult = validateWayfinderDocument(fxMismatch);
  assert.equal(fxResult.ok, false);
  assert.ok(fxResult.issues.some((issue) => issue.path.endsWith("fx.rateToBase")));

  const impossiblePay = currentDocument();
  impossiblePay.scenarios[0].grossMonthly = 100;
  impossiblePay.scenarios[0].values["deduction-income-tax"] = 80;
  impossiblePay.scenarios[0].values["automatic-retirement"] = 30;
  const payResult = validateWayfinderDocument(impossiblePay);
  assert.equal(payResult.ok, false);
  assert.ok(payResult.issues.some((issue) => issue.message.includes("cannot exceed gross income")));
});

test("migrates a valid legacy backup into a valid v5 document", () => {
  const legacy = {
    scenarios: [legacyScenario()],
  };
  const result = parseWayfinderDocument(legacy);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.document.schemaVersion, 5);
  const [scenario] = result.document.scenarios;
  assert.equal(scenario.values["legacy-gross-net-difference"], 200);
  assert.equal(scenario.values["legacy-aggregate-living"], 300);
  assert.equal(scenario.values["legacy-option-commitments"], 100);
  assert.equal(scenario.values["legacy-option-investment"], 200);
  assert.equal(scenario.values["deduction-income-tax"], 0);
  assert.equal(scenario.values["living-leisure"], 0);
  assert.equal(result.document.currentScenarioId, "legacy-one");
  assert.equal(scenario.fx.source, "");
  assert.equal(scenario.earners, 1);
  assert.deepEqual(
    [scenario.spouseJob, scenario.childcare, scenario.transport, scenario.residency, scenario.bonus],
    ["", "", "", "", ""],
  );
  assert.deepEqual(scenario.benefits, []);
  assert.deepEqual(scenario.risks, []);
  assert.deepEqual(result.document.migrationNotes, [
    "Legacy option-level commitments and investment targets were preserved for review; shared scope was not recorded.",
    "Legacy gross-to-net differences and aggregate living amounts were preserved in neutral review fields; original categories were not recorded.",
  ]);
  for (const evidence of Object.values(scenario.evidence)) {
    assert.deepEqual(evidence, unknownEvidence);
  }
  assert.equal(validateWayfinderDocument(result.document).ok, true);
});

test("rejects invalid legacy identity, currency, earner, and qualitative types", () => {
  const invalidCases = [
    ["id", "legacy identity must be valid", "id"],
    ["currency", "inr", "currency"],
    ["earners", 1.5, "earners"],
    ["spouseJob", 42, "spouseJob"],
    ["benefits", ["Recorded benefit", 42], "benefits[1]"],
  ];

  for (const [key, value, pathSuffix] of invalidCases) {
    const result = parseWayfinderDocument({
      scenarios: [legacyScenario({ [key]: value })],
    });
    assert.equal(result.ok, false, key);
    assert.ok(result.issues.some((issue) => issue.path.endsWith(pathSuffix)), key);
  }

  const missingEarner = legacyScenario();
  delete missingEarner.earners;
  const missingEarnerResult = parseWayfinderDocument({ scenarios: [missingEarner] });
  assert.equal(missingEarnerResult.ok, false);
  assert.ok(missingEarnerResult.issues.some((issue) => (
    issue.path.endsWith("earners")
    && issue.message === "Missing required legacy field."
  )));
});

test("rejects caller-authored migration notes", () => {
  const document = currentDocument();
  document.migrationNotes = ["An agent says this migration is complete."];

  const result = validateWayfinderDocument(document);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => (
    issue.path === "$.migrationNotes[0]"
    && issue.message.includes("system-generated legacy provenance")
  )));
});

test("accepts only the recognized legacy signature and rejects undated non-base conversions", () => {
  const unrelated = parseWayfinderDocument({ scenarios: [{ label: "Not a legacy record" }] });
  assert.equal(unrelated.ok, false);

  const unknownLegacyField = parseWayfinderDocument({
    scenarios: [legacyScenario({
      currency: "CAD",
      fxToInr: 60,
      discardedByOldImporter: "must not be ignored",
    })],
  });
  assert.equal(unknownLegacyField.ok, false);
  assert.ok(unknownLegacyField.issues.some((issue) => issue.path.endsWith("discardedByOldImporter")));

  const unknownLegacyRootField = parseWayfinderDocument({
    scenarios: [legacyScenario({ currency: "CAD", fxToInr: 60 })],
    discardedRootByOldImporter: true,
  });
  assert.equal(unknownLegacyRootField.ok, false);
  assert.ok(unknownLegacyRootField.issues.some((issue) => issue.path.endsWith("discardedRootByOldImporter")));

  const migratedNonBase = parseWayfinderDocument([
    legacyScenario({ currency: "CAD", fxToInr: 60 }),
  ]);
  assert.equal(migratedNonBase.ok, false);
  assert.ok(migratedNonBase.issues.some((issue) =>
    issue.path.endsWith("fx.asOf") && issue.message.includes("conversion date"),
  ));

  const recoverableStoredMigration = parseWayfinderDocument([
    legacyScenario({ currency: "CAD", fxToInr: 60 }),
  ], { allowLegacyConversionGap: true });
  assert.equal(recoverableStoredMigration.ok, true);
  assert.equal(
    isLegacyUndatedConversion(
      recoverableStoredMigration.document,
      recoverableStoredMigration.document.scenarios[0],
    ),
    true,
  );
  assert.equal(
    validateWayfinderDocument(recoverableStoredMigration.document).ok,
    false,
  );
  assert.equal(
    validateWayfinderDocument(recoverableStoredMigration.document, {
      allowLegacyConversionGap: true,
    }).ok,
    true,
  );

  const datedButUnverified = structuredClone(recoverableStoredMigration.document);
  datedButUnverified.scenarios[0].fx.asOf = "2026-08-17";
  const datedResult = validateWayfinderDocument(datedButUnverified, {
    allowLegacyConversionGap: true,
  });
  assert.equal(datedResult.ok, false);
  assert.ok(datedResult.issues.some((issue) =>
    issue.path.endsWith("fx.source") && issue.message.includes("real conversion source"),
  ));

  const repaired = structuredClone(recoverableStoredMigration.document);
  repaired.scenarios[0].fx = {
    rateToBase: 0.74,
    asOf: "2026-08-17",
    source: "Illustrative official FX reference",
  };
  assert.equal(isLegacyUndatedConversion(repaired, repaired.scenarios[0]), false);
  assert.equal(validateWayfinderDocument(repaired).ok, true);
  const roundTrip = parseWayfinderDocument(JSON.parse(JSON.stringify(repaired)));
  assert.equal(roundTrip.ok, true);
  assert.equal(roundTrip.migrated, false);
});

test("limits import collection and keyed-map sizes", () => {
  const tooManyScenarios = currentDocument();
  tooManyScenarios.scenarios = Array.from({ length: 26 }, () => clone(tooManyScenarios.scenarios[0]));
  const scenariosResult = validateWayfinderDocument(tooManyScenarios);
  assert.equal(scenariosResult.ok, false);
  assert.ok(scenariosResult.issues.some((issue) => issue.path === "$.scenarios" && issue.message.includes("at most 25")));

  const tooManyValues = currentDocument();
  for (let index = 0; index < 101; index += 1) {
    tooManyValues.scenarios[0].values[`extra-${index}`] = 0;
  }
  const valuesResult = validateWayfinderDocument(tooManyValues);
  assert.equal(valuesResult.ok, false);
  assert.ok(valuesResult.issues.some((issue) => issue.path.endsWith(".values") && issue.message.includes("at most 100 entries")));
});

test("preserves a v5 export through JSON export and parse", () => {
  const exported = JSON.stringify(currentDocument());
  const result = parseWayfinderDocument(JSON.parse(exported));
  assert.equal(result.ok, true);
  assert.equal(result.migrated, false);
  assert.equal(JSON.stringify(result.document), exported);
});

test("migrates a canonical v4 document losslessly and selects its first option", () => {
  const v4 = currentDocument();
  v4.schemaVersion = 4;
  delete v4.currentScenarioId;
  delete v4.legacyMigrationNotes;
  const original = structuredClone(v4);

  const result = parseWayfinderDocument(v4);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.document.schemaVersion, 5);
  assert.equal(result.document.currentScenarioId, "option-current");

  const { schemaVersion: originalVersion, ...originalFields } = original;
  const {
    schemaVersion: migratedVersion,
    currentScenarioId,
    legacyMigrationNotes,
    ...migratedFields
  } = result.document;
  assert.equal(originalVersion, 4);
  assert.equal(migratedVersion, 5);
  assert.equal(currentScenarioId, "option-current");
  assert.deepEqual(legacyMigrationNotes, []);
  assert.deepEqual(migratedFields, originalFields);
});

test("preserves arbitrary released-v4 migration notes outside v5 system provenance", () => {
  const v4 = currentDocument();
  v4.schemaVersion = 4;
  delete v4.currentScenarioId;
  delete v4.legacyMigrationNotes;
  v4.migrationNotes = [
    "A historical note from an older dashboard export.",
    "Another user-visible migration reminder.",
  ];

  const result = parseWayfinderDocument(v4);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.deepEqual(result.document.legacyMigrationNotes, v4.migrationNotes);
  assert.deepEqual(result.document.migrationNotes, [
    "Migration notes from a v4 file were retained for review.",
  ]);
});

test("requires repair instead of changing a historical v4 country badge", () => {
  const v4 = currentDocument();
  v4.schemaVersion = 4;
  delete v4.currentScenarioId;
  delete v4.legacyMigrationNotes;
  v4.scenarios[0].flag = "OLD";

  const result = parseWayfinderDocument(v4);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{
    path: "$.scenarios[0].flag",
    message: "This older country badge cannot be used as a two-letter country code. Replace it with the correct two-letter country code before importing; the original file is unchanged.",
  }]);
  assert.equal(v4.scenarios[0].flag, "OLD");
});
