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

test("server-renders an empty, local-first v5 first run", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Wayfinder · Relocation Decision Studio<\/title>/i);
  assert.match(html, /Open source · private on your device/i);
  assert.match(html, /Enter my details/i);
  assert.match(html, /Import a saved comparison file/i);
  assert.match(html, /Download an empty comparison file/i);
  assert.match(html, /No sign-in, cloud database, or telemetry/i);
  assert.match(html, /Your figures stay in this browser/i);

  // The server response is the public, first-run state: no option cards, totals,
  // or retained household data should be present before a user creates/imports it.
  assert.doesNotMatch(html, /scenario-card|kpi-grid|projection-card|ledger-table/i);
  assert.doesNotMatch(html, /Highest monthly total saving|Full calculation/i);
  assert.doesNotMatch(html, /(?:USD|INR|CAD|AED)\s?[\d,]+/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the v5 model, import contract, calculations, and sharing flows public-safe", async () => {
  const [page, scenarios, document, layout, styles, currencyInput, moneyDisplay, shareReport, privacy, runtimeSeed, viteConfig, launcher] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/scenarios.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/document.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/currency-input.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/money-display.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/share-report.ts", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../app/runtime-seed.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dev.py", import.meta.url), "utf8"),
  ]);
  const publicSource = [page, scenarios, document, layout, styles, currencyInput, moneyDisplay, shareReport, privacy, runtimeSeed, viteConfig, launcher].join("\n");

  // A new public clone starts with the full field model but no household options.
  assert.match(scenarios, /SCHEMA_VERSION\s*=\s*5/);
  assert.match(scenarios, /DEFAULT_SCENARIOS:\s*Scenario\[\]\s*=\s*\[\]/);
  assert.match(scenarios, /scenarios:\s*\[\]/);
  assert.match(scenarios, /currentScenarioId: null/);
  assert.match(scenarios, /sharedValues: createEmptySharedValues\(fields\)/);
  assert.match(scenarios, /sharedEvidence: createSharedEvidence\(fields\)/);
  assert.match(scenarios, /scope: "shared"/);
  assert.match(page, /Home currency, future estimates, and amounts used in every plan/);
  assert.match(page, /Add each place, job, or plan/);
  assert.match(page, /Review monthly saving and assumptions/);
  assert.match(page, /one JSON file containing your home currency, future estimates, amounts used in every plan, current position, alternatives, assumptions, and sources/);
  assert.doesNotMatch(page, />Comparison model</);
  assert.doesNotMatch(page, />Manual or agent input</);
  assert.doesNotMatch(page, /same validated document contract/);

  // Manual option entry exposes one canonical local amount through linked,
  // clearly labelled option- and comparison-currency controls. Converted
  // values remain UI projections rather than a second stored field.
  assert.match(page, /function CurrencyAmountEditor/);
  assert.match(page, /Currency used in this place, job, or plan/);
  assert.match(page, /Home currency for all charts and totals/);
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

  // Stored currencies cannot be silently reinterpreted. Existing plan
  // currencies stay fixed, while changing the home currency has an
  // explicit backup-and-restart route.
  assert.match(page, /const optionCurrencyLocked = Boolean/);
  assert.match(page, /disabled=\{optionCurrencyLocked\}/);
  assert.match(page, /const comparisonCurrencyLocked = Boolean[\s\S]*Object\.values\(modelDraft\.sharedValues\)\.some[\s\S]*modelDraft\.excludedSupport\.some/);
  assert.match(page, /disabled=\{comparisonCurrencyLocked\}/);
  assert.match(page, /applies-to-every-plan or excluded-support amounts are entered/);
  assert.match(page, /Back up or start again with another currency/);
  assert.match(page, /setCurrencyRestartDraft\(cloneDocument\(modelDraft\)\); setModelDraft\(null\); setClearConfirm\(true\)/);
  assert.match(page, /const cancelClearDashboard = useCallback[\s\S]*setModelDraft\(currencyRestartDraft\)[\s\S]*setCurrencyRestartDraft\(null\)/);
  assert.match(page, /currencyRestartDraft \? syncDocumentFields\(currencyRestartDraft\) : plan/);
  assert.match(page, /Your open home-currency, future-estimate, and every-plan-amount edits are preserved here\. Cancel returns to them/);
  assert.match(page, /Download draft backup/);

  // Starter objects contain no fake identity or assumption facts. Required
  // identity fields are completed by the user; examples live in placeholders.
  assert.match(scenarios, /flag: "",[\s\S]*label: "",[\s\S]*location: "",[\s\S]*employment: "",[\s\S]*status: ""/);
  assert.doesNotMatch(scenarios, /City · country|Current household income|Income included in this option|Not assessed/);
  assert.match(page, /Place, job, or plan name[\s\S]*input required[^>]*placeholder="For example: Current household"/);
  assert.match(page, /Who earns income in this plan[\s\S]*input required[^>]*placeholder="State whose income is included in this monthly plan"/);
  assert.ok(page.indexOf("Who earns income in this plan") < page.indexOf("Card appearance"));
  assert.match(page, /Choose a card colour visually[\s\S]*type="color"[\s\S]*Exact card colour code[\s\S]*pattern="#\[0-9A-Fa-f\]\{6\}"/);
  assert.match(page, /Number of earners counted in this plan[\s\S]*required min="0" max="20"/);
  assert.match(page, /Currency conversion ratio[\s\S]*No conversion needed because this is the home currency for all charts and totals[\s\S]*1 \$\{editor\.currency \|\| "plan currency"\} = how many \$\{plan\.baseCurrency\}/);
  assert.match(page, /No conversion needed/);
  assert.match(page, /Optional currency reference date/);
  assert.match(page, /Optional currency note/);
  assert.match(page, /Conversion date checked · required/);
  assert.match(page, /Where this conversion figure came from · required/);
  assert.match(page, /const editorConversionReady = Boolean[\s\S]*hasUsableFxRate[\s\S]*Boolean\(editor\.fx\.asOf\)[\s\S]*editor\.fx\.source\.trim\(\)\.length > 0/);
  assert.match(page, /const editorAmountsReady = Boolean/);
  assert.match(page, /const editorPreview = editor && editorConversionReady && editorAmountsReady/);
  assert.match(page, /if \(!editorAmountsReady\) \{[\s\S]*Enter monthly gross income before tax and deductions, then enter or explicitly use 0 for every monthly item/);
  assert.match(page, /value\.trim\(\)\.length === 0[\s\S]*onChangeLocal\(null\)/);
  assert.match(page, /if \(amount === null\) next\.delete\(fieldId\)/);
  assert.match(page, /This place, job, or plan cannot be added until they are complete/);
  assert.match(page, /enteredScenarioAmounts/);
  assert.match(page, /enteredSharedAmounts/);
  assert.match(page, /Use 0 for \{blankSharedFields\.length\} blank monthly/);
  assert.match(page, /value=\{enteredSharedAmounts\.has\(field\.id\) \? modelDraft\.sharedValues\[field\.id\] \?\? 0 : ""\}/);
  assert.match(page, /Use 0 for \{blankFields\.length\} blank/);
  assert.match(page, /\$\{enteredFields\.length\} entered/);
  assert.match(page, /entered=\{enteredScenarioAmounts\.has\("grossMonthly"\)\}/);
  assert.match(page, /collapsible=\{fields\.length \+ sharedFields\.length >= LONG_EDITOR_SECTION_SIZE\}/);
  assert.match(page, /const preflight = validateWayfinderInput\(syncDocumentFields\(next\), \{[\s\S]*allowLegacyConversionGap[\s\S]*if \(!preflight\.ok\)[\s\S]*return;[\s\S]*commitPlan\(next/);
  assert.match(page, /legacyRepairScenarios/);
  assert.match(page, /Older saved plans need a conversion date/);
  assert.match(page, /isLegacyUndatedConversion\(plan, scenario\)[\s\S]*editableScenario\.fx\.source = ""/);
  assert.match(page, /const exportDocument = \(\) => \{[\s\S]*legacyRepairScenarios\.length > 0[\s\S]*Complete the older conversion details/);
  assert.match(page, /No reusable backup can be created yet/);
  assert.match(page, /disabled=\{legacyRepairScenarios\.length > 0\}[\s\S]*Reusable backup unavailable/);
  assert.match(page, /Remove without reusable backup/);
  assert.match(page, /Replace without reusable backup/);
  assert.match(page, /I reviewed the home currency for all charts and totals, number format, growth, inflation, and future-estimate years/);
  assert.match(page, /const freshStart =[\s\S]*plan\.updatedAt === DEFAULT_DOCUMENT\.updatedAt/);
  assert.match(page, /if \(freshStart\) \{[\s\S]*draft\.title = "";[\s\S]*draft\.baseCurrency = "";[\s\S]*draft\.locale = "";/);
  assert.match(page, /freshStart[\s\S]*incomeGrowthPct: "", expenseInflationPct: "", years: ""/);
  assert.match(page, /Annual income growth for the future estimate %[\s\S]*Enter your own assumption[\s\S]*value=\{projectionInputDraft\?\.incomeGrowthPct \?\? ""\}/);
  assert.match(page, /disabled=\{!\/\^\[A-Z\]\{3\}\$\/\.test\(modelDraft\.baseCurrency\)\}/);
  assert.match(page, /title: "", finding: ""/);
  assert.match(page, /const reclassifyModelField =/);
  assert.match(page, /What this monthly amount is for[\s\S]*field\.group[\s\S]*Where this monthly amount applies[\s\S]*field\.scope/);
  assert.match(page, /Enter once for every plan/);
  assert.match(page, /This item was not changed\. Set its amounts to zero and accuracy to Needs source first/);
  assert.match(page, /Remove this place, job, or plan from this browser\?[\s\S]*Download saved backup[\s\S]*Cancel[\s\S]*Confirm removal/);

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
  assert.match(page, /Monthly gross income before tax and deductions/);
  assert.match(page, /deductionMonthly \/ scenario\.grossMonthly \* 100/);
  assert.match(page, /className="tile-breakdown"/);
  assert.match(page, /Expand full calculation and sources/);
  assert.match(page, /Monthly investments \+ cash left = total saved or left/);
  assert.match(page, /The total saved or left each month is always split into monthly investments and cash left/);
  assert.match(page, /Gross income − tax and other non-saving deductions − automatic payroll saving = take-home cash/);
  assert.match(page, /Total saved or left = monthly investments \+ cash left after living costs and commitments/);
  assert.match(page, /function BreakdownGroup\(\{[\s\S]*?mode,[\s\S]*?mode: DisplayMode;/);
  assert.match(page, /<MoneyValue[\s\S]*?local=\{item\.localAmount\}[\s\S]*?base=\{item\.baseAmount\}[\s\S]*?mode=\{mode\}/);
  assert.equal(page.match(/<BreakdownGroup[^>]*mode=\{mode\}/g)?.length, 5);

  // Money output follows each currency's Intl-resolved minor units. Savings
  // components share one rounded parent/investment pair and derive displayed
  // cash from it without changing raw calculations, rankings, or bar widths.
  assert.match(moneyDisplay, /style: "currency"[\s\S]*resolvedOptions\(\)\.maximumFractionDigits/);
  assert.match(moneyDisplay, /minimumFractionDigits: 0,[\s\S]*maximumFractionDigits: fractionDigits/);
  assert.doesNotMatch(moneyDisplay, /\b(?:USD|JPY|KWD|INR|CAD|AED)\b/);
  assert.doesNotMatch(page, /function formatMoney\(/);
  assert.match(page, /const displayedSavings = balancedScenarioSavings\(scenario, plan\)[\s\S]*displayedSavings\.local\.total[\s\S]*displayedSavings\.local\.investments[\s\S]*displayedSavings\.local\.cash/);
  assert.match(page, /const displayedSavings = balancedScenarioSavings\(scenario, plan\)\.base[\s\S]*formatMoney\(displayedSavings\.total[\s\S]*formatMoney\(displayedSavings\.investments[\s\S]*formatMoney\(displayedSavings\.cash/);
  assert.match(page, /const editorPreviewSavings = editorPreview[\s\S]*editorPreviewSavings\.local\.total[\s\S]*editorPreviewSavings\.base\.investments[\s\S]*editorPreviewSavings\.local\.cash[\s\S]*editorPreviewSavings\.base\.cash/);
  assert.match(page, /\[displayed\.local\.total, displayed\.base\.total\][\s\S]*\[displayed\.local\.investments, displayed\.base\.investments\][\s\S]*\[displayed\.local\.cash, displayed\.base\.cash\]/);
  assert.match(page, /Cash shown is the balancing remainder after currency rounding; calculations retain full precision\./);
  assert.match(shareReport, /function moneyPair\([\s\S]*localAmount: number,[\s\S]*baseAmount: number/);
  assert.doesNotMatch(shareReport, /value \* finite\(scenario\.fx\.rateToBase\)/);
  assert.match(shareReport, /moneyPair\(displayedSavings\.local\.investments, displayedSavings\.base\.investments/);
  assert.match(shareReport, /moneyPair\(displayedSavings\.local\.cash, displayedSavings\.base\.cash/);

  // Tile actions must reopen the canonical stored scenario, not the derived
  // display object that also contains calculated fields rejected on save.
  assert.match(page, /const openScenarioEditor = \(id: string\)[\s\S]*plan\.scenarios\.find/);
  assert.match(page, /openScenarioEditor\(scenario\.id\)/);
  assert.match(page, /duplicateScenario\(scenario\.id\)/);

  // Exactly one saved plan is the current job and home-country position. The
  // first save establishes it, later plans preserve it, reassignment is
  // deliberate, and deleting the current plan requires an explicit replacement.
  assert.match(page, /currentScenarioId: firstScenarioSetup \? savedEditor\.id : plan\.currentScenarioId/);
  assert.match(page, /scenario\.id === plan\.currentScenarioId \? "Current job and home-country household position"/);
  assert.doesNotMatch(page, /scenario\.id === plan\.scenarios\[0\]\?\.id/);
  assert.match(page, /Current job and home-country position[\s\S]*modelDraft\.currentScenarioId/);
  assert.match(page, /const currentReplacementScenarios = editingCurrentScenario/);
  assert.match(page, /Choose which saved plan becomes your current job and home-country household position before removal/);
  assert.match(page, /Current job and home-country position after removal/);
  assert.match(page, /currentScenarioId: deletingCurrentScenario[\s\S]*replacement\?\.id \?\? null/);
  assert.match(page, /importCandidate\.document\.scenarios\.find\(\(scenario\) => scenario\.id === importCandidate\.document\.currentScenarioId\)/);
  assert.match(page, /Flag country code[\s\S]*minLength=\{2\} maxLength=\{2\} pattern="\[A-Z\]\{2\}"/);
  assert.match(page, /const requiresConversionRepair = snapshot\.document\.scenarios\.some/);
  assert.match(page, /Its first saved plan remains your current job and home-country position; review or change it in Home currency, future estimates, and amounts used in every plan/);
  assert.match(page, /Its first saved plan was selected as the current job and home-country position; you can change it after importing in Home currency, future estimates, and amounts used in every plan/);

  // Arbitrary valid v4 migration text remains available only as collapsed,
  // read-only context in the import preview and global settings. It cannot
  // become a current assumption, a calculation input, or family-report text.
  assert.match(page, /modelDraft\.legacyMigrationNotes\.length > 0/);
  assert.match(page, /importCandidate\.document\.legacyMigrationNotes\.length > 0/);
  assert.match(page, /title="Notes kept from an older file"/);
  assert.match(page, /These notes never affect calculations and are excluded from the family report/);
  assert.match(page, /legacyMigrationNotes: \[\]/);
  assert.match(page, /Remove all retained old notes/);
  assert.doesNotMatch(page, /plan\.legacyMigrationNotes/);

  // Five-year projections label both the selected monthly metric and its cumulative headline.
  assert.match(page, /const projectionMeta/);
  assert.match(page, /label: "Monthly gross income before deductions"/);
  assert.match(page, /cumulative: "cumulative total saved or left"/);
  assert.match(page, /Gross compensation less non-saving deductions and automatic payroll investments\./);
  assert.match(page, /Each bar shows one month; each headline adds twelve months for every displayed year/);

  // Users and agents can exchange an empty v5 template, a full editable document,
  // and a read-only family view; sources remain structured evidence, not fake scores.
  assert.match(page, /wayfinder-comparison-template\.v5\.json/);
  assert.match(page, /Download an empty comparison file/);
  assert.match(page, /Download saved comparison file/);
  assert.match(page, /Read-only family view downloaded/);
  assert.match(page, /createFamilyShareHtml\(plan\)/);
  assert.match(page, /Download family-readable summary/);
  assert.match(page, /Research and sources/);
  assert.doesNotMatch(page, /common fields|field definitions|Controlled from one place/);
  assert.match(page, /HTTPS source URL/);
  assert.match(page, /research notes never change money totals by themselves/);

  // A newly created per-plan field stays explicitly pending in the settings
  // dialog for every saved plan; default zero values never reach storage until
  // a person types a number or uses the per-plan Use 0 action.
  assert.match(page, /type PendingPerOptionAmounts = Record<string, Set<string>>/);
  assert.match(page, /const \[pendingPerOptionAmounts, setPendingPerOptionAmounts\]/);
  assert.match(page, /const updatePendingPerOptionAmount =/);
  assert.match(page, /const markPendingPerOptionAmountsAsZero =/);
  assert.match(page, /const pendingAmountCount = modelDraft\.fieldDefinitions\.reduce/);
  assert.match(page, /if \(pendingAmountCount > 0\)[\s\S]*Home currency, future estimates, and amounts used in every plan have not been saved/);
  assert.match(page, /scope === "perOption" && modelDraft\.scenarios\.length > 0/);
  assert.match(page, /pendingPerOptionAmounts\[field\.id\]\?\.has\(scenario\.id\)/);
  assert.match(page, /Use 0 for \{pendingForScenario\.length\} blank/);
  assert.match(page, /setPendingPerOptionAmounts\(\{\}\)/);
  assert.doesNotMatch(page, /modelDraft\.migrationNotes\.length/);

  // Public source remains portable and does not embed a contributor's absolute
  // Windows home or documents path. Product-specific private markers are checked
  // at the staged-tree publication gate rather than recorded in this repository.
  assert.doesNotMatch(publicSource, /[A-Z]:[\\/](?:Users|Documents)[\\/]/i);
});
