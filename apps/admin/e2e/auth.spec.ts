import { test, expect } from "@playwright/test";

const TEST_PASSWORD = "TestPassword123!"; // seeded test users, see scripts/seedAdmin.ts + Sprint 6 RC report

test.describe("Authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated visitors are redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong password is rejected", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@makeable.local");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("correct credentials log in and land on the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@makeable.local");
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("already-authenticated visitors hitting /login are redirected to /dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@makeable.local");
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("RBAC (readonly role)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("readonly@makeable.local");
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");
  });

  test("readonly can view pages but never sees a mutating action button", async ({ page }) => {
    await page.goto("/suppression");
    // The site header renders an <h1> page label and PageHeader renders its
    // own <h2> title with the same text -- target the <h2> specifically.
    await expect(page.getByRole("heading", { level: 2, name: "Suppression List" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add address" })).not.toBeVisible();

    await page.goto("/campaigns");
    await expect(page.getByRole("button", { name: "New Campaign" })).not.toBeVisible();
  });

  test("sidebar shows the readonly role badge", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator('[data-slot="badge"]', { hasText: "readonly" })).toBeVisible();
  });
});

test.describe("Sign out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signing out clears the session and redirects protected pages to /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@makeable.local");
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL("**/login");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
