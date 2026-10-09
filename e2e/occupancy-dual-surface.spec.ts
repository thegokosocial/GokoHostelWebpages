import { expect, test, type Page } from "@playwright/test";

/**
 * Dual occupancy landmine: Bookings calendar checkIn does not occupy beds.
 * Physical assignBed on Beds is a separate surface.
 * All admin APIs are mocked — no live D1.
 */

type DualState = {
  bookingCheckedIn: boolean;
  bedOccupied: boolean;
  paymentStatus: "pay_at_hotel" | "prepaid" | "paid";
  amountTotal: number;
  amountPaid: number;
  writeOffAmount?: number;
  loggedIn: boolean;
  editPreview?: boolean;
  pendingWebsiteReservations?: unknown[];
};

function sampleBooking(state: DualState) {
  return {
    id: 5,
    bookingCycle: 1,
    guestName: state.editPreview ? "Preview Guest" : "Dual Guest",
    contact: "9000000000",
    email: "",
    platform: "walkin",
    bookingRef: "",
    cmBookingId: "",
    gokoBookingId: "GOKO20260920ABCDEF",
    checkinDate: "2026-09-20",
    checkoutDate: state.editPreview ? "2026-09-21" : "2026-09-22",
    roomType: "",
    ratePlan: "",
    persons: 1,
    status: state.bookingCheckedIn ? "checked_in" : "received",
    source: "manual",
    property: "goko_hostel",
    specialRequests: "",
    amountBeforeTax: state.amountTotal,
    amountTax: 0,
    amountTotal: state.amountTotal,
    amountPaid: state.amountPaid,
    paymentStatus: state.paymentStatus,
    amountRefunded: 0,
    writeOffAmount: state.writeOffAmount || 0,
    nightlyRate: state.editPreview ? 3600 : 0,
    currency: "INR",
    holdExpiresAt: "",
    cancelledAt: "",
    cancelledBy: "",
    checkedInAt: "",
    checkedInBy: "",
    checkedOutAt: "",
    checkedOutBy: "",
    createdAt: "2026-09-20T10:00:00.000Z",
    nights: state.editPreview ? 1 : 2,
    balance: Math.max(0, state.amountTotal - state.amountPaid),
  };
}

async function mockDualOccupancyApis(page: Page, state: DualState) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      state.loggedIn = true;
      await route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      if (state.loggedIn) {
        await route.fulfill({
          json: { authenticated: true, role: "admin", username: "e2e-admin", permissions: {} },
        });
        return;
      }
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (!url.pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const rawBody = route.request().postData();
    const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
    const action = String(body.action || "");

    if (action === "auth") {
      state.loggedIn = true;
      await route.fulfill({ json: { role: "admin", permissions: {} } });
      return;
    }

    if (url.pathname.includes("/bookings")) {
      if (action === "writeOffStayRevenue") {
        state.writeOffAmount = Number(body.amount || 0);
        await route.fulfill({ json: { success: true } });
        return;
      }
      if (action === "checkIn") {
        state.bookingCheckedIn = true;
        await route.fulfill({ json: { success: true } });
        return;
      }
      if (action === "getDetail") {
        await route.fulfill({
          json: {
            booking: sampleBooking(state),
            assignments: [],
            contactMethods: [],
          },
        });
        return;
      }
      if (
        action === "getBookingCalendar"
        || action === "getCalendar"
        || action === "getCalendarData"
        || action === "getBookings"
        || action === "search"
      ) {
        await route.fulfill({
          json: {
            dorms: [{ id: 1, name: "Dorm A", beds: [], collapsed: false }],
            bookings: [sampleBooking(state)],
            assignments: [],
          },
        });
        return;
      }
      if (action === "getUnassigned") {
        await route.fulfill({ json: { bookings: [], pendingWebsiteReservations: state.pendingWebsiteReservations || [] } });
        return;
      }
      await route.fulfill({ json: { success: true, bookings: [], dorms: [] } });
      return;
    }

    if (url.pathname.includes("/checkins")) {
      if (action === "getBeds") {
        const beds = state.bedOccupied
          ? [["Dorm A", "B1", "Lower", "Bunk", "occupied", "Dual Guest", "9000000000", "2026-09-20", "2026-09-22", "2", "7", "12"]]
          : [["Dorm A", "B1", "Lower", "Bunk", "available", "", "", "", "", "", "7", ""]];
        await route.fulfill({
          json: {
            beds,
            unassigned: state.bedOccupied ? [] : [[
              "2026-09-20T10:00:00.000Z", "2026-09-20", "14:00", "Dual Guest", "1",
              "9000000000", "2", "Goa", "IN", "Mom", "911", "Passport", "", "", "yes",
              "12", "BK-5",
            ]],
            linkedBookingDetails: {},
            role: "admin",
          },
        });
        return;
      }
      if (action === "assignBed") {
        state.bedOccupied = true;
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({ json: { success: true, beds: [], unassigned: [] } });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test("unpaid website reservations are shown separately from Unassigned", async ({ page }) => {
  const state: DualState = {
    bookingCheckedIn: false,
    bedOccupied: false,
    paymentStatus: "pay_at_hotel",
    amountTotal: 0,
    amountPaid: 0,
    loggedIn: false,
    pendingWebsiteReservations: [{
      booking: { ...sampleBooking({ bookingCheckedIn: false, bedOccupied: false, paymentStatus: "pay_at_hotel", amountTotal: 0, amountPaid: 0, loggedIn: false }), guestName: "Pending Guest", platform: "Website", bookingRef: "GOKO-PENDING", source: "website", status: "hold" },
      checkoutState: "ready",
      dueNowPaise: 50100,
      holdExpiresAt: Math.floor(Date.now() / 1000) + 600,
      requestedRooms: "3 × Dorm 2 – single bed",
    }],
  };
  await mockDualOccupancyApis(page, state);
  await adminLoginToBookings(page);

  await expect(page.getByRole("heading", { name: /Pending website payments/i })).toBeVisible();
  await expect(page.getByText("Reserved: 3 × Dorm 2 – single bed")).toBeVisible();
  await expect(page.getByRole("button", { name: /Unassigned/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assign" })).toHaveCount(0);
});

async function adminLoginToBookings(page: Page) {
  await page.goto("/admin?section=bookings");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: /Booking/i })).toBeVisible({ timeout: 15_000 });
}

test("Bookings checkIn leaves bed available until physical assignBed", async ({ page }) => {
  const state: DualState = {
    bookingCheckedIn: false,
    bedOccupied: false,
    paymentStatus: "pay_at_hotel",
    amountTotal: 2000,
    amountPaid: 0,
    loggedIn: false,
  };
  await mockDualOccupancyApis(page, state);
  await adminLoginToBookings(page);

  // Calendar check-in (Bookings surface) — must not occupy physical beds.
  await page.evaluate(async () => {
    await fetch("/api/admin/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x", action: "checkIn", bookingId: 5 }),
    });
  });
  expect(state.bookingCheckedIn).toBe(true);
  expect(state.bedOccupied).toBe(false);

  await page.goto("/admin?section=beds");
  await expect(page.getByText("1 free")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Dual Guest")).toBeVisible(); // still in unassigned list
  await page.getByRole("button", { name: /Dorm A/ }).click();
  await expect(page.locator("span").filter({ hasText: /^Available$/ })).toBeVisible();
  await expect(page.locator("p.font-semibold", { hasText: "Dual Guest" })).toHaveCount(0);

  await page.evaluate(async () => {
    await fetch("/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "x",
        action: "assignBed",
        bedId: 7,
        guestName: "Dual Guest",
        guestContact: "9000000000",
        checkinDate: "2026-09-20",
        stayingDays: "2",
        checkinId: 12,
      }),
    });
  });
  expect(state.bedOccupied).toBe(true);

  await page.goto("/admin?section=beds");
  await expect(page.getByText("0 free")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Dorm A/ }).click();
  await expect(page.locator("p.font-semibold", { hasText: "Dual Guest" })).toBeVisible();
  await expect(page.locator("span").filter({ hasText: /^Available$/ })).toHaveCount(0);
});

