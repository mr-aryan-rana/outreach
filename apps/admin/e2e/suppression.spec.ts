import { test, expect } from "@playwright/test";

test.describe("Suppression List", () => {
  test("adds and displays a new suppressed address", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;

    await page.goto("/suppression");
    await page.getByRole("button", { name: "Add address" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Add to suppression list" }).click();

    await expect(page.getByText("Address added to suppression list")).toBeVisible();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
  });

  test("rejects an invalid email", async ({ page }) => {
    await page.goto("/suppression");
    await page.getByRole("button", { name: "Add address" }).click();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Add to suppression list" }).click();

    await expect(page.getByText(/must be a valid email/i)).toBeVisible();
  });
});
