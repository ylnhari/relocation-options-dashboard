"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
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

const STORAGE_LOCK_NAME = "wayfinder-browser-storage-v4";
const STORAGE_LOCK_DB_NAME = "wayfinder-coordination";
const STORAGE_LOCK_DB_VERSION = 1;
const STORAGE_LOCK_STORE = "browser-storage-locks";
const RECOVERY_STORAGE_KEY = "wayfinder.recovery.invalid-browser-draft.v1";

const groupMeta: Record<
  FieldGroup,
  { title: string; short: string; help: string }
> = {
  deduction: {
    title: "Gross-to-net deductions",
    short: "Deductions",
    help: "Tax and other non-saving deductions that reduce take-home cash.",
  },
  automaticInvestment: {
    title: "Automatic payroll investments",
    short: "Automatic investments",
    help: "Retirement, pension, or similar saving taken from gross pay. These remain savings.",
  },
  livingCost: {
    title: "Monthly living costs",
    short: "Living costs",
    help: "Option-specific costs in that option's local currency.",
  },
  commitment: {
    title: "Continuing commitments",
    short: "Commitments",
    help: "Shared obligations are entered once in the comparison currency and applied to every option.",
  },
  plannedInvestment: {
    title: "Planned post-tax investments",
    short: "Planned investments",
    help: "How take-home cash is allocated to investing. These are part of saving, not an expense.",
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
    label: "Gross compensation",
    cumulative: "cumulative gross compensation",
    explanation: "Before deductions, living costs, commitments, or investments.",
  },
  netCashBase: {
    label: "Net cash income",
    cumulative: "cumulative net cash income",
    explanation: "Gross compensation after deductions and automatic payroll investments.",
  },
  totalSavingBase: {
    label: "Total saving",
    cumulative: "cumulative total saving",
    explanation: "Automatic investments plus cash left after living costs and commitments.",
  },
  totalInvestmentBase: {
    label: "Total investments",
    cumulative: "cumulative investments",
    explanation: "Automatic payroll investments plus planned post-tax investments.",
  },
  cashRemainingBase: {
    label: "Cash remaining",
    cumulative: "cumulative cash remaining",
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
        message: "The saved Wayfinder document exceeds the 2 MiB limit.",
      };
    }
    const result = validateWayfinderInput(JSON.parse(value));
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
        message: "The unreadable browser draft is too large to save a recovery copy. The starter document was not applied.",
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
        message: "The unreadable browser draft is too large to save a recovery copy. The starter document was not applied.",
      };
    }
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, serialized);
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      message: "A recovery copy of the unreadable browser draft could not be saved. The starter document was not applied.",
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

function numberFormatter(locale: string, compact = false) {
  try {
    return new Intl.NumberFormat(locale || "en-US", {
      maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? "compact" : "standard",
    });
  } catch {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? "compact" : "standard",
    });
  }
}

