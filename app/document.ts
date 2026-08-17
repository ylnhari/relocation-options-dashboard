import {
  DOCUMENT_KIND,
  SCHEMA_VERSION,
  createEmptySharedValues,
  createEmptyValues,
  createSharedEvidence,
  createScenarioEvidence,
  createStableId,
  createWayfinderDocument,
  type FieldGroup,
  type FieldScope,
  type Scenario,
  type WayfinderDocument,
} from "./scenarios";

export type ValidationIssue = {
  path: string;
  message: string;
};

export type DocumentResult =
  | {
      ok: true;
      document: WayfinderDocument;
      migrated: boolean;
    }
  | {
      ok: false;
      issues: ValidationIssue[];
    };

const ROOT_KEYS = new Set([
  "kind",
  "schemaVersion",
  "title",
  "baseCurrency",
  "locale",
  "fieldDefinitions",
  "sharedValues",
  "sharedEvidence",
  "excludedSupport",
  "researchItems",
  "projectionAssumptions",
  "scenarios",
  "migrationNotes",
  "updatedAt",
]);

const FIELD_KEYS = new Set([
  "id",
  "label",
  "description",
  "group",
  "scope",
]);

const SCENARIO_KEYS = new Set([
  "id",
  "flag",
  "label",
  "location",
  "employment",
  "status",
  "currency",
  "fx",
  "grossMonthly",
  "values",
  "evidence",
  "earners",
  "color",
  "spouseJob",
  "childcare",
  "transport",
  "residency",
  "bonus",
  "benefits",
  "risks",
]);

const FX_KEYS = new Set(["rateToBase", "asOf", "source"]);
const SUPPORT_KEYS = new Set(["id", "label", "monthlyBase", "note"]);
const PROJECTION_KEYS = new Set([
  "incomeGrowthPct",
  "expenseInflationPct",
  "years",
]);
const RESEARCH_KEYS = new Set([
  "id",
  "topic",
  "title",
  "finding",
  "appliesToScenarioIds",
  "status",
  "publisher",
  "sourceTitle",
  "sourceUrl",
  "asOf",
  "note",
]);
const EVIDENCE_KEYS = new Set(["status", "asOf", "source", "note"]);
const EVIDENCE_STATUSES = new Set(["confirmed", "estimate", "unknown"]);
const RESEARCH_TOPICS = new Set([
  "tax",
  "immigration",
  "housing",
  "childcare",
  "transport",
  "healthcare",
  "weather",
  "career",
  "familyTravel",
  "other",
]);
const RESEARCH_STATUSES = new Set(["verified", "estimate", "question"]);

const GROUPS = new Set<FieldGroup>([
  "deduction",
  "automaticInvestment",
  "livingCost",
  "commitment",
  "plannedInvestment",
]);
const SCOPES = new Set<FieldScope>(["perOption", "shared"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FIELD_DEFINITIONS = 100;
const MAX_SCENARIOS = 25;
const MAX_EXCLUDED_SUPPORT = 100;
const MAX_RESEARCH_ITEMS = 100;
const MAX_MIGRATION_NOTES = 50;
const MAX_LIST_ITEMS = 50;
const MAX_SCENARIO_REFERENCES = 25;
const MAX_VALUE_MAP_ENTRIES = 100;
const MAX_EVIDENCE_MAP_ENTRIES = MAX_VALUE_MAP_ENTRIES + 1;

const LEGACY_ROOT_KEYS = new Set(["scenarios"]);
const LEGACY_SCENARIO_KEYS = new Set([
  "id",
  "flag",
  "label",
  "location",
  "employment",
  "status",
  "currency",
  "fxToInr",
  "grossMonthly",
  "netMonthly",
  "localLiving",
  "indiaCommitments",
  "investmentTarget",
  "earners",
  "color",
  "spouseJob",
  "childcare",
  "transport",
  "residency",
  "bonus",
  "benefits",
  "risks",
]);
const LEGACY_REQUIRED_SCENARIO_KEYS = [
  "currency",
  "fxToInr",
  "grossMonthly",
  "netMonthly",
  "localLiving",
  "indiaCommitments",
  "investmentTarget",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: ValidationIssue[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "Unknown field." });
    }
  }
}

