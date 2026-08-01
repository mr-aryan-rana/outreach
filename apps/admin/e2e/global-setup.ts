import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Logs in once via the real UI form (not an API shortcut) and saves the
 * resulting session cookie so every other spec starts already authenticated
 * -- matches how a real user would reach these pages, and avoids
 * re-running the login flow (and re-hitting apps/email's rate limiter) once
 * per test file. auth.spec.ts explicitly overrides storageState to test the
 * unauthenticated/RBAC-denied paths themselves.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost:3002";
  const email = process.env.E2E_ADMIN_EMAIL ?? "admin@makeable.local";
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("E2E_ADMIN_PASSWORD must be set (matches ADMIN_SEED_PASSWORD used to seed the admin user)");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });

  const authDir = path.join(__dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: path.join(authDir, "admin.json") });

  await browser.close();
}
