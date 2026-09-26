import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/",
  "/stay",
  "/story",
  "/events",
  "/community-area",
  "/reviews",
  "/how-to-reach",
  "/things-to-do",
  "/faqs",
  "/booking-enquiry",
] as const;

test.describe("public website navigation", () => {
  // Ten marketing pages + hero video hydrate; keep above default 30s so goto is not aborted mid-flight.
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("renders the public route set without server errors", async ({ page }) => {
    // Hero loop videos can keep document `load` open for tens of seconds in CI; DOM is enough.
    for (const route of publicRoutes) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
      expect(response?.status(), `${route} response`).toBeLessThan(400);
      await expect(page.locator("main"), `${route} main content`).toBeVisible();
    }
  });

  test("homepage story link reaches the story page", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("link", { name: "Our story", exact: true }).click();
    await expect(page).toHaveURL(/\/story(?:\?|$)/);
    await expect(page.locator("main")).toBeVisible();
  });
});