function validateMaxItems(
  value: unknown[],
  path: string,
  max: number,
  issues: ValidationIssue[],
) {
  if (value.length > max) {
    issues.push({ path, message: `Must contain at most ${max} items.` });
    return false;
  }
  return true;
}

function validateMaxMapEntries(
  value: Record<string, unknown>,
  path: string,
  max: number,
  issues: ValidationIssue[],
) {
  if (Object.keys(value).length > max) {
    issues.push({ path, message: `Must contain at most ${max} entries.` });
    return false;
  }
  return true;
}

function requiredString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { allowEmpty = false, max = 5000 } = {},
) {
  if (typeof value !== "string") {
    issues.push({ path, message: "Expected text." });
    return;
  }
  if (!allowEmpty && !value.trim()) {
    issues.push({ path, message: "Must not be empty." });
  }
  if (value.length > max) {
    issues.push({ path, message: `Must be at most ${max} characters.` });
  }
}

function finiteNumber(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {},
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "Expected a finite number." });
    return;
  }
  if (value < min || value > max) {
    issues.push({ path, message: `Must be between ${min} and ${max}.` });
  }
  if (integer && !Number.isInteger(value)) {
    issues.push({ path, message: "Expected a whole number." });
  }
}

function validateId(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  requiredString(value, path, issues, { max: 128 });
  if (typeof value === "string" && !ID_PATTERN.test(value)) {
    issues.push({
      path,
      message: "Use letters, numbers, dots, underscores, or hyphens.",
    });
  }
}

function validateCurrency(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  if (typeof value !== "string" || !CURRENCY_PATTERN.test(value)) {
    issues.push({ path, message: "Expected a three-letter uppercase currency code." });
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected a list of text values." });
    return;
  }
  if (!validateMaxItems(value, path, MAX_LIST_ITEMS, issues)) return;
  value.forEach((item, index) =>
    requiredString(item, `${path}[${index}]`, issues, { max: 1000 }),
  );
}

function validateEvidence(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an evidence object." });
    return;
  }
  unknownKeys(value, EVIDENCE_KEYS, path, issues);
  if (!EVIDENCE_STATUSES.has(String(value.status))) {
    issues.push({ path: `${path}.status`, message: "Expected confirmed, estimate, or unknown." });
  }
  if (
    value.asOf !== null &&
    !isValidCalendarDate(value.asOf)
  ) {
    issues.push({ path: `${path}.asOf`, message: "Expected a valid YYYY-MM-DD date or null." });
  }
  requiredString(value.source, `${path}.source`, issues, {
    allowEmpty: true,
    max: 1000,
  });
  requiredString(value.note, `${path}.note`, issues, {
    allowEmpty: true,
    max: 1000,
  });
  if (value.status === "confirmed" || value.status === "estimate") {
    if (typeof value.source !== "string" || value.source.trim().length === 0) {
      issues.push({
        path: `${path}.source`,
        message: `${value.status === "confirmed" ? "Confirmed" : "Estimated"} inputs require a source.`,
      });
    }
    if (value.asOf === null) {
      issues.push({
        path: `${path}.asOf`,
        message: `${value.status === "confirmed" ? "Confirmed" : "Estimated"} inputs require an as-of date.`,
      });
    }
  }
}

