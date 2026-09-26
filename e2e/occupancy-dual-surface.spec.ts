import { expect, test, type Page } from "@playwright/test";

/**
 * Dual occupancy landmine: Bookings calendar checkIn does not occupy beds.
 * Physical assignBed on Beds is a separate surface.
 * All admin APIs are mocked — no live D1.
 */

async function mockDualOccupancyApis(page: Page, state: {
  bookingCheckedIn: boolean;
  bedOccupied: boolean;
}) {
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
    if (!url.pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const rawBody = route.request().postData();
    const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
    const action = String(body.action || "");

    if (action === "auth") {
      await route.fulfill({ json: { role: "admin", permissions: {} } });
      return;
    }

    if (url.pathname.includes("/bookings")) {
      if (action === "checkIn") {
        state.bookingCheckedIn = true;
        await route.fulfill({ json: { success: true } });
        return;
      }
      if (action === "getBookingCalendar" || action === "getCalendar" || action === "getBookings") {
        await route.fulfill({
          json: {
            dorms: [],
            bookings: [{
              id: 5,
              guestName: "Dual Guest",
              status: state.bookingCheckedIn ? "checked_in" : "received",
              checkinDate: "2026-09-20",
              checkoutDate: "2026-09-22",
            }],
          },
        });
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

test("Bookings checkIn leaves bed available until physical assignBed", async ({ page }) => {
  const state = { bookingCheckedIn: false, bedOccupied: false };
  await mockDualOccupancyApis(page, state);

  await page.goto("/admin?section=bookings");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();

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
  await expect(page.getByText("1 free")).toBeVisible();
  await expect(page.getByText("Dual Guest")).toBeVisible(); // still in unassigned list
  await page.getByRole("button", { name: /Dorm A/ }).click();
  await expect(page.getByText("Available")).toBeVisible();
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
  await expect(page.getByText("0 free")).toBeVisible();
  await page.getByRole("button", { name: /Dorm A/ }).click();
  await expect(page.locator("p.font-semibold", { hasText: "Dual Guest" })).toBeVisible();
  await expect(page.getByText("Available")).toHaveCount(0);
});
