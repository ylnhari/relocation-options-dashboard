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
  assert.match(html, /Enter my details/i);
  assert.match(html, /Import complete comparison/i);
  assert.match(html, /Download blank comparison template/i);
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
  const [page, scenarios, document, layout, styles, currencyInput, privacy, runtimeSeed, viteConfig, launcher] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/scenarios.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/document.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/currency-input.ts", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../app/runtime-seed.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dev.py", import.meta.url), "utf8"),
  ]);
  const publicSource = [page, scenarios, document, layout, styles, currencyInput, privacy, runtimeSeed, viteConfig, launcher].join("\n");

  // A new public clone starts with the full field model but no household options.
  assert.match(scenarios, /SCHEMA_VERSION\s*=\s*4/);
  assert.match(scenarios, /DEFAULT_SCENARIOS:\s*Scenario\[\]\s*=\s*\[\]/);
  assert.match(scenarios, /scenarios:\s*\[\]/);
  assert.match(scenarios, /sharedValues: createEmptySharedValues\(fields\)/);
  assert.match(scenarios, /sharedEvidence: createSharedEvidence\(fields\)/);
  assert.match(scenarios, /scope: "shared"/);
  assert.match(page, /Shared settings/);
  assert.match(page, /Add your options/);
  assert.match(page, /Review the comparison/);
  assert.match(page, /one JSON file containing shared settings, your current situation, all alternatives, assumptions, and sources/);
  assert.doesNotMatch(page, />Comparison model</);
  assert.doesNotMatch(page, />Manual or agent input</);
  assert.doesNotMatch(page, /same validated document contract/);

  // Manual option entry exposes one canonical local amount through linked,
  // clearly labelled option- and comparison-currency controls. Converted
  // values remain UI projections rather than a second stored field.
  assert.match(page, /function CurrencyAmountEditor/);
  assert.match(page, /Option currency/);
  assert.match(page, /Comparison currency/);
  assert.match(page, /Edit either amount\. Linked using 1/);
  assert.match(page, /localAmount=\{editor\.grossMonthly\}/);
  assert.match(page, /localAmount=\{editor\.values\[field\.id\] \?\? 0\}/);
  assert.match(page, /onChangeLocal=\{\(amount\) => updateEditorValue\(field\.id, amount\)\}/);
  assert.match(page, /baseToLocalAmount\(baseAmount/);
  assert.match(page, /localAmount === null \? `Enter the \$\{editor\.currency\} conversion ratio`/);
  assert.doesNotMatch(page, /formatMoney\(localAmount \?\? 0/);
  assert.match(currencyInput, /return localAmount \* rateToBase/);
  assert.match(currencyInput, /return baseAmount \/ rateToBase/);
  assert.doesNotMatch(scenarios, /grossMonthlyBase|valuesBase|convertedValues/);

  // Long, data-driven edit sections use native disclosures. Short sections
  // remain fieldsets, and invalid controls can open their nearest disclosure.
  assert.match(page, /fields\.length >= LONG_EDITOR_SECTION_SIZE/);
  assert.match(page, /className="editor-section collapsible-editor-section"/);
  assert.match(page, /title="Research and sources"[\s\S]*collapsible/);
  assert.match(page, /title="External Help \/ Family Support received"[\s\S]*collapsible/);
  assert.match(styles, /summary:focus-visible/);
  assert.match(styles, /\.currency-input-pair[\s\S]*grid-template-columns/);
  assert.match(styles, /@media \(max-width: 650px\)[\s\S]*\.currency-input-pair \{ grid-template-columns: 1fr; \}/);
  assert.match(page, /firstInvalid\.closest\("details"\)[\s\S]*details\.open = true/);

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
  assert.match(page, /shouldApplyRuntimeSeed\(snapshot\.status, runtimeSeed\)/);
  assert.match(page, /applyRuntimeSeed\(runtimeSeed\.document\)/);
  assert.match(page, /const latest = inspectBrowserStorage\(\)[\s\S]*latest\.status === "valid"[\s\S]*adoptSavedPlan\(latest\)/);
  assert.ok(
    page.indexOf('latest.status === "valid"')
      < page.indexOf("window.localStorage.setItem(STORAGE_KEY, serialized)", page.indexOf("const applyRuntimeSeed")),
    "a valid plan saved by another tab must win before a runtime seed writes",
  );
  assert.match(page, /localStorage\.setItem\(STORAGE_KEY, serialized\)[\s\S]*localStorage\.removeItem\(LEGACY_STORAGE_KEY\)/);
  assert.match(page, /Your comparison is ready and saved in this browser/);
  assert.ok(
    page.indexOf("shouldApplyRuntimeSeed(snapshot.status, runtimeSeed)")
      < page.indexOf('snapshot.status === "invalid" || snapshot.status === "unavailable"'),
    "a valid runtime seed must replace damaged storage before the old-save warning is shown",
  );
  assert.match(runtimeSeed, /validateWayfinderInput\(JSON\.parse\(value\)\)/);
  assert.match(runtimeSeed, /syncDocumentFields\(result\.document\)/);
  assert.match(runtimeSeed, /browserStatus === "empty" \|\| browserStatus === "invalid"/);
  assert.match(viteConfig, /WAYFINDER_RUNTIME_SEED_ENABLED === "1"/);
  assert.match(viteConfig, /WAYFINDER_RUNTIME_SEED_ID/);
  assert.match(viteConfig, /wayfinder-runtime-seed-\$\{RUNTIME_SEED_ID\}\.json/);
  assert.match(viteConfig, /command === "serve" && mode === "development"/);
  assert.match(viteConfig, /fstatSync\(handle\)[\s\S]*details\.isFile\(\)[\s\S]*MAX_RUNTIME_SEED_BYTES/);
  assert.match(launcher, /prepare_runtime_seed\(document_path\)/);
  assert.match(launcher, /secrets\.token_urlsafe/);
  assert.match(launcher, /os\.replace\(candidate_path, target_path\)/);
  assert.match(launcher, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher, /LEASE_IDENTITY_KEY = "ownerIdentity"/);
  assert.ok(
    launcher.indexOf("establish_windows_job_containment()")
      < launcher.indexOf("prepare_runtime_seed(document_path)"),
    "Windows child containment must be established before a seed artifact is created",
  );
  assert.doesNotMatch(launcher, /update_seed_lease_owner/);
  assert.match(launcher, /RUNTIME_SEED_ENABLED_ENV_VAR/);
  assert.match(launcher, /sends its starter document to every browser that can reach it/);
  assert.match(launcher, /finally:[\s\S]*cleanup_runtime_seed\(runtime_seed_id\)/);
  assert.match(launcher, /os\.fstat\(source\.fileno\(\)\)[\s\S]*stat\.S_ISREG/);
  assert.doesNotMatch(launcher, /print\(.*document_path|display_document_path/);

  // Import and manual setup meet at the same document model; imports are parsed,
  // validated, previewed, and explicitly confirmed before replacing the dashboard.
  assert.match(page, /MAX_DOCUMENT_BYTES[\s\S]*validateWayfinderInput/);
  assert.match(page, /const result = validateWayfinderInput\(JSON\.parse\(value\), \{[\s\S]*allowLegacyConversionGap: true[\s\S]*\}\)/);
  assert.match(page, /file\.size > MAX_DOCUMENT_BYTES[\s\S]*await file\.text\(\)/);
  assert.match(page, /const parsed = JSON\.parse\(await file\.text\(\)\)[\s\S]*const result = validateWayfinderInput\(parsed\)/);
  assert.match(page, /document: syncDocumentFields\(result\.document\)/);
  assert.match(page, /Replace this browser’s complete comparison\?/);
  assert.match(page, /Nothing changes until you confirm; it replaces everything, with no partial merge/);
  assert.match(page, /Replace complete comparison/);
  assert.match(page, /const confirmImport = async \(\) => \{[\s\S]*await commitPlan\([\s\S]*confirmedImport\.document,[\s\S]*Validated comparison replaced this browser dashboard/);
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
  assert.match(page, /if \(populated && !confirmed\)/);
  assert.match(page, /Remove “\{field\.label\}”\?/);
  assert.match(page, /Download saved backup/);
  assert.match(page, /Confirm remove/);

  // Stored currencies cannot be silently reinterpreted. Existing option
  // currencies stay fixed, while changing the comparison currency has an
  // explicit backup-and-restart route.
  assert.match(page, /const optionCurrencyLocked = Boolean/);
  assert.match(page, /disabled=\{optionCurrencyLocked\}/);
  assert.match(page, /const comparisonCurrencyLocked = Boolean[\s\S]*Object\.values\(modelDraft\.sharedValues\)\.some[\s\S]*modelDraft\.excludedSupport\.some/);
  assert.match(page, /disabled=\{comparisonCurrencyLocked\}/);
  assert.match(page, /shared or excluded-support amounts are entered/);
  assert.match(page, /Back up or start again with another currency/);
  assert.match(page, /setCurrencyRestartDraft\(cloneDocument\(modelDraft\)\); setModelDraft\(null\); setClearConfirm\(true\)/);
  assert.match(page, /const cancelClearDashboard = useCallback[\s\S]*setModelDraft\(currencyRestartDraft\)[\s\S]*setCurrencyRestartDraft\(null\)/);
  assert.match(page, /currencyRestartDraft \? syncDocumentFields\(currencyRestartDraft\) : plan/);
  assert.match(page, /Your open Shared settings edits are preserved here\. Cancel returns to them/);
  assert.match(page, /Download draft backup/);

  // Starter objects contain no fake identity or assumption facts. Required
  // identity fields are completed by the user; examples live in placeholders.
  assert.match(scenarios, /flag: "",[\s\S]*label: "",[\s\S]*location: "",[\s\S]*employment: "",[\s\S]*status: ""/);
  assert.doesNotMatch(scenarios, /City · country|Current household income|Income included in this option|Not assessed/);
  assert.match(page, /Option name[\s\S]*input required[^>]*placeholder="For example: Current household"/);
  assert.match(page, /Income summary[\s\S]*input required[^>]*placeholder="Who is working and which income is included\?"/);
  assert.ok(page.indexOf("Income summary") < page.indexOf("Card appearance"));
  assert.match(page, /Household earners included[\s\S]*required min="0" max="20"/);
  assert.match(page, /Conversion ratio[\s\S]*Same currency, so the ratio is always 1[\s\S]*1 \$\{editor\.currency \|\| "option currency"\} = how many \$\{plan\.baseCurrency\}\?/);
  assert.match(page, /No conversion required/);
  assert.match(page, /Optional reference date/);
  assert.match(page, /Optional currency note or source/);
  assert.match(page, /Conversion date · required/);
  assert.match(page, /Conversion source · required/);
  assert.match(page, /const editorConversionReady = Boolean[\s\S]*hasUsableFxRate[\s\S]*Boolean\(editor\.fx\.asOf\)[\s\S]*editor\.fx\.source\.trim\(\)\.length > 0/);
  assert.match(page, /const editorAmountsReady = Boolean/);
  assert.match(page, /const editorPreview = editor && editorConversionReady && editorAmountsReady/);
  assert.match(page, /value\.trim\(\)\.length === 0[\s\S]*onChangeLocal\(null\)/);
  assert.match(page, /if \(amount === null\) next\.delete\(fieldId\)/);
  assert.match(page, /This option cannot be added until they are complete/);
  assert.match(page, /enteredScenarioAmounts/);
  assert.match(page, /enteredSharedAmounts/);
  assert.match(page, /Use 0 for \{blankSharedFields\.length\} blank shared/);
  assert.match(page, /value=\{enteredSharedAmounts\.has\(field\.id\) \? modelDraft\.sharedValues\[field\.id\] \?\? 0 : ""\}/);
  assert.match(page, /Use 0 for \{blankFields\.length\} blank/);
  assert.match(page, /\$\{enteredFields\.length\} entered/);
  assert.match(page, /entered=\{enteredScenarioAmounts\.has\("grossMonthly"\)\}/);
  assert.match(page, /collapsible=\{fields\.length \+ sharedFields\.length >= LONG_EDITOR_SECTION_SIZE\}/);
  assert.match(page, /const preflight = validateWayfinderInput\(syncDocumentFields\(next\), \{[\s\S]*allowLegacyConversionGap[\s\S]*if \(!preflight\.ok\)[\s\S]*return;[\s\S]*commitPlan\(next/);
  assert.match(page, /legacyRepairScenarios/);
  assert.match(page, /Older options need a conversion date/);
  assert.match(page, /isLegacyUndatedConversion\(plan, scenario\)[\s\S]*editableScenario\.fx\.source = ""/);
  assert.match(page, /const exportDocument = \(\) => \{[\s\S]*legacyRepairScenarios\.length > 0[\s\S]*Complete the older conversion details/);
  assert.match(page, /No reusable backup can be created yet/);
  assert.match(page, /disabled=\{legacyRepairScenarios\.length > 0\}[\s\S]*Reusable backup unavailable/);
  assert.match(page, /Remove without reusable backup/);
  assert.match(page, /Replace without reusable backup/);
  assert.match(page, /I reviewed the comparison currency, number format, growth, inflation, and projection years/);
  assert.match(page, /const freshStart =[\s\S]*plan\.updatedAt === DEFAULT_DOCUMENT\.updatedAt/);
  assert.match(page, /if \(freshStart\) \{[\s\S]*draft\.title = "";[\s\S]*draft\.baseCurrency = "";[\s\S]*draft\.locale = "";/);
  assert.match(page, /freshStart[\s\S]*incomeGrowthPct: "", expenseInflationPct: "", years: ""/);
  assert.match(page, /Annual income growth %[\s\S]*Enter your assumption[\s\S]*value=\{projectionInputDraft\?\.incomeGrowthPct \?\? ""\}/);
  assert.match(page, /disabled=\{!\/\^\[A-Z\]\{3\}\$\/\.test\(modelDraft\.baseCurrency\)\}/);
  assert.match(page, /title: "", finding: ""/);
  assert.match(page, /const reclassifyModelField =/);
  assert.match(page, /Category[\s\S]*field\.group[\s\S]*Used in[\s\S]*field\.scope/);
  assert.match(page, /Same amount in every option/);
  assert.match(page, /This item was not changed\. Set its amounts to zero and accuracy to Needs source first/);
  assert.match(page, /Remove this option from this browser\?[\s\S]*Download saved backup[\s\S]*Cancel[\s\S]*Confirm removal/);

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
  assert.match(page, /wayfinder-comparison-template\.v4\.json/);
  assert.match(page, /Download blank comparison template/);
  assert.match(page, /Download editable comparison file/);
  assert.match(page, /Download family view/);
  assert.match(page, /createFamilyShareHtml\(plan\)/);
  assert.match(page, /Research and sources/);
  assert.doesNotMatch(page, /common fields|field definitions|Controlled from one place/);
  assert.match(page, /HTTPS source URL/);
  assert.match(page, /research notes never change money totals by themselves/);

  // Public source remains portable and does not embed a contributor's absolute
  // Windows home or documents path. Product-specific private markers are checked
  // at the staged-tree publication gate rather than recorded in this repository.
  assert.doesNotMatch(publicSource, /[A-Z]:[\\/](?:Users|Documents)[\\/]/i);
});
