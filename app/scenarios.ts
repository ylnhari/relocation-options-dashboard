export const DOCUMENT_KIND = "wayfinder-relocation-plan" as const;
export const SCHEMA_VERSION = 4 as const;
export const STORAGE_KEY = "wayfinder.document.v4";
export const LEGACY_STORAGE_KEY = "wayfinder.relocation-scenarios.v1";
export const DEFAULT_BASE_CURRENCY = "USD";

export type FieldGroup =
  | "deduction"
  | "automaticInvestment"
  | "livingCost"
  | "commitment"
  | "plannedInvestment";

export type FieldScope = "perOption" | "shared";

export type FieldDefinition = {
  id: string;
  label: string;
  description: string;
  group: FieldGroup;
  scope: FieldScope;
};

export type ExcludedSupportItem = {
  id: string;
  label: string;
  monthlyBase: number;
  note: string;
};

export type FxSnapshot = {
  rateToBase: number;
  asOf: string | null;
  source: string;
};

export type EvidenceStatus = "confirmed" | "estimate" | "unknown";

export type InputEvidence = {
  status: EvidenceStatus;
  asOf: string | null;
  source: string;
  note: string;
};

export type ResearchTopic =
  | "tax"
  | "immigration"
  | "housing"
  | "childcare"
  | "transport"
  | "healthcare"
  | "weather"
  | "career"
  | "familyTravel"
  | "other";

export type ResearchStatus = "verified" | "estimate" | "question";

export type ResearchItem = {
  id: string;
  topic: ResearchTopic;
  title: string;
  finding: string;
  appliesToScenarioIds: string[];
  status: ResearchStatus;
  publisher: string;
  sourceTitle: string;
  sourceUrl: string;
  asOf: string | null;
  note: string;
};

export type Scenario = {
  id: string;
  flag: string;
  label: string;
  location: string;
  employment: string;
  status: string;
  currency: string;
  fx: FxSnapshot;
  grossMonthly: number;
  values: Record<string, number>;
  evidence: Record<string, InputEvidence>;
  earners: number;
  color: string;
  spouseJob: string;
  childcare: string;
  transport: string;
  residency: string;
  bonus: string;
  benefits: string[];
  risks: string[];
};

export type ProjectionAssumptions = {
  incomeGrowthPct: number;
  expenseInflationPct: number;
  years: number;
};

export type WayfinderDocument = {
  kind: typeof DOCUMENT_KIND;
  schemaVersion: typeof SCHEMA_VERSION;
  title: string;
  baseCurrency: string;
  locale: string;
  fieldDefinitions: FieldDefinition[];
  sharedValues: Record<string, number>;
  sharedEvidence: Record<string, InputEvidence>;
  excludedSupport: ExcludedSupportItem[];
  researchItems: ResearchItem[];
  projectionAssumptions: ProjectionAssumptions;
  scenarios: Scenario[];
  migrationNotes: string[];
  updatedAt: string;
};

type ScenarioIdRandomSource = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
};

function browserRandomSource(): ScenarioIdRandomSource | undefined {
  return typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
}

