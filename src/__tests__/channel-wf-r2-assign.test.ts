import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { countUnassignedOtaRooms, explodeUnassignedOtaHolds } from "@/lib/inventoryAvailability";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getBookingCalendarData: vi.fn(),
  getBookingDetail: vi.fn(),
  searchBookings: vi.fn(),
  getUnassignedBookings: vi.fn(),
  checkBedAvailability: vi.fn(),
  getAvailableBedsForRange: vi.fn(),
  validateBedsForRange: vi.fn(),
  assignBedToBooking: vi.fn(),
  unassignBookingBeds: vi.fn(),
  unassignBookingBedsByBedIds: vi.fn(),
  cancelBedAssignments: vi.fn(),
  addBookingHistoryEntry: vi.fn(),
  getBookingHistoryEntries: vi.fn(),
  addBooking: vi.fn(),
  updateBookingFull: vi.fn(),
  getAllDorms: vi.fn(),
  getAllBeds: vi.fn(),
  getBedById: vi.fn(),
  getChannelConfig: vi.fn(),
  getSetting: vi.fn(),
  getActiveBedBlocks: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getRatePlanMappings: vi.fn(),
  getAllDailyRates: vi.fn(),
  deactivateBedBlocksByBedIds: vi.fn(),
  shortenAssignedCheckout: vi.fn(),
  pushNoShow: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
}));
vi.mock("@/lib/aiosell", () => ({
  pushNoShow: q.pushNoShow,
}));
vi.mock("@/db/queries", () => ({
  getBookingCalendarData: q.getBookingCalendarData,
  getBookingDetail: q.getBookingDetail,
  searchBookings: q.searchBookings,
  getUnassignedBookings: q.getUnassignedBookings,
  checkBedAvailability: q.checkBedAvailability,
  getAvailableBedsForRange: q.getAvailableBedsForRange,
  validateBedsForRange: q.validateBedsForRange,
  assignBedToBooking: q.assignBedToBooking,
  unassignBookingBeds: q.unassignBookingBeds,
  unassignBookingBedsByBedIds: q.unassignBookingBedsByBedIds,
  cancelBedAssignments: q.cancelBedAssignments,
  addBookingHistoryEntry: q.addBookingHistoryEntry,
  getBookingHistoryEntries: q.getBookingHistoryEntries,
  addBooking: q.addBooking,
  updateBookingFull: q.updateBookingFull,
  getAllDorms: q.getAllDorms,
  getAllBeds: q.getAllBeds,
  getBedById: q.getBedById,
  getChannelConfig: q.getChannelConfig,
  getSetting: q.getSetting,
  getActiveBedBlocks: q.getActiveBedBlocks,
  getRoomTypeMappings: q.getRoomTypeMappings,
  getRatePlanMappings: q.getRatePlanMappings,
  getAllDailyRates: q.getAllDailyRates,
  deactivateBedBlocksByBedIds: q.deactivateBedBlocksByBedIds,
  shortenAssignedCheckout: q.shortenAssignedCheckout,
}));

import { POST } from "@/app/api/admin/bookings/route";
import { pushIfOtaChanged } from "@/lib/aiosellSync";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };

const EXEC_DORM = 8;
const MIXED_DORM = 9;

const mappedRoomTypes = [
  { dormId: EXEC_DORM, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
  { dormId: MIXED_DORM, channelRoomCode: "dorm-6", isActive: 1, dormName: "Dorm 1" },
];

function bedRow(id: number, dormId: number, dormName: string) {
  return { id, bedId: `B${id}`, dormId, dormName, status: "available" };
}

function tagged(id: number, dormId: number, dormName: string, pool: "online" | "offline") {
  return { id, bedId: `B${id}`, dormId, dormName, pool };
}

function cmBooking(extra: Record<string, unknown> = {}) {
  return {
    checkinDate: "2026-09-05",
    checkoutDate: "2026-09-07",
    status: "received",
    source: "channel_manager",
    roomType: "executive",
    persons: 2,
    ...extra,
  };
}

describe("assignBeds: Unassigned leftover chips and mapped-type guards", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappedRoomTypes);
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("2-person CM stay with 2 offline chips → 200, stores inventoryPool offline, no Aiosell push", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: cmBooking(),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => (
      id === 7 || id === 8 ? bedRow(id, EXEC_DORM, "Executive") : null
    ));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
      tagged(8, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, assigned: ["Executive/B7", "Executive/B8"] });
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      bedId: 7,
      dormId: EXEC_DORM,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      inventoryPool: "offline",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 8,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("2-person CM stay with 1 bed → 400 and does not write assignments", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: cmBooking({ checkoutDate: "2026-09-06" }),
      assignments: [],
    });
    q.getBedById.mockResolvedValue(bedRow(7, EXEC_DORM, "Executive"));

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/2 guest/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("mixed 2 executive + 1 dorm dumped as three Executive beds → 400", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: cmBooking({
        roomType: "executive, dorm-6",
        persons: 3,
        rawData: JSON.stringify({
          rooms: [
            { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
            { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
          ],
        }),
      }),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => bedRow(id, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
      tagged(8, EXEC_DORM, "Executive", "offline"),
      tagged(9, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 9] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Executive/);
    expect(body.error).toMatch(/Dorm 1/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("unmapped roomType: 1 bed in any dorm → 200 (no dorm-match 400)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: cmBooking({
        roomType: "family-unknown",
        persons: 1,
      }),
      assignments: [],
    });
    q.getBedById.mockResolvedValue(bedRow(21, MIXED_DORM, "Dorm 1"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(21, MIXED_DORM, "Dorm 1", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [21] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 21,
      dormId: MIXED_DORM,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("walk-in/manual without roomType can assign N beds (requestedBedCount 0 skips count check)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
        persons: 1,
      },
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => bedRow(id, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "online"),
      tagged(8, EXEC_DORM, "Executive", "online"),
      tagged(9, EXEC_DORM, "Executive", "online"),
    ]);

    const res = await POST(req({
      password: "x", action: "assignBeds", bookingId: 88, bedIds: [7, 8, 9],
    }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(3);
  });

  it("rolls back the first bed via unassignBookingBedsByBedIds when a later write fails", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: cmBooking(),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => (
      id === 7 || id === 8 ? bedRow(id, EXEC_DORM, "Executive") : null
    ));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
      tagged(8, EXEC_DORM, "Executive", "offline"),
    ]);
    q.assignBedToBooking.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8] }));
    expect(res.status).toBe(409);
    expect(q.unassignBookingBedsByBedIds).toHaveBeenCalledWith(42, [7]);
    expect(q.addBookingHistoryEntry).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });
});

