import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { accounts, bookingPaymentEvents, bookings, dailyLedger, guestReceipts } from "@/db/schema";
import { ALL_PERMISSION_KEYS } from "@/lib/permissionCatalog";
import { actionAllowed } from "@/lib/actionPermissions";
import {
  canCollectOtaPayment,
  archiveBookingCycle,
  correctOtaBookingPayment,
  isOtaPostpaidBooking,
  paiseToRupees,
  recordOtaBookingPayment,
  rebuildBookingPaymentProjection,
  rupeesToPaise,
} from "@/lib/bookingPaymentJournal";
import { todayIST } from "@/lib/utils";

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock("@/db", () => ({ getDb: () => state.db }));

const skippedPiMigrations = new Set([
  "0035_site_cms.sql", "0041_splits.sql", "0064_food_bill_share_tokens.sql",
  "0066_gateway_receivables.sql", "0068_gateway_settlement_allocations.sql",
]);
let sqlite: SQLite.Database;
let db: Database;

async function addBooking(overrides: Partial<typeof bookings.$inferInsert> = {}) {
  const syncId = crypto.randomUUID();
  const inserted = await db.insert(bookings).values({
    guestName: "Test Guest", contact: "+919900000000", platform: "booking.com", bookingRef: "ota-123",
    checkinDate: "2026-10-01", checkoutDate: "2026-10-03", roomType: "dorm", persons: 1,
    paymentStatus: "pay_at_hotel", otaPaymentTerms: "pay_at_hotel", otaCurrency: "INR", status: "received",
    source: "channel_manager", property: "goko_hostel", createdAt: new Date().toISOString(),
    amountBeforeTax: 450, amountTax: 22.5, amountTotal: 472.5, amountPaid: 0, amountRefunded: 0,
    paymentMethod: "", cashReceived: 0, changeGiven: 0, refundMethod: "", refundCash: 0,
    bookingCycle: 1, currency: "INR", syncId, syncSource: "pi", ...overrides,
  }).returning({ id: bookings.id });
  return (await db.select().from(bookings).where(eq(bookings.id, inserted[0].id)).limit(1))[0];
}

async function addAccount(overrides: Partial<typeof accounts.$inferInsert> = {}) {
  const inserted = await db.insert(accounts).values({
    name: "Test Bank", accountType: "savings", isActive: 1, isVirtual: 0,
    createdAt: new Date().toISOString(), ...overrides,
  }).returning({ id: accounts.id });
  return inserted[0].id;
}

beforeEach(() => {
  vi.stubEnv("GOKO_RUNTIME", "pi");
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
});