export function createStableId(
  prefix: string,
  source: ScenarioIdRandomSource | null | undefined = browserRandomSource(),
) {
  if (typeof source?.randomUUID === "function") {
    return `${prefix}-${source.randomUUID()}`;
  }

  if (typeof source?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return `${prefix}-${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createScenarioId(source?: ScenarioIdRandomSource | null) {
  return createStableId("option", source === undefined ? browserRandomSource() : source);
}

export const DEFAULT_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    id: "deduction-income-tax",
    label: "Income tax",
    description: "Income tax withheld from gross monthly compensation.",
    group: "deduction",
    scope: "perOption",
  },
  {
    id: "deduction-payroll",
    label: "Payroll and social deductions",
    description: "Mandatory payroll, social insurance, or similar non-saving deductions.",
    group: "deduction",
    scope: "perOption",
  },
  {
    id: "deduction-other",
    label: "Other cash deductions",
    description: "Other deductions that reduce take-home cash and are not investments.",
    group: "deduction",
    scope: "perOption",
  },
  {
    id: "automatic-retirement",
    label: "Payroll retirement or pension saving",
    description: "Automatic saving deducted from gross pay; counted as investment, not expense.",
    group: "automaticInvestment",
    scope: "perOption",
  },
  {
    id: "living-housing",
    label: "Housing",
    description: "Rent, mortgage interest, maintenance, or housing charges for this option.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-utilities",
    label: "Electricity, gas and water",
    description: "Monthly household utilities.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-connectivity",
    label: "Internet and mobile",
    description: "Home internet and household mobile plans.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-groceries",
    label: "Groceries and household",
    description: "Food, household supplies, and routine purchases.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-transport",
    label: "Transport",
    description: "Public transport, fuel, insurance, parking, and routine travel.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-childcare",
    label: "Childcare and education",
    description: "Childcare, school, and recurring education costs.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-healthcare",
    label: "Healthcare and insurance",
    description: "Medicines, health costs, and personal insurance paid from take-home cash.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "living-leisure",
    label: "Dining, leisure and other",
    description: "Dining, drinks, recreation, clothing, and other routine spending.",
    group: "livingCost",
    scope: "perOption",
  },
  {
    id: "shared-debt",
    label: "Debt repayments",
    description: "Loans or repayments that continue in every option.",
    group: "commitment",
    scope: "shared",
  },
  {
    id: "shared-remittances",
    label: "Family support or remittances paid",
    description: "Outgoing family costs that remain your responsibility in every option.",
    group: "commitment",
    scope: "shared",
  },
  {
    id: "shared-other-commitment",
    label: "Other shared commitments",
    description: "Other recurring obligations applied equally to every option.",
    group: "commitment",
    scope: "shared",
  },
  {
    id: "shared-market-investing",
    label: "Market investments",
    description: "Planned post-tax investing applied equally to every option.",
    group: "plannedInvestment",
    scope: "shared",
  },
  {
    id: "shared-other-investing",
    label: "Other planned investment",
    description: "Other planned saving or investment applied equally to every option.",
    group: "plannedInvestment",
    scope: "shared",
  },
];

export function perOptionFields(document: Pick<WayfinderDocument, "fieldDefinitions">) {
  return document.fieldDefinitions.filter((field) => field.scope === "perOption");
}

export function sharedFields(document: Pick<WayfinderDocument, "fieldDefinitions">) {
  return document.fieldDefinitions.filter((field) => field.scope === "shared");
}

export function createEmptyValues(fieldDefinitions: FieldDefinition[]) {
  return Object.fromEntries(
    fieldDefinitions
      .filter((field) => field.scope === "perOption")
      .map((field) => [field.id, 0]),
  );
}

export function createEmptySharedValues(fieldDefinitions: FieldDefinition[]) {
  return Object.fromEntries(
    fieldDefinitions
      .filter((field) => field.scope === "shared")
      .map((field) => [field.id, 0]),
  );
}

export function createUnknownEvidence(): InputEvidence {
  return { status: "unknown", asOf: null, source: "", note: "" };
}

export function createScenarioEvidence(fieldDefinitions: FieldDefinition[]) {
  return Object.fromEntries([
    ["grossMonthly", createUnknownEvidence()],
    ...fieldDefinitions
      .filter((field) => field.scope === "perOption")
      .map((field) => [field.id, createUnknownEvidence()]),
  ]);
}

export function createSharedEvidence(fieldDefinitions: FieldDefinition[]) {
  return Object.fromEntries(
    fieldDefinitions
      .filter((field) => field.scope === "shared")
      .map((field) => [field.id, createUnknownEvidence()]),
  );
}

export function createWayfinderDocument(
  baseCurrency = DEFAULT_BASE_CURRENCY,
): WayfinderDocument {
  const fields = DEFAULT_FIELD_DEFINITIONS.map((field) => ({ ...field }));
  return {
    kind: DOCUMENT_KIND,
    schemaVersion: SCHEMA_VERSION,
    title: "My relocation options",
    baseCurrency,
    locale: "en-US",
    fieldDefinitions: fields,
    sharedValues: createEmptySharedValues(fields),
    sharedEvidence: createSharedEvidence(fields),
    excludedSupport: [],
    researchItems: [],
    projectionAssumptions: {
      incomeGrowthPct: 5,
      expenseInflationPct: 3,
      years: 5,
    },
    scenarios: [],
    migrationNotes: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export const DEFAULT_DOCUMENT = createWayfinderDocument();
export const DEFAULT_SCENARIOS: Scenario[] = [];

export function createCurrentScenario(
  document: Pick<WayfinderDocument, "baseCurrency" | "fieldDefinitions"> = DEFAULT_DOCUMENT,
): Scenario {
  return {
    id: createScenarioId(),
    flag: "CUR",
    label: "",
    location: "",
    employment: "",
    status: "Current position",
    currency: document.baseCurrency,
    fx: { rateToBase: 1, asOf: null, source: "Base currency" },
    grossMonthly: 0,
    values: createEmptyValues(document.fieldDefinitions),
    evidence: createScenarioEvidence(document.fieldDefinitions),
    earners: 1,
    color: "#f6b44f",
    spouseJob: "",
    childcare: "",
    transport: "",
    residency: "",
    bonus: "",
    benefits: [],
    risks: [],
  };
}

export function createBlankScenario(
  document: Pick<WayfinderDocument, "baseCurrency" | "fieldDefinitions"> = DEFAULT_DOCUMENT,
): Scenario {
  return {
    id: createScenarioId(),
    flag: "NEW",
    label: "",
    location: "",
    employment: "",
    status: "Planning",
    currency: document.baseCurrency,
    fx: { rateToBase: 1, asOf: null, source: "Enter or verify this rate" },
    grossMonthly: 0,
    values: createEmptyValues(document.fieldDefinitions),
    evidence: createScenarioEvidence(document.fieldDefinitions),
    earners: 1,
    color: "#b997ff",
    spouseJob: "",
    childcare: "",
    transport: "",
    residency: "",
    bonus: "",
    benefits: [],
    risks: [],
  };
}
