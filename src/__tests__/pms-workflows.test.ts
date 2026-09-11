import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { captured, queryMocks } = vi.hoisted(() => {
  const captured: Record<string, unknown>[] = [];
  return {
    captured,
    queryMocks: {
      addChannelSyncLog: vi.fn(async (row: Record<string, unknown>) => {
        captured.push(row);
      }),
      getChannelConfig: vi.fn(),
      getSetting: vi.fn(),
      setSetting: vi.fn(),
      addBooking: vi.fn(),
      updateBookingFull: vi.fn(),
      getBookingByRef: vi.fn(),
      unassignBookingBeds: vi.fn(),
      addBookingHistoryEntry: vi.fn(),
      getChannelSyncLogs: vi.fn(),
      upsertChannelConfig: vi.fn(),
      getRoomTypeMappings: vi.fn(),
      upsertRoomTypeMapping: vi.fn(),
      deleteRoomTypeMapping: vi.fn(),
      getRatePlanMappings: vi.fn(),
      upsertRatePlanMapping: vi.fn(),
      deleteRatePlanMapping: vi.fn(),
      getDailyRates: vi.fn(),
      upsertDailyRate: vi.fn(),
      upsertChannelRate: vi.fn(),
      bulkUpsertDailyRates: vi.fn(),
      getAllDorms: vi.fn(),
      getAllBeds: vi.fn(),
      getBookingDetail: vi.fn(),
      checkBedAvailability: vi.fn(),
      assignBedToBooking: vi.fn(),
      getAvailableBedsForRange: vi.fn(),
      upsertInventoryOverride: vi.fn(),
      deleteInventoryOverride: vi.fn(),
      getAvailabilitySnapshot: vi.fn(),
      getUnassignedOtaHoldsForRange: vi.fn(),
      addAuditEntry: vi.fn(),
    },
  };
});

vi.mock("@/db/queries", () => queryMocks);

vi.mock("@/lib/auth", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush: vi.fn().mockResolvedValue(undefined),
  triggerRatePush: vi.fn().mockResolvedValue(undefined),
  triggerRestrictionPush: vi.fn().mockResolvedValue(undefined),
}));

import {
  getChannelConfig,
  addBooking,
  updateBookingFull,
  getBookingByRef,
  unassignBookingBeds,
  addBookingHistoryEntry,
  getChannelSyncLogs,
  getDailyRates,
  upsertDailyRate,
} from "@/db/queries";
import { authenticateUser } from "@/lib/auth";
import { triggerRatePush, triggerRestrictionPush, triggerInventoryPush } from "@/lib/aiosellSync";
import { pushInventory, pushRates, pushNoShow, fetchFromAiosell, pushRateRestrictions, pushInventoryRestrictions, type AiosellConfig } from "@/lib/aiosell";
import { POST as reservationsPOST } from "@/app/api/aiosell/reservations/route";
import { POST as channelManagerPOST } from "@/app/api/admin/channel-manager/route";
import { POST as inventoryPOST } from "@/app/api/admin/inventory/route";

const CFG: AiosellConfig = {
  hotelCode: "GOKO-001",
  pmsId: "goko-pms",
  apiBaseUrl: "https://live.aiosell.com",
  apiUsername: "aiosell",
  apiPassword: "super-secret-password",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastLog() {
  expect(captured.length).toBeGreaterThan(0);
  return captured[captured.length - 1];
}

describe("PMS outbound workflows (mocked Aiosell HTTP)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    captured.length = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("inventory push logs URL, full body, HTTP 200, and duration — not the API password", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true, message: "ok" }));

    const result = await pushInventory(CFG, [{
      startDate: "2026-08-28",
      endDate: "2026-08-28",
      rooms: [
        { roomCode: "DORM-6", available: 4 },
        { roomCode: "DORM-8", available: 2 },
      ],
    }]);

    expect(result.success).toBe(true);
    const log = lastLog();
    expect(log.direction).toBe("push");
    expect(log.type).toBe("inventory");
    expect(log.status).toBe("success");
    expect(log.httpMethod).toBe("POST");
    expect(log.url).toBe("https://live.aiosell.com/api/v2/cm/update/goko-pms");
    expect(log.httpStatus).toBe(200);
    expect(log.recordsAffected).toBe(2);
    expect(typeof log.durationMs).toBe("number");
    const req = JSON.parse(log.requestPayload as string);
    expect(req.hotelCode).toBe("GOKO-001");
    expect(req.updates[0].rooms[1].available).toBe(2);
    expect(JSON.stringify(log)).not.toContain("super-secret-password");
    expect(JSON.stringify(log)).not.toMatch(/Basic /);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain("/api/v2/cm/update/goko-pms");
    expect(calledInit.headers.Authorization).toMatch(/^Basic /);
  });

  it("rate push coalesces consecutive identical nights into one Aiosell range", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    const rate = { roomCode: "suite", rateplanCode: "suite-s-ep", rate: 555 };
    await pushRates(CFG, [
      { startDate: "2026-08-31", endDate: "2026-08-31", rates: [rate] },
      { startDate: "2026-09-01", endDate: "2026-09-01", rates: [rate] },
      { startDate: "2026-09-02", endDate: "2026-09-02", rates: [rate] },
    ]);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.updates).toEqual([
      { startDate: "2026-08-31", endDate: "2026-09-02", rates: [rate] },
    ]);
    expect(lastLog().recordsAffected).toBe(3);
  });

  it("rate push stores the actual rate rows, not a count summary", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await pushRates(CFG, [{
      startDate: "2026-08-28",
      endDate: "2026-08-28",
      rates: [{ roomCode: "DORM-6", rateplanCode: "STD", rate: 1200 }],
    }]);
    const log = lastLog();
    expect(log.type).toBe("rate");
    expect(log.url).toContain("/api/v2/cm/update-rates/");
    const req = JSON.parse(log.requestPayload as string);
    expect(req.updates[0].rates[0]).toEqual({ roomCode: "DORM-6", rateplanCode: "STD", rate: 1200 });
    expect(req).not.toHaveProperty("rateCount");
  });

  it("no-show push is typed and logged even when called from the dashboard path", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await pushNoShow(CFG, "CM-789", "booking_com");
    const log = lastLog();
    expect(log.type).toBe("noshow");
    expect(log.url).toBe("https://live.aiosell.com/api/v2/cm/noshow");
    expect(log.recordsAffected).toBe(1);
    const req = JSON.parse(log.requestPayload as string);
    expect(req).toEqual({ hotelId: "GOKO-001", bookingId: "CM-789", partner: "booking.com" });
  });

  it("HTTP 502 logs failed with status and response snippet", async () => {
    fetchMock.mockResolvedValue(new Response("upstream dead", { status: 502 }));
    const result = await pushInventory(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rooms: [{ roomCode: "DORM-6", available: 1 }],
    }]);
    expect(result.success).toBe(false);
    const log = lastLog();
    expect(log.status).toBe("failed");
    expect(log.httpStatus).toBe(502);
    expect(log.errorMessage).toMatch(/HTTP 502/);
    expect(log.errorMessage).toMatch(/upstream dead/);
  });

  it("Aiosell 200 with success:false is a failed PMS log, not a network error", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: false, message: "hotel not found" }));
    const result = await pushRates(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rates: [{ roomCode: "DORM-6", rateplanCode: "STD", rate: 900 }],
    }]);
    expect(result.success).toBe(false);
    const log = lastLog();
    expect(log.status).toBe("failed");
    expect(log.httpStatus).toBe(200);
    expect(log.errorMessage).toBe("hotel not found");
  });

  it("invalid JSON on HTTP 200 keeps the HTTP status (does not look like a network drop)", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }));
    const result = await pushNoShow(CFG, "CM-1", "booking_com");
    expect(result.success).toBe(false);
    const log = lastLog();
    expect(log.status).toBe("failed");
    expect(log.httpStatus).toBe(200);
    expect(log.errorMessage).toMatch(/invalid JSON/);
  });

  it("network failure logs httpStatus 0 and does not throw", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const result = await pushInventory(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rooms: [{ roomCode: "DORM-6", available: 1 }],
    }]);
    expect(result.success).toBe(false);
    expect(result.message).toBe("fetch failed");
    const log = lastLog();
    expect(log.status).toBe("failed");
    expect(log.httpStatus).toBe(0);
    expect(log.errorMessage).toBe("fetch failed");
  });

  it("auto inventory source is tagged in the log type", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await pushInventory(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rooms: [{ roomCode: "DORM-6", available: 1 }],
    }], undefined, "auto");
    expect(lastLog().type).toBe("inventory (auto)");
    expect(lastLog().direction).toBe("push");
  });

  it("auto rate source is tagged in the log type", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await pushRates(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rates: [{ roomCode: "DORM-6", rateplanCode: "STD", rate: 900 }],
    }], "auto");
    expect(lastLog().type).toBe("rate (auto)");
  });

  it("Channel Manager fetch is a pull log, not a push", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true, data: [{ roomCode: "executive", available: 2 }] }));
    const result = await fetchFromAiosell(CFG, "inventory", "2026-08-28", "2026-08-30");
    expect(result.success).toBe(true);
    const log = lastLog();
    expect(log.direction).toBe("pull");
    expect(log.type).toBe("fetch (inventory)");
    expect(log.url).toBe("https://live.aiosell.com/api/v2/cm/data/goko-pms");
    const req = JSON.parse(log.requestPayload as string);
    expect(req).toEqual({
      type: "inventory",
      hotelCode: "GOKO-001",
      startDate: "2026-08-28",
      endDate: "2026-08-30",
    });
    expect(log.recordsAffected).toBe(1);
  });

  it("rate-restriction and inventory-restriction pushes log as restriction, not rate", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await pushRateRestrictions(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rates: [{ roomCode: "executive", rateplanCode: "executive-s-ep", restrictions: { stopSell: true } as never }],
    }]);
    expect(lastLog().type).toBe("restriction");
    expect(lastLog().url).toContain("/api/v2/cm/update-rates/");
    await pushInventoryRestrictions(CFG, [{
      startDate: "2026-08-28", endDate: "2026-08-28",
      rooms: [{ roomCode: "executive", restrictions: { stopSell: false } as never }],
    }]);
    expect(lastLog().type).toBe("restriction");
    expect(lastLog().url).toContain("/api/v2/cm/update/");
  });

  it("fetch rates and reservation are pull logs with the type in the name", async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true, data: [] }));
    await fetchFromAiosell(CFG, "rates", "2026-09-05", "2026-09-07");
    expect(lastLog()).toMatchObject({ direction: "pull", type: "fetch (rates)" });
    await fetchFromAiosell(CFG, "reservation", "2026-09-05", "2026-09-07");
    expect(lastLog()).toMatchObject({ direction: "pull", type: "fetch (reservation)" });
  });
});

