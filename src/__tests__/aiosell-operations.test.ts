import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { captured, q } = vi.hoisted(() => {
  const captured: Record<string, unknown>[] = [];
  return {
    captured,
    q: {
      addChannelSyncLog: vi.fn(async (row: Record<string, unknown>) => {
        captured.push(row);
      }),
      getChannelConfig: vi.fn(),
      upsertChannelConfig: vi.fn(),
      getRoomTypeMappings: vi.fn(),
      upsertRoomTypeMapping: vi.fn(),
      deleteRoomTypeMapping: vi.fn(),
      getRatePlanMappings: vi.fn(),
      upsertRatePlanMapping: vi.fn(),
      deleteRatePlanMapping: vi.fn(),
      getDailyRates: vi.fn(),
      bulkUpsertDailyRates: vi.fn(),
      getAllDailyRates: vi.fn(),
      getChannelSyncLogs: vi.fn(),
      getAllDorms: vi.fn(),
      getAllBeds: vi.fn(),
      addBooking: vi.fn(),
      updateBookingFull: vi.fn(),
      getSetting: vi.fn(),
      setSetting: vi.fn(),
      getBookingByRef: vi.fn(),
      unassignBookingBeds: vi.fn(),
      addBookingHistoryEntry: vi.fn(),
      getBookingDetail: vi.fn(),
      checkBedAvailability: vi.fn(),
      assignBedToBooking: vi.fn(),
      getAvailableBedsForRange: vi.fn(),
      updateChannelSyncTime: vi.fn(),
      getDirtyInventory: vi.fn(),
      clearDirtyInventory: vi.fn(),
      clearAllDirtyInventory: vi.fn(),
      markRatesSynced: vi.fn(),
    },
  };
});

const pushInventory = vi.hoisted(() => vi.fn());
const pushRates = vi.hoisted(() => vi.fn());
const pushRateRestrictions = vi.hoisted(() => vi.fn());
const pushInventoryRestrictions = vi.hoisted(() => vi.fn());
const pushNoShow = vi.hoisted(() => vi.fn());
const fetchFromAiosell = vi.hoisted(() => vi.fn());
const getAiosellPropertyDetails = vi.hoisted(() => vi.fn());
const getDateAwareAvailability = vi.hoisted(() => vi.fn());
const getDateAwareAvailabilityRange = vi.hoisted(() => vi.fn());
const triggerInventoryPush = vi.hoisted(() => vi.fn());

vi.mock("@/db/queries", () => q);
vi.mock("@/lib/auth", () => ({
  authenticateUser: vi.fn(),
}));
vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush,
  triggerRatePush: vi.fn(),
  triggerRestrictionPush: vi.fn(),
  getDateAwareAvailability,
  getDateAwareAvailabilityRange,
  pushIfOtaChanged: vi.fn(),
  otaFingerprint: vi.fn(),
}));
vi.mock("@/lib/aiosell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aiosell")>();
  return {
    ...actual,
    pushInventory,
    pushRates,
    pushRateRestrictions,
    pushInventoryRestrictions,
    pushNoShow,
    fetchFromAiosell,
    getAiosellPropertyDetails,
  };
});

import { authenticateUser } from "@/lib/auth";
import { restrictionPatch } from "@/lib/aiosell";
import { POST as reservationsPOST, ingestFetchedReservations } from "@/app/api/aiosell/reservations/route";
import { POST as channelManagerPOST } from "@/app/api/admin/channel-manager/route";
import { POST as pushInventoryPOST } from "@/app/api/aiosell/push-inventory/route";
import { POST as pushRatesPOST } from "@/app/api/aiosell/push-rates/route";
import { POST as fetchPOST } from "@/app/api/aiosell/fetch/route";
import { POST as pushNoShowPOST } from "@/app/api/aiosell/push-noshow/route";
import { POST as pushInvRestrictPOST } from "@/app/api/aiosell/push-inventory-restrictions/route";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const activeConfig = {
  isActive: 1,
  hotelCode: "GOKO-001",
  webhookSecret: "whsec-test",
  pmsId: "goko-pms",
  apiBaseUrl: "https://live.aiosell.com",
  apiUsername: "aiosell",
  apiPassword: "secret",
  autoPushInventory: 1,
  autoPushRates: 1,
  autoPushRateRestrictions: 1,
};

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function adminBody(extra: Record<string, unknown> = {}) {
  return { password: "x", username: "admin", ...extra };
}

const mappings = [
  { id: 1, dormId: 8, channelRoomCode: "executive", isActive: 1 },
  { id: 2, dormId: 9, channelRoomCode: "dorm-6", isActive: 1 },
];
const plans = [
  { id: 10, roomMappingId: 1, ratePlanCode: "executive-s-ep", ratePlanName: "EP", isActive: 1 },
  { id: 11, roomMappingId: 1, ratePlanCode: "executive-s-map", ratePlanName: "MAP", isActive: 1 },
];
const propertyDetails = { success: true, details: { hotel_id: "GOKO-001", rooms: [
  { room_id: "executive", active: true, rateplans: [{ rateplan_id: "executive-s-ep" }, { rateplan_id: "executive-s-map" }] },
  { room_id: "dorm-6", active: true, rateplans: [] },
] } };

function bookPayload(over: Record<string, unknown> = {}) {
  return {
    action: "book" as const,
    hotelCode: "GOKO-001",
    channel: "booking.com",
    bookingId: "BK-OPS-1",
    checkin: "2026-09-05",
    checkout: "2026-09-08",
    guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+91000" },
    rooms: [{
      roomCode: "executive",
      rateplanCode: "executive-s-ep",
      guestName: "Ada Lovelace",
      occupancy: { adults: 1, children: 0 },
      prices: [
        { date: "2026-09-05", sellRate: 3700 },
        { date: "2026-09-06", sellRate: 3700 },
        { date: "2026-09-07", sellRate: 3700 },
      ],
    }],
    amount: { amountAfterTax: 12320, amountBeforeTax: 11000, tax: 1320, currency: "INR" },
    ...over,
  };
}

