import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getAllBeds: vi.fn(),
  getBedById: vi.fn(),
  updateBedStatus: vi.fn(),
  assignPhysicalBed: vi.fn(),
  logBedHistoryEntry: vi.fn(),
  getCheckinsByMonth: vi.fn(),
  getAllBookings: vi.fn(),
  getMonthKey: vi.fn(() => "2026-09"),
  getDb: vi.fn(),
  addAuditEntry: vi.fn(),
  activeCheckinIdsForContact: vi.fn(async (): Promise<number[]> => []),
  getPendingFoodTab: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: q.authenticateUser,
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => false }));
vi.mock("@/lib/googleApiFetch", () => ({ driveDeleteFile: vi.fn() }));
// checkins route does not import aiosellSync — push landmine is in inventory-availability.test.ts
vi.mock("@/lib/foodTab", () => ({
  contactToCheckinIdMap: vi.fn(() => new Map()),
  checkinIdsMatchingContact: vi.fn(() => []),
  unpaidFoodCheckoutMessage: vi.fn(),
  EMPTY_FOOD_TAB: { checkinId: null, pendingTab: 0, pendingOrders: 0, orderIds: [] },
}));
vi.mock("@/lib/foodTabDb", () => ({
  getPendingFoodTab: q.getPendingFoodTab,
  activeCheckinIdsForContact: q.activeCheckinIdsForContact,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/queries", () => ({
  getAllBeds: q.getAllBeds,
  getBedById: q.getBedById,
  updateBedStatus: q.updateBedStatus,
  assignPhysicalBed: q.assignPhysicalBed,
  logBedHistoryEntry: q.logBedHistoryEntry,
  getCheckinsByMonth: q.getCheckinsByMonth,
  getAllBookings: q.getAllBookings,
  getMonthKey: q.getMonthKey,
  addAuditEntry: q.addAuditEntry,
  getActiveCheckins: vi.fn(),
  addCheckin: vi.fn(),
  getCheckinByIdempotencyKey: vi.fn(async () => null),
  updateCheckin: vi.fn(),
  deleteCheckin: vi.fn(),
  getCheckinMonths: vi.fn(),
  markVibeMatched: vi.fn(),
  getAllDorms: vi.fn(),
  getDormByName: vi.fn(),
  addDorm: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  deleteDormAndBeds: vi.fn(),
  getBedHistoryAll: vi.fn(),
  deleteBedHistoryEntry: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getAllStats: vi.fn(),
  incrementStat: vi.fn(),
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
  addSystemLog: vi.fn(async () => undefined),
  getSystemLogs: vi.fn(),
  createReviewRequest: vi.fn(async () => undefined),
  getReviewRequestByCheckinId: vi.fn(async () => null),
}));

import { POST } from "@/app/api/admin/checkins/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.getMonthKey.mockReturnValue("2026-09");
  q.getAllBeds.mockResolvedValue([]);
  q.getCheckinsByMonth.mockResolvedValue([]);
  q.getAllBookings.mockResolvedValue([]);
  q.getPendingFoodTab.mockResolvedValue({ checkinId: null, pendingTab: 0, pendingOrders: 0, orderIds: [] });
  q.assignPhysicalBed.mockResolvedValue(true);
  // getBeds awaits .where() (assignments); assignBed/changeBed use .where().limit()
  q.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => {
          const guest = [{ id: 12, status: "active", name: "Ada", contact: "900", bookingId: "" }];
          return Object.assign(Promise.resolve([] as unknown[]), {
            limit: async () => guest,
          });
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => ({ meta: { changes: 1 } }) }) }),
  });
});

