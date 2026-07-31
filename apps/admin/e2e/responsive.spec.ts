import { test, expect } from "@playwright/test";

test.describe("Responsive layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile viewport shows the hamburger menu, not the full sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
    // The desktop sidebar is `<aside class="hidden md:flex ...">` -- scope to
    // it directly rather than the "Primary" nav landmark, which also exists
    // (kept mounted, just visually closed) inside the mobile Sheet.
    await expect(page.locator("aside")).toBeHidden();
  });

  test("mobile nav sheet opens and navigates", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("link", { name: "Campaigns" }).click();
    await expect(page).toHaveURL(/\/campaigns$/);
  });
});