describe("restrictionPatch remaining CM keys", () => {
  it.each([
    ["closeOnArrival", true, { closeOnArrival: true }],
    ["closeOnDeparture", false, { closeOnDeparture: false }],
    ["maximumStay", 7, { maximumStay: 7 }],
    ["minimumAdvanceReservation", 2, { minimumAdvanceReservation: 2 }],
    ["maximumAdvanceReservation", 30, { maximumAdvanceReservation: 30 }],
    ["minimumStay", "", { minimumStay: null }],
    ["stopSell", 0, { stopSell: false }],
  ] as const)("%s", (key, value, expected) => {
    expect(restrictionPatch(key, value)).toEqual(expected);
  });

  it("returns null for an unknown key", () => {
    expect(restrictionPatch("minimumStayArrival", 2)).toBeNull();
  });
});

describe("Webhook auth combinations", () => {
  beforeEach(() => {
    captured.length = 0;
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(null);
    q.addBooking.mockResolvedValue(88);
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    triggerInventoryPush.mockReset();
  });

  it.each([
    ["raw secret", { authorization: "whsec-test" }],
    ["Bearer", { authorization: "Bearer whsec-test" }],
    ["x-api-key", { "x-api-key": "whsec-test" }],
    ["Basic user:secret", { authorization: `Basic ${btoa("goko:whsec-test")}` }],
    ["Basic secret-only", { authorization: `Basic ${btoa("whsec-test")}` }],
  ] as const)("accepts %s", async (_label, headers) => {
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload(), headers));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalled();
  });

  it("503s when webhookSecret is empty even if CM is active", async () => {
    q.getChannelConfig.mockResolvedValue({ ...activeConfig, webhookSecret: "" });
    const res = await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      bookPayload(),
      { authorization: "whsec-test" },
    ));
    expect(res.status).toBe(503);
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("401s with the wrong secret", async () => {
    const res = await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      bookPayload(),
      { authorization: "wrong-secret" },
    ));
    expect(res.status).toBe(401);
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it.each([
    ["config is null", null],
    ["channel is inactive", { ...activeConfig, isActive: 0 }],
  ])("503s when %s", async (_label, config) => {
    q.getChannelConfig.mockResolvedValue(config);
    const res = await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      bookPayload(),
      { authorization: "whsec-test" },
    ));
    expect(res.status).toBe(503);
    expect(q.addBooking).not.toHaveBeenCalled();
  });
});

