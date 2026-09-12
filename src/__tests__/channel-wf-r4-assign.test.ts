import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

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
const OTHER_DORM = 10;

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

function mixedBooking(extra: Record<string, unknown> = {}) {
  return {
    checkinDate: "2026-09-05",
    checkoutDate: "2026-09-07",
    status: "received",
    source: "channel_manager",
    roomType: "executive, dorm-6",
    persons: 3,
    rawData: JSON.stringify({
      rooms: [
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
      ],
    }),
    ...extra,
  };
}

function execBooking(extra: Record<string, unknown> = {}) {
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

describe("assignBeds: already-assigned cap (complete 1-of-2 vs overflow add)", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappedRoomTypes);
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("already-assigned 1 of 2, add 1 more → 200", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(8, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(8, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [8] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, assigned: ["Executive/B8"] });
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      bedId: 8,
      dormId: EXEC_DORM,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("already-assigned 2 of 2, add 1 more → 400", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
        { id: 2, bedId: 8, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(9, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(9, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [9] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already has 2 of 2/);
    expect(body.error).toMatch(/one per person/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.validateBedsForRange).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("already-assigned 1 of 2, add 2 → 400", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockImplementation(async (id: number) => bedRow(id, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(8, EXEC_DORM, "Executive", "offline"),
      tagged(9, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [8, 9] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already has 1 of 2/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("currentAssigned 0, count match, mapped mixed 2+1 correct dorms → 200", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: mixedBooking(),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => {
      if (id === 7 || id === 8) return bedRow(id, EXEC_DORM, "Executive");
      if (id === 21) return bedRow(id, MIXED_DORM, "Dorm 1");
      return null;
    });
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
      tagged(8, EXEC_DORM, "Executive", "offline"),
      tagged(21, MIXED_DORM, "Dorm 1", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 21] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      assigned: ["Executive/B7", "Executive/B8", "Dorm 1/B21"],
    });
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(3);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 7,
      dormId: EXEC_DORM,
      inventoryPool: "offline",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 21,
      dormId: MIXED_DORM,
      inventoryPool: "offline",
    }));
  });

  it("currentAssigned 0, 2-person executive, 2 available EXE beds → 200", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking({
        rawData: JSON.stringify({
          rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
        }),
      }),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => bedRow(id, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(78, EXEC_DORM, "Executive", "online"),
      tagged(79, EXEC_DORM, "Executive", "online"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 139, bedIds: [78, 79] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      assigned: ["Executive/B78", "Executive/B79"],
    });
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
  });
});

