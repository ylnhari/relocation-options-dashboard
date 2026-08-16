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
