import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanPublicCandidate } from "../scripts/check-public-safety.mjs";

function temporaryRepository(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wayfinder-public-safety-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Wayfinder test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fictional fixture"], { cwd: root });
  return root;
}

function withRepository(files, callback) {
  const root = temporaryRepository(files);
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts ordinary public documentation and localhost examples", () => {
  withRepository(
    {
      "README.md": "Use https://example.com/docs and http://localhost:8780 for local development.\n",
      ".gitignore": "/private-data/\n*.private.json\n",
      "app/example.ts": "export const port = 8780;\n",
    },
    (root) => {
      const result = scanPublicCandidate({ root });
      assert.deepEqual(result.findings, []);
    },
  );
});

test("does not flag its own rule source and treats an unavailable base ref as warning-only", () => {
  const source = readFileSync(new URL("../scripts/check-public-safety.mjs", import.meta.url), "utf8");
  withRepository({ "scripts/check-public-safety.mjs": source }, (root) => {
    const result = scanPublicCandidate({ root, baseRef: "missing-base-ref" });
    assert.deepEqual(result.findings, []);
    assert.equal(result.warnings.length, 1);
  });
});

test("reports tracked private artifacts, generated output, and sensitive content", () => {
  const userPath = ["C:", "\\", "Users", "\\", "fictional", "\\", "Desktop"].join("");
  const token = ["sk", "-", "fictional_token_value_1234567890"].join("");
  const tailnetAddress = ["100", "90", "58", "116"].join(".");
  const privatePath = [["private", "-data"].join(""), "household.json"].join("/");
  const runtimePath = [".local", ["runtime", "-seed"].join(""), "draft.json"].join("/");
  withRepository(
    {
      "notes.txt": `${userPath}\n${token}\nhttp://${tailnetAddress}:8780\n`,
      [privatePath]: "{}\n",
      [runtimePath]: "{}\n",
      "dist/app.js": "generated\n",
      "assets/app.js.map": "{}\n",
    },
    (root) => {
      const result = scanPublicCandidate({ root });
      assert.deepEqual(
        new Set(result.findings.map((finding) => finding.code)),
        new Set(["absolute-user-path", "credential-or-private-key", "private-network-reference", "private-runtime-artifact", "generated-artifact"]),
      );
    },
  );
});

test("reports a secret that was removed in an unpublished commit", () => {
  const root = temporaryRepository({ "README.md": "safe first commit\n" });
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const token = ["gh", "p_", "abcdefghijklmnopqrstuvwxyz1234567890"].join("");
    writeFileSync(path.join(root, "README.md"), `${token}\n`);
    const privateDirectory = path.join(root, ["private", "-data"].join(""));
    mkdirSync(privateDirectory, { recursive: true });
    writeFileSync(path.join(privateDirectory, "temporary.json"), "{}\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["add", privateDirectory], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "temporary mistake"], { cwd: root });
    writeFileSync(path.join(root, "README.md"), "removed from tip\n");
    rmSync(privateDirectory, { recursive: true });
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["add", "-u"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "remove temporary mistake"], { cwd: root });

    const result = scanPublicCandidate({ root, baseRef: base });
    assert.equal(result.findings.some((finding) => finding.code === "credential-or-private-key" && finding.commit), true);
    assert.equal(result.findings.some((finding) => finding.code === "private-runtime-artifact" && finding.commit), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scans exact staged blobs instead of newer working-tree contents", () => {
  const root = temporaryRepository({ "README.md": "safe committed content\n" });
  try {
    const token = ["gh", "p_", "stagedcandidateabcdefghijklmnopqrstuvwxyz1234"].join("");
    const readme = path.join(root, "README.md");

    writeFileSync(readme, `${token}\n`);
    execFileSync("git", ["add", "README.md"], { cwd: root });
    writeFileSync(readme, "safe unstaged replacement\n");

    const stagedUnsafe = scanPublicCandidate({ root });
    assert.equal(
      stagedUnsafe.findings.some((finding) => finding.code === "credential-or-private-key" && finding.path === "README.md"),
      true,
    );

    execFileSync("git", ["add", "README.md"], { cwd: root });
    writeFileSync(readme, `${token}\n`);

    const stagedSafe = scanPublicCandidate({ root });
    assert.deepEqual(stagedSafe.findings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts an ordinary staged binary larger than the child-process default buffer", () => {
  withRepository({
    "README.md": "safe documentation\n",
    "public/preview.png": Buffer.alloc(2 * 1024 * 1024, 0),
  }, (root) => {
    const result = scanPublicCandidate({ root });
    assert.deepEqual(result.findings, []);
    assert.equal(result.scannedFiles, 2);
  });
});

test("CI fetches commit history before scanning unpublished additions", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /uses:\s*actions\/checkout@v4\s+with:\s+fetch-depth:\s*0/);
  assert.match(workflow, /PUBLIC_SAFETY_BASE_REF:[^\n]+\n\s*run:\s*npm run check:public-safety/);
});
