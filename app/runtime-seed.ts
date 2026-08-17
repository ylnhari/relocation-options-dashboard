import { syncDocumentFields } from "./document";
import { MAX_DOCUMENT_BYTES, validateWayfinderInput } from "./import-validator";
import type { WayfinderDocument } from "./scenarios";

declare const __WAYFINDER_RUNTIME_SEED__: string | undefined;

export type RuntimeSeedResult =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; document: WayfinderDocument };

/**
 * The launcher replaces this constant only for an explicitly seeded process.
 * `typeof` keeps ordinary SSR, tests, and public builds free of a seed value.
 */
function injectedSeedSource() {
  return typeof __WAYFINDER_RUNTIME_SEED__ === "string"
    ? __WAYFINDER_RUNTIME_SEED__
    : null;
}

export function parseRuntimeSeed(value = injectedSeedSource()): RuntimeSeedResult {
  if (value === null) return { status: "missing" };
  if (new TextEncoder().encode(value).byteLength > MAX_DOCUMENT_BYTES) {
    return { status: "invalid" };
  }
  try {
    const result = validateWayfinderInput(JSON.parse(value));
    // A runtime starter must already be a v5 document. Browser storage keeps
    // its existing supported legacy migration path separately.
    if (!result.ok || result.migrated) return { status: "invalid" };
    return { status: "valid", document: syncDocumentFields(result.document) };
  } catch {
    return { status: "invalid" };
  }
}

export function shouldApplyRuntimeSeed(
  browserStatus: "valid" | "empty" | "invalid" | "unavailable",
  seed: RuntimeSeedResult,
) {
  return seed.status === "valid"
    && (browserStatus === "empty" || browserStatus === "invalid");
}
