import { expect, test, type Page, type Route } from "@playwright/test";

const UNDERAGE_YEAR = new Date().getFullYear() - 17;
const RECORD = [
  "2026-10-09T12:00:00.000Z", "2026-10-09", "12:00", "Asha Guest", "2", "9876543210", "3", "Mumbai", "India", "Riya Guest", "9876543211", "Walk-in", "", "aadhaar", "https://drive.example/id", "", "pending", "42", "active", "", "01/01/2000", "0", `01/01/${UNDERAGE_YEAR}`,
];
const DASHBOARD_CHECKIN = { row: ["", "2026-10-09", "12:00", "Asha Guest", "2", "9876543210", "3", "Mumbai", "India", "", "", "", "", "", "name_review", "42"], assignedBed: null, linkedBookingId: null, dob: "", dobFromId: "", vibeMatched: 0 };

async function mockRecords(page: Page, { verified = "pending", bookingResolution = "pending" }: { verified?: string; bookingResolution?: string } = {}) {
  let currentBookingResolution = bookingResolution;
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") return route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, json: { authenticated: false } });
    if (url.pathname === "/api/auth/logout") return route.fulfill({ json: { success: true } });
    if (url.pathname !== "/api/admin/checkins") return route.fulfill({ json: {} });
    const body = JSON.parse(route.request().postData() || "{}") as { action?: string; key?: string };
    if (body.action === "getDashboard") return route.fulfill({ json: { todayCheckins: [DASHBOARD_CHECKIN] } });
    if (body.action === "list") return route.fulfill({ json: { rows: [[...RECORD.slice(0, 16), verified, ...RECORD.slice(17)]], tabs: ["OCTOBER-2026"], currentTab: "OCTOBER-2026", bookingResolutions: { "42": { state: currentBookingResolution } } } });
    if (body.action === "getSetting") return route.fulfill({ json: { value: body.key === "show_dob_in_records" ? "false" : "" } });
    if (body.action === "auth") return route.fulfill({ json: { role: "admin", permissions: {} } });
    if (body.action === "markCheckinNoBookingNeeded") { currentBookingResolution = "no_booking_needed"; return route.fulfill({ json: { success: true } }); }
    return route.fulfill({ json: { success: true } });
  });
}

async function signIn(page: Page, width = 1280, section = "records") {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(section === "dashboard" ? "/admin" : `/admin?section=${section}`);
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Asha Guest").first()).toBeVisible({ timeout: 15_000 });
}

test("dashboard check-in opens the matching Records details dialog", async ({ page }) => {
  await mockRecords(page);
  await signIn(page, 1280, "dashboard");
  await page.getByRole("button", { name: "View details for Asha Guest" }).click();
  await expect(page).toHaveURL(/section=records/);
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeVisible();
});

test("record details open from desktop row and keep document links separate", async ({ page }) => {
  await mockRecords(page);
  await signIn(page);
  await page.getByRole("button", { name: "Asha Guest" }).click();
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeVisible();
  await expect(page.getByText("Stay details")).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Underage (17)")).toBeVisible();
  await expect(dialog.getByText("DOB mismatch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Manual ID Verification" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeHidden();
  await page.getByRole("button", { name: "Close verification" }).click();
  await page.getByRole("button", { name: "Asha Guest" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit check-in" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeHidden();
});

test("record booking link replaces the details dialog", async ({ page }) => {
  await mockRecords(page);
  await signIn(page);
  await page.getByRole("button", { name: "Asha Guest" }).click();
  await page.getByRole("button", { name: "Link existing" }).click();
  await expect(page.getByRole("heading", { name: "Link existing booking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeHidden();
});

test("record cards open the same details dialog on mobile", async ({ page }) => {
  await mockRecords(page);
  await signIn(page, 390);
  await page.getByRole("button", { name: "View details for Asha Guest" }).click();
  await expect(page.getByRole("heading", { name: "Asha Guest" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ID card/i })).toHaveAttribute("target", "_blank");
});

test("Vibe OK resolves identity warnings without resolving the booking warning", async ({ page }) => {
  await mockRecords(page, { verified: "name_review" });
  await signIn(page);
  await expect(page.getByText("Name check", { exact: true })).toBeVisible();
  await expect(page.getByText("No booking linked", { exact: true })).toBeVisible();
  const vibeRequest = page.waitForRequest((request) => request.url().includes("/api/admin/checkins") && Boolean(request.postData()?.includes('"action":"markVibeMatched"')));
  await page.getByRole("button", { name: "Vibe?" }).click();
  await vibeRequest;
  await expect(page.getByText("Name check OK", { exact: true })).toBeVisible();
  await expect(page.getByText("Name check", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No booking linked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Asha Guest" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Verified", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Name check OK", { exact: true })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "No booking needed" }).click();
  await expect(page.getByText("No booking linked", { exact: true })).toHaveCount(0);
});

test("dashboard changes a Vibe-approved name review into verified evidence", async ({ page }) => {
  await mockRecords(page);
  await signIn(page, 1280, "dashboard");
  await expect(page.getByText("Name check", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vibe OK" }).click();
  await expect(page.getByText("ID verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Name check OK", { exact: true })).toBeVisible();
  await expect(page.getByText("Name check", { exact: true })).toHaveCount(0);
});
