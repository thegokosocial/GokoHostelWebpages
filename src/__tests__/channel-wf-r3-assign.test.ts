import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getBookingCalendarData: vi.fn(),
  getBookingDetail: vi.fn(),
  searchBookings: vi.fn(),
  getUnassignedBookings: vi.fn(),
  getPendingWebsiteReservations: vi.fn(),
  hasPendingWebsiteCheckout: vi.fn(),
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
  getPendingWebsiteReservations: q.getPendingWebsiteReservations,
  hasPendingWebsiteCheckout: q.hasPendingWebsiteCheckout,
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

describe("assignBeds: mixed quota vs overflow skip", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappedRoomTypes);
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("mixed 2+1 with 2 Executive + 1 Dorm 1 → 200", async () => {
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
      bookingId: 42,
      bedId: 7,
      dormId: EXEC_DORM,
      inventoryPool: "offline",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 21,
      dormId: MIXED_DORM,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("assigns a one-single plus four-double OTA reservation by five sellable units, not five physical slots", async () => {
    const singleDorm = 14;
    const doubleDorm = 15;
    q.getRoomTypeMappings.mockResolvedValue([
      { dormId: singleDorm, channelRoomCode: "dorm-2---single-bed", isActive: 1, dormName: "Dorm 2 - single" },
      { dormId: doubleDorm, channelRoomCode: "dorm-2-double-bed", isActive: 1, dormName: "Dorm 2 - double" },
    ]);
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-10-01", checkoutDate: "2026-10-02", status: "received", source: "channel_manager",
        roomType: "dorm-2---single-bed, dorm-2-double-bed, dorm-2-double-bed, dorm-2-double-bed, dorm-2-double-bed",
        persons: 5,
        rawData: JSON.stringify({ rooms: [
          { roomCode: "dorm-2---single-bed", occupancy: { adults: 1, children: 0 } },
          ...Array.from({ length: 4 }, () => ({ roomCode: "dorm-2-double-bed", occupancy: { adults: 2, children: 0 } })),
        ] }),
      },
      assignments: [],
    });
    const selected = [
      { ...bedRow(1, singleDorm, "Dorm 2 - single"), type: "Single" },
      ...Array.from({ length: 8 }, (_, i) => ({ ...bedRow(i + 2, doubleDorm, "Dorm 2 - double"), type: "Double" })),
    ];
    q.getBedById.mockImplementation(async (id: number) => selected.find((bed) => bed.id === id) ?? null);
    q.getAvailableBedsForRange.mockResolvedValue(selected.map((bed) => ({ ...bed, pool: "online" })));

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: selected.map((bed) => bed.id) }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(9);
    expect(vi.mocked(pushIfOtaChanged)).not.toHaveBeenCalled();
  });

  function setupOneSingleFourDouble(selected: Array<ReturnType<typeof bedRow> & { type: string }>) {
    const singleDorm = 14;
    const doubleDorm = 15;
    q.getRoomTypeMappings.mockResolvedValue([
      { dormId: singleDorm, channelRoomCode: "dorm-2---single-bed", isActive: 1, dormName: "Dorm 2 - single" },
      { dormId: doubleDorm, channelRoomCode: "dorm-2-double-bed", isActive: 1, dormName: "Dorm 2 - double" },
    ]);
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-10-01", checkoutDate: "2026-10-02", status: "received", source: "channel_manager",
        roomType: "dorm-2---single-bed, dorm-2-double-bed, dorm-2-double-bed, dorm-2-double-bed, dorm-2-double-bed",
        persons: 5,
        rawData: JSON.stringify({ rooms: [
          { roomCode: "dorm-2---single-bed", occupancy: { adults: 1, children: 0 } },
          ...Array.from({ length: 4 }, () => ({ roomCode: "dorm-2-double-bed", occupancy: { adults: 2, children: 0 } })),
        ] }),
      },
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => selected.find((bed) => bed.id === id) ?? null);
    q.getAvailableBedsForRange.mockResolvedValue(selected.map((bed) => ({ ...bed, pool: "online" })));
  }

  it("rejects the same booking when one double is only half selected", async () => {
    const selected = [
      { ...bedRow(1, 14, "Dorm 2 - single"), type: "Single" },
      ...Array.from({ length: 7 }, (_, i) => ({ ...bedRow(i + 2, 15, "Dorm 2 - double"), type: "Double" })),
    ];
    setupOneSingleFourDouble(selected);
    q.getAllBeds.mockResolvedValue([
      ...selected,
      { ...bedRow(9, 15, "Dorm 2 - double"), type: "Double" },
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: selected.map((bed) => bed.id) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/complete double/i);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("rejects the same booking when fewer than five sellable units are selected", async () => {
    const selected = [
      { ...bedRow(1, 14, "Dorm 2 - single"), type: "Single" },
      ...Array.from({ length: 6 }, (_, i) => ({ ...bedRow(i + 2, 15, "Dorm 2 - double"), type: "Double" })),
    ];
    setupOneSingleFourDouble(selected);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: selected.map((bed) => bed.id) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only the units needed/i);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("rejects the same booking when five units have the wrong reserved-room split", async () => {
    const selected = [
      ...Array.from({ length: 5 }, (_, i) => ({ ...bedRow(i + 1, 14, "Dorm 2 - single"), type: "Single" })),
    ];
    setupOneSingleFourDouble(selected);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: selected.map((bed) => bed.id) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reserved room type/i);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("rejects a stale exact selection before writing any of its nine physical assignments", async () => {
    const selected = [
      { ...bedRow(1, 14, "Dorm 2 - single"), type: "Single" },
      ...Array.from({ length: 8 }, (_, i) => ({ ...bedRow(i + 2, 15, "Dorm 2 - double"), type: "Double" })),
    ];
    setupOneSingleFourDouble(selected);
    q.validateBedsForRange.mockResolvedValue("B4 is no longer available");

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: selected.map((bed) => bed.id) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer available/i);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("mixed 2+1 with 3 Executive beds → 400 and does not write", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: mixedBooking(),
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
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("2-person executive with 2 beds in another dorm → 200 overflow", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: execBooking(),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => bedRow(id, MIXED_DORM, "Dorm 1"));
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(21, MIXED_DORM, "Dorm 1", "offline"),
      tagged(22, MIXED_DORM, "Dorm 1", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [21, 22] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 21,
      dormId: MIXED_DORM,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("mixed 2+1 with 2 Executive + 1 other dorm is overflow 200 (dorm-match skipped)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: mixedBooking(),
      assignments: [],
    });
    q.getBedById.mockImplementation(async (id: number) => {
      if (id === 7 || id === 8) return bedRow(id, EXEC_DORM, "Executive");
      if (id === 31) return bedRow(id, OTHER_DORM, "Shiva");
      return null;
    });
    q.getAvailableBedsForRange.mockResolvedValue([
      tagged(7, EXEC_DORM, "Executive", "offline"),
      tagged(8, EXEC_DORM, "Executive", "offline"),
      tagged(31, OTHER_DORM, "Shiva", "offline"),
    ]);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 31] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(3);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 31,
      dormId: OTHER_DORM,
      inventoryPool: "offline",
    }));
  });
});

