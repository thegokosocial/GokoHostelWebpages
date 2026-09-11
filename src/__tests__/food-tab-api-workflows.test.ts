import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getDb: vi.fn(),
  getBookingDetail: vi.fn(),
  updateBookingFull: vi.fn(),
  shortenAssignedCheckout: vi.fn(),
  addBookingHistoryEntry: vi.fn(),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  getReviewRequestByCheckinId: vi.fn(),
  createReviewRequest: vi.fn(),
  getCheckinsByMonth: vi.fn(),
  getActiveCheckins: vi.fn(),
  addCheckin: vi.fn(),
  updateCheckin: vi.fn(),
  deleteCheckin: vi.fn(),
  getCheckinMonths: vi.fn(),
  markVibeMatched: vi.fn(),
  getAllBeds: vi.fn(),
  getBedById: vi.fn(),
  updateBedStatus: vi.fn(),
  getAllDorms: vi.fn(),
  getDormByName: vi.fn(),
  addDorm: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  deleteDormAndBeds: vi.fn(),
  logBedHistoryEntry: vi.fn(),
  getBedHistoryAll: vi.fn(),
  deleteBedHistoryEntry: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getAllStats: vi.fn(),
  incrementStat: vi.fn(),
  getMonthKey: vi.fn(() => "2026-08"),
  getAllBookings: vi.fn(),
  getUpcomingBookings: vi.fn(),
  addBooking: vi.fn(),
  updateBookingStatus: vi.fn(),
  deleteBooking: vi.fn(),
  createRateScrape: vi.fn(),
  getLatestRateScrape: vi.fn(),
  getRateScrapeById: vi.fn(),
  updateRateScrape: vi.fn(),
  getAllUsers: vi.fn(),
  getUserByUsername: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getAuditEntries: vi.fn(),
  getSystemLogs: vi.fn(),
  getBookingCalendarData: vi.fn(),
  searchBookings: vi.fn(),
  getUnassignedBookings: vi.fn(),
  checkBedAvailability: vi.fn(),
  getAvailableBedsForRange: vi.fn(),
  validateBedsForRange: vi.fn(),
  assignBedToBooking: vi.fn(),
  unassignBookingBeds: vi.fn(),
  unassignBookingBedsByBedIds: vi.fn(),
  cancelBedAssignments: vi.fn(),
  getBookingHistoryEntries: vi.fn(),
  getChannelConfig: vi.fn(),
  getActiveBedBlocks: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getRatePlanMappings: vi.fn(),
  getAllDailyRates: vi.fn(),
  deactivateBedBlocksByBedIds: vi.fn(),
}));

const food = vi.hoisted(() => ({
  getPendingFoodTab: vi.fn(),
  contactToCheckinIdMap: vi.fn(() => new Map()),
  checkinIdsMatchingContact: vi.fn(() => []),
  activeCheckinIdsForContact: vi.fn(async (): Promise<number[]> => []),
  unpaidFoodCheckoutMessage: vi.fn(),
}));

vi.mock("@/lib/foodTab", () => ({
  contactToCheckinIdMap: food.contactToCheckinIdMap,
  checkinIdsMatchingContact: food.checkinIdsMatchingContact,
  unpaidFoodCheckoutMessage: food.unpaidFoodCheckoutMessage,
  EMPTY_FOOD_TAB: { checkinId: null, pendingTab: 0, pendingOrders: 0, orderIds: [] },
}));

