import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const script = fileURLToPath(new URL("../scripts/validate-data.mjs", import.meta.url));
const scriptSourcePath = new URL("../scripts/validate-data.mjs", import.meta.url);
const examplePath = fileURLToPath(new URL("../examples/wayfinder.example.json", import.meta.url));

async function exampleDocument() {
  return JSON.parse(await readFile(examplePath, "utf8"));
}

async function writeTemporaryDocument(document) {
  const directory = await mkdtemp(join(tmpdir(), "wayfinder-cli-"));
  const path = join(directory, "agent-document.json");
  await writeFile(path, JSON.stringify(document), "utf8");
  return { directory, path };
}

async function writeTemporaryBytes(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "wayfinder-cli-"));
  const path = join(directory, "agent-document.json");
  await writeFile(path, bytes);
  return { directory, path };
}

test("CLI rejects a Draft 2020-12 violation before semantic validation", async () => {
  const document = await exampleDocument();
  // The semantic parser accepts this HTTPS-prefixed value; the schema's
  // conditional minimum length rejects it, proving the schema CLI stage runs.
  document.researchItems[0].sourceUrl = "https://";
  const temporary = await writeTemporaryDocument(document);

  try {
    await assert.rejects(
      execFile(process.execPath, [script, temporary.path]),
      (error) => {
        assert.equal(error.code, 1);
        const output = JSON.parse(error.stderr);
        assert.equal(output.ok, false);
        assert.equal(output.file, basename(temporary.path));
        assert.equal(JSON.stringify(output).includes(temporary.directory), false);
        assert.equal(JSON.stringify(output).includes(process.cwd()), false);
        assert.ok(output.issues.some((issue) => (
          issue.path.endsWith("sourceUrl")
          && issue.message.startsWith("Schema:")
        )));
        return true;
      },
    );
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
});

test("CLI JSON output never exposes the absolute input path", async () => {
  const temporary = await writeTemporaryDocument(await exampleDocument());

  try {
    const { stdout, stderr } = await execFile(process.execPath, [script, temporary.path]);
    assert.equal(stderr, "");
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.file, basename(temporary.path));
    assert.equal(JSON.stringify(output).includes(temporary.directory), false);
    assert.equal(JSON.stringify(output).includes(process.cwd()), false);
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
});

test("CLI retains supported legacy migration before schema validation", async () => {
  const legacy = {
    scenarios: [{
      id: "legacy-one",
      flag: "OLD",
      label: "Legacy illustration",
      location: "Old Example",
      employment: "Illustrative role",
      status: "Legacy",
      currency: "INR",
      fxToInr: 1,
      grossMonthly: 1000,
      netMonthly: 800,
      localLiving: 300,
      indiaCommitments: 100,
      investmentTarget: 200,
      earners: 1,
    }],
  };
  const temporary = await writeTemporaryDocument(legacy);

  try {
    const { stdout, stderr } = await execFile(process.execPath, [script, temporary.path]);
    assert.equal(stderr, "");
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.schemaVersion, 4);
    assert.equal(output.migrated, true);
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
});

test("CLI rejects an oversize file before parsing it", async () => {
  const temporary = await writeTemporaryBytes(Buffer.alloc((2 * 1024 * 1024) + 1, 0x20));

  try {
    await assert.rejects(
      execFile(process.execPath, [script, temporary.path]),
      (error) => {
        assert.equal(error.code, 1);
        const output = JSON.parse(error.stderr);
        assert.equal(output.ok, false);
        assert.equal(output.file, basename(temporary.path));
        assert.deepEqual(output.issues, [{
          path: "$",
          message: "The supplied file is larger than the 2 MiB import limit.",
        }]);
        assert.equal(JSON.stringify(output).includes(temporary.directory), false);
        return true;
      },
    );
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
});

test("CLI rejects directories before reading them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wayfinder-cli-"));

  try {
    await assert.rejects(
      execFile(process.execPath, [script, directory]),
      (error) => {
        assert.equal(error.code, 1);
        const output = JSON.parse(error.stderr);
        assert.equal(output.ok, false);
        assert.equal(output.file, basename(directory));
        assert.deepEqual(output.issues, [{
          path: "$",
          message: "The supplied path is not a regular file.",
        }]);
        assert.equal(JSON.stringify(output).includes(directory), false);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI reads a statted handle with a bounded buffer and closes it", async () => {
  const source = await readFile(scriptSourcePath, "utf8");

  assert.match(source, /const handle = await open\(absolutePath, "r"\);/);
  assert.match(source, /const details = await handle\.stat\(\);/);
  assert.match(source, /Buffer\.allocUnsafe\(MAX_DOCUMENT_BYTES \+ 1\)/);
  assert.match(source, /await handle\.read\(/);
  assert.match(source, /finally \{\s*await handle\.close\(\);\s*\}/);
  assert.doesNotMatch(source, /readFile\(absolutePath/);
});
