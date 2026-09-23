import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS } from "../src/lib/websiteBookingSettings";

async function mockAdminApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (url.pathname === "/api/auth/logout") {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (!url.pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const rawBody = route.request().postData();
    const body = rawBody ? JSON.parse(rawBody) as { action?: string } : {};
    const response = body.action === "auth"
      ? { role: "admin", permissions: {} }
      : url.pathname === "/api/admin/booking-settings" && body.action === "getSettings"
        ? { settings: DEFAULT_WEBSITE_BOOKING_SETTINGS, revision: "e2e" }
      : url.pathname === "/api/admin/booking-payments" && body.action === "listTestAttempts"
        ? { attempts: [], webhooks: [], previewEnabled: false, nativeCheckoutReady: false }
      : body.action === "getAuditRetention"
        ? { years: 3, months: 0, totalMonths: 36, cutoff: "2023-01-01", eligible: { auditLog: 0, bookingHistory: 0, attendanceHistory: 0, total: 0 } }
      : body.action === "getBedHistory"
        ? { rows: [] }
        : body.action === "getUsers"
          ? { users: [] }
          : body.action === "getFoodSettings"
            ? { settings: {} }
            : {};

    await route.fulfill({ json: response });
  });
}

async function mockFoodOrderWorkflow(page: Page, requests: Array<Record<string, unknown>>) {
  await page.route("**/api/admin/food-orders", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    requests.push(body);
    const action = body.action;
    const order = {
      id: 10,
      orderNumber: "D265-10",
      guestType: "walkin",
      checkinId: null,
      guestName: "Pawan test",
      guestPhone: "123454321",
      roomInfo: "",
      specialInstructions: "",
      subtotal: 400,
      tax: 0,
      total: 400,
      amountPaid: 0,
      amountRefunded: 0,
      status: "served",
      paymentStatus: "pending",
      paymentMethod: "",
      paidBy: "",
      cashReceived: 0,
      changeGiven: 0,
      discount: 0,
      discountReason: "",
      discountBy: "",
      cancelledReason: "",
      createdBy: "admin",
      createdAt: "2026-09-23T06:00:00.000Z",
      updatedAt: "2026-09-23T06:00:00.000Z",
      hasModifications: false,
      items: [{ id: 20, menuItemId: 4, itemName: "Shampoo", itemPrice: 200, quantity: 2, lineTotal: 400, status: "active", pricingStatus: "fixed", notes: "" }],
    };
    const response = action === "getGuestsWithTabs"
      ? { guests: [] }
      : action === "getWalkinOrders"
        ? { orders: [order] }
        : action === "listOrders" && body.status === "all_history"
          ? { orders: [] }
          : action === "listOrders"
            ? { orders: [] }
            : action === "getMenu"
              ? { categories: [], items: [], paymentHistoryDays: 7 }
              : action === "saveOrderEdits"
                ? { success: true, duplicate: false, total: 400, refundAmount: 0 }
                : action === "getOrderModifications"
                  ? { modifications: [] }
                  : {};
    await route.fulfill({ json: response });
  });
}

async function signInToManagement(page: Page) {
  await page.goto("/admin?section=management&tab=history");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: "Bed History" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockAdminApi(page);
});

test("mobile drawer closes from blank space, X, and navigation selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.locator("#admin-mobile-navigation");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Bookings" }).click();
  await expect(page).toHaveURL(/section=bookings/);
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.click({ position: { x: 370, y: 800 } });
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toBeHidden();
});

test("mobile Management options select their tab, including Food Settings children", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/tab=users/);
  await expect(page.getByRole("heading", { name: "Users & Permissions" })).toBeVisible();

  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Food Settings", exact: true }).click();
  await expect(page).toHaveURL(/tab=foodSettings/);
  await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Menu", exact: true }).click();
  await expect(page).toHaveURL(/tab=menu/);
  await expect(page.getByRole("tab", { name: "Menu", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Bill Settings" }).click();
  await expect(page).toHaveURL(/tab=billSettings/);
  await expect(page.getByRole("tab", { name: "Bill Settings" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.locator("#admin-mobile-navigation");
  await expect(drawer).toBeVisible();
  const drawerBackdropFilter = await drawer.evaluate((element) => getComputedStyle(element).backdropFilter);
  expect(drawerBackdropFilter).toContain("blur");
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
});

test("desktop Management tabs still switch directly", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "Rates", exact: true }).click();
  await expect(page).toHaveURL(/tab=rates/);
});

test("Food Orders browser workflow stages a served quantity modification and saves it without a reason", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await mockFoodOrderWorkflow(page, requests);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "Food Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Order Summary/ })).toBeVisible();
  await page.getByRole("button", { name: "Pawan test" }).click();

  const drawer = page.locator(".fixed.inset-0.z-50");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Edit food items for D265-10" }).click();
  const orderCard = drawer.locator('[data-order-id="10"]');
  await orderCard.getByRole("button", { name: "+" }).click();

  await expect(orderCard).toContainText('Modify "Shampoo" (2 → 3)?');
  await expect(orderCard.getByRole("button", { name: "Save modification" })).toBeEnabled();
  await orderCard.getByRole("button", { name: "Save modification" }).click();
  await expect(orderCard.getByText("3", { exact: true })).toBeVisible();
  await expect(orderCard).toContainText("Shampoo");
  await orderCard.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => requests.filter((body) => body.action === "saveOrderEdits")).toHaveLength(1);
  expect(requests.find((body) => body.action === "saveOrderEdits")).toMatchObject({
    orderId: 10,
    changes: [{ itemId: 20, quantity: 3, reason: "" }],
  });
});

