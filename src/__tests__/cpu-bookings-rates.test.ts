import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getCalendarAvailability: vi.fn(),
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
  transitionBookingStatus: vi.fn(),
  getAllDorms: vi.fn(),
  getAllBeds: vi.fn(),
  getBedById: vi.fn(),
  getChannelConfig: vi.fn(),
  getSetting: vi.fn(),
  getActiveBedBlocks: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getRatePlanMappings: vi.fn(),
  getAllDailyRates: vi.fn(),
  getDailyRates: vi.fn(),
  deactivateBedBlocksByBedIds: vi.fn(),
  shortenAssignedCheckout: vi.fn(),
  pushNoShow: vi.fn(),
  createGuestReceipt: vi.fn(),
  resolveReceiptAccount: vi.fn(),
  latestReceiptAccount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
}));
vi.mock("@/lib/aiosell", () => ({
  pushNoShow: q.pushNoShow,
}));
vi.mock("@/lib/guestReceipts", () => ({
  createGuestReceipt: q.createGuestReceipt,
  resolveReceiptAccount: q.resolveReceiptAccount,
  latestReceiptAccount: q.latestReceiptAccount,
}));
vi.mock("@/db/queries", () => ({
  getCalendarAvailability: q.getCalendarAvailability,
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
  transitionBookingStatus: q.transitionBookingStatus,
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
import { todayIST } from "@/lib/utils";
import { pushIfOtaChanged } from "@/lib/aiosellSync";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };

describe("Bookings calendar and rates workflows", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.transitionBookingStatus.mockImplementation(async (id, _from, data) => {
      await q.updateBookingFull(id, data);
      return true;
    });
    q.cancelBedAssignments.mockResolvedValue(true);
    q.resolveReceiptAccount.mockResolvedValue(1);
    q.createGuestReceipt.mockResolvedValue({ id: 1, duplicate: false });
    q.latestReceiptAccount.mockResolvedValue(1);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("rejects missing calendar dates and unknown actions", async () => {
    expect((await POST(req({ password: "x", action: "getCalendarData" }))).status).toBe(400);
    expect((await POST(req({ password: "x", action: "notARealAction" }))).status).toBe(400);
    q.authenticateUser.mockResolvedValue(null);
    expect((await POST(req({ password: "bad", action: "getAvailableBeds", checkinDate: "2026-09-01", checkoutDate: "2026-09-02" }))).status).toBe(401);
  });

  it("getUnassigned returns open bookings with requested room type and one bed per person", async () => {
    q.getUnassignedBookings.mockResolvedValue([
      {
        id: 9,
        guestName: "Ada",
        checkinDate: "2027-01-01",
        checkoutDate: "2027-01-03",
        source: "channel_manager",
        roomType: "executive",
        persons: 2,
      },
    ]);
    q.getRoomTypeMappings.mockResolvedValue([
      { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
    ]);
    const res = await POST(req({ password: "x", action: "getUnassigned" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bookings).toEqual([
      {
        id: 9,
        guestName: "Ada",
        checkinDate: "2027-01-01",
        checkoutDate: "2027-01-03",
        source: "channel_manager",
        roomType: "executive",
        persons: 2,
        requestedRoomCodes: ["executive"],
        requestedDormIds: [8],
        requestedDormNames: ["Executive"],
        requestedBedCount: 2,
        requestedUnitCount: 2,
        requestedNeedLabels: "2 Executive",
        requestedNeeds: [{ dormId: 8, count: 2, units: 2, name: "Executive" }],
      },
    ]);
  });

  it("createBooking uses the returned row id to assign beds and write history", async () => {
    q.addBooking.mockResolvedValue(77);
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockResolvedValue({ id: 7, bedId: "E1", dormId: 9, dormName: "Executive" });
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "E1", dormId: 9, dormName: "Executive", pool: "online" },
    ]);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Walk-in",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      bedIds: [7],
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, bookingId: 77 });
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 77, bedId: 7 }));
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 77, action: "Created" }));
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      source: "manual",
      gokoBookingId: expect.stringMatching(/^GOKO\d{8}[A-Z0-9]{6}$/),
    }));
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("forbids staff without canViewBookings", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "No",
      permissions: { canViewRecords: true },
    });
    const res = await POST(req({
      password: "x",
      action: "getAvailableBeds",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-02",
    }));
    expect(res.status).toBe(403);
    expect(q.getAllDailyRates).not.toHaveBeenCalled();
  });

  it("enriches assignments via bed Map and keeps unknown beds empty", async () => {
    q.getBookingCalendarData.mockResolvedValue({
      bookings: [{ id: 1, checkinDate: "2026-09-01", checkoutDate: "2026-09-03", amountTotal: 1000, amountPaid: 200 }],
      assignments: [
        { id: 1, bedId: 7, bookingId: 1 },
        { id: 2, bedId: 99, bookingId: 1 },
      ],
    });
    q.getAllDorms.mockResolvedValue([{ id: 3, name: "Mixed" }]);
    q.getAllBeds.mockResolvedValue([
      { id: 7, bedId: "A1", dormId: 3, dormName: "Mixed" },
    ]);
    q.getCalendarAvailability.mockResolvedValue({ beds: { 7: { "2026-09-01": "block", "2026-09-02": "online" } }, dorms: { 3: { "2026-09-01": { online: 0, offline: 0, blocked: 1 } } } });

    const res = await POST(req({
      password: "x",
      action: "getCalendarData",
      startDate: "2026-09-01",
      endDate: "2026-09-10",
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.assignments[0]).toMatchObject({ dormName: "Mixed", bedLabel: "A1" });
    expect(json.assignments[1]).toMatchObject({ dormName: "", bedLabel: "" });
    expect(json.dorms[0].beds[0].availability).toEqual({ "2026-09-01": "block", "2026-09-02": "online" });
    expect(json.dorms[0].availability["2026-09-01"]).toEqual({ online: 0, offline: 0, blocked: 1 });
    expect(json.bookings[0]).toMatchObject({ nights: 2, balance: 800 });
    expect(json.role).toBe("admin");
    expect(json.permissions).toEqual({});
  });

  it("loads rates once and only records dorms with an active plan row", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 1, bedId: "E1", dormId: 9, dormName: "Exec", pool: "inventory" },
    ]);
    q.getRoomTypeMappings.mockResolvedValue([
      { id: 1, dormId: 9 },
      { id: 2, dormId: 10 },
      { id: 3, dormId: 11 },
    ]);
    q.getRatePlanMappings.mockResolvedValue([
      { id: 37, roomMappingId: 1, isActive: 1 },
      { id: 38, roomMappingId: 1, isActive: 1 },
      { id: 40, roomMappingId: 2, isActive: 0 },
      { id: 41, roomMappingId: 3, isActive: 1 },
    ]);
    q.getAllDailyRates.mockResolvedValue([
      { ratePlanId: 37, date: "2026-09-01", rate: 999, adult1Rate: 0 },
      { ratePlanId: 38, date: "2026-09-01", rate: 500, adult1Rate: 500 },
      { ratePlanId: 41, date: "2026-09-01", rate: 1200, adult1Rate: null },
    ]);

    const res = await POST(req({
      password: "x",
      action: "getAvailableBeds",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-03",
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(q.getAllDailyRates).toHaveBeenCalledTimes(1);
    expect(q.getAllDailyRates).toHaveBeenCalledWith("2026-09-01", "2026-09-01");
    expect(q.getDailyRates).not.toHaveBeenCalled();
    expect(json.beds[0]).toMatchObject({ pool: "inventory", dormId: 9 });
    expect(json.dormRates).toEqual({ 9: 0, 11: 1200 });
    expect(json.dormRates[10]).toBeUndefined();
    expect(json.taxRate).toBe(5);
  });

  it("getAvailableBeds returns the configured booking_tax_rate", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue([]);
    q.getRatePlanMappings.mockResolvedValue([]);
    q.getAllDailyRates.mockResolvedValue([]);
    q.getSetting.mockResolvedValue("8");
    const res = await POST(req({
      password: "x",
      action: "getAvailableBeds",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-02",
    }));
    expect((await res.json()).taxRate).toBe(8);
  });

  it("getAvailableBeds returns taxRate 0 when booking_tax_rate is 0", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue([]);
    q.getRatePlanMappings.mockResolvedValue([]);
    q.getAllDailyRates.mockResolvedValue([]);
    q.getSetting.mockResolvedValue("0");
    const res = await POST(req({
      password: "x",
      action: "getAvailableBeds",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-02",
    }));
    expect((await res.json()).taxRate).toBe(0);
  });

  it("early checkOut shortens assigned nights to today", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: "2020-01-01", checkoutDate: "2099-01-01" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({ password: "x", action: "checkOut", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.shortenAssignedCheckout).toHaveBeenCalledWith(5, todayIST());
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      status: "checked_out",
    }));
    expect(q.updateBookingFull.mock.calls[0][1]).not.toHaveProperty("checkoutDate");
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
  });

  it("second checkOut on an already checked-out booking 409s and does not extend assignments", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "checked_out", checkinDate: "2026-09-01", checkoutDate: "2026-09-10" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-09-03" }],
    });
    const res = await POST(req({ password: "x", action: "checkOut", bookingId: 5 }));
    expect(res.status).toBe(409);
    expect(q.shortenAssignedCheckout).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("same-day checkOut keeps the assignment and cuts exclusive checkout to check-in (zero nights)", async () => {
    const today = todayIST();
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: today, checkoutDate: "2099-01-01" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({ password: "x", action: "checkOut", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.shortenAssignedCheckout).toHaveBeenCalledWith(5, today);
  });

  it("rollbackCheckOut restores assignment checkout from the booking dates", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: "2026-08-01", checkoutDate: "2026-09-10" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-08-20" }],
    });
    q.checkBedAvailability.mockResolvedValue(true);
    const res = await POST(req({ password: "x", action: "rollbackCheckOut", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.checkBedAvailability).toHaveBeenCalledWith(7, "2026-08-20", "2026-09-10", 5);
    expect(q.shortenAssignedCheckout).toHaveBeenCalledWith(5, "2026-09-10");
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ status: "checked_in" }));
  });

  it("rollbackCheckOut 409s when nights between shortened checkout and planned checkout were taken", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: "2026-08-01", checkoutDate: "2026-09-10" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-08-20" }],
    });
    q.checkBedAvailability.mockResolvedValue(false);
    const res = await POST(req({ password: "x", action: "rollbackCheckOut", bookingId: 5 }));
    expect(res.status).toBe(409);
    expect(q.checkBedAvailability).toHaveBeenCalledWith(7, "2026-08-20", "2026-09-10", 5);
    expect(q.shortenAssignedCheckout).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("keeps the first daily-rate row per plan when duplicates appear", async () => {
    q.getAvailableBedsForRange.mockResolvedValue([]);
    q.getRoomTypeMappings.mockResolvedValue([{ id: 1, dormId: 9 }]);
    q.getRatePlanMappings.mockResolvedValue([{ id: 37, roomMappingId: 1, isActive: 1 }]);
    q.getAllDailyRates.mockResolvedValue([
      { ratePlanId: 37, date: "2026-09-01", rate: 100, adult1Rate: 100 },
      { ratePlanId: 37, date: "2026-09-01", rate: 1, adult1Rate: 1 },
    ]);
    const json = await (await POST(req({
      password: "x",
      action: "getAvailableBeds",
      checkinDate: "2026-09-01",
      checkoutDate: "2026-09-02",
    }))).json();
    expect(json.dormRates).toEqual({ 9: 100 });
  });

  it("requires both dates for getAvailableBeds", async () => {
    const res = await POST(req({ password: "x", action: "getAvailableBeds", checkinDate: "2026-09-01" }));
    expect(res.status).toBe(400);
    expect(q.getAllDailyRates).not.toHaveBeenCalled();
  });

  it("markNoShow notifies Aiosell when the webhook stored platform as booking.com", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { platform: "booking.com", bookingRef: "BK-1", cmBookingId: "CM-1", checkinDate: "2026-09-01", checkoutDate: "2026-09-03" },
      assignments: [{ status: "assigned", dormId: 3 }],
    });
    q.getChannelConfig.mockResolvedValue({
      isActive: 1, hotelCode: "H", pmsId: "P", apiBaseUrl: "http://x", apiUsername: "u", apiPassword: "p",
    });
    q.pushNoShow.mockResolvedValue({ success: true });
    const res = await POST(req({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(5);
    expect(q.pushNoShow).toHaveBeenCalledWith(expect.objectContaining({ hotelCode: "H" }), "BK-1");
    expect(pushIfOtaChanged).toHaveBeenCalled();
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ noShowPmsStatus: "sent", noShowPmsError: "" }));
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 5, action: "Marked No-Show" }));
  });

  it("keeps the local release and records a retry when Aiosell rejects the no-show", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { platform: "booking.com", cmBookingId: "CM-FAIL", checkinDate: "2026-09-01", checkoutDate: "2026-09-03" },
      assignments: [{ status: "assigned", dormId: 3 }],
    });
    q.getChannelConfig.mockResolvedValue({ isActive: 1, hotelCode: "H", pmsId: "P", apiBaseUrl: "http://x", apiUsername: "u", apiPassword: "p" });
    q.pushNoShow.mockResolvedValue({ success: false, message: "unknown booking" });
    const res = await POST(req({ password: "x", action: "markNoShow", bookingId: 5 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warning).toContain("unknown booking");
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(5);
    expect(pushIfOtaChanged).toHaveBeenCalledTimes(1);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ noShowPmsStatus: "failed", noShowPmsError: "unknown booking" }));
  });

  it("falls back to the legacy CM id when Aiosell cannot find the booking reference", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { platform: "booking.com", bookingRef: "BK-404", cmBookingId: "CM-FOUND", checkinDate: "2026-09-01", checkoutDate: "2026-09-03" },
      assignments: [{ status: "assigned", dormId: 3 }],
    });
    q.getChannelConfig.mockResolvedValue({ isActive: 1, hotelCode: "H", pmsId: "P", apiBaseUrl: "http://x", apiUsername: "u", apiPassword: "p" });
    q.pushNoShow
      .mockResolvedValueOnce({ success: false, message: 'HTTP 404: {"error":"Not Found"}' })
      .mockResolvedValueOnce({ success: true });
    const res = await POST(req({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.pushNoShow).toHaveBeenNthCalledWith(1, expect.anything(), "BK-404");
    expect(q.pushNoShow).toHaveBeenNthCalledWith(2, expect.anything(), "CM-FOUND");
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ noShowPmsStatus: "sent" }));
  });

  it("retries only the failed Aiosell notification without releasing inventory again", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "no_show", noShowPmsStatus: "failed", platform: "booking.com", cmBookingId: "CM-RETRY" },
      assignments: [],
    });
    q.getChannelConfig.mockResolvedValue({ isActive: 1, hotelCode: "H", pmsId: "P", apiBaseUrl: "http://x", apiUsername: "u", apiPassword: "p" });
    q.pushNoShow.mockResolvedValue({ success: true });
    const res = await POST(req({ password: "x", action: "retryNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.pushNoShow).toHaveBeenCalledWith(expect.anything(), "CM-RETRY");
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ noShowPmsStatus: "sent" }));
  });

  it("markNoShow on a channel_manager stay still pushes occupancy (Aiosell already got noshow)", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        platform: "booking.com",
        cmBookingId: "CM-9",
        source: "channel_manager",
        checkinDate: "2026-09-01",
        checkoutDate: "2026-09-03",
      },
      assignments: [{ status: "assigned", dormId: 3 }],
    });
    q.getChannelConfig.mockResolvedValue({
      isActive: 1, hotelCode: "H", pmsId: "P", apiBaseUrl: "http://x", apiUsername: "u", apiPassword: "p",
    });
    q.pushNoShow.mockResolvedValue({ success: true });
    const res = await POST(req({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.pushNoShow).toHaveBeenCalledWith(expect.anything(), "CM-9");
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("markNoShow skips the Aiosell noshow API for Hostelworld but still unassigns", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        platform: "hostelworld",
        cmBookingId: "HW-1",
        source: "channel_manager",
        checkinDate: "2026-09-01",
        checkoutDate: "2026-09-02",
      },
      assignments: [{ status: "assigned", dormId: 3 }],
    });
    const res = await POST(req({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.pushNoShow).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(5);
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("markNoShow skips Aiosell when cmBookingId is missing", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { platform: "booking.com", cmBookingId: "", checkinDate: "2026-09-01", checkoutDate: "2026-09-02" },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "markNoShow", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.pushNoShow).not.toHaveBeenCalled();
  });

  it("checkIn 409s on a checked-out booking", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "checked_out", checkinDate: "2026-09-01", checkoutDate: "2026-09-10" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-09-05" }],
    });
    const res = await POST(req({ password: "x", action: "checkIn", bookingId: 5 }));
    expect(res.status).toBe(409);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("modifyCheckin 409s on a checked-out booking", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { status: "checked_out", checkinDate: "2026-09-01", checkoutDate: "2026-09-10" },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-09-05" }],
    });
    const res = await POST(req({
      password: "x", action: "modifyCheckin", bookingId: 5, newCheckinDate: "2026-09-02",
    }));
    expect(res.status).toBe(409);
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("assignGuest does not overwrite an Aiosell cmBookingId", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { cmBookingId: "CM-99" },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "assignGuest", bookingId: 5, checkinId: 42 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(q.addBookingHistoryEntry).toHaveBeenCalled();
  });

  it("partial cancel only releases assignments that belong to the booking", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: "2026-09-01", checkoutDate: "2026-09-03" },
      assignments: [{ id: 11, status: "assigned", dormId: 3 }],
    });
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5, assignmentIds: [11, 999],
    }));
    expect(res.status).toBe(200);
    expect(q.cancelBedAssignments).toHaveBeenCalledWith([11], 5);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("assignBeds on a channel_manager overflow stay keeps the offline chip pool and does not push Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockResolvedValue({ id: 7, bedId: "E1", dormId: 9, dormName: "Executive" });
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "E1", dormId: 9, dormName: "Executive", pool: "offline" },
    ]);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assigned).toEqual(["Executive/E1"]);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      bedId: 7,
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("assignBeds on a walk-in booking pushes inventory when OTA availability changes", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
      },
      assignments: [],
    });
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockResolvedValue({ id: 7, bedId: "E1", dormId: 9, dormName: "Executive" });
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "E1", dormId: 9, dormName: "Executive", pool: "online" },
    ]);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({ inventoryPool: "online" }));
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("assignBeds 409s when D1 reports no row written, without a PMS push", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
      },
      assignments: [],
    });
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockResolvedValue({ id: 7, bedId: "E1", dormId: 9, dormName: "Executive" });
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "E1", dormId: 9, dormName: "Executive", pool: "online" },
    ]);
    q.assignBedToBooking.mockResolvedValue(false);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7] }));
    expect(res.status).toBe(409);
    expect(q.addBookingHistoryEntry).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("rolls back the first bed when the second assignBeds write fails", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-07",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockImplementation(async (id: number) => (
      id === 7 || id === 8
        ? { id, bedId: `E${id}`, dormId: 9, dormName: "Executive" }
        : null
    ));
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "E7", dormId: 9, dormName: "Executive", pool: "offline" },
      { id: 8, bedId: "E8", dormId: 9, dormName: "Executive", pool: "offline" },
    ]);
    q.assignBedToBooking.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8] }));
    expect(res.status).toBe(409);
    expect(q.unassignBookingBedsByBedIds).toHaveBeenCalledWith(42, [7]);
    expect(q.addBookingHistoryEntry).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("assignBeds 400s when the pick count is not one bed per person", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
        roomType: "executive",
        persons: 2,
      },
      assignments: [],
    });
    q.getRoomTypeMappings.mockResolvedValue([
      { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
    ]);
    q.getBedById.mockResolvedValue({ id: 7, bedId: "E1", dormId: 8, dormName: "Executive" });

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/2 guest/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("assignBeds 400s when mixed types are all tagged in one dorm", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
        roomType: "executive, dorm-6",
        persons: 3,
      },
      assignments: [],
    });
    q.getRoomTypeMappings.mockResolvedValue([
      { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
      { dormId: 9, channelRoomCode: "dorm-6", isActive: 1, dormName: "Dorm 1" },
    ]);
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockImplementation(async (id: number) => ({
      id, bedId: `E${id}`, dormId: 8, dormName: "Executive",
    }));

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 9] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Executive/);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("assignBeds allows overflow beds in another dorm when leftover requested chips are gone", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
        roomType: "executive",
        persons: 2,
      },
      assignments: [],
    });
    q.getRoomTypeMappings.mockResolvedValue([
      { dormId: 8, channelRoomCode: "executive", isActive: 1, dormName: "Executive" },
    ]);
    q.validateBedsForRange.mockResolvedValue(null);
    q.getBedById.mockImplementation(async (id: number) => ({
      id, bedId: `D${id}`, dormId: 9, dormName: "Dorm 1",
    }));
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "D7", dormId: 9, dormName: "Dorm 1", pool: "offline" },
      { id: 8, bedId: "D8", dormId: 9, dormName: "Dorm 1", pool: "offline" },
    ]);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({ password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8] }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("unassign does not push but cancel on a channel_manager booking releases Aiosell inventory", async () => {
    const cm = {
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7, checkinDate: "2026-09-05", checkoutDate: "2026-09-06" }],
    };
    q.getBookingDetail.mockResolvedValue(cm);
    expect((await POST(req({ password: "x", action: "unassign", bookingId: 42 }))).status).toBe(200);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();

    vi.mocked(pushIfOtaChanged).mockClear();
    q.getBookingDetail.mockResolvedValue(cm);
    expect((await POST(req({ password: "x", action: "cancelBooking", bookingId: 42 }))).status).toBe(200);
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("claims a full cancellation once, so a concurrent retry cannot release or push twice", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual" },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    q.transitionBookingStatus.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const results = await Promise.all([
      POST(req({ password: "x", action: "cancelBooking", bookingId: 42 })),
      POST(req({ password: "x", action: "cancelBooking", bookingId: 42 })),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(q.unassignBookingBeds).toHaveBeenCalledTimes(1);
    expect(pushIfOtaChanged).toHaveBeenCalledTimes(1);
  });

  it("claims a no-show once, so a concurrent retry cannot release or push twice", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { checkinDate: "2026-09-01", checkoutDate: "2026-09-02", status: "received", source: "manual" },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    q.transitionBookingStatus.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const results = await Promise.all([
      POST(req({ password: "x", action: "markNoShow", bookingId: 42 })),
      POST(req({ password: "x", action: "markNoShow", bookingId: 42 })),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(q.unassignBookingBeds).toHaveBeenCalledTimes(1);
    expect(pushIfOtaChanged).toHaveBeenCalledTimes(1);
  });

  it("staff cannot Reject an unassigned stay even with canDeleteBooking", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canDeleteBooking: true, canViewBookings: true },
    });
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "cancelBooking", bookingId: 9 }));
    expect(res.status).toBe(403);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("manager can Reject an unassigned stay without canDeleteBooking", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Manager",
      permissions: {},
    });
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "cancelBooking", bookingId: 9 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(9, expect.objectContaining({ status: "cancelled" }));
  });

  it("staff with canDeleteBooking can still cancel an assigned stay", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canDeleteBooking: true },
    });
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({ password: "x", action: "cancelBooking", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ status: "cancelled" }));
  });

  it("manager without canDeleteBooking cannot cancel an assigned stay", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Manager",
      permissions: {},
    });
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({ password: "x", action: "cancelBooking", bookingId: 5 }));
    expect(res.status).toBe(403);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("unassign on a walk-in booking still pushes when OTA availability changes", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    expect((await POST(req({ password: "x", action: "unassign", bookingId: 42 }))).status).toBe(200);
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("moveRoom on a channel_manager booking stores the destination chip pool and does not push", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    q.getBedById.mockResolvedValue({ id: 8, bedId: "E2", dormId: 9, dormName: "Executive" });
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 8, bedId: "E2", dormId: 9, dormName: "Executive", pool: "offline" },
    ]);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({
      password: "x", action: "moveRoom", bookingId: 42, oldAssignmentId: 11, newBedId: 8,
    }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bedId: 8,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("checkOut on a channel_manager booking does not push occupancy back to Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "checked_in",
        source: "channel_manager",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-09-10" }],
    });
    expect((await POST(req({ password: "x", action: "checkOut", bookingId: 42 }))).status).toBe(200);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("rollbackCheckOut on a channel_manager booking does not push occupancy back to Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-08-01",
        checkoutDate: "2026-09-10",
        status: "checked_out",
        source: "channel_manager",
      },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7, checkoutDate: "2026-08-20" }],
    });
    q.checkBedAvailability.mockResolvedValue(true);
    const res = await POST(req({ password: "x", action: "rollbackCheckOut", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("modifyCheckin on a channel_manager booking does not push occupancy back to Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-01",
        checkoutDate: "2026-09-10",
        status: "received",
        source: "channel_manager",
        nightlyRate: 1000,
      },
      assignments: [{
        status: "assigned", dormId: 3, bedId: 7,
        checkinDate: "2026-09-01", checkoutDate: "2026-09-10",
      }],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckin", bookingId: 5, newCheckinDate: "2026-09-02",
    }));
    expect(res.status).toBe(200);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("checkIn collectPayment writes amountPaid and paymentStatus paid", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "received",
        amountTotal: 31500,
        paymentStatus: "pay_at_hotel",
      },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({
      password: "x", action: "checkIn", bookingId: 5, collectPayment: true,
      paymentMethod: "cash", cashReceived: 31500, changeGiven: 0,
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      status: "checked_in",
      amountPaid: 31500,
      paymentStatus: "paid",
      paymentMethod: "cash",
    }));
  });

  it("checkIn without collectPayment records prepaid as online stay revenue", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "received",
        amountTotal: 31500,
        amountPaid: 0,
        paymentStatus: "prepaid",
      },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "checkIn", bookingId: 5, collectPayment: false }));
    expect(res.status).toBe(200);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.status).toBe("checked_in");
    expect(patch.amountPaid).toBe(31500);
    expect(patch.paymentMethod).toBe("online");
    expect(patch.paymentStatus).toBeUndefined();
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining("OTA prepaid ₹31500"),
    }));
  });

  it("checkIn on a channel_manager booking does not push occupancy back to Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "received",
        source: "channel_manager",
      },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({ password: "x", action: "checkIn", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("rollbackCheckIn on a channel_manager booking does not push occupancy back to Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "checked_in",
        source: "channel_manager",
      },
      assignments: [{ status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({ password: "x", action: "rollbackCheckIn", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({ status: "received" }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("editReservation addBedIds on a channel_manager booking does not push Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    q.getBedById.mockResolvedValue({ id: 7, bedId: "E1", dormId: 9, dormName: "Executive" });
    q.getAvailableBedsForRange.mockResolvedValue([
      { id: 7, bedId: "E1", dormId: 9, dormName: "Executive", pool: "offline" },
    ]);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({
      password: "x", action: "editReservation", bookingId: 42, addBedIds: [7],
    }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      bedId: 7,
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("editReservation removeBedIds on a channel_manager booking does not push Aiosell", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    });
    const res = await POST(req({
      password: "x", action: "editReservation", bookingId: 42, removeBedIds: [7],
    }));
    expect(res.status).toBe(200);
    expect(q.cancelBedAssignments).toHaveBeenCalledWith([11], 42);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  function stay(over: Record<string, unknown> = {}) {
    return {
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "checked_in",
        amountTotal: 94500,
        amountPaid: 0,
        paymentStatus: "pay_at_hotel",
        paymentMethod: "",
        cashReceived: 0,
        ...over,
      },
      assignments: [{ id: 11, status: "assigned", dormId: 3, bedId: 7 }],
    };
  }

  it("workflow: Later check-in then Dashboard collectStayPayment cash", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ status: "received" }));
    const later = await POST(req({ password: "x", action: "checkIn", bookingId: 5, collectPayment: false }));
    expect(later.status).toBe(200);
    expect(q.updateBookingFull.mock.calls[0][1].amountPaid).toBeUndefined();

    q.getBookingDetail.mockResolvedValue(stay({ status: "checked_in" }));
    const collect = await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5,
      paymentMethod: "cash", cashReceived: 94500, changeGiven: 0,
    }));
    expect(collect.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenLastCalledWith(5, expect.objectContaining({
      amountPaid: 94500, paymentStatus: "paid", paymentMethod: "cash",
    }));
  });

  it("workflow: collect remaining after price-up becomes split when remainder is online", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      amountTotal: 120000, amountPaid: 100000, paymentStatus: "paid",
      paymentMethod: "cash", cashReceived: 100000,
    }));
    const res = await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5,
      paymentMethod: "online", cashReceived: 0, changeGiven: 0,
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      amountPaid: 120000, paymentMethod: "split", cashReceived: 100000,
    }));
  });

  it("workflow: collectStayPayment refuses prepaid and received", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      paymentStatus: "prepaid", amountTotal: 31500, amountPaid: 0, status: "checked_in",
    }));
    expect((await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5, paymentMethod: "cash", cashReceived: 31500,
    }))).status).toBe(400);

    q.getBookingDetail.mockResolvedValue(stay({ status: "received" }));
    expect((await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5, paymentMethod: "cash", cashReceived: 94500,
    }))).status).toBe(409);
  });

  it("workflow: checkIn prepaid records online stay revenue and ignores a cash collect payload", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      status: "received", paymentStatus: "prepaid", amountTotal: 31500, amountPaid: 0,
    }));
    const res = await POST(req({
      password: "x", action: "checkIn", bookingId: 5, collectPayment: true,
      paymentMethod: "cash", cashReceived: 31500,
    }));
    expect(res.status).toBe(200);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.status).toBe("checked_in");
    expect(patch.amountPaid).toBe(31500);
    expect(patch.paymentMethod).toBe("online");
    expect(patch.paymentStatus).toBeUndefined();
  });

  it("workflow: checkIn collectPayment without method is 400 when due", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ status: "received" }));
    const res = await POST(req({ password: "x", action: "checkIn", bookingId: 5, collectPayment: true }));
    expect(res.status).toBe(400);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("workflow: split collect with cash above the bill stores cash not inflated split", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ status: "checked_in" }));
    const res = await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5,
      paymentMethod: "split", cashReceived: 999999,
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      paymentMethod: "cash", cashReceived: 94500, amountPaid: 94500,
    }));
  });

  it("workflow: cancel checked-in refund 0 does not write refund fields", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ amountPaid: 94500, paymentStatus: "paid", paymentMethod: "cash" }));
    const res = await POST(req({ password: "x", action: "cancelBooking", bookingId: 5, refundAmount: 0 }));
    expect(res.status).toBe(200);
    const patch = q.updateBookingFull.mock.calls[0][1];
    expect(patch.status).toBe("cancelled");
    expect(patch.amountRefunded).toBeUndefined();
    expect(patch.amountPaid).toBeUndefined();
  });

  it("workflow: cancel checked-in cash refund writes refund and leaves amountPaid", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      amountPaid: 94500, paymentStatus: "paid", paymentMethod: "online",
    }));
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5,
      refundAmount: 50000, refundMethod: "cash",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      status: "cancelled",
      amountRefunded: 50000,
      refundMethod: "cash",
      refundCash: 50000,
    }));
    expect(q.updateBookingFull.mock.calls[0][1].amountPaid).toBeUndefined();
  });

  it("workflow: cancel refund cannot exceed Goko amountPaid (OTA total is not the cap)", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      amountTotal: 12600000, amountPaid: 0, paymentStatus: "prepaid",
    }));
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5,
      refundAmount: 12600000, refundMethod: "cash",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull.mock.calls[0][1].amountRefunded).toBeUndefined();
  });

  it("workflow: cancel refund missing method when amount is due from till is 400", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ amountPaid: 94500, paymentStatus: "paid" }));
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5, refundAmount: 94500,
    }));
    expect(res.status).toBe(400);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("workflow: refund on received stay ignores refundAmount", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ status: "received", amountPaid: 0 }));
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5,
      refundAmount: 94500, refundMethod: "cash",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull.mock.calls[0][1].amountRefunded).toBeUndefined();
  });

  it("workflow: staff with canCheckIn can collectStayPayment; view-only cannot", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Staff", permissions: { canCheckIn: true },
    });
    q.getBookingDetail.mockResolvedValue(stay());
    expect((await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5, paymentMethod: "online",
    }))).status).toBe(200);

    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Staff", permissions: { canViewDashboard: true },
    });
    expect((await POST(req({
      password: "x", action: "collectStayPayment", bookingId: 5, paymentMethod: "online",
    }))).status).toBe(403);
  });

  it("workflow: cancel split refund clamps cash to the refund amount", async () => {
    q.getBookingDetail.mockResolvedValue(stay({ amountPaid: 94500, paymentStatus: "paid" }));
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5,
      refundAmount: 40000, refundMethod: "split", refundCash: 99999,
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      amountRefunded: 40000, refundMethod: "cash", refundCash: 40000,
    }));
  });

  it("workflow: cancel after prepaid check-in can refund the recorded amount", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      amountTotal: 31500, amountPaid: 31500, paymentStatus: "prepaid", paymentMethod: "online",
    }));
    const res = await POST(req({
      password: "x", action: "cancelBooking", bookingId: 5,
      refundAmount: 31500, refundMethod: "online",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      status: "cancelled",
      amountRefunded: 31500,
      refundMethod: "online",
      refundCash: 0,
    }));
    expect(q.updateBookingFull.mock.calls[0][1].amountPaid).toBeUndefined();
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining("refund ₹31500 online"),
    }));
  });

  it("workflow: rollbackCheckIn reverses prepaid check-in recording", async () => {
    q.getBookingDetail.mockResolvedValue(stay({
      amountTotal: 31500, amountPaid: 31500, paymentStatus: "prepaid", paymentMethod: "online",
    }));
    const res = await POST(req({ password: "x", action: "rollbackCheckIn", bookingId: 5 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      status: "received",
      amountPaid: 0,
      paymentMethod: "",
    }));
  });
});
