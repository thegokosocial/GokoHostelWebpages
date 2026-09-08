import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

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

const reservationsSrc = readFileSync("src/app/api/aiosell/reservations/route.ts", "utf8");
const bookingsSrc = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
const queriesSrc = readFileSync("src/db/queries.ts", "utf8");
const ingestFn = reservationsSrc.match(
  /export async function ingestFetchedReservations[\s\S]*?\nfunction extractBookingFields/,
)?.[0] ?? "";
const cancelFn = reservationsSrc.match(
  /async function handleCancelBooking[\s\S]*?\nasync function realignAssignments/,
)?.[0] ?? "";
const holdAction = bookingsSrc.match(/action === "hold"[\s\S]*?action === "cancelBooking"/)?.[0] ?? "";
const checkOutAction = bookingsSrc.match(/action === "checkOut"[\s\S]*?action === "rollbackCheckIn"/)?.[0] ?? "";
const markNoShowAction = bookingsSrc.match(/action === "markNoShow"[\s\S]*?action === "unassign"/)?.[0] ?? "";
const holdSql = queriesSrc.match(
  /export async function getUnassignedOtaHoldsForRange[\s\S]*?\nexport async function checkBedAvailability/,
)?.[0] ?? "";

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
    bookingId: "BK-R4E-1",
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
    bookingRef: "BK-R4E-1",
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

describe("Round 4 edges: fetch hotelCode / persons / empty rooms / duplicate batch", () => {
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

  it("ingest skips OTHER-HOTEL snapshots the same way the webhook 400s them", async () => {
    const ingested = await ingestFetchedReservations([
      bookPayload({ bookingId: "BK-OTHER-HOTEL", hotelCode: "OTHER-HOTEL" }),
    ]);
    expect(ingested).toEqual({ imported: 0, skipped: 1, refs: [] });
    expect(q.getChannelConfig).toHaveBeenCalled();
    expect(q.addBooking).not.toHaveBeenCalled();

    const hook = await reservationsPOST(webhookReq(bookPayload({ hotelCode: "OTHER-HOTEL" })));
    expect(hook.status).toBe(400);
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("source: ingestFetchedReservations compares payload.hotelCode to config", () => {
    expect(ingestFn).toContain("getChannelConfig");
    expect(ingestFn).toContain("payload.hotelCode !== hotelCode");
    expect(reservationsSrc).toContain("if (payload.hotelCode !== config.hotelCode)");
  });

  it("fetch insert stores persons from occupancy sum, not rooms.length (2 rooms × 1 adult)", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([
      ...online(8, [7], "Executive"),
      ...online(9, [21], "Dorm 1"),
    ]);
    const result = await ingestFetchedReservations([bookPayload({
      bookingId: "BK-MIX-2R",
      rooms: [
        {
          roomCode: "executive",
          rateplanCode: "executive-s-ep",
          occupancy: { adults: 1, children: 0 },
          prices: [{ date: "2026-09-05", sellRate: 3700 }],
        },
        {
          roomCode: "dorm-6",
          rateplanCode: "dorm-6-s-ep",
          occupancy: { adults: 1, children: 0 },
          prices: [{ date: "2026-09-05", sellRate: 800 }],
        },
      ],
    })]);
    expect(result).toEqual({ imported: 1, skipped: 0, refs: ["BK-MIX-2R"] });
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-MIX-2R",
      persons: 2,
      roomType: "executive, dorm-6",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 7, dormId: 8, inventoryPool: "online",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 21, dormId: 9, inventoryPool: "online",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("empty rooms[] fetch insert is persons 1, roomType \"\", no auto-assign (even with a leftover roomType field)", async () => {
    const result = await ingestFetchedReservations([bookPayload({
      bookingId: "BK-EMPTY-ROOMS",
      rooms: [],
      roomType: "executive",
    })]);
    expect(result).toEqual({ imported: 1, skipped: 0, refs: ["BK-EMPTY-ROOMS"] });
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-EMPTY-ROOMS",
      persons: 1,
      roomType: "",
    }));
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Unassigned",
    }));
  });

  it("duplicate bookingId in one fetch batch imports the first and skips the second", async () => {
    const byRef = new Map<string, { id: number; status: string; bookingRef: string }>();
    q.getBookingByRef.mockImplementation(async (ref: string) => byRef.get(ref) ?? null);
    q.addBooking.mockImplementation(async (fields: { bookingRef: string }) => {
      const id = 300 + byRef.size;
      byRef.set(fields.bookingRef, { id, status: "received", bookingRef: fields.bookingRef });
      return id;
    });
    const result = await ingestFetchedReservations([
      bookPayload({ bookingId: "BK-DUP-BATCH" }),
      bookPayload({
        bookingId: "BK-DUP-BATCH",
        checkin: "2026-10-01",
        checkout: "2026-10-03",
        rooms: [{
          roomCode: "dorm-6",
          occupancy: { adults: 1, children: 0 },
          prices: [{ date: "2026-10-01", sellRate: 800 }],
        }],
      }),
    ]);
    expect(result).toEqual({ imported: 1, skipped: 1, refs: ["BK-DUP-BATCH"] });
    expect(q.addBooking).toHaveBeenCalledTimes(1);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-DUP-BATCH",
      checkinDate: "2026-09-05",
      roomType: "executive",
      persons: 2,
    }));
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });
});

