import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";

const state = vi.hoisted(() => ({
  db: null as Database | null,
  auth: { role: "admin" as string, displayName: "Admin", permissions: {} as Record<string, boolean> },
}));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({
  authenticateUser: async () => state.auth,
}));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
  triggerInventoryPush: vi.fn(async () => undefined),
}));
vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: vi.fn(async () => undefined),
  notificationFirstName: (n: string) => n.split(/\s+/)[0] || n,
  notificationStayDates: (...a: string[]) => a.join("–"),
  notificationDate: (d: string) => d,
}));

import { POST as bookingsPOST } from "@/app/api/admin/bookings/route";
import { POST as checkinsPOST } from "@/app/api/admin/checkins/route";

const skippedMigrations = new Set([
  "0035_site_cms.sql",
  "0041_splits.sql",
  "0081_split_expense_idempotency.sql",
  "0064_food_bill_share_tokens.sql",
  "0077_food_bill_walkin_identity.sql",
  "0066_gateway_receivables.sql",
  "0068_gateway_settlement_allocations.sql",
  "0079_site_hero_videos.sql",
]);

let sqlite: SQLite.Database;
let checkinDate: string;
let checkoutDate: string;

function bookingsReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test", ...body }),
  });
}

function checkinsReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/checkins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test", ...body }),
  });
}

function bedStatuses() {
  return sqlite.prepare("SELECT id, status FROM beds ORDER BY id").all() as Array<{ id: number; status: string }>;
}

function assignmentRows(bookingId: number) {
  return sqlite.prepare(
    "SELECT bed_id, status, checkin_date, checkout_date FROM booking_bed_assignments WHERE booking_id = ? ORDER BY bed_id",
  ).all(bookingId) as Array<{ bed_id: number; status: string; checkin_date: string; checkout_date: string }>;
}

beforeEach(() => {
  state.auth = { role: "admin", displayName: "Admin", permissions: {} };
  vi.stubEnv("GOKO_RUNTIME", "pi");
  checkinDate = addCalendarDays(todayIST(), 7);
  checkoutDate = addCalendarDays(checkinDate, 3);

  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (!skippedMigrations.has(file)) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  state.db = drizzle(sqlite, { schema }) as unknown as Database;

  sqlite.exec(`
    INSERT INTO dorms (id, name, created_at) VALUES (1, 'Dorm A', '2026-09-01T00:00:00Z');
    INSERT INTO beds (id, dorm_id, dorm_name, bed_id, position, type, status)
      VALUES (1, 1, 'Dorm A', 'A1', 'Lower', 'Bunk', 'available'),
             (2, 1, 'Dorm A', 'A2', 'Upper', 'Bunk', 'available'),
             (3, 1, 'Dorm A', 'A3', 'Lower', 'Bunk', 'available');
    INSERT INTO settings (key, value) VALUES ('booking_tax_rate', '0'), ('booking_tax_apply_admin', '0');
    INSERT INTO accounts (id, name, account_type, is_active, opening_balance, is_virtual, created_at)
      VALUES (1, 'HDFC', 'savings', 1, 0, 0, '2026-09-01T00:00:00Z');
    INSERT INTO settings (key, value) VALUES ('room_online_receipt_account_id', '1');
    INSERT INTO room_type_mapping (id, dorm_id, dorm_name, channel_room_code, total_inventory, is_active)
      VALUES (1, 1, 'Dorm A', 'DORM', 10, 1);
  `);
});

afterEach(() => {
  state.db = null;
  sqlite.close();
  vi.unstubAllEnvs();
});