describe("getUnassigned requestedNeeds", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappedRoomTypes);
  });

  it("returns requestedNeeds array split by mapped dorm for mixed 2+1", async () => {
    q.getUnassignedBookings.mockResolvedValue([
      {
        id: 11,
        guestName: "Mix",
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-07",
        source: "channel_manager",
        roomType: "executive, dorm-6",
        persons: 3,
        rawData: JSON.stringify({
          rooms: [
            { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
            { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
          ],
        }),
      },
    ]);

    const res = await POST(req({ password: "x", action: "getUnassigned" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bookings).toHaveLength(1);
    expect(json.bookings[0]).toMatchObject({
      id: 11,
      requestedRoomCodes: ["executive", "dorm-6"],
      requestedDormIds: [EXEC_DORM, MIXED_DORM],
      requestedDormNames: ["Executive", "Dorm 1"],
      requestedBedCount: 3,
      requestedNeedLabels: "2 Executive, 1 Dorm 1",
      requestedNeeds: [
        { dormId: EXEC_DORM, count: 2, name: "Executive" },
        { dormId: MIXED_DORM, count: 1, name: "Dorm 1" },
      ],
    });
    expect(Array.isArray(json.bookings[0].requestedNeeds)).toBe(true);
  });
});

describe("Source-read: Unassigned quota chips and overflow label", () => {
  const unassigned = readFileSync("src/components/admin/booking-dashboard/UnassignedBookings.tsx", "utf8");
  const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
  const types = readFileSync("src/components/admin/booking-dashboard/types.ts", "utf8");

  it("canSelectBed caps requested-dorm chips at quota unless overflow is selected", () => {
    expect(unassigned).toContain("const canSelectBed = (bed: AvailableBed, booking: DashboardBooking) => {");
    expect(unassigned).toContain("isOverflowSelection(booking, selectedBeds)");
    expect(unassigned).toContain("requested.size > 0 && !requested.has(bed.dormId)");
    expect(unassigned).toContain("if (overflow) return true;");
    expect(unassigned).toContain("const quota = need?.units ?? need?.count");
    expect(unassigned).toContain("return inDorm < quota;");
    expect(unassigned).toContain("disabled={!isSelected && !allowed}");
  });

  it("renderDorm shows picked/quota and Other rooms are labelled overflow", () => {
    expect(types).toContain("requestedNeeds?: Array<{ dormId: number; count: number; units?: number; name: string }>");
    expect(unassigned).toContain("{picked}/{quota}");
    expect(unassigned).toContain("Other rooms (overflow)");
    expect(unassigned).toContain("Overflow does not have to match the room-type split");
    expect(unassigned).toContain("otherDorms.map((d) => renderDorm(d, booking))");
    expect(unassigned).toContain("quotas.length > 0 && !isOverflowSelection(booking, selectedBeds)");
  });

  it("assignBeds skips dorm-match 400 when any selected bed is outside requestedDormIds", () => {
    const assign = bookingsRoute.match(/action === "assignBeds"[\s\S]*?action === "checkIn"/)?.[0] ?? "";
    expect(assign).toContain("currentAssigned === 0 && enriched.requestedBedCount > 0");
    expect(assign).toContain("enriched.requestedDormIds.length > 0");
    expect(assign).toContain("!enriched.requestedDormIds.includes(bed.dormId)");
    expect(assign).toContain("!overflow");
    expect(assign).toContain("channelNeedsAreMapped(needs, mappings) && unitMismatch");
    expect(assign).toContain("currentAssigned + bedIds.length > enriched.requestedBedCount");
  });
});

describe("Hunt: assignBeds on already-assigned stay", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getRoomTypeMappings.mockResolvedValue(mappedRoomTypes);
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("400s when adding a bed would exceed one per person", async () => {
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
    expect(body.error).toMatch(/one per person/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("allows completing a 2-person stay that already has 1 bed", async () => {
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
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
  });
});
