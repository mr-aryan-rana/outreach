import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/dashboard", heading: "Dashboard" },
  { path: "/creators", heading: "Creators" },
  { path: "/drafts", heading: "AI Draft Review" },
  { path: "/campaigns", heading: "Campaigns" },
  { path: "/queue", heading: "Queue" },
  { path: "/email-events", heading: "Email Events" },
  { path: "/suppression", heading: "Suppression List" },
  { path: "/sender-profiles", heading: "Sender Profiles" },
  { path: "/analytics", heading: "Analytics" },
  { path: "/settings", heading: "Settings" },
];

test.describe("Navigation", () => {
  for (const { path, heading } of PAGES) {
    test(`${path} loads and shows its heading`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
    });
  }

  test("root path redirects to /dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("sidebar links navigate between pages", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Creators" }).click();
    await expect(page).toHaveURL(/\/creators$/);
    await expect(page.getByRole("heading", { name: "Creators", level: 2 })).toBeVisible();
  });

  test("does not throw an uncaught console error on the dashboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});