describe("OTA postpaid booking payment journal", () => {
  it("uses exact paise and requires explicit OTA terms and INR source currency", async () => {
    expect(rupeesToPaise("472.50")).toBe(47250);
    expect(paiseToRupees(47250)).toBe(472.5);
    expect(Number.isNaN(rupeesToPaise("472.501"))).toBe(true);

    const eligible = await addBooking();
    expect(isOtaPostpaidBooking(eligible)).toBe(true);
    expect(canCollectOtaPayment(eligible)).toBe(true);
    expect(isOtaPostpaidBooking({ ...eligible, otaCurrency: null })).toBe(false);
    expect(isOtaPostpaidBooking({ ...eligible, otaPaymentTerms: "prepaid" })).toBe(false);
    expect(isOtaPostpaidBooking({ ...eligible, source: "manual" })).toBe(false);
  });

  it("records a partial online advance once, repairs retries, and rejects over-collection", async () => {
    const booking = await addBooking();
    const accountId = await addAccount();
    const input = {
      booking, eventId: "advance-1", kind: "collection" as const,
      amountPaise: 15000, cashPaise: 0, onlinePaise: 15000, accountId,
      note: "Advance by phone", actor: "frontdesk",
    };
    const first = await recordOtaBookingPayment(input);
    const retry = await recordOtaBookingPayment(input);
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(first.booking.amountPaid).toBe(150);
    expect(first.booking.amountTotal! - first.booking.amountPaid! + first.booking.amountRefunded!).toBe(322.5);
    expect(await db.select().from(bookingPaymentEvents)).toHaveLength(1);
    expect(await db.select().from(guestReceipts)).toMatchObject([{ amount: 15000, accountId, bookingEventId: "advance-1" }]);
    await expect(recordOtaBookingPayment({ ...input, eventId: "too-much", amountPaise: 32251, onlinePaise: 32251 }))
      .rejects.toThrow("exceeds the current balance");
    await expect(recordOtaBookingPayment({ ...input, eventId: "advance-1", amountPaise: 14900, onlinePaise: 14900 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("keeps change separate from applied cash and rejects a second write using a stale booking snapshot", async () => {
    const booking = await addBooking();
    const payment = (eventId: string) => recordOtaBookingPayment({
      booking, eventId, kind: "collection", amountPaise: 30000, cashPaise: 30000, onlinePaise: 0,
      cashTenderPaise: 32000, changePaise: 2000, actor: "frontdesk",
    });
    const first = await payment("cash-a");
    await expect(payment("cash-b")).rejects.toThrow("exceeds the current balance");
    const saved = (await db.select().from(bookings))[0];
    expect(saved.amountPaid).toBe(300);
    expect(saved.cashReceived).toBe(300);
    expect(saved.changeGiven).toBe(20);
    expect(first.booking.amountPaid).toBe(300);
    expect((await db.select().from(bookingPaymentEvents))[0]).toMatchObject({ amountPaise: 30000, cashPaise: 30000, cashTenderPaise: 32000, changePaise: 2000 });
  });

  it("refunds on cancellation, caps cumulative refunds, and corrects an erroneous online entry", async () => {
    const booking = await addBooking();
    const accountId = await addAccount();
    const collection = await recordOtaBookingPayment({
      booking, eventId: "collected", kind: "collection", amountPaise: 20000,
      cashPaise: 5000, onlinePaise: 15000, cashTenderPaise: 5000, accountId, actor: "frontdesk",
    });
    const refund = await recordOtaBookingPayment({
      booking: collection.booking, eventId: "cancel-refund", kind: "refund", amountPaise: 10000,
      cashPaise: 0, onlinePaise: 10000, accountId, actor: "frontdesk", allowedStatuses: ["received"],
      statusUpdate: { status: "cancelled" },
    });
    expect(refund.booking.status).toBe("cancelled");
    expect(refund.booking.amountPaid).toBe(200);
    expect(refund.booking.amountRefunded).toBe(100);
    await expect(recordOtaBookingPayment({
      booking: refund.booking, eventId: "over-refund", kind: "refund", amountPaise: 10001,
      cashPaise: 0, onlinePaise: 10001, accountId, actor: "frontdesk",
      allowedStatuses: ["cancelled"],
    })).rejects.toThrow("Refund exceeds");

    // Reopen a fresh cycle in this fixture to demonstrate a correction independently of the terminal refund.
    const correctedBooking = await addBooking({ bookingRef: "ota-456" });
    const mistaken = await recordOtaBookingPayment({
      booking: correctedBooking, eventId: "mistaken-online", kind: "collection", amountPaise: 5000,
      cashPaise: 0, onlinePaise: 5000, accountId, actor: "frontdesk",
    });
    const corrected = await correctOtaBookingPayment({
      booking: mistaken.booking, eventId: "correction-1", correctsEventId: "mistaken-online",
      amountPaise: 5000, cashPaise: 0, onlinePaise: 5000, note: "Entry was accidental; no money moved", actor: "admin",
    });
    expect(corrected.booking.amountPaid).toBe(0);
    expect(corrected.booking.amountRefunded).toBe(0);
    const receipts = await db.select().from(guestReceipts).where(eq(guestReceipts.sourceId, correctedBooking.id));
    expect(receipts.map((receipt) => [receipt.kind, receipt.amount])).toEqual([["stay", 5000], ["reversal", -5000]]);
    await expect(correctOtaBookingPayment({
      booking: corrected.booking, eventId: "correction-too-much", correctsEventId: "mistaken-online",
      amountPaise: 1, cashPaise: 0, onlinePaise: 1, note: "again", actor: "admin",
    })).rejects.toThrow("uncorrected amount");
  });

  it("uses the same atomic partial-refund behavior when a held booking becomes a no-show", async () => {
    const booking = await addBooking({ status: "hold" });
    const collected = await recordOtaBookingPayment({
      booking, eventId: "no-show-advance", kind: "collection", amountPaise: 8000,
      cashPaise: 8000, onlinePaise: 0, cashTenderPaise: 8000, actor: "frontdesk",
    });
    const result = await recordOtaBookingPayment({
      booking: collected.booking, eventId: "no-show-refund", kind: "refund", amountPaise: 3000,
      cashPaise: 3000, onlinePaise: 0, cashTenderPaise: 3000, actor: "frontdesk",
      allowedStatuses: ["hold"], statusUpdate: { status: "no_show" },
    });
    expect(result.booking.status).toBe("no_show");
    expect(result.booking.amountPaid).toBe(80);
    expect(result.booking.amountRefunded).toBe(30);
    expect(result.booking.amountPaid! - result.booking.amountRefunded!).toBe(50);
  });

  it("preserves and exposes an over-refund received from a disconnected replica", async () => {
    const booking = await addBooking();
    const collected = await recordOtaBookingPayment({
      booking, eventId: "offline-base-collection", kind: "collection", amountPaise: 5000,
      cashPaise: 5000, onlinePaise: 0, cashTenderPaise: 5000, actor: "frontdesk",
    });
    await db.insert(bookingPaymentEvents).values({
      eventId: "remote-offline-refund", syncId: "remote-offline-refund", bookingId: booking.id,
      bookingCycle: booking.bookingCycle, eventType: "refund", amountPaise: 7000, cashPaise: -7000,
      onlinePaise: 0, unknownPaise: 0, cashTenderPaise: 7000, changePaise: 0, accountId: null,
      currency: "INR", otaPaymentTerms: "pay_at_hotel", businessDate: todayIST(), isOpening: 0,
      correctsEventId: null, guestNameSnapshot: booking.guestName, bookingRefSnapshot: booking.bookingRef || "",
      platformSnapshot: booking.platform, checkinDateSnapshot: booking.checkinDate, checkoutDateSnapshot: booking.checkoutDate || "",
      note: "Actual refund entered while disconnected", actor: "frontdesk", createdAt: new Date().toISOString(),
      syncUpdatedAt: new Date().toISOString(), syncSource: "cloudflare",
    });
    await rebuildBookingPaymentProjection(booking.id, booking.bookingCycle, db);
    const saved = (await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0];
    expect(saved.amountPaid).toBe(50);
    expect(saved.amountRefunded).toBe(70);
    expect(saved.amountPaid! - saved.amountRefunded!).toBe(-20);
    expect(collected.booking.amountPaid).toBe(50);
    expect(readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8")).toContain("otaRefundOverage");
    expect(readFileSync("src/components/admin/AdminRoomRevenue.tsx", "utf8")).toContain("overRefundedTerminal");
  });

  it("archives the original guest, dates, lifecycle timestamps, and payment projection for a reused cycle", async () => {
    const booking = await addBooking({
      status: "checked_out", checkedInAt: "2026-10-01T08:30:00.000Z", checkedOutAt: "2026-10-03T05:00:00.000Z",
      createdAt: "2026-09-20T08:00:00.000Z", amountPaid: 150, amountRefunded: 25,
    });
    await archiveBookingCycle(booking);
    const snapshot = (await db.select().from(schema.bookingCycleSnapshots))[0];
    expect(snapshot).toMatchObject({
      bookingCycle: 1, guestName: "Test Guest", checkinDate: "2026-10-01", checkoutDate: "2026-10-03",
      bookingCreatedAt: "2026-09-20T08:00:00.000Z", checkedInAt: "2026-10-01T08:30:00.000Z",
      checkedOutAt: "2026-10-03T05:00:00.000Z", amountTotalPaise: 47250,
      amountPaidPaise: 15000, amountRefundedPaise: 2500,
    });
  });

  it("keeps payment terms separate from progress and enforces the narrow booking permission", async () => {
    const booking = await addBooking();
    const accountId = await addAccount();
    const paid = await recordOtaBookingPayment({
      booking, eventId: "fully-paid", kind: "collection", amountPaise: 47250,
      cashPaise: 0, onlinePaise: 47250, accountId, actor: "frontdesk",
    });
    expect(paid.booking.paymentStatus).toBe("paid");
    expect(paid.booking.otaPaymentTerms).toBe("pay_at_hotel");
    expect(canCollectOtaPayment(paid.booking)).toBe(false);
    expect(ALL_PERMISSION_KEYS).toContain("canRecordBookingPayments");
    expect(actionAllowed("staff", { canRecordBookingPayments: true }, "canRecordBookingPayments")).toBe("allowed");
    expect(actionAllowed("staff", { canRecordBookingPayments: true }, "canDeleteBooking")).toBe("forbidden");
    expect(actionAllowed("staff", { canRecordBookingPayments: true }, "admin_only")).toBe("admin_required");
    expect(actionAllowed("admin", {}, "admin_only")).toBe("allowed");
    expect(todayIST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("records split tender and preserves applied cash separately from tender/change", async () => {
    const booking = await addBooking();
    const accountId = await addAccount();
    const result = await recordOtaBookingPayment({
      booking, eventId: "split-advance", kind: "collection", amountPaise: 30000,
      cashPaise: 10000, onlinePaise: 20000, cashTenderPaise: 12000, changePaise: 2000,
      accountId, actor: "frontdesk",
    });
    expect(result.booking.amountPaid).toBe(300);
    expect(result.booking.paymentMethod).toBe("split");
    expect(result.booking.cashReceived).toBe(100);
    expect(result.booking.changeGiven).toBe(20);
    expect(await db.select().from(guestReceipts)).toMatchObject([{ amount: 20000, accountId }]);
    expect(await db.select().from(bookingPaymentEvents)).toMatchObject([{
      amountPaise: 30000, cashPaise: 10000, onlinePaise: 20000, cashTenderPaise: 12000, changePaise: 2000,
    }]);
  });

  it("rejects inactive or virtual online accounts before changing the booking", async () => {
    const booking = await addBooking();
    const inactive = await addAccount({ isActive: 0 });
    await expect(recordOtaBookingPayment({
      booking, eventId: "inactive-account", kind: "collection", amountPaise: 1000,
      cashPaise: 0, onlinePaise: 1000, accountId: inactive, actor: "frontdesk",
    })).rejects.toThrow("receiving account is not active");
    const virtual = await addAccount({ isVirtual: 1 });
    await expect(recordOtaBookingPayment({
      booking, eventId: "virtual-account", kind: "collection", amountPaise: 1000,
      cashPaise: 0, onlinePaise: 1000, accountId: virtual, actor: "frontdesk",
    })).rejects.toThrow("receiving account is not active");
    expect(await db.select().from(bookingPaymentEvents)).toHaveLength(0);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].amountPaid).toBe(0);
  });

  it("blocks payment when the booking is missing sync identity or the business date is reconciled", async () => {
    const missingIdentity = await addBooking({ syncId: null });
    await expect(recordOtaBookingPayment({
      booking: missingIdentity, eventId: "missing-sync", kind: "collection", amountPaise: 1000,
      cashPaise: 1000, onlinePaise: 0, cashTenderPaise: 1000, actor: "frontdesk",
    })).rejects.toThrow("sync identity is missing");

    const booking = await addBooking({ bookingRef: "reconciled-date" });
    await db.insert(dailyLedger).values({ date: todayIST(), accountId: null, isReconciled: 1, reconciledBy: "admin" });
    await expect(recordOtaBookingPayment({
      booking, eventId: "closed-cash-date", kind: "collection", amountPaise: 1000,
      cashPaise: 1000, onlinePaise: 0, cashTenderPaise: 1000, actor: "frontdesk",
    })).rejects.toThrow("cash reconciliation");
    expect(await db.select().from(bookingPaymentEvents)).toHaveLength(0);
  });

  it("allows only the active price-reduction credit to be refunded", async () => {
    const booking = await addBooking({ status: "checked_in" });
    const collected = await recordOtaBookingPayment({
      booking, eventId: "price-down-collection", kind: "collection", amountPaise: 45000,
      cashPaise: 45000, onlinePaise: 0, cashTenderPaise: 45000, actor: "frontdesk",
    });
    await db.update(bookings).set({ amountTotal: 400 }).where(eq(bookings.id, booking.id));
    const refund = await recordOtaBookingPayment({
      booking: collected.booking, eventId: "price-down-credit", kind: "refund", amountPaise: 5000,
      cashPaise: 5000, onlinePaise: 0, cashTenderPaise: 5000, actor: "frontdesk",
    });
    expect(refund.booking.amountPaid).toBe(450);
    expect(refund.booking.amountRefunded).toBe(50);
    await expect(recordOtaBookingPayment({
      booking: refund.booking, eventId: "price-down-over-credit", kind: "refund", amountPaise: 1,
      cashPaise: 1, onlinePaise: 0, cashTenderPaise: 1, actor: "frontdesk",
    })).rejects.toThrow("Refund exceeds");
  });

  it("rejects unsupported statuses, currencies, terms, and non-OTA sources", async () => {
    for (const overrides of [
      { status: "cancelled" }, { otaCurrency: null }, { otaPaymentTerms: "prepaid" }, { source: "manual" },
    ]) {
      const booking = await addBooking(overrides);
      expect(canCollectOtaPayment(booking)).toBe(false);
      await expect(recordOtaBookingPayment({
        booking, eventId: `ineligible-${booking.id}`, kind: "collection", amountPaise: 1000,
        cashPaise: 1000, onlinePaise: 0, cashTenderPaise: 1000, actor: "frontdesk",
      })).rejects.toThrow();
    }
  });
});
