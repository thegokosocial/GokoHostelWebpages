import { expect, test } from "@playwright/test";

test.describe("Find my booking", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("submits reference and last name, then renders only the confirmation snapshot", async ({ page }) => {
    let requestBody: unknown;
    await page.route("**/api/guest-booking/lookup", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({ json: { booking: {
        reference: "EXT-42", checkinDate: "2026-10-01", checkoutDate: "2026-10-03", roomType: "Mixed Dorm",
      } } });
    });
    await page.goto("/book", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-booking-in-view="true"]')).toBeVisible();
    await page.getByRole("tab", { name: "Find my booking" }).click();
    await page.getByLabel("Confirmation number").fill("EXT-42");
    await page.getByLabel("Last name").fill("Lovelace");
    await page.getByRole("button", { name: "Find booking" }).click();

    await expect.poll(() => requestBody).toEqual({ reference: "EXT-42", lastName: "Lovelace" });
    await expect(page.getByText("Booking EXT-42")).toBeVisible();
    await expect(page.getByText("2026-10-01 – 2026-10-03")).toBeVisible();
    await expect(page.getByText("Room type: Mixed Dorm")).toBeVisible();
    await expect(page.getByText(/Payment:/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Manage booking" })).toHaveCount(0);
  });
});
