import { expect, test } from "@playwright/test";

test("availability cards show the lowest displayed nightly price first", async ({ page }) => {
  await page.route("**/api/guest-booking/availability?*", async (route) => {
    await route.fulfill({ json: {
      rooms: [
        { id: "2-Bunk", name: "Cheaper dorm", type: "Bed", capacity: 1, availableUnits: 4, rates: [{ id: 2, name: "Standard", nightlyRates: [{ date: "2030-01-10", rupees: 500 }, { date: "2030-01-11", rupees: 500 }], subtotalRupees: 1000 }] },
        { id: "1-Double", name: "Costlier double", type: "Double", capacity: 2, availableUnits: 1, rates: [{ id: 1, name: "Standard", nightlyRates: [{ date: "2030-01-10", rupees: 900 }, { date: "2030-01-11", rupees: 900 }], subtotalRupees: 1800 }] },
      ], taxPercent: 0, maxSelectedBeds: 4, nativeCheckoutReady: false, paymentOptions: { advancePercent: 0, allowFullPayment: false, allowPayAtProperty: true },
    } });
  });

  await page.goto("/book?checkinDate=2030-01-10&checkoutDate=2030-01-12", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Cheaper dorm")).toBeVisible();
  const names = await page.locator("article").evaluateAll(cards => cards.map(card => card.textContent?.match(/Cheaper dorm|Costlier double/)?.[0]).filter(Boolean));
  expect(names).toEqual(["Cheaper dorm", "Costlier double"]);
});