describe("PMS inbound webhook workflows", () => {
  const activeConfig = {
    isActive: 1,
    hotelCode: "GOKO-001",
    webhookSecret: "whsec-test",
  };

  function req(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/aiosell/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const bookPayload = {
    action: "book" as const,
    hotelCode: "GOKO-001",
    channel: "booking.com",
    bookingId: "BK-100",
    cmBookingId: "CM-100",
    checkin: "2026-09-01",
    checkout: "2026-09-03",
    guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+91000" },
    rooms: [{
      roomCode: "DORM-6",
      rateplanCode: "STD",
      guestName: "Ada Lovelace",
      occupancy: { adults: 1, children: 0 },
      prices: [{ date: "2026-09-01", sellRate: 1200 }],
    }],
  };

  beforeEach(() => {
    captured.length = 0;
    vi.mocked(getChannelConfig).mockReset();
    vi.mocked(addBooking).mockReset();
    vi.mocked(updateBookingFull).mockReset();
    vi.mocked(getBookingByRef).mockReset();
    vi.mocked(unassignBookingBeds).mockReset();
    vi.mocked(addBookingHistoryEntry).mockReset();
    vi.mocked(getChannelConfig).mockResolvedValue(activeConfig as never);
    vi.mocked(getBookingByRef).mockResolvedValue(null as never);
    vi.mocked(addBooking).mockResolvedValue(undefined as never);
    vi.mocked(updateBookingFull).mockResolvedValue(undefined as never);
    vi.mocked(unassignBookingBeds).mockResolvedValue(undefined as never);
    vi.mocked(addBookingHistoryEntry).mockResolvedValue(undefined as never);
    queryMocks.getBookingDetail.mockResolvedValue({ assignments: [] } as never);
    queryMocks.checkBedAvailability.mockReset();
    queryMocks.checkBedAvailability.mockResolvedValue(true);
    queryMocks.assignBedToBooking.mockReset();
    queryMocks.assignBedToBooking.mockResolvedValue(true);
    queryMocks.getAvailableBedsForRange.mockReset();
    queryMocks.getAvailableBedsForRange.mockResolvedValue([]);
    queryMocks.getRoomTypeMappings.mockReset();
    queryMocks.getRoomTypeMappings.mockResolvedValue([
      { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
      { dormId: 9, channelRoomCode: "dorm-6", isActive: 1, dormName: "Dorm 1" },
      { dormId: 9, channelRoomCode: "DORM-6", isActive: 1, dormName: "Dorm 1" },
      { dormId: 11, channelRoomCode: "suite", isActive: 1, dormName: "Suite" },
    ]);
    vi.mocked(addBooking).mockResolvedValue(42 as never);
    vi.mocked(triggerInventoryPush).mockReset();
    vi.mocked(triggerInventoryPush).mockResolvedValue(undefined);
  });

  it("logs 401 without storing the presented secret", async () => {
    const res = await reservationsPOST(req(bookPayload, { authorization: "wrong-secret" }));
    expect(res.status).toBe(401);
    const log = lastLog();
    expect(log.direction).toBe("pull");
    expect(log.type).toBe("reservation");
    expect(log.status).toBe("failed");
    expect(log.httpStatus).toBe(401);
    expect(log.url).toBe("/api/aiosell/reservations");
    expect(JSON.stringify(log)).not.toContain("wrong-secret");
    expect(JSON.stringify(log)).not.toContain("whsec-test");
    expect(log.requestPayload).toBeFalsy();
  });

  it("logs invalid JSON", async () => {
    const res = await reservationsPOST(req("{not json", { authorization: "whsec-test" }));
    expect(res.status).toBe(400);
    const log = lastLog();
    expect(log.status).toBe("failed");
    expect(log.errorMessage).toBe("Invalid JSON body");
    expect(log.requestPayload).toBeFalsy();
  });

  it("logs inactive channel manager", async () => {
    vi.mocked(getChannelConfig).mockResolvedValue({ ...activeConfig, isActive: 0 } as never);
    const res = await reservationsPOST(req(bookPayload, { authorization: "whsec-test" }));
    expect(res.status).toBe(503);
    expect(lastLog().httpStatus).toBe(503);
    expect(lastLog().requestPayload).toBeFalsy();
  });

  it("logs invalid payload", async () => {
    const res = await reservationsPOST(req({ hotelCode: "GOKO-001" }, { authorization: "whsec-test" }));
    expect(res.status).toBe(400);
    expect(lastLog().errorMessage).toBe("Invalid reservation payload");
    expect(lastLog().requestPayload).toBeTruthy();
  });

  it("logs hotel code mismatch", async () => {
    const res = await reservationsPOST(req({ ...bookPayload, hotelCode: "OTHER" }, { authorization: "whsec-test" }));
    expect(res.status).toBe(400);
    expect(lastLog().errorMessage).toBe("Invalid hotel code");
  });

  it("book: one success log with request + our response, inserts a booking", async () => {
    const res = await reservationsPOST(req(bookPayload, { authorization: "Bearer whsec-test" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(addBooking).toHaveBeenCalledOnce();
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    const log = lastLog();
    expect(log.status).toBe("success");
    expect(log.httpStatus).toBe(200);
    expect(log.recordsAffected).toBe(1);
    const reqBody = JSON.parse(log.requestPayload as string);
    expect(reqBody.bookingId).toBe("BK-100");
    expect(reqBody.guest.email).toBe("ada@example.com");
    expect(reqBody.guest.firstName).toBe("Ada");
    const respBody = JSON.parse(log.responsePayload as string);
    expect(respBody.message).toMatch(/Created Successfully/i);
  });

  it("Direct / executive webhook book is stored unassigned (no bed) as channel_manager", async () => {
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "Direct",
      bookingId: "San73aeea140336",
      checkin: "2026-09-05",
      checkout: "2026-09-06",
      pah: true,
      guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+91000" },
      rooms: [{
        roomCode: "executive",
        rateplanCode: "executive-s-ep",
        guestName: "Ada Lovelace",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
      amount: { amountAfterTax: 3700, amountBeforeTax: 3700, tax: 0, currency: "INR" },
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "San73aeea140336",
      platform: "Direct",
      source: "channel_manager",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      roomType: "executive",
      status: "received",
      paymentStatus: "pay_at_hotel",
    }));
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns 1 online executive bed for a 1-person book and does not push", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 70, bedId: "EXE-OFF", dormId: 8, dormName: "Executive", pool: "offline" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "Direct",
      bookingId: "San-auto-1",
      checkin: "2026-09-05",
      checkout: "2026-09-06",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [{
        roomCode: "executive",
        rateplanCode: "executive-s-ep",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      bedId: 7,
      dormId: 8,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns 2 online beds for 2 persons covering both nights", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 8, bedId: "EXE-2", dormId: 8, dormName: "Executive", pool: "online" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-2P-2N",
      checkin: "2026-09-05",
      checkout: "2026-09-07",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 2, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }, { date: "2026-09-06", sellRate: 3700 }],
      }],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(queryMocks.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([7, 8]);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      inventoryPool: "online",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns one bed per person across mixed room types for the whole stay", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 8, bedId: "EXE-2", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 40, bedId: "D1", dormId: 9, dormName: "Dorm 1", pool: "online" },
      { id: 90, bedId: "DOFF", dormId: 9, dormName: "Dorm 1", pool: "offline" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-MIX-2N",
      checkin: "2026-09-05",
      checkout: "2026-09-07",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
      ],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(3);
    const byBed = queryMocks.assignBedToBooking.mock.calls.map((c) => c[0]);
    expect(byBed.filter((a) => a.dormId === 8)).toHaveLength(2);
    expect(byBed.filter((a) => a.dormId === 9)).toHaveLength(1);
    expect(byBed.every((a) => a.checkinDate === "2026-09-05" && a.checkoutDate === "2026-09-07" && a.inventoryPool === "online")).toBe(true);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("stays Unassigned when only offline beds remain in the requested room type", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 70, bedId: "EXE-OFF", dormId: 8, dormName: "Executive", pool: "offline" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-OVERFLOW",
      checkin: "2026-09-05",
      checkout: "2026-09-06",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalled();
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Unassigned",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns 2 beds when occupancy includes a child", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 8, bedId: "EXE-2", dormId: 8, dormName: "Executive", pool: "online" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-CHILD",
      checkin: "2026-09-05",
      checkout: "2026-09-07",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 1, children: 1 },
      }],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({ persons: 2 }));
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(queryMocks.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([7, 8]);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      inventoryPool: "online",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns from occupancy strings and stores 2 persons", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 8, bedId: "EXE-2", dormId: 8, dormName: "Executive", pool: "online" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-STR-OCC",
      checkin: "2026-09-05",
      checkout: "2026-09-06",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: "2", children: "0" },
      }],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({ persons: 2 }));
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(queryMocks.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([7, 8]);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("auto-assigns a bed for each rooms[] row when both share the same roomCode", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 8, bedId: "EXE-2", dormId: 8, dormName: "Executive", pool: "online" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-2EXE",
      checkin: "2026-09-05",
      checkout: "2026-09-07",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
      ],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(queryMocks.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([7, 8]);
    expect(queryMocks.assignBedToBooking.mock.calls.every((c) =>
      c[0].dormId === 8 && c[0].checkinDate === "2026-09-05" && c[0].checkoutDate === "2026-09-07",
    )).toBe(true);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("assigns zero beds when executive has stock but dorm does not", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 8, bedId: "EXE-2", dormId: 8, dormName: "Executive", pool: "online" },
      { id: 90, bedId: "DOFF", dormId: 9, dormName: "Dorm 1", pool: "offline" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-MIX-SHORT",
      checkin: "2026-09-05",
      checkout: "2026-09-07",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
      ],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalled();
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Unassigned",
      details: expect.stringMatching(/Dorm 1 \(dorm-6\)/),
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("JSON occupancy adults 0 children 0 auto-assigns 1 bed", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "EXE-1", dormId: 8, dormName: "Executive", pool: "online" },
    ]);
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-ZERO-OCC",
      checkin: "2026-09-05",
      checkout: "2026-09-06",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [{
        roomCode: "executive",
        occupancy: { adults: 0, children: 0 },
      }],
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({ persons: 1 }));
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 7,
      inventoryPool: "online",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("6 suite rooms with occupancy 3 auto-assign 6 beds, not 18", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: 101 + i,
        bedId: `SUI-${i + 1}`,
        dormId: 11,
        dormName: "Suite",
        pool: "online",
      })),
    );
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "MMT",
      bookingId: "San5c72b7455549",
      checkin: "2026-08-31",
      checkout: "2026-09-01",
      guest: { firstName: "Pawan 123", lastName: null },
      rooms: Array.from({ length: 6 }, () => ({
        roomCode: "suite",
        rateplanCode: "suite-d-ep",
        occupancy: { adults: 3, children: 0 },
        prices: [{ date: "2026-08-31", sellRate: 2300 }],
      })),
      amount: { amountAfterTax: 13800, amountBeforeTax: 13800, tax: 0, currency: "INR" },
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({
      guestName: "Pawan 123",
      persons: 6,
      bookingRef: "San5c72b7455549",
      roomType: "suite, suite, suite, suite, suite, suite",
      nightlyRate: 13800,
    }));
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(6);
    expect(queryMocks.assignBedToBooking.mock.calls.map((c) => c[0].bedId).sort()).toEqual([
      101, 102, 103, 104, 105, 106,
    ]);
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Beds Auto-Assigned",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("6 suite occupancy 3 stays Unassigned when only 5 online suite beds exist", async () => {
    queryMocks.getAvailableBedsForRange.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: 101 + i,
        bedId: `SUI-${i + 1}`,
        dormId: 11,
        dormName: "Suite",
        pool: "online",
      })),
    );
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "MMT",
      bookingId: "San-suite-short",
      checkin: "2026-08-31",
      checkout: "2026-09-01",
      guest: { firstName: "Pawan 123", lastName: null },
      rooms: Array.from({ length: 6 }, () => ({
        roomCode: "suite",
        occupancy: { adults: 3, children: 0 },
      })),
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({ persons: 6 }));
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Unassigned",
      details: expect.stringMatching(/Suite \(suite\)/),
    }));
  });

  it("modify of an unassigned stay auto-assigns when online beds now exist", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "received",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    queryMocks.getBookingDetail.mockResolvedValue({ assignments: [] } as never);
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 40, bedId: "D1", dormId: 9, dormName: "Dorm 1", pool: "online" },
    ]);
    const res = await reservationsPOST(req({ ...bookPayload, action: "modify" }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 40,
      dormId: 9,
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify that grows occupancy from 1 to 2 unassigns and auto-assigns 2 online beds", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "received",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    queryMocks.getBookingDetail.mockResolvedValue({
      assignments: [{
        bedId: 40, dormId: 9, status: "assigned",
        checkinDate: "2026-09-01", checkoutDate: "2026-09-03", inventoryPool: "online",
      }],
    } as never);
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 40, bedId: "D1", dormId: 9, dormName: "Dorm 1", pool: "online" },
      { id: 41, bedId: "D2", dormId: 9, dormName: "Dorm 1", pool: "online" },
    ]);
    const res = await reservationsPOST(req({
      ...bookPayload,
      action: "modify",
      rooms: [{
        roomCode: "DORM-6",
        occupancy: { adults: 2, children: 0 },
        prices: [{ date: "2026-09-01", sellRate: 1200 }],
      }],
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9, bedId: 40, inventoryPool: "online",
    }));
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9, bedId: 41, inventoryPool: "online",
    }));
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "Beds Auto-Assigned",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("rebook of a cancelled ref auto-assigns online beds and does not push", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9, bookingRef: "BK-100", status: "cancelled",
      checkinDate: "2026-09-01", checkoutDate: "2026-09-03",
    } as never);
    queryMocks.getAvailableBedsForRange.mockResolvedValue([
      { id: 40, bedId: "D1", dormId: 9, dormName: "Dorm 1", pool: "online" },
    ]);
    const res = await reservationsPOST(req(bookPayload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).not.toHaveBeenCalled();
    expect(updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ status: "received" }));
    expect(unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 40,
      dormId: 9,
      inventoryPool: "online",
      assignedBy: "channel_manager",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("multi-room multi-night book stores summed persons and first-night rates, still unassigned", async () => {
    const payload = {
      action: "book" as const,
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-GROUP-3",
      checkin: "2026-09-05",
      checkout: "2026-09-08",
      guest: { firstName: "Ada", lastName: "Lovelace" },
      rooms: [
        {
          roomCode: "executive",
          rateplanCode: "executive-s-ep",
          occupancy: { adults: 2, children: 0 },
          prices: [
            { date: "2026-09-05", sellRate: 3700 },
            { date: "2026-09-06", sellRate: 3700 },
            { date: "2026-09-07", sellRate: 3700 },
          ],
        },
        {
          roomCode: "DORM-6",
          rateplanCode: "STD",
          occupancy: { adults: 1, children: 1 },
          prices: [
            { date: "2026-09-05", sellRate: 1200 },
            { date: "2026-09-06", sellRate: 1100 },
            { date: "2026-09-07", sellRate: 1100 },
          ],
        },
      ],
      amount: { amountAfterTax: 14700, amountBeforeTax: 13125, tax: 1575, currency: "INR" },
    };
    const res = await reservationsPOST(req(payload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-GROUP-3",
      persons: 4,
      nightlyRate: 4900,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      roomType: "executive, DORM-6",
      amountTotal: 14700,
      source: "channel_manager",
    }));
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("duplicate book is still a single success log (idempotent)", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({ bookingRef: "BK-100" } as never);
    const res = await reservationsPOST(req(bookPayload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect(JSON.parse(lastLog().responsePayload as string).message).toMatch(/duplicate/i);
  });

  it("book reuses a cancelled bookingRef instead of treating it as a live duplicate", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9, bookingRef: "BK-100", status: "cancelled",
    } as never);
    const res = await reservationsPOST(req(bookPayload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).not.toHaveBeenCalled();
    expect(updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "received",
      bookingRef: "BK-100",
      cancelledAt: "",
      cancelledBy: "",
    }));
  });

  it("modify updates an existing booking and logs once", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "received",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    const res = await reservationsPOST(req({ ...bookPayload, action: "modify" }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(updateBookingFull).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(JSON.parse(lastLog().responsePayload as string).message).toMatch(/Modified/i);
  });

  it("modify rewrites assigned bed dates to the new stay", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "confirmed",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    queryMocks.getBookingDetail.mockResolvedValue({
      assignments: [{
        status: "assigned", bedId: 4, dormId: 2,
        checkinDate: "2026-09-01", checkoutDate: "2026-09-03", inventoryPool: "online",
      }],
    } as never);
    queryMocks.checkBedAvailability.mockResolvedValue(true);
    const res = await reservationsPOST(req({
      ...bookPayload, action: "modify",
      checkin: "2026-09-02", checkout: "2026-09-05",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(queryMocks.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      bedId: 4,
      checkinDate: "2026-09-02",
      checkoutDate: "2026-09-05",
    }));
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("modify keeps new dates unassigned when the new stay conflicts and no replacement exists", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "confirmed",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    queryMocks.getBookingDetail
      .mockResolvedValueOnce({
        assignments: [{
          status: "assigned", bedId: 4, dormId: 2,
          checkinDate: "2026-09-01", checkoutDate: "2026-09-03", inventoryPool: "online",
        }],
      } as never)
      .mockResolvedValueOnce({ assignments: [] } as never);
    queryMocks.checkBedAvailability.mockResolvedValue(false);
    const res = await reservationsPOST(req({
      ...bookPayload, action: "modify",
      checkin: "2026-09-02", checkout: "2026-09-05",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    const patch = vi.mocked(updateBookingFull).mock.calls[0][1];
    expect(patch.checkinDate).toBe("2026-09-02");
    expect(patch.checkoutDate).toBe("2026-09-05");
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      action: "Unassigned",
      performedBy: "channel_manager",
    }));
  });

  it("modify does not re-occupy beds after calendar checkout", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "checked_out",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-10",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    queryMocks.getBookingDetail.mockResolvedValue({
      booking: { status: "checked_out" },
      assignments: [{
        status: "assigned", bedId: 4, dormId: 2,
        checkinDate: "2026-09-01", checkoutDate: "2026-09-05", inventoryPool: "online",
      }],
    } as never);
    queryMocks.checkBedAvailability.mockResolvedValue(true);
    const res = await reservationsPOST(req({
      ...bookPayload, action: "modify",
      checkin: "2026-09-01", checkout: "2026-09-10",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(unassignBookingBeds).not.toHaveBeenCalled();
    expect(queryMocks.assignBedToBooking).not.toHaveBeenCalled();
    expect(triggerInventoryPush).not.toHaveBeenCalled();
    const patch = vi.mocked(updateBookingFull).mock.calls[0][1];
    expect(patch).not.toHaveProperty("checkinDate");
    expect(patch).not.toHaveProperty("checkoutDate");
  });

  it("cancel marks cancelled, releases beds, and logs once", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9, bookingRef: "BK-100", status: "confirmed",
      checkinDate: "2026-09-01", checkoutDate: "2026-09-03",
    } as never);
    queryMocks.getBookingDetail.mockResolvedValue({
      assignments: [{ status: "assigned", checkinDate: "2026-09-01", checkoutDate: "2026-09-03" }],
    } as never);
    const res = await reservationsPOST(req({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-100",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "cancelled",
      cancelledBy: "channel_manager",
    }));
    expect(unassignBookingBeds).toHaveBeenCalledWith(9);
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-01", "2026-09-02"]);
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      action: "Cancelled from Channel",
    }));
    expect(captured).toHaveLength(1);
    expect(lastLog().status).toBe("success");
  });

  it("cancel with no stay dates does not push today's inventory", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9, bookingRef: "BK-100", status: "confirmed", checkinDate: "", checkoutDate: "",
    } as never);
    queryMocks.getBookingDetail.mockResolvedValue({ assignments: [] } as never);
    const res = await reservationsPOST(req({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-100",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(triggerInventoryPush).not.toHaveBeenCalled();
  });

  it("book with rooms missing occupancy does not 500", async () => {
    const res = await reservationsPOST(req({
      ...bookPayload,
      rooms: [{ roomCode: "DORM-6", rateplanCode: "STD", guestName: "Ada" }],
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalled();
  });

  it("processing throw produces one failed log, not two", async () => {
    vi.mocked(addBooking).mockRejectedValue(new Error("D1 write failed"));
    const res = await reservationsPOST(req(bookPayload, { authorization: "whsec-test" }));
    expect(res.status).toBe(500);
    expect(captured).toHaveLength(1);
    expect(lastLog().status).toBe("failed");
    expect(lastLog().errorMessage).toBe("D1 write failed");
  });

  it("modify preserves existing status (does not reset to received)", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({
      id: 9,
      bookingRef: "BK-100",
      guestName: "Old",
      contact: "",
      platform: "booking.com",
      status: "confirmed",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
      roomType: "DORM-6",
      persons: 1,
      paymentStatus: "prepaid",
      specialRequests: "",
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
      currency: "INR",
      email: "",
      cmBookingId: "",
      ratePlan: "",
      nightlyRate: 0,
    } as never);
    const res = await reservationsPOST(req({ ...bookPayload, action: "modify" }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "confirmed",
    }));
    expect(updateBookingFull).not.toHaveBeenCalledWith(9, expect.objectContaining({
      status: "received",
    }));
  });

  it("cancel already-cancelled booking returns success without updating", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({ id: 9, bookingRef: "BK-100", status: "cancelled" } as never);
    const res = await reservationsPOST(req({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-100",
    }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/already cancelled/i);
    expect(updateBookingFull).not.toHaveBeenCalled();
    expect(unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("cancel logs history entry with correct content", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue({ id: 9, bookingRef: "BK-100", status: "confirmed" } as never);
    await reservationsPOST(req({
      action: "cancel",
      hotelCode: "GOKO-001",
      channel: "booking.com",
      bookingId: "BK-100",
    }, { authorization: "whsec-test" }));
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      action: "Cancelled from Channel",
      details: expect.stringContaining("booking.com"),
      performedBy: "channel_manager",
    }));
  });

  it("modify creates new booking when not found (fallback to handleNewBooking)", async () => {
    vi.mocked(getBookingByRef).mockResolvedValue(null as never);
    const res = await reservationsPOST(req({ ...bookPayload, action: "modify" }, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBooking).toHaveBeenCalledOnce();
    expect(updateBookingFull).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.message).toMatch(/Created Successfully/i);
  });

  it("book logs history entry on successful insert", async () => {
    vi.mocked(addBooking).mockResolvedValue(42 as never);
    const res = await reservationsPOST(req(bookPayload, { authorization: "whsec-test" }));
    expect(res.status).toBe(200);
    expect(addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      action: "Received from Channel",
      details: expect.stringContaining("BK-100"),
      performedBy: "channel_manager",
    }));
  });
});

