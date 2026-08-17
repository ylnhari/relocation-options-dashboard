"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  DEFAULT_DOCUMENT,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  createBlankScenario,
  createCurrentScenario,
  createScenarioId,
  createStableId,
  createUnknownEvidence,
  createWayfinderDocument,
  type EvidenceStatus,
  type FieldDefinition,
  type FieldGroup,
  type FieldScope,
  type InputEvidence,
  type ResearchTopic,
  type Scenario,
  type WayfinderDocument,
} from "./scenarios";
import {
  isLegacyUndatedConversion,
  syncDocumentFields,
  withFreshTimestamp,
  type ValidationIssue,
} from "./document";
import {
  MAX_DOCUMENT_BYTES,
  validateWayfinderInput,
} from "./import-validator";
import {
  deriveScenario,
  projectScenario,
  type BreakdownItem,
  type DerivedScenario,
} from "./scenario-math";
import { createFamilyShareHtml } from "./share-report";
import { parseRuntimeSeed, shouldApplyRuntimeSeed } from "./runtime-seed";
import {
  baseToLocalAmount,
  formatEditableAmount,
  fxAfterCurrencyChange,
  hasUsableFxRate,
  localToBaseAmount,
  parseMoneyInput,
} from "./currency-input";
import {
  balanceSavingsDisplay,
  formatMoney,
} from "./money-display";

type DisplayMode = "base" | "local";
type StorageNotice = { tone: "warning" | "seed" | "error"; message: string };
type StoredPlanSnapshot =
  | {
      status: "valid";
      document: WayfinderDocument;
      migrated: boolean;
      source: "current" | "legacy";
      token: string;
      recoveryMessage: string | null;
    }
  | { status: "empty"; token: "empty" }
  | { status: "invalid"; token: string; message: string }
  | { status: "unavailable"; token: "unavailable"; message: string };
type StorageConflict = {
  snapshot: StoredPlanSnapshot;
  reason: "event" | "write";
};
type ProjectionMetric =
  | "grossBase"
  | "netCashBase"
  | "totalSavingBase"
  | "totalInvestmentBase"
  | "cashRemainingBase";
type ProjectionInputDraft = {
  incomeGrowthPct: string;
  expenseInflationPct: string;
  years: string;
};
type ValidationLabelContext = {
  fieldDefinitions: Array<Pick<FieldDefinition, "id" | "label">>;
  scenarios?: Array<Pick<Scenario, "label">>;
};
type PendingPerOptionAmounts = Record<string, Set<string>>;

const STORAGE_LOCK_NAME = "wayfinder-browser-storage-v4";
const STORAGE_LOCK_DB_NAME = "wayfinder-coordination";
const STORAGE_LOCK_DB_VERSION = 1;
const STORAGE_LOCK_STORE = "browser-storage-locks";
const RECOVERY_STORAGE_KEY = "wayfinder.recovery.invalid-browser-draft.v1";
const RECOVERY_NOTICE_MESSAGE = "We saved a raw copy of unreadable browser data. It may contain private figures and cannot be imported as a comparison.";
const LONG_EDITOR_SECTION_SIZE = 4;

const groupMeta: Record<
  FieldGroup,
  { title: string; short: string; help: string }
> = {
  deduction: {
    title: "Tax and other deductions",
    short: "Tax and other deductions",
    help: "Enter each monthly tax or other non-saving deduction that reduces cash available after gross income. These amounts are not counted as saving.",
  },
  automaticInvestment: {
    title: "Monthly automatic payroll savings (PF, pension, or similar)",
    short: "Automatic payroll savings",
    help: "Enter monthly PF, pension, retirement, or similar saving taken from gross income. These amounts count toward total saved or left each month, not living costs.",
  },
  livingCost: {
    title: "Monthly living costs",
    short: "Living costs",
    help: "Enter regular household spending for this place, job, or plan in its own currency. These monthly costs reduce cash left each month.",
  },
  commitment: {
    title: "Monthly obligations that continue",
    short: "Monthly obligations that continue",
    help: "Examples include monthly money sent home, loan payments, or insurance. Enter an obligation separately when it changes by plan; enter it once in the home currency only when the same obligation applies identically to every plan, so it counts exactly once.",
  },
  plannedInvestment: {
    title: "Monthly investments from after-tax cash",
    short: "Monthly investments",
    help: "These monthly amounts come from after-tax cash and count toward total saved or left each month, not living costs. Enter one amount once for every plan in the home currency only when it applies to every plan.",
  },
};

const researchTopicLabels: Record<ResearchTopic, string> = {
  tax: "Tax and payroll",
  immigration: "Immigration and visas",
  housing: "Housing and rent",
  childcare: "Childcare and education",
  transport: "Transport",
  healthcare: "Healthcare",
  weather: "Weather and lifestyle",
  career: "Career and job market",
  familyTravel: "Family visits and travel",
  other: "Other research",
};

const projectionMeta: Record<
  ProjectionMetric,
  { label: string; cumulative: string; explanation: string }
> = {
  grossBase: {
    label: "Monthly gross income before deductions",
    cumulative: "cumulative gross income before deductions",
    explanation: "Before tax, other deductions, living costs, commitments, or saving contributions.",
  },
  netCashBase: {
    label: "Take-home cash",
    cumulative: "cumulative take-home cash",
    explanation: "Gross compensation less non-saving deductions and automatic payroll investments.",
  },
  totalSavingBase: {
    label: "Total saved or left each month",
    cumulative: "cumulative total saved or left",
    explanation: "Monthly automatic and planned investments plus cash left after living costs and commitments.",
  },
  totalInvestmentBase: {
    label: "Monthly investments",
    cumulative: "cumulative monthly investments",
    explanation: "Automatic payroll saving plus planned investments from after-tax cash.",
  },
  cashRemainingBase: {
    label: "Cash left each month",
    cumulative: "cumulative cash left",
    explanation: "Cash left after living costs, commitments, and planned investments.",
  },
};

function cloneDocument(document: WayfinderDocument) {
  return JSON.parse(JSON.stringify(document)) as WayfinderDocument;
}

function fingerprint(value: string | null) {
  if (value === null) return "missing";
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseStoredPlan(value: string | null) {
  if (value === null) return { status: "missing" as const };
  try {
    if (new Blob([value]).size > MAX_DOCUMENT_BYTES) {
      return {
        status: "invalid" as const,
        message: "The saved comparison file exceeds the 2 MiB limit.",
      };
    }
    const result = validateWayfinderInput(JSON.parse(value), {
      allowLegacyConversionGap: true,
    });
    if (!result.ok) {
      const first = result.issues[0];
      return {
        status: "invalid" as const,
        message: `${first?.path ?? "Document"}: ${first?.message ?? "Invalid data"}`,
      };
    }
    return {
      status: "valid" as const,
      document: syncDocumentFields(result.document),
      migrated: result.migrated,
    };
  } catch {
    return {
      status: "invalid" as const,
      message: "The saved value is not valid Wayfinder JSON.",
    };
  }
}

function inspectBrowserStorage(): StoredPlanSnapshot {
  let currentRaw: string | null = null;
  let legacyRaw: string | null = null;
  const accessErrors: string[] = [];

  try {
    currentRaw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    accessErrors.push("current storage");
  }
  try {
    legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    accessErrors.push("older storage");
  }
  if (accessErrors.length) {
    return {
      status: "unavailable",
      token: "unavailable",
      message: `Browser storage is unavailable (${accessErrors.join(" and ")}). Your changes have not been saved.`,
    };
  }

  // These keys are intentionally parsed independently. A damaged current value
  // must never hide a valid older document behind the null-coalescing operator.
  const current = parseStoredPlan(currentRaw);
  const legacy = parseStoredPlan(legacyRaw);
  if (current.status === "valid") {
    return {
      status: "valid",
      document: current.document,
      migrated: current.migrated,
      source: "current",
      token: `current:${current.document.updatedAt}:${fingerprint(currentRaw)}`,
      recoveryMessage: null,
    };
  }
  if (legacy.status === "valid") {
    const damagedCurrent = current.status === "invalid";
    return {
      status: "valid",
      document: legacy.document,
      migrated: legacy.migrated,
      source: "legacy",
      token: `legacy:${legacy.document.updatedAt}:${fingerprint(legacyRaw)}:current-${fingerprint(currentRaw)}`,
      recoveryMessage: damagedCurrent
        ? "Recovered your valid older browser draft because the current saved draft is unreadable. Nothing was overwritten."
        : "Restored an older browser draft. It will move to current storage after your next successful save.",
    };
  }
  if (current.status === "invalid" || legacy.status === "invalid") {
    const details = [
      current.status === "invalid" ? `Current draft: ${current.message}` : "",
      legacy.status === "invalid" ? `Older draft: ${legacy.message}` : "",
    ].filter(Boolean);
    return {
      status: "invalid",
      token: `invalid:${fingerprint(currentRaw)}:${fingerprint(legacyRaw)}`,
      message: `${details.join(" ")} Nothing was overwritten.`,
    };
  }
  return { status: "empty", token: "empty" };
}

function withRevisionAfter(document: WayfinderDocument, previous: string | null) {
  const stamped = withFreshTimestamp(document);
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  if (Number.isFinite(previousTime) && Date.parse(stamped.updatedAt) <= previousTime) {
    return { ...stamped, updatedAt: new Date(previousTime + 1).toISOString() };
  }
  return stamped;
}

function saveInvalidBrowserRecovery() {
  try {
    const currentRaw = window.localStorage.getItem(STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (new Blob([currentRaw ?? "", legacyRaw ?? ""]).size > MAX_DOCUMENT_BYTES) {
      return {
        ok: false as const,
        message: "The unreadable browser draft is too large to save a recovery copy. The starter comparison was not applied.",
      };
    }
    const serialized = JSON.stringify({
      kind: "wayfinder-invalid-browser-recovery",
      version: 1,
      capturedAt: new Date().toISOString(),
      current: currentRaw,
      legacy: legacyRaw,
    });
    if (new Blob([serialized]).size > MAX_DOCUMENT_BYTES) {
      return {
        ok: false as const,
        message: "The unreadable browser draft is too large to save a recovery copy. The starter comparison was not applied.",
      };
    }
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, serialized);
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      message: "A recovery copy of the unreadable browser draft could not be saved. The starter comparison was not applied.",
    };
  }
}

function inspectRecoveryCopy() {
  try {
    const serialized = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!serialized) return { status: "missing" as const };
    if (new Blob([serialized]).size > MAX_DOCUMENT_BYTES) {
      return { status: "invalid" as const };
    }
    return { status: "available" as const };
  } catch {
    return { status: "unavailable" as const };
  }
}

function openStorageLockDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window) || !window.indexedDB) {
      reject(new Error("IndexedDB is unavailable for browser-storage locking."));
      return;
    }

    let settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("IndexedDB lock setup failed."));
    };

    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(
        STORAGE_LOCK_DB_NAME,
        STORAGE_LOCK_DB_VERSION,
      );
    } catch (error) {
      rejectOnce(error);
      return;
    }

    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORAGE_LOCK_STORE)) {
          database.createObjectStore(STORAGE_LOCK_STORE);
        }
      } catch (error) {
        request.transaction?.abort();
        rejectOnce(error);
      }
    };
    request.onblocked = () => {
      rejectOnce(new Error("IndexedDB lock setup was blocked by another version."));
    };
    request.onerror = () => {
      rejectOnce(request.error ?? new Error("IndexedDB lock database failed to open."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        // A blocked or failed request can later succeed after this caller has
        // already failed closed. Do not leak that late connection.
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

async function withIndexedDbStorageLock<T>(operation: () => T) {
  const database = await openStorageLockDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let operationRan = false;
    let operationError: unknown = null;
    let transaction: IDBTransaction;

    const rejectWithCleanup = (error: unknown) => {
      database.close();
      reject(error instanceof Error ? error : new Error("IndexedDB lock transaction failed."));
    };

    try {
      // Read-write transactions on the same object store are queued across
      // tabs. The synchronous storage callback runs from the marker request's
      // success event while this transaction still owns the store.
      transaction = database.transaction(STORAGE_LOCK_STORE, "readwrite");
      const markerRequest = transaction.objectStore(STORAGE_LOCK_STORE).put(
        { touchedAt: Date.now() },
        STORAGE_LOCK_NAME,
      );

      markerRequest.onsuccess = () => {
        try {
          result = operation();
          operationRan = true;
        } catch (error) {
          operationError = error;
          transaction.abort();
        }
      };
      markerRequest.onerror = () => {
        operationError = markerRequest.error;
      };
      transaction.oncomplete = () => {
        database.close();
        if (!operationRan) {
          reject(new Error("IndexedDB lock completed before the storage operation ran."));
          return;
        }
        resolve(result as T);
      };
      transaction.onabort = () => {
        rejectWithCleanup(
          operationError ?? transaction.error ?? new Error("IndexedDB lock transaction aborted."),
        );
      };
      transaction.onerror = () => {
        operationError ??= transaction.error;
      };
    } catch (error) {
      rejectWithCleanup(error);
    }
  });
}

async function withStorageMutationLock<T>(operation: () => T) {
  const indexedDbLockedOperation = () => withIndexedDbStorageLock(operation);
  if ("locks" in navigator && navigator.locks) {
    return navigator.locks.request(
      STORAGE_LOCK_NAME,
      { mode: "exclusive" },
      indexedDbLockedOperation,
    );
  }
  // IndexedDB is the common lock domain for every tab, including tabs wrapped
  // by Web Locks. If it is absent, blocked, or fails to initialize, this rejects
  // and the caller leaves storage intact rather than running unlocked.
  return indexedDbLockedOperation();
}

function hasMeaningfulEvidence(evidence: InputEvidence | undefined) {
  if (!evidence) return false;
  return (
    evidence.status !== "unknown" ||
    evidence.source.trim().length > 0 ||
    Boolean(evidence.asOf) ||
    evidence.note.trim().length > 0
  );
}

function currencyCode(value: string) {
  return value.trim().toUpperCase().slice(0, 3);
}

function friendlyValidationIssue(
  issue: ValidationIssue,
  document: ValidationLabelContext,
) {
  const directLabels: Array<[string, string]> = [
    [".fx.rateToBase", "Conversion ratio"],
    [".fx.asOf", "Conversion date"],
    [".fx.source", "Conversion source"],
    [".grossMonthly", "Monthly gross income before tax and deductions"],
    [".currency", "Currency used in this place, job, or plan"],
    [".employment", "Who earns income in this plan"],
    [".location", "Place or location"],
    [".label", "Name or label"],
    [".status", "Plan stage"],
    [".flag", "Flag country code"],
    [".earners", "Number of earners counted in this plan"],
    [".spouseJob", "Partner income included in this plan"],
    [".childcare", "Childcare arrangement and monthly cost included"],
    [".transport", "Transport choice and monthly cost included"],
    [".residency", "Residence or visa condition"],
    [".bonus", "Bonus or one-time payment treatment"],
    [".benefits", "Benefits included in this plan"],
    [".risks", "Important details still to verify"],
    [".sourceUrl", "Source link"],
    [".sourceTitle", "Source title"],
    [".publisher", "Publisher"],
    [".finding", "Finding"],
    ["$.baseCurrency", "Home currency for all charts and totals"],
    ["$.locale", "Number format"],
    ["$.title", "Comparison title"],
    ["$.projectionAssumptions.incomeGrowthPct", "Annual income growth"],
    ["$.projectionAssumptions.expenseInflationPct", "Annual expense inflation"],
    ["$.projectionAssumptions.years", "Projection years"],
  ];
  const field = document.fieldDefinitions.find((candidate) =>
    issue.path.includes(`.${candidate.id}`),
  );
  const direct = directLabels.find(([suffix]) =>
    suffix.startsWith("$") ? issue.path === suffix : issue.path.endsWith(suffix),
  );
  const label = field?.label ?? direct?.[1] ?? "Comparison file";
  const scenarioIndex = /^\$\.scenarios\[(\d+)\]/.exec(issue.path)?.[1];
  const scenarioLabel = scenarioIndex === undefined
    ? ""
    : document.scenarios?.[Number(scenarioIndex)]?.label?.trim() ?? "";
  const message = issue.message
    .replaceAll("base-currency", "comparison-currency")
    .replaceAll("FX", "conversion");
  return `${scenarioLabel ? `${scenarioLabel} — ` : ""}${label}: ${message}`;
}

function validationLabelContext(value: unknown): ValidationLabelContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fieldDefinitions: [] };
  }
  const record = value as Record<string, unknown>;
  const fieldDefinitions = Array.isArray(record.fieldDefinitions)
    ? record.fieldDefinitions.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const field = candidate as Record<string, unknown>;
        return typeof field.id === "string" && typeof field.label === "string"
          ? [{ id: field.id, label: field.label }]
          : [];
      })
    : [];
  const scenarios = Array.isArray(record.scenarios)
    ? record.scenarios.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { label: "" };
        const label = (candidate as Record<string, unknown>).label;
        return { label: typeof label === "string" ? label : "" };
      })
    : undefined;
  return { fieldDefinitions, scenarios };
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function balancedScenarioSavings(
  scenario: DerivedScenario,
  document: WayfinderDocument,
) {
  const localInvestments = scenario.fx.rateToBase > 0
    ? scenario.totalInvestmentBase / scenario.fx.rateToBase
    : 0;
  return {
    local: balanceSavingsDisplay(
      scenario.totalSavingMonthly,
      localInvestments,
      scenario.currency,
    ),
    base: balanceSavingsDisplay(
      scenario.totalSavingBase,
      scenario.totalInvestmentBase,
      document.baseCurrency,
    ),
  };
}

