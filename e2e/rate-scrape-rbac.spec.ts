import { expect, test } from "@playwright/test";

test("Management viewers can read saved rates but cannot scrape", async ({ page }) => {
  const rateActions: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role: "staff", username: "rates-viewer", permissions: { canViewManagement: true } } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (url.pathname === "/api/admin/checkins") {
      const body = JSON.parse(route.request().postData() || "{}") as { action?: string };
      if (body.action) rateActions.push(body.action);
      if (body.action === "auth") {
        await route.fulfill({ json: { role: "staff", permissions: { canViewManagement: true } } });
        return;
      }
      if (body.action === "getLatestRateScrape") {
        await route.fulfill({ json: { scrape: {
          id: 7, city: "Gokarna", startDate: "2026-10-08", endDate: "2026-10-09", propertyType: "hostels",
          status: "done", createdAt: "2026-10-08T12:00:00.000Z", completedAt: "2026-10-08T12:10:00.000Z",
          results: JSON.stringify({ version: 2, properties: [{ property: "Goko Hostel", rating: null, prices: { "2026-10-08": 900 } }], failedDates: [] }),
        } } });
        return;
      }
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin?section=management&tab=rates");
  await page.locator("#admin-user").fill("rates-viewer");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("heading", { name: "Check Rates" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Goko Hostel(You)" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Scrape|Retry|New Scrape/ })).toHaveCount(0);
  await expect.poll(() => rateActions).toContain("getLatestRateScrape");
  expect(rateActions).not.toContain("startRateScrape");
});