describe("PMS log list API", () => {
  beforeEach(() => {
    vi.mocked(authenticateUser).mockReset();
    vi.mocked(getChannelSyncLogs).mockReset();
  });

  it("admin getSyncLogs forwards page size, offset, and filters", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} } as never);
    vi.mocked(getChannelSyncLogs).mockResolvedValue({ logs: [{ id: 1, type: "inventory" }], total: 1 } as never);
    const res = await channelManagerPOST(new NextRequest("http://localhost/api/admin/channel-manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "x",
        action: "getSyncLogs",
        limit: 200,
        direction: "push",
        type: "inventory",
        status: "failed",
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(100);
    expect(getChannelSyncLogs).toHaveBeenCalledWith(100, {
      direction: "push",
      type: "inventory",
      status: "failed",
      since: undefined,
      offset: 0,
    });
  });

  it("rejects non-admin", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ role: "staff", displayName: "Staff", permissions: {} } as never);
    const res = await channelManagerPOST(new NextRequest("http://localhost/api/admin/channel-manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x", action: "getSyncLogs" }),
    }));
    expect(res.status).toBe(401);
    expect(getChannelSyncLogs).not.toHaveBeenCalled();
  });
});

describe("room mapping API", () => {
  beforeEach(() => {
    vi.mocked(authenticateUser).mockReset();
    vi.mocked(authenticateUser).mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} } as never);
    queryMocks.getRoomTypeMappings.mockReset();
    queryMocks.getAllDorms.mockReset();
    queryMocks.getAllBeds.mockReset();
    queryMocks.upsertRoomTypeMapping.mockReset();
    queryMocks.deleteRoomTypeMapping.mockReset();
  });

  function post(body: unknown) {
    return channelManagerPOST(new NextRequest("http://localhost/api/admin/channel-manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it("lists every dorm and overlays live names onto mappings", async () => {
    queryMocks.getRoomTypeMappings.mockResolvedValue([
      { id: 1, dormId: 5, dormName: "stale", channelRoomCode: "dorm-1", totalInventory: 12 },
    ]);
    queryMocks.getAllDorms.mockResolvedValue([
      { id: 8, name: "Shiva dorm" },
      { id: 5, name: "Dorm 1" },
    ]);
    queryMocks.getAllBeds.mockResolvedValue([
      { dormId: 5 }, { dormId: 5 }, { dormId: 8 },
    ]);
    const res = await post({ password: "x", action: "getRoomMappings" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mappings[0].dormName).toBe("Dorm 1");
    expect(body.dorms).toEqual([
      { id: 5, name: "Dorm 1", bedCount: 2 },
      { id: 8, name: "Shiva dorm", bedCount: 1 },
    ]);
  });

  it("rejects save without a room code", async () => {
    const res = await post({
      password: "x",
      action: "saveRoomMapping",
      mapping: { dormId: 8, channelRoomCode: "  " },
    });
    expect(res.status).toBe(400);
    expect(queryMocks.upsertRoomTypeMapping).not.toHaveBeenCalled();
  });

  it("rejects delete without a mapping id", async () => {
    const res = await post({ password: "x", action: "deleteRoomMapping" });
    expect(res.status).toBe(400);
    expect(queryMocks.deleteRoomTypeMapping).not.toHaveBeenCalled();
  });
});

