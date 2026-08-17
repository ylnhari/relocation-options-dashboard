import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.WAYFINDER_E2E_PORT ?? "8792");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("WAYFINDER_E2E_PORT must be an integer from 1 to 65535.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 240_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    browserName: "chromium",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