export function validateWayfinderDocument(value: unknown): DocumentResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", message: "Expected a JSON object." }] };
  }

  unknownKeys(value, ROOT_KEYS, "$", issues);
  if (value.kind !== DOCUMENT_KIND) {
    issues.push({ path: "$.kind", message: `Expected ${DOCUMENT_KIND}.` });
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      message: `Expected supported schema version ${SCHEMA_VERSION}.`,
    });
  }
  requiredString(value.title, "$.title", issues, { max: 160 });
  validateCurrency(value.baseCurrency, "$.baseCurrency", issues);
  requiredString(value.locale, "$.locale", issues, { max: 50 });
  requiredString(value.updatedAt, "$.updatedAt", issues, { max: 50 });

  if (!Array.isArray(value.fieldDefinitions)) {
    issues.push({ path: "$.fieldDefinitions", message: "Expected a list." });
  }

  const fields = Array.isArray(value.fieldDefinitions)
    ? validateMaxItems(value.fieldDefinitions, "$.fieldDefinitions", MAX_FIELD_DEFINITIONS, issues)
      ? value.fieldDefinitions
      : []
    : [];
  const fieldIds = new Set<string>();
  const perOptionIds = new Set<string>();
  const sharedIds = new Set<string>();

  fields.forEach((candidate, index) => {
    const path = `$.fieldDefinitions[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, message: "Expected a field definition object." });
      return;
    }
    unknownKeys(candidate, FIELD_KEYS, path, issues);
    validateId(candidate.id, `${path}.id`, issues);
    requiredString(candidate.label, `${path}.label`, issues, { max: 120 });
    requiredString(candidate.description, `${path}.description`, issues, {
      allowEmpty: true,
      max: 500,
    });
    if (!GROUPS.has(candidate.group as FieldGroup)) {
      issues.push({ path: `${path}.group`, message: "Unknown field group." });
    }
    if (!SCOPES.has(candidate.scope as FieldScope)) {
      issues.push({ path: `${path}.scope`, message: "Unknown field scope." });
    }
    if (
      ["deduction", "automaticInvestment", "livingCost"].includes(
        String(candidate.group),
      ) &&
      candidate.scope !== "perOption"
    ) {
      issues.push({
        path: `${path}.scope`,
        message: `${String(candidate.group)} fields must be perOption.`,
      });
    }
    if (typeof candidate.id === "string") {
      if (fieldIds.has(candidate.id)) {
        issues.push({ path: `${path}.id`, message: "Field IDs must be unique." });
      }
      fieldIds.add(candidate.id);
      if (candidate.scope === "perOption") perOptionIds.add(candidate.id);
      if (candidate.scope === "shared") sharedIds.add(candidate.id);
    }
  });

  if (!isRecord(value.sharedValues)) {
    issues.push({ path: "$.sharedValues", message: "Expected an object." });
  } else {
    const hasValidMapSize = validateMaxMapEntries(
      value.sharedValues,
      "$.sharedValues",
      MAX_VALUE_MAP_ENTRIES,
      issues,
    );
    for (const id of sharedIds) {
      if (!(id in value.sharedValues)) {
        issues.push({ path: `$.sharedValues.${id}`, message: "Shared field is missing." });
      }
    }
    for (const [id, amount] of hasValidMapSize ? Object.entries(value.sharedValues) : []) {
      if (!sharedIds.has(id)) {
        issues.push({ path: `$.sharedValues.${id}`, message: "Unknown shared field ID." });
      }
      finiteNumber(amount, `$.sharedValues.${id}`, issues);
    }
  }

  if (!isRecord(value.sharedEvidence)) {
    issues.push({ path: "$.sharedEvidence", message: "Expected an object." });
  } else {
    const hasValidMapSize = validateMaxMapEntries(
      value.sharedEvidence,
      "$.sharedEvidence",
      MAX_VALUE_MAP_ENTRIES,
      issues,
    );
    for (const id of sharedIds) {
      if (!(id in value.sharedEvidence)) {
        issues.push({ path: `$.sharedEvidence.${id}`, message: "Shared evidence is missing." });
      }
    }
    for (const [id, evidence] of hasValidMapSize ? Object.entries(value.sharedEvidence) : []) {
      if (!sharedIds.has(id)) {
        issues.push({ path: `$.sharedEvidence.${id}`, message: "Unknown shared field ID." });
      }
      validateEvidence(evidence, `$.sharedEvidence.${id}`, issues);
    }
  }

  if (!Array.isArray(value.excludedSupport)) {
    issues.push({ path: "$.excludedSupport", message: "Expected a list." });
  } else {
    if (!validateMaxItems(value.excludedSupport, "$.excludedSupport", MAX_EXCLUDED_SUPPORT, issues)) {
      // Do not traverse an oversized import after reporting the size limit.
    } else {
    const supportIds = new Set<string>();
    value.excludedSupport.forEach((candidate, index) => {
      const path = `$.excludedSupport[${index}]`;
      if (!isRecord(candidate)) {
        issues.push({ path, message: "Expected an excluded-support item." });
        return;
      }
      unknownKeys(candidate, SUPPORT_KEYS, path, issues);
      validateId(candidate.id, `${path}.id`, issues);
      requiredString(candidate.label, `${path}.label`, issues, { max: 120 });
      finiteNumber(candidate.monthlyBase, `${path}.monthlyBase`, issues);
      requiredString(candidate.note, `${path}.note`, issues, {
        allowEmpty: true,
        max: 1000,
      });
      if (typeof candidate.id === "string") {
        if (supportIds.has(candidate.id)) {
          issues.push({ path: `${path}.id`, message: "IDs must be unique." });
        }
        supportIds.add(candidate.id);
      }
    });
    }
  }

  const scenarioIdCandidates = new Set(
    Array.isArray(value.scenarios)
      ? value.scenarios
          .filter(isRecord)
          .map((scenario) => scenario.id)
          .filter((id): id is string => typeof id === "string")
      : [],
  );
  if (!Array.isArray(value.researchItems)) {
    issues.push({ path: "$.researchItems", message: "Expected a list." });
  } else {
    if (!validateMaxItems(value.researchItems, "$.researchItems", MAX_RESEARCH_ITEMS, issues)) {
      // Do not traverse an oversized import after reporting the size limit.
    } else {
    const researchIds = new Set<string>();
    value.researchItems.forEach((candidate, index) => {
      const path = `$.researchItems[${index}]`;
      if (!isRecord(candidate)) {
        issues.push({ path, message: "Expected a research item object." });
        return;
      }
      unknownKeys(candidate, RESEARCH_KEYS, path, issues);
      validateId(candidate.id, `${path}.id`, issues);
      if (!RESEARCH_TOPICS.has(String(candidate.topic))) {
        issues.push({ path: `${path}.topic`, message: "Unknown research topic." });
      }
      requiredString(candidate.title, `${path}.title`, issues, { max: 200 });
      requiredString(candidate.finding, `${path}.finding`, issues, { max: 5000 });
      if (!Array.isArray(candidate.appliesToScenarioIds)) {
        issues.push({ path: `${path}.appliesToScenarioIds`, message: "Expected a list." });
      } else if (!validateMaxItems(
        candidate.appliesToScenarioIds,
        `${path}.appliesToScenarioIds`,
        MAX_SCENARIO_REFERENCES,
        issues,
      )) {
        // Do not traverse an oversized import after reporting the size limit.
      } else {
        candidate.appliesToScenarioIds.forEach((id, scenarioIndex) => {
          validateId(id, `${path}.appliesToScenarioIds[${scenarioIndex}]`, issues);
          if (typeof id === "string" && !scenarioIdCandidates.has(id)) {
            issues.push({ path: `${path}.appliesToScenarioIds[${scenarioIndex}]`, message: "Unknown scenario ID." });
          }
        });
      }
      if (!RESEARCH_STATUSES.has(String(candidate.status))) {
        issues.push({ path: `${path}.status`, message: "Expected verified, estimate, or question." });
      }
      requiredString(candidate.publisher, `${path}.publisher`, issues, {
        allowEmpty: true,
        max: 300,
      });
      requiredString(candidate.sourceTitle, `${path}.sourceTitle`, issues, {
        allowEmpty: true,
        max: 500,
      });
      requiredString(candidate.sourceUrl, `${path}.sourceUrl`, issues, {
        allowEmpty: true,
        max: 2000,
      });
      if (
        typeof candidate.sourceUrl === "string" &&
        candidate.sourceUrl &&
        !/^https:\/\//i.test(candidate.sourceUrl)
      ) {
        issues.push({ path: `${path}.sourceUrl`, message: "Use an HTTPS source URL or leave it empty." });
      }
      if (
        candidate.asOf !== null &&
        !isValidCalendarDate(candidate.asOf)
      ) {
        issues.push({ path: `${path}.asOf`, message: "Expected a valid YYYY-MM-DD date or null." });
      }
      requiredString(candidate.note, `${path}.note`, issues, {
        allowEmpty: true,
        max: 2000,
      });
      if (candidate.status === "verified" || candidate.status === "estimate") {
        for (const [key, label] of [
          ["publisher", "publisher"],
          ["sourceTitle", "source title"],
          ["sourceUrl", "HTTPS source URL"],
        ] as const) {
          if (typeof candidate[key] !== "string" || candidate[key].trim().length === 0) {
            issues.push({
              path: `${path}.${key}`,
              message: `${candidate.status === "verified" ? "Verified" : "Estimated"} research requires a ${label}.`,
            });
          }
        }
        if (candidate.asOf === null) {
          issues.push({
            path: `${path}.asOf`,
            message: `${candidate.status === "verified" ? "Verified" : "Estimated"} research requires an as-of date.`,
          });
        }
      }
      if (typeof candidate.id === "string") {
        if (researchIds.has(candidate.id)) {
          issues.push({ path: `${path}.id`, message: "Research IDs must be unique." });
        }
        researchIds.add(candidate.id);
      }
    });
    }
  }

  if (!isRecord(value.projectionAssumptions)) {
    issues.push({ path: "$.projectionAssumptions", message: "Expected an object." });
  } else {
    unknownKeys(value.projectionAssumptions, PROJECTION_KEYS, "$.projectionAssumptions", issues);
    finiteNumber(
      value.projectionAssumptions.incomeGrowthPct,
      "$.projectionAssumptions.incomeGrowthPct",
      issues,
      { min: -25, max: 100 },
    );
    finiteNumber(
      value.projectionAssumptions.expenseInflationPct,
      "$.projectionAssumptions.expenseInflationPct",
      issues,
      { min: -25, max: 100 },
    );
    finiteNumber(
      value.projectionAssumptions.years,
      "$.projectionAssumptions.years",
      issues,
      { min: 1, max: 20, integer: true },
    );
  }

  if (!Array.isArray(value.migrationNotes)) {
    issues.push({ path: "$.migrationNotes", message: "Expected a list." });
  } else {
    if (validateMaxItems(value.migrationNotes, "$.migrationNotes", MAX_MIGRATION_NOTES, issues)) {
      validateStringArray(value.migrationNotes, "$.migrationNotes", issues);
    }
  }

  if (!Array.isArray(value.scenarios)) {
    issues.push({ path: "$.scenarios", message: "Expected a list." });
  } else {
    if (!validateMaxItems(value.scenarios, "$.scenarios", MAX_SCENARIOS, issues)) {
      // Do not traverse an oversized import after reporting the size limit.
    } else {
    const scenarioIds = new Set<string>();
    value.scenarios.forEach((candidate, index) => {
      const path = `$.scenarios[${index}]`;
      if (!isRecord(candidate)) {
        issues.push({ path, message: "Expected a scenario object." });
        return;
      }
      unknownKeys(candidate, SCENARIO_KEYS, path, issues);
      validateId(candidate.id, `${path}.id`, issues);
      requiredString(candidate.flag, `${path}.flag`, issues, { max: 3 });
      requiredString(candidate.label, `${path}.label`, issues, { max: 160 });
      requiredString(candidate.location, `${path}.location`, issues, { max: 240 });
      requiredString(candidate.employment, `${path}.employment`, issues, { max: 500 });
      requiredString(candidate.status, `${path}.status`, issues, { max: 120 });
      validateCurrency(candidate.currency, `${path}.currency`, issues);
      finiteNumber(candidate.grossMonthly, `${path}.grossMonthly`, issues);
      finiteNumber(candidate.earners, `${path}.earners`, issues, {
        min: 0,
        max: 20,
        integer: true,
      });
      if (typeof candidate.color !== "string" || !COLOR_PATTERN.test(candidate.color)) {
        issues.push({ path: `${path}.color`, message: "Expected a six-digit hex color." });
      }
      for (const key of [
        "spouseJob",
        "childcare",
        "transport",
        "residency",
        "bonus",
      ] as const) {
        requiredString(candidate[key], `${path}.${key}`, issues, {
          allowEmpty: true,
          max: 1000,
        });
      }
      validateStringArray(candidate.benefits, `${path}.benefits`, issues);
      validateStringArray(candidate.risks, `${path}.risks`, issues);

      if (!isRecord(candidate.fx)) {
        issues.push({ path: `${path}.fx`, message: "Expected an FX snapshot." });
      } else {
        unknownKeys(candidate.fx, FX_KEYS, `${path}.fx`, issues);
        finiteNumber(candidate.fx.rateToBase, `${path}.fx.rateToBase`, issues, {
          min: Number.EPSILON,
        });
        if (
          candidate.fx.asOf !== null &&
          !isValidCalendarDate(candidate.fx.asOf)
        ) {
          issues.push({
            path: `${path}.fx.asOf`,
            message: "Expected a valid YYYY-MM-DD date or null.",
          });
        }
        requiredString(candidate.fx.source, `${path}.fx.source`, issues, {
          allowEmpty: true,
          max: 500,
        });
        if (candidate.currency !== value.baseCurrency) {
          if (typeof candidate.fx.source !== "string" || candidate.fx.source.trim().length === 0) {
            issues.push({
              path: `${path}.fx.source`,
              message: "A non-base-currency option requires an FX source.",
            });
          }
          const isTransparentLegacyGap =
            candidate.fx.source === "Legacy import — verify this rate" &&
            Array.isArray(value.migrationNotes) &&
            value.migrationNotes.includes("Legacy FX rates had no as-of date and should be verified.");
          if (candidate.fx.asOf === null && !isTransparentLegacyGap) {
            issues.push({
              path: `${path}.fx.asOf`,
              message: "A non-base-currency option requires an FX as-of date.",
            });
          }
        }
        if (
          candidate.currency === value.baseCurrency &&
          typeof candidate.fx.rateToBase === "number" &&
          Math.abs(candidate.fx.rateToBase - 1) > 1e-9
        ) {
          issues.push({
            path: `${path}.fx.rateToBase`,
            message: "A base-currency option must use an FX rate of 1.",
          });
        }
      }

      if (!isRecord(candidate.values)) {
        issues.push({ path: `${path}.values`, message: "Expected an object." });
      } else {
        const valuesRecord = candidate.values;
        const hasValidMapSize = validateMaxMapEntries(
          valuesRecord,
          `${path}.values`,
          MAX_VALUE_MAP_ENTRIES,
          issues,
        );
        for (const id of perOptionIds) {
          if (!(id in valuesRecord)) {
            issues.push({ path: `${path}.values.${id}`, message: "Option field is missing." });
          }
        }
        for (const [id, amount] of hasValidMapSize ? Object.entries(valuesRecord) : []) {
          if (!perOptionIds.has(id)) {
            issues.push({ path: `${path}.values.${id}`, message: "Unknown option field ID." });
          }
          finiteNumber(amount, `${path}.values.${id}`, issues);
        }

        const gross =
          typeof candidate.grossMonthly === "number" ? candidate.grossMonthly : 0;
        const cashDeductions = fields
          .filter(
            (field) =>
              isRecord(field) &&
              field.scope === "perOption" &&
              ["deduction", "automaticInvestment"].includes(String(field.group)),
          )
          .reduce((total, field) => {
            const id = String(field.id);
            const amount = valuesRecord[id];
            return total + (typeof amount === "number" && Number.isFinite(amount) ? amount : 0);
          }, 0);
        if (cashDeductions > gross + 1e-9) {
          issues.push({
            path: `${path}.values`,
            message: "Deductions and automatic investments cannot exceed gross income.",
          });
        }
      }


      if (!isRecord(candidate.evidence)) {
        issues.push({ path: `${path}.evidence`, message: "Expected an object." });
      } else {
        const hasValidMapSize = validateMaxMapEntries(
          candidate.evidence,
          `${path}.evidence`,
          MAX_EVIDENCE_MAP_ENTRIES,
          issues,
        );
        const evidenceIds = new Set(["grossMonthly", ...perOptionIds]);
        for (const id of evidenceIds) {
          if (!(id in candidate.evidence)) {
            issues.push({ path: `${path}.evidence.${id}`, message: "Input evidence is missing." });
          }
        }
        for (const [id, evidence] of hasValidMapSize ? Object.entries(candidate.evidence) : []) {
          if (!evidenceIds.has(id)) {
            issues.push({ path: `${path}.evidence.${id}`, message: "Unknown evidence field ID." });
          }
          validateEvidence(evidence, `${path}.evidence.${id}`, issues);
        }
      }

      if (typeof candidate.id === "string") {
        if (scenarioIds.has(candidate.id)) {
          issues.push({ path: `${path}.id`, message: "Scenario IDs must be unique." });
        }
        scenarioIds.add(candidate.id);
      }
    });
    }
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    document: value as unknown as WayfinderDocument,
    migrated: false,
  };
}

type LegacyScenario = Record<string, unknown>;

function legacyNumber(value: unknown, path: string, issues: ValidationIssue[]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push({ path, message: "Legacy value must be a non-negative number." });
    return 0;
  }
  return value;
}

function legacyString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function migrateLegacy(value: unknown): DocumentResult {
  const root = Array.isArray(value) ? { scenarios: value } : value;
  if (!isRecord(root) || !Array.isArray(root.scenarios)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "Not a supported Wayfinder document." }],
    };
  }

  const issues: ValidationIssue[] = [];
  unknownKeys(root, LEGACY_ROOT_KEYS, "$", issues);
  if (!validateMaxItems(root.scenarios, "$.scenarios", MAX_SCENARIOS, issues)) {
    return { ok: false, issues };
  }
  if (root.scenarios.length === 0) {
    return {
      ok: false,
      issues: [{ path: "$.scenarios", message: "Expected a recognizable legacy scenario." }],
    };
  }
  root.scenarios.forEach((candidate, index) => {
    const path = `$.scenarios[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, message: "Expected a legacy scenario object." });
      return;
    }
    unknownKeys(candidate, LEGACY_SCENARIO_KEYS, path, issues);
    for (const key of LEGACY_REQUIRED_SCENARIO_KEYS) {
      if (!(key in candidate)) {
        issues.push({ path: `${path}.${key}`, message: "Missing required legacy field." });
      }
    }
  });
  if (issues.length) return { ok: false, issues };

  const document = createWayfinderDocument("INR");
  document.locale = "en-IN";
  document.fieldDefinitions = [
    ...document.fieldDefinitions,
    {
      id: "legacy-option-commitments",
      label: "Legacy option commitments",
      description: "Preserved from an older option; review in Shared settings.",
      group: "commitment",
      scope: "perOption",
    },
    {
      id: "legacy-option-investment",
      label: "Legacy option investment target",
      description: "Preserved from an older option; review in Shared settings.",
      group: "plannedInvestment",
      scope: "perOption",
    },
  ];
  document.sharedValues = createEmptySharedValues(document.fieldDefinitions);
  document.sharedEvidence = createSharedEvidence(document.fieldDefinitions);
  document.researchItems = [];
  document.migrationNotes = [
    "Legacy totals were preserved as option-level fields. Review which commitments and investments should become shared.",
    "Legacy gross-to-net differences were preserved as non-saving deductions because their original categories were not available.",
    "Legacy FX rates had no as-of date and should be verified.",
  ];

  document.scenarios = root.scenarios.map((raw, index) => {
    const path = `$.scenarios[${index}]`;
    const candidate: LegacyScenario = isRecord(raw) ? raw : {};
    if (!isRecord(raw)) {
      issues.push({ path, message: "Expected a legacy scenario object." });
    }
    const gross = legacyNumber(candidate.grossMonthly, `${path}.grossMonthly`, issues);
    const net = legacyNumber(candidate.netMonthly, `${path}.netMonthly`, issues);
    if (net > gross) {
      issues.push({ path: `${path}.netMonthly`, message: "Net income exceeds gross income." });
    }
    const values = createEmptyValues(document.fieldDefinitions);
    values["deduction-income-tax"] = Math.max(0, gross - net);
    values["living-leisure"] = legacyNumber(
      candidate.localLiving,
      `${path}.localLiving`,
      issues,
    );
    values["legacy-option-commitments"] = legacyNumber(
      candidate.indiaCommitments,
      `${path}.indiaCommitments`,
      issues,
    );
    values["legacy-option-investment"] = legacyNumber(
      candidate.investmentTarget,
      `${path}.investmentTarget`,
      issues,
    );

    const scenario: Scenario = {
      id: legacyString(candidate.id, createStableId("option")),
      flag: legacyString(candidate.flag, "OLD").slice(0, 3),
      label: legacyString(candidate.label, `Migrated option ${index + 1}`),
      location: legacyString(candidate.location, "Location not recorded"),
      employment: legacyString(candidate.employment, "Migrated household income"),
      status: legacyString(candidate.status, "Migrated"),
      currency: legacyString(candidate.currency, "INR").toUpperCase(),
      fx: {
        rateToBase: legacyNumber(candidate.fxToInr, `${path}.fxToInr`, issues),
        asOf: null,
        source: "Legacy import — verify this rate",
      },
      grossMonthly: gross,
      values,
      evidence: Object.fromEntries(
        Object.entries(createScenarioEvidence(document.fieldDefinitions)).map(
          ([id]) => [
            id,
            {
              status: "unknown",
              asOf: null,
              source: "Legacy import",
              note: "Review and confirm this migrated input.",
            },
          ],
        ),
      ),
      earners:
        typeof candidate.earners === "number" && Number.isInteger(candidate.earners)
          ? Math.max(0, candidate.earners)
          : 1,
      color:
        typeof candidate.color === "string" && COLOR_PATTERN.test(candidate.color)
          ? candidate.color
          : "#7cb8ff",
      spouseJob: legacyString(candidate.spouseJob, "Not recorded"),
      childcare: legacyString(candidate.childcare, "Not recorded"),
      transport: legacyString(candidate.transport, "Not recorded"),
      residency: legacyString(candidate.residency, "Not recorded"),
      bonus: legacyString(candidate.bonus, "Not included"),
      benefits: Array.isArray(candidate.benefits) ? candidate.benefits.map(String) : [],
      risks: Array.isArray(candidate.risks) ? candidate.risks.map(String) : [],
    };
    return scenario;
  });
  document.updatedAt = new Date().toISOString();

  if (issues.length) return { ok: false, issues };
  const validated = validateWayfinderDocument(document);
  if (!validated.ok) return validated;
  return { ok: true, document: validated.document, migrated: true };
}