describe("Source-read: Unassigned cannot POST extra beds", () => {
  const unassigned = readFileSync("src/components/admin/booking-dashboard/UnassignedBookings.tsx", "utf8");
  const dashboard = readFileSync("src/components/admin/booking-dashboard/index.tsx", "utf8");
  const queries = readFileSync("src/db/queries.ts", "utf8");
  const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");

  it("getUnassigned requires zero assigned beds", () => {
    const fn = queries.match(/export async function getUnassignedBookings\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("NOT EXISTS");
    expect(fn).toContain("status} = 'assigned'");
    expect(fn).toContain("${bookingBedAssignments.bookingId} = ${bookings.id}");
    expect(dashboard).toContain('action: "getUnassigned"');
    expect(dashboard).toContain('handleBookingAction("assignBeds", bookingId, { bedIds }');
  });

  it("Unassigned chips cannot exceed quota (canSelectBed / exact count / overflow label)", () => {
    expect(unassigned).toContain("if (selectedBeds.length >= bedsNeeded(booking)) return false;");
    expect(unassigned).toContain("return inDorm < quota;");
    expect(unassigned).toContain("if (selectedBeds.length !== need)");
    expect(unassigned).toContain("disabled={selectedBeds.length !== need || busy || loadingBeds}");
    expect(unassigned).toContain("{picked}/{quota}");
    expect(unassigned).toContain("Other rooms (overflow)");
    expect(unassigned).toContain('action: "getAvailableBeds", checkinDate, checkoutDate, bookingId: booking.id }');
    expect(dashboard).toContain('handleBookingAction("cancelBooking", bookingId)');
  });

  it("assignBeds cap is currentAssigned + bedIds.length, count+match only when currentAssigned === 0", () => {
    const assign = bookingsRoute.match(/action === "assignBeds"[\s\S]*?action === "checkIn"/)?.[0] ?? "";
    expect(assign).toContain("currentAssigned + bedIds.length > enriched.requestedBedCount");
    expect(assign).toContain("currentAssigned === 0 && enriched.requestedBedCount > 0");
    expect(assign).toContain("selectedCapacity - unit.capacity >= detail.booking.persons");
    expect(assign).toContain("!overflow");
    expect(assign).toContain("channelNeedsAreMapped(needs, mappings) && unitMismatch");
    expect(assign).toContain("rawBedIds.map((id: unknown) => Number(id))");
  });
});

describe("Hunt: duplicate ids, string ids, overflow+cap, editReservation uncapped", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappedRoomTypes);
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("string bed ids complete 1-of-2 → 200 (Number coercion)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(8, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(8, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: ["8"] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({ bedId: 8 }));
  });

  it("duplicate bedIds [8,8] on already-assigned 1 of 2 → 400 (length, not unique)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(8, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(8, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [8, 8] }));
    expect(res.status).toBe(400);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("duplicate bedIds [7,7] on unassigned 2-person stay counts length 2 (cap does not unique)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [],
    });
    q.getBedById.mockResolvedValue(bedRow(7, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 7] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking).toHaveBeenNthCalledWith(1, expect.objectContaining({ bedId: 7 }));
    expect(q.assignBedToBooking).toHaveBeenNthCalledWith(2, expect.objectContaining({ bedId: 7 }));
  });

  it("overflow + cap: 1 of 2 plus one other-dorm bed → 200 (dorm-match skipped when already assigned)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(31, OTHER_DORM, "Shiva"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(31, OTHER_DORM, "Shiva", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [31] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 31,
      dormId: OTHER_DORM,
      inventoryPool: "offline",
    }));
  });

  it("overflow does not bypass cap: 2 of 2 plus overflow bed → 400", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
        { id: 2, bedId: 8, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(31, OTHER_DORM, "Shiva"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(31, OTHER_DORM, "Shiva", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [31] }));
    expect(res.status).toBe(400);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("overflow skip still requires count when currentAssigned is 0 (4 beds for mixed 2+1 → 400)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: mixedBooking(),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => {
      if (id === 7 || id === 8) return bedRow(id, EXEC_DORM, "Executive");
      if (id === 31 || id === 32) return bedRow(id, OTHER_DORM, "Shiva");
      return null;
    });
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
      tagged(8, EXEC_DORM, "Executive", "offline"),
      tagged(31, OTHER_DORM, "Shiva", "offline"),
      tagged(32, OTHER_DORM, "Shiva", "offline"),
    ]);

    const res = await POST(req({
      password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 31, 32],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/units needed for 3 guest/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("editReservation addBedIds is uncapped vs assignBeds (calendar extra-bed path)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [
        { id: 1, bedId: 7, dormId: EXEC_DORM, status: "assigned" },
        { id: 2, bedId: 8, dormId: EXEC_DORM, status: "assigned" },
      ],
    });
    q.getBedById.mockResolvedValue(bedRow(9, EXEC_DORM, "Executive"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(9, EXEC_DORM, "Executive", "offline"),
    ]);

    const res = await POST(req({
      password: "x", action: "editReservation", bookingId: 42, addBedIds: [9],
    }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      bedId: 9,
      dormId: EXEC_DORM,
    }));
  });

  it("source: editReservation addBedIds has no requestedBedCount / currentAssigned cap", () => {
    const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
    const edit = bookingsRoute.match(/action === "editReservation"[\s\S]*?action === "moveRoom"/)?.[0] ?? "";
    expect(edit).toContain("addBedIds");
    expect(edit).toContain("assignTaggedBeds(bookingId, addBedIds");
    expect(edit).not.toContain("requestedBedCount");
    expect(edit).not.toContain("currentAssigned");
    expect(edit).not.toContain("assignedBedsMatchNeeds");
  });
});