vi.mock("@/lib/foodTabDb", () => ({
  getPendingFoodTab: food.getPendingFoodTab,
  activeCheckinIdsForContact: food.activeCheckinIdsForContact,
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: q.authenticateUser,
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => false }));
vi.mock("@/lib/googleApiFetch", () => ({ driveDeleteFile: vi.fn() }));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
  triggerInventoryPush: vi.fn(),
}));
vi.mock("@/lib/aiosell", () => ({ pushNoShow: vi.fn() }));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/queries", () => ({
  getBookingDetail: q.getBookingDetail,
  updateBookingFull: q.updateBookingFull,
  shortenAssignedCheckout: q.shortenAssignedCheckout,
  addBookingHistoryEntry: q.addBookingHistoryEntry,
  addAuditEntry: q.addAuditEntry,
  addSystemLog: q.addSystemLog,
  getReviewRequestByCheckinId: q.getReviewRequestByCheckinId,
  createReviewRequest: q.createReviewRequest,
  getCheckinsByMonth: q.getCheckinsByMonth,
  getActiveCheckins: q.getActiveCheckins,
  addCheckin: q.addCheckin,
  updateCheckin: q.updateCheckin,
  deleteCheckin: q.deleteCheckin,
  getCheckinMonths: q.getCheckinMonths,
  markVibeMatched: q.markVibeMatched,
  getAllBeds: q.getAllBeds,
  getBedById: q.getBedById,
  updateBedStatus: q.updateBedStatus,
  getAllDorms: q.getAllDorms,
  getDormByName: q.getDormByName,
  addDorm: q.addDorm,
  addBed: q.addBed,
  deleteBed: q.deleteBed,
  deleteDormAndBeds: q.deleteDormAndBeds,
  logBedHistoryEntry: q.logBedHistoryEntry,
  getBedHistoryAll: q.getBedHistoryAll,
  deleteBedHistoryEntry: q.deleteBedHistoryEntry,
  getSetting: q.getSetting,
  setSetting: q.setSetting,
  getAllStats: q.getAllStats,
  incrementStat: q.incrementStat,
  getMonthKey: q.getMonthKey,
  getAllBookings: q.getAllBookings,
  getUpcomingBookings: q.getUpcomingBookings,
  addBooking: q.addBooking,
  updateBookingStatus: q.updateBookingStatus,
  deleteBooking: q.deleteBooking,
  createRateScrape: q.createRateScrape,
  getLatestRateScrape: q.getLatestRateScrape,
  getRateScrapeById: q.getRateScrapeById,
  updateRateScrape: q.updateRateScrape,
  getAllUsers: q.getAllUsers,
  getUserByUsername: q.getUserByUsername,
  createUser: q.createUser,
  updateUser: q.updateUser,
  deleteUser: q.deleteUser,
  getAuditEntries: q.getAuditEntries,
  getSystemLogs: q.getSystemLogs,
  getBookingCalendarData: q.getBookingCalendarData,
  searchBookings: q.searchBookings,
  getUnassignedBookings: q.getUnassignedBookings,
  checkBedAvailability: q.checkBedAvailability,
  getAvailableBedsForRange: q.getAvailableBedsForRange,
  validateBedsForRange: q.validateBedsForRange,
  assignBedToBooking: q.assignBedToBooking,
  unassignBookingBeds: q.unassignBookingBeds,
  unassignBookingBedsByBedIds: q.unassignBookingBedsByBedIds,
  cancelBedAssignments: q.cancelBedAssignments,
  getBookingHistoryEntries: q.getBookingHistoryEntries,
  getChannelConfig: q.getChannelConfig,
  getActiveBedBlocks: q.getActiveBedBlocks,
  getRoomTypeMappings: q.getRoomTypeMappings,
  getRatePlanMappings: q.getRatePlanMappings,
  getAllDailyRates: q.getAllDailyRates,
  deactivateBedBlocksByBedIds: q.deactivateBedBlocksByBedIds,
}));

import { POST as bookingsPOST } from "@/app/api/admin/bookings/route";
import { POST as checkinsPOST } from "@/app/api/admin/checkins/route";
import { todayIST } from "@/lib/utils";

const EMPTY_TAB = { checkinId: null, pendingTab: 0, pendingOrders: 0, orderIds: [] };
const UNPAID_TAB = { checkinId: 99, pendingTab: 45000, pendingOrders: 2, orderIds: [1, 2] };

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };

function bookingsReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function checkinsReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function staff(permissions: Record<string, boolean>) {
  return { role: "staff" as const, displayName: "Staff", permissions };
}

function openBookingDetail(contact?: string) {
  return {
    booking: {
      contact: contact ?? "9876543210",
      checkinDate: "2020-01-01",
      checkoutDate: "2099-01-01",
      status: "checked_in",
    },
    assignments: [{ status: "assigned", dormId: 3, bedId: 7 }],
  };
}