describe("bookings calendar (disposable SQLite)", () => {
  it("walk-in createBooking writes booking + gokoBookingId without occupying beds", async () => {
    const res = await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "Walk Guest",
      checkinDate,
      checkoutDate,
      persons: 1,
      staySubtotal: 3000,
      bedIds: [1],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.bookingId).toBeTruthy();

    const row = sqlite.prepare(
      "SELECT id, guest_name, goko_booking_id, status, source, platform FROM bookings WHERE id = ?",
    ).get(body.bookingId) as Record<string, unknown>;
    expect(row.guest_name).toBe("Walk Guest");
    expect(row.status).toBe("received");
    expect(row.source).toBe("manual");
    expect(String(row.goko_booking_id)).toMatch(/^GOKO\d{8}[A-Z0-9]{6}$/);
    expect(assignmentRows(body.bookingId)).toHaveLength(1);
    expect(bedStatuses().every((b) => b.status === "available")).toBe(true);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM checkins").get() as { n: number }).n).toBe(0);
  });

  it("assignBeds correct count persists; wrong count is 400 with no partial assign", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "Assign Guest",
      checkinDate,
      checkoutDate,
      persons: 2,
      staySubtotal: 4000,
    }))).json();
    expect(created.bookingId).toBeTruthy();
    // Walk-in create omits roomType (count gate skipped). Mapped type enables persons-based assignBeds rules.
    sqlite.prepare("UPDATE bookings SET room_type = 'DORM' WHERE id = ?").run(created.bookingId);

    const bad = await bookingsPOST(bookingsReq({
      action: "assignBeds",
      bookingId: created.bookingId,
      bedIds: [1],
    }));
    expect(bad.status).toBe(400);
    expect(assignmentRows(created.bookingId)).toHaveLength(0);

    const ok = await bookingsPOST(bookingsReq({
      action: "assignBeds",
      bookingId: created.bookingId,
      bedIds: [1, 2],
    }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true });
    expect(assignmentRows(created.bookingId).map((a) => a.bed_id)).toEqual([1, 2]);
    expect(assignmentRows(created.bookingId).every((a) => a.status === "assigned")).toBe(true);
    expect(bedStatuses().every((b) => b.status === "available")).toBe(true);
  });

  it("calendar checkIn sets booking checked_in without beds.status or checkins insert", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "CI Guest",
      checkinDate,
      checkoutDate,
      persons: 1,
      staySubtotal: 2000,
      bedIds: [1],
    }))).json();

    const beforeBeds = bedStatuses();
    const res = await bookingsPOST(bookingsReq({
      action: "checkIn",
      bookingId: created.bookingId,
      collectPayment: false,
    }));
    expect(res.status).toBe(200);

    const booking = sqlite.prepare("SELECT status FROM bookings WHERE id = ?").get(created.bookingId) as { status: string };
    expect(booking.status).toBe("checked_in");
    expect(bedStatuses()).toEqual(beforeBeds);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM checkins").get() as { n: number }).n).toBe(0);
  });

  it("physical assignBed occupies beds.status (contrast with calendar checkIn)", async () => {
    const res = await checkinsPOST(checkinsReq({
      action: "assignBed",
      bedId: 2,
      guestName: "Physical Guest",
      guestContact: "9000000011",
      checkinDate: todayIST(),
      stayingDays: "2",
    }));
    expect(res.status).toBe(200);
    const bed = sqlite.prepare("SELECT status, guest_name FROM beds WHERE id = 2").get() as { status: string; guest_name: string };
    expect(bed.status).toBe("occupied");
    expect(bed.guest_name).toBe("Physical Guest");
  });

  it("calendar checkOut shortens assignment nights and does not force bed cleanup", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "CO Guest",
      checkinDate,
      checkoutDate,
      persons: 1,
      staySubtotal: 2500,
      bedIds: [1],
    }))).json();
    await bookingsPOST(bookingsReq({ action: "checkIn", bookingId: created.bookingId, collectPayment: false }));

    const beforeAssign = assignmentRows(created.bookingId)[0];
    expect(beforeAssign.checkout_date).toBe(checkoutDate);

    const res = await bookingsPOST(bookingsReq({ action: "checkOut", bookingId: created.bookingId }));
    expect(res.status).toBe(200);

    const booking = sqlite.prepare(
      "SELECT status, checkout_date FROM bookings WHERE id = ?",
    ).get(created.bookingId) as { status: string; checkout_date: string };
    expect(booking.status).toBe("checked_out");
    // Planned checkout date on the booking row is unchanged; assignment nights shorten.
    expect(booking.checkout_date).toBe(checkoutDate);

    const afterAssign = assignmentRows(created.bookingId)[0];
    expect(afterAssign.status).toBe("assigned");
    // Future stay checked out early: exclusive cut is CI (zero remaining nights), not today.
    expect(afterAssign.checkout_date).toBe(checkinDate);
    expect(afterAssign.checkout_date < beforeAssign.checkout_date).toBe(true);
    expect(bedStatuses().find((b) => b.id === 1)?.status).toBe("available");
  });

  it("rollbackCheckIn is admin_only for staff", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "RB Guest",
      checkinDate,
      checkoutDate,
      persons: 1,
      staySubtotal: 1500,
      bedIds: [1],
    }))).json();
    await bookingsPOST(bookingsReq({ action: "checkIn", bookingId: created.bookingId, collectPayment: false }));

    state.auth = {
      role: "staff",
      displayName: "Staff",
      permissions: { canCheckIn: true, canAddBooking: true },
    };
    const denied = await bookingsPOST(bookingsReq({ action: "rollbackCheckIn", bookingId: created.bookingId }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "Admin access required" });
    expect(
      (sqlite.prepare("SELECT status FROM bookings WHERE id = ?").get(created.bookingId) as { status: string }).status,
    ).toBe("checked_in");

    state.auth = { role: "admin", displayName: "Admin", permissions: {} };
    const ok = await bookingsPOST(bookingsReq({ action: "rollbackCheckIn", bookingId: created.bookingId }));
    expect(ok.status).toBe(200);
    expect(
      (sqlite.prepare("SELECT status FROM bookings WHERE id = ?").get(created.bookingId) as { status: string }).status,
    ).toBe("received");
  });

  it("collectStayPayment with same receiptId does not double the journal", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "Pay Guest",
      checkinDate,
      checkoutDate,
      persons: 1,
      staySubtotal: 1000,
      bedIds: [1],
    }))).json();
    await bookingsPOST(bookingsReq({ action: "checkIn", bookingId: created.bookingId, collectPayment: false }));

    const receiptId = "stay-op-idem-1";
    const first = await bookingsPOST(bookingsReq({
      action: "collectStayPayment",
      bookingId: created.bookingId,
      paymentMethod: "online",
      onlineAccountId: 1,
      receiptId,
      operationId: receiptId,
    }));
    expect(first.status).toBe(200);

    const second = await bookingsPOST(bookingsReq({
      action: "collectStayPayment",
      bookingId: created.bookingId,
      paymentMethod: "online",
      onlineAccountId: 1,
      receiptId,
      operationId: receiptId,
    }));
    // After first collect nothing is due — second must not invent another receipt.
    expect([400, 200]).toContain(second.status);
    const receipts = sqlite.prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM guest_receipts WHERE source_type = 'booking' AND source_id = ?",
    ).get(created.bookingId) as { n: number; total: number };
    expect(receipts.n).toBe(1);
    expect(receipts.total).toBe(100000);
    const paid = sqlite.prepare("SELECT amount_paid, amount_total FROM bookings WHERE id = ?")
      .get(created.bookingId) as { amount_paid: number; amount_total: number };
    expect(paid.amount_paid).toBe(paid.amount_total);
  });

  it("records an admin-only stay revenue write-off without changing collected money", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "Unreachable Guest",
      checkinDate,
      checkoutDate,
      persons: 1,
      staySubtotal: 1200,
      bedIds: [1],
    }))).json();
    await bookingsPOST(bookingsReq({ action: "checkIn", bookingId: created.bookingId, collectPayment: false }));
    sqlite.prepare("UPDATE bookings SET status = 'checked_out', amount_paid = 1000, payment_status = 'paid' WHERE id = ?").run(created.bookingId);

    const first = await bookingsPOST(bookingsReq({
      action: "writeOffStayRevenue", bookingId: created.bookingId, amount: 200,
      reason: "Guest unreachable", note: "Called twice", idempotencyKey: "stay-writeoff-integration-1",
    }));
    expect(first.status).toBe(200);
    const booking = sqlite.prepare("SELECT amount_total, amount_paid, write_off_amount FROM bookings WHERE id = ?").get(created.bookingId) as { amount_total: number; amount_paid: number; write_off_amount: number };
    expect(booking).toEqual({ amount_total: 1200, amount_paid: 1000, write_off_amount: 200 });
    expect(sqlite.prepare("SELECT source_type, source_id, booking_cycle, amount_paise, reason FROM revenue_writeoffs").all()).toEqual([
      { source_type: "booking", source_id: created.bookingId, booking_cycle: 1, amount_paise: 20000, reason: "Guest unreachable" },
    ]);

    const retry = await bookingsPOST(bookingsReq({
      action: "writeOffStayRevenue", bookingId: created.bookingId, amount: 200,
      reason: "Guest unreachable", note: "Called twice", idempotencyKey: "stay-writeoff-integration-1",
    }));
    expect(await retry.json()).toMatchObject({ success: true, idempotent: true });
    expect(sqlite.prepare("SELECT write_off_amount FROM bookings WHERE id = ?").get(created.bookingId)).toEqual({ write_off_amount: 200 });

    const invalidKey = await bookingsPOST(bookingsReq({
      action: "writeOffStayRevenue", bookingId: created.bookingId, amount: 1,
      reason: "Guest unreachable", idempotencyKey: "stay-writeoff_%",
    }));
    expect(invalidKey.status).toBe(400);
    expect(await invalidKey.json()).toMatchObject({ error: "Invalid idempotency key" });

    state.auth = { role: "staff", displayName: "Staff", permissions: { canCheckIn: true } };
    expect((await bookingsPOST(bookingsReq({
      action: "writeOffStayRevenue", bookingId: created.bookingId, amount: 1,
      reason: "Guest unreachable", idempotencyKey: "stay-writeoff-staff-denied",
    }))).status).toBe(403);
  });

  it("multi-bed stay assign/unassign keeps batch-safe assignment row counts", async () => {
    const created = await (await bookingsPOST(bookingsReq({
      action: "createBooking",
      guestName: "Triple Guest",
      checkinDate,
      checkoutDate,
      persons: 3,
      staySubtotal: 6000,
    }))).json();

    const assigned = await bookingsPOST(bookingsReq({
      action: "assignBeds",
      bookingId: created.bookingId,
      bedIds: [1, 2, 3],
    }));
    expect(assigned.status).toBe(200);
    expect(assignmentRows(created.bookingId)).toHaveLength(3);

    const unassigned = await bookingsPOST(bookingsReq({
      action: "unassign",
      bookingId: created.bookingId,
    }));
    expect(unassigned.status).toBe(200);
    const rows = assignmentRows(created.bookingId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "unassigned")).toBe(true);
    expect(bedStatuses().every((b) => b.status === "available")).toBe(true);
  });
});
