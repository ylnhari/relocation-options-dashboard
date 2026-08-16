#!/usr/bin/env node

import { open } from "node:fs/promises";
import { register } from "node:module";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

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

function displayPath(inputPath, absolutePath) {
  const relativePath = relative(process.cwd(), absolutePath);
  if (
    relativePath
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  ) {
    return relativePath.split(sep).join("/");
  }
  return basename(inputPath) || basename(absolutePath);
}

function output(payload, destination) {
  destination(JSON.stringify(payload, null, 2));
}

async function readBounded(handle) {
  const buffer = Buffer.allocUnsafe(MAX_DOCUMENT_BYTES + 1);
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.length - total,
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

const [filePath, ...extra] = process.argv.slice(2);

if (!filePath || extra.length) {
  output({ ok: false, issues: [{ path: "$", message: "Usage: node scripts/validate-data.mjs <document.json>" }] }, console.error);
  process.exitCode = 2;
} else {
  const absolutePath = resolve(filePath);
  const safePath = displayPath(filePath, absolutePath);
  try {
    const handle = await open(absolutePath, "r");
    try {
      const details = await handle.stat();
      if (!details.isFile()) {
        output({ ok: false, file: safePath, issues: [{ path: "$", message: "The supplied path is not a regular file." }] }, console.error);
        process.exitCode = 1;
      } else if (details.size > MAX_DOCUMENT_BYTES) {
        output({ ok: false, file: safePath, issues: [{ path: "$", message: "The supplied file is larger than the 2 MiB import limit." }] }, console.error);
        process.exitCode = 1;
      } else {
        const source = await readBounded(handle);
        if (source.length > MAX_DOCUMENT_BYTES) {
          output({ ok: false, file: safePath, issues: [{ path: "$", message: "The supplied file is larger than the 2 MiB import limit." }] }, console.error);
          process.exitCode = 1;
        } else {
          let value;
          try {
            value = JSON.parse(source.toString("utf8"));
          } catch (error) {
            output({ ok: false, file: safePath, issues: [{ path: "$", message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }] }, console.error);
            process.exitCode = 1;
          }

          if (process.exitCode !== 1) {
            const result = validateWayfinderInput(value);
            if (!result.ok) {
              output({ ok: false, file: safePath, issues: result.issues }, console.error);
              process.exitCode = 1;
            } else {
              output({ ok: true, file: safePath, schemaVersion: result.document.schemaVersion, migrated: result.migrated }, console.log);
            }
          }
        }
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? ` (${String(error.code)})`
      : "";
    output({ ok: false, file: safePath, issues: [{ path: "$", message: `Unable to read the supplied file${code}.` }] }, console.error);
    process.exitCode = 1;
  }
}