describe("Round 4 edges: occupancy grow + date conflict", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.transitionBookingStatus.mockImplementation(async (id, _from, data) => {
      await q.updateBookingFull(id, data);
      return true;
    });
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.assignBedToBooking.mockResolvedValue(true);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("date conflict + occupancy 1→2 keeps booking dates and reseats 2 beds on the old stay", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({
      status: "received",
      persons: 1,
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 1, children: 0 } }],
      }),
    }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [assigned(7, 8)],
    });
    q.checkBedAvailability.mockResolvedValue(false);
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(webhookReq(bookPayload({
      action: "modify",
      checkin: "2026-09-06",
      checkout: "2026-09-10",
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 2, children: 0 },
        prices: [{ date: "2026-09-06", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.checkBedAvailability).toHaveBeenCalledWith(7, "2026-09-06", "2026-09-10", 9);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.persons).toBe(2);
    expect(patch.checkinDate).toBe("2026-09-06");
    expect(patch.checkoutDate).toBe("2026-09-10");
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking.mock.calls.every((c) =>
      c[0].bookingId === 9
      && c[0].checkinDate === "2026-09-06"
      && c[0].checkoutDate === "2026-09-10"
      && c[0].inventoryPool === "online",
    )).toBe(true);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });
});

describe("Round 4 edges: closed-stay webhook cancel", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it.each(["checked_out", "no_show"] as const)(
    "webhook cancel of %s is a no-op (does not overwrite, unassign, or push)",
    async (status) => {
      q.getBookingByRef.mockResolvedValue(existingRow({ status, persons: 1 }));
      q.getBookingDetail.mockResolvedValue({
        booking: { status },
        assignments: [assigned(7, 8)],
      });
      const res = await reservationsPOST(webhookReq({
        action: "cancel",
        hotelCode: "GOKO-001",
        channel: "booking.com",
        bookingId: "BK-R4E-1",
      }));
      expect(res.status).toBe(200);
      expect((await res.json()).message).toMatch(/already closed/i);
      expect(q.updateBookingFull).not.toHaveBeenCalled();
      expect(q.unassignBookingBeds).not.toHaveBeenCalled();
      expect(triggerInventoryPush).not.toHaveBeenCalled();
    },
  );

  it("source: handleCancelBooking no-ops cancelled, checked_out, and no_show", () => {
    expect(cancelFn).toContain("if (existing.status === \"cancelled\")");
    expect(cancelFn).toContain("existing.status === \"checked_out\" || existing.status === \"no_show\"");
    expect(reservationsSrc).toContain("const closed = existing.status === \"checked_out\" || existing.status === \"no_show\" || existing.status === \"cancelled\"");
  });
});