describe("Webhook reservation combinations", () => {
  beforeEach(() => {
    captured.length = 0;
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(null);
    q.addBooking.mockResolvedValue(88);
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.getBookingDetail.mockResolvedValue({ assignments: [] });
    q.checkBedAvailability.mockResolvedValue(true);
    q.assignBedToBooking.mockResolvedValue(true);
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    triggerInventoryPush.mockReset();
    triggerInventoryPush.mockResolvedValue(undefined);
  });

  it("stores PAH vs prepaid from the pah flag", async () => {
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({ pah: true }), { authorization: "whsec-test" }));
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "pay_at_hotel" }));
    q.addBooking.mockClear();
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({ pah: false, bookingId: "BK-PRE" }), { authorization: "whsec-test" }));
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "prepaid" }));
    q.addBooking.mockClear();
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({ bookingId: "BK-NOPAH" }), { authorization: "whsec-test" }));
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "unknown" }));
  });

  it("modify without pah keeps existing prepaid; pah true overwrites to pay_at_hotel", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "received",
      guestName: "Ada",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      persons: 1,
      paymentStatus: "prepaid",
    });
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received", persons: 1, roomType: "executive" },
      assignments: [{
        status: "assigned", bedId: 7, dormId: 8,
        checkinDate: "2026-09-05", checkoutDate: "2026-09-08",
      }],
    });
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({ action: "modify" }), { authorization: "whsec-test" }));
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({ paymentStatus: "prepaid" }));
    q.updateBookingFull.mockClear();
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({ action: "modify", pah: true }), { authorization: "whsec-test" }));
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({ paymentStatus: "pay_at_hotel" }));
  });

  it("counts children-only occupancy and missing guest as Unknown", async () => {
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      bookingId: "BK-KIDS",
      guest: undefined,
      rooms: [{
        roomCode: "dorm-6",
        rateplanCode: "STD",
        occupancy: { adults: 0, children: 2 },
        prices: [{ date: "2026-09-05", sellRate: 900 }],
      }],
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      guestName: "Unknown Guest",
      persons: 2,
      nightlyRate: 900,
      source: "channel_manager",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("Hostelworld 1-night book is unassigned and does not push", async () => {
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      channel: "hostelworld",
      bookingId: "HW-1",
      checkin: "2026-09-05",
      checkout: "2026-09-06",
      rooms: [{
        roomCode: "dorm-6",
        rateplanCode: "STD",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 800 }],
      }],
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      platform: "hostelworld",
      source: "channel_manager",
      persons: 1,
      nightlyRate: 800,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
    }));
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns 1 online bed per person for any mapped room type and does not push", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 11, bedId: "D1", dormId: 9, dormName: "Dorm 1", pool: "online" },
      { id: 12, bedId: "D2", dormId: 9, dormName: "Dorm 1", pool: "online" },
      { id: 90, bedId: "DOFF", dormId: 9, dormName: "Dorm 1", pool: "offline" },
    ]);
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      bookingId: "HW-2P",
      channel: "hostelworld",
      checkin: "2026-09-05",
      checkout: "2026-09-07",
      rooms: [{
        roomCode: "dorm-6",
        rateplanCode: "STD",
        occupancy: { adults: 2, children: 0 },
        prices: [
          { date: "2026-09-05", sellRate: 800 },
          { date: "2026-09-06", sellRate: 800 },
        ],
      }],
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 11,
      dormId: 9,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      inventoryPool: "online",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 12,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("empty rooms still books with persons fallback 1 and nightly 0", async () => {
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      bookingId: "BK-EMPTY",
      rooms: [],
      amount: { amountAfterTax: 0, amountBeforeTax: 0, tax: 0, currency: "INR" },
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      persons: 1,
      nightlyRate: 0,
      roomType: "",
    }));
  });

  it("reuses a no_show bookingRef the same way as cancelled", async () => {
    q.getBookingByRef.mockResolvedValue({ id: 12, status: "no_show", bookingRef: "BK-OPS-1" });
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload(), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({
      status: "received",
      cancelledAt: "",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify of a cancelled stay updates guest but does not move dates or beds", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "cancelled",
      guestName: "Old",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      persons: 1,
    });
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "cancelled" },
      assignments: [{ status: "assigned", bedId: 7, dormId: 8, checkinDate: "2026-09-05", checkoutDate: "2026-09-08" }],
    });
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.guestName).toBe("Ada Lovelace");
    expect(patch).not.toHaveProperty("checkinDate");
    expect(patch).not.toHaveProperty("checkoutDate");
    expect(patch.status).toBe("cancelled");
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify with the same dates does not unassign", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "received",
      guestName: "Ada",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      persons: 1,
    });
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "received" },
      assignments: [{
        status: "assigned", bedId: 7, dormId: 8,
        checkinDate: "2026-09-05", checkoutDate: "2026-09-08",
      }],
    });
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({ action: "modify" }), { authorization: "whsec-test" }));
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("cancel unknown ref succeeds without a D1 write or inventory push", async () => {
    q.getBookingByRef.mockResolvedValue(null);
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", {
      action: "cancel", hotelCode: "GOKO-001", channel: "Direct", bookingId: "MISSING",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("cancel of an unassigned stay pushes booking nights, not today", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12, status: "received",
      checkinDate: "2026-09-05", checkoutDate: "2026-09-08",
    });
    q.getBookingDetail.mockResolvedValue({ assignments: [] });
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", {
      action: "cancel", hotelCode: "GOKO-001", channel: "booking.com", bookingId: "BK-OPS-1",
    }, { authorization: "whsec-test" }));
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  it("400s when hotelCode does not match config", async () => {
    const res = await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      bookPayload({ hotelCode: "OTHER" }),
      { authorization: "whsec-test" },
    ));
    expect(res.status).toBe(400);
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("duplicate live book is idempotent", async () => {
    q.getBookingByRef.mockResolvedValue({ id: 12, status: "received", bookingRef: "BK-OPS-1" });
    const res = await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      bookPayload(),
      { authorization: "whsec-test" },
    ));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/duplicate/i);
    expect(q.addBooking).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("stores cmBookingId on book", async () => {
    await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      bookPayload({ cmBookingId: "CM-OPS-1" }),
      { authorization: "whsec-test" },
    ));
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ cmBookingId: "CM-OPS-1" }));
  });

  it("modify of checked_out updates guest but does not move dates or beds", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "checked_out",
      guestName: "Old",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      persons: 1,
    });
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "checked_out" },
      assignments: [{ status: "assigned", bedId: 7, dormId: 8, checkinDate: "2026-09-05", checkoutDate: "2026-09-08" }],
    });
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.guestName).toBe("Ada Lovelace");
    expect(patch).not.toHaveProperty("checkinDate");
    expect(patch).not.toHaveProperty("checkoutDate");
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify of no_show does not move dates", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "no_show",
      guestName: "Old",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      persons: 1,
    });
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch).not.toHaveProperty("checkinDate");
    expect(patch).not.toHaveProperty("checkoutDate");
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify of an unassigned stay with new dates updates the booking but does not assign beds", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "received",
      guestName: "Ada",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      persons: 1,
    });
    q.getBookingDetail.mockResolvedValue({ booking: { status: "received" }, assignments: [] });
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({
      checkinDate: "2026-09-10",
      checkoutDate: "2026-09-12",
    }));
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("modify moves dates and reassigns when the old bed conflicts on the new stay", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "received",
      guestName: "Ada",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      roomType: "executive",
      persons: 1,
    });
    q.getBookingDetail
      .mockResolvedValueOnce({
        booking: { status: "received" },
        assignments: [{
          status: "assigned", bedId: 7, dormId: 8,
          checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online",
        }],
      })
      .mockResolvedValueOnce({ booking: { status: "received" }, assignments: [] });
    q.checkBedAvailability.mockResolvedValue(false);
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 8, bedId: "DOUBLE 2", dormId: 8, dormName: "Executive", pool: "online" },
    ]);

    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
    }), { authorization: "whsec-test" }));

    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({
      checkinDate: "2026-09-10",
      checkoutDate: "2026-09-12",
    }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(12);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 12,
      bedId: 8,
      checkinDate: "2026-09-10",
      checkoutDate: "2026-09-12",
    }));
  });

  it("modify keeps new dates unassigned when no replacement bed is available", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "received",
      guestName: "Ada",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      roomType: "executive",
      persons: 1,
    });
    q.getBookingDetail
      .mockResolvedValueOnce({
        booking: { status: "received" },
        assignments: [{
          status: "assigned", bedId: 7, dormId: 8,
          checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online",
        }],
      })
      .mockResolvedValueOnce({ booking: { status: "received" }, assignments: [] });
    q.checkBedAvailability.mockResolvedValue(false);
    q.getAvailableBedsForRange.mockResolvedValue([]);

    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      action: "modify",
      checkin: "2026-09-10",
      checkout: "2026-09-12",
    }), { authorization: "whsec-test" }));

    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({
      checkinDate: "2026-09-10",
      checkoutDate: "2026-09-12",
    }));
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(12);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 12,
      action: "Unassigned",
      performedBy: "channel_manager",
    }));
  });

  it("modify of an unassigned stay with missing checkout coerces dates and does not assign beds", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12,
      status: "received",
      guestName: "Ada",
      checkinDate: "2026-09-05",
      checkoutDate: "",
      persons: 1,
    });
    q.getBookingDetail.mockResolvedValue({ booking: { status: "received" }, assignments: [] });
    const payload = bookPayload({ action: "modify", checkin: "2026-09-10" });
    delete (payload as { checkout?: string }).checkout;
    const res = await reservationsPOST(jsonReq(
      "http://localhost/api/aiosell/reservations",
      payload,
      { authorization: "whsec-test" },
    ));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(12, expect.objectContaining({
      checkinDate: "2026-09-10",
    }));
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("cancel of an assigned stay pushes assignment nights, not the checkout morning", async () => {
    q.getBookingByRef.mockResolvedValue({
      id: 12, status: "received",
      checkinDate: "2026-09-01", checkoutDate: "2026-09-10",
    });
    q.getBookingDetail.mockResolvedValue({
      assignments: [{
        status: "assigned", bedId: 7, dormId: 8,
        checkinDate: "2026-09-05", checkoutDate: "2026-09-08",
      }],
    });
    await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", {
      action: "cancel", hotelCode: "GOKO-001", channel: "booking.com", bookingId: "BK-OPS-1",
    }, { authorization: "whsec-test" }));
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(12);
  });

  it("book with two rooms sums persons and first-night rates", async () => {
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      bookingId: "BK-GROUP-3",
      rooms: [
        {
          roomCode: "executive",
          rateplanCode: "executive-s-ep",
          occupancy: { adults: 2, children: 0 },
          prices: [
            { date: "2026-09-05", sellRate: 3700 },
            { date: "2026-09-06", sellRate: 3700 },
          ],
        },
        {
          roomCode: "dorm-6",
          rateplanCode: "STD",
          occupancy: { adults: 1, children: 1 },
          prices: [
            { date: "2026-09-05", sellRate: 1200 },
            { date: "2026-09-06", sellRate: 1100 },
          ],
        },
      ],
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      persons: 4,
      nightlyRate: 4900,
      roomType: "executive, dorm-6",
    }));
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("6 identical suite rooms occupancy 3 store 6 persons and auto-assign 6 beds", async () => {
    q.getRoomTypeMappings.mockResolvedValue([
      ...mappings,
      { id: 3, dormId: 11, channelRoomCode: "suite", isActive: 1, dormName: "Suite" },
    ]);
    q.getAvailableBedsForRange.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: 101 + i,
        bedId: `SUI-${i + 1}`,
        dormId: 11,
        dormName: "Suite",
        pool: "online",
      })),
    );
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      bookingId: "San5c72b7455549",
      channel: "MMT",
      checkin: "2026-08-31",
      checkout: "2026-09-01",
      guest: { firstName: "Pawan 123", lastName: null, email: "pawan123@gmail.com", phone: "0123456789" },
      rooms: Array.from({ length: 6 }, () => ({
        roomCode: "suite",
        rateplanCode: "suite-d-ep",
        occupancy: { adults: 3, children: 0 },
        prices: [{ date: "2026-08-31", sellRate: 2300 }],
      })),
      amount: { amountAfterTax: 13800, amountBeforeTax: 13800, tax: 0, currency: "INR" },
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      guestName: "Pawan 123",
      persons: 6,
      nightlyRate: 13800,
      roomType: "suite, suite, suite, suite, suite, suite",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(6);
  });

  it("uses amountAfterTax / nights when room prices are null", async () => {
    const res = await reservationsPOST(jsonReq("http://localhost/api/aiosell/reservations", bookPayload({
      bookingId: "BK-NOPRICE",
      rooms: [{
        roomCode: "executive",
        rateplanCode: "executive-s-ep",
        occupancy: { adults: 1, children: 0 },
        prices: null,
      }],
      amount: { amountAfterTax: 7400, amountBeforeTax: 7400, tax: 0, currency: "INR" },
    }), { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ nightlyRate: 2467 }));
  });
});

