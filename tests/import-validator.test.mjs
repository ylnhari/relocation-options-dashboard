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

const { MAX_DOCUMENT_BYTES, validateWayfinderInput } = await import("../app/import-validator.ts");
const { default: generatedSchemaValidator } = await import("../app/wayfinder-schema-validator.generated.mjs");
const { default: generatedV4SchemaValidator } = await import("../app/wayfinder-v4-schema-validator.generated.mjs");

async function exampleDocument() {
  return JSON.parse(
    await readFile(new URL("../examples/wayfinder.example.json", import.meta.url), "utf8"),
  );
}

test("shared import validator rejects schema-only invalid HTTPS URLs", async () => {
  const document = await exampleDocument();
  document.researchItems[0].sourceUrl = "https://";

  assert.equal(generatedSchemaValidator(document), false);
  const result = validateWayfinderInput(document);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => (
    issue.path.endsWith("sourceUrl")
    && issue.message.startsWith("Schema:")
  )));
});

test("shared import validator rejects caller-authored migration notes", async () => {
  const document = await exampleDocument();
  document.migrationNotes = ["An agent supplied this as a migration note."];

  assert.equal(generatedSchemaValidator(document), false);
  const result = validateWayfinderInput(document);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.message.startsWith("Schema:")));
});

test("recognized v4 input is closed-schema validated before lossless migration to v5", async () => {
  const v4 = await exampleDocument();
  v4.schemaVersion = 4;
  delete v4.currentScenarioId;
  delete v4.legacyMigrationNotes;
  v4.migrationNotes = ["Historical v4 note retained without rewriting."];
  const original = structuredClone(v4);

  assert.equal(generatedV4SchemaValidator(v4), true);
  const result = validateWayfinderInput(v4);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.document.schemaVersion, 5);
  assert.equal(result.document.currentScenarioId, "fictional-base-city");
  const {
    schemaVersion: oldVersion,
    migrationNotes: oldMigrationNotes,
    ...oldFields
  } = original;
  const {
    schemaVersion: newVersion,
    currentScenarioId,
    migrationNotes: newMigrationNotes,
    legacyMigrationNotes,
    ...newFields
  } = result.document;
  assert.equal(oldVersion, 4);
  assert.equal(newVersion, 5);
  assert.equal(currentScenarioId, "fictional-base-city");
  assert.deepEqual(legacyMigrationNotes, oldMigrationNotes);
  assert.deepEqual(newMigrationNotes, [
    "Migration notes from a v4 file were retained for review.",
  ]);
  assert.deepEqual(newFields, oldFields);

  const withUnknownField = structuredClone(v4);
  withUnknownField.discardedByOldImporter = true;
  assert.equal(generatedV4SchemaValidator(withUnknownField), false);
  const rejected = validateWayfinderInput(withUnknownField);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.issues.some((issue) => (
    issue.path === "$.discardedByOldImporter"
    && issue.message.startsWith("Schema:")
  )));
});

test("the v5 generated schema requires a two-letter uppercase country code", async () => {
  const document = await exampleDocument();
  document.scenarios[0].flag = "USA";

  assert.equal(generatedSchemaValidator(document), false);
  const result = validateWayfinderInput(document);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.path.endsWith(".flag") && issue.message.startsWith("Schema:")));
});

test("shared import validator exposes the 2 MiB boundary", () => {
  assert.equal(MAX_DOCUMENT_BYTES, 2 * 1024 * 1024);
});

test("runtime import boundary does not compile schemas dynamically", async () => {
  const source = await readFile(
    new URL("../app/import-validator.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /wayfinder-schema-validator\.generated\.mjs/);
  assert.doesNotMatch(source, /from "ajv/);
  assert.doesNotMatch(source, /new Ajv/);
  assert.doesNotMatch(source, /\.compile\(/);
  assert.doesNotMatch(source, /new Function/);
});

test("generated validator is static and preserves Unicode code-point lengths", async () => {
  const source = await readFile(
    new URL("../app/wayfinder-schema-validator.generated.mjs", import.meta.url),
    "utf8",
  );
  const document = await exampleDocument();
  document.title = "😀".repeat(160);

  assert.doesNotMatch(source, /require\(/);
  assert.doesNotMatch(source, /ajv\/dist\/runtime/);
  assert.doesNotMatch(source, /new Function/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.equal(generatedSchemaValidator(document), true);
  document.title += "😀";
  assert.equal(generatedSchemaValidator(document), false);
});