describe("Round 4 edges: Reject then webhook cancel / checkOut unassigned CM", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.transitionBookingStatus.mockImplementation(async (id, _from, data) => {
      await q.updateBookingFull(id, data);
      return true;
    });
    q.unassignBookingBeds.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    otaFingerprint.mockReset();
    otaFingerprint.mockResolvedValue("fp-before");
    pushIfOtaChanged.mockReset();
    pushIfOtaChanged.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("Reject (cancelBooking) of unassigned CM skips occupancy push; later webhook cancel is already-cancelled no-op", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        source: "channel_manager",
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-08",
        roomType: "executive",
        status: "received",
      },
      assignments: [],
    });
    const reject = await bookingsPOST(adminReq({ password: "x", action: "cancelBooking", bookingId: 9 }));
    expect(reject.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ status: "cancelled" }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(pushOta).toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();

    q.updateBookingFull.mockClear();
    q.unassignBookingBeds.mockClear();
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "cancelled" }));
    const hook = await reservationsPOST(webhookReq({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-R4E-1",
    }));
    expect(hook.status).toBe(200);
    expect((await hook.json()).message).toMatch(/already cancelled/i);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("checkOut of unassigned CM does not fingerprint mapped dorms (unlike markNoShow) and does not push", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        source: "channel_manager",
        platform: "booking.com",
        status: "checked_in",
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-08",
        roomType: "executive",
        rawData: JSON.stringify({
          rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
        }),
      },
      assignments: [],
    });
    const res = await bookingsPOST(adminReq({ password: "x", action: "checkOut", bookingId: 9 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ status: "checked_out" }));
    expect(q.getRoomTypeMappings).not.toHaveBeenCalled();
    expect(otaFp).not.toHaveBeenCalled();
    expect(pushOta).not.toHaveBeenCalled();
  });

  it("source: checkOut fingerprints assignment dorms only; markNoShow maps unassigned CM dorms", () => {
    expect(checkOutAction).toContain("activeAssignmentDormIds(detail.assignments)");
    expect(checkOutAction).not.toContain("requestedDormsForCodes");
    expect(checkOutAction).toContain("pushIfGokoOccupancy");
    expect(markNoShowAction).toContain("affectedDormIds(detail)");
    expect(markNoShowAction).toContain("pushIfOtaChanged");
  });
});

describe("Round 4 edges: hold action leftovers", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.updateBookingFull.mockResolvedValue(undefined);
    q.addBookingHistoryEntry.mockResolvedValue(undefined);
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.addChannelSyncLog.mockResolvedValue(undefined);
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    q.assignBedToBooking.mockResolvedValue(true);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("hold of a cancelled CM stay succeeds with no stayClosed check (would re-enter OTA hold SQL)", async () => {
    const res = await bookingsPOST(adminReq({
      password: "x", action: "hold", bookingId: 9, holdExpiresAt: "2026-09-01T00:00:00.000Z",
    }));
    expect(res.status).toBe(200);
    expect(q.getBookingDetail).not.toHaveBeenCalled();
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, {
      status: "hold",
      holdExpiresAt: "2026-09-01T00:00:00.000Z",
    });
    expect(holdSql).toContain("NOT IN ('cancelled', 'checked_out', 'no_show')");
    expect(holdSql).not.toContain("'hold'");
  });

  it("webhook modify of hold is not closed — date move realigns", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "hold", persons: 2 }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "hold" },
      assignments: [assigned(7, 8), assigned(8, 8)],
    });
    q.checkBedAvailability.mockResolvedValue(true);
    const res = await reservationsPOST(webhookReq(bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 2, children: 0 },
        prices: [{ date: "2026-09-10", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.checkBedAvailability).toHaveBeenCalledWith(7, "2026-09-10", "2026-09-12", 9);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.status).toBe("hold");
    expect(patch.checkinDate).toBe("2026-09-10");
    expect(patch.checkoutDate).toBe("2026-09-12");
    expect(q.unassignBookingBeds).toHaveBeenCalled();
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      checkinDate: "2026-09-10",
      checkoutDate: "2026-09-12",
    }));
  });

  it("duplicate live hold book does not rebook", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "hold" }));
    const res = await reservationsPOST(webhookReq(bookPayload()));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/duplicate/i);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("source: hold action has no stayClosed; getExpiredHoldBookings is never called from routes", () => {
    expect(holdAction).toContain("status: \"hold\"");
    expect(holdAction).not.toContain("stayClosed");
    expect(holdAction).not.toContain("getBookingDetail");
    expect(queriesSrc).toContain("export async function getExpiredHoldBookings");
    expect(bookingsSrc).not.toContain("getExpiredHoldBookings");
    expect(reservationsSrc).not.toContain("getExpiredHoldBookings");
  });
});
