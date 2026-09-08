import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  addChannelSyncLog: vi.fn(),
  getChannelConfig: vi.fn(),
  addBooking: vi.fn(),
  updateBookingFull: vi.fn(),
  getBookingByRef: vi.fn(),
  unassignBookingBeds: vi.fn(),
  addBookingHistoryEntry: vi.fn(),
  getBookingDetail: vi.fn(),
  checkBedAvailability: vi.fn(),
  assignBedToBooking: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getAvailableBedsForRange: vi.fn(),
}));

const triggerInventoryPush = vi.hoisted(() => vi.fn());

vi.mock("@/db/queries", () => q);
vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush,
  triggerRatePush: vi.fn(),
  triggerRestrictionPush: vi.fn(),
}));

import { POST as reservationsPOST, ingestFetchedReservations } from "@/app/api/aiosell/reservations/route";

const activeConfig = {
  isActive: 1,
  hotelCode: "GOKO-001",
  webhookSecret: "whsec-test",
};

const mappings = [
  { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
  { dormId: 9, channelRoomCode: "dorm-6", isActive: 1, dormName: "Dorm 1" },
];

function req(body: unknown) {
  return new NextRequest("http://localhost/api/aiosell/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "whsec-test" },
    body: JSON.stringify(body),
  });
}

function bookPayload(over: Record<string, unknown> = {}) {
  return {
    action: "book" as const,
    hotelCode: "GOKO-001",
    channel: "booking.com",
    bookingId: "BK-R2-1",
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
    bookingRef: "BK-R2-1",
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
    ...over,
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

describe("Round 2 webhook book / modify / cancel / fetch", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(null);
    q.addBooking.mockResolvedValue(42);
    q.updateBookingFull.mockResolvedValue(undefined);
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

  it("book 2 persons 3 nights auto-assigns 2 online beds and does not push", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([
      ...online(8, [7, 8], "Executive"),
      { id: 70, bedId: "EXE-OFF", dormId: 8, dormName: "Executive", pool: "offline" },
    ]);
    const res = await reservationsPOST(req(bookPayload()));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      persons: 2,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      source: "channel_manager",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([7, 8]);
    expect(q.assignBedToBooking.mock.calls.every((c) =>
      c[0].bookingId === 42
      && c[0].dormId === 8
      && c[0].checkinDate === "2026-09-05"
      && c[0].checkoutDate === "2026-09-08"
      && c[0].inventoryPool === "online"
      && c[0].assignedBy === "channel_manager",
    )).toBe(true);
    expect(q.getAvailableBedsForRange).toHaveBeenCalledWith("2026-09-05", "2026-09-08", undefined, 42);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("book unmapped room stays Unassigned with no assign and no push", async () => {
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(req(bookPayload({
      bookingId: "BK-UNMAPPED",
      rooms: [{
        roomCode: "penthouse",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 9000 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-UNMAPPED",
      roomType: "penthouse",
    }));
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Unassigned",
      details: expect.stringMatching(/unmapped room type: penthouse/i),
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify occupancy 2→1 unassigns then auto-assigns 1 bed and does not push", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ persons: 2 }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [
        {
          bedId: 7, dormId: 8, status: "assigned",
          checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online",
        },
        {
          bedId: 8, dormId: 8, status: "assigned",
          checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online",
        },
      ],
    });
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(req(bookPayload({
      action: "modify",
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 7,
      dormId: 8,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Beds Auto-Assigned",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify room type executive→dorm-6 reseats into the dorm mapping and does not push", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ persons: 1, roomType: "executive" }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [{
        bedId: 7, dormId: 8, status: "assigned",
        checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online",
      }],
    });
    q.getAvailableBedsForRange.mockResolvedValue([
      ...online(8, [7], "Executive"),
      ...online(9, [40], "Dorm 1"),
    ]);
    const res = await reservationsPOST(req(bookPayload({
      action: "modify",
      rooms: [{
        roomCode: "dorm-6",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 1200 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      roomType: "dorm-6",
      persons: 1,
    }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 40,
      dormId: 9,
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify dates conflict releases the old assignment and reseats on the new stay", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({
      persons: 1,
      status: "confirmed",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      roomType: "executive",
    }));
    q.getBookingDetail
      .mockResolvedValueOnce({
        booking: { status: "confirmed" },
        assignments: [{
          bedId: 99, dormId: 9, status: "assigned",
          checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "offline",
        }],
      })
      .mockResolvedValueOnce({ booking: { status: "confirmed" }, assignments: [] });
    q.checkBedAvailability.mockResolvedValue(false);
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(req(bookPayload({
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
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 7,
      checkinDate: "2026-09-06",
      checkoutDate: "2026-09-10",
    }));
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.checkinDate).toBe("2026-09-06");
    expect(patch.checkoutDate).toBe("2026-09-10");
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("fetch skips an existing cancelled booking_ref with no rebook", async () => {
    q.getBookingByRef.mockImplementation(async (ref: string) => {
      if (ref === "BK-CANCELLED") return { id: 9, status: "cancelled", bookingRef: "BK-CANCELLED" };
      return null;
    });
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const result = await ingestFetchedReservations([
      bookPayload({ bookingId: "BK-CANCELLED" }),
      bookPayload({ bookingId: "BK-NEW" }),
    ]);
    expect(result).toEqual({ imported: 1, skipped: 1, refs: ["BK-NEW"] });
    expect(q.addBooking).toHaveBeenCalledTimes(1);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ bookingRef: "BK-NEW" }));
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("cancel webhook still pushes inventory for released nights", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "confirmed", persons: 1 }));
    q.getBookingDetail.mockResolvedValue({
      assignments: [{
        status: "assigned", bedId: 7, dormId: 8,
        checkinDate: "2026-09-05", checkoutDate: "2026-09-08",
      }],
    });
    const res = await reservationsPOST(req({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-R2-1",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "cancelled",
      cancelledBy: "channel_manager",
    }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Cancelled from Channel",
    }));
  });

  it("rooms[] without occupancy + persons 2 auto-assigns 2 online beds", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ persons: 2, roomType: "executive" }));
    q.getBookingDetail.mockResolvedValue({ booking: { status: "received" }, assignments: [] });
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(req(bookPayload({
      action: "modify",
      rooms: [{ roomCode: "executive", rateplanCode: "executive-s-ep" }],
    })));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ persons: 2 }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([7, 8]);
    expect(q.assignBedToBooking.mock.calls.every((c) =>
      c[0].inventoryPool === "online" && c[0].dormId === 8,
    )).toBe(true);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assign conflict refreshes tagged beds and retries without pushing", async () => {
    q.getAvailableBedsForRange
      .mockResolvedValueOnce(online(8, [7], "Executive"))
      .mockResolvedValueOnce(online(8, [8], "Executive"));
    q.assignBedToBooking.mockImplementation(async ({ bedId }: { bedId: number }) => bedId !== 7);
    const res = await reservationsPOST(req(bookPayload({
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.getAvailableBedsForRange).toHaveBeenCalledTimes(2);
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(42);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({ bedId: 7 }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 8,
      inventoryPool: "online",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });
});
