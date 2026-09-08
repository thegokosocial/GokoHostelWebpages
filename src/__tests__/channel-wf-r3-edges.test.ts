import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  addChannelSyncLog: vi.fn(),
  getChannelConfig: vi.fn(),
  getSetting: vi.fn(),
  addBooking: vi.fn(),
  updateBookingFull: vi.fn(),
  transitionBookingStatus: vi.fn(),
  getBookingByRef: vi.fn(),
  unassignBookingBeds: vi.fn(),
  addBookingHistoryEntry: vi.fn(),
  getBookingDetail: vi.fn(),
  checkBedAvailability: vi.fn(),
  assignBedToBooking: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getAvailableBedsForRange: vi.fn(),
  authenticateUser: vi.fn(),
  getBookingCalendarData: vi.fn(),
  searchBookings: vi.fn(),
  getUnassignedBookings: vi.fn(),
  validateBedsForRange: vi.fn(),
  unassignBookingBedsByBedIds: vi.fn(),
  cancelBedAssignments: vi.fn(),
  getBookingHistoryEntries: vi.fn(),
  getAllDorms: vi.fn(),
  getAllBeds: vi.fn(),
  getBedById: vi.fn(),
  getActiveBedBlocks: vi.fn(),
  getRatePlanMappings: vi.fn(),
  getAllDailyRates: vi.fn(),
  deactivateBedBlocksByBedIds: vi.fn(),
  shortenAssignedCheckout: vi.fn(),
}));

const triggerInventoryPush = vi.hoisted(() => vi.fn());
const otaFingerprint = vi.hoisted(() => vi.fn());
const pushIfOtaChanged = vi.hoisted(() => vi.fn());
const pushNoShow = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush,
  triggerRatePush: vi.fn(),
  triggerRestrictionPush: vi.fn(),
  otaFingerprint,
  pushIfOtaChanged,
}));
vi.mock("@/lib/aiosell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aiosell")>();
  return { ...actual, pushNoShow };
});
vi.mock("@/db/queries", () => ({
  addChannelSyncLog: q.addChannelSyncLog,
  getChannelConfig: q.getChannelConfig,
  getSetting: q.getSetting,
  addBooking: q.addBooking,
  updateBookingFull: q.updateBookingFull,
  transitionBookingStatus: q.transitionBookingStatus,
  getBookingByRef: q.getBookingByRef,
  unassignBookingBeds: q.unassignBookingBeds,
  addBookingHistoryEntry: q.addBookingHistoryEntry,
  getBookingDetail: q.getBookingDetail,
  checkBedAvailability: q.checkBedAvailability,
  assignBedToBooking: q.assignBedToBooking,
  getRoomTypeMappings: q.getRoomTypeMappings,
  getAvailableBedsForRange: q.getAvailableBedsForRange,
  getBookingCalendarData: q.getBookingCalendarData,
  searchBookings: q.searchBookings,
  getUnassignedBookings: q.getUnassignedBookings,
  validateBedsForRange: q.validateBedsForRange,
  unassignBookingBedsByBedIds: q.unassignBookingBedsByBedIds,
  cancelBedAssignments: q.cancelBedAssignments,
  getBookingHistoryEntries: q.getBookingHistoryEntries,
  getAllDorms: q.getAllDorms,
  getAllBeds: q.getAllBeds,
  getBedById: q.getBedById,
  getActiveBedBlocks: q.getActiveBedBlocks,
  getRatePlanMappings: q.getRatePlanMappings,
  getAllDailyRates: q.getAllDailyRates,
  deactivateBedBlocksByBedIds: q.deactivateBedBlocksByBedIds,
  shortenAssignedCheckout: q.shortenAssignedCheckout,
}));

import { POST as reservationsPOST, ingestFetchedReservations } from "@/app/api/aiosell/reservations/route";
import { POST as bookingsPOST } from "@/app/api/admin/bookings/route";
import { otaFingerprint as otaFp, pushIfOtaChanged as pushOta } from "@/lib/aiosellSync";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const activeConfig = {
  isActive: 1,
  hotelCode: "GOKO-001",
  webhookSecret: "whsec-test",
};

const mappings = [
  { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
  { dormId: 9, channelRoomCode: "dorm-6", isActive: 1, dormName: "Dorm 1" },
];

function webhookReq(body: unknown) {
  return new NextRequest("http://localhost/api/aiosell/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "whsec-test" },
    body: JSON.stringify(body),
  });
}

function adminReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function bookPayload(over: Record<string, unknown> = {}) {
  return {
    action: "book" as const,
    hotelCode: "GOKO-001",
    channel: "booking.com",
    bookingId: "BK-R3E-1",
    checkin: "2026-09-05",
    checkout: "2026-09-08",
    guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+91000" },
    rooms: [{
      roomCode: "executive",
      rateplanCode: "executive-s-ep",
      guestName: "Ada Lovelace",
      occupancy: { adults: 2, children: 0 },
      prices: [
        { date: "2026-09-05", sellRate: 3700 },
        { date: "2026-09-06", sellRate: 3700 },
        { date: "2026-09-07", sellRate: 3700 },
      ],
    }],
    amount: { amountAfterTax: 11100, amountBeforeTax: 11100, tax: 0, currency: "INR" },
    ...over,
  };
}

function existingRow(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    bookingRef: "BK-R3E-1",
    guestName: "Ada Lovelace",
    contact: "+91000",
    platform: "booking.com",
    status: "received",
    checkinDate: "2026-09-05",
    checkoutDate: "2026-09-08",
    roomType: "executive",
    persons: 2,
    paymentStatus: "prepaid",
    specialRequests: "",
    amountBeforeTax: 0,
    amountTax: 0,
    amountTotal: 0,
    currency: "INR",
    email: "ada@example.com",
    cmBookingId: "",
    ratePlan: "executive-s-ep",
    nightlyRate: 3700,
    rawData: JSON.stringify({
      rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
    }),
    ...over,
  };
}

function assigned(bedId: number, dormId: number, pool: "online" | "offline" = "online") {
  return {
    bedId, dormId, status: "assigned" as const,
    checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: pool,
  };
}

function online(dormId: number, ids: number[], dormName: string) {
  return ids.map((id) => ({
    id,
    bedId: `${dormName}-${id}`,
    dormId,
    dormName,
    pool: "online" as const,
  }));
}

describe("Round 3 edges: closed-stay modify / duplicate book / cancelled rebook", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(null);
    q.addBooking.mockResolvedValue(42);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.transitionBookingStatus.mockImplementation(async (id, _from, data) => {
      await q.updateBookingFull(id, data);
      return true;
    });
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.getBookingDetail.mockResolvedValue({ assignments: [] });
    q.checkBedAvailability.mockResolvedValue(true);
    q.assignBedToBooking.mockResolvedValue(true);
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it.each(["cancelled", "no_show", "checked_out"] as const)(
    "modify of %s with date move + occupancy 2→1 does not move dates or reseat",
    async (status) => {
      q.getBookingByRef.mockResolvedValue(existingRow({ status }));
      q.getBookingDetail.mockResolvedValue({
        booking: { status },
        assignments: [assigned(7, 8), assigned(8, 8)],
      });
      q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
      const res = await reservationsPOST(webhookReq(bookPayload({
        action: "modify",
        checkin: "2026-09-10",
        checkout: "2026-09-12",
        rooms: [{
          roomCode: "executive",
          occupancy: { adults: 1, children: 0 },
          prices: [{ date: "2026-09-10", sellRate: 3700 }],
        }],
      })));
      expect(res.status).toBe(200);
      expect(q.checkBedAvailability).not.toHaveBeenCalled();
      expect(q.unassignBookingBeds).not.toHaveBeenCalled();
      expect(q.assignBedToBooking).not.toHaveBeenCalled();
      const patch = q.updateBookingFull.mock.calls[0][1];
      expect(patch.guestName).toBe("Ada Lovelace");
      expect(patch.persons).toBe(1);
      expect(patch.status).toBe(status);
      expect(patch).not.toHaveProperty("checkinDate");
      expect(patch).not.toHaveProperty("checkoutDate");
      expect(triggerInventoryPush).not.toHaveBeenCalled();
    },
  );

  it("duplicate live checked_in book with new dates does not overwrite", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "checked_in" }));
    const res = await reservationsPOST(webhookReq(bookPayload({
      checkin: "2026-09-20",
      checkout: "2026-09-22",
      rooms: [{
        roomCode: "dorm-6",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-20", sellRate: 800 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/duplicate/i);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("duplicate live received book does not overwrite", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "received" }));
    const res = await reservationsPOST(webhookReq(bookPayload()));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/duplicate/i);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("duplicate checked_out book is not a cancelled-style rebook", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "checked_out" }));
    const res = await reservationsPOST(webhookReq(bookPayload()));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/duplicate/i);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("book of a cancelled ref reuses the row, unassigns, auto-assigns, and does not push", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "cancelled" }));
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(webhookReq(bookPayload()));
    expect(res.status).toBe(200);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "received",
      cancelledAt: "",
      cancelledBy: "",
    }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking.mock.calls.every((c) =>
      c[0].bookingId === 9
      && c[0].checkinDate === "2026-09-05"
      && c[0].checkoutDate === "2026-09-08"
      && c[0].inventoryPool === "online"
      && c[0].assignedBy === "channel_manager",
    )).toBe(true);
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Rebooked from Channel",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("book of a no_show ref reuses the row, unassigns, auto-assigns, and does not push", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "no_show" }));
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(webhookReq(bookPayload()));
    expect(res.status).toBe(200);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ status: "received" }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });
});

