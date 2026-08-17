import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

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

const { parseRuntimeSeed, shouldApplyRuntimeSeed } = await import("../app/runtime-seed.ts");

async function exampleDocument() {
  return JSON.parse(
    await readFile(new URL("../examples/wayfinder.example.json", import.meta.url), "utf8"),
  );
}

test("runtime seeds accept only an already-valid v4 document", async () => {
  const document = await exampleDocument();
  const valid = parseRuntimeSeed(JSON.stringify(document));
  assert.equal(valid.status, "valid");
  if (valid.status === "valid") {
    assert.equal(valid.document.schemaVersion, 4);
    assert.deepEqual(valid.document.scenarios.map((scenario) => scenario.id), document.scenarios.map((scenario) => scenario.id));
  }

  assert.equal(parseRuntimeSeed("not JSON").status, "invalid");
  assert.equal(parseRuntimeSeed(JSON.stringify({ scenarios: [] })).status, "invalid");
});

test("valid browser data wins while empty or damaged browser storage selects the seed", async () => {
  const seed = parseRuntimeSeed(JSON.stringify(await exampleDocument()));
  assert.equal(shouldApplyRuntimeSeed("valid", seed), false);
  assert.equal(shouldApplyRuntimeSeed("empty", seed), true);
  assert.equal(shouldApplyRuntimeSeed("invalid", seed), true);
  assert.equal(shouldApplyRuntimeSeed("unavailable", seed), false);
  assert.equal(shouldApplyRuntimeSeed("empty", { status: "invalid" }), false);
});

test("damaged browser storage is recoverable before a runtime seed replaces it", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const applySeed = page.slice(
    page.indexOf("const applyRuntimeSeed"),
    page.indexOf("useEffect(() =>", page.indexOf("const applyRuntimeSeed")),
  );
  const clearDashboard = page.slice(
    page.indexOf("const clearDashboard"),
    page.indexOf("const downloadRecoveryCopy"),
  );

  assert.match(page, /const RECOVERY_STORAGE_KEY = "wayfinder\.recovery\.invalid-browser-draft\.v1"/);
  assert.match(page, /function saveInvalidBrowserRecovery\(\)[\s\S]*getItem\(STORAGE_KEY\)[\s\S]*getItem\(LEGACY_STORAGE_KEY\)/);
  assert.match(page, /new Blob\(\[currentRaw \?\? "", legacyRaw \?\? ""\]\)\.size > MAX_DOCUMENT_BYTES/);
  assert.match(page, /kind: "wayfinder-invalid-browser-recovery"[\s\S]*capturedAt:[\s\S]*current: currentRaw[\s\S]*legacy: legacyRaw/);
  assert.match(page, /new Blob\(\[serialized\]\)\.size > MAX_DOCUMENT_BYTES[\s\S]*setItem\(RECOVERY_STORAGE_KEY, serialized\)/);
  assert.match(applySeed, /latest\.status === "invalid"[\s\S]*saveInvalidBrowserRecovery\(\)/);
  assert.match(applySeed, /if \(!recovery\.ok\)[\s\S]*return "failed" as const/);
  assert.ok(
    applySeed.indexOf("saveInvalidBrowserRecovery()")
      < applySeed.indexOf("window.localStorage.setItem(STORAGE_KEY, serialized)"),
    "the bounded recovery copy must be saved before the seed replaces current storage",
  );

  assert.match(page, /const downloadRecoveryCopy = \(\) => \{[\s\S]*getItem\(RECOVERY_STORAGE_KEY\)[\s\S]*downloadText\(/);
  assert.match(page, /cannot be imported as a complete comparison/);
  assert.match(page, /may contain sensitive figures/);
  assert.match(page, /className="storage-notice-action"[\s\S]*Download unreadable-data copy/);
  assert.match(page, /\{\(storageNotice \|\| recoveryAvailable\) && \(/);
  assert.match(page, /storageNotice\?\.message \?\? "A raw copy of an earlier unreadable browser draft is available/);
  assert.match(page, /function inspectRecoveryCopy\(\)[\s\S]*getItem\(RECOVERY_STORAGE_KEY\)[\s\S]*MAX_DOCUMENT_BYTES/);
  assert.match(page, /const recovery = inspectRecoveryCopy\(\)[\s\S]*setRecoveryAvailable\(recovery\.status === "available"\)/);
  assert.match(page, /snapshot\.status === "valid"[\s\S]*recovery\.status === "available"[\s\S]*raw copy of an earlier unreadable browser draft is available/);
  assert.match(styles, /\.storage-notice\.seed/);
  assert.match(styles, /\.storage-notice-action[\s\S]*min-height: 44px/);

  assert.match(clearDashboard, /getItem\(RECOVERY_STORAGE_KEY\)/);
  assert.match(clearDashboard, /removeItem\(RECOVERY_STORAGE_KEY\)[\s\S]*removeItem\(LEGACY_STORAGE_KEY\)[\s\S]*removeItem\(STORAGE_KEY\)/);
  assert.match(clearDashboard, /recoveryRaw === null[\s\S]*removeItem\(RECOVERY_STORAGE_KEY\)[\s\S]*setItem\(RECOVERY_STORAGE_KEY, recoveryRaw\)/);
  assert.match(clearDashboard, /setRecoveryAvailable\(false\)/);
});

test("runtime-seed source keeps an ordinary public build seed-free", async () => {
  const source = await readFile(new URL("../app/runtime-seed.ts", import.meta.url), "utf8");

  assert.match(source, /typeof __WAYFINDER_RUNTIME_SEED__ === "string"/);
  assert.match(source, /return \{ status: "missing" \}/);
  assert.doesNotMatch(source, /private-data|[A-Z]:[\\/](?:Users|Documents)[\\/]/i);
});
