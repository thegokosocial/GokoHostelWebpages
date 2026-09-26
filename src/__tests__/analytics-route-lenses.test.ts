import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { NextRequest } from "next/server";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { bookings, bookingCycleSnapshots } from "@/db/schema";

const state = vi.hoisted(() => ({
  db: null as Database | null,
  auth: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ authenticateUser: (...args: unknown[]) => state.auth(...args) }));

import { POST } from "@/app/api/admin/analytics/route";

const skippedPiMigrations = new Set([
  "0035_site_cms.sql", "0041_splits.sql", "0081_split_expense_idempotency.sql", "0064_food_bill_share_tokens.sql", "0077_food_bill_walkin_identity.sql",
  "0066_gateway_receivables.sql", "0068_gateway_settlement_allocations.sql", "0079_site_hero_videos.sql",
]);

let sqlite: SQLite.Database;
let db: Database;

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function addBooking(overrides: Partial<typeof bookings.$inferInsert> = {}) {
  const syncId = crypto.randomUUID();
  const [row] = await db.insert(bookings).values({
    guestName: "Analytics Guest",
    contact: "+919900000001",
    platform: "booking.com",
    bookingRef: `ref-${syncId.slice(0, 8)}`,
    checkinDate: "2026-09-27",
    checkoutDate: "2026-10-02",
    roomType: "dorm",
    persons: 1,
    paymentStatus: "pay_at_hotel",
    otaPaymentTerms: "pay_at_hotel",
    otaCurrency: "INR",
    status: "received",
    source: "channel_manager",
    property: "goko_hostel",
    createdAt: "2026-08-15T10:00:00.000Z",
    amountBeforeTax: 1000,
    amountTax: 0,
    amountTotal: 1000,
    amountPaid: 250,
    amountRefunded: 0,
    paymentMethod: "",
    cashReceived: 0,
    changeGiven: 0,
    refundMethod: "",
    refundCash: 0,
    bookingCycle: 1,
    currency: "INR",
    syncId,
    syncSource: "pi",
    ...overrides,
  }).returning();
  return row;
}

beforeEach(() => {
  vi.stubEnv("GOKO_RUNTIME", "pi");
  state.auth.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (skippedPiMigrations.has(file)) continue;
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  db = drizzle(sqlite, { schema }) as unknown as Database;
  state.db = db;
});