describe("Round 3 edges: fetch ingest", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(null);
    q.addBooking.mockResolvedValue(201);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    q.assignBedToBooking.mockResolvedValue(true);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("skips an existing live received ref even when dates/occupancy differ", async () => {
    q.getBookingByRef.mockImplementation(async (ref: string) => {
      if (ref === "BK-LIVE") return existingRow({ bookingRef: "BK-LIVE", status: "received" });
      return null;
    });
    const result = await ingestFetchedReservations([
      bookPayload({
        bookingId: "BK-LIVE",
        action: "modify",
        checkin: "2026-10-01",
        checkout: "2026-10-05",
      }),
    ]);
    expect(result).toEqual({ imported: 0, skipped: 1, refs: [] });
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("skips existing cancelled / no_show / checked_out refs (never rebooks from fetch)", async () => {
    q.getBookingByRef.mockImplementation(async (ref: string) => {
      if (ref === "BK-CANCELLED") return { id: 1, status: "cancelled", bookingRef: "BK-CANCELLED" };
      if (ref === "BK-NOSHOW") return { id: 2, status: "no_show", bookingRef: "BK-NOSHOW" };
      if (ref === "BK-OUT") return { id: 3, status: "checked_out", bookingRef: "BK-OUT" };
      return null;
    });
    const result = await ingestFetchedReservations([
      bookPayload({ bookingId: "BK-CANCELLED" }),
      bookPayload({ bookingId: "BK-NOSHOW" }),
      bookPayload({ bookingId: "BK-OUT" }),
    ]);
    expect(result).toEqual({ imported: 0, skipped: 3, refs: [] });
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("imports a missing ref via handleNew (auto-assign) and does not push", async () => {
    const result = await ingestFetchedReservations([bookPayload({ bookingId: "BK-NEW" })]);
    expect(result).toEqual({ imported: 1, skipped: 0, refs: ["BK-NEW"] });
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-NEW",
      source: "channel_manager",
      persons: 2,
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("unwraps { data } / { reservations } and skips already-present refs", async () => {
    q.getBookingByRef.mockImplementation(async (ref: string) => {
      if (ref === "ALREADY") return { id: 9, status: "received", bookingRef: "ALREADY" };
      return null;
    });
    const fromData = await ingestFetchedReservations({
      data: [bookPayload({ bookingId: "ALREADY" }), bookPayload({ bookingId: "NEW-D" })],
    });
    expect(fromData).toEqual({ imported: 1, skipped: 1, refs: ["NEW-D"] });

    q.addBooking.mockClear();
    const fromReservations = await ingestFetchedReservations({
      reservations: [bookPayload({ bookingId: "NEW-R" })],
    });
    expect(fromReservations).toEqual({ imported: 1, skipped: 0, refs: ["NEW-R"] });
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ bookingRef: "NEW-R" }));
  });

  it("skips a fetch cancel snapshot of an existing ref", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "received" }));
    const result = await ingestFetchedReservations([
      { action: "cancel", hotelCode: "GOKO-001", channel: "booking.com", bookingId: "BK-R3E-1" },
    ]);
    expect(result).toEqual({ imported: 0, skipped: 1, refs: [] });
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("skips a fetch cancel snapshot of an unknown ref (does not insert received)", async () => {
    q.getBookingByRef.mockResolvedValue(null);
    const result = await ingestFetchedReservations([
      { action: "cancel", hotelCode: "GOKO-001", channel: "booking.com", bookingId: "BK-NEVER" },
    ]);
    expect(result).toEqual({ imported: 0, skipped: 1, refs: [] });
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("fetch modify snapshot of an unknown ref still ingest-creates", async () => {
    q.getBookingByRef.mockResolvedValue(null);
    const result = await ingestFetchedReservations([
      bookPayload({ bookingId: "BK-MOD-NEW", action: "modify" }),
    ]);
    expect(result).toEqual({ imported: 1, skipped: 0, refs: ["BK-MOD-NEW"] });
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-MOD-NEW",
      status: "received",
      source: "channel_manager",
    }));
  });
});

