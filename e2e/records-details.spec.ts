import { expect, test, type Page, type Route } from "@playwright/test";

const RECORD = [
  "2026-10-09T12:00:00.000Z", "2026-10-09", "12:00", "Asha Guest", "2", "9876543210", "3", "Mumbai", "India", "Riya Guest", "9876543211", "Walk-in", "", "aadhaar", "https://drive.example/id", "", "pending", "42", "active", "", "", "", "",
];

async function mockRecords(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") return route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, json: { authenticated: false } });
    if (url.pathname === "/api/auth/logout") return route.fulfill({ json: { success: true } });
    if (url.pathname !== "/api/admin/checkins") return route.fulfill({ json: {} });
    const body = JSON.parse(route.request().postData() || "{}") as { action?: string; key?: string };
    if (body.action === "list") return route.fulfill({ json: { rows: [RECORD], tabs: ["OCTOBER-2026"], currentTab: "OCTOBER-2026" } });
    if (body.action === "getSetting") return route.fulfill({ json: { value: body.key === "show_dob_in_records" ? "false" : "" } });
    if (body.action === "auth") return route.fulfill({ json: { role: "admin", permissions: {} } });
    return route.fulfill({ json: { success: true } });
  });
}

async function signIn(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin?section=records");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Asha Guest").first()).toBeVisible({ timeout: 15_000 });
}

test("record details open from desktop row and keep document links separate", async ({ page }) => {
  await mockRecords(page);
  await signIn(page);
  await page.getByRole("button", { name: "Asha Guest" }).click();
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeVisible();
  await expect(page.getByText("Stay details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit check-in" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeHidden();
});

test("record cards open the same details dialog on mobile", async ({ page }) => {
  await mockRecords(page);
  await signIn(page, 390);
  await page.getByRole("button", { name: "View details for Asha Guest" }).click();
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ID card/i })).toHaveAttribute("target", "_blank");
});
