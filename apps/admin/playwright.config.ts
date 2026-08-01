import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Serialized, not parallel: every test hits the real, shared,
  // Upstash-backed rate-limit middleware on apps/email through this app's
  // own proxy. High worker parallelism was measured (this sprint) to push
  // Redis command latency high enough to time out requests entirely
  // ("rate_limit_store_error: Command timed out" in apps/email's logs) --
  // a property of the shared dev Redis instance under concurrent load, not
  // a defect in the pages under test.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  timeout: 45_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
    trace: "on-first-retry",
    // Pre-authenticated as the seeded admin user (see global-setup.ts) --
    // auth.spec.ts overrides this per-test to exercise the unauthenticated
    // and non-admin-role paths specifically.
    storageState: "./e2e/.auth/admin.json",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Assumes `npm run dev` (or the real backend/ai/email services + this app)
  // is already running -- see docs/TESTING.md "apps/admin E2E" for why this
  // isn't auto-started: it depends on 3 other live services with real (or
  // mock-provider) data, not something Playwright's webServer option can
  // stand up on its own.
});