function EditorSection({
  title,
  summary,
  note,
  collapsible = false,
  children,
}: {
  title: string;
  summary?: string;
  note?: string;
  collapsible?: boolean;
  children: ReactNode;
}) {
  if (collapsible) {
    return (
      <details className="editor-section collapsible-editor-section">
        <summary><strong>{title}</strong>{summary && <span>{summary}</span>}</summary>
        <div className="collapsible-editor-body">
          {note && <p className="field-note">{note}</p>}
          {children}
        </div>
      </details>
    );
  }

  return (
    <fieldset className="editor-section">
      <legend>{title}</legend>
      {note && <p className="field-note">{note}</p>}
      {children}
    </fieldset>
  );
}

function FormErrorSummary({
  notice,
  issues,
  document,
}: {
  notice: string;
  issues: ValidationIssue[];
  document: ValidationLabelContext;
}) {
  if (!notice && issues.length === 0) return null;
  return (
    <div className="form-error-summary" role="alert">
      <strong>{notice || "This information is not saved yet. Fix the fields below."}</strong>
      {issues.length > 0 && (
        <ul>
          {issues.slice(0, 8).map((issue, index) => (
            <li key={`${issue.path}-${index}`}>{friendlyValidationIssue(issue, document)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CurrencyAmountEditor({
  id,
  label,
  description,
  localAmount,
  localCurrency,
  baseCurrency,
  rateToBase,
  entered,
  onChangeLocal,
}: {
  id: string;
  label: string;
  description?: string;
  localAmount: number;
  localCurrency: string;
  baseCurrency: string;
  rateToBase: number;
  entered: boolean;
  onChangeLocal: (amount: number | null) => void;
}) {
  const [localDraft, setLocalDraft] = useState<string | null>(null);
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  const sameCurrency = localCurrency === baseCurrency;
  const usableRate = sameCurrency || hasUsableFxRate(rateToBase);
  const effectiveRate = sameCurrency ? 1 : rateToBase;
  const baseAmount = localToBaseAmount(localAmount, effectiveRate);
  const descriptionId = `${id}-currency-help`;

  const updateLocalText = (value: string) => {
    setLocalDraft(value);
    if (value.trim().length === 0) {
      onChangeLocal(null);
      setBaseDraft(null);
      return;
    }
    const amount = parseMoneyInput(value);
    if (amount !== null) {
      onChangeLocal(amount);
      setBaseDraft(null);
    }
  };

  const updateBaseText = (value: string) => {
    setBaseDraft(value);
    if (value.trim().length === 0) {
      onChangeLocal(null);
      setLocalDraft(null);
      return;
    }
    const amount = parseMoneyInput(value);
    const converted = amount === null ? null : baseToLocalAmount(amount, effectiveRate);
    if (converted !== null) {
      onChangeLocal(converted);
      setLocalDraft(null);
    }
  };

  const finishLocalEdit = () => {
    if (localDraft !== null && parseMoneyInput(localDraft) !== null) setLocalDraft(null);
  };

  const finishBaseEdit = () => {
    if (baseDraft !== null && parseMoneyInput(baseDraft) !== null) setBaseDraft(null);
  };

  return (
    <div className="currency-amount-editor" role="group" aria-labelledby={`${id}-label`}>
      <div className="currency-amount-copy" id={`${id}-label`}>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      <div className={`currency-input-pair ${sameCurrency ? "same-currency" : ""}`}>
        <label>
          <span>{sameCurrency ? "Home currency for all charts and totals" : "Currency used in this place, job, or plan"} <b>{localCurrency}</b></span>
          <input
            aria-describedby={descriptionId}
            aria-label={`${label} in ${localCurrency}`}
            required
            min="0"
            step="any"
            inputMode="decimal"
            type="number"
            value={localDraft ?? (entered ? formatEditableAmount(localAmount) : "")}
            onChange={(event) => updateLocalText(event.target.value)}
            onBlur={finishLocalEdit}
          />
        </label>
        {!sameCurrency && (
          <>
            <span className="currency-link" aria-hidden="true">=</span>
            <label>
              <span>Home currency for all charts and totals <b>{baseCurrency}</b></span>
              <input
                aria-describedby={descriptionId}
                aria-label={`${label} in ${baseCurrency}`}
                required
                min="0"
                step="any"
                inputMode="decimal"
                type="number"
                disabled={!usableRate}
                value={baseDraft ?? (entered ? formatEditableAmount(baseAmount) : "")}
                onChange={(event) => updateBaseText(event.target.value)}
                onBlur={finishBaseEdit}
              />
            </label>
          </>
        )}
      </div>
      <small className="currency-conversion-note" id={descriptionId}>
        {sameCurrency
          ? `This place, job, or plan and every chart and total use the ${baseCurrency} home currency.`
          : usableRate
            ? `Edit either amount. Linked using 1 ${localCurrency} = ${formatEditableAmount(rateToBase)} ${baseCurrency}.`
            : `Enter a positive conversion ratio above to calculate the amount in ${baseCurrency}, the home currency that anchors all charts and totals.`}
      </small>
      {!sameCurrency && usableRate && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {formatEditableAmount(localAmount)} {localCurrency} equals {formatEditableAmount(baseAmount)} {baseCurrency}.
        </span>
      )}
    </div>
  );
}

function flagGlyph(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return code.slice(0, 3).toUpperCase();
  return String.fromCodePoint(
    ...[...code].map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

function MoneyValue({
  local,
  base,
  scenario,
  document,
  mode,
  className = "",
}: {
  local: number;
  base: number;
  scenario: Scenario;
  document: WayfinderDocument;
  mode: DisplayMode;
  className?: string;
}) {
  return (
    <span className={`money-value ${className}`}>
      <strong>
        {mode === "base"
          ? formatMoney(base, document.baseCurrency, document.locale)
          : formatMoney(local, scenario.currency, document.locale)}
      </strong>
      <small>
        {mode === "base"
          ? formatMoney(local, scenario.currency, document.locale)
          : formatMoney(base, document.baseCurrency, document.locale)}
      </small>
    </span>
  );
}

function EvidenceBadge({ evidence }: { evidence: InputEvidence }) {
  return (
    <span className={`evidence-badge ${evidence.status}`}>
      {evidence.status === "confirmed"
        ? "Confirmed"
        : evidence.status === "estimate"
          ? "Estimate"
          : "Needs source"}
    </span>
  );
}

function EvidenceEditor({
  evidence,
  onChange,
  title = "How reliable is this number?",
}: {
  evidence: InputEvidence;
  onChange: (next: InputEvidence) => void;
  title?: string;
}) {
  const sourceRequired = evidence.status === "confirmed" || evidence.status === "estimate";
  return (
    <details className="source-editor">
      <summary>
        {title} <EvidenceBadge evidence={evidence} />
      </summary>
      <div className="source-grid">
        <label>
          <span>Confidence</span>
          <select
            value={evidence.status}
            onChange={(event) =>
              onChange({
                ...evidence,
                status: event.target.value as EvidenceStatus,
              })
            }
          >
            <option value="unknown">I still need a source</option>
            <option value="estimate">Estimated</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        <label>
          <span>Date checked{sourceRequired ? " · required" : ""}</span>
          <input
            type="date"
            required={sourceRequired}
            value={evidence.asOf ?? ""}
            onChange={(event) =>
              onChange({ ...evidence, asOf: event.target.value || null })
            }
          />
        </label>
        <label className="wide">
          <span>Where this figure came from{sourceRequired ? " · required" : ""}</span>
          <input
            required={sourceRequired}
            maxLength={1000}
            value={evidence.source}
            placeholder="Payslip, offer letter, official calculator, quote…"
            onChange={(event) =>
              onChange({ ...evidence, source: event.target.value })
            }
          />
        </label>
        <label className="wide">
          <span>What this source means</span>
          <input
            maxLength={1000}
            value={evidence.note}
            placeholder="What was assumed or still needs verification?"
            onChange={(event) =>
              onChange({ ...evidence, note: event.target.value })
            }
          />
        </label>
      </div>
    </details>
  );
}

function BreakdownGroup({
  title,
  items,
  scenario,
  document,
  mode,
}: {
  title: string;
  items: BreakdownItem[];
  scenario: Scenario;
  document: WayfinderDocument;
  mode: DisplayMode;
}) {
  return (
    <section className="breakdown-group">
      <h4>{title}</h4>
      {items.length ? (
        items.map((item) => {
          const evidence =
            item.scope === "shared"
              ? document.sharedEvidence[item.id]
              : scenario.evidence[item.id];
          return (
            <div className="breakdown-line" key={item.id}>
              <span>
                {item.label}
                {item.scope === "shared" && <small>Entered once for every plan</small>}
              </span>
              <span>
                <MoneyValue
                  local={item.localAmount}
                  base={item.baseAmount}
                  scenario={scenario}
                  document={document}
                  mode={mode}
                />
                {evidence && <EvidenceBadge evidence={evidence} />}
              </span>
            </div>
          );
        })
      ) : (
        <p className="empty-breakdown">No items are configured for this category.</p>
      )}
    </section>
  );
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Home() {
  const [plan, setPlan] = useState<WayfinderDocument>(DEFAULT_DOCUMENT);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [mode, setMode] = useState<DisplayMode>("base");
  const [projectionMetric, setProjectionMetric] =
    useState<ProjectionMetric>("totalSavingBase");
  const [editor, setEditor] = useState<Scenario | null>(null);
  const [modelDraft, setModelDraft] = useState<WayfinderDocument | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [currencyRestartDraft, setCurrencyRestartDraft] = useState<WayfinderDocument | null>(null);
  const [deleteScenarioConfirm, setDeleteScenarioConfirm] = useState(false);
  const [deleteCurrentReplacementId, setDeleteCurrentReplacementId] = useState<string | null>(null);
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<string | null>(null);
  const [importCandidate, setImportCandidate] = useState<{
    document: WayfinderDocument;
    migrated: boolean;
  } | null>(null);
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([]);
  const [importIssueContext, setImportIssueContext] = useState<ValidationLabelContext>({ fieldDefinitions: [] });
  const [storageReady, setStorageReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState<StorageNotice | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [storageConflict, setStorageConflict] = useState<StorageConflict | null>(null);
  const [formNotice, setFormNotice] = useState("");
  const [formIssues, setFormIssues] = useState<ValidationIssue[]>([]);
  const [setupSettingsReviewed, setSetupSettingsReviewed] = useState(false);
  const [projectionInputDraft, setProjectionInputDraft] = useState<ProjectionInputDraft | null>(null);
  const [earnersInputDraft, setEarnersInputDraft] = useState<string | null>(null);
  const [enteredScenarioAmounts, setEnteredScenarioAmounts] = useState<Set<string>>(new Set());
  const [enteredSharedAmounts, setEnteredSharedAmounts] = useState<Set<string>>(new Set());
  const [pendingPerOptionAmounts, setPendingPerOptionAmounts] = useState<PendingPerOptionAmounts>({});
  const [enteredSupportAmounts, setEnteredSupportAmounts] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storageTokenRef = useRef<string>("empty");
  const dialogCycleRef = useRef(false);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const runtimeSeed = useMemo(() => parseRuntimeSeed(), []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const revealFirstInvalidControl = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const firstInvalid = form.querySelector<HTMLElement>(
      "input:invalid, select:invalid, textarea:invalid",
    );
    if (!firstInvalid || event.target !== firstInvalid) return;
    const details = firstInvalid.closest("details");
    if (details) details.open = true;
    const label = firstInvalid.closest("label")?.querySelector("span")?.textContent?.trim();
    setFormNotice(
      `${label || "A required field"} needs attention. The relevant section has been opened.`,
    );
    setFormIssues([]);
    window.requestAnimationFrame(() => firstInvalid.focus());
  };

  useEffect(() => {
    if (!storageReady) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) return;
      const snapshot = inspectBrowserStorage();
      if (snapshot.status === "unavailable") {
        setStorageNotice({ tone: "error", message: snapshot.message });
        return;
      }
      if (snapshot.token === storageTokenRef.current) return;
      setStorageConflict({ snapshot, reason: "event" });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageReady]);

  const activeDialogId = storageConflict
    ? "storage-conflict"
    : importIssues.length
      ? "import-errors"
      : importCandidate
        ? "import-preview"
        : clearConfirm
          ? "clear-browser"
          : editor
            ? "scenario-editor"
            : modelDraft
              ? "comparison-model"
              : shareOpen
                ? "share"
                : null;

  const cancelClearDashboard = useCallback(() => {
    setClearConfirm(false);
    if (currencyRestartDraft) setModelDraft(currencyRestartDraft);
    setCurrencyRestartDraft(null);
  }, [currencyRestartDraft]);

  const closeModelEditor = useCallback(() => {
    setModelDraft(null);
    setDeleteFieldConfirm(null);
    setPendingPerOptionAmounts({});
  }, []);

  useEffect(() => {
    if (!activeDialogId) return;
    if (!dialogCycleRef.current) {
      dialogCycleRef.current = true;
      dialogOpenerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const dialog = document.querySelector<HTMLElement>(
      `[data-dialog-id="${activeDialogId}"]`,
    );
    if (!dialog) return;

    const inerted = Array.from(document.querySelectorAll<HTMLElement>("main.app-shell > *"))
      .filter((element) => !element.contains(dialog))
      .map((element) => ({ element, wasInert: element.inert }));
    inerted.forEach(({ element }) => {
      element.inert = true;
    });

    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const focusFrame = window.requestAnimationFrame(() => {
      const initial =
        dialog.querySelector<HTMLElement>("[data-initial-focus]") ??
        getFocusable()[0] ??
        dialog;
      initial.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const focusable = getFocusable();
        if (!focusable.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      if (activeDialogId === "storage-conflict") setStorageConflict(null);
      if (activeDialogId === "import-errors") setImportIssues([]);
      if (activeDialogId === "import-preview") setImportCandidate(null);
      if (activeDialogId === "clear-browser") cancelClearDashboard();
      if (activeDialogId === "scenario-editor") {
        setEditor(null);
        setDeleteScenarioConfirm(false);
        setDeleteCurrentReplacementId(null);
      }
      if (activeDialogId === "comparison-model") {
        closeModelEditor();
      }
      if (activeDialogId === "share") setShareOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      inerted.forEach(({ element, wasInert }) => {
        element.inert = wasInert;
      });
    };
  }, [activeDialogId, cancelClearDashboard, closeModelEditor]);

  useEffect(() => {
    if (activeDialogId || !dialogCycleRef.current) return;
    dialogCycleRef.current = false;
    const opener = dialogOpenerRef.current;
    dialogOpenerRef.current = null;
    const frame = window.requestAnimationFrame(() => opener?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeDialogId]);

  const legacyRepairScenarios = useMemo(
    () => plan.scenarios.filter((scenario) => isLegacyUndatedConversion(plan, scenario)),
    [plan],
  );
  const derived = useMemo(
    () => plan.scenarios
      .filter((scenario) => !isLegacyUndatedConversion(plan, scenario))
      .map((scenario) => deriveScenario(plan, scenario)),
    [plan],
  );
  const visible = useMemo(
    () => derived.filter((scenario) => activeIds.includes(scenario.id)),
    [activeIds, derived],
  );
  const bestSaving = [...visible].sort(
    (a, b) => b.totalSavingBase - a.totalSavingBase,
  )[0];
  const bestOneIncome = [...visible]
    .filter((scenario) => scenario.earners === 1)
    .sort((a, b) => b.totalSavingBase - a.totalSavingBase)[0];
  const bestCash = [...visible].sort(
    (a, b) => b.cashRemainingBase - a.cashRemainingBase,
  )[0];
  const maxSaving = Math.max(
    1,
    ...visible.map((scenario) => Math.max(0, scenario.totalSavingBase)),
  );
  const maxSavingMagnitude = Math.max(
    1,
    ...visible.map((scenario) => Math.abs(scenario.totalSavingBase)),
  );
  const maxCash = Math.max(
    1,
    ...visible.map((scenario) => Math.max(0, scenario.cashRemainingBase)),
  );

  const projections = useMemo(
    () =>
      visible.map((scenario) => ({
        scenario,
        years: projectScenario(plan, scenario),
      })),
    [plan, visible],
  );
  const maxProjectedMagnitude = Math.max(
    1,
    ...projections.flatMap((projection) =>
      projection.years.map((year) =>
        Math.abs(year[projectionMetric]),
      ),
    ),
  );
  const editorConversionReady = Boolean(
    editor &&
    /^[A-Z]{3}$/.test(editor.currency) &&
    (editor.currency === plan.baseCurrency
      ? Math.abs(editor.fx.rateToBase - 1) <= 1e-9
      : hasUsableFxRate(editor.fx.rateToBase) &&
        Boolean(editor.fx.asOf) &&
        editor.fx.source.trim().length > 0),
  );
  const editorAmountsReady = Boolean(
    editor &&
    enteredScenarioAmounts.has("grossMonthly") &&
    plan.fieldDefinitions
      .filter((field) => field.scope === "perOption")
      .every((field) => enteredScenarioAmounts.has(field.id)),
  );
  const editorPreview = editor && editorConversionReady && editorAmountsReady
    ? deriveScenario(plan, editor)
    : null;
  const editorPreviewSavings = editorPreview
    ? balancedScenarioSavings(editorPreview, plan)
    : null;
  const editingExisting = Boolean(
    editor && plan.scenarios.some((scenario) => scenario.id === editor.id),
  );
  const firstScenarioSetup = Boolean(editor && plan.scenarios.length === 0);
  const editingCurrentScenario = Boolean(
    editor && editingExisting && editor.id === plan.currentScenarioId,
  );
  const editorRepresentsCurrentPosition = firstScenarioSetup || editingCurrentScenario;
  const currentReplacementScenarios = editingCurrentScenario
    ? plan.scenarios.filter((scenario) => scenario.id !== editor?.id)
    : [];
  const optionCurrencyLocked = Boolean(
    editor && (
      editingExisting ||
      editor.grossMonthly !== 0 ||
      Object.values(editor.values).some((amount) => amount !== 0)
    ),
  );
  const comparisonCurrencyLocked = Boolean(
    modelDraft && (
      modelDraft.scenarios.length > 0 ||
      Object.values(modelDraft.sharedValues).some((amount) => amount !== 0) ||
      modelDraft.excludedSupport.some((item) => item.monthlyBase !== 0)
    ),
  );

  const showStorageConflict = (
    snapshot: StoredPlanSnapshot,
    reason: StorageConflict["reason"],
  ) => {
    setStorageConflict({ snapshot, reason });
  };

  const commitPlan = async (candidate: WayfinderDocument, message: string) => {
    const expectedStorageToken = storageTokenRef.current;
    try {
      return await withStorageMutationLock(() => {
        // Re-read only after entering the exclusive lock. Cooperative tabs can
        // no longer change storage between this token check and setItem.
        const snapshot = inspectBrowserStorage();
        if (snapshot.status === "unavailable") {
          setStorageNotice({ tone: "error", message: snapshot.message });
          notify("Could not save. Your previous dashboard is still unchanged.");
          return false;
        }
        if (snapshot.token !== expectedStorageToken) {
          showStorageConflict(snapshot, "write");
          return false;
        }

        const previousRevision =
          snapshot.status === "valid" ? snapshot.document.updatedAt : plan.updatedAt;
        const synced = syncDocumentFields(withRevisionAfter(candidate, previousRevision));
        const result = validateWayfinderInput(synced, {
          allowLegacyConversionGap: legacyRepairScenarios.length > 0,
        });
        if (!result.ok) {
          notify(`${result.issues[0]?.path ?? "Document"}: ${result.issues[0]?.message ?? "Invalid data"}`);
          return false;
        }

        let serialized = "";
        try {
          serialized = JSON.stringify(result.document);
          if (new Blob([serialized]).size > MAX_DOCUMENT_BYTES) {
            setStorageNotice({
              tone: "error",
              message: "This comparison file exceeds the 2 MiB browser limit. Your previous dashboard is still unchanged.",
            });
            notify("Could not save. The comparison is larger than 2 MiB.");
            return false;
          }
          window.localStorage.setItem(STORAGE_KEY, serialized);
        } catch {
          setStorageNotice({
            tone: "error",
            message: "Browser storage rejected this save, possibly because it is full or unavailable. Your previous dashboard is still unchanged.",
          });
          notify("Could not save. Your previous dashboard is still unchanged.");
          return false;
        }

        storageTokenRef.current = `current:${result.document.updatedAt}:${fingerprint(serialized)}`;
        setStorageNotice(null);
        setPlan(result.document);
        notify(message);
        return true;
      });
    } catch {
      setStorageNotice({
        tone: "error",
        message: "The browser could not acquire the exclusive save lock. Your previous dashboard is still unchanged.",
      });
      notify("Could not save. Your previous dashboard is still unchanged.");
      return false;
    }
  };

  const adoptSavedPlan = (
    snapshot: Extract<StoredPlanSnapshot, { status: "valid" }>,
  ) => {
    storageTokenRef.current = snapshot.token;
    setPlan(snapshot.document);
    setActiveIds(snapshot.document.scenarios.map((scenario) => scenario.id));
    if (snapshot.recoveryMessage) {
      setStorageNotice({ tone: "warning", message: snapshot.recoveryMessage });
    }
    if (snapshot.migrated) {
      const requiresConversionRepair = snapshot.document.scenarios.some((scenario) =>
        isLegacyUndatedConversion(snapshot.document, scenario),
      );
      setToast(requiresConversionRepair
        ? "Older browser data was preserved. Use the older saved plans conversion-details panel to complete missing conversion dates or sources."
        : "An earlier dashboard was updated. Its first saved plan remains your current job and home-country position; review or change it in Home currency, future estimates, and amounts used in every plan.");
    }
  };

  const applyRuntimeSeed = async (candidate: WayfinderDocument) => {
    try {
      return await withStorageMutationLock(() => {
        // Another tab may have saved while this tab was waiting for the lock.
        // A newly valid browser plan always wins over the runtime starter.
        const latest = inspectBrowserStorage();
        if (latest.status === "unavailable") {
          setStorageNotice({ tone: "error", message: latest.message });
          return "failed" as const;
        }
        if (latest.status === "valid") {
          adoptSavedPlan(latest);
          return "existing" as const;
        }

        const synced = syncDocumentFields(
          withRevisionAfter(candidate, candidate.updatedAt),
        );
        const result = validateWayfinderInput(synced);
        if (!result.ok) {
          setStorageNotice({
            tone: "error",
            message: "The running instance supplied an invalid starter comparison. Browser data was not changed.",
          });
          return "failed" as const;
        }

        let serialized = "";
        let recoverySaved = false;
        try {
          serialized = JSON.stringify(result.document);
          if (new Blob([serialized]).size > MAX_DOCUMENT_BYTES) {
            setStorageNotice({
              tone: "error",
              message: "The running instance supplied a starter comparison larger than the 2 MiB browser limit. Browser data was not changed.",
            });
            return "failed" as const;
          }
          if (latest.status === "invalid") {
            const recovery = saveInvalidBrowserRecovery();
            if (!recovery.ok) {
              setStorageNotice({ tone: "error", message: recovery.message });
              return "failed" as const;
            }
            recoverySaved = true;
            setRecoveryAvailable(true);
          }
          window.localStorage.setItem(STORAGE_KEY, serialized);
          // The valid current write is already authoritative. Remove any
          // damaged legacy value only after that write succeeds.
          try {
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          } catch {
            // A leftover legacy value is harmless because current storage wins.
          }
        } catch {
          setStorageNotice({
            tone: "error",
            message: "Browser storage rejected the starter comparison. Browser data was not changed.",
          });
          return "failed" as const;
        }

        storageTokenRef.current = `current:${result.document.updatedAt}:${fingerprint(serialized)}`;
        setPlan(result.document);
        setActiveIds(result.document.scenarios.map((scenario) => scenario.id));
        return recoverySaved ? "seeded-with-recovery" as const : "seeded" as const;
      });
    } catch {
      setStorageNotice({
        tone: "error",
        message: "The browser could not safely save the starter comparison. Browser data was not changed.",
      });
      return "failed" as const;
    }
  };

  useEffect(() => {
    const snapshot = inspectBrowserStorage();
    const recovery = inspectRecoveryCopy();
    storageTokenRef.current = snapshot.token;

    const frame = window.requestAnimationFrame(() => {
      setRecoveryAvailable(recovery.status === "available");
      if (snapshot.status === "valid") {
        adoptSavedPlan(snapshot);
        if (recovery.status === "available") {
          setStorageNotice({
            tone: "warning",
            message: RECOVERY_NOTICE_MESSAGE,
          });
        } else if (recovery.status === "invalid" || recovery.status === "unavailable") {
          setStorageNotice({
            tone: "error",
            message: "The local recovery copy could not be read safely. The saved dashboard was not changed.",
          });
        }
        setStorageReady(true);
        return;
      }
      if (runtimeSeed.status === "valid" && shouldApplyRuntimeSeed(snapshot.status, runtimeSeed)) {
        void applyRuntimeSeed(runtimeSeed.document).then((outcome) => {
          if (outcome === "seeded" || outcome === "seeded-with-recovery") {
            setStorageNotice({
              tone: "seed",
              message: outcome === "seeded-with-recovery"
                ? RECOVERY_NOTICE_MESSAGE
                : "Your comparison is ready and saved in this browser.",
            });
            notify("Starter comparison saved in this browser");
          }
          setStorageReady(true);
        });
        return;
      }
      if (snapshot.status === "invalid" || snapshot.status === "unavailable") {
        setStorageNotice({ tone: "error", message: snapshot.message });
      } else if (runtimeSeed.status === "invalid") {
        setStorageNotice({ tone: "error", message: "The running instance supplied an invalid starter comparison. Browser data was not changed." });
      }
      setStorageReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  // The seed is injected per running instance. This bootstrap must run once;
  // later edits use the normal guarded save path.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openManualSetup = () => {
    const freshStart =
      plan.scenarios.length === 0 &&
      plan.updatedAt === DEFAULT_DOCUMENT.updatedAt;
    const draft = cloneDocument(plan);
    if (freshStart) {
      draft.title = "";
      draft.baseCurrency = "";
      draft.locale = "";
    }
    setFormNotice("");
    setFormIssues([]);
    setSetupSettingsReviewed(!freshStart);
    setProjectionInputDraft(freshStart
      ? { incomeGrowthPct: "", expenseInflationPct: "", years: "" }
      : {
          incomeGrowthPct: String(plan.projectionAssumptions.incomeGrowthPct),
          expenseInflationPct: String(plan.projectionAssumptions.expenseInflationPct),
          years: String(plan.projectionAssumptions.years),
        });
    setEnteredSharedAmounts(new Set(
      freshStart
        ? []
        : plan.fieldDefinitions
            .filter((field) => field.scope === "shared")
            .map((field) => field.id),
    ));
    setPendingPerOptionAmounts({});
    setEnteredSupportAmounts(new Set(
      freshStart ? [] : plan.excludedSupport.map((item) => item.id),
    ));
    setModelDraft(draft);
  };

  const openNewOption = () => {
    setFormNotice("");
    setFormIssues([]);
    setEarnersInputDraft("");
    setEnteredScenarioAmounts(new Set());
    setDeleteScenarioConfirm(false);
    setDeleteCurrentReplacementId(null);
    setEditor(createBlankScenario(plan));
  };

  const toggleActive = (id: string) => {
    setActiveIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  };

  const saveScenario = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    if (earnersInputDraft === null || earnersInputDraft.trim().length === 0) {
      setFormNotice("This place, job, or plan has not been added. Enter the number of earners counted in its monthly income.");
      setFormIssues([]);
      return;
    }
    if (!editorConversionReady) {
      setFormNotice("This place, job, or plan has not been added. Complete its currency and conversion details first.");
      setFormIssues([]);
      return;
    }
    if (!editorAmountsReady) {
      setFormNotice("This place, job, or plan has not been added. Enter monthly gross income before tax and deductions, then enter or explicitly use 0 for every monthly item.");
      setFormIssues([]);
      return;
    }
    const savedEditor = { ...editor, earners: Number(earnersInputDraft) };
    const next: WayfinderDocument = {
      ...plan,
      currentScenarioId: firstScenarioSetup ? savedEditor.id : plan.currentScenarioId,
      scenarios: editingExisting
        ? plan.scenarios.map((scenario) =>
            scenario.id === savedEditor.id ? savedEditor : scenario,
          )
        : [...plan.scenarios, savedEditor],
    };
    const preflight = validateWayfinderInput(syncDocumentFields(next), {
      allowLegacyConversionGap: legacyRepairScenarios.length > 0,
    });
    if (!preflight.ok) {
      setFormNotice("This place, job, or plan has not been added. Fix the highlighted information first.");
      setFormIssues(preflight.issues);
      return;
    }
    if (!await commitPlan(next, firstScenarioSetup ? "Your current place, job, or plan was saved in this browser" : "Place, job, or plan saved in this browser")) {
      return;
    }
    setActiveIds((current) =>
      current.includes(savedEditor.id) ? current : [...current, savedEditor.id],
    );
    setEditor(null);
    setDeleteScenarioConfirm(false);
    setDeleteCurrentReplacementId(null);
  };

  const openScenarioEditor = (id: string) => {
    const scenario = plan.scenarios.find((candidate) => candidate.id === id);
    if (!scenario) return;
    const editableScenario = cloneDocument({ ...plan, scenarios: [scenario] }).scenarios[0];
    if (isLegacyUndatedConversion(plan, scenario)) {
      editableScenario.fx.source = "";
    }
    setEditor(editableScenario);
    setEarnersInputDraft(String(scenario.earners));
    setEnteredScenarioAmounts(new Set([
      "grossMonthly",
      ...plan.fieldDefinitions
        .filter((field) => field.scope === "perOption")
        .map((field) => field.id),
    ]));
    setFormNotice("");
    setFormIssues([]);
    setDeleteScenarioConfirm(false);
    setDeleteCurrentReplacementId(null);
  };

  const duplicateScenario = (id: string) => {
    const scenario = plan.scenarios.find((candidate) => candidate.id === id);
    if (!scenario) return;
    setEditor({
      ...cloneDocument({ ...plan, scenarios: [scenario] }).scenarios[0],
      id: createScenarioId(),
      label: `${scenario.label} · copy`,
      status: "",
    });
    setEarnersInputDraft(String(scenario.earners));
    setEnteredScenarioAmounts(new Set([
      "grossMonthly",
      ...plan.fieldDefinitions
        .filter((field) => field.scope === "perOption")
        .map((field) => field.id),
    ]));
    setFormNotice("");
    setFormIssues([]);
    setDeleteScenarioConfirm(false);
    setDeleteCurrentReplacementId(null);
  };

  const deleteScenario = async () => {
    if (!editor) return;
    const deletedEditor = editor;
    const remainingScenarios = plan.scenarios.filter((scenario) => scenario.id !== deletedEditor.id);
    const deletingCurrentScenario = deletedEditor.id === plan.currentScenarioId;
    if (
      deletingCurrentScenario &&
      remainingScenarios.length > 0 &&
      !remainingScenarios.some((scenario) => scenario.id === deleteCurrentReplacementId)
    ) {
      setFormNotice("Choose the saved plan that will become your current job and home-country household position before removing this one.");
      setFormIssues([]);
      return;
    }
    const replacement = remainingScenarios.find(
      (scenario) => scenario.id === deleteCurrentReplacementId,
    );
    const next = {
      ...plan,
      currentScenarioId: deletingCurrentScenario
        ? replacement?.id ?? null
        : plan.currentScenarioId,
      scenarios: remainingScenarios,
      researchItems: plan.researchItems.map((item) => ({
        ...item,
        appliesToScenarioIds: item.appliesToScenarioIds.filter(
          (id) => id !== deletedEditor.id,
        ),
      })),
    };
    if (!await commitPlan(
      next,
      deletingCurrentScenario && replacement
        ? `${deletedEditor.label || "Current plan"} was removed. ${replacement.label || "The selected plan"} is now your current job and home-country household position.`
        : "Place, job, or plan removed from this browser",
    )) return;
    setActiveIds((current) => current.filter((id) => id !== deletedEditor.id));
    setEditor(null);
    setDeleteScenarioConfirm(false);
    setDeleteCurrentReplacementId(null);
  };

  const clearDashboard = async () => {
    const expectedStorageToken = storageTokenRef.current;
    try {
      await withStorageMutationLock(() => {
        // The conflict check and both removals share one cooperative lock, and
        // the snapshot is intentionally taken only after the lock is held.
        const snapshot = inspectBrowserStorage();
        if (snapshot.status === "unavailable") {
          setStorageNotice({ tone: "error", message: snapshot.message });
          notify("Could not clear browser storage. Your dashboard is unchanged.");
          return;
        }
        if (snapshot.token !== expectedStorageToken) {
          showStorageConflict(snapshot, "write");
          return;
        }

        let currentRaw: string | null = null;
        let legacyRaw: string | null = null;
        let recoveryRaw: string | null = null;
        let mutationStarted = false;
        try {
          currentRaw = window.localStorage.getItem(STORAGE_KEY);
          legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
          recoveryRaw = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
          // Remove recovery and fallback data first so another tab never briefly
          // restores stale legacy data after the current key disappears.
          mutationStarted = true;
          window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          if (mutationStarted) {
            try {
              if (legacyRaw === null) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
              else window.localStorage.setItem(LEGACY_STORAGE_KEY, legacyRaw);
              if (currentRaw === null) window.localStorage.removeItem(STORAGE_KEY);
              else window.localStorage.setItem(STORAGE_KEY, currentRaw);
              if (recoveryRaw === null) window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
              else window.localStorage.setItem(RECOVERY_STORAGE_KEY, recoveryRaw);
            } catch {
              // The UI remains unchanged; the notice asks the user to reload and verify.
            }
          }
          setStorageNotice({
            tone: "error",
            message: "Browser storage rejected the clear operation. Your dashboard remains open; reload before making more changes to verify the saved copy.",
          });
          notify("Could not clear browser storage. Your dashboard is unchanged.");
          return;
        }

        const blank = createWayfinderDocument();
        storageTokenRef.current = "empty";
        setPlan(blank);
        setActiveIds([]);
        setStorageNotice(null);
        setRecoveryAvailable(false);
        setClearConfirm(false);
        setCurrencyRestartDraft(null);
        setShareOpen(false);
        notify("All Wayfinder data was cleared from this browser");
      });
    } catch {
      setStorageNotice({
        tone: "error",
        message: "The browser could not acquire the exclusive clear lock. Your dashboard is unchanged.",
      });
      notify("Could not clear browser storage. Your dashboard is unchanged.");
    }
  };

  const downloadRecoveryCopy = () => {
    try {
      const recovery = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
      if (!recovery || new Blob([recovery]).size > MAX_DOCUMENT_BYTES) {
        setRecoveryAvailable(false);
        setStorageNotice({
          tone: "error",
          message: "The local recovery copy is missing or too large to download.",
        });
        return;
      }
      downloadText(
        `wayfinder-unreadable-browser-data-${new Date().toISOString().slice(0, 10)}.json`,
        recovery,
        "application/json",
      );
      notify("Unreadable-data copy downloaded");
    } catch {
      setStorageNotice({
        tone: "error",
        message: "The local recovery copy could not be read. Browser data was not changed.",
      });
    }
  };

  const exportDocument = () => {
    if (legacyRepairScenarios.length > 0) {
      notify("Complete the older conversion details before downloading a saved comparison file");
      return;
    }
    const exported = withFreshTimestamp(plan);
    downloadText(
      `wayfinder-document-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(exported, null, 2),
      "application/json",
    );
    setShareOpen(false);
    notify("Saved comparison file downloaded");
  };

  const exportClearBackup = () => {
    if (legacyRepairScenarios.length > 0) {
      notify("No reusable backup was downloaded. Cancel and complete the older conversion details first.");
      return;
    }
    const exported = withFreshTimestamp(
      currencyRestartDraft ? syncDocumentFields(currencyRestartDraft) : plan,
    );
    downloadText(
      `wayfinder-${currencyRestartDraft ? "shared-settings-draft" : "document"}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(exported, null, 2),
      "application/json",
    );
    notify(currencyRestartDraft ? "Home-currency and every-plan-amounts draft downloaded" : "Saved comparison file downloaded");
  };

  const downloadAgentTemplate = () => {
    const template = createWayfinderDocument(plan.baseCurrency);
    template.title = "Replace with a clear comparison title";
    downloadText(
      "wayfinder-comparison-template.v5.json",
      JSON.stringify(template, null, 2),
      "application/json",
    );
    setShareOpen(false);
    notify("Empty comparison file downloaded");
  };

  const downloadFamilyView = () => {
    if (!plan.scenarios.length) return;
    if (legacyRepairScenarios.length > 0) {
      notify("Complete older conversion dates before creating a family view");
      return;
    }
    downloadText(
      `wayfinder-family-view-${new Date().toISOString().slice(0, 10)}.html`,
      createFamilyShareHtml(plan),
      "text/html;charset=utf-8",
    );
    setShareOpen(false);
    notify("Read-only family view downloaded — share it only with people you trust");
  };

  const importDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      setImportIssueContext({ fieldDefinitions: [] });
      setImportIssues([{
        path: "$",
        message: "The selected file is larger than the 2 MiB import limit.",
      }]);
      setImportCandidate(null);
      setShareOpen(false);
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setImportIssueContext(validationLabelContext(parsed));
      const result = validateWayfinderInput(parsed);
      if (!result.ok) {
        setImportIssues(result.issues);
        setImportCandidate(null);
        setShareOpen(false);
        return;
      }
      setImportCandidate({
        document: syncDocumentFields(result.document),
        migrated: result.migrated,
      });
      setImportIssues([]);
      setImportIssueContext({ fieldDefinitions: [] });
      setShareOpen(false);
    } catch {
      setImportIssueContext({ fieldDefinitions: [] });
      setImportIssues([{ path: "$", message: "The selected file is not valid JSON." }]);
      setImportCandidate(null);
      setShareOpen(false);
    }
  };

  const confirmImport = async () => {
    if (!importCandidate) return;
    const confirmedImport = importCandidate;
    if (!await commitPlan(
      confirmedImport.document,
      "Validated comparison replaced this browser dashboard",
    )) return;
    setActiveIds(confirmedImport.document.scenarios.map((scenario) => scenario.id));
    setImportCandidate(null);
  };

  const reloadExternalStorage = () => {
    if (!storageConflict) return;
    const { snapshot } = storageConflict;
    storageTokenRef.current = snapshot.token;
    if (snapshot.status === "valid") {
      setPlan(snapshot.document);
      setActiveIds(snapshot.document.scenarios.map((scenario) => scenario.id));
      setStorageNotice(snapshot.recoveryMessage
        ? { tone: "warning", message: snapshot.recoveryMessage }
        : null);
      notify("Loaded the external browser update");
    } else {
      setPlan(createWayfinderDocument());
      setActiveIds([]);
      setStorageNotice(snapshot.status === "invalid"
        ? { tone: "error", message: snapshot.message }
        : null);
      notify(snapshot.status === "empty"
        ? "Loaded the externally cleared browser state"
        : "The external saved state is unreadable; the in-memory dashboard is blank");
    }
    setEditor(null);
    setModelDraft(null);
    setShareOpen(false);
    setClearConfirm(false);
    setCurrencyRestartDraft(null);
    setImportCandidate(null);
    setImportIssues([]);
    setDeleteScenarioConfirm(false);
    setDeleteFieldConfirm(null);
    setStorageConflict(null);
  };

  const keepThisTab = () => {
    if (!storageConflict) return;
    storageTokenRef.current = storageConflict.snapshot.token;
    setStorageConflict(null);
    setStorageNotice({
      tone: "warning",
      message: "You kept this tab's unsaved version. Review it, then save again to replace the external browser version explicitly.",
    });
    notify("This tab was kept. Save again when you are ready.");
  };

  const updateEditor = <K extends keyof Scenario>(key: K, value: Scenario[K]) => {
    setEditor((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateEditorValue = (fieldId: string, amount: number | null) => {
    setEnteredScenarioAmounts((current) => {
      const next = new Set(current);
      if (amount === null) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
    setEditor((current) =>
      current
        ? { ...current, values: { ...current.values, [fieldId]: amount ?? 0 } }
        : current,
    );
  };

  const updateEditorEvidence = (fieldId: string, evidence: InputEvidence) => {
    setEditor((current) =>
      current
        ? { ...current, evidence: { ...current.evidence, [fieldId]: evidence } }
        : current,
    );
  };

  const updateEditorGross = (amount: number | null) => {
    setEnteredScenarioAmounts((current) => {
      const next = new Set(current);
      if (amount === null) next.delete("grossMonthly");
      else next.add("grossMonthly");
      return next;
    });
    updateEditor("grossMonthly", amount ?? 0);
  };

  const markScenarioAmountsAsZero = (fieldIds: string[]) => {
    setEnteredScenarioAmounts((current) => {
      const next = new Set(current);
      fieldIds.forEach((fieldId) => next.add(fieldId));
      return next;
    });
  };

  const updateSharedAmount = (fieldId: string, value: string) => {
    setEnteredSharedAmounts((current) => {
      const next = new Set(current);
      if (value.trim()) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
    setModelDraft((current) => current
      ? {
          ...current,
          sharedValues: {
            ...current.sharedValues,
            [fieldId]: value.trim() ? Number(value) : 0,
          },
        }
      : current);
  };

  const markSharedAmountsAsZero = (fieldIds: string[]) => {
    setEnteredSharedAmounts((current) => {
      const next = new Set(current);
      fieldIds.forEach((fieldId) => next.add(fieldId));
      return next;
    });
  };

  const updatePendingPerOptionAmount = (
    fieldId: string,
    scenarioId: string,
    amount: number | null,
  ) => {
    setPendingPerOptionAmounts((current) => {
      const remaining = new Set(current[fieldId] ?? []);
      if (amount === null) remaining.add(scenarioId);
      else remaining.delete(scenarioId);
      if (remaining.size === 0) {
        const next = { ...current };
        delete next[fieldId];
        return next;
      }
      return { ...current, [fieldId]: remaining };
    });
    setModelDraft((current) => current
      ? {
          ...current,
          scenarios: current.scenarios.map((scenario) => scenario.id === scenarioId
            ? { ...scenario, values: { ...scenario.values, [fieldId]: amount ?? 0 } }
            : scenario),
        }
      : current);
  };

  const markPendingPerOptionAmountsAsZero = (
    fieldIds: string[],
    scenarioId: string,
  ) => {
    setPendingPerOptionAmounts((current) => {
      const next: PendingPerOptionAmounts = { ...current };
      fieldIds.forEach((fieldId) => {
        const remaining = new Set(next[fieldId] ?? []);
        remaining.delete(scenarioId);
        if (remaining.size === 0) delete next[fieldId];
        else next[fieldId] = remaining;
      });
      return next;
    });
  };

  const updateSupportAmount = (itemId: string, value: string) => {
    setEnteredSupportAmounts((current) => {
      const next = new Set(current);
      if (value.trim()) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
    setModelDraft((current) => current
      ? {
          ...current,
          excludedSupport: current.excludedSupport.map((item) => item.id === itemId
            ? { ...item, monthlyBase: value.trim() ? Number(value) : 0 }
            : item),
        }
      : current);
  };

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    if (!modelDraft) return;
    const pendingAmountCount = modelDraft.fieldDefinitions.reduce(
      (total, field) => total + (pendingPerOptionAmounts[field.id]?.size ?? 0),
      0,
    );
    if (pendingAmountCount > 0) {
      setFormNotice(`Home currency, future estimates, and amounts used in every plan have not been saved. Enter or explicitly use 0 for ${pendingAmountCount} pending monthly plan ${pendingAmountCount === 1 ? "amount" : "amounts"}.`);
      setFormIssues([]);
      return;
    }
    if (
      !projectionInputDraft ||
      Object.values(projectionInputDraft).some((value) => value.trim().length === 0)
    ) {
      setFormNotice("Home currency, future estimates, and amounts used in every plan have not been saved. Enter every forecast setting.");
      setFormIssues([]);
      return;
    }
    const savedModel = syncDocumentFields({
      ...modelDraft,
      projectionAssumptions: {
        incomeGrowthPct: Number(projectionInputDraft.incomeGrowthPct),
        expenseInflationPct: Number(projectionInputDraft.expenseInflationPct),
        years: Number(projectionInputDraft.years),
      },
    });
    const preflight = validateWayfinderInput(savedModel);
    if (!preflight.ok) {
      setFormNotice("Home currency, future estimates, and amounts used in every plan have not been saved. Fix the information below first.");
      setFormIssues(preflight.issues);
      return;
    }
    if (!await commitPlan(savedModel, "Home currency, future estimates, and amounts used in every plan applied")) return;
    setModelDraft(null);
    setDeleteFieldConfirm(null);
    setPendingPerOptionAmounts({});
    if (!plan.scenarios.length) {
      setFormNotice("");
      setFormIssues([]);
      setEarnersInputDraft("");
      setEnteredScenarioAmounts(new Set());
      setEditor(createCurrentScenario(savedModel));
    }
  };

  const updateModelField = (
    id: string,
    patch: Partial<Pick<FieldDefinition, "label" | "description">>,
  ) => {
    setModelDraft((current) =>
      current
        ? {
            ...current,
            fieldDefinitions: current.fieldDefinitions.map((field) =>
              field.id === id ? { ...field, ...patch } : field,
            ),
          }
        : current,
    );
  };

  const reclassifyModelField = (
    id: string,
    group: FieldGroup,
    requestedScope: FieldScope,
  ) => {
    if (!modelDraft) return;
    const field = modelDraft.fieldDefinitions.find((candidate) => candidate.id === id);
    if (!field) return;
    const scope = group === "deduction" || group === "automaticInvestment" || group === "livingCost"
      ? "perOption"
      : requestedScope;
    if (scope !== field.scope) {
      const populated =
        (modelDraft.sharedValues[id] ?? 0) !== 0 ||
        hasMeaningfulEvidence(modelDraft.sharedEvidence[id]) ||
        modelDraft.scenarios.some((scenario) =>
          (scenario.values[id] ?? 0) !== 0 ||
          hasMeaningfulEvidence(scenario.evidence[id]),
        );
      if (populated) {
        setFormNotice("This item was not changed. Set its amounts to zero and accuracy to Needs source first, or add a new item in the correct place.");
        setFormIssues([]);
        return;
      }
      setEnteredSharedAmounts((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (scope !== "perOption") {
        setPendingPerOptionAmounts((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
      if (scope === "perOption" && modelDraft.scenarios.length > 0) {
        setPendingPerOptionAmounts((current) => ({
          ...current,
          [id]: new Set(modelDraft.scenarios.map((scenario) => scenario.id)),
        }));
      }
    }
    setFormNotice("");
    setFormIssues([]);
    setModelDraft(syncDocumentFields({
      ...modelDraft,
      fieldDefinitions: modelDraft.fieldDefinitions.map((candidate) =>
        candidate.id === id ? { ...candidate, group, scope } : candidate,
      ),
    }));
  };

  const addModelField = (group: FieldGroup, scope: FieldScope) => {
    if (!modelDraft) return;
    const id = createStableId(group.toLowerCase());
    if (scope === "perOption" && modelDraft.scenarios.length > 0) {
      setPendingPerOptionAmounts((current) => ({
        ...current,
        [id]: new Set(modelDraft.scenarios.map((scenario) => scenario.id)),
      }));
    }
    setModelDraft((current) => {
      if (!current) return current;
      return syncDocumentFields({
        ...current,
        fieldDefinitions: [
          ...current.fieldDefinitions,
          {
            id,
            label: "",
            description: "",
            group,
            scope,
          },
        ],
      });
    });
  };

  const removeModelField = (id: string, confirmed = false) => {
    if (!modelDraft) return;
    const populated =
      (modelDraft.sharedValues[id] ?? 0) !== 0 ||
      hasMeaningfulEvidence(modelDraft.sharedEvidence[id]) ||
      modelDraft.scenarios.some(
        (scenario) =>
          (scenario.values[id] ?? 0) !== 0 ||
          hasMeaningfulEvidence(scenario.evidence[id]),
      );
    if (populated && !confirmed) {
      setDeleteFieldConfirm(id);
      return;
    }
    setModelDraft(
      syncDocumentFields({
        ...modelDraft,
        fieldDefinitions: modelDraft.fieldDefinitions.filter(
          (field) => field.id !== id,
        ),
      }),
    );
    setEnteredSharedAmounts((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setPendingPerOptionAmounts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setDeleteFieldConfirm(null);
  };

  const sharedCommitmentTotal = plan.fieldDefinitions
    .filter((field) => field.group === "commitment" && field.scope === "shared")
    .reduce((total, field) => total + (plan.sharedValues[field.id] ?? 0), 0);
  const sharedInvestmentTotal = plan.fieldDefinitions
    .filter(
      (field) => field.group === "plannedInvestment" && field.scope === "shared",
    )
    .reduce((total, field) => total + (plan.sharedValues[field.id] ?? 0), 0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Wayfinder home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Wayfinder</strong><small>Compare monthly relocation plans</small></span>
        </a>
        <div className="topbar-actions">
          {plan.scenarios.length > 0 && (
            <div className="segmented" aria-label="How to display every amount">
              <button type="button" aria-pressed={mode === "base"} className={mode === "base" ? "active" : ""} onClick={() => setMode("base")}>All amounts in {plan.baseCurrency}</button>
              <button type="button" aria-pressed={mode === "local"} className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}>Each plan’s own currency</button>
            </div>
          )}
          <button className="button ghost" onClick={openManualSetup}>Home currency, future estimates, and amounts used in every plan</button>
          {plan.scenarios.length > 0 && <button className="button ghost share-button" onClick={() => setShareOpen(true)}>Download or import</button>}
          <button
            className="button primary"
            onClick={() =>
              plan.scenarios.length
                ? openNewOption()
                : openManualSetup()
            }
          >
            <span aria-hidden="true">＋</span> {plan.scenarios.length ? "Add another place, job, or plan" : "Enter my details"}
          </button>
        </div>
      </header>

      {(storageNotice || recoveryAvailable) && (
        <div
          className={`storage-notice ${storageNotice?.tone ?? "warning"}`}
          role={storageNotice?.tone === "error" ? "alert" : "status"}
        >
          <strong>{storageNotice?.tone === "error" ? "Browser save needs attention" : storageNotice?.tone === "seed" ? "Comparison ready" : recoveryAvailable ? "Old browser backup saved" : "Browser data restored"}</strong>
          <span>{storageNotice?.message ?? RECOVERY_NOTICE_MESSAGE}</span>
          {recoveryAvailable && (
            <button type="button" className="storage-notice-action" onClick={downloadRecoveryCopy}>
              Download old backup
            </button>
          )}
        </div>
      )}

      {plan.scenarios.length === 0 ? (
        <section className="welcome" id="top">
          <div className="welcome-copy">
            <div className="eyebrow"><span className="pulse-dot" /> Open source · private on your device</div>
            <h1>Enter your numbers. Compare <em>every move.</em></h1>
            <p>Enter details manually or import one JSON file containing your home currency, future estimates, amounts used in every plan, current position, alternatives, assumptions, and sources.</p>
            <div className="welcome-actions">
              <button className="button primary large" onClick={openManualSetup}>Enter my details</button>
              <button className="button ghost large" onClick={() => fileInputRef.current?.click()}>Import a saved comparison file</button>
              <button className="button ghost large" onClick={downloadAgentTemplate}>Download an empty comparison file</button>
            </div>
            <p className="privacy-note">No sign-in, cloud database, or telemetry. Your figures stay in this browser unless you deliberately download a file.</p>
          </div>
          <div className="welcome-steps" aria-label="How Wayfinder works">
            <article><b>01</b><div><strong>Home currency, future estimates, and amounts used in every plan</strong><span>Choose the home currency that anchors every chart and total, future-estimate assumptions, and any monthly amount entered once for every plan.</span></div></article>
            <article><b>02</b><div><strong>Add each place, job, or plan</strong><span>Start with your current job and home-country household position, then add each possible move, job, or household plan.</span></div></article>
            <article><b>03</b><div><strong>Review monthly saving and assumptions</strong><span>See gross income, deductions, costs, investments, cash left, assumptions, and sources.</span></div></article>
          </div>
        </section>
      ) : (
        <>
          <section className="hero" id="top">
            <div className="hero-copy">
              <div className="eyebrow"><span className="pulse-dot" /> {visible.length} included {visible.length === 1 ? "place, job, or plan" : "places, jobs, or plans"} · charts and totals in {plan.baseCurrency}</div>
              <h1>Compare monthly income, costs, and money left for each move.</h1>
              <p>Compare every place, job, or plan using the same monthly calculation and the currency used in charts and totals.</p>
              <div className="model-chips">
                <span>{formatMoney(sharedCommitmentTotal, plan.baseCurrency, plan.locale)} monthly obligations entered once for every plan</span>
                <span>{formatMoney(sharedInvestmentTotal, plan.baseCurrency, plan.locale)} monthly investments entered once for every plan</span>
              </div>
            </div>
            <button className="model-summary-card" onClick={openManualSetup}>
              <span>Applies to every place, job, or plan</span>
              <strong>Home currency, future estimates, and amounts used in every plan</strong>
              <small>Set the home currency that anchors every chart and total, forecast assumptions, and monthly amounts entered once for every plan.</small>
              <b>Open settings →</b>
            </button>
          </section>

          {visible.length === 0 && derived.length > 0 && (
            <section className="empty-selection panel">
              <h2>No places, jobs, or plans are included</h2>
              <p>Select at least one place, job, or plan below to populate the comparison and future estimate.</p>
            </section>
          )}

          {visible.length > 0 && (
            <section className="kpi-grid" aria-label="Financial highlights">
              <article className="kpi-card glow-blue">
                <span className="kpi-label">Highest total saved or left each month</span>
                <strong>{formatMoney(bestSaving?.totalSavingBase ?? 0, plan.baseCurrency, plan.locale, true)}</strong>
                <p>{bestSaving?.label}</p>
                <i style={{ width: `${Math.max(8, (bestSaving?.totalSavingBase ?? 0) / maxSaving * 100)}%` }} />
              </article>
              <article className="kpi-card glow-coral">
                <span className="kpi-label">Highest total saved or left among one-earner plans</span>
                <strong>{bestOneIncome ? formatMoney(bestOneIncome.totalSavingBase, plan.baseCurrency, plan.locale, true) : "—"}</strong>
                <p>{bestOneIncome?.label ?? "No one-earner place, job, or plan is included"}</p>
                <i style={{ width: `${Math.max(8, (bestOneIncome?.totalSavingBase ?? 0) / maxSaving * 100)}%` }} />
              </article>
              <article className="kpi-card glow-gold">
                <span className="kpi-label">Highest cash left each month</span>
                <strong>{formatMoney(bestCash?.cashRemainingBase ?? 0, plan.baseCurrency, plan.locale, true)}</strong>
                <p>{bestCash?.label}</p>
                <i style={{ width: `${Math.max(8, (bestCash?.cashRemainingBase ?? 0) / maxCash * 100)}%` }} />
              </article>
            </section>
          )}

          <section className="section-block scenarios-section">
            <div className="section-heading">
              <div><span className="section-kicker">01 · Your places, jobs, and plans</span><h2>See monthly income, costs, and money left</h2></div>
              <p>Open any place, job, or plan to see exactly where the monthly amounts go.</p>
            </div>
            {legacyRepairScenarios.length > 0 && (
              <div className="legacy-repair-panel" role="status">
                <div><strong>Older saved plans need a conversion date</strong><p>These saved places, jobs, or plans are kept safely but excluded from cards, totals, charts, and rankings until their currency conversion details are completed.</p></div>
                {legacyRepairScenarios.map((scenario) => (
                  <button key={scenario.id} type="button" className="button ghost" onClick={() => openScenarioEditor(scenario.id)}>
                    Complete {scenario.label || "older saved plan"}
                  </button>
                ))}
              </div>
            )}
            <div className="scenario-selector" aria-label="Places, jobs, and plans included in charts and totals">
              {derived.map((scenario) => (
                <label key={scenario.id}>
                  <input type="checkbox" checked={activeIds.includes(scenario.id)} onChange={() => toggleActive(scenario.id)} />
                  <span>{flagGlyph(scenario.flag)} {scenario.label}</span>
                </label>
              ))}
            </div>
            <div className="scenario-grid">
              {derived.map((scenario) => {
                const displayedSavings = balancedScenarioSavings(scenario, plan);
                return (
                <article className={`scenario-card ${activeIds.includes(scenario.id) ? "active" : "inactive"}`} key={scenario.id} style={{ "--accent": scenario.color } as CSSProperties}>
                  <div className="scenario-topline">
                    <span className="flag-badge">{flagGlyph(scenario.flag)}</span>
                    <span className="status-pill">{scenario.status}</span>
                    <button type="button" aria-pressed={activeIds.includes(scenario.id)} className={`scenario-toggle ${activeIds.includes(scenario.id) ? "on" : ""}`} onClick={() => toggleActive(scenario.id)} aria-label={`${activeIds.includes(scenario.id) ? "Exclude" : "Include"} ${scenario.label} in charts and totals`}><i /></button>
                  </div>
                  <h3>{scenario.label}</h3>
                  <p className="scenario-location">{scenario.location}</p>
                  <p className="scenario-employment">{scenario.employment}</p>

                  <div className="gross-banner">
                    <small>{scenario.id === plan.currentScenarioId ? "Current job and home-country household position" : "Possible job, move, or household plan"}</small>
                    <span>Monthly gross income before deductions</span>
                    <MoneyValue local={scenario.grossMonthly} base={scenario.grossBase} scenario={scenario} document={plan} mode={mode} />
                    <EvidenceBadge evidence={scenario.evidence.grossMonthly ?? createUnknownEvidence()} />
                  </div>

                  <dl className="tile-calculation">
                    <div><dt>Tax and other deductions{scenario.grossMonthly > 0 && <small>Effective: {formatPercent(scenario.deductionMonthly / scenario.grossMonthly * 100)} of monthly gross income</small>}</dt><dd><MoneyValue local={scenario.deductionMonthly} base={scenario.deductionBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                    <div><dt>Take-home cash</dt><dd><MoneyValue local={scenario.netCashMonthly} base={scenario.netCashBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                    <div><dt>Living costs</dt><dd><MoneyValue local={scenario.livingMonthly} base={scenario.livingBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                    <div><dt>Monthly obligations that continue</dt><dd><MoneyValue local={scenario.commitmentBase / scenario.fx.rateToBase} base={scenario.commitmentBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                  </dl>

                  <div className="saving-parent">
                    <div className="saving-parent-head">
                      <span>Total saved or left each month<small>Monthly investments + cash left after costs</small></span>
                      <MoneyValue local={displayedSavings.local.total} base={displayedSavings.base.total} scenario={scenario} document={plan} mode={mode} />
                    </div>
                    <div className="saving-children">
                      <div><span>↳ Monthly investments</span><MoneyValue local={displayedSavings.local.investments} base={displayedSavings.base.investments} scenario={scenario} document={plan} mode={mode} /></div>
                      <div><span>↳ Cash left each month</span><MoneyValue local={displayedSavings.local.cash} base={displayedSavings.base.cash} scenario={scenario} document={plan} mode={mode} /></div>
                    </div>
                    <div className="saving-identity">Monthly investments + cash left = total saved or left</div>
                  </div>

                  <div className="scenario-rate"><span>{formatPercent(scenario.savingRate)} of gross saved</span><span>1 {scenario.currency} = {scenario.fx.rateToBase} {plan.baseCurrency}</span></div>

                  <details className="tile-breakdown">
                    <summary>Expand full calculation and sources</summary>
                    <BreakdownGroup title="Tax and other deductions" items={scenario.breakdown.deduction} scenario={scenario} document={plan} mode={mode} />
                    <BreakdownGroup title="Monthly automatic payroll savings · part of total saved or left" items={scenario.breakdown.automaticInvestment} scenario={scenario} document={plan} mode={mode} />
                    <BreakdownGroup title="Monthly living costs" items={scenario.breakdown.livingCost} scenario={scenario} document={plan} mode={mode} />
                    <BreakdownGroup title="Monthly obligations that continue" items={scenario.breakdown.commitment} scenario={scenario} document={plan} mode={mode} />
                    <BreakdownGroup title="Monthly investments from after-tax cash · part of saving" items={scenario.breakdown.plannedInvestment} scenario={scenario} document={plan} mode={mode} />
                    <section className="breakdown-group fx-breakdown">
                      <h4>Exchange-rate assumption</h4>
                      <p>1 {scenario.currency} = <strong>{scenario.fx.rateToBase} {plan.baseCurrency}</strong></p>
                      <p>{scenario.currency === plan.baseCurrency
                        ? `No conversion needed · this plan uses ${plan.baseCurrency}, the home currency that anchors all charts and totals${scenario.fx.asOf ? ` · reference date ${scenario.fx.asOf}` : ""}`
                        : `${scenario.fx.source || "No source recorded"}${scenario.fx.asOf ? ` · as of ${scenario.fx.asOf}` : " · date not recorded"}`}</p>
                    </section>
                  </details>

                  <div className="scenario-actions">
                    <button type="button" onClick={() => openScenarioEditor(scenario.id)}>Edit this place, job, or plan</button>
                    <button type="button" onClick={() => duplicateScenario(scenario.id)}>Duplicate</button>
                  </div>
                </article>
                );
              })}
            </div>
          </section>

          {visible.length > 0 && (
            <>
            <section className="section-block comparison-section">
              <div className="section-heading">
                  <div><span className="section-kicker">02 · Monthly comparison</span><h2>Total saved or left, split into its two parts</h2></div>
                  <p>The total saved or left each month is always split into monthly investments and cash left—never three unrelated totals. Cash shown is the balancing remainder after currency rounding; calculations retain full precision.</p>
                </div>
                <div className="comparison-layout">
                  <div className="bar-panel panel">
                    <div className="panel-title"><span>Total saved or left each month in {plan.baseCurrency}</span><small>monthly investments + cash left after costs</small></div>
                    <div className="comparison-bars">
                      {[...visible].sort((a, b) => b.totalSavingBase - a.totalSavingBase).map((scenario, index) => {
                        const magnitude = Math.abs(scenario.totalSavingBase) / maxSavingMagnitude * 50;
                        const negative = scenario.totalSavingBase < 0;
                        return (
                          <div className="comparison-row" key={scenario.id}>
                            <div className="comparison-name"><b>{String(index + 1).padStart(2, "0")}</b><span>{scenario.label}<small>{scenario.employment}</small></span></div>
                            <div className={`bar-rail signed ${negative ? "negative" : "positive"}`}>
                              <i aria-hidden="true" style={{ width: `${magnitude}%`, left: `${negative ? 50 - magnitude : 50}%`, background: scenario.color }} />
                              <b className="zero-axis" aria-hidden="true" />
                              <span>{formatMoney(scenario.totalSavingBase, plan.baseCurrency, plan.locale)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="cash-panel panel">
                    <div className="panel-title"><span>How the total saved or left is split</span><small>monthly investments + cash left</small></div>
                    <div className="saving-split-list">
                      {[...visible].sort((a, b) => b.totalSavingBase - a.totalSavingBase).map((scenario) => {
                        const denominator = Math.max(1, scenario.totalSavingBase);
                        const investmentPct = Math.max(0, Math.min(100, scenario.totalInvestmentBase / denominator * 100));
                        const hasDeficit = scenario.totalSavingBase < 0 || scenario.cashRemainingBase < 0;
                        const displayedSavings = balancedScenarioSavings(scenario, plan).base;
                        return (
                          <div className="saving-split-row" key={scenario.id}>
                            <div><strong>{scenario.label}</strong><span>{formatMoney(displayedSavings.total, plan.baseCurrency, plan.locale)} saved or left each month</span></div>
                            {hasDeficit ? (
                              <div className="split-deficit">Cash is below zero after monthly costs; this place, job, or plan has a monthly shortfall.</div>
                            ) : (
                              <div className="split-rail"><i style={{ width: `${investmentPct}%`, background: scenario.color }} /><b /></div>
                            )}
                            <small><span>Monthly investments {formatMoney(displayedSavings.investments, plan.baseCurrency, plan.locale)}</span><span>Cash left {formatMoney(displayedSavings.cash, plan.baseCurrency, plan.locale)}</span></small>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="section-block projection-section">
                <div className="section-heading projection-heading">
                  <div><span className="section-kicker">03 · {plan.projectionAssumptions.years}-year future estimate</span><h2>Choose the monthly amount shown in each future chart</h2></div>
                  <button className="button ghost" onClick={openManualSetup}>Edit future-estimate assumptions</button>
                </div>
                <div className="projection-metric-picker" aria-label="Projected financial metric">
                  {(Object.keys(projectionMeta) as ProjectionMetric[]).map((metric) => (
                    <button type="button" aria-pressed={projectionMetric === metric} key={metric} className={projectionMetric === metric ? "active" : ""} onClick={() => setProjectionMetric(metric)}>{projectionMeta[metric].label}</button>
                  ))}
                </div>
                <div className="chart-legend">
                  <i /><span><strong>{projectionMeta[projectionMetric].label}</strong> in {plan.baseCurrency}, the home currency that anchors all charts and totals. {projectionMeta[projectionMetric].explanation}</span>
                </div>
                <div className="projection-grid">
                  {projections.map(({ scenario, years }) => {
                    const cumulative = years.reduce((total, year) => total + year[projectionMetric] * 12, 0);
                    return (
                      <article className="projection-card" key={scenario.id} style={{ "--accent": scenario.color } as CSSProperties}>
                        <div className="projection-card-head"><span className="flag-badge small">{flagGlyph(scenario.flag)}</span><div><h3>{scenario.label}</h3><small>{plan.projectionAssumptions.years}-year {projectionMeta[projectionMetric].cumulative}</small></div><strong>{formatMoney(cumulative, plan.baseCurrency, plan.locale, true)}</strong></div>
                        <div className="skyline" aria-label={`Projected monthly ${projectionMeta[projectionMetric].label.toLowerCase()} for ${scenario.label}`}>
                          {years.map((year) => {
                            const value = year[projectionMetric];
                            const height = value === 0 ? 0 : Math.max(2, Math.abs(value) / maxProjectedMagnitude * 48);
                            return (
                              <div className="projection-year" key={year.year}>
                                <span>{formatMoney(value, plan.baseCurrency, plan.locale, true)}</span>
                                <div className="signed-column" aria-hidden="true">
                                  <i className={value < 0 ? "negative" : "positive"} style={{ height: `${height}%` }} />
                                </div>
                                <small>Y{year.year}</small>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <p className="projection-note">Each bar shows one month; each headline adds twelve months for every displayed year. Income grows {plan.projectionAssumptions.incomeGrowthPct}% yearly, living costs and monthly obligations that continue inflate {plan.projectionAssumptions.expenseInflationPct}% yearly, and planned monthly investment targets stay constant. Tax rules, currency-rate changes, investment returns, bonuses, and job changes are not forecast.</p>
              </section>

              <section className="section-block matrix-section">
                <div className="section-heading">
                  <div><span className="section-kicker">04 · Important non-financial details</span><h2>Important details the monthly amounts cannot decide</h2></div>
                  <p>Career, visa, childcare, transport, and family details remain visible text—not arbitrary scores.</p>
                </div>
                <div className="matrix-wrap panel">
                  <table className="decision-matrix">
                    <thead><tr><th>What is assumed</th>{visible.map((scenario) => <th key={scenario.id}><span>{flagGlyph(scenario.flag)}</span>{scenario.label}</th>)}</tr></thead>
                    <tbody>
                      {[
                        ["Who earns income in this plan", "People and income included in this place, job, or plan", (s: DerivedScenario) => s.employment],
                        ["Number of earners counted", "People whose income is included in this plan", (s: DerivedScenario) => `${s.earners} ${s.earners === 1 ? "earner" : "earners"}`],
                        ["Partner income included", "Whether a partner's income is included in this plan", (s: DerivedScenario) => s.spouseJob],
                        ["Childcare arrangement and cost", "Care arrangement behind the monthly costs", (s: DerivedScenario) => s.childcare],
                        ["Transport choice and cost", "Transport choice behind the monthly costs", (s: DerivedScenario) => s.transport],
                        ["Residence or visa condition", "Legal-status condition used for this plan", (s: DerivedScenario) => s.residency],
                        ["Bonus or one-time payment", "Whether it is included in recurring monthly amounts", (s: DerivedScenario) => s.bonus],
                        ["Benefits included in this plan", "Confirmed or included benefits and terms", (s: DerivedScenario) => s.benefits.join("; ") || "None listed"],
                        ["Important details still to verify", "Items that could change this plan", (s: DerivedScenario) => s.risks.join("; ") || "None listed"],
                      ].map(([label, note, getter]) => (
                        <tr className="text-row" key={label as string}>
                          <th><strong>{label as string}</strong><small>{note as string}</small></th>
                          {visible.map((scenario) => <td key={scenario.id}>{(getter as (s: DerivedScenario) => string)(scenario)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="section-block research-section">
                <div className="section-heading">
                  <div><span className="section-kicker">05 · Research and sources</span><h2>Sources behind the assumptions</h2></div>
                  <p>Review the links used for taxes, visas, housing, childcare, transport, healthcare, weather, and jobs.</p>
                </div>
                {plan.researchItems.length ? (
                  <div className="research-grid">
                    {plan.researchItems.map((item) => {
                      const applicable = item.appliesToScenarioIds.length
                        ? plan.scenarios.filter((scenario) => item.appliesToScenarioIds.includes(scenario.id)).map((scenario) => scenario.label).join(", ")
                        : "All places, jobs, and plans";
                      return (
                        <article className="research-card" key={item.id}>
                          <div><span className={`research-status ${item.status}`}>{item.status}</span><span>{researchTopicLabels[item.topic]}</span></div>
                          <h3>{item.title}</h3>
                          <p>{item.finding}</p>
                          <dl><div><dt>Applies to</dt><dd>{applicable}</dd></div><div><dt>Publisher</dt><dd>{item.publisher || "Not recorded"}</dd></div><div><dt>As of</dt><dd>{item.asOf || "Not recorded"}</dd></div></dl>
                          {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a> : <span className="missing-source">Source link needed</span>}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="panel empty-research"><p>No research records yet. Add them in Home currency, future estimates, and amounts used in every plan, or import a saved comparison file.</p><button className="button ghost" onClick={openManualSetup}>Add research records</button></div>
                )}
              </section>

              <section className="section-block ledger-section">
                <div className="section-heading">
                  <div><span className="section-kicker">06 · How monthly totals are calculated</span><h2>The same monthly calculation for every place, job, or plan</h2></div>
                  <p>Gross income − tax and other non-saving deductions − automatic payroll saving = take-home cash. Total saved or left = monthly investments + cash left after living costs and commitments.</p>
                </div>
                <div className="matrix-wrap panel">
                  <table className="ledger-table">
                    <thead><tr><th>Monthly measure</th>{visible.map((scenario) => <th key={scenario.id}>{scenario.label}</th>)}</tr></thead>
                    <tbody>
                      {[
                        ["Monthly gross income before tax and deductions", (s: DerivedScenario) => [s.grossMonthly, s.grossBase]],
                        ["Tax and other deductions", (s: DerivedScenario) => [s.deductionMonthly, s.deductionBase]],
                        ["Monthly automatic payroll saving", (s: DerivedScenario) => [s.automaticInvestmentMonthly, s.automaticInvestmentBase]],
                        ["Take-home cash", (s: DerivedScenario) => [s.netCashMonthly, s.netCashBase]],
                        ["Living costs", (s: DerivedScenario) => [s.livingMonthly, s.livingBase]],
                        ["Monthly obligations that continue", (s: DerivedScenario) => [s.commitmentBase / s.fx.rateToBase, s.commitmentBase]],
                        ["Total saved or left each month", (s: DerivedScenario) => {
                          const displayed = balancedScenarioSavings(s, plan);
                          return [displayed.local.total, displayed.base.total];
                        }],
                        ["↳ Monthly investments", (s: DerivedScenario) => {
                          const displayed = balancedScenarioSavings(s, plan);
                          return [displayed.local.investments, displayed.base.investments];
                        }],
                        ["↳ Cash left each month", (s: DerivedScenario) => {
                          const displayed = balancedScenarioSavings(s, plan);
                          return [displayed.local.cash, displayed.base.cash];
                        }],
                      ].map(([label, getter]) => (
                        <tr key={label as string} className={label === "Total saved or left each month" ? "total-row" : String(label).startsWith("↳") ? "child-row" : ""}>
                          <th>{label as string}</th>
                          {visible.map((scenario) => {
                            const [local, base] = (getter as (s: DerivedScenario) => number[])(scenario);
                            return <td key={scenario.id}><MoneyValue local={local} base={base} scenario={scenario} document={plan} mode={mode} /></td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="section-block evidence-section">
                <div className="evidence-card">
                  <div><span className="section-kicker">Rules used everywhere</span><h2>Same rules, no hidden arithmetic</h2></div>
                  <div className="evidence-rules">
                    <p><strong>External help received:</strong> may be recorded for context, never counted as income or expense.</p>
                    <p><strong>Monthly obligations that continue:</strong> an amount entered once for every plan is stored in {plan.baseCurrency}, the home currency that anchors all charts and totals.</p>
                    <p><strong>Monthly investments:</strong> part of total saved or left; total saved or left always equals monthly investments plus cash left.</p>
                    <p><strong>How reliable is this number?</strong> Every input can be marked confirmed, estimated, or still needing a source.</p>
                  </div>
                  {plan.excludedSupport.length > 0 && (
                    <div className="excluded-support-summary">
                      <strong>External Help / Family Support received · context only</strong>
                      <small>Shown for planning, but excluded from income, expenses, savings, charts, and rankings.</small>
                      <div>
                        {plan.excludedSupport.map((item) => (
                          <p key={item.id}><span>{item.label}</span><b>{formatMoney(item.monthlyBase, plan.baseCurrency, plan.locale)}</b><small>{item.note || "No note recorded"}</small></p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}

      <footer className="footer">
        <div><strong>Wayfinder</strong><span>Private relocation comparison</span></div>
        <div className="footer-actions">
          <button onClick={openManualSetup}>Home currency, future estimates, and amounts used in every plan</button>
          {plan.scenarios.length > 0 && <button onClick={() => setShareOpen(true)}>Download or import</button>}
          <button onClick={() => fileInputRef.current?.click()}>Import a saved comparison file</button>
          {(plan.scenarios.length > 0 || plan.excludedSupport.length > 0 || recoveryAvailable) && <button onClick={() => setClearConfirm(true)}>Clear this browser</button>}
        </div>
        <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Select a saved comparison JSON file" onChange={importDocument} />
      </footer>

      {shareOpen && plan.scenarios.length > 0 && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close download and import options" onClick={() => setShareOpen(false)} />
          <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" data-dialog-id="share" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Keep a copy or prepare a family summary</span><h2 id="share-title">Download or import a comparison file</h2></div><button type="button" className="close-button" onClick={() => setShareOpen(false)} aria-label="Close download and import options">×</button></div>
            <p className="modal-intro">Downloaded financial files are sensitive. This public project includes only the empty application and fictional examples—never your browser data.</p>
            {legacyRepairScenarios.length > 0 && <p className="modal-intro"><strong>Complete the older saved plans’ conversion date and source first.</strong> Until then, calculated family views and reusable comparison files stay unavailable.</p>}
            <div className="share-choices three-up">
              <article><span className="share-icon" aria-hidden="true">↗</span><div><h3>Family-readable summary</h3><p>A read-only HTML summary with the saved calculations and assumptions. It works offline in a modern browser.</p></div><button className="button primary" disabled={legacyRepairScenarios.length > 0} onClick={downloadFamilyView}>Download family-readable summary</button></article>
              <article><span className="share-icon" aria-hidden="true">⇄</span><div><h3>Saved comparison file you can edit</h3><p>The complete file: home currency, future estimates, amounts used in every plan, every place, job, or plan, assumptions, confidence, and sources.</p></div><button className="button ghost" disabled={legacyRepairScenarios.length > 0} onClick={exportDocument}>Download saved comparison file</button></article>
              <article><span className="share-icon" aria-hidden="true">◎</span><div><h3>Empty comparison file</h3><p>An empty JSON file with standard categories, ready to fill in and preview before importing.</p></div><button className="button ghost" onClick={downloadAgentTemplate}>Download empty comparison file</button></article>
            </div>
            <div className="share-network-note"><strong>Import safety</strong><p>Wayfinder validates the entire file and shows a preview before replacement. No import silently overwrites the current dashboard.</p></div>
          </section>
        </div>
      )}

      {modelDraft && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close home currency, future estimates, and amounts used in every plan" onClick={closeModelEditor} />
          <form className="scenario-modal model-modal" role="dialog" aria-modal="true" aria-labelledby="model-title" data-dialog-id="comparison-model" tabIndex={-1} onSubmit={saveModel} onInvalidCapture={revealFirstInvalidControl} onChangeCapture={() => { setFormNotice(""); setFormIssues([]); }}>
            <div className="modal-head"><div><span className="section-kicker">Settings applied to every plan</span><h2 id="model-title">Home currency, future estimates, and amounts used in every plan</h2></div><button type="button" className="close-button" onClick={closeModelEditor} aria-label="Close home currency, future estimates, and amounts used in every plan">×</button></div>
            <p className="modal-intro">Set the home currency that anchors all charts and totals, plus future-estimate assumptions. Each alternative plan’s local currency is converted to the home currency. Enter a monthly amount once only when it applies to every place, job, or plan; otherwise enter a separate monthly amount for each one.</p>
            <FormErrorSummary notice={formNotice} issues={formIssues} document={modelDraft} />

            <fieldset className="editor-section">
              <legend>Home currency and future-estimate settings</legend>
              <div className="form-grid">
                <label className="wide"><span>Comparison title</span><input required maxLength={160} placeholder="Name this comparison" value={modelDraft.title} onChange={(event) => setModelDraft({ ...modelDraft, title: event.target.value })} /></label>
                <label><span>Home currency for all charts and totals<small>This three-letter currency anchors all charts and totals. Each alternative plan’s local currency is converted to it. It is normally the home-currency anchor.</small></span><input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" placeholder="USD" title="Enter a three-letter currency code such as USD" disabled={comparisonCurrencyLocked} value={modelDraft.baseCurrency} onChange={(event) => setModelDraft({ ...modelDraft, baseCurrency: currencyCode(event.target.value) })} /></label>
                <label><span>Number format for amounts<small>For example en-US or en-GB</small></span><input required maxLength={50} placeholder="en-US" value={modelDraft.locale} onChange={(event) => setModelDraft({ ...modelDraft, locale: event.target.value })} /></label>
                <label><span>Annual income growth for the future estimate %<small>Enter your own assumption; this does not change current monthly amounts.</small></span><input required min="-25" max="100" step="0.1" type="number" placeholder="5" value={projectionInputDraft?.incomeGrowthPct ?? ""} onChange={(event) => setProjectionInputDraft((current) => ({ ...(current ?? { incomeGrowthPct: "", expenseInflationPct: "", years: "" }), incomeGrowthPct: event.target.value }))} /></label>
                <label><span>Annual cost inflation for the future estimate %<small>Enter your own assumption; this does not change current monthly amounts.</small></span><input required min="-25" max="100" step="0.1" type="number" placeholder="3" value={projectionInputDraft?.expenseInflationPct ?? ""} onChange={(event) => setProjectionInputDraft((current) => ({ ...(current ?? { incomeGrowthPct: "", expenseInflationPct: "", years: "" }), expenseInflationPct: event.target.value }))} /></label>
                <label><span>Years to show in the future estimate<small>Choose how many future years the charts show.</small></span><input required min="1" max="20" step="1" type="number" placeholder="5" value={projectionInputDraft?.years ?? ""} onChange={(event) => setProjectionInputDraft((current) => ({ ...(current ?? { incomeGrowthPct: "", expenseInflationPct: "", years: "" }), years: event.target.value }))} /></label>
                {modelDraft.scenarios.length > 0 && (
                  <label className="wide"><span>Current job and home-country position<small>Choose the saved place, job, or plan that represents your current household position. This does not change any monthly amounts.</small></span><select required value={modelDraft.currentScenarioId ?? ""} onChange={(event) => setModelDraft({ ...modelDraft, currentScenarioId: event.target.value || null })}><option value="">Choose the current job and home-country position</option>{modelDraft.scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label || "Unnamed place, job, or plan"}</option>)}</select></label>
                )}
              </div>
              {modelDraft.scenarios.length === 0 && (
                <label className="setup-review-confirmation">
                  <input required type="checkbox" checked={setupSettingsReviewed} onChange={(event) => setSetupSettingsReviewed(event.target.checked)} />
                  <span>I reviewed the home currency for all charts and totals, number format, growth, inflation, and future-estimate years. These are my inputs, not automatic forecasts.</span>
                </label>
              )}
              {comparisonCurrencyLocked && (
                <div className="currency-restart-note">
                  <p className="field-note">{modelDraft.scenarios.length > 0
                    ? "The home currency that anchors all charts and totals stays fixed after plans are added, so saved amounts cannot silently change meaning."
                    : "The home currency that anchors all charts and totals stays fixed while applies-to-every-plan or excluded-support amounts are entered, so those numbers cannot silently change meaning. Set those amounts to zero or start again to choose another currency."}</p>
                  <button type="button" className="button ghost" onClick={() => { setCurrencyRestartDraft(cloneDocument(modelDraft)); setModelDraft(null); setClearConfirm(true); }}>Back up or start again with another currency</button>
                </div>
              )}
            </fieldset>

            {modelDraft.legacyMigrationNotes.length > 0 && (
              <EditorSection
                title="Notes kept from an older file"
                summary={`${modelDraft.legacyMigrationNotes.length} ${modelDraft.legacyMigrationNotes.length === 1 ? "note" : "notes"}`}
                note="These notes never affect calculations and are excluded from the family report. They are kept only as read-only context from an earlier file."
                collapsible
              >
                <ul className="legacy-migration-notes">
                  {modelDraft.legacyMigrationNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                </ul>
                <button type="button" className="button ghost" onClick={() => setModelDraft({ ...modelDraft, legacyMigrationNotes: [] })}>Remove all retained old notes</button>
              </EditorSection>
            )}

            {(Object.keys(groupMeta) as FieldGroup[]).map((group) => {
              const fields = modelDraft.fieldDefinitions.filter((field) => field.group === group);
              const allowShared = group === "commitment" || group === "plannedInvestment";
              const blankSharedFields = fields.filter((field) =>
                field.scope === "shared" && !enteredSharedAmounts.has(field.id),
              );
              const pendingFields = fields.filter((field) =>
                field.scope === "perOption" && (pendingPerOptionAmounts[field.id]?.size ?? 0) > 0,
              );
              return (
                <EditorSection
                  key={group}
                  title={groupMeta[group].title}
                  note={groupMeta[group].help}
                  collapsible={fields.length >= LONG_EDITOR_SECTION_SIZE}
                  summary={`${fields.length} ${fields.length === 1 ? "item" : "items"}`}
                >
                  <div className="model-field-list">
                    {fields.map((field) => (
                      <Fragment key={field.id}>
                        <div className="model-field-row">
                          <div className="field-copy">
                            <input aria-label={`${groupMeta[group].short} field label`} required maxLength={120} placeholder="Name this monthly item" value={field.label} onChange={(event) => updateModelField(field.id, { label: event.target.value })} />
                            <input aria-label={`${field.label || groupMeta[group].short} description`} maxLength={500} placeholder="What does this amount include?" value={field.description} onChange={(event) => updateModelField(field.id, { description: event.target.value })} />
                            <div className="field-classification">
                              <label><span>What this monthly amount is for</span><select aria-label={`${field.label || "New item"} category`} value={field.group} onChange={(event) => { const nextGroup = event.target.value as FieldGroup; reclassifyModelField(field.id, nextGroup, field.scope); }}>{(Object.keys(groupMeta) as FieldGroup[]).map((candidate) => <option key={candidate} value={candidate}>{groupMeta[candidate].title}</option>)}</select></label>
                              <label><span>Where this monthly amount applies</span><select aria-label={`${field.label || "New item"} scope`} disabled={!allowShared} value={field.scope} onChange={(event) => reclassifyModelField(field.id, field.group, event.target.value as FieldScope)}><option value="perOption">Enter a separate amount for each plan</option><option value="shared">Enter once for every plan</option></select></label>
                            </div>
                          </div>
                          {field.scope === "shared" && (
                            <div className="shared-amount">
                              <label><span>Monthly amount entered once for every plan in {modelDraft.baseCurrency || "the home currency for all charts and totals"}<small>This same amount is included in every place, job, or plan; choose the home currency for all charts and totals first.</small></span><input required aria-label={`${field.label} monthly amount in ${modelDraft.baseCurrency || "home currency for all charts and totals"}`} disabled={!/^[A-Z]{3}$/.test(modelDraft.baseCurrency)} min="0" step="any" type="number" value={enteredSharedAmounts.has(field.id) ? modelDraft.sharedValues[field.id] ?? 0 : ""} onChange={(event) => updateSharedAmount(field.id, event.target.value)} /></label>
                              <EvidenceEditor evidence={modelDraft.sharedEvidence[field.id] ?? createUnknownEvidence()} onChange={(evidence) => setModelDraft({ ...modelDraft, sharedEvidence: { ...modelDraft.sharedEvidence, [field.id]: evidence } })} />
                            </div>
                          )}
                          <button type="button" className="remove-field" onClick={() => removeModelField(field.id)}>Remove</button>
                        </div>
                        {deleteFieldConfirm === field.id && (
                          <div className="field-removal-confirm" role="alert">
                            <div>
                              <strong>Remove “{field.label}”?</strong>
                              <span>{legacyRepairScenarios.length > 0 ? "No reusable backup is available until every older saved plan has a real conversion date and source. " : ""}This removes the item, its monthly amount, and its source details from the home currency, future estimates, and amounts used in every plan, plus all {modelDraft.scenarios.length} {modelDraft.scenarios.length === 1 ? "place, job, or plan" : "places, jobs, or plans"}.</span>
                            </div>
                            <button type="button" className="button ghost" disabled={legacyRepairScenarios.length > 0} onClick={exportDocument}>{legacyRepairScenarios.length > 0 ? "Reusable backup unavailable" : "Download saved backup"}</button>
                            <button type="button" className="button ghost" onClick={() => setDeleteFieldConfirm(null)}>Cancel</button>
                            <button type="button" className="button danger" onClick={() => removeModelField(field.id, true)}>{legacyRepairScenarios.length > 0 ? "Remove without reusable backup" : "Confirm remove"}</button>
                          </div>
                        )}
                      </Fragment>
                    ))}
                  </div>
                  {pendingFields.length > 0 && (
                    <div className="amount-field-list" aria-live="polite">
                      <p className="field-note">These new monthly items are not saved yet. Enter an amount for every existing place, job, or plan, or explicitly use 0 where an item does not apply.</p>
                      {modelDraft.scenarios.map((scenario) => {
                        const pendingForScenario = pendingFields.filter((field) =>
                          pendingPerOptionAmounts[field.id]?.has(scenario.id),
                        );
                        if (!pendingForScenario.length) return null;
                        return (
                          <fieldset className="editor-section" key={scenario.id}>
                            <legend>{scenario.label || "Existing place, job, or plan"}</legend>
                            {pendingForScenario.map((field) => {
                              const label = `${field.label || "New monthly item"} for ${scenario.label || "this place, job, or plan"}`;
                              return (
                                <CurrencyAmountEditor
                                  key={`${field.id}-${scenario.id}-${scenario.currency}-${modelDraft.baseCurrency}`}
                                  id={`pending-${field.id}-${scenario.id}`}
                                  label={label}
                                  description="This amount is not saved until you enter it or explicitly use 0."
                                  localAmount={scenario.values[field.id] ?? 0}
                                  localCurrency={scenario.currency}
                                  baseCurrency={modelDraft.baseCurrency}
                                  rateToBase={scenario.fx.rateToBase}
                                  entered={!pendingPerOptionAmounts[field.id]?.has(scenario.id)}
                                  onChangeLocal={(amount) => updatePendingPerOptionAmount(field.id, scenario.id, amount)}
                                />
                              );
                            })}
                            <button
                              type="button"
                              className="button ghost"
                              onClick={() => markPendingPerOptionAmountsAsZero(pendingForScenario.map((field) => field.id), scenario.id)}
                            >
                              Use 0 for {pendingForScenario.length} blank {pendingForScenario.length === 1 ? "monthly amount" : "monthly amounts"} for {scenario.label || "this place, job, or plan"} in this section
                            </button>
                          </fieldset>
                        );
                      })}
                    </div>
                  )}
                  {blankSharedFields.length > 0 && (
                    <button type="button" className="button ghost" onClick={() => markSharedAmountsAsZero(blankSharedFields.map((field) => field.id))}>
                      Use 0 for {blankSharedFields.length} blank monthly {blankSharedFields.length === 1 ? "amount" : "amounts"} that apply to every place, job, or plan in this section
                    </button>
                  )}
                  <div className="add-field-actions">
                    <button type="button" className="button ghost" onClick={() => addModelField(group, "perOption")}>＋ Add a monthly amount for each place, job, or plan</button>
                    {allowShared && <button type="button" className="button ghost" onClick={() => addModelField(group, "shared")}>＋ Add one monthly amount for every place, job, or plan</button>}
                  </div>
                </EditorSection>
              );
            })}

            <EditorSection
              title="External Help / Family Support received"
              note="Record it only for context. It will never increase income, reduce expenses, savings, or charts."
              collapsible
              summary={`${modelDraft.excludedSupport.length} ${modelDraft.excludedSupport.length === 1 ? "note" : "notes"} · excluded from totals`}
            >
              <div className="excluded-support-list">
                {modelDraft.excludedSupport.map((item) => (
                  <div className="excluded-support-row" key={item.id}>
                    <label><span>Possible support name</span><input required maxLength={120} aria-label="Excluded support label" placeholder="Name the possible support" value={item.label} onChange={(event) => setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) })} /></label>
                    <label><span>Possible monthly support in {modelDraft.baseCurrency || "the home currency for all charts and totals"}<small>Context only; it does not change income, costs, money saved or left, or charts. Choose the home currency for all charts and totals first.</small></span><input required aria-label={`${item.label} monthly amount in ${modelDraft.baseCurrency || "home currency for all charts and totals"}`} disabled={!/^[A-Z]{3}$/.test(modelDraft.baseCurrency)} min="0" step="any" type="number" value={enteredSupportAmounts.has(item.id) ? item.monthlyBase : ""} onChange={(event) => updateSupportAmount(item.id, event.target.value)} /></label>
                    <label><span>Context note</span><input maxLength={1000} aria-label={`${item.label || "Excluded support"} note`} value={item.note} placeholder="Who may help and what could change?" onChange={(event) => setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.map((candidate) => candidate.id === item.id ? { ...candidate, note: event.target.value } : candidate) })} /></label>
                    <button type="button" onClick={() => { setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.filter((candidate) => candidate.id !== item.id) }); setEnteredSupportAmounts((current) => { const next = new Set(current); next.delete(item.id); return next; }); }}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="button ghost" onClick={() => setModelDraft({ ...modelDraft, excludedSupport: [...modelDraft.excludedSupport, { id: createStableId("excluded-support"), label: "", monthlyBase: 0, note: "" }] })}>＋ Add excluded support note</button>
            </EditorSection>

            <EditorSection
              title="Research and sources"
              note="Use official or primary sources where possible. Record the dated finding, source, and places, jobs, or plans it affects; research notes never change money totals by themselves."
              collapsible
              summary={`${modelDraft.researchItems.length} ${modelDraft.researchItems.length === 1 ? "source" : "sources"}`}
            >
              <div className="research-editor-list">
                {modelDraft.researchItems.map((item) => (
                  <article className="research-editor-row" key={item.id}>
                    <div className="form-grid">
                      <label><span>Topic</span><select value={item.topic} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, topic: event.target.value as ResearchTopic } : candidate) })}>{(Object.keys(researchTopicLabels) as ResearchTopic[]).map((topic) => <option key={topic} value={topic}>{researchTopicLabels[topic]}</option>)}</select></label>
                      <label><span>Status</span><select value={item.status} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, status: event.target.value as "verified" | "estimate" | "question" } : candidate) })}><option value="verified">Verified</option><option value="estimate">Estimate</option><option value="question">Open question</option></select></label>
                      <label className="wide"><span>Finding title</span><input required maxLength={200} placeholder="What did you learn?" value={item.title} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate) })} /></label>
                      <label className="wide"><span>Finding or implication</span><textarea required maxLength={5000} placeholder="State the finding and why it matters" rows={3} value={item.finding} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, finding: event.target.value } : candidate) })} /></label>
                      <label><span>Publisher{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} maxLength={300} value={item.publisher} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, publisher: event.target.value } : candidate) })} /></label>
                      <label><span>As of{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} type="date" value={item.asOf ?? ""} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, asOf: event.target.value || null } : candidate) })} /></label>
                      <label className="wide"><span>Source title{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} maxLength={500} value={item.sourceTitle} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, sourceTitle: event.target.value } : candidate) })} /></label>
                      <label className="wide"><span>HTTPS source URL{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} maxLength={2000} type="url" pattern="https://.*" value={item.sourceUrl} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, sourceUrl: event.target.value } : candidate) })} /></label>
                      <label className="wide"><span>Review note</span><input maxLength={2000} value={item.note} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, note: event.target.value } : candidate) })} /></label>
                    </div>
                    <div className="research-applicability">
                      <strong>Applies to which places, jobs, or plans?</strong><small>Leave every box clear to apply it to every place, job, and plan.</small>
                      <div>{modelDraft.scenarios.map((scenario) => <label key={scenario.id}><input type="checkbox" checked={item.appliesToScenarioIds.includes(scenario.id)} onChange={() => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, appliesToScenarioIds: candidate.appliesToScenarioIds.includes(scenario.id) ? candidate.appliesToScenarioIds.filter((id) => id !== scenario.id) : [...candidate.appliesToScenarioIds, scenario.id] } : candidate) })} />{scenario.label}</label>)}</div>
                    </div>
                    <button type="button" className="remove-field" onClick={() => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.filter((candidate) => candidate.id !== item.id) })}>Remove research record</button>
                  </article>
                ))}
              </div>
              <button type="button" className="button ghost" onClick={() => setModelDraft({ ...modelDraft, researchItems: [...modelDraft.researchItems, { id: createStableId("research"), topic: "other", title: "", finding: "", appliesToScenarioIds: [], status: "question", publisher: "", sourceTitle: "", sourceUrl: "", asOf: null, note: "" }] })}>＋ Add research record</button>
            </EditorSection>

            <div className="modal-actions"><span /><button type="button" className="button ghost" onClick={closeModelEditor}>Cancel</button><button type="submit" className="button primary">{modelDraft.scenarios.length ? "Apply home currency, future estimates, and amounts used in every plan" : "Save settings and enter your current place, job, or plan"}</button></div>
          </form>
        </div>
      )}

      {editor && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close place, job, or plan editor" onClick={() => setEditor(null)} />
          <form className="scenario-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-editor-title" data-dialog-id="scenario-editor" tabIndex={-1} onSubmit={saveScenario} onInvalidCapture={revealFirstInvalidControl} onChangeCapture={() => { setFormNotice(""); setFormIssues([]); }}>
            <div className="modal-head"><div><span className="section-kicker">{editorRepresentsCurrentPosition ? "Your current job and home-country household position" : "Possible job, move, or household plan"}</span><h2 id="scenario-editor-title">{firstScenarioSetup ? "Enter your current job and home-country household position" : editingCurrentScenario ? "Edit your current job and home-country household position" : editingExisting ? "Edit this place, job, or plan" : "Add another possible job, move, or household plan"}</h2></div><button type="button" className="close-button" onClick={() => setEditor(null)} aria-label="Close place, job, or plan editor">×</button></div>
            <p className="modal-intro">{editorRepresentsCurrentPosition ? "This saved plan represents your current job and home-country household position." : "Describe this possible job, move, or household plan."} Every amount shows this plan’s currency ({editor.currency}) and the home currency that anchors all charts and totals ({plan.baseCurrency}). Edit either amount; the linked amount updates automatically.</p>
            <FormErrorSummary notice={formNotice} issues={formIssues} document={plan} />

            <fieldset className="editor-section">
              <legend>{editorRepresentsCurrentPosition ? "Current job and home-country household position" : "Possible job, move, or household plan"}, currency, and income</legend>
              <div className="form-grid">
                <label className="wide"><span>Place, job, or plan name</span><input required maxLength={160} placeholder="For example: Current household" value={editor.label} onChange={(event) => updateEditor("label", event.target.value)} /></label>
                <label className="wide"><span>Place or location</span><input required maxLength={240} placeholder="City and country" value={editor.location} onChange={(event) => updateEditor("location", event.target.value)} /></label>
                <label className="wide"><span>Who earns income in this plan</span><input required maxLength={500} placeholder="State whose income is included in this monthly plan" value={editor.employment} onChange={(event) => updateEditor("employment", event.target.value)} /></label>
                <label><span>Plan stage</span><input required maxLength={120} placeholder="Current, offer, or planning case" value={editor.status} onChange={(event) => updateEditor("status", event.target.value)} /></label>
                <label><span>Flag country code<small>Use exactly two uppercase letters, for example US.</small></span><input required minLength={2} maxLength={2} pattern="[A-Z]{2}" title="Enter exactly two uppercase letters, for example US" placeholder="US" value={editor.flag} onChange={(event) => updateEditor("flag", event.target.value.toUpperCase())} /></label>
                <label><span>Number of earners counted in this plan<small>Count each person whose income is included in the monthly amounts.</small></span><input required min="0" max="20" step="1" type="number" placeholder="Enter 0, 1, 2…" value={earnersInputDraft ?? ""} onChange={(event) => setEarnersInputDraft(event.target.value)} /></label>
                <label><span>Currency used in this place, job, or plan<small>{optionCurrencyLocked ? "Locked so saved monthly amounts cannot change meaning. Add another place, job, or plan to use another currency." : "Choose before entering monthly income or costs. This local currency is converted to the home currency for all charts and totals."}</small></span><input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" title="Enter a three-letter currency code such as CAD" disabled={optionCurrencyLocked} value={editor.currency} onChange={(event) => { const currency = currencyCode(event.target.value); setEditor({ ...editor, currency, fx: fxAfterCurrencyChange(editor.currency, currency, plan.baseCurrency, editor.fx) }); }} /></label>
                <label><span>Currency conversion ratio<small>{editor.currency === plan.baseCurrency ? "No conversion needed because this is the home currency for all charts and totals." : `1 ${editor.currency || "plan currency"} = how many ${plan.baseCurrency}, the home currency that anchors all charts and totals?`}</small></span><input aria-label="Currency conversion ratio" required min="0.00000001" step="any" type="number" disabled={editor.currency === plan.baseCurrency} value={editor.fx.rateToBase} onChange={(event) => updateEditor("fx", { ...editor.fx, rateToBase: Number(event.target.value) })} /></label>
                {editor.currency === plan.baseCurrency ? (
                  <>
                    <div className="wide conversion-not-needed" role="note"><strong>No conversion needed</strong><span>This place, job, or plan already uses the home currency that anchors all charts and totals. The conversion ratio is fixed at 1 and no conversion source is required.</span></div>
                    <label><span>Optional currency reference date</span><input type="date" value={editor.fx.asOf ?? ""} onChange={(event) => updateEditor("fx", { ...editor.fx, asOf: event.target.value || null })} /></label>
                    <label className="wide"><span>Optional currency note</span><input maxLength={500} placeholder="Optional note about this currency choice" value={editor.fx.source === "Base currency" ? "" : editor.fx.source} onChange={(event) => updateEditor("fx", { ...editor.fx, source: event.target.value })} /></label>
                  </>
                ) : (
                  <>
                    <label><span>Conversion date checked · required</span><input required type="date" value={editor.fx.asOf ?? ""} onChange={(event) => updateEditor("fx", { ...editor.fx, asOf: event.target.value || null })} /></label>
                    <label className="wide"><span>Where this conversion figure came from · required</span><input required maxLength={500} placeholder="Official rate, bank quote, or dated estimate" value={editor.fx.source} onChange={(event) => updateEditor("fx", { ...editor.fx, source: event.target.value })} /></label>
                  </>
                )}
              </div>
              <CurrencyAmountEditor
                key={`gross-${editor.currency}-${plan.baseCurrency}`}
                id="gross-monthly"
                label="Monthly gross income before tax and deductions"
                description="Enter the monthly salary and benefits counted here before tax, other deductions, or payroll saving."
                localAmount={editor.grossMonthly}
                localCurrency={editor.currency}
                baseCurrency={plan.baseCurrency}
                rateToBase={editor.fx.rateToBase}
                entered={enteredScenarioAmounts.has("grossMonthly")}
                onChangeLocal={updateEditorGross}
              />
              <EvidenceEditor evidence={editor.evidence.grossMonthly ?? createUnknownEvidence()} onChange={(evidence) => updateEditorEvidence("grossMonthly", evidence)} title="How reliable is this gross-income number?" />
            </fieldset>

            {(Object.keys(groupMeta) as FieldGroup[]).map((group) => {
              const fields = plan.fieldDefinitions.filter((field) => field.group === group && field.scope === "perOption");
              const sharedFields = plan.fieldDefinitions.filter((field) => field.group === group && field.scope === "shared");
              if (!fields.length && !sharedFields.length) return null;
              const blankFields = fields.filter((field) => !enteredScenarioAmounts.has(field.id));
              const enteredFields = fields.filter((field) => enteredScenarioAmounts.has(field.id));
              const groupTotal = enteredFields.reduce((total, field) => total + (editor.values[field.id] ?? 0), 0);
              const sectionSummary = fields.length
                ? blankFields.length
                  ? `${fields.length} monthly ${fields.length === 1 ? "item" : "items"} · ${enteredFields.length} entered${sharedFields.length ? ` · ${sharedFields.length} entered once for every plan` : ""}`
                  : `${fields.length} monthly ${fields.length === 1 ? "item" : "items"} · ${formatMoney(groupTotal, editor.currency, plan.locale)}${sharedFields.length ? ` · ${sharedFields.length} entered once for every plan` : ""}`
                : `${sharedFields.length} monthly ${sharedFields.length === 1 ? "item" : "items"} entered once for every plan`;
              return (
                <EditorSection
                  key={group}
                  title={groupMeta[group].title}
                  note={groupMeta[group].help}
                  collapsible={fields.length + sharedFields.length >= LONG_EDITOR_SECTION_SIZE}
                  summary={sectionSummary}
                >
                  {fields.length > 0 && <div className="amount-field-list">
                    {fields.map((field) => (
                      <div className="amount-field-row" key={field.id}>
                        <CurrencyAmountEditor
                          key={`${field.id}-${editor.currency}-${plan.baseCurrency}`}
                          id={`option-${field.id}`}
                          label={field.label}
                          description={field.description}
                          localAmount={editor.values[field.id] ?? 0}
                          localCurrency={editor.currency}
                          baseCurrency={plan.baseCurrency}
                          rateToBase={editor.fx.rateToBase}
                          entered={enteredScenarioAmounts.has(field.id)}
                          onChangeLocal={(amount) => updateEditorValue(field.id, amount)}
                        />
                        <EvidenceEditor evidence={editor.evidence[field.id] ?? createUnknownEvidence()} onChange={(evidence) => updateEditorEvidence(field.id, evidence)} />
                      </div>
                    ))}
                  </div>}
                  {blankFields.length > 0 && (
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => markScenarioAmountsAsZero(blankFields.map((field) => field.id))}
                    >
                      Use 0 for {blankFields.length} blank {blankFields.length === 1 ? "item" : "items"} in this section
                    </button>
                  )}
                  {sharedFields.length > 0 && (
                    <div className="shared-preview-list">
                      <strong>Monthly amount entered once for every plan</strong>
                      <small>Stored once in the {plan.baseCurrency} home currency; the {editor.currency} amount below is the linked local equivalent.</small>
                      {sharedFields.map((field) => {
                        const baseAmount = plan.sharedValues[field.id] ?? 0;
                        const localAmount = baseToLocalAmount(baseAmount, editor.currency === plan.baseCurrency ? 1 : editor.fx.rateToBase);
                        return <span key={field.id}><span>{field.label}</span><b>{formatMoney(baseAmount, plan.baseCurrency, plan.locale)}<small>{localAmount === null ? `Enter the ${editor.currency} conversion ratio` : formatMoney(localAmount, editor.currency, plan.locale)}</small></b></span>;
                      })}
                    </div>
                  )}
                </EditorSection>
              );
            })}

            {!editorConversionReady && editor.currency !== plan.baseCurrency && (
              <div className="conversion-required" role="status">Enter a valid three-letter currency, conversion ratio, date checked, and source to see charts and totals in the home currency that anchors all charts and totals. This place, job, or plan cannot be added until they are complete.</div>
            )}
            {!editorAmountsReady && (
              <div className="conversion-required" role="status">Enter monthly gross income before tax and deductions, plus every monthly item, before saving. Enter 0 when an item does not apply, or use the section’s Use 0 action. Charts and totals stay hidden until every amount is confirmed.</div>
            )}
            {editorPreview && editorPreviewSavings && (
              <div className="editor-preview savings-preview" aria-live="polite">
                <div><span>Monthly gross income before tax and deductions</span><strong>{formatMoney(editorPreview.grossMonthly, editor.currency, plan.locale)}</strong><small>{formatMoney(editorPreview.grossBase, plan.baseCurrency, plan.locale)}</small></div>
                <div><span>Take-home cash</span><strong>{formatMoney(editorPreview.netCashMonthly, editor.currency, plan.locale)}</strong><small>{formatMoney(editorPreview.netCashBase, plan.baseCurrency, plan.locale)}</small></div>
                <div className="preview-parent"><span>Total saved or left each month</span><strong>{formatMoney(editorPreviewSavings.local.total, editor.currency, plan.locale)}</strong><small>{formatMoney(editorPreviewSavings.base.total, plan.baseCurrency, plan.locale)}</small><small>Monthly investments {formatMoney(editorPreviewSavings.local.investments, editor.currency, plan.locale)} / {formatMoney(editorPreviewSavings.base.investments, plan.baseCurrency, plan.locale)} + cash left {formatMoney(editorPreviewSavings.local.cash, editor.currency, plan.locale)} / {formatMoney(editorPreviewSavings.base.cash, plan.baseCurrency, plan.locale)}</small></div>
              </div>
            )}

            <details className="editor-details">
              <summary>Card appearance <span>Optional</span></summary>
              <div className="form-grid">
                <label><span>Choose a card colour visually</span><input aria-label="Choose a card colour visually" className="color-input" type="color" value={editor.color} onChange={(event) => updateEditor("color", event.target.value)} /></label>
                <label><span>Exact card colour code<small>Six hexadecimal digits, for example #2F80ED.</small></span><input aria-label="Exact card colour code" maxLength={7} pattern="#[0-9A-Fa-f]{6}" placeholder="#2F80ED" value={editor.color} onChange={(event) => updateEditor("color", event.target.value)} /></label>
              </div>
            </details>

            <details className="editor-details">
              <summary>Important non-financial details <span>Saved in this place, job, or plan and in downloaded files</span></summary>
              <div className="form-grid">
                <label className="wide"><span>Partner income included in this plan</span><input maxLength={1000} placeholder="For example: not included until a job is secured" value={editor.spouseJob} onChange={(event) => updateEditor("spouseJob", event.target.value)} /></label>
                <label className="wide"><span>Childcare arrangement and monthly cost included</span><input maxLength={1000} placeholder="Who provides care and what monthly cost is included?" value={editor.childcare} onChange={(event) => updateEditor("childcare", event.target.value)} /></label>
                <label className="wide"><span>Transport choice and monthly cost included</span><input maxLength={1000} placeholder="Public transport, car, or a mix" value={editor.transport} onChange={(event) => updateEditor("transport", event.target.value)} /></label>
                <label className="wide"><span>Residence or visa condition</span><input maxLength={1000} placeholder="Visa status, timing, or residency condition" value={editor.residency} onChange={(event) => updateEditor("residency", event.target.value)} /></label>
                <label className="wide"><span>Bonus or one-time payment treatment<small>Excluded unless you convert it into a recurring monthly amount above.</small></span><input maxLength={1000} placeholder="State whether and how this is counted" value={editor.bonus} onChange={(event) => updateEditor("bonus", event.target.value)} /></label>
                <label className="wide"><span>Benefits included in this plan · one per line<small>Up to 50 lines; 1,000 characters per line</small></span><textarea rows={3} maxLength={50049} value={editor.benefits.join("\n")} onChange={(event) => updateEditor("benefits", event.target.value.split("\n").filter((line) => line.length > 0))} /></label>
                <label className="wide"><span>Important details still to verify · one per line<small>Up to 50 lines; 1,000 characters per line</small></span><textarea rows={3} maxLength={50049} value={editor.risks.join("\n")} onChange={(event) => updateEditor("risks", event.target.value.split("\n").filter((line) => line.length > 0))} /></label>
              </div>
            </details>

            {deleteScenarioConfirm && (
              <div className="inline-danger" role="alert">
                <div>
                  <strong>{editingCurrentScenario ? "Remove the current job and home-country household position?" : "Remove this place, job, or plan from this browser?"}</strong>
                  <span>{editingCurrentScenario
                    ? currentReplacementScenarios.length
                      ? "Choose which saved plan becomes your current job and home-country household position before removal. This replacement changes the current-position label only; it does not change monthly amounts."
                      : "This is the only saved plan. Removing it leaves no current job and home-country household position."
                    : legacyRepairScenarios.length > 0
                      ? "No reusable backup is available until every older saved plan has a real conversion date and source. Removing now cannot be undone."
                      : "This cannot be undone unless you downloaded a backup."}</span>
                  {editingCurrentScenario && currentReplacementScenarios.length > 0 && (
                    <label className="wide"><span>Current job and home-country position after removal</span><select required value={deleteCurrentReplacementId ?? ""} onChange={(event) => { setDeleteCurrentReplacementId(event.target.value || null); setFormNotice(""); setFormIssues([]); }}><option value="">Choose the replacement current position</option>{currentReplacementScenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label || "Unnamed place, job, or plan"}</option>)}</select></label>
                  )}
                </div>
                <div className="inline-danger-actions">
                  <button type="button" className="button ghost" disabled={legacyRepairScenarios.length > 0} onClick={exportDocument}>{legacyRepairScenarios.length > 0 ? "Reusable backup unavailable" : "Download saved backup"}</button>
                  <button type="button" className="button ghost" onClick={() => { setDeleteScenarioConfirm(false); setDeleteCurrentReplacementId(null); }}>Cancel</button>
                  <button type="button" className="button danger" disabled={editingCurrentScenario && currentReplacementScenarios.length > 0 && !deleteCurrentReplacementId} onClick={deleteScenario}>{legacyRepairScenarios.length > 0 ? "Remove without reusable backup" : "Confirm removal"}</button>
                </div>
              </div>
            )}
            <div className="modal-actions">
              {editingExisting && <button type="button" className="button danger" onClick={() => { setDeleteCurrentReplacementId(null); setDeleteScenarioConfirm(true); }}>Remove this place, job, or plan</button>}
              <span />
              <button type="button" className="button ghost" onClick={() => setEditor(null)}>Cancel</button>
              <button type="submit" className="button primary">{firstScenarioSetup ? "Save your current job and home-country household position" : editingCurrentScenario ? "Save changes to your current job and home-country household position" : editingExisting ? "Save changes to this place, job, or plan" : "Add this possible job, move, or household plan"}</button>
            </div>
          </form>
        </div>
      )}

      {importCandidate && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close import preview" onClick={() => setImportCandidate(null)} />
          <section className="share-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" data-dialog-id="import-preview" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Check before replacing</span><h2 id="import-title">Replace this browser’s complete comparison?</h2></div><button className="close-button" onClick={() => setImportCandidate(null)} aria-label="Close import preview">×</button></div>
            <div className="import-summary"><div><span>Comparison title</span><strong>{importCandidate.document.title}</strong></div><div><span>Home currency for all charts and totals</span><strong>{importCandidate.document.baseCurrency}</strong></div><div><span>Current job and home-country position</span><strong>{importCandidate.document.scenarios.find((scenario) => scenario.id === importCandidate.document.currentScenarioId)?.label || "Not set"}</strong></div><div><span>Places, jobs, and plans</span><strong>{importCandidate.document.scenarios.length}</strong></div><div><span>Research sources</span><strong>{importCandidate.document.researchItems.length}</strong></div></div>
            {importCandidate.migrated && <p className="migration-warning">This older Wayfinder file was updated without changing its stored totals. Its first saved plan was selected as the current job and home-country position; you can change it after importing in Home currency, future estimates, and amounts used in every plan. After importing, use the clearly labelled older saved plans panel to complete any missing currency conversion dates or sources.</p>}
            {importCandidate.document.legacyMigrationNotes.length > 0 && (
              <EditorSection
                title="Notes kept from an older file"
                summary={`${importCandidate.document.legacyMigrationNotes.length} ${importCandidate.document.legacyMigrationNotes.length === 1 ? "note" : "notes"}`}
                note="These notes never affect calculations and are excluded from the family report. They are kept only as read-only context from an earlier file."
                collapsible
              >
                <ul className="legacy-migration-notes">
                  {importCandidate.document.legacyMigrationNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                </ul>
              </EditorSection>
            )}
            <p className="modal-intro">This saved comparison file includes and replaces your home currency, future estimates, amounts used in every plan, current job and home-country position, possible plans, source confidence, and sources. Nothing changes until you confirm; it replaces everything, with no partial merge.</p>
            {legacyRepairScenarios.length > 0 && <p className="modal-intro"><strong>The current comparison cannot produce a reusable backup until every older saved plan has a real conversion date and source.</strong> Replacing it now permanently removes those unrepaired plans from this browser.</p>}
            <div className="modal-actions"><button className="button ghost" disabled={legacyRepairScenarios.length > 0} onClick={exportDocument}>{legacyRepairScenarios.length > 0 ? "Reusable backup unavailable" : "Download current backup first"}</button><span /><button className="button ghost" onClick={() => setImportCandidate(null)}>Cancel</button><button className="button primary" onClick={confirmImport}>{legacyRepairScenarios.length > 0 ? "Replace without reusable backup" : "Replace complete comparison"}</button></div>
          </section>
        </div>
      )}

      {importIssues.length > 0 && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close import errors" onClick={() => setImportIssues([])} />
          <section className="share-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-error-title" data-dialog-id="import-errors" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Import could not continue</span><h2 id="import-error-title">Fix these fields</h2></div><button className="close-button" onClick={() => setImportIssues([])} aria-label="Close import errors">×</button></div>
            <ol className="validation-list">{importIssues.slice(0, 20).map((issue, index) => <li key={`${issue.path}-${index}`}><span>{friendlyValidationIssue(issue, importIssueContext)}</span><small>File field: <code>{issue.path}</code></small></li>)}</ol>
            {importIssues.length > 20 && <p className="modal-intro">{importIssues.length - 20} more issues were omitted. Use the repository validator for the complete list.</p>}
            <div className="modal-actions"><span /><button className="button primary" onClick={() => setImportIssues([])}>Close</button></div>
          </section>
        </div>
      )}

      {clearConfirm && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Cancel clearing browser data" onClick={cancelClearDashboard} />
          <section className="share-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="clear-title" data-dialog-id="clear-browser" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Local data deletion</span><h2 id="clear-title">Clear this browser?</h2></div><button className="close-button" onClick={cancelClearDashboard} aria-label="Cancel clearing browser data">×</button></div>
            <p className="modal-intro">This removes the home currency, future estimates, amounts used in every plan, every place, job, or plan, excluded-support notes, sources, and any local recovery copy from this browser. The public application repository is unaffected.</p>
            {currencyRestartDraft && <p className="modal-intro">Your open home-currency, future-estimate, and every-plan-amount edits are preserved here. Cancel returns to them. Download the draft before clearing if you want a copy.</p>}
            {legacyRepairScenarios.length > 0 && <p className="modal-intro"><strong>No reusable backup can be created yet.</strong> Cancel and complete the older saved plans’ conversion date and source first. Clearing now permanently removes those plans from this browser.</p>}
            <div className="modal-actions"><button className="button ghost" disabled={legacyRepairScenarios.length > 0} onClick={exportClearBackup}>{currencyRestartDraft ? "Download draft backup" : "Download backup first"}</button><span /><button className="button ghost" onClick={cancelClearDashboard}>Cancel</button><button className="button danger" onClick={clearDashboard}>{legacyRepairScenarios.length > 0 ? "Clear without a reusable backup" : "Clear all local data"}</button></div>
          </section>
        </div>
      )}

      {storageConflict && (
        <div className="modal-backdrop">
          <section
            className="share-modal conflict-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storage-conflict-title"
            aria-describedby="storage-conflict-description"
            data-dialog-id="storage-conflict"
            tabIndex={-1}
          >
            <div className="modal-head">
              <div>
                <span className="section-kicker">Another tab changed this dashboard</span>
                <h2 id="storage-conflict-title">Choose which version to keep</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setStorageConflict(null)} aria-label="Close browser data conflict">×</button>
            </div>
            <p className="modal-intro" id="storage-conflict-description">
              {storageConflict.reason === "write"
                ? "The saved browser version changed after this tab loaded, so your save was stopped before anything was overwritten."
                : "A different tab changed the saved browser version. This tab will not reload or overwrite it without your choice."}
            </p>
            <div className="conflict-summary">
              <strong>
                {storageConflict.snapshot.status === "valid"
                  ? `External update from ${new Date(storageConflict.snapshot.document.updatedAt).toLocaleString()}`
                  : storageConflict.snapshot.status === "empty"
                    ? "The external tab cleared browser data"
                    : "The external browser data is unreadable"}
              </strong>
              <span>
                Reloading discards unsaved edits in this tab. Keeping this tab leaves your edits open and requires one more explicit save.
              </span>
            </div>
            <div className="modal-actions">
              <button type="button" className="button ghost" data-initial-focus onClick={reloadExternalStorage}>Reload external version</button>
              <span />
              <button type="button" className="button primary" onClick={keepThisTab}>Keep this tab</button>
            </div>
          </section>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}