describe("Fetch reservation ingest", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getBookingByRef.mockResolvedValue(null);
    q.addBooking.mockResolvedValue(201);
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    fetchFromAiosell.mockReset();
  });

  it("imports missing refs and skips ones already in D1, including cancelled", async () => {
    q.getBookingByRef.mockImplementation(async (ref: string) => {
      if (ref === "ALREADY") return { id: 9, status: "cancelled", bookingRef: "ALREADY" };
      return null;
    });
    const result = await ingestFetchedReservations([
      bookPayload({ bookingId: "NEW-1" }),
      bookPayload({ bookingId: "ALREADY" }),
      { hotelCode: "GOKO-001" },
    ]);
    expect(result).toEqual({ imported: 1, skipped: 2, refs: ["NEW-1"] });
    expect(q.addBooking).toHaveBeenCalledTimes(1);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("fetch reservation wraps Aiosell array and reports ingest counts", async () => {
    fetchFromAiosell.mockResolvedValue([bookPayload({ bookingId: "FETCH-1" })]);
    const res = await fetchPOST(jsonReq("http://localhost/api/aiosell/fetch", adminBody({
      type: "reservation", startDate: "2026-08-31", endDate: "2026-09-03",
    })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.ingested).toEqual({ imported: 1, skipped: 0, refs: ["FETCH-1"] });
    expect(q.addBooking).toHaveBeenCalled();
  });

  it("ingestFetchedReservations returns zeros for an empty array", async () => {
    const result = await ingestFetchedReservations([]);
    expect(result).toEqual({ imported: 0, skipped: 0, refs: [] });
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("ingestFetchedReservations ignores a non-array object without data", async () => {
    const result = await ingestFetchedReservations({ success: true, hotelCode: "GOKO-001" });
    expect(result).toEqual({ imported: 0, skipped: 0, refs: [] });
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("ingestFetchedReservations uses amountAfterTax / nights when prices are null", async () => {
    const result = await ingestFetchedReservations([
      bookPayload({
        bookingId: "FETCH-NOPRICE",
        rooms: [{
          roomCode: "executive",
          rateplanCode: "executive-s-ep",
          occupancy: { adults: 1, children: 0 },
          prices: null,
        }],
        amount: { amountAfterTax: 7400, amountBeforeTax: 7400, tax: 0, currency: "INR" },
      }),
    ]);
    expect(result).toEqual({ imported: 1, skipped: 0, refs: ["FETCH-NOPRICE"] });
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({ nightlyRate: 2467 }));
  });

  it("fetch type=inventory does not ingest reservations", async () => {
    fetchFromAiosell.mockResolvedValue([bookPayload({ bookingId: "SHOULD-NOT-INGEST" })]);
    const res = await fetchPOST(jsonReq("http://localhost/api/aiosell/fetch", adminBody({
      type: "inventory", startDate: "2026-09-05", endDate: "2026-09-07",
    })));
    expect(res.status).toBe(200);
    expect(q.addBooking).not.toHaveBeenCalled();
  });
});

describe("Channel Manager config API", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
  });

  it("refuses to enable CM without a webhook secret", async () => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveConfig",
      config: { isActive: true, hotelCode: "GOKO-001", webhookSecret: "" },
    })));
    expect(res.status).toBe(400);
    expect(q.upsertChannelConfig).not.toHaveBeenCalled();
  });

  it("saves when inactive without a secret", async () => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveConfig",
      config: { isActive: false, hotelCode: "GOKO-001", webhookSecret: "" },
    })));
    expect(res.status).toBe(200);
    expect(q.upsertChannelConfig).toHaveBeenCalledWith(expect.objectContaining({
      isActive: false, hotelCode: "GOKO-001", webhookSecret: "",
    }));
  });

  it("saves when active with a webhook secret", async () => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveConfig",
      config: { isActive: true, hotelCode: "GOKO-001", webhookSecret: "whsec-live" },
    })));
    expect(res.status).toBe(200);
    expect(q.upsertChannelConfig).toHaveBeenCalledWith(expect.objectContaining({
      isActive: true, webhookSecret: "whsec-live",
    }));
  });

  it("rejects unknown actions", async () => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "pushNow",
    })));
    expect(res.status).toBe(400);
  });

  it("401s staff", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ role: "staff", displayName: "S", permissions: { canManageInventory: true } });
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getConfig",
    })));
    expect(res.status).toBe(401);
    expect(q.getChannelConfig).not.toHaveBeenCalled();
  });

  it("getConfig returns config", async () => {
    q.getChannelConfig.mockResolvedValue(activeConfig);
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getConfig",
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: activeConfig, bookingTaxRate: 5 });
  });

  it("saveConfig writes booking_tax_rate", async () => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveConfig",
      config: { isActive: false, hotelCode: "GOKO-001", webhookSecret: "" },
      bookingTaxRate: 8,
    })));
    expect(res.status).toBe(200);
    expect(q.setSetting).toHaveBeenCalledWith("booking_tax_rate", "8");
  });

  it("saveConfig writes booking_tax_rate 0", async () => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveConfig",
      config: { isActive: false, hotelCode: "GOKO-001", webhookSecret: "" },
      bookingTaxRate: 0,
    })));
    expect(res.status).toBe(200);
    expect(q.setSetting).toHaveBeenCalledWith("booking_tax_rate", "0");
  });

  it("getConfig returns bookingTaxRate 0 when setting is 0", async () => {
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getSetting.mockResolvedValue("0");
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getConfig",
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: activeConfig, bookingTaxRate: 0 });
  });

  it.each([
    [{ dormId: 8, channelRoomCode: "" }],
    [{ dormId: 0, channelRoomCode: "executive" }],
  ])("saveRoomMapping 400s for %j", async (mapping) => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveRoomMapping", mapping,
    })));
    expect(res.status).toBe(400);
    expect(q.upsertRoomTypeMapping).not.toHaveBeenCalled();
  });

  it.each([
    [{ roomMappingId: 1, ratePlanCode: "", ratePlanName: "EP" }],
    [{ roomMappingId: 1, ratePlanCode: "ep", ratePlanName: "" }],
  ])("saveRatePlan 400s for %j", async (plan) => {
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveRatePlan", plan,
    })));
    expect(res.status).toBe(400);
    expect(q.upsertRatePlanMapping).not.toHaveBeenCalled();
  });

  it("deleteRatePlan 400s without id and 200s with a valid id", async () => {
    expect((await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "deleteRatePlan",
    })))).status).toBe(400);
    expect(q.deleteRatePlanMapping).not.toHaveBeenCalled();

    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "deleteRatePlan", id: 11,
    })));
    expect(res.status).toBe(200);
    expect(q.deleteRatePlanMapping).toHaveBeenCalledWith(11);
  });

  it("getRatePlans forwards roomMappingId", async () => {
    q.getRatePlanMappings.mockResolvedValue(plans);
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getRatePlans", roomMappingId: 1,
    })));
    expect(res.status).toBe(200);
    expect(q.getRatePlanMappings).toHaveBeenCalledWith(1);
    expect(await res.json()).toEqual({ plans });
  });

  it("getDailyRates forwards plan and date range", async () => {
    const rates = [{ date: "2026-09-05", rate: 3700 }];
    q.getDailyRates.mockResolvedValue(rates);
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getDailyRates", ratePlanId: 10, startDate: "2026-09-05", endDate: "2026-09-07",
    })));
    expect(res.status).toBe(200);
    expect(q.getDailyRates).toHaveBeenCalledWith(10, "2026-09-05", "2026-09-07");
    expect(await res.json()).toEqual({ rates });
  });

  it("getSyncLogs forwards page size, offset, and filters", async () => {
    const logs = [{ id: 1, type: "inventory" }];
    q.getChannelSyncLogs.mockResolvedValue({ logs, total: 1 });
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getSyncLogs", limit: 20, direction: "push", type: "inventory", status: "success", since: "2026-09-01",
    })));
    expect(res.status).toBe(200);
    expect(q.getChannelSyncLogs).toHaveBeenCalledWith(20, {
      direction: "push", type: "inventory", status: "success", since: "2026-09-01", offset: 0,
    });
    expect(await res.json()).toEqual({ logs, total: 1, page: 1, pageSize: 20 });
  });

  it("getSyncLogs paginates with page and pageSize", async () => {
    const logs = [{ id: 51, type: "rate" }];
    q.getChannelSyncLogs.mockResolvedValue({ logs, total: 120 });
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getSyncLogs", page: 3, pageSize: 50,
    })));
    expect(res.status).toBe(200);
    expect(q.getChannelSyncLogs).toHaveBeenCalledWith(50, {
      direction: undefined, type: undefined, status: undefined, since: undefined, offset: 100,
    });
    expect(await res.json()).toEqual({ logs, total: 120, page: 3, pageSize: 50 });
  });

  it("getSyncLogs reports the last page when the requested page is past the end", async () => {
    const logs = [{ id: 1, type: "inventory" }];
    q.getChannelSyncLogs.mockResolvedValue({ logs, total: 10 });
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "getSyncLogs", page: 9, pageSize: 50,
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logs, total: 10, page: 1, pageSize: 50 });
  });

  it("saveDailyRates returns the upsert count", async () => {
    q.bulkUpsertDailyRates.mockResolvedValue(3);
    const rates = [{ ratePlanId: 10, date: "2026-09-05", rate: 3700 }];
    const res = await channelManagerPOST(jsonReq("http://localhost/api/admin/channel-manager", adminBody({
      action: "saveDailyRates", rates,
    })));
    expect(res.status).toBe(200);
    expect(q.bulkUpsertDailyRates).toHaveBeenCalledWith(rates);
    expect(await res.json()).toEqual({ success: true, count: 3 });
  });
});