describe("Food tab API workflows", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    food.getPendingFoodTab.mockReset();
    food.contactToCheckinIdMap.mockReset();
    food.checkinIdsMatchingContact.mockReset();
    food.activeCheckinIdsForContact.mockReset();
    food.unpaidFoodCheckoutMessage.mockReset();
    food.contactToCheckinIdMap.mockReturnValue(new Map());
    food.checkinIdsMatchingContact.mockReturnValue([]);
    food.activeCheckinIdsForContact.mockResolvedValue([]);
    food.getPendingFoodTab.mockResolvedValue(EMPTY_TAB);
    q.authenticateUser.mockResolvedValue(admin);
    q.addSystemLog.mockResolvedValue(undefined);
    q.addAuditEntry.mockResolvedValue(undefined);
    q.getMonthKey.mockReturnValue("2026-08");
    q.getReviewRequestByCheckinId.mockResolvedValue({ id: 1 });
    q.getDb.mockReturnValue({
      update: () => ({
        set: () => ({
          where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        }),
      }),
    });
  });

  describe("A. Bookings getPendingFoodTab by bookingId", () => {
    it("loads getBookingDetail.contact, calls the helper, and returns the JSON tab", async () => {
      q.getBookingDetail.mockResolvedValue(openBookingDetail("+91 98765 43210"));
      food.getPendingFoodTab.mockResolvedValue(UNPAID_TAB);

      const res = await bookingsPOST(bookingsReq({
        password: "x",
        action: "getPendingFoodTab",
        bookingId: 5,
      }));

      expect(res.status).toBe(200);
      expect(q.getBookingDetail).toHaveBeenCalledWith(5);
      expect(food.getPendingFoodTab).toHaveBeenCalledWith({
        checkinId: undefined,
        contact: "+91 98765 43210",
      });
      expect(await res.json()).toEqual(UNPAID_TAB);
    });

    it("404s when the booking is missing and does not call the helper", async () => {
      q.getBookingDetail.mockResolvedValue(null);

      const res = await bookingsPOST(bookingsReq({
        password: "x",
        action: "getPendingFoodTab",
        bookingId: 404,
      }));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Booking not found" });
      expect(food.getPendingFoodTab).not.toHaveBeenCalled();
    });

    it("still calls the helper when booking contact is blank", async () => {
      q.getBookingDetail.mockResolvedValue(openBookingDetail(""));
      food.getPendingFoodTab.mockResolvedValue(EMPTY_TAB);

      const res = await bookingsPOST(bookingsReq({
        password: "x",
        action: "getPendingFoodTab",
        bookingId: 5,
      }));

      expect(res.status).toBe(200);
      expect(food.getPendingFoodTab).toHaveBeenCalledWith({
        checkinId: undefined,
        contact: "",
      });
      expect(await res.json()).toEqual(EMPTY_TAB);
    });
  });

  describe("B. Bookings getPendingFoodTab RBAC", () => {
    it("forbids staff with only canCheckIn", async () => {
      q.authenticateUser.mockResolvedValue(staff({ canCheckIn: true }));

      const res = await bookingsPOST(bookingsReq({
        password: "x",
        action: "getPendingFoodTab",
        bookingId: 5,
      }));

      expect(res.status).toBe(403);
      expect(q.getBookingDetail).not.toHaveBeenCalled();
      expect(food.getPendingFoodTab).not.toHaveBeenCalled();
    });

    it("allows staff with canCheckOut", async () => {
      q.authenticateUser.mockResolvedValue(staff({ canCheckOut: true }));
      q.getBookingDetail.mockResolvedValue(openBookingDetail());
      food.getPendingFoodTab.mockResolvedValue(EMPTY_TAB);

      const res = await bookingsPOST(bookingsReq({
        password: "x",
        action: "getPendingFoodTab",
        bookingId: 5,
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(EMPTY_TAB);
      expect(food.getPendingFoodTab).toHaveBeenCalled();
    });
  });

  describe("C. Bookings checkOut does not block on unpaid tab", () => {
    it("still 200s when the helper would return an unpaid tab (API does not consult food)", async () => {
      q.getBookingDetail.mockResolvedValue(openBookingDetail());
      food.getPendingFoodTab.mockResolvedValue(UNPAID_TAB);

      const res = await bookingsPOST(bookingsReq({
        password: "x",
        action: "checkOut",
        bookingId: 5,
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(food.getPendingFoodTab).not.toHaveBeenCalled();
      expect(q.shortenAssignedCheckout).toHaveBeenCalledWith(5, todayIST());
      expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
        status: "checked_out",
      }));
    });
  });

  describe("D. Checkins getPendingFoodTab forwards checkinId+contact", () => {
    it("calls the helper and returns the 200 body", async () => {
      food.getPendingFoodTab.mockResolvedValue(UNPAID_TAB);

      const res = await checkinsPOST(checkinsReq({
        password: "x",
        action: "getPendingFoodTab",
        checkinId: 12,
        contact: "9876543210",
      }));

      expect(res.status).toBe(200);
      expect(food.getPendingFoodTab).toHaveBeenCalledWith({
        checkinId: 12,
        contact: "9876543210",
      });
      expect(await res.json()).toEqual(UNPAID_TAB);
    });
  });

  describe("E. Checkins getPendingFoodTab RBAC", () => {
    it("allows staff with canViewDashboard", async () => {
      q.authenticateUser.mockResolvedValue(staff({ canViewDashboard: true }));
      food.getPendingFoodTab.mockResolvedValue(EMPTY_TAB);

      const res = await checkinsPOST(checkinsReq({
        password: "x",
        action: "getPendingFoodTab",
        checkinId: 12,
        contact: "9876543210",
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(EMPTY_TAB);
    });

    it("forbids staff with no permissions", async () => {
      q.authenticateUser.mockResolvedValue(staff({}));

      const res = await checkinsPOST(checkinsReq({
        password: "x",
        action: "getPendingFoodTab",
        checkinId: 12,
        contact: "9876543210",
      }));

      expect(res.status).toBe(403);
      expect(food.getPendingFoodTab).not.toHaveBeenCalled();
    });
  });

  describe("F. Checkins checkoutGuest does not consult food", () => {
    it("succeeds on a sqlite write without calling getPendingFoodTab", async () => {
      food.getPendingFoodTab.mockResolvedValue(UNPAID_TAB);
      const where = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      q.getDb.mockReturnValue({
        update: () => ({
          set: () => ({ where }),
        }),
      });

      const res = await checkinsPOST(checkinsReq({
        password: "x",
        action: "checkoutGuest",
        checkinId: 12,
        guestName: "Ada",
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(where).toHaveBeenCalled();
      expect(food.getPendingFoodTab).not.toHaveBeenCalled();
      expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
        action: "guest_checkout_direct",
        target: "Ada",
      }));
    });
  });

  describe("G. Checkins checkoutBed closes checkins by normalized phone", () => {
    it("calls activeCheckinIdsForContact and does not consult getPendingFoodTab", async () => {
      food.activeCheckinIdsForContact.mockResolvedValue([42, 43]);
      q.getBedById.mockResolvedValue({
        id: 7,
        status: "occupied",
        bedId: "A1",
        dormName: "Dorm",
        guestName: "Ada",
        guestContact: "+91 98765 43210",
      });
      q.updateBedStatus.mockResolvedValue(undefined);
      q.logBedHistoryEntry.mockResolvedValue(undefined);
      const where = vi.fn().mockResolvedValue({ meta: { changes: 2 } });
      const limit = vi.fn().mockResolvedValue([{ id: 42, name: "Ada" }]);
      q.getDb.mockReturnValue({
        update: () => ({ set: () => ({ where }) }),
        select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
      });

      const res = await checkinsPOST(checkinsReq({
        password: "x",
        action: "checkoutBed",
        bedId: 7,
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(food.activeCheckinIdsForContact).toHaveBeenCalledWith("+91 98765 43210");
      expect(food.getPendingFoodTab).not.toHaveBeenCalled();
      expect(q.updateBedStatus).toHaveBeenCalledWith(7, { status: "cleanup", checkinId: null });
      expect(where).toHaveBeenCalled();
    });
  });
});
