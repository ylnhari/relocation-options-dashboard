import vinext from "vinext";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const RUNTIME_SEED_ENABLED = process.env.WAYFINDER_RUNTIME_SEED_ENABLED === "1";
const RUNTIME_SEED_ID = process.env.WAYFINDER_RUNTIME_SEED_ID;
const RUNTIME_SEED_DIR = process.env.WAYFINDER_RUNTIME_SEED_DIR;
const RUNTIME_SEED_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_RUNTIME_SEED_BYTES = 2 * 1024 * 1024;

function runtimeSeedSource() {
  if (!RUNTIME_SEED_ENABLED) return undefined;
  if (!RUNTIME_SEED_ID || !RUNTIME_SEED_ID_PATTERN.test(RUNTIME_SEED_ID)) {
    throw new Error("Wayfinder runtime seed is missing a valid local artifact identifier.");
  }
  if (!RUNTIME_SEED_DIR || !isAbsolute(RUNTIME_SEED_DIR)) {
    throw new Error("Wayfinder runtime seed is missing a valid local artifact directory.");
  }
  // The portable launcher is the only supported writer. It passes a per-user
  // runtime directory and validates the exact bytes before enabling this child.
  const seedDirectory = resolve(RUNTIME_SEED_DIR);
  if (!statSync(seedDirectory).isDirectory()) {
    throw new Error("Wayfinder runtime seed directory is not available.");
  }
  const fromCheckout = relative(resolve(process.cwd()), seedDirectory);
  if (
    fromCheckout === ""
    || (!fromCheckout.startsWith(`..${sep}`) && fromCheckout !== ".." && !isAbsolute(fromCheckout))
  ) {
    throw new Error("Wayfinder runtime seed directory must be outside the checkout.");
  }
  const seedPath = resolve(seedDirectory, `wayfinder-runtime-seed-${RUNTIME_SEED_ID}.json`);
  if (dirname(seedPath) !== seedDirectory) {
    throw new Error("Wayfinder runtime seed artifact path is not valid.");
  }
  const handle = openSync(seedPath, "r");
  try {
    const details = fstatSync(handle);
    if (!details.isFile() || details.size > MAX_RUNTIME_SEED_BYTES) {
      throw new Error("Wayfinder runtime seed is not a bounded regular file.");
    }
    const bytes = Buffer.alloc(details.size);
    if (readSync(handle, bytes, 0, bytes.length, 0) !== details.size) {
      throw new Error("Wayfinder runtime seed could not be read completely.");
    }
    const finalDetails = fstatSync(handle);
    if (!finalDetails.isFile() || finalDetails.size !== details.size) {
      throw new Error("Wayfinder runtime seed changed while it was read.");
    }
    return bytes.toString("utf8");
  } finally {
    closeSync(handle);
  }
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  // Runtime starter data is for the explicit local dev launcher only. Even if
  // its control variables leak into a build/preview environment, never compile
  // the document into production assets.
  const seed = command === "serve" && mode === "development"
    ? runtimeSeedSource()
    : undefined;

  return {
    define: {
      __WAYFINDER_RUNTIME_SEED__: seed === undefined ? "undefined" : JSON.stringify(seed),
    },
    server: {
      host: "127.0.0.1",
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    preview: {
      host: "127.0.0.1",
      strictPort: true,
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
