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
  syncBookingContactSnapshot: vi.fn(),
  dispatchPush: vi.fn(),
}));

const triggerInventoryPush = vi.hoisted(() => vi.fn());

vi.mock("@/db/queries", () => q);
vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush,
  triggerRatePush: vi.fn(),
  triggerRestrictionPush: vi.fn(),
}));
vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: q.dispatchPush,
  notificationFirstName: (name?: string) => name?.trim().split(/\s+/)[0] || "Guest",
  notificationDate: (date?: string) => date || "Unknown date",
  notificationStayDates: (checkin?: string, checkout?: string) => `${checkin || "Unknown date"} → ${checkout || "Unknown date"}`,
}));

import { POST as reservationsPOST } from "@/app/api/aiosell/reservations/route";

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
    bookingId: "BK-R3-1",
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
    bookingRef: "BK-R3-1",
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

describe("Round 3 webhook modify shrink / 0+0 / overflow / retry skip-list / cancel push", () => {
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
    q.dispatchPush.mockResolvedValue(undefined);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("alerts when an accepted OTA booking has no local online bed", async () => {
    const res = await reservationsPOST(req(bookPayload({ bookingId: "BK-RECON-1" })));

    expect(res.status).toBe(200);
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      action: "OTA Inventory Reconciliation Warning",
      performedBy: "channel_manager",
    }));
    expect(q.dispatchPush).toHaveBeenCalledWith(expect.objectContaining({
      title: "OTA Inventory Reconciliation Needed",
      url: "/admin?section=inventory",
      eventId: "ota-inventory-reconciliation-42",
      notificationType: "operations.ota_inventory_reconciliation",
      renotify: true,
    }));
  });

  it("modify occupancy 2→1 reseats to 1 online bed and does not push", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({
      persons: 2,
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
      }),
    }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [assigned(7, 8), assigned(8, 8)],
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
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ persons: 1 }));
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
    expect(q.dispatchPush).toHaveBeenCalledWith(expect.objectContaining({
      title: "Booking Modified",
      notificationType: "booking.modified",
    }));
  });

  it("modify occupancy 0+0 with existing.persons 2 uses 2 beds and does not shrink to 1", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({
      persons: 2,
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
      }),
    }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [assigned(7, 8), assigned(8, 8)],
    });
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
    const res = await reservationsPOST(req(bookPayload({
      action: "modify",
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 0, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ persons: 2 }));
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify guest-only with 1 mapped + 1 overflow (need 1) does not unassign", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({
      persons: 1,
      guestName: "Ada Lovelace",
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 1, children: 0 } }],
      }),
    }));
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [assigned(7, 8, "online"), assigned(40, 9, "offline")],
    });
    q.getAvailableBedsForRange.mockResolvedValue([
      ...online(8, [7, 8], "Executive"),
      ...online(9, [40], "Dorm 1"),
    ]);
    const res = await reservationsPOST(req(bookPayload({
      action: "modify",
      guest: { firstName: "Ada", lastName: "Byron", email: "ada@example.com", phone: "+91000" },
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    })));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      guestName: "Ada Byron",
      persons: 1,
      roomType: "executive",
    }));
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("book conflict skips the failed bed even when refresh still lists it", async () => {
    q.getAvailableBedsForRange.mockResolvedValue(online(8, [7, 8], "Executive"));
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
    expect(q.getAvailableBedsForRange).toHaveBeenNthCalledWith(1, "2026-09-05", "2026-09-08", undefined, 42);
    expect(q.getAvailableBedsForRange).toHaveBeenNthCalledWith(2, "2026-09-05", "2026-09-08", undefined, 42);
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(42);
    const attempted = q.assignBedToBooking.mock.calls.map((c) => c[0].bedId);
    expect(attempted.filter((id: number) => id === 7)).toHaveLength(1);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 8,
      dormId: 8,
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Beds Auto-Assigned",
    }));
    expect(q.dispatchPush).toHaveBeenCalledWith(expect.objectContaining({
      title: "New Booking",
      notificationType: "booking.new",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("cancel webhook still pushes inventory for released nights", async () => {
    q.getBookingByRef.mockResolvedValue(existingRow({ status: "confirmed", persons: 1 }));
    q.getBookingDetail.mockResolvedValue({
      assignments: [assigned(7, 8)],
    });
    const res = await reservationsPOST(req({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-R3-1",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "cancelled",
      cancelledBy: "channel_manager",
    }));
    expect(q.dispatchPush).toHaveBeenCalledWith(expect.objectContaining({
      title: "Booking Cancelled",
      notificationType: "booking.cancelled",
    }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Cancelled from Channel",
    }));
  });
});
