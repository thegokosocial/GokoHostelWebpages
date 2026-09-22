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
  test("renders the public route set without server errors", async ({ page }) => {
    for (const route of publicRoutes) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} response`).toBeLessThan(400);
      await expect(page.locator("main"), `${route} main content`).toBeVisible();
    }
  });

  test("homepage story link reaches the story page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Our story", exact: true }).click();
    await expect(page).toHaveURL(/\/story(?:\?|$)/);
    await expect(page.locator("main")).toBeVisible();
  });
});
