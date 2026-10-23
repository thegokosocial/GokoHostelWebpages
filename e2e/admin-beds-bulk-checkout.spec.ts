import { expect, test, type Page } from "@playwright/test";

async function mockBeds(page: Page, requests: Array<Record<string, unknown>>) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") return route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, json: { authenticated: false } });
    if (!url.pathname.startsWith("/api/admin/")) return route.fulfill({ json: {} });
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    requests.push(body);
    if (body.action === "auth") return route.fulfill({ json: { role: "admin", permissions: {} } });
    if (body.action === "getBeds") return route.fulfill({ json: {
      beds: [],
      unassigned: [["", "2026-10-20", "", "Past guest", "1", "9000000000", "1", "Bengaluru", "India", "", "", "", "", "", "", "55", ""]],
      linkedBookingDetails: {},
      unassignedCheckoutEligibility: { "55": { eligible: true, checkoutDate: "2026-10-21", roomDue: 0, foodDue: 0 } },
    } });
    if (body.action === "bulkCheckoutGuests") return route.fulfill({ json: { success: true, checkedOutIds: [55], skipped: [] } });
    return route.fulfill({ json: {} });
  });
}

async function signIn(page: Page) {
  await page.goto("/admin?section=beds");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: "Bed Management" })).toBeVisible();
}

test("desktop bulk checkout submits selected visible guests", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await mockBeds(page, requests);
  await signIn(page);
  await page.getByRole("checkbox", { name: "Select Past guest for checkout" }).check();
  await page.getByRole("button", { name: "Checkout selected" }).click();
  await page.getByRole("button", { name: "Checkout 1 guest" }).click();
  await expect(page.getByText("1 guest checked out")).toBeVisible();
  expect(requests.find((request) => request.action === "bulkCheckoutGuests")).toMatchObject({ scope: "selected", checkinIds: [55] });
});

test("mobile bulk checkout submits all eligible displayed guests", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: Array<Record<string, unknown>> = [];
  await mockBeds(page, requests);
  await signIn(page);
  await page.getByRole("button", { name: "Checkout all eligible" }).click();
  await page.getByRole("button", { name: "Checkout 1 guest" }).click();
  expect(requests.find((request) => request.action === "bulkCheckoutGuests")).toMatchObject({ scope: "displayed", checkinIds: [55] });
});