describe("Round 3 edges: markNoShow Unassigned fingerprint", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.getChannelConfig.mockResolvedValue({
      isActive: 1, hotelCode: "H", pmsId: "P", apiBaseUrl: "http://x", apiUsername: "u", apiPassword: "p",
    });
    q.updateBookingFull.mockResolvedValue(undefined);
    q.transitionBookingStatus.mockImplementation(async (id, _from, data) => {
      await q.updateBookingFull(id, data);
      return true;
    });
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    otaFingerprint.mockReset();
    otaFingerprint.mockResolvedValue("fp-before");
    pushIfOtaChanged.mockReset();
    pushIfOtaChanged.mockResolvedValue(undefined);
    pushNoShow.mockReset();
    pushNoShow.mockResolvedValue({ success: true });
  });

  it("Unassigned CM fingerprints mapped dorms (not empty assignment ids) and still pushes", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        platform: "booking.com",
        cmBookingId: "CM-UA",
        source: "channel_manager",
        checkinDate: "2026-09-01",
        checkoutDate: "2026-09-04",
        roomType: "executive",
        rawData: JSON.stringify({
          rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
        }),
      },
      assignments: [],
    });
    const res = await bookingsPOST(adminReq({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, { status: "no_show" });
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(5);
    expect(pushNoShow).toHaveBeenCalledWith(expect.objectContaining({ hotelCode: "H" }), "CM-UA");
    expect(otaFp).toHaveBeenCalledWith([8], ["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(pushOta).toHaveBeenCalledWith("fp-before", [8], ["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("Unassigned mixed-type CM fingerprints both mapped dorms", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        platform: "hostelworld",
        cmBookingId: "HW-MIX",
        source: "channel_manager",
        checkinDate: "2026-09-01",
        checkoutDate: "2026-09-03",
        roomType: "executive, dorm-6",
        rawData: JSON.stringify({
          rooms: [
            { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
            { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
          ],
        }),
      },
      assignments: [],
    });
    const res = await bookingsPOST(adminReq({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(pushNoShow).not.toHaveBeenCalled();
    expect(otaFp).toHaveBeenCalledWith([8, 9], ["2026-09-01", "2026-09-02"]);
    expect(pushOta).toHaveBeenCalledWith("fp-before", [8, 9], ["2026-09-01", "2026-09-02"]);
  });

  it("Unassigned walk-in (not CM) does not map dorms from room type", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        platform: "walk-in",
        source: "manual",
        checkinDate: "2026-09-01",
        checkoutDate: "2026-09-03",
        roomType: "executive",
      },
      assignments: [],
    });
    const res = await bookingsPOST(adminReq({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.getRoomTypeMappings).not.toHaveBeenCalled();
    expect(otaFp).toHaveBeenCalledWith([], ["2026-09-01", "2026-09-02"]);
    expect(pushOta).toHaveBeenCalledWith("fp-before", [], ["2026-09-01", "2026-09-02"]);
  });

  it("admin cancel of a CM stay releases occupancy (webhook cancel still does)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        source: "channel_manager",
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-08",
      },
      assignments: [assigned(7, 8)],
    });
    const res = await bookingsPOST(adminReq({ password: "x", action: "cancelBooking", bookingId: 9 }));
    expect(res.status).toBe(200);
    expect(pushOta).toHaveBeenCalled();

    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "confirmed", persons: 1 }));
    q.getBookingDetail.mockResolvedValue({ assignments: [assigned(7, 8)] });
    const hook = await reservationsPOST(webhookReq({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-R3E-1",
    }));
    expect(hook.status).toBe(200);
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });
});

describe("Round 3 edges: date realign fail + occupancy shrink", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.assignBedToBooking.mockResolvedValue(true);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("date conflict + occupancy 2→1 moves booking dates and reseats 1 bed", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({
      status: "received",
      persons: 2,
    }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [assigned(7, 8), assigned(8, 8)],
    });
    q.checkBedAvailability.mockResolvedValue(false);
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(webhookReq(bookPayload({
      action: "modify",
      checkin: "2026-09-06",
      checkout: "2026-09-10",
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-06", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.checkBedAvailability).toHaveBeenCalledWith(7, "2026-09-06", "2026-09-10", 9);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.persons).toBe(1);
    expect(patch.checkinDate).toBe("2026-09-06");
    expect(patch.checkoutDate).toBe("2026-09-10");
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 7,
      dormId: 8,
      checkinDate: "2026-09-06",
      checkoutDate: "2026-09-10",
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("date conflict + occupancy 2→1 with overflow assignment reseats on new dates and does not push", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ persons: 2 }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [assigned(99, 9, "offline"), assigned(100, 9, "offline")],
    });
    q.checkBedAvailability.mockResolvedValue(false);
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(webhookReq(bookPayload({
      action: "modify",
      checkin: "2026-09-06",
      checkout: "2026-09-10",
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-06", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.checkBedAvailability).toHaveBeenCalledWith(99, "2026-09-06", "2026-09-10", 9);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.checkinDate).toBe("2026-09-06");
    expect(patch.checkoutDate).toBe("2026-09-10");
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 7,
      checkinDate: "2026-09-06",
      checkoutDate: "2026-09-10",
      inventoryPool: "online",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });
});