describe("Push inventory route modes", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.getDirtyInventory.mockResolvedValue([]);
    getDateAwareAvailability.mockResolvedValue(4);
    getDateAwareAvailabilityRange.mockImplementation(async (rows, dates) => new Map(
      rows.flatMap((row: { dormId: number }) => dates.map((date: string) => [`${row.dormId}:${date}`, 4])),
    ));
    pushInventory.mockReset();
    pushInventory.mockResolvedValue({ success: true, message: "ok" });
    getAiosellPropertyDetails.mockReset();
    getAiosellPropertyDetails.mockResolvedValue(propertyDetails);
  });

  it("401s non-admin", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ role: "staff", displayName: "S", permissions: {} });
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody()));
    expect(res.status).toBe(401);
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("400s when CM is inactive", async () => {
    q.getChannelConfig.mockResolvedValue({ ...activeConfig, isActive: 0 });
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody()));
    expect(res.status).toBe(400);
  });

  it("400s with no room mappings", async () => {
    q.getRoomTypeMappings.mockResolvedValue([]);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(400);
  });

  it("ranged push sends every mapped room for inclusive nights", async () => {
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-06",
    })));
    expect(res.status).toBe(200);
    const updates = pushInventory.mock.calls[0][1];
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      startDate: "2026-09-05",
      endDate: "2026-09-05",
      rooms: [
        { roomCode: "executive", available: 4 },
        { roomCode: "dorm-6", available: 4 },
      ],
    });
    const body = await res.json();
    expect(body.mode).toBe("full");
    expect(body.inventoryPushed).toBe(4);
  });

  it("incremental dirty push only sends mapped dorm/date pairs", async () => {
    q.getDirtyInventory.mockResolvedValue([
      { id: 1, dormId: 8, date: "2026-09-05" },
      { id: 2, dormId: 99, date: "2026-09-05" },
    ]);
    getDateAwareAvailability.mockResolvedValue(2);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody()));
    expect(res.status).toBe(200);
    expect(q.clearDirtyInventory.mock.calls).toEqual([[[2]], [[1]]]);
    const updates = pushInventory.mock.calls[0][1];
    expect(updates).toEqual([{
      startDate: "2026-09-05", endDate: "2026-09-05",
      rooms: [{ roomCode: "executive", available: 2 }],
    }]);
    const body = await res.json();
    expect(body.mode).toBe("incremental");
  });

  it("fullSync clears every dirty row after a successful push", async () => {
    q.getDirtyInventory.mockResolvedValue([{ id: 9, dormId: 8, date: "2026-09-01" }]);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05", fullSync: true,
    })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("full");
    expect(q.clearAllDirtyInventory).toHaveBeenCalled();
  });

  it("returns 502 when Aiosell rejects the update", async () => {
    pushInventory.mockResolvedValue({ success: false, message: "hotel not found" });
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(502);
    expect(q.updateChannelSyncTime).not.toHaveBeenCalled();
  });

  it("keeps dirty inventory when Aiosell returns room-code warnings", async () => {
    q.getDirtyInventory.mockResolvedValue([{ id: 9, dormId: 8, date: "2026-09-05" }]);
    pushInventory.mockResolvedValue({ success: true, message: "Accepted with warnings", warnings: ["INVALID_ROOM_CODE"] });
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody()));
    expect(res.status).toBe(502);
    expect(q.updateChannelSyncTime).not.toHaveBeenCalled();
    expect(q.clearDirtyInventory).not.toHaveBeenCalled();
  });

  it("skips inactive room mappings", async () => {
    q.getRoomTypeMappings.mockResolvedValue([
      ...mappings,
      { id: 3, dormId: 10, channelRoomCode: "closed-room", isActive: 0 },
    ]);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(200);
    expect(pushInventory.mock.calls[0][1][0].rooms).toEqual([
      { roomCode: "executive", available: 4 },
      { roomCode: "dorm-6", available: 4 },
    ]);
  });

  it("401s staff even with canManageInventory", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "S", permissions: { canManageInventory: true },
    });
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody()));
    expect(res.status).toBe(401);
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("drains all-unmapped dirty rows then falls through to full mode", async () => {
    q.getDirtyInventory.mockResolvedValue([
      { id: 1, dormId: 99, date: "2026-09-05" },
      { id: 2, dormId: 100, date: "2026-09-06" },
    ]);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody()));
    expect(res.status).toBe(200);
    expect(q.clearDirtyInventory).toHaveBeenCalledWith([1, 2]);
    const body = await res.json();
    expect(body.mode).toBe("full");
    expect(pushInventory.mock.calls[0][1].length).toBeGreaterThan(1);
  });

  it("ranged push clears dirty only for nights actually sent", async () => {
    q.getDirtyInventory.mockResolvedValue([
      { id: 1, dormId: 8, date: "2026-09-05" },
      { id: 2, dormId: 8, date: "2026-09-10" },
      { id: 3, dormId: 9, date: "2026-09-05" },
      { id: 4, dormId: 99, date: "2026-09-05" },
    ]);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(200);
    expect(q.clearAllDirtyInventory).not.toHaveBeenCalled();
    expect(q.clearDirtyInventory).toHaveBeenCalledWith([1, 3]);
  });

  it("400s when config is null", async () => {
    q.getChannelConfig.mockResolvedValue(null);
    const res = await pushInventoryPOST(jsonReq("http://localhost/api/aiosell/push-inventory", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(400);
    expect(pushInventory).not.toHaveBeenCalled();
  });
});