afterEach(() => {
  state.db = null;
  sqlite.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("analytics route lenses", () => {
  it("rejects unauthorized and invalid ranges", async () => {
    state.auth.mockResolvedValueOnce(null);
    expect((await POST(request({ password: "x", fromDate: "2026-09-29", toDate: "2026-10-03" }))).status).toBe(401);

    state.auth.mockResolvedValueOnce({ role: "staff", displayName: "Staff", permissions: {} });
    expect((await POST(request({ password: "x", fromDate: "2026-09-29", toDate: "2026-10-03" }))).status).toBe(403);

    state.auth.mockResolvedValue({ role: "staff", displayName: "Staff", permissions: { canViewAnalytics: true } });
    expect((await POST(request({ password: "x", fromDate: "2026-10-03", toDate: "2026-09-29" }))).status).toBe(400);
    expect((await POST(request({ password: "x", fromDate: "2025-01-01", toDate: "2026-12-31" }))).status).toBe(400);
  });

  it("keeps pickup at 0 while on-books/ADR count overlapping received stays created earlier", async () => {
    await addBooking({
      createdAt: "2026-08-15T10:00:00.000Z",
      checkinDate: "2026-09-27",
      checkoutDate: "2026-10-02",
      status: "received",
      amountTotal: 1000,
      amountPaid: 250,
    });

    const res = await POST(request({ password: "admin", fromDate: "2026-09-29", toDate: "2026-10-03" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary.bookings).toBe(0);
    expect(body.summary.onBooksStays).toBe(1);
    // Nights overlapping 29 Sep–3 Oct: 29,30,1 Oct = 3 of 5 stay nights → ADR > 0
    expect(body.summary.onBooksNights).toBe(3);
    expect(body.summary.bookedStayValue).toBeCloseTo(600, 5);
    expect(body.summary.adr).toBeCloseTo(200, 5);
    expect(body.summary.expectedRoomRevenue).toBeCloseTo(600, 5);
    expect(body.summary.expectedRoomObtainedRevenue).toBe(250);
    expect(body.summary.outstandingBalance).toBeCloseTo(350, 5);
    expect(body.summary.collectionRate).toBeCloseTo((250 / 600) * 100, 5);
    expect(body.summary.arrivals).toBe(0);
  });

  it("counts pickup when created in range and excludes cancelled from on-books", async () => {
    await addBooking({
      createdAt: "2026-09-30T05:00:00.000+05:30",
      checkinDate: "2026-10-01",
      checkoutDate: "2026-10-03",
      status: "confirmed",
      amountTotal: 400,
      amountPaid: 0,
      platform: "website",
    });
    await addBooking({
      createdAt: "2026-09-30T06:00:00.000+05:30",
      checkinDate: "2026-10-01",
      checkoutDate: "2026-10-02",
      status: "cancelled",
      amountTotal: 200,
      amountPaid: 0,
      bookingRef: "cancelled-1",
    });

    const body = await (await POST(request({ password: "admin", fromDate: "2026-09-29", toDate: "2026-10-03" }))).json();
    expect(body.summary.bookings).toBe(2);
    expect(body.summary.cancellations).toBe(1);
    expect(body.summary.onBooksStays).toBe(1);
    expect(body.summary.cancellationRate).toBe(50);
    expect(body.bookings.byChannel.some((row: { channel: string; count: number }) => row.channel === "website" && row.count === 1)).toBe(true);
  });

  it("scopes expected/on-books to the selected range instead of the full calendar month", async () => {
    await addBooking({
      createdAt: "2026-08-01T10:00:00.000Z",
      checkinDate: "2026-10-10",
      checkoutDate: "2026-10-20",
      status: "confirmed",
      amountTotal: 5000,
      amountPaid: 0,
    });
    await addBooking({
      createdAt: "2026-08-01T10:00:00.000Z",
      checkinDate: "2026-09-29",
      checkoutDate: "2026-10-01",
      status: "confirmed",
      amountTotal: 400,
      amountPaid: 100,
      bookingRef: "in-range",
    });

    const body = await (await POST(request({ password: "admin", fromDate: "2026-09-29", toDate: "2026-10-03" }))).json();
    expect(body.summary.onBooksStays).toBe(1);
    expect(body.summary.expectedRoomNights).toBe(2);
    expect(body.summary.expectedRoomRevenue).toBe(400);
    expect(body.summary).not.toHaveProperty("expectedRoomMonth");
  });

  it("includes overlapping cycle snapshots in booked stay value", async () => {
    const live = await addBooking({
      createdAt: "2026-09-01T10:00:00.000Z",
      checkinDate: "2026-11-01",
      checkoutDate: "2026-11-03",
      status: "received",
      amountTotal: 1,
      amountPaid: 0,
    });
    await db.insert(bookingCycleSnapshots).values({
      snapshotId: crypto.randomUUID(),
      bookingId: live.id,
      bookingCycle: 1,
      guestName: "Archived",
      contact: "",
      bookingRef: "snap-1",
      platform: "booking.com",
      checkinDate: "2026-09-28",
      checkoutDate: "2026-10-02",
      status: "checked_out",
      bookingCreatedAt: "2026-08-01T00:00:00.000Z",
      checkedInAt: "2026-09-28T12:00:00.000Z",
      checkedOutAt: "2026-10-02T10:00:00.000Z",
      persons: 1,
      roomType: "dorm",
      amountBeforeTaxPaise: 80000,
      amountTaxPaise: 0,
      amountTotalPaise: 80000,
      amountPaidPaise: 80000,
      amountRefundedPaise: 0,
      createdAt: "2026-10-02T10:00:00.000Z",
      syncId: crypto.randomUUID(),
      syncSource: "pi",
    });

    const body = await (await POST(request({ password: "admin", fromDate: "2026-09-29", toDate: "2026-10-03" }))).json();
    // Snapshot nights overlapping range: 29,30,1 Oct = 3 of 4 → 600 rupees
    expect(body.summary.onBooksStays).toBeGreaterThanOrEqual(1);
    expect(body.summary.bookedStayValue).toBeGreaterThanOrEqual(600);
  });

  it("returns prior-period comparison deltas when prior window has pickup", async () => {
    await addBooking({
      createdAt: "2026-09-25T05:00:00.000+05:30",
      checkinDate: "2026-10-10",
      checkoutDate: "2026-10-12",
      status: "confirmed",
      amountTotal: 300,
    });
    await addBooking({
      createdAt: "2026-09-30T05:00:00.000+05:30",
      checkinDate: "2026-10-01",
      checkoutDate: "2026-10-02",
      status: "confirmed",
      amountTotal: 200,
      bookingRef: "current-pickup",
    });

    const body = await (await POST(request({ password: "admin", fromDate: "2026-09-29", toDate: "2026-10-03" }))).json();
    expect(body.range.priorFromDate).toBe("2026-09-24");
    expect(body.range.priorToDate).toBe("2026-09-28");
    expect(body.comparison.bookings).toBe(1);
    expect(body.summary.bookings).toBe(1);
    expect(body.comparison.deltas.bookings).toBe(0);
  });

  it("puts advance October stays on create-day pickup and check-in-day arrivals, not Oct pickup", async () => {
    await addBooking({
      createdAt: "2026-09-15T08:00:00.000+05:30",
      checkinDate: "2026-10-02",
      checkoutDate: "2026-10-04",
      status: "confirmed",
      amountTotal: 500,
      amountPaid: 0,
      bookingRef: "oct-advance",
    });

    const body = await (await POST(request({ password: "admin", fromDate: "2026-09-01", toDate: "2026-10-31" }))).json();
    type TrendDay = { date: string; bookings: number; arrivals: number };
    const byDate = new Map<string, TrendDay>(body.trend.map((row: TrendDay) => [row.date, row]));
    expect(byDate.get("2026-09-15")!.bookings).toBeGreaterThanOrEqual(1);
    expect(byDate.get("2026-10-02")!.bookings).toBe(0);
    expect(byDate.get("2026-10-02")!.arrivals).toBe(1);
    expect(body.definitions.trendPickup).toMatch(/creation day/i);
  });

  it("allows manager access without canViewAnalytics", async () => {
    state.auth.mockResolvedValue({ role: "manager", displayName: "Manager", permissions: {} });
    const res = await POST(request({ password: "x", fromDate: "2026-09-29", toDate: "2026-10-03" }));
    expect(res.status).toBe(200);
  });
});