test("Check-in popup shows Collect payment then Payment done for prepaid", async ({ page }) => {
  const state: DualState = {
    bookingCheckedIn: false,
    bedOccupied: false,
    paymentStatus: "pay_at_hotel",
    amountTotal: 31500,
    amountPaid: 0,
    loggedIn: false,
  };
  await mockDualOccupancyApis(page, state);
  await adminLoginToBookings(page);

  const search = page.getByPlaceholder(/search/i).first();
  await search.fill("Dual Guest");
  await expect(page.getByText("Dual Guest").first()).toBeVisible({ timeout: 10_000 });
  await page.getByText("Dual Guest").first().click();
  await expect(page.getByRole("button", { name: "Check In" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Check In" }).click();
  await expect(page.getByText("Check In Guest")).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Collect payment" })).toBeVisible();
  await page.getByRole("button", { name: "Later" }).click();

  state.paymentStatus = "prepaid";
  state.amountPaid = 0;
  state.bookingCheckedIn = false;
  await page.goto("/admin?section=bookings");
  await expect(page.getByRole("heading", { name: /Booking/i })).toBeVisible();
  await page.getByPlaceholder(/search/i).first().fill("Dual Guest");
  await page.getByText("Dual Guest").first().click();
  await expect(page.getByRole("button", { name: "Check In" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Check In" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "Payment done" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Prepaid" })).toBeVisible();
});

test("manual booking edit previews due from the corrected amount received", async ({ page }) => {
  const state: DualState = {
    bookingCheckedIn: false,
    bedOccupied: false,
    paymentStatus: "paid",
    amountTotal: 3600,
    amountPaid: 3600,
    loggedIn: false,
    editPreview: true,
  };
  await mockDualOccupancyApis(page, state);
  await adminLoginToBookings(page);

  await page.getByPlaceholder(/search/i).first().fill("Preview Guest");
  await page.getByText("Preview Guest").first().click();
  await page.getByRole("button", { name: "Edit Booking" }).click();
  await page.getByLabel("Amount received (₹)").fill("3400");
  await expect(page.getByText("After save: Total ₹3,600 · Due ₹200")).toBeVisible();
});

test("admin writes off a checked-in stay balance separately from payment", async ({ page }) => {
  const state: DualState = {
    bookingCheckedIn: true,
    bedOccupied: false,
    paymentStatus: "paid",
    amountTotal: 1200,
    amountPaid: 1000,
    loggedIn: false,
  };
  await mockDualOccupancyApis(page, state);
  await adminLoginToBookings(page);
  await page.getByPlaceholder(/search/i).first().fill("Dual Guest");
  await page.getByText("Dual Guest").first().click();
  await page.getByRole("button", { name: "Write Off Balance" }).click();
  await expect(page.getByRole("heading", { name: "Write Off Unpaid Balance" })).toBeVisible();
  await page.getByLabel("Amount Lost (₹)").fill("200");
  await expect(page.getByText("Still Collectible")).toBeVisible();
  await page.getByRole("button", { name: "Record Revenue Lost" }).click();
  await expect.poll(() => state.writeOffAmount).toBe(200);
});