describe("OTA unassigned hold: rooms not persons; released only by online assign", () => {
  it("a 2-person sold executive room holds 1 room, not 2 persons", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
      }),
    }])).toBe(1);
  });

  it("webhook excludeBookingId drops that stay's hold so auto-assign can take its online slots", () => {
    const mappings = [{ dormId: EXEC_DORM, channelRoomCode: "executive" }];
    const row = {
      id: 42,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      roomType: "executive",
      rawData: JSON.stringify({ rooms: [{ roomCode: "executive" }] }),
    };
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-07")).toEqual([
      { dormId: EXEC_DORM, date: "2026-09-05", rooms: 1 },
      { dormId: EXEC_DORM, date: "2026-09-06", rooms: 1 },
    ]);
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-07", 42)).toEqual([]);
  });

  it("getUnassignedOta* SQL still holds the sold room when overflow is only offline-assigned", () => {
    const queries = readFileSync("src/db/queries.ts", "utf8");
    const roomCount = queries.match(/export async function getUnassignedOtaRoomCountForDorm[\s\S]*?\nexport async function getUnassignedOtaHoldsForRange/)?.[0] ?? "";
    const holds = queries.match(/export async function getUnassignedOtaHoldsForRange[\s\S]*?\nexport async function checkBedAvailability/)?.[0] ?? "";
    expect(roomCount).toContain("countUnassignedOtaRooms");
    expect(roomCount).toContain("coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'");
    expect(holds).toContain("explodeUnassignedOtaHolds(rows, mappings, startDate, endExclusive, excludeBookingId)");
    expect(holds).toContain("coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'");
    expect(holds).toContain("excludeBookingId?: number");
  });
});

describe("Source-read: Unassigned getAvailableBeds vs webhook excludeBookingId", () => {
  const unassigned = readFileSync("src/components/admin/booking-dashboard/UnassignedBookings.tsx", "utf8");
  const reservations = readFileSync("src/app/api/aiosell/reservations/route.ts", "utf8");
  const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");

  it("Unassigned getAvailableBeds payload passes bookingId to release its own hold", () => {
    const payload = unassigned.match(/payload: Record<string, unknown> = \{[^}]+\}/)?.[0] ?? "";
    expect(payload).toContain('action: "getAvailableBeds"');
    expect(payload).toContain("checkinDate, checkoutDate");
    expect(payload).toContain("bookingId: booking.id");
  });

  it("webhook auto-assign passes excludeBookingId so the new row can take its held online slots", () => {
    const fn = reservations.match(/async function tryAutoAssignChannelBeds[\s\S]*?\nasync function /)?.[0]
      ?? reservations.match(/async function tryAutoAssignChannelBeds[\s\S]*$/)?.[0]
      ?? "";
    expect(fn).toContain("getAvailableBedsForRange(checkin, co, undefined, bookingId)");
    expect(fn).toContain("refreshTagged: loadTagged");
    expect(fn).not.toMatch(/getAvailableBedsForRange\(checkin, co\)\s*;/);
  });

  it("assignTaggedBeds excludes the current booking hold and rolls back by bed ids", () => {
    const helper = bookingsRoute.match(/async function assignTaggedBeds[\s\S]*?\nfunction assignFailed/)?.[0] ?? "";
    expect(helper).toContain("getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId)");
    expect(helper).toContain("inventoryPool: p.pool");
    expect(helper).toContain("unassignBookingBedsByBedIds(bookingId, written)");
  });
});
