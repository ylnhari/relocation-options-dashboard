#!/usr/bin/env node

/**
 * A deliberately small, dependency-free last line of defence before a public
 * release. It scans only Git-tracked candidate files. It is not a secret
 * manager or a replacement for review.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

const privateNetworkName = ["tail", "net"].join("");
const privateVpnName = ["tail", "scale"].join("");
const privateGatewayName = ["ro", "ver"].join("");
const privateDocumentPath = ["private", "-data"].join("");
const runtimeArtifactName = ["runtime", "-seed"].join("");

function git(root, args, { allowFailure = false, encoding = "utf8" } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFailure) return null;
    const details = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${details}`);
  }
}

function trackedPaths(root) {
  return git(root, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

function isText(buffer) {
  return !buffer.subarray(0, 8192).includes(0);
}

function publicPath(relativePath) {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isGeneratedArtifact(relativePath) {
  const lower = publicPath(relativePath).toLowerCase();
  return (
    lower.endsWith(".map") ||
    /(^|\/)(dist|out|\.next|\.vinext|\.wrangler|coverage|playwright-report|test-results)(\/|$)/.test(lower)
  );
}

function isPrivateRuntimeArtifact(relativePath) {
  const lower = publicPath(relativePath).toLowerCase();
  const segments = lower.split("/");
  const fileName = segments.at(-1) || "";
  return (
    segments.includes(privateDocumentPath) ||
    lower.endsWith(".private.json") ||
    (segments.includes(".local") && fileName.includes(runtimeArtifactName))
  );
}

function hasTailnetAddress(value) {
  const addresses = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return addresses.some((address) => {
    const octets = address.split(".").map(Number);
    return octets.every((octet) => octet <= 255) && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
  });
}

function contentFindings(content) {
  const findings = [];
  const windowsUserPath = new RegExp("(?:[A-Za-z]:[\\\\/]|%USERPROFILE%[\\\\/])(?:Users|AppData)[\\\\/]", "i");
  const unixUserPath = /\/(?:Users|home)\/[^/\s]+/;
  const privateKey = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;
  const obviousToken = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AIza[\w-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/;
  const assignedSecret = /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b\s*[:=]\s*["'`][^"'`\r\n]{12,}["'`]/i;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (windowsUserPath.test(line) || unixUserPath.test(line)) {
      findings.push({ code: "absolute-user-path", line: lineNumber });
    }
    if (privateKey.test(line) || obviousToken.test(line) || assignedSecret.test(line)) {
      findings.push({ code: "credential-or-private-key", line: lineNumber });
    }
    if (hasTailnetAddress(line) || new RegExp(`\\b(?:${privateNetworkName}|${privateVpnName}|${privateGatewayName})\\b`, "i").test(line)) {
      findings.push({ code: "private-network-reference", line: lineNumber });
    }
  }
  return findings;
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.path}:${finding.line ?? ""}:${finding.code}:${finding.commit ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveBaseRef(root, requestedBase) {
  if (requestedBase && !/^0+$/.test(requestedBase)) {
    return git(root, ["rev-parse", "--verify", `${requestedBase}^{commit}`], { allowFailure: true })?.trim() || null;
  }
  const remoteMain = git(root, ["rev-parse", "--verify", "origin/main^{commit}"], { allowFailure: true })?.trim();
  if (!remoteMain) return null;
  const isAncestor = git(root, ["merge-base", "--is-ancestor", remoteMain, "HEAD"], { allowFailure: true });
  return isAncestor === "" ? remoteMain : null;
}

function historicalChanges(root, baseRef) {
  if (!baseRef) return { additions: [], paths: [] };
  const commits = git(root, ["rev-list", "--reverse", `${baseRef}..HEAD`]).trim().split(/\r?\n/).filter(Boolean);
  const additions = [];
  const paths = [];
  for (const commit of commits) {
    const patch = git(root, ["show", "--format=", "--unified=0", "--no-ext-diff", commit]);
    let currentPath = null;
    for (const line of patch.split(/\r?\n/)) {
      if (line.startsWith("+++ b/")) {
        currentPath = line.slice(6);
        paths.push({ path: currentPath, commit });
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions.push({ path: currentPath || "<unknown>", content: line.slice(1), commit });
      }
    }
  }
  return { additions, paths };
}

/**
 * Scan a Git candidate tree. Exported so tests can use isolated fictional
 * temporary repositories without inspecting a caller's local data.
 */
export function scanPublicCandidate({ root = DEFAULT_ROOT, baseRef = process.env.PUBLIC_SAFETY_BASE_REF } = {}) {
  const findings = [];
  const warnings = [];
  const paths = trackedPaths(root);

  for (const relativePath of paths) {
    if (isGeneratedArtifact(relativePath)) {
      findings.push({ path: relativePath, code: "generated-artifact" });
    }
    if (isPrivateRuntimeArtifact(relativePath)) {
      findings.push({ path: relativePath, code: "private-runtime-artifact" });
    }

    // Read the index blob, not the working-tree file. A public release check
    // must inspect exactly what `git commit` would record, even when a staged
    // file has newer unstaged edits.
    const bytes = git(root, ["show", `:${relativePath}`], { encoding: null });
    if (!isText(bytes)) continue;
    for (const finding of contentFindings(bytes.toString("utf8"))) {
      findings.push({ path: relativePath, ...finding });
    }
  }

  const resolvedBase = resolveBaseRef(root, baseRef);
  if (baseRef && !resolvedBase) {
    warnings.push(`Could not resolve PUBLIC_SAFETY_BASE_REF '${baseRef}'; scanned the current staged candidate only.`);
  }
  const history = historicalChanges(root, resolvedBase);
  for (const entry of history.paths) {
    if (isGeneratedArtifact(entry.path)) {
      findings.push({ path: entry.path, code: "generated-artifact", commit: entry.commit });
    }
    if (isPrivateRuntimeArtifact(entry.path)) {
      findings.push({ path: entry.path, code: "private-runtime-artifact", commit: entry.commit });
    }
  }
  for (const addition of history.additions) {
    for (const finding of contentFindings(addition.content)) {
      findings.push({ path: addition.path, ...finding, commit: addition.commit });
    }
  }

  return { findings: uniqueFindings(findings), warnings, scannedFiles: paths.length, baseRef: resolvedBase };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.root = path.resolve(argv[++index]);
    if (argv[index] === "--base") options.baseRef = argv[++index];
  }
  return options;
}

function formatFinding(finding) {
  const location = finding.line ? `:${finding.line}` : "";
  const history = finding.commit ? ` (unpublished commit ${finding.commit.slice(0, 12)})` : "";
  return `${finding.path}${location}: ${finding.code}${history}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanPublicCandidate(parseArguments(process.argv.slice(2)));
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (result.findings.length) {
    console.error("Public candidate safety check failed:");
    for (const finding of result.findings) console.error(`  - ${formatFinding(finding)}`);
    process.exitCode = 1;
  } else {
    console.log(`Public candidate safety check passed (${result.scannedFiles} staged files scanned).`);
  }
}