describe("Beds / Timeline RBAC and side effects", () => {
  it("canViewTimeline alone allows getBeds but forbids assignBed", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timeline",
      permissions: { canViewTimeline: true },
    });
    const view = await POST(req({ action: "getBeds" }));
    expect(view.status).toBe(200);

    const assign = await POST(req({
      action: "assignBed",
      bedId: 7,
      guestName: "Ada",
      guestContact: "900",
      checkinDate: "2026-09-20",
      stayingDays: "2",
      checkinId: 1,
    }));
    expect(assign.status).toBe(403);
    expect(q.assignPhysicalBed).not.toHaveBeenCalled();
  });

  it("canAssignBed allows assignBed", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Assigner",
      permissions: { canAssignBed: true },
    });
    q.getBedById.mockResolvedValue({ id: 7, status: "available", bedId: "A1", dormName: "Dorm" });
    q.assignPhysicalBed.mockResolvedValue(true);
    q.logBedHistoryEntry.mockResolvedValue(undefined);

    const res = await POST(req({
      action: "assignBed",
      bedId: 7,
      guestName: "Ada",
      guestContact: "9876543210",
      checkinDate: "2026-09-20",
      stayingDays: "2",
      checkinId: 12,
    }));
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: { success: true },
    });
    expect(q.assignPhysicalBed).toHaveBeenCalled();
  });

  it("canCheckout allows checkoutBed; without it is 403", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "NoCheckout",
      permissions: { canViewBeds: true },
    });
    let res = await POST(req({ action: "checkoutBed", bedId: 7 }));
    expect(res.status).toBe(403);

    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Checkout",
      permissions: { canCheckout: true },
    });
    q.getBedById.mockResolvedValue({
      id: 7, status: "occupied", bedId: "A1", dormName: "Dorm",
      guestName: "Ada", guestContact: "9876543210",
    });
    q.updateBedStatus.mockResolvedValue(undefined);
    q.logBedHistoryEntry.mockResolvedValue(undefined);
    q.activeCheckinIdsForContact.mockResolvedValue([]);

    res = await POST(req({ action: "checkoutBed", bedId: 7 }));
    expect(res.status).toBe(200);
    expect(q.getPendingFoodTab).not.toHaveBeenCalled();
  });

  it("canMarkClean alone allows markClean; canCheckout alone does not", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "CheckoutOnly",
      permissions: { canCheckout: true },
    });
    let res = await POST(req({ action: "markClean", bedId: 7 }));
    expect(res.status).toBe(403);

    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Cleaner",
      permissions: { canMarkClean: true },
    });
    q.getBedById.mockResolvedValue({
      id: 7, status: "cleanup", bedId: "A1", dormName: "Dorm",
    });
    q.updateBedStatus.mockResolvedValue(undefined);
    q.logBedHistoryEntry.mockResolvedValue(undefined);

    res = await POST(req({ action: "markClean", bedId: 7 }));
    expect(res.status).toBe(200);
    expect(q.updateBedStatus).toHaveBeenCalledWith(7, { status: "available", checkinId: null });
  });

  it("empty env-manager permissions forbid gated bed mutations", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "EnvManager",
      permissions: {},
    });
    for (const action of ["assignBed", "checkoutBed", "markClean"] as const) {
      const res = await POST(req({
        action,
        bedId: 7,
        guestName: "Ada",
        guestContact: "900",
        checkinDate: "2026-09-20",
        stayingDays: "1",
      }));
      expect(res.status, action).toBe(403);
    }
  });

  it("unassignBed never consults getPendingFoodTab", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getBedById.mockResolvedValue({
      id: 7, status: "occupied", bedId: "A1", dormName: "Dorm",
      guestName: "Ada", guestContact: "900",
    });
    q.updateBedStatus.mockResolvedValue(undefined);
    q.logBedHistoryEntry.mockResolvedValue(undefined);
    q.getPendingFoodTab.mockResolvedValue({ checkinId: 1, pendingTab: 5000, pendingOrders: 1, orderIds: [9] });

    const res = await POST(req({ action: "unassignBed", bedId: 7 }));
    expect(res.status).toBe(200);
    expect(q.getPendingFoodTab).not.toHaveBeenCalled();
  });
});