export function parseWayfinderDocument(value: unknown): DocumentResult {
  if (isRecord(value) && ("kind" in value || "schemaVersion" in value)) {
    return validateWayfinderDocument(value);
  }
  return migrateLegacy(value);
}

export function syncDocumentFields(document: WayfinderDocument): WayfinderDocument {
  const perOption = new Set(
    document.fieldDefinitions
      .filter((field) => field.scope === "perOption")
      .map((field) => field.id),
  );
  const shared = new Set(
    document.fieldDefinitions
      .filter((field) => field.scope === "shared")
      .map((field) => field.id),
  );
  return {
    ...document,
    sharedValues: Object.fromEntries(
      [...shared].map((id) => [id, document.sharedValues[id] ?? 0]),
    ),
    sharedEvidence: Object.fromEntries(
      [...shared].map((id) => [
        id,
        document.sharedEvidence[id] ?? {
          status: "unknown",
          asOf: null,
          source: "",
          note: "",
        },
      ]),
    ),
    scenarios: document.scenarios.map((scenario) => ({
      ...scenario,
      values: Object.fromEntries(
        [...perOption].map((id) => [id, scenario.values[id] ?? 0]),
      ),
      evidence: Object.fromEntries(
        ["grossMonthly", ...perOption].map((id) => [
          id,
          scenario.evidence[id] ?? {
            status: "unknown",
            asOf: null,
            source: "",
            note: "",
          },
        ]),
      ),
    })),
  };
}

export function withFreshTimestamp(document: WayfinderDocument): WayfinderDocument {
  return { ...document, updatedAt: new Date().toISOString() };
}