describe("Push rates and fetch routes", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.getRatePlanMappings.mockResolvedValue(plans);
    q.getAllDailyRates.mockResolvedValue([
      { ratePlanId: 10, date: "2026-09-05", rate: 9999, adult1Rate: 3700, stopSell: 1, minimumStay: 2, maximumStay: null, closeOnArrival: 0, closeOnDeparture: 0, minimumAdvanceReservation: null, maximumAdvanceReservation: null },
    ]);
    pushRates.mockReset();
    pushRateRestrictions.mockReset();
    fetchFromAiosell.mockReset();
    pushRates.mockResolvedValue({ success: true, message: "ok" });
    getAiosellPropertyDetails.mockReset();
    getAiosellPropertyDetails.mockResolvedValue(propertyDetails);
    pushRateRestrictions.mockResolvedValue({ success: true });
    fetchFromAiosell.mockResolvedValue({ success: true, data: [] });
  });

  it("400s when the range has no daily rates", async () => {
    q.getAllDailyRates.mockResolvedValue([]);
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(400);
    expect(pushRates).not.toHaveBeenCalled();
  });

  it("pushes adult1Rate and skips unmapped plans", async () => {
    q.getRatePlanMappings.mockResolvedValue([
      ...plans,
      { id: 99, roomMappingId: 404, ratePlanCode: "orphan", isActive: 1 },
    ]);
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(200);
    const updates = pushRates.mock.calls[0][1];
    expect(updates[0].rates).toEqual([
      { roomCode: "executive", rateplanCode: "executive-s-ep", rate: 3700 },
    ]);
    expect(pushRateRestrictions).not.toHaveBeenCalled();
    expect(q.markRatesSynced).toHaveBeenCalledWith(10, "2026-09-05", "2026-09-05");
    expect(q.markRatesSynced).toHaveBeenCalledWith(11, "2026-09-05", "2026-09-05");
  });

  it("includeRestrictions sends a full snapshot after rates", async () => {
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05", includeRestrictions: true,
    })));
    expect(res.status).toBe(200);
    expect(pushRateRestrictions).toHaveBeenCalledTimes(1);
    const restrictions = pushRateRestrictions.mock.calls[0][1][0].rates[0].restrictions;
    expect(restrictions.stopSell).toBe(true);
    expect(restrictions.minimumStay).toBe(2);
    expect(restrictions.minimumStayArrival).toBeNull();
  });

  it("502s when rates succeed but restrictions fail", async () => {
    pushRateRestrictions.mockResolvedValue({ success: false, message: "bad restriction" });
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05", includeRestrictions: true,
    })));
    expect(res.status).toBe(502);
    expect(q.markRatesSynced).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 400],
    [{ type: "inventory", startDate: "2026-09-05" }, 400],
    [{ type: "bookings", startDate: "2026-09-05", endDate: "2026-09-06" }, 400],
  ])("fetch rejects incomplete body %j", async (extra, status) => {
    const res = await fetchPOST(jsonReq("http://localhost/api/aiosell/fetch", adminBody(extra as Record<string, unknown>)));
    expect(res.status).toBe(status);
    expect(fetchFromAiosell).not.toHaveBeenCalled();
  });

  it.each(["inventory", "rates", "reservation"] as const)("fetch %s is a pull through to Aiosell", async (type) => {
    fetchFromAiosell.mockResolvedValue({ success: true, data: [{ type }] });
    const res = await fetchPOST(jsonReq("http://localhost/api/aiosell/fetch", adminBody({
      type, startDate: "2026-09-05", endDate: "2026-09-07",
    })));
    expect(res.status).toBe(200);
    expect(fetchFromAiosell).toHaveBeenCalledWith(
      expect.objectContaining({ hotelCode: "GOKO-001", pmsId: "goko-pms" }),
      type,
      "2026-09-05",
      "2026-09-07",
    );
  });

  it("400s with no room mappings", async () => {
    q.getRoomTypeMappings.mockResolvedValue([]);
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(400);
    expect(pushRates).not.toHaveBeenCalled();
  });

  it("400s with no rate plans", async () => {
    q.getRatePlanMappings.mockResolvedValue([]);
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(400);
    expect(pushRates).not.toHaveBeenCalled();
  });

  it("502s when Aiosell rejects rates and does not mark synced", async () => {
    pushRates.mockResolvedValue({ success: false, message: "rate reject" });
    const res = await pushRatesPOST(jsonReq("http://localhost/api/aiosell/push-rates", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(502);
    expect(q.markRatesSynced).not.toHaveBeenCalled();
  });

  it("fetch still returns JSON 200 when Aiosell reports success:false", async () => {
    fetchFromAiosell.mockResolvedValue({ success: false, message: "upstream down", data: [] });
    const res = await fetchPOST(jsonReq("http://localhost/api/aiosell/fetch", adminBody({
      type: "inventory", startDate: "2026-09-05", endDate: "2026-09-07",
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, message: "upstream down", data: [] });
  });
});

describe("Aiosell admin routes require admin and an active CM", () => {
  const routes = [
    ["push-rates", pushRatesPOST],
    ["fetch", fetchPOST],
    ["noshow", pushNoShowPOST],
    ["inv-restrictions", pushInvRestrictPOST],
  ] as const;
  const body = adminBody({
    type: "inventory", startDate: "2026-09-05", endDate: "2026-09-05",
    bookingId: "CM-1", partner: "booking_com",
  });

  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    q.getChannelConfig.mockResolvedValue(activeConfig);
  });

  it.each(routes)("401s staff on %s", async (_label, handler) => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "S", permissions: { canManageInventory: true },
    });
    expect((await handler(jsonReq("http://localhost/api/aiosell/x", body))).status).toBe(401);
  });

  it.each(routes)("400s inactive CM on %s", async (_label, handler) => {
    q.getChannelConfig.mockResolvedValue({ ...activeConfig, isActive: 0 });
    expect((await handler(jsonReq("http://localhost/api/aiosell/x", body))).status).toBe(400);
  });
});

