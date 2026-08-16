import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("does not derive metadata origins from request Host headers", async () => {
  const source = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /next\/headers|x-forwarded-host|x-forwarded-proto|requestHeaders|rawHost/);
  assert.match(source, /WAYFINDER_PUBLIC_ORIGIN/);
  assert.match(source, /url\.protocol !== "http:" && url\.protocol !== "https:"/);
  assert.match(source, /url\.username \|\|[\s\S]*url\.password/);
  assert.match(source, /return url\.origin/);
  assert.match(source, /imageUrl \? \{ images:/);
});

test("server-renders an empty, local-first v4 first run", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Wayfinder · Relocation Decision Studio<\/title>/i);
  assert.match(html, /Open source · private on your device/i);
  assert.match(html, /Set up manually/i);
  assert.match(html, /Import agent document/i);
  assert.match(html, /No sign-in, cloud database, or telemetry/i);
  assert.match(html, /Your figures stay in this browser/i);

  // The server response is the public, first-run state: no option cards, totals,
  // or retained household data should be present before a user creates/imports it.
  assert.doesNotMatch(html, /scenario-card|kpi-grid|projection-card|ledger-table/i);
  assert.doesNotMatch(html, /Highest monthly total saving|Full calculation/i);
  assert.doesNotMatch(html, /(?:USD|INR|CAD|AED)\s?[\d,]+/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the v4 model, import contract, calculations, and sharing flows public-safe", async () => {
  const [page, scenarios, document, layout, privacy] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/scenarios.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/document.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
  ]);
  const publicSource = [page, scenarios, document, layout, privacy].join("\n");

  // A new public clone starts with the full field model but no household options.
  assert.match(scenarios, /SCHEMA_VERSION\s*=\s*4/);
  assert.match(scenarios, /DEFAULT_SCENARIOS:\s*Scenario\[\]\s*=\s*\[\]/);
  assert.match(scenarios, /scenarios:\s*\[\]/);
  assert.match(scenarios, /sharedValues: createEmptySharedValues\(fields\)/);
  assert.match(scenarios, /sharedEvidence: createSharedEvidence\(fields\)/);
  assert.match(scenarios, /scope: "shared"/);
  assert.match(page, /Comparison model/);
  assert.match(page, /Manual or agent input/);
  assert.match(page, /same validated document contract/);

  // Browser persistence parses current and legacy values independently, never
  // autosaves the empty first render, and updates React state only after a
  // validated localStorage commit succeeds.
  assert.match(page, /currentRaw = window\.localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(page, /legacyRaw = window\.localStorage\.getItem\(LEGACY_STORAGE_KEY\)/);
  assert.match(page, /const current = parseStoredPlan\(currentRaw\)/);
  assert.match(page, /const legacy = parseStoredPlan\(legacyRaw\)/);
  assert.match(page, /if \(legacy\.status === "valid"\)/);
  assert.doesNotMatch(page, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(plan\)\)/);
  assert.match(page, /validateWayfinderInput\(synced\)[\s\S]*serialized = JSON\.stringify\(result\.document\)[\s\S]*localStorage\.setItem\(STORAGE_KEY, serialized\)[\s\S]*setPlan\(result\.document\)/);
  assert.match(page, /Could not save\. Your previous dashboard is still unchanged/);
  assert.match(page, /localStorage\.removeItem\(STORAGE_KEY\)/);

  // Import and manual setup meet at the same document model; imports are parsed,
  // validated, previewed, and explicitly confirmed before replacing the dashboard.
  assert.match(page, /MAX_DOCUMENT_BYTES[\s\S]*validateWayfinderInput/);
  assert.match(page, /const result = validateWayfinderInput\(JSON\.parse\(value\)\)/);
  assert.match(page, /file\.size > MAX_DOCUMENT_BYTES[\s\S]*await file\.text\(\)/);
  assert.match(page, /const result = validateWayfinderInput\(JSON\.parse\(await file\.text\(\)\)\)/);
  assert.match(page, /document: syncDocumentFields\(result\.document\)/);
  assert.match(page, /Validated import preview/);
  assert.match(page, /Import is atomic: nothing changes until you confirm/);
  assert.match(page, /Replace with validated document/);
  assert.match(page, /const confirmImport = async \(\) => \{[\s\S]*await commitPlan\([\s\S]*confirmedImport\.document,[\s\S]*Validated document replaced this browser dashboard/);
  assert.ok(
    page.indexOf("setImportCandidate({") < page.indexOf("const confirmImport"),
    "the import candidate must be prepared before the replacement handler",
  );
  assert.match(document, /parseWayfinderDocument[\s\S]*validateWayfinderDocument/);
  assert.match(document, /syncDocumentFields/);

  // Cross-tab changes are detected by events and re-checked inside the common
  // IndexedDB lock domain; Web Locks are an additional outer lock when present.
  assert.match(page, /window\.addEventListener\("storage", onStorage\)/);
  assert.match(page, /const indexedDbLockedOperation = \(\) => withIndexedDbStorageLock\(operation\)/);
  assert.equal(
    (page.match(/withIndexedDbStorageLock\(operation\)/g) ?? []).length,
    1,
    "all capability branches must share one IndexedDB-locked operation",
  );
  assert.match(page, /navigator\.locks\.request\([\s\S]*STORAGE_LOCK_NAME[\s\S]*mode: "exclusive"[\s\S]*indexedDbLockedOperation/);
  assert.doesNotMatch(page, /!navigator\.locks\) return operation\(\)/);
  assert.match(page, /return indexedDbLockedOperation\(\)/);
  assert.doesNotMatch(page, /\{ mode: "exclusive" \},\s*operation,/);
  assert.match(page, /indexedDB\.open\([\s\S]*STORAGE_LOCK_DB_NAME[\s\S]*STORAGE_LOCK_DB_VERSION/);
  assert.match(page, /createObjectStore\(STORAGE_LOCK_STORE\)/);
  assert.match(page, /database\.transaction\(STORAGE_LOCK_STORE, "readwrite"\)/);
  assert.match(page, /\.put\([\s\S]*\{ touchedAt: Date\.now\(\) \},[\s\S]*STORAGE_LOCK_NAME/);
  assert.match(page, /markerRequest\.onsuccess = \(\) => \{[\s\S]*result = operation\(\)/);
  assert.match(page, /request\.onblocked[\s\S]*rejectOnce/);
  assert.match(page, /request\.onerror[\s\S]*rejectOnce/);
  assert.match(page, /database\.onversionchange = \(\) => database\.close\(\)/);
  assert.match(page, /transaction\.oncomplete[\s\S]*database\.close\(\)/);
  assert.match(page, /transaction\.onabort[\s\S]*rejectWithCleanup/);
  assert.match(page, /IndexedDB is the common lock domain for every tab/);
  assert.match(page, /this rejects[\s\S]*caller leaves storage intact rather than running unlocked/);
  assert.match(privacy, /every mutation uses a dedicated local IndexedDB object store as its shared lock domain/);
  assert.match(privacy, /exclusive Web Lock wraps that same IndexedDB transaction/);
  assert.match(privacy, /only record is a coordination marker with a last-use timestamp/);
  assert.match(privacy, /contains no plan, financial, household, research, source, or identity data/);
  assert.match(privacy, /If the common IndexedDB lock cannot be established, Wayfinder leaves the saved dashboard unchanged/);
  assert.match(page, /const commitPlan = async[\s\S]*withStorageMutationLock\(\(\) => \{[\s\S]*inspectBrowserStorage\(\)[\s\S]*snapshot\.token !== expectedStorageToken[\s\S]*validateWayfinderInput\(synced\)[\s\S]*localStorage\.setItem\(STORAGE_KEY, serialized\)/);
  assert.match(page, /const clearDashboard = async[\s\S]*withStorageMutationLock\(\(\) => \{[\s\S]*inspectBrowserStorage\(\)[\s\S]*snapshot\.token !== expectedStorageToken[\s\S]*localStorage\.removeItem\(LEGACY_STORAGE_KEY\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(page, /const saveScenario = async[\s\S]*await commitPlan/);
  assert.match(page, /const saveModel = async[\s\S]*await commitPlan/);
  assert.match(page, /updatedAt/);
  assert.match(page, /Reload external version/);
  assert.match(page, /Keep this tab/);
  assert.match(page, /your save was stopped before anything was overwritten/i);

  // Zero-valued fields still require confirmation when they carry meaningful
  // shared or per-option evidence that deletion would discard.
  assert.match(page, /function hasMeaningfulEvidence/);
  assert.match(page, /evidence\.status !== "unknown"/);
  assert.match(page, /evidence\.source\.trim\(\)\.length > 0/);
  assert.match(page, /Boolean\(evidence\.asOf\)/);
  assert.match(page, /evidence\.note\.trim\(\)\.length > 0/);
  assert.match(page, /hasMeaningfulEvidence\(modelDraft\.sharedEvidence\[id\]\)/);
  assert.match(page, /hasMeaningfulEvidence\(scenario\.evidence\[id\]\)/);

  // Every rendered dialog participates in the shared focus trap, inert
  // background, Escape handling, and opener-focus restoration lifecycle.
  const dialogs = page.match(/role="dialog"/g) ?? [];
  const managedDialogs = page.match(/role="dialog"[^>]*data-dialog-id=/g) ?? [];
  assert.equal(managedDialogs.length, dialogs.length);
  assert.match(page, /element\.inert = true/);
  assert.match(page, /event\.key === "Tab"/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /dialogOpenerRef\.current[\s\S]*opener\?\.focus\(\)/);

  // The dashboard exposes the ownership and arithmetic behind every saving total.
  assert.match(page, /Gross compensation/);
  assert.match(page, /className="tile-breakdown"/);
  assert.match(page, /Expand full calculation and sources/);
  assert.match(page, /Investments \+ cash remaining = total saving/);
  assert.match(page, /Total saving is the parent/);
  assert.match(page, /Gross − non-saving deductions − automatic investments = net cash/);
  assert.match(page, /Total saving = automatic investments \+ net cash − living costs − commitments/);

  // Tile actions must reopen the canonical stored scenario, not the derived
  // display object that also contains calculated fields rejected on save.
  assert.match(page, /const openScenarioEditor = \(id: string\)[\s\S]*plan\.scenarios\.find/);
  assert.match(page, /openScenarioEditor\(scenario\.id\)/);
  assert.match(page, /duplicateScenario\(scenario\.id\)/);

  // Five-year projections label both the selected monthly metric and its cumulative headline.
  assert.match(page, /const projectionMeta/);
  assert.match(page, /label: "Gross compensation"/);
  assert.match(page, /cumulative: "cumulative total saving"/);
  assert.match(page, /Legend: each bar is monthly/);
  assert.match(page, /each headline is the sum of twelve months for every displayed year/);

  // Users and agents can exchange an empty v4 template, a full editable document,
  // and a read-only family view; sources remain structured evidence, not fake scores.
  assert.match(page, /wayfinder-agent-template\.v4\.json/);
  assert.match(page, /Download agent template/);
  assert.match(page, /Download editable document/);
  assert.match(page, /Download family view/);
  assert.match(page, /createFamilyShareHtml\(plan\)/);
  assert.match(page, /Source-backed research records/);
  assert.match(page, /HTTPS source URL/);
  assert.match(page, /research notes never change money totals by themselves/);

  // Public source remains portable and does not embed a contributor's absolute
  // Windows home or documents path. Product-specific private markers are checked
  // at the staged-tree publication gate rather than recorded in this repository.
  assert.doesNotMatch(publicSource, /[A-Z]:[\\/](?:Users|Documents)[\\/]/i);
});