describe("Restriction and rate adjustment workflows", () => {
  beforeEach(() => {
    vi.mocked(authenticateUser).mockReset();
    vi.mocked(authenticateUser).mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} } as never);
    queryMocks.getDailyRates.mockReset();
    queryMocks.upsertDailyRate.mockReset();
    queryMocks.upsertDailyRate.mockResolvedValue(undefined);
    queryMocks.upsertChannelRate.mockReset();
    queryMocks.upsertChannelRate.mockResolvedValue(undefined);
    vi.mocked(triggerRatePush).mockReset();
    vi.mocked(triggerRatePush).mockResolvedValue(undefined);
    vi.mocked(triggerRestrictionPush).mockReset();
    vi.mocked(triggerRestrictionPush).mockResolvedValue(undefined);
  });

  function post(body: unknown) {
    return inventoryPOST(new NextRequest("http://localhost/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it("bulkSetRestrictions preserves other fields when setting closeOnArrival", async () => {
    queryMocks.getDailyRates.mockResolvedValue([{
      id: 1,
      ratePlanId: 10,
      date: "2026-09-01",
      rate: 1500,
      stopSell: 1,
      minimumStay: 3,
      maximumStay: null,
      closeOnArrival: 0,
      closeOnDeparture: 0,
      minimumAdvanceReservation: null,
      maximumAdvanceReservation: null,
      adult1Rate: null,
      adult2Rate: null,
      childRate: null,
      infantRate: null,
      extraPersonRate: null,
    }]);
    const res = await post({
      password: "x",
      action: "bulkSetRestrictions",
      ratePlanIds: [10],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      restrictionType: "closeOnArrival",
      value: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      ratePlanId: 10,
      date: "2026-09-01",
      rate: 1500,
      stopSell: 1,
      minimumStay: 3,
      closeOnArrival: 1,
    }));
    expect(triggerRestrictionPush).toHaveBeenCalledWith(
      ["2026-09-01"],
      [10],
      { closeOnArrival: true },
    );
  });

  it("bulkSetRestrictions min stay pushes only minimumStay, even when a night is already stop-sold", async () => {
    queryMocks.getDailyRates.mockResolvedValue([
      {
        id: 1, ratePlanId: 10, date: "2026-08-30", rate: 550,
        stopSell: 1, minimumStay: 1, maximumStay: null,
        closeOnArrival: 0, closeOnDeparture: 0,
        minimumAdvanceReservation: null, maximumAdvanceReservation: null,
        adult1Rate: 550, adult2Rate: null, childRate: null, infantRate: null, extraPersonRate: null,
      },
      {
        id: 2, ratePlanId: 10, date: "2026-08-31", rate: 550,
        stopSell: 0, minimumStay: 1, maximumStay: null,
        closeOnArrival: 0, closeOnDeparture: 0,
        minimumAdvanceReservation: null, maximumAdvanceReservation: null,
        adult1Rate: 550, adult2Rate: null, childRate: null, infantRate: null, extraPersonRate: null,
      },
    ]);
    const res = await post({
      password: "x",
      action: "bulkSetRestrictions",
      ratePlanIds: [10],
      startDate: "2026-08-30",
      endDate: "2026-08-31",
      restrictionType: "minimumStay",
      value: 2,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-08-30", stopSell: 1, minimumStay: 2,
    }));
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-08-31", stopSell: 0, minimumStay: 2,
    }));
    expect(triggerRestrictionPush).toHaveBeenCalledWith(
      ["2026-08-30", "2026-08-31"],
      [10],
      { minimumStay: 2 },
    );
    const patch = vi.mocked(triggerRestrictionPush).mock.calls[0][2];
    expect(patch).not.toHaveProperty("stopSell");
  });

  it("bulkSetRestrictions stopSell Disable pushes false, not a full snapshot", async () => {
    queryMocks.getDailyRates.mockResolvedValue([{
      id: 1, ratePlanId: 10, date: "2026-08-30", rate: 550,
      stopSell: 1, minimumStay: 2, maximumStay: null,
      closeOnArrival: 0, closeOnDeparture: 0,
      minimumAdvanceReservation: null, maximumAdvanceReservation: null,
      adult1Rate: 550, adult2Rate: null, childRate: null, infantRate: null, extraPersonRate: null,
    }]);
    const res = await post({
      password: "x",
      action: "bulkSetRestrictions",
      ratePlanIds: [10],
      startDate: "2026-08-30",
      endDate: "2026-08-30",
      restrictionType: "stopSell",
      value: false,
    });
    expect(res.status).toBe(200);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-08-30", stopSell: 0, minimumStay: 2,
    }));
    expect(triggerRestrictionPush).toHaveBeenCalledWith(
      ["2026-08-30"],
      [10],
      { stopSell: false },
    );
  });

  it("bulkSetRestrictions rejects null minimumStay so D1 and Aiosell cannot diverge", async () => {
    const res = await post({
      password: "x",
      action: "bulkSetRestrictions",
      ratePlanIds: [10],
      startDate: "2026-08-30",
      endDate: "2026-08-30",
      restrictionType: "minimumStay",
      value: null,
    });
    expect(res.status).toBe(400);
    expect(queryMocks.upsertDailyRate).not.toHaveBeenCalled();
    expect(triggerRestrictionPush).not.toHaveBeenCalled();
  });

  it("bulkSetRestrictions dayFilter skips unselected weekdays", async () => {
    queryMocks.getDailyRates.mockResolvedValue([]);
    const res = await post({
      password: "x",
      action: "bulkSetRestrictions",
      ratePlanIds: [10],
      startDate: "2026-08-30",
      endDate: "2026-09-01",
      dayFilter: [0],
      restrictionType: "minimumStay",
      value: 2,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledTimes(1);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-08-30" }));
    expect(triggerRestrictionPush).toHaveBeenCalledWith(["2026-08-30"], [10], { minimumStay: 2 });
  });

  it("bulkSetRestrictions rejects unknown restrictionType", async () => {
    queryMocks.getDailyRates.mockResolvedValue([{
      id: 1, ratePlanId: 10, date: "2026-09-01", rate: 1000,
      stopSell: 0, minimumStay: 1, maximumStay: null,
      closeOnArrival: 0, closeOnDeparture: 0,
      minimumAdvanceReservation: null, maximumAdvanceReservation: null,
      adult1Rate: null, adult2Rate: null, childRate: null, infantRate: null, extraPersonRate: null,
    }]);
    const res = await post({
      password: "x",
      action: "bulkSetRestrictions",
      ratePlanIds: [10],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      restrictionType: "foobar",
      value: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown restrictionType/);
    expect(queryMocks.upsertDailyRate).not.toHaveBeenCalled();
  });

  it("bulkAdjustRates preserves restrictions when adjusting rate", async () => {
    queryMocks.getDailyRates.mockResolvedValue([{
      id: 1,
      ratePlanId: 10,
      date: "2026-09-01",
      rate: 1000,
      stopSell: 1,
      minimumStay: 2,
      maximumStay: 7,
      closeOnArrival: 1,
      closeOnDeparture: 0,
      minimumAdvanceReservation: null,
      maximumAdvanceReservation: null,
      adult1Rate: 900,
      adult2Rate: null,
      childRate: null,
      infantRate: null,
      extraPersonRate: null,
    }]);
    const res = await post({
      password: "x",
      action: "bulkAdjustRates",
      ratePlanIds: [10],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      direction: "increase",
      value: 10,
      type: "percentage",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      ratePlanId: 10,
      date: "2026-09-01",
      rate: 1100,
      stopSell: 1,
      minimumStay: 2,
      maximumStay: 7,
      closeOnArrival: 1,
      adult1Rate: 990,
    }));
  });

  it("bulkSetRates writes one rupee onto every selected plan", async () => {
    const row = (ratePlanId: number, stopSell: number) => ({
      id: ratePlanId,
      ratePlanId,
      date: "2026-09-01",
      rate: 1000,
      stopSell,
      minimumStay: 1,
      maximumStay: null,
      closeOnArrival: 0,
      closeOnDeparture: 0,
      minimumAdvanceReservation: null,
      maximumAdvanceReservation: null,
      adult1Rate: 1000,
      adult2Rate: 1200,
      childRate: null,
      infantRate: null,
      extraPersonRate: null,
    });
    queryMocks.getDailyRates.mockImplementation(async (rpId: number) => [row(rpId, rpId === 10 ? 1 : 0)]);
    const res = await post({
      password: "x",
      action: "bulkSetRates",
      ratePlanIds: [10, 11],
      dates: ["2026-09-01"],
      rate: 800,
      adult1Rate: 800,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(2);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledTimes(2);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      ratePlanId: 10, date: "2026-09-01", rate: 800, adult1Rate: 800, stopSell: 1, adult2Rate: 1200,
    }));
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      ratePlanId: 11, date: "2026-09-01", rate: 800, adult1Rate: 800, stopSell: 0,
    }));
    expect(triggerRatePush).toHaveBeenCalledWith(["2026-09-01"], [10, 11]);
  });

  it("bulkSetRates with channelId writes channel_rates and does not push daily_rates to Aiosell", async () => {
    queryMocks.upsertChannelRate.mockResolvedValue(undefined);
    const res = await post({
      password: "x",
      action: "bulkSetRates",
      ratePlanIds: [10],
      dates: ["2026-09-01"],
      channelId: 3,
      adult1Rate: 4100,
    });
    expect(res.status).toBe(200);
    expect(queryMocks.upsertChannelRate).toHaveBeenCalledWith(expect.objectContaining({
      ratePlanId: 10, channelId: 3, date: "2026-09-01", adult1Rate: 4100,
    }));
    expect(queryMocks.upsertDailyRate).not.toHaveBeenCalled();
    expect(triggerRatePush).not.toHaveBeenCalled();
  });

  it("bulkSetRates still accepts singular ratePlanId", async () => {
    queryMocks.getDailyRates.mockResolvedValue([{
      id: 1, ratePlanId: 10, date: "2026-09-01", rate: 500,
      stopSell: 0, minimumStay: 1, maximumStay: null,
      closeOnArrival: 0, closeOnDeparture: 0,
      minimumAdvanceReservation: null, maximumAdvanceReservation: null,
      adult1Rate: 500, adult2Rate: null, childRate: null, infantRate: null, extraPersonRate: null,
    }]);
    const res = await post({
      password: "x",
      action: "bulkSetRates",
      ratePlanId: 10,
      dates: ["2026-09-01"],
      rate: 900,
      adult1Rate: 900,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({ ratePlanId: 10, rate: 900 }));
    expect(triggerRatePush).toHaveBeenCalledWith(["2026-09-01"], [10]);
  });

  it("bulkSetRates rejects empty plan ids", async () => {
    const res = await post({
      password: "x",
      action: "bulkSetRates",
      ratePlanIds: [],
      dates: ["2026-09-01"],
      rate: 800,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ratePlanIds/);
    expect(queryMocks.upsertDailyRate).not.toHaveBeenCalled();
  });

  it("bulkSetRates creates a row when the plan had no rate that night", async () => {
    queryMocks.getDailyRates.mockResolvedValue([]);
    const res = await post({
      password: "x",
      action: "bulkSetRates",
      ratePlanIds: [10],
      dates: ["2026-09-01"],
      rate: 800,
      adult1Rate: 800,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledWith(expect.objectContaining({
      ratePlanId: 10, date: "2026-09-01", rate: 800, adult1Rate: 800, stopSell: 0, minimumStay: 1,
    }));
    expect(triggerRatePush).toHaveBeenCalledWith(["2026-09-01"], [10]);
  });

  it("bulkSetRates weekday filter upserts only matching nights then pushes those dates", async () => {
    queryMocks.getDailyRates.mockResolvedValue([]);
    const res = await post({
      password: "x",
      action: "bulkSetRates",
      ratePlanIds: [10, 11],
      dates: ["2026-09-01", "2026-09-05", "2026-09-06"],
      dayFilter: [2],
      rate: 700,
      adult1Rate: 700,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    expect(queryMocks.upsertDailyRate).toHaveBeenCalledTimes(2);
    expect(queryMocks.upsertDailyRate.mock.calls.every((c: unknown[]) => (c[0] as { date: string }).date === "2026-09-01")).toBe(true);
    expect(triggerRatePush).toHaveBeenCalledWith(["2026-09-01"], [10, 11]);
  });
});

describe("Bulk availability workflows", () => {
  beforeEach(() => {
    vi.mocked(authenticateUser).mockReset();
    vi.mocked(authenticateUser).mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} } as never);
    queryMocks.getAllDorms.mockReset();
    queryMocks.getRoomTypeMappings.mockReset();
    queryMocks.getAvailabilitySnapshot.mockReset();
    queryMocks.getUnassignedOtaHoldsForRange.mockReset();
    queryMocks.upsertInventoryOverride.mockReset();
    queryMocks.deleteInventoryOverride.mockReset();
    queryMocks.addAuditEntry.mockReset();
    queryMocks.getAllDorms.mockResolvedValue([{ id: 8, name: "Executive" }]);
    queryMocks.getRoomTypeMappings.mockResolvedValue([{ dormId: 8, isActive: 1 }]);
    queryMocks.getAvailabilitySnapshot.mockResolvedValue([
      [
        { id: 1, dormId: 8, bedId: "EXE-1", type: "Bunk" },
        { id: 2, dormId: 8, bedId: "EXE-2", type: "Bunk" },
      ],
      [],
      [],
      [],
    ] as never);
    queryMocks.getUnassignedOtaHoldsForRange.mockResolvedValue([]);
    queryMocks.upsertInventoryOverride.mockResolvedValue(undefined);
    queryMocks.deleteInventoryOverride.mockResolvedValue(undefined);
    queryMocks.addAuditEntry.mockResolvedValue(undefined);
    vi.mocked(triggerInventoryPush).mockReset();
    vi.mocked(triggerInventoryPush).mockResolvedValue({ attempted: true, accepted: true });
  });

  function post(body: unknown) {
    return inventoryPOST(new NextRequest("http://localhost/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it("sets absolute remaining OTA availability while preserving held online inventory", async () => {
    queryMocks.getAvailabilitySnapshot.mockResolvedValue([
      [
        { id: 1, dormId: 8, bedId: "EXE-1", type: "Bunk" },
        { id: 2, dormId: 8, bedId: "EXE-2", type: "Bunk" },
      ],
      [{ bedId: 1, dormId: 8, checkinDate: "2026-09-12", checkoutDate: "2026-09-13", inventoryPool: "online" }],
      [],
      [],
    ] as never);
    const res = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8],
      startDate: "2026-09-12", endDate: "2026-09-12", mode: "set", onlineRemaining: 0,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect(queryMocks.upsertInventoryOverride).toHaveBeenCalledWith(expect.objectContaining({
      dormId: 8, date: "2026-09-12", onlineAvailable: 1, offlineAvailable: null,
    }));
    expect(triggerInventoryPush).toHaveBeenCalledOnce();
    expect(queryMocks.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "INVENTORY_AVAILABILITY_BULK_UPDATED" }));
  });

  it("filters dates, caps per-night values, and reports unmapped rooms", async () => {
    queryMocks.getAllDorms.mockResolvedValue([{ id: 8, name: "Executive" }, { id: 9, name: "Dorm" }]);
    const res = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8, 9],
      startDate: "2026-09-12", endDate: "2026-09-13", dayFilter: [6, 0], mode: "set", onlineRemaining: 4,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(4);
    expect(body.capped).toBe(4);
    expect(body.unmappedDormIds).toEqual([9]);
    expect(queryMocks.upsertInventoryOverride).toHaveBeenCalledTimes(4);
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-12", "2026-09-13"], [8, 9]);
    expect(queryMocks.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('"dayFilter":[6,0]'),
    }));
  });

  it("clears only default overrides and does not write when validation fails", async () => {
    const clear = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8],
      startDate: "2026-09-12", endDate: "2026-09-12", mode: "clear",
    });
    expect(clear.status).toBe(200);
    expect(queryMocks.deleteInventoryOverride).toHaveBeenCalledWith({ dormId: 8, channelId: null, date: "2026-09-12" });
    expect(queryMocks.upsertInventoryOverride).not.toHaveBeenCalled();

    queryMocks.deleteInventoryOverride.mockClear();
    const invalid = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8],
      startDate: "2026-09-10", endDate: "2026-09-12", mode: "set", onlineRemaining: -1,
    });
    expect(invalid.status).toBe(400);
    expect(queryMocks.deleteInventoryOverride).not.toHaveBeenCalled();
    expect(queryMocks.upsertInventoryOverride).not.toHaveBeenCalled();

    const invalidDays = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8],
      startDate: "2026-09-12", endDate: "2026-09-12", dayFilter: ["6"], mode: "clear",
    });
    expect(invalidDays.status).toBe(400);
    expect(queryMocks.deleteInventoryOverride).not.toHaveBeenCalled();
  });

  it("reports partial local writes and pushes the applied scope when a later cell fails", async () => {
    queryMocks.upsertInventoryOverride
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("write failed"));
    const res = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8],
      startDate: "2026-09-12", endDate: "2026-09-13", mode: "set", onlineRemaining: 1,
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.partial).toBe(true);
    expect(body.updated).toBe(1);
    expect(triggerInventoryPush).toHaveBeenCalledWith(["2026-09-12"], [8]);
    expect(queryMocks.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "INVENTORY_AVAILABILITY_BULK_UPDATED" }));
  });

  it("returns local success while exposing an unaccepted PMS result for retry", async () => {
    vi.mocked(triggerInventoryPush).mockResolvedValue({ attempted: true, accepted: false, message: "PMS rejected the room code" });
    const res = await post({
      password: "x", action: "bulkSetAvailability", dormIds: [8],
      startDate: "2026-09-12", endDate: "2026-09-12", mode: "set", onlineRemaining: 1,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sync).toEqual({ attempted: true, accepted: false, message: "PMS rejected the room code" });
    expect(queryMocks.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining("PMS rejected the room code"),
    }));
  });
});