describe("No-show and inventory-restriction routes", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    q.getChannelConfig.mockResolvedValue(activeConfig);
    q.getRoomTypeMappings.mockResolvedValue(mappings);
    q.getRatePlanMappings.mockResolvedValue(plans);
    pushNoShow.mockReset();
    pushInventoryRestrictions.mockReset();
    pushNoShow.mockResolvedValue({ success: true });
    pushInventoryRestrictions.mockResolvedValue({ success: true, message: "ok" });
    getAiosellPropertyDetails.mockReset();
    getAiosellPropertyDetails.mockResolvedValue(propertyDetails);
  });

  it("noshow requires bookingId", async () => {
    const res = await pushNoShowPOST(jsonReq("http://localhost/api/aiosell/push-noshow", adminBody({ bookingId: "CM-1" })));
    expect(res.status).toBe(200);
    expect(pushNoShow).toHaveBeenCalledWith(expect.anything(), "CM-1");
  });

  it("noshow 200s and forwards bookingId", async () => {
    const res = await pushNoShowPOST(jsonReq("http://localhost/api/aiosell/push-noshow", adminBody({
      bookingId: "CM-1", partner: "booking_com",
    })));
    expect(res.status).toBe(200);
    expect(pushNoShow).toHaveBeenCalledWith(
      expect.objectContaining({ hotelCode: "GOKO-001", pmsId: "goko-pms" }),
      "CM-1",
    );
  });

  it("noshow 502s when Aiosell fails", async () => {
    pushNoShow.mockResolvedValue({ success: false, message: "unknown booking" });
    const res = await pushNoShowPOST(jsonReq("http://localhost/api/aiosell/push-noshow", adminBody({
      bookingId: "CM-1", partner: "booking_com",
    })));
    expect(res.status).toBe(502);
  });

  it("room stopSell is true only when every plan on that room is stop-sold", async () => {
    q.getAllDailyRates.mockResolvedValue([
      { ratePlanId: 10, date: "2026-09-05", stopSell: 1, minimumStay: 2, maximumStay: 5, closeOnArrival: 1, closeOnDeparture: 0, minimumAdvanceReservation: 3, maximumAdvanceReservation: 10 },
      { ratePlanId: 11, date: "2026-09-05", stopSell: 0, minimumStay: 1, maximumStay: 9, closeOnArrival: 1, closeOnDeparture: 1, minimumAdvanceReservation: 1, maximumAdvanceReservation: 20 },
    ]);
    const res = await pushInvRestrictPOST(jsonReq("http://localhost/api/aiosell/push-inventory-restrictions", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(200);
    const rooms = pushInventoryRestrictions.mock.calls[0][1][0].rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomCode).toBe("executive");
    expect(rooms[0].restrictions).toMatchObject({
      stopSell: false,
      closeOnArrival: true,
      closeOnDeparture: false,
      minimumStay: 1,
      maximumStay: 9,
      minimumAdvanceReservation: 1,
      maximumAdvanceReservation: 20,
    });
  });

  it("400s when no restriction rows exist in range", async () => {
    q.getAllDailyRates.mockResolvedValue([]);
    const res = await pushInvRestrictPOST(jsonReq("http://localhost/api/aiosell/push-inventory-restrictions", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(400);
    expect(pushInventoryRestrictions).not.toHaveBeenCalled();
  });

  it("room stopSell is true when every plan is stop-sold and maximumStay stays null when all are null", async () => {
    q.getAllDailyRates.mockResolvedValue([
      { ratePlanId: 10, date: "2026-09-05", stopSell: 1, minimumStay: 2, maximumStay: null, closeOnArrival: 1, closeOnDeparture: 1, minimumAdvanceReservation: 3, maximumAdvanceReservation: 10 },
      { ratePlanId: 11, date: "2026-09-05", stopSell: 1, minimumStay: 1, maximumStay: null, closeOnArrival: 1, closeOnDeparture: 1, minimumAdvanceReservation: 1, maximumAdvanceReservation: 20 },
    ]);
    const res = await pushInvRestrictPOST(jsonReq("http://localhost/api/aiosell/push-inventory-restrictions", adminBody({
      startDate: "2026-09-05", endDate: "2026-09-05",
    })));
    expect(res.status).toBe(200);
    expect(pushInventoryRestrictions.mock.calls[0][1][0].rooms[0].restrictions).toMatchObject({
      stopSell: true,
      maximumStay: null,
    });
  });
});

afterEach(() => { expect(getAiosellPropertyDetails).not.toHaveBeenCalled(); });
