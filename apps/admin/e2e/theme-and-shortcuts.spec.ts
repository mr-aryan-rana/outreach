import { test, expect } from "@playwright/test";

test.describe("Theme toggle", () => {
  test("toggling theme adds/removes the dark class on <html>", async ({ page }) => {
    await page.goto("/dashboard");
    const html = page.locator("html");

    const initialHasDark = (await html.getAttribute("class"))?.includes("dark") ?? false;
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(html).toHaveClass(initialHasDark ? /^(?!.*dark).*$/ : /dark/);
  });
});

test.describe("Command palette", () => {
  test("Ctrl/Cmd+K opens the command palette and navigates", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByPlaceholder("Type a page name...")).toBeVisible();

    await page.getByRole("option", { name: "Queue" }).click();
    await expect(page).toHaveURL(/\/queue$/);
  });

  test("Search button in header also opens the command palette", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByPlaceholder("Type a page name...")).toBeVisible();
  });
});

test.describe("'g' then letter navigation shortcut", () => {
  test("g then c navigates to Creators", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("body").click(); // ensure focus isn't in an input
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/creators$/);
  });
});