function formatMoney(
  value: number,
  currency: string,
  locale: string,
  compact = false,
) {
  const sign = value < 0 ? "−" : "";
  return `${sign}${currency} ${numberFormatter(locale, compact).format(Math.abs(value))}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function flagGlyph(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return code.slice(0, 3).toUpperCase();
  return String.fromCodePoint(
    ...[...code].map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

function fieldValue(document: WayfinderDocument, scenario: Scenario, field: FieldDefinition) {
  return field.scope === "shared"
    ? document.sharedValues[field.id] ?? 0
    : scenario.values[field.id] ?? 0;
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
  title = "Accuracy and source",
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
          <span>Status</span>
          <select
            value={evidence.status}
            onChange={(event) =>
              onChange({
                ...evidence,
                status: event.target.value as EvidenceStatus,
              })
            }
          >
            <option value="unknown">Needs source</option>
            <option value="estimate">Estimate</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        <label>
          <span>As of{sourceRequired ? " · required" : ""}</span>
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
          <span>Source{sourceRequired ? " · required" : ""}</span>
          <input
            required={sourceRequired}
            value={evidence.source}
            placeholder="Payslip, offer letter, official calculator, quote…"
            onChange={(event) =>
              onChange({ ...evidence, source: event.target.value })
            }
          />
        </label>
        <label className="wide">
          <span>Note</span>
          <input
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
}: {
  title: string;
  items: BreakdownItem[];
  scenario: Scenario;
  document: WayfinderDocument;
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
                {item.scope === "shared" && <small>Shared across all options</small>}
              </span>
              <span>
                <strong>
                  {formatMoney(
                    item.scope === "shared" ? item.baseAmount : item.localAmount,
                    item.scope === "shared" ? document.baseCurrency : scenario.currency,
                    document.locale,
                  )}
                </strong>
                {evidence && <EvidenceBadge evidence={evidence} />}
              </span>
            </div>
          );
        })
      ) : (
        <p className="empty-breakdown">No fields are configured for this category.</p>
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
  const [deleteScenarioConfirm, setDeleteScenarioConfirm] = useState(false);
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<string | null>(null);
  const [importCandidate, setImportCandidate] = useState<{
    document: WayfinderDocument;
    migrated: boolean;
  } | null>(null);
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState<StorageNotice | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [storageConflict, setStorageConflict] = useState<StorageConflict | null>(null);
  const [formNotice, setFormNotice] = useState("");
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
      if (activeDialogId === "clear-browser") setClearConfirm(false);
      if (activeDialogId === "scenario-editor") {
        setEditor(null);
        setDeleteScenarioConfirm(false);
      }
      if (activeDialogId === "comparison-model") {
        setModelDraft(null);
        setDeleteFieldConfirm(null);
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
  }, [activeDialogId]);

  useEffect(() => {
    if (activeDialogId || !dialogCycleRef.current) return;
    dialogCycleRef.current = false;
    const opener = dialogOpenerRef.current;
    dialogOpenerRef.current = null;
    const frame = window.requestAnimationFrame(() => opener?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeDialogId]);

  const derived = useMemo(
    () => plan.scenarios.map((scenario) => deriveScenario(plan, scenario)),
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
  const editorPreview = editor ? deriveScenario(plan, editor) : null;
  const editingExisting = Boolean(
    editor && plan.scenarios.some((scenario) => scenario.id === editor.id),
  );
  const firstScenarioSetup = Boolean(editor && plan.scenarios.length === 0);

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
        const result = validateWayfinderInput(synced);
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
              message: "This Wayfinder document exceeds the 2 MiB browser limit. Your previous dashboard is still unchanged.",
            });
            notify("Could not save. The document is larger than 2 MiB.");
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
      setToast("Older browser data was preserved and migrated. Review the migration notes.");
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
            message: "The running instance supplied an invalid starter document. Browser data was not changed.",
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
              message: "The running instance supplied a starter document larger than the 2 MiB browser limit. Browser data was not changed.",
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
            message: "Browser storage rejected the starter document. Browser data was not changed.",
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
        message: "The browser could not safely save the starter document. Browser data was not changed.",
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
            message: "A raw copy of an earlier unreadable browser draft is available. It may contain sensitive figures and cannot be imported as a complete comparison.",
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
                ? "The starter document replaced an unreadable browser draft after saving a raw copy. That copy may contain sensitive figures and cannot be imported as a complete comparison."
                : "This running instance supplied the starter document. Later edits stay in this browser.",
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
        setStorageNotice({ tone: "error", message: "The running instance supplied an invalid starter document. Browser data was not changed." });
      }
      setStorageReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  // The seed is injected per running instance. This bootstrap must run once;
  // later edits use the normal guarded save path.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openManualSetup = () => setModelDraft(cloneDocument(plan));

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
    const savedEditor = editor;
    const next: WayfinderDocument = {
      ...plan,
      scenarios: editingExisting
        ? plan.scenarios.map((scenario) =>
            scenario.id === savedEditor.id ? savedEditor : scenario,
          )
        : [...plan.scenarios, savedEditor],
    };
    if (!await commitPlan(next, firstScenarioSetup ? "Current situation saved in this browser" : "Option saved in this browser")) {
      return;
    }
    setActiveIds((current) =>
      current.includes(savedEditor.id) ? current : [...current, savedEditor.id],
    );
    setEditor(null);
    setDeleteScenarioConfirm(false);
  };

  const openScenarioEditor = (id: string) => {
    const scenario = plan.scenarios.find((candidate) => candidate.id === id);
    if (!scenario) return;
    setEditor(cloneDocument({ ...plan, scenarios: [scenario] }).scenarios[0]);
    setDeleteScenarioConfirm(false);
  };

  const duplicateScenario = (id: string) => {
    const scenario = plan.scenarios.find((candidate) => candidate.id === id);
    if (!scenario) return;
    setEditor({
      ...cloneDocument({ ...plan, scenarios: [scenario] }).scenarios[0],
      id: createScenarioId(),
      label: `${scenario.label} · copy`,
      status: "Draft comparison",
    });
  };

  const deleteScenario = async () => {
    if (!editor) return;
    const deletedEditor = editor;
    const next = {
      ...plan,
      scenarios: plan.scenarios.filter((scenario) => scenario.id !== deletedEditor.id),
      researchItems: plan.researchItems.map((item) => ({
        ...item,
        appliesToScenarioIds: item.appliesToScenarioIds.filter(
          (id) => id !== deletedEditor.id,
        ),
      })),
    };
    if (!await commitPlan(next, "Option removed from this browser")) return;
    setActiveIds((current) => current.filter((id) => id !== deletedEditor.id));
    setEditor(null);
    setDeleteScenarioConfirm(false);
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
    const exported = withFreshTimestamp(plan);
    downloadText(
      `wayfinder-document-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(exported, null, 2),
      "application/json",
    );
    setShareOpen(false);
    notify("Editable Wayfinder document downloaded");
  };

  const downloadAgentTemplate = () => {
    const template = createWayfinderDocument(plan.baseCurrency);
    template.title = "Replace with a clear comparison title";
    downloadText(
      "wayfinder-comparison-template.v4.json",
      JSON.stringify(template, null, 2),
      "application/json",
    );
    setShareOpen(false);
    notify("Agent-ready template downloaded");
  };

  const downloadFamilyView = () => {
    if (!plan.scenarios.length) return;
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
      setImportIssues([{
        path: "$",
        message: "The selected file is larger than the 2 MiB import limit.",
      }]);
      setImportCandidate(null);
      setShareOpen(false);
      return;
    }
    try {
      const result = validateWayfinderInput(JSON.parse(await file.text()));
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
      setShareOpen(false);
    } catch {
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
      "Validated document replaced this browser dashboard",
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

  const updateEditorValue = (fieldId: string, amount: number) => {
    setEditor((current) =>
      current
        ? { ...current, values: { ...current.values, [fieldId]: amount } }
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

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    if (!modelDraft) return;
    const savedModel = syncDocumentFields(modelDraft);
    if (!await commitPlan(savedModel, "Shared settings applied to every option")) return;
    setModelDraft(null);
    setDeleteFieldConfirm(null);
    if (!plan.scenarios.length) {
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

  const addModelField = (group: FieldGroup, scope: FieldScope) => {
    setModelDraft((current) => {
      if (!current) return current;
      const id = createStableId(group.toLowerCase());
      return syncDocumentFields({
        ...current,
        fieldDefinitions: [
          ...current.fieldDefinitions,
          {
            id,
            label: `New ${groupMeta[group].short.toLowerCase()} field`,
            description: "Describe what this monthly amount represents.",
            group,
            scope,
          },
        ],
      });
    });
  };

  const removeModelField = (id: string) => {
    if (!modelDraft) return;
    const populated =
      (modelDraft.sharedValues[id] ?? 0) !== 0 ||
      hasMeaningfulEvidence(modelDraft.sharedEvidence[id]) ||
      modelDraft.scenarios.some(
        (scenario) =>
          (scenario.values[id] ?? 0) !== 0 ||
          hasMeaningfulEvidence(scenario.evidence[id]),
      );
    if (populated && deleteFieldConfirm !== id) {
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
          <span><strong>Wayfinder</strong><small>Relocation decision studio</small></span>
        </a>
        <div className="topbar-actions">
          {plan.scenarios.length > 0 && (
            <div className="segmented" aria-label="Display currency">
              <button type="button" aria-pressed={mode === "base"} className={mode === "base" ? "active" : ""} onClick={() => setMode("base")}>{plan.baseCurrency} view</button>
              <button type="button" aria-pressed={mode === "local"} className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}>Local view</button>
            </div>
          )}
          <button className="button ghost" onClick={() => setModelDraft(cloneDocument(plan))}>Shared settings</button>
          {plan.scenarios.length > 0 && <button className="button ghost share-button" onClick={() => setShareOpen(true)}>Share</button>}
          <button
            className="button primary"
            onClick={() =>
              plan.scenarios.length
                ? setEditor(createBlankScenario(plan))
                : openManualSetup()
            }
          >
            <span aria-hidden="true">＋</span> {plan.scenarios.length ? "Add option" : "Enter my details"}
          </button>
        </div>
      </header>

      {(storageNotice || recoveryAvailable) && (
        <div
          className={`storage-notice ${storageNotice?.tone ?? "warning"}`}
          role={storageNotice?.tone === "error" ? "alert" : "status"}
        >
          <strong>{storageNotice?.tone === "error" ? "Browser save needs attention" : storageNotice?.tone === "seed" ? "Starter document loaded" : recoveryAvailable ? "Unreadable browser data saved" : "Browser data recovered"}</strong>
          <span>{storageNotice?.message ?? "A raw copy of an earlier unreadable browser draft is available. It may contain sensitive figures and cannot be imported as a complete comparison."}</span>
          {recoveryAvailable && (
            <button type="button" className="storage-notice-action" onClick={downloadRecoveryCopy}>
              Download unreadable-data copy
            </button>
          )}
        </div>
      )}

      {plan.scenarios.length === 0 ? (
        <section className="welcome" id="top">
          <div className="welcome-copy">
            <div className="eyebrow"><span className="pulse-dot" /> Open source · private on your device</div>
            <h1>Enter your numbers. Compare <em>every move.</em></h1>
            <p>Enter details manually or import one JSON file containing shared settings, your current situation, all alternatives, assumptions, and sources.</p>
            <div className="welcome-actions">
              <button className="button primary large" onClick={openManualSetup}>Enter my details</button>
              <button className="button ghost large" onClick={() => fileInputRef.current?.click()}>Import complete comparison</button>
              <button className="button ghost large" onClick={downloadAgentTemplate}>Download blank comparison template</button>
            </div>
            <p className="privacy-note">No sign-in, cloud database, or telemetry. Your figures stay in this browser unless you deliberately download a file.</p>
          </div>
          <div className="welcome-steps" aria-label="How Wayfinder works">
            <article><b>01</b><div><strong>Shared settings</strong><span>Choose comparison currency, growth assumptions, and common costs/investments once.</span></div></article>
            <article><b>02</b><div><strong>Add your options</strong><span>Enter the current situation and each country, city, or job offer.</span></div></article>
            <article><b>03</b><div><strong>Review the comparison</strong><span>See salary, deductions, costs, investments, cash left, assumptions, and sources.</span></div></article>
          </div>
        </section>
      ) : (
        <>
          <section className="hero" id="top">
            <div className="hero-copy">
              <div className="eyebrow"><span className="pulse-dot" /> Local-first · {plan.baseCurrency} comparison</div>
              <h1>See whether the next move <em>actually compounds.</em></h1>
              <p>Every option uses the same field definitions, shared commitments, shared investment plan, and auditable gross-to-cash formula.</p>
              <div className="model-chips">
                <span>{plan.fieldDefinitions.length} common fields</span>
                <span>{formatMoney(sharedCommitmentTotal, plan.baseCurrency, plan.locale)} shared commitments</span>
                <span>{formatMoney(sharedInvestmentTotal, plan.baseCurrency, plan.locale)} shared planned investments</span>
              </div>
            </div>
            <button className="model-summary-card" onClick={() => setModelDraft(cloneDocument(plan))}>
              <span>Controlled from one place</span>
              <strong>Shared settings</strong>
              <small>Edit fields, shared values, excluded support, projection assumptions, and sources.</small>
              <b>Open settings →</b>
            </button>
          </section>

          {visible.length === 0 && (
            <section className="empty-selection panel">
              <h2>No active options</h2>
              <p>Select at least one option below to populate comparisons and projections.</p>
            </section>
          )}

          {visible.length > 0 && (
            <section className="kpi-grid" aria-label="Financial highlights">
              <article className="kpi-card glow-blue">
                <span className="kpi-label">Highest monthly total saving</span>
                <strong>{formatMoney(bestSaving?.totalSavingBase ?? 0, plan.baseCurrency, plan.locale, true)}</strong>
                <p>{bestSaving?.label}</p>
                <i style={{ width: `${Math.max(8, (bestSaving?.totalSavingBase ?? 0) / maxSaving * 100)}%` }} />
              </article>
              <article className="kpi-card glow-coral">
                <span className="kpi-label">Strongest one-income option</span>
                <strong>{bestOneIncome ? formatMoney(bestOneIncome.totalSavingBase, plan.baseCurrency, plan.locale, true) : "—"}</strong>
                <p>{bestOneIncome?.label ?? "No one-income option active"}</p>
                <i style={{ width: `${Math.max(8, (bestOneIncome?.totalSavingBase ?? 0) / maxSaving * 100)}%` }} />
              </article>
              <article className="kpi-card glow-gold">
                <span className="kpi-label">Highest cash remaining</span>
                <strong>{formatMoney(bestCash?.cashRemainingBase ?? 0, plan.baseCurrency, plan.locale, true)}</strong>
                <p>{bestCash?.label}</p>
                <i style={{ width: `${Math.max(8, (bestCash?.cashRemainingBase ?? 0) / maxCash * 100)}%` }} />
              </article>
            </section>
          )}

          <section className="section-block scenarios-section">
            <div className="section-heading">
              <div><span className="section-kicker">01 · Option tiles</span><h2>Gross to saving, fully explained</h2></div>
              <p>Expand any tile to see every deduction, living cost, shared commitment, investment, source, and FX assumption.</p>
            </div>
            <div className="scenario-selector" aria-label="Options included in comparisons">
              {derived.map((scenario) => (
                <label key={scenario.id}>
                  <input type="checkbox" checked={activeIds.includes(scenario.id)} onChange={() => toggleActive(scenario.id)} />
                  <span>{flagGlyph(scenario.flag)} {scenario.label}</span>
                </label>
              ))}
            </div>
            <div className="scenario-grid">
              {derived.map((scenario) => (
                <article className={`scenario-card ${activeIds.includes(scenario.id) ? "active" : "inactive"}`} key={scenario.id} style={{ "--accent": scenario.color } as CSSProperties}>
                  <div className="scenario-topline">
                    <span className="flag-badge">{flagGlyph(scenario.flag)}</span>
                    <span className="status-pill">{scenario.status}</span>
                    <button type="button" aria-pressed={activeIds.includes(scenario.id)} className={`scenario-toggle ${activeIds.includes(scenario.id) ? "on" : ""}`} onClick={() => toggleActive(scenario.id)} aria-label={`${activeIds.includes(scenario.id) ? "Exclude" : "Include"} ${scenario.label} in comparisons`}><i /></button>
                  </div>
                  <h3>{scenario.label}</h3>
                  <p className="scenario-location">{scenario.location}</p>
                  <p className="scenario-employment">{scenario.employment}</p>

                  <div className="gross-banner">
                    <span>Monthly gross compensation</span>
                    <MoneyValue local={scenario.grossMonthly} base={scenario.grossBase} scenario={scenario} document={plan} mode={mode} />
                    <EvidenceBadge evidence={scenario.evidence.grossMonthly ?? createUnknownEvidence()} />
                  </div>

                  <dl className="tile-calculation">
                    <div><dt>Non-saving deductions</dt><dd><MoneyValue local={scenario.deductionMonthly} base={scenario.deductionBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                    <div><dt>Net cash income</dt><dd><MoneyValue local={scenario.netCashMonthly} base={scenario.netCashBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                    <div><dt>Living costs</dt><dd><MoneyValue local={scenario.livingMonthly} base={scenario.livingBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                    <div><dt>Continuing commitments</dt><dd><MoneyValue local={scenario.commitmentBase / scenario.fx.rateToBase} base={scenario.commitmentBase} scenario={scenario} document={plan} mode={mode} /></dd></div>
                  </dl>

                  <div className="saving-parent">
                    <div className="saving-parent-head">
                      <span>Total monthly saving<small>Automatic investments + cash after costs</small></span>
                      <MoneyValue local={scenario.totalSavingMonthly} base={scenario.totalSavingBase} scenario={scenario} document={plan} mode={mode} />
                    </div>
                    <div className="saving-children">
                      <div><span>↳ Total investments</span><MoneyValue local={scenario.totalInvestmentBase / scenario.fx.rateToBase} base={scenario.totalInvestmentBase} scenario={scenario} document={plan} mode={mode} /></div>
                      <div><span>↳ Cash remaining</span><MoneyValue local={scenario.cashRemainingMonthly} base={scenario.cashRemainingBase} scenario={scenario} document={plan} mode={mode} /></div>
                    </div>
                    <div className="saving-identity">Investments + cash remaining = total saving</div>
                  </div>

                  <div className="scenario-rate"><span>{formatPercent(scenario.savingRate)} of gross saved</span><span>1 {scenario.currency} = {scenario.fx.rateToBase} {plan.baseCurrency}</span></div>

                  <details className="tile-breakdown">
                    <summary>Expand full calculation and sources</summary>
                    <BreakdownGroup title="Gross-to-net deductions" items={scenario.breakdown.deduction} scenario={scenario} document={plan} />
                    <BreakdownGroup title="Automatic investments · part of saving" items={scenario.breakdown.automaticInvestment} scenario={scenario} document={plan} />
                    <BreakdownGroup title="Monthly living costs" items={scenario.breakdown.livingCost} scenario={scenario} document={plan} />
                    <BreakdownGroup title="Continuing commitments" items={scenario.breakdown.commitment} scenario={scenario} document={plan} />
                    <BreakdownGroup title="Planned post-tax investments · part of saving" items={scenario.breakdown.plannedInvestment} scenario={scenario} document={plan} />
                    <section className="breakdown-group fx-breakdown">
                      <h4>Exchange-rate assumption</h4>
                      <p>1 {scenario.currency} = <strong>{scenario.fx.rateToBase} {plan.baseCurrency}</strong></p>
                      <p>{scenario.fx.source || "No source recorded"}{scenario.fx.asOf ? ` · as of ${scenario.fx.asOf}` : " · date not recorded"}</p>
                    </section>
                  </details>

                  <div className="scenario-actions">
                    <button type="button" onClick={() => openScenarioEditor(scenario.id)}>Edit option</button>
                    <button type="button" onClick={() => duplicateScenario(scenario.id)}>Duplicate</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {visible.length > 0 && (
            <>
              <section className="section-block comparison-section">
                <div className="section-heading">
                  <div><span className="section-kicker">02 · Monthly comparison</span><h2>Total saving and its two parts</h2></div>
                  <p>Total saving is the parent. It is always split into total investments and cash remaining—never three unrelated totals.</p>
                </div>
                <div className="comparison-layout">
                  <div className="bar-panel panel">
                    <div className="panel-title"><span>Total monthly saving in {plan.baseCurrency}</span><small>automatic investments + post-cost cash</small></div>
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
                    <div className="panel-title"><span>How total saving is split</span><small>investments + cash remaining</small></div>
                    <div className="saving-split-list">
                      {[...visible].sort((a, b) => b.totalSavingBase - a.totalSavingBase).map((scenario) => {
                        const denominator = Math.max(1, scenario.totalSavingBase);
                        const investmentPct = Math.max(0, Math.min(100, scenario.totalInvestmentBase / denominator * 100));
                        const hasDeficit = scenario.totalSavingBase < 0 || scenario.cashRemainingBase < 0;
                        return (
                          <div className="saving-split-row" key={scenario.id}>
                            <div><strong>{scenario.label}</strong><span>{formatMoney(scenario.totalSavingBase, plan.baseCurrency, plan.locale)} total</span></div>
                            {hasDeficit ? (
                              <div className="split-deficit">Deficit shown explicitly: investments + negative cash = total saving</div>
                            ) : (
                              <div className="split-rail"><i style={{ width: `${investmentPct}%`, background: scenario.color }} /><b /></div>
                            )}
                            <small><span>Investment {formatMoney(scenario.totalInvestmentBase, plan.baseCurrency, plan.locale)}</span><span>Cash {formatMoney(scenario.cashRemainingBase, plan.baseCurrency, plan.locale)}</span></small>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="section-block projection-section">
                <div className="section-heading projection-heading">
                  <div><span className="section-kicker">03 · {plan.projectionAssumptions.years}-year estimate</span><h2>Choose exactly what the chart measures</h2></div>
                  <button className="button ghost" onClick={() => setModelDraft(cloneDocument(plan))}>Edit growth and inflation</button>
                </div>
                <div className="projection-metric-picker" aria-label="Projected financial metric">
                  {(Object.keys(projectionMeta) as ProjectionMetric[]).map((metric) => (
                    <button type="button" aria-pressed={projectionMetric === metric} key={metric} className={projectionMetric === metric ? "active" : ""} onClick={() => setProjectionMetric(metric)}>{projectionMeta[metric].label}</button>
                  ))}
                </div>
                <div className="chart-legend">
                  <i /><span><strong>Monthly {projectionMeta[projectionMetric].label.toLowerCase()}</strong> in {plan.baseCurrency}. {projectionMeta[projectionMetric].explanation}</span>
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
                <p className="projection-note">Legend: each bar is monthly {projectionMeta[projectionMetric].label.toLowerCase()}; each headline is the sum of twelve months for every displayed year. Income grows {plan.projectionAssumptions.incomeGrowthPct}% yearly, living costs and commitments inflate {plan.projectionAssumptions.expenseInflationPct}% yearly, and planned post-tax investment targets stay constant. Tax rules, FX changes, investment returns, bonuses, and job changes are not forecast.</p>
              </section>

              <section className="section-block matrix-section">
                <div className="section-heading">
                  <div><span className="section-kicker">04 · Qualitative assumptions</span><h2>Context the numbers cannot decide</h2></div>
                  <p>Career, visa, childcare, transport, and family considerations remain visible text—not arbitrary scores.</p>
                </div>
                <div className="matrix-wrap panel">
                  <table className="decision-matrix">
                    <thead><tr><th>What is assumed</th>{visible.map((scenario) => <th key={scenario.id}><span>{flagGlyph(scenario.flag)}</span>{scenario.label}</th>)}</tr></thead>
                    <tbody>
                      {[
                        ["Employment income", "Income included in the option", (s: DerivedScenario) => s.employment],
                        ["Household earners", "People whose income is included", (s: DerivedScenario) => `${s.earners} ${s.earners === 1 ? "earner" : "earners"}`],
                        ["Spouse income", "Whether spouse income is included", (s: DerivedScenario) => s.spouseJob],
                        ["Childcare", "Care arrangement behind costs", (s: DerivedScenario) => s.childcare],
                        ["Transport", "Transport assumption behind costs", (s: DerivedScenario) => s.transport],
                        ["Residence / visa", "Current legal-status assumption", (s: DerivedScenario) => s.residency],
                        ["Bonus", "Treatment in recurring totals", (s: DerivedScenario) => s.bonus],
                        ["Benefits and terms", "Confirmed or included terms", (s: DerivedScenario) => s.benefits.join("; ") || "None listed"],
                        ["Important uncertainties", "Items still to verify", (s: DerivedScenario) => s.risks.join("; ") || "None listed"],
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
                  <div><span className="section-kicker">05 · Source-backed research</span><h2>Official links and dated findings behind the assumptions</h2></div>
                  <p>Agents and users can attach tax, visa, housing, childcare, transport, healthcare, weather, career, and family-travel research without turning qualitative findings into fake scores.</p>
                </div>
                {plan.researchItems.length ? (
                  <div className="research-grid">
                    {plan.researchItems.map((item) => {
                      const applicable = item.appliesToScenarioIds.length
                        ? plan.scenarios.filter((scenario) => item.appliesToScenarioIds.includes(scenario.id)).map((scenario) => scenario.label).join(", ")
                        : "All options";
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
                  <div className="panel empty-research"><p>No research records yet. Add them in Shared settings or import a complete comparison file.</p><button className="button ghost" onClick={() => setModelDraft(cloneDocument(plan))}>Add research records</button></div>
                )}
              </section>

              <section className="section-block ledger-section">
                <div className="section-heading">
                  <div><span className="section-kicker">06 · Full calculation</span><h2>One auditable formula for every option</h2></div>
                  <p>Gross − non-saving deductions − automatic investments = net cash. Total saving = automatic investments + net cash − living costs − commitments.</p>
                </div>
                <div className="matrix-wrap panel">
                  <table className="ledger-table">
                    <thead><tr><th>Monthly measure</th>{visible.map((scenario) => <th key={scenario.id}>{scenario.label}</th>)}</tr></thead>
                    <tbody>
                      {[
                        ["Gross compensation", (s: DerivedScenario) => [s.grossMonthly, s.grossBase]],
                        ["Non-saving deductions", (s: DerivedScenario) => [s.deductionMonthly, s.deductionBase]],
                        ["Automatic investments", (s: DerivedScenario) => [s.automaticInvestmentMonthly, s.automaticInvestmentBase]],
                        ["Net cash income", (s: DerivedScenario) => [s.netCashMonthly, s.netCashBase]],
                        ["Living costs", (s: DerivedScenario) => [s.livingMonthly, s.livingBase]],
                        ["Continuing commitments", (s: DerivedScenario) => [s.commitmentBase / s.fx.rateToBase, s.commitmentBase]],
                        ["Total saving", (s: DerivedScenario) => [s.totalSavingMonthly, s.totalSavingBase]],
                        ["↳ Total investments", (s: DerivedScenario) => [s.totalInvestmentBase / s.fx.rateToBase, s.totalInvestmentBase]],
                        ["↳ Cash remaining", (s: DerivedScenario) => [s.cashRemainingMonthly, s.cashRemainingBase]],
                      ].map(([label, getter]) => (
                        <tr key={label as string} className={label === "Total saving" ? "total-row" : String(label).startsWith("↳") ? "child-row" : ""}>
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
                    <p><strong>Commitments:</strong> shared values are entered once in {plan.baseCurrency} and applied equally.</p>
                    <p><strong>Investments:</strong> part of total saving; total saving always equals investments plus cash remaining.</p>
                    <p><strong>Accuracy:</strong> every input can be marked confirmed, estimated, or needing a source.</p>
                  </div>
                </div>
              </section>
            </>
          )}
        </>
      )}

      <footer className="footer">
        <div><strong>Wayfinder</strong><span>Open-source, local-first relocation comparison</span></div>
        <div className="footer-actions">
          <button onClick={() => setModelDraft(cloneDocument(plan))}>Shared settings</button>
          {plan.scenarios.length > 0 && <button onClick={() => setShareOpen(true)}>Share / backup</button>}
          <button onClick={() => fileInputRef.current?.click()}>Import complete comparison</button>
          {(plan.scenarios.length > 0 || plan.excludedSupport.length > 0 || recoveryAvailable) && <button onClick={() => setClearConfirm(true)}>Clear this browser</button>}
        </div>
        <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Select complete comparison JSON file" onChange={importDocument} />
      </footer>

      {shareOpen && plan.scenarios.length > 0 && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close sharing options" onClick={() => setShareOpen(false)} />
          <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" data-dialog-id="share" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Share or back up</span><h2 id="share-title">Choose what to download</h2></div><button type="button" className="close-button" onClick={() => setShareOpen(false)} aria-label="Close sharing options">×</button></div>
            <p className="modal-intro">Financial exports are sensitive. GitHub contains only the empty application and fictional examples—never your browser data.</p>
            <div className="share-choices three-up">
              <article><span className="share-icon" aria-hidden="true">↗</span><div><h3>Family view</h3><p>A read-only HTML report with full calculations and assumptions. It works offline in a modern browser.</p></div><button className="button primary" onClick={downloadFamilyView}>Download family view</button></article>
              <article><span className="share-icon" aria-hidden="true">⇄</span><div><h3>Editable comparison file</h3><p>The complete comparison file: shared settings, every option, assumptions, evidence, and sources.</p></div><button className="button ghost" onClick={exportDocument}>Download editable comparison file</button></article>
              <article><span className="share-icon" aria-hidden="true">◎</span><div><h3>Blank comparison template</h3><p>An empty JSON comparison template with every standard field, ready to fill in and preview before import.</p></div><button className="button ghost" onClick={downloadAgentTemplate}>Download blank comparison template</button></article>
            </div>
            <div className="share-network-note"><strong>Import safety</strong><p>Wayfinder validates the entire file and shows a preview before replacement. No import silently overwrites the current dashboard.</p></div>
          </section>
        </div>
      )}

      {modelDraft && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close shared settings" onClick={() => setModelDraft(null)} />
          <form className="scenario-modal model-modal" role="dialog" aria-modal="true" aria-labelledby="model-title" data-dialog-id="comparison-model" tabIndex={-1} onSubmit={saveModel} onInvalidCapture={revealFirstInvalidControl} onChangeCapture={() => setFormNotice("")}>
            <div className="modal-head"><div><span className="section-kicker">Used by every option</span><h2 id="model-title">Shared settings</h2></div><button type="button" className="close-button" onClick={() => setModelDraft(null)} aria-label="Close shared settings">×</button></div>
            <p className="modal-intro">Enter these settings once. Fields marked for each option are filled separately for every option, while shared amounts are entered once in the comparison currency.</p>
            {formNotice && <p className="form-error-summary" role="alert">{formNotice}</p>}

            <fieldset className="editor-section">
              <legend>Comparison and forecast settings</legend>
              <div className="form-grid">
                <label className="wide"><span>Comparison title</span><input required value={modelDraft.title} onChange={(event) => setModelDraft({ ...modelDraft, title: event.target.value })} /></label>
                <label><span>Base currency<small>Three-letter code used for comparisons</small></span><input required maxLength={3} disabled={modelDraft.scenarios.length > 0} value={modelDraft.baseCurrency} onChange={(event) => setModelDraft({ ...modelDraft, baseCurrency: currencyCode(event.target.value) })} /></label>
                <label><span>Number format<small>For example en-US or en-GB</small></span><input required value={modelDraft.locale} onChange={(event) => setModelDraft({ ...modelDraft, locale: event.target.value })} /></label>
                <label><span>Annual income growth %</span><input required min="-25" max="100" step="0.1" type="number" value={modelDraft.projectionAssumptions.incomeGrowthPct} onChange={(event) => setModelDraft({ ...modelDraft, projectionAssumptions: { ...modelDraft.projectionAssumptions, incomeGrowthPct: Number(event.target.value) } })} /></label>
                <label><span>Annual expense inflation %</span><input required min="-25" max="100" step="0.1" type="number" value={modelDraft.projectionAssumptions.expenseInflationPct} onChange={(event) => setModelDraft({ ...modelDraft, projectionAssumptions: { ...modelDraft.projectionAssumptions, expenseInflationPct: Number(event.target.value) } })} /></label>
                <label><span>Projection years</span><input required min="1" max="20" step="1" type="number" value={modelDraft.projectionAssumptions.years} onChange={(event) => setModelDraft({ ...modelDraft, projectionAssumptions: { ...modelDraft.projectionAssumptions, years: Number(event.target.value) } })} /></label>
              </div>
              {modelDraft.scenarios.length > 0 && <p className="field-note">Base currency is locked after options exist because changing it would invalidate every FX rate. Export, clear, or import a converted document to change it safely.</p>}
            </fieldset>

            {(Object.keys(groupMeta) as FieldGroup[]).map((group) => {
              const fields = modelDraft.fieldDefinitions.filter((field) => field.group === group);
              const allowShared = group === "commitment" || group === "plannedInvestment";
              return (
                <fieldset className="editor-section model-fieldset" key={group}>
                  <legend>{groupMeta[group].title}</legend>
                  <p className="field-note">{groupMeta[group].help}</p>
                  <div className="model-field-list">
                    {fields.map((field) => (
                      <div className="model-field-row" key={field.id}>
                        <div className="field-copy">
                          <input aria-label={`${groupMeta[group].short} field label`} required value={field.label} onChange={(event) => updateModelField(field.id, { label: event.target.value })} />
                          <input aria-label={`${field.label} description`} value={field.description} onChange={(event) => updateModelField(field.id, { description: event.target.value })} />
                        </div>
                        <span className={`scope-badge ${field.scope}`}>{field.scope === "shared" ? `Shared · ${modelDraft.baseCurrency}` : "Value per option"}</span>
                        {field.scope === "shared" && (
                          <div className="shared-amount">
                            <label><span>Monthly amount</span><input min="0" step="0.01" type="number" value={modelDraft.sharedValues[field.id] ?? 0} onChange={(event) => setModelDraft({ ...modelDraft, sharedValues: { ...modelDraft.sharedValues, [field.id]: Number(event.target.value) } })} /></label>
                            <EvidenceEditor evidence={modelDraft.sharedEvidence[field.id] ?? createUnknownEvidence()} onChange={(evidence) => setModelDraft({ ...modelDraft, sharedEvidence: { ...modelDraft.sharedEvidence, [field.id]: evidence } })} />
                          </div>
                        )}
                        <button type="button" className="remove-field" onClick={() => removeModelField(field.id)}>{deleteFieldConfirm === field.id ? "Remove populated field" : "Remove"}</button>
                      </div>
                    ))}
                  </div>
                  <div className="add-field-actions">
                    <button type="button" className="button ghost" onClick={() => addModelField(group, "perOption")}>＋ Add field for each option</button>
                    {allowShared && <button type="button" className="button ghost" onClick={() => addModelField(group, "shared")}>＋ Add shared field</button>}
                  </div>
                </fieldset>
              );
            })}

            <fieldset className="editor-section">
              <legend>External Help / Family Support received · excluded from all calculations</legend>
              <p className="field-note">Record it only for context. It will never increase income, reduce expenses, or change a chart.</p>
              <div className="excluded-support-list">
                {modelDraft.excludedSupport.map((item) => (
                  <div className="excluded-support-row" key={item.id}>
                    <input aria-label="Excluded support label" value={item.label} onChange={(event) => setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) })} />
                    <input aria-label={`${item.label} monthly amount in ${modelDraft.baseCurrency}`} min="0" step="0.01" type="number" value={item.monthlyBase} onChange={(event) => setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.map((candidate) => candidate.id === item.id ? { ...candidate, monthlyBase: Number(event.target.value) } : candidate) })} />
                    <input aria-label={`${item.label} note`} value={item.note} placeholder="Context only" onChange={(event) => setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.map((candidate) => candidate.id === item.id ? { ...candidate, note: event.target.value } : candidate) })} />
                    <button type="button" onClick={() => setModelDraft({ ...modelDraft, excludedSupport: modelDraft.excludedSupport.filter((candidate) => candidate.id !== item.id) })}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="button ghost" onClick={() => setModelDraft({ ...modelDraft, excludedSupport: [...modelDraft.excludedSupport, { id: createStableId("excluded-support"), label: "Potential external support", monthlyBase: 0, note: "Excluded from every calculation." }] })}>＋ Add excluded support note</button>
            </fieldset>

            <fieldset className="editor-section research-editor-section">
              <legend>Source-backed research records</legend>
              <p className="field-note">Use official or primary sources where possible. Record the dated finding, source, and options it affects; research notes never change money totals by themselves.</p>
              <div className="research-editor-list">
                {modelDraft.researchItems.map((item) => (
                  <article className="research-editor-row" key={item.id}>
                    <div className="form-grid">
                      <label><span>Topic</span><select value={item.topic} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, topic: event.target.value as ResearchTopic } : candidate) })}>{(Object.keys(researchTopicLabels) as ResearchTopic[]).map((topic) => <option key={topic} value={topic}>{researchTopicLabels[topic]}</option>)}</select></label>
                      <label><span>Status</span><select value={item.status} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, status: event.target.value as "verified" | "estimate" | "question" } : candidate) })}><option value="verified">Verified</option><option value="estimate">Estimate</option><option value="question">Open question</option></select></label>
                      <label className="wide"><span>Finding title</span><input required value={item.title} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate) })} /></label>
                      <label className="wide"><span>Finding or implication</span><textarea required rows={3} value={item.finding} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, finding: event.target.value } : candidate) })} /></label>
                      <label><span>Publisher{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} value={item.publisher} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, publisher: event.target.value } : candidate) })} /></label>
                      <label><span>As of{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} type="date" value={item.asOf ?? ""} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, asOf: event.target.value || null } : candidate) })} /></label>
                      <label className="wide"><span>Source title{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} value={item.sourceTitle} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, sourceTitle: event.target.value } : candidate) })} /></label>
                      <label className="wide"><span>HTTPS source URL{item.status !== "question" ? " · required" : ""}</span><input required={item.status !== "question"} type="url" pattern="https://.*" value={item.sourceUrl} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, sourceUrl: event.target.value } : candidate) })} /></label>
                      <label className="wide"><span>Review note</span><input value={item.note} onChange={(event) => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, note: event.target.value } : candidate) })} /></label>
                    </div>
                    <div className="research-applicability">
                      <strong>Applies to</strong><small>Leave every box clear to apply it to all options.</small>
                      <div>{modelDraft.scenarios.map((scenario) => <label key={scenario.id}><input type="checkbox" checked={item.appliesToScenarioIds.includes(scenario.id)} onChange={() => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.map((candidate) => candidate.id === item.id ? { ...candidate, appliesToScenarioIds: candidate.appliesToScenarioIds.includes(scenario.id) ? candidate.appliesToScenarioIds.filter((id) => id !== scenario.id) : [...candidate.appliesToScenarioIds, scenario.id] } : candidate) })} />{scenario.label}</label>)}</div>
                    </div>
                    <button type="button" className="remove-field" onClick={() => setModelDraft({ ...modelDraft, researchItems: modelDraft.researchItems.filter((candidate) => candidate.id !== item.id) })}>Remove research record</button>
                  </article>
                ))}
              </div>
              <button type="button" className="button ghost" onClick={() => setModelDraft({ ...modelDraft, researchItems: [...modelDraft.researchItems, { id: createStableId("research"), topic: "other", title: "New research finding", finding: "Describe what the source establishes and why it matters.", appliesToScenarioIds: [], status: "question", publisher: "", sourceTitle: "", sourceUrl: "", asOf: null, note: "" }] })}>＋ Add research record</button>
            </fieldset>

            {modelDraft.migrationNotes.length > 0 && (
              <section className="migration-notes"><strong>Migration review needed</strong>{modelDraft.migrationNotes.map((note) => <p key={note}>{note}</p>)}</section>
            )}

            <div className="modal-actions"><span /><button type="button" className="button ghost" onClick={() => setModelDraft(null)}>Cancel</button><button type="submit" className="button primary">{modelDraft.scenarios.length ? "Apply shared settings" : "Save settings and enter current situation"}</button></div>
          </form>
        </div>
      )}

      {editor && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close option editor" onClick={() => setEditor(null)} />
          <form className="scenario-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-editor-title" data-dialog-id="scenario-editor" tabIndex={-1} onSubmit={saveScenario} onInvalidCapture={revealFirstInvalidControl} onChangeCapture={() => setFormNotice("")}>
            <div className="modal-head"><div><span className="section-kicker">{firstScenarioSetup ? "Current situation" : "Option editor"}</span><h2 id="scenario-editor-title">{firstScenarioSetup ? "Enter your current option" : editingExisting ? "Edit this option" : "Add a new option"}</h2></div><button type="button" className="close-button" onClick={() => setEditor(null)} aria-label="Close editor">×</button></div>
            <p className="modal-intro">Amounts below use {editor.currency}. Shared settings keep every option on the same set of fields.</p>
            {formNotice && <p className="form-error-summary" role="alert">{formNotice}</p>}

            <fieldset className="editor-section">
              <legend>Identity, currency, and gross compensation</legend>
              <div className="form-grid">
                <label className="wide"><span>Option name</span><input required value={editor.label} onChange={(event) => updateEditor("label", event.target.value)} /></label>
                <label className="wide"><span>Location</span><input required value={editor.location} onChange={(event) => updateEditor("location", event.target.value)} /></label>
                <label><span>Local currency</span><input required maxLength={3} value={editor.currency} onChange={(event) => { const currency = currencyCode(event.target.value); setEditor({ ...editor, currency, fx: currency === plan.baseCurrency ? { ...editor.fx, rateToBase: 1, source: "Base currency" } : editor.fx }); }} /></label>
                <label><span>1 local currency in {plan.baseCurrency}</span><input required min="0.00000001" step="0.00000001" type="number" disabled={editor.currency === plan.baseCurrency} value={editor.fx.rateToBase} onChange={(event) => updateEditor("fx", { ...editor.fx, rateToBase: Number(event.target.value) })} /></label>
                <label><span>FX as of{editor.currency !== plan.baseCurrency ? " · required" : ""}</span><input required={editor.currency !== plan.baseCurrency} type="date" value={editor.fx.asOf ?? ""} onChange={(event) => updateEditor("fx", { ...editor.fx, asOf: event.target.value || null })} /></label>
                <label className="wide"><span>FX source{editor.currency !== plan.baseCurrency ? " · required" : ""}</span><input required={editor.currency !== plan.baseCurrency} value={editor.fx.source} onChange={(event) => updateEditor("fx", { ...editor.fx, source: event.target.value })} /></label>
                <label className="wide"><span>Monthly gross compensation<small>Before deductions; include only components counted in the model</small></span><input required min="0" step="0.01" type="number" value={editor.grossMonthly} onChange={(event) => updateEditor("grossMonthly", Number(event.target.value))} /></label>
              </div>
              <EvidenceEditor evidence={editor.evidence.grossMonthly ?? createUnknownEvidence()} onChange={(evidence) => updateEditorEvidence("grossMonthly", evidence)} title="Gross compensation accuracy and source" />
            </fieldset>

            {(Object.keys(groupMeta) as FieldGroup[]).map((group) => {
              const fields = plan.fieldDefinitions.filter((field) => field.group === group && field.scope === "perOption");
              if (!fields.length) return null;
              return (
                <fieldset className="editor-section" key={group}>
                  <legend>{groupMeta[group].title}</legend>
                  <p className="field-note">{groupMeta[group].help}</p>
                  <div className="amount-field-list">
                    {fields.map((field) => (
                      <div className="amount-field-row" key={field.id}>
                        <label><span>{field.label}<small>{field.description}</small></span><input required min="0" step="0.01" type="number" value={fieldValue(plan, editor, field)} onChange={(event) => updateEditorValue(field.id, Number(event.target.value))} /></label>
                        <EvidenceEditor evidence={editor.evidence[field.id] ?? createUnknownEvidence()} onChange={(evidence) => updateEditorEvidence(field.id, evidence)} />
                      </div>
                    ))}
                  </div>
                  {plan.fieldDefinitions.some((field) => field.group === group && field.scope === "shared") && (
                    <div className="shared-preview-list">
                      <strong>Applied automatically from Shared settings</strong>
                      {plan.fieldDefinitions.filter((field) => field.group === group && field.scope === "shared").map((field) => <span key={field.id}>{field.label}<b>{formatMoney(plan.sharedValues[field.id] ?? 0, plan.baseCurrency, plan.locale)}</b></span>)}
                    </div>
                  )}
                </fieldset>
              );
            })}

            {editorPreview && (
              <div className="editor-preview savings-preview" aria-live="polite">
                <div><span>Gross compensation</span><strong>{formatMoney(editorPreview.grossMonthly, editor.currency, plan.locale)}</strong><small>{formatMoney(editorPreview.grossBase, plan.baseCurrency, plan.locale)}</small></div>
                <div><span>Net cash income</span><strong>{formatMoney(editorPreview.netCashMonthly, editor.currency, plan.locale)}</strong><small>{formatMoney(editorPreview.netCashBase, plan.baseCurrency, plan.locale)}</small></div>
                <div className="preview-parent"><span>Total saving</span><strong>{formatMoney(editorPreview.totalSavingBase, plan.baseCurrency, plan.locale)}</strong><small>Investments {formatMoney(editorPreview.totalInvestmentBase, plan.baseCurrency, plan.locale)} + cash {formatMoney(editorPreview.cashRemainingBase, plan.baseCurrency, plan.locale)}</small></div>
              </div>
            )}

            <details className="editor-details">
              <summary>Card label and display details <span>Optional</span></summary>
              <div className="form-grid">
                <label><span>Country code / badge</span><input maxLength={3} value={editor.flag} onChange={(event) => updateEditor("flag", event.target.value.toUpperCase())} /></label>
                <label><span>Status</span><input value={editor.status} onChange={(event) => updateEditor("status", event.target.value)} /></label>
                <label className="wide"><span>Income summary</span><input value={editor.employment} onChange={(event) => updateEditor("employment", event.target.value)} /></label>
                <label><span>Household earners included</span><input required min="0" max="20" step="1" type="number" value={editor.earners} onChange={(event) => updateEditor("earners", Number(event.target.value))} /></label>
                <label><span>Card colour</span><input className="color-input" type="color" value={editor.color} onChange={(event) => updateEditor("color", event.target.value)} /></label>
              </div>
            </details>

            <details className="editor-details">
              <summary>Qualitative assumptions <span>Preserved in comparisons and exports</span></summary>
              <div className="form-grid">
                <label className="wide"><span>Spouse income assumption</span><input value={editor.spouseJob} onChange={(event) => updateEditor("spouseJob", event.target.value)} /></label>
                <label className="wide"><span>Childcare assumption</span><input value={editor.childcare} onChange={(event) => updateEditor("childcare", event.target.value)} /></label>
                <label className="wide"><span>Transport assumption</span><input value={editor.transport} onChange={(event) => updateEditor("transport", event.target.value)} /></label>
                <label className="wide"><span>Residence / visa assumption</span><input value={editor.residency} onChange={(event) => updateEditor("residency", event.target.value)} /></label>
                <label className="wide"><span>Bonus treatment<small>Excluded unless converted into recurring monthly inputs</small></span><input value={editor.bonus} onChange={(event) => updateEditor("bonus", event.target.value)} /></label>
                <label className="wide"><span>Benefits included or confirmed · one per line</span><textarea rows={3} value={editor.benefits.join("\n")} onChange={(event) => updateEditor("benefits", event.target.value.split("\n").filter(Boolean))} /></label>
                <label className="wide"><span>Important uncertainties · one per line</span><textarea rows={3} value={editor.risks.join("\n")} onChange={(event) => updateEditor("risks", event.target.value.split("\n").filter(Boolean))} /></label>
              </div>
            </details>

            {deleteScenarioConfirm && <div className="inline-danger"><strong>Remove this option from this browser?</strong><span>This cannot be undone unless you downloaded a backup.</span><button type="button" onClick={deleteScenario}>Confirm removal</button></div>}
            <div className="modal-actions">
              {editingExisting && <button type="button" className="button danger" onClick={() => setDeleteScenarioConfirm(true)}>Remove option</button>}
              <span />
              <button type="button" className="button ghost" onClick={() => setEditor(null)}>Cancel</button>
              <button type="submit" className="button primary">{firstScenarioSetup ? "Save current situation" : editingExisting ? "Save changes" : "Add option"}</button>
            </div>
          </form>
        </div>
      )}

      {importCandidate && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close import preview" onClick={() => setImportCandidate(null)} />
          <section className="share-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" data-dialog-id="import-preview" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Check before replacing</span><h2 id="import-title">Replace this browser’s complete comparison?</h2></div><button className="close-button" onClick={() => setImportCandidate(null)} aria-label="Close import preview">×</button></div>
            <div className="import-summary"><div><span>Title</span><strong>{importCandidate.document.title}</strong></div><div><span>Base currency</span><strong>{importCandidate.document.baseCurrency}</strong></div><div><span>Options</span><strong>{importCandidate.document.scenarios.length}</strong></div><div><span>Common fields</span><strong>{importCandidate.document.fieldDefinitions.length}</strong></div></div>
            {importCandidate.migrated && <p className="migration-warning">This older Wayfinder file was migrated without changing its stored totals. Review migration notes and sources after import.</p>}
            <p className="modal-intro">This complete comparison file includes and replaces shared settings, your current situation, all options, assumptions, evidence, and sources. Nothing changes until you confirm; it replaces everything, with no partial merge.</p>
            <div className="modal-actions"><button className="button ghost" onClick={exportDocument}>Download current backup first</button><span /><button className="button ghost" onClick={() => setImportCandidate(null)}>Cancel</button><button className="button primary" onClick={confirmImport}>Replace complete comparison</button></div>
          </section>
        </div>
      )}

      {importIssues.length > 0 && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Close import errors" onClick={() => setImportIssues([])} />
          <section className="share-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-error-title" data-dialog-id="import-errors" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Import rejected safely</span><h2 id="import-error-title">Fix these document fields</h2></div><button className="close-button" onClick={() => setImportIssues([])} aria-label="Close import errors">×</button></div>
            <ol className="validation-list">{importIssues.slice(0, 20).map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code><span>{issue.message}</span></li>)}</ol>
            {importIssues.length > 20 && <p className="modal-intro">{importIssues.length - 20} more issues were omitted. Use the repository validator for the complete list.</p>}
            <div className="modal-actions"><span /><button className="button primary" onClick={() => setImportIssues([])}>Close</button></div>
          </section>
        </div>
      )}

      {clearConfirm && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" type="button" tabIndex={-1} aria-label="Cancel clearing browser data" onClick={() => setClearConfirm(false)} />
          <section className="share-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="clear-title" data-dialog-id="clear-browser" tabIndex={-1}>
            <div className="modal-head"><div><span className="section-kicker">Local data deletion</span><h2 id="clear-title">Clear this browser?</h2></div><button className="close-button" onClick={() => setClearConfirm(false)} aria-label="Cancel clearing browser data">×</button></div>
            <p className="modal-intro">This removes shared settings, every option, excluded-support notes, sources, and any local recovery copy from this browser. The public application repository is unaffected.</p>
            <div className="modal-actions"><button className="button ghost" onClick={exportDocument}>Download backup first</button><span /><button className="button ghost" onClick={() => setClearConfirm(false)}>Cancel</button><button className="button danger" onClick={clearDashboard}>Clear all local data</button></div>
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