test("in-page Management selectors keep their own selected state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "Account Settings", exact: true }).click();
  const employees = page.getByRole("button", { name: "Employees", exact: true });
  await expect(page.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();
  await employees.click();
  await expect(employees).toHaveClass(/bg-brand-green text-white/);

  await page.getByRole("button", { name: "Booking Settings", exact: true }).click();
  const bookingSection = page.getByRole("navigation", { name: "Booking settings sections" }).getByRole("button", { name: "Payments & Readiness" });
  await bookingSection.click();
  await expect(bookingSection).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Channel Manager", exact: true }).click();
  const salesChannels = page.getByRole("button", { name: "Sales Channels", exact: true });
  await salesChannels.click();
  await expect(salesChannels).toHaveClass(/bg-brand-green text-white/);

  await page.getByRole("button", { name: "Audit", exact: true }).click();
  const auditSections = page.getByRole("button", { name: "Room & General", exact: true }).locator("..");
  const inventoryAudit = auditSections.getByRole("button", { name: "Inventory", exact: true });
  await inventoryAudit.click();
  await expect(inventoryAudit).toHaveClass(/bg-brand-green text-white/);

  await page.getByRole("button", { name: "Logs", exact: true }).click();
  const pmsLogs = page.getByRole("button", { name: "PMS", exact: true });
  await pmsLogs.click();
  await expect(pmsLogs).toHaveClass(/bg-brand-green text-white/);

  await page.getByRole("button", { name: "Website", exact: true }).click();
  const community = page.getByRole("tab", { name: "Community Area" });
  await expect(community).toBeEnabled();
  await community.click();
  await expect(community).toHaveAttribute("aria-selected", "true");
});

test("desktop navigation opens every top-level admin page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInToManagement(page);

  const sections = [
    ["Dashboard", "dashboard"], ["Bookings", "bookings"], ["Beds", "beds"],
    ["Timeline", "timeline"], ["Inventory", "inventory"], ["Records", "records"],
    ["Food Orders", "foodOrders"], ["Accounts", "expenditure"], ["Splits", "splits"],
    ["Reviews", "reviews"], ["Management", "management"],
  ] as const;
  for (const [label, section] of sections) {
    await page.getByRole("button", { name: label, exact: true }).click();
    // The default dashboard section is intentionally represented by an empty
    // query, while every non-default section is encoded explicitly.
    await expect(page).toHaveURL(section === "dashboard"
      ? /\/admin(?:\?|$)/
      : new RegExp(`section=${section}(?:&|$)`), { timeout: 15_000 });
  }
});

test("desktop Management navigation opens every admin tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInToManagement(page);

  const tabs = [
    ["Dorms", "dorms"], ["Users", "users"], ["Backup", "backup"], ["Audit", "audit"],
    ["Logs", "logs"], ["Health & Stats", "health"], ["History", "history"], ["Rates", "rates"],
    ["Website", "website"], ["Food Settings", "foodSettings"],
    ["Bulk Upload", "bulkUpload"], ["QR Codes", "qrGenerator"],
    ["Account Settings", "accountSettings"], ["Attendance", "attendance"], ["To Do", "tasks"],
    ["Server Sync", "serverSync"], ["Channel Manager", "channelManager"],
    ["Booking Settings", "bookingSettings"], ["Razorpay payments", "razorpayPayments"], ["Analytics", "analytics"], ["Links & QRs", "quickLinks"],
  ] as const;
  for (const [label, tab] of tabs) {
    await page.getByRole("button", { name: label, exact: true }).click();
    // Dorms is the default admin tab and therefore removes `tab` from the URL.
    await expect(page).toHaveURL(tab === "dorms"
      ? /section=management(?:$|#)/
      : new RegExp(`section=management&tab=${tab}(?:&|$)`));
  }

  await page.getByRole("button", { name: "Razorpay payments", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Room", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Food", exact: true }).click();
  await expect(page.getByText("Food payment records will be available here soon.")).toBeVisible();

  // Menu and Bill Settings are grouped under the Food Settings navigation item.
  await page.getByRole("button", { name: "Food Settings", exact: true }).click();
  await expect(page).toHaveURL(/section=management&tab=foodSettings(?:&|$)/);
  for (const [label, tab] of [["Menu", "menu"], ["Bill Settings", "billSettings"]] as const) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`section=management&tab=${tab}(?:&|$)`));
  }
});
