import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getAllUsers: vi.fn(),
  getUserByUsername: vi.fn(),
  getUserById: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getTasks: vi.fn(async () => []),
  hashPassword: vi.fn(async () => "hash"),
  addAuditEntry: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: q.authenticateUser,
  hashPassword: q.hashPassword,
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => false }));
vi.mock("@/lib/googleApiFetch", () => ({ driveDeleteFile: vi.fn() }));
vi.mock("@/lib/foodTab", () => ({
  contactToCheckinIdMap: vi.fn(() => new Map()),
  checkinIdsMatchingContact: vi.fn(() => []),
  unpaidFoodCheckoutMessage: vi.fn(),
  EMPTY_FOOD_TAB: { checkinId: null, pendingTab: 0, pendingOrders: 0, orderIds: [] },
}));
vi.mock("@/lib/foodTabDb", () => ({
  getPendingFoodTab: vi.fn(async () => ({ checkinId: null, pendingTab: 0, pendingOrders: 0, orderIds: [] })),
  activeCheckinIdsForContact: vi.fn(async () => []),
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/queries", () => ({
  getAllUsers: q.getAllUsers,
  getUserByUsername: q.getUserByUsername,
  getUserById: q.getUserById,
  createUser: q.createUser,
  updateUser: q.updateUser,
  deleteUser: q.deleteUser,
  getTasks: q.getTasks,
  addAuditEntry: q.addAuditEntry,
  getAllBeds: vi.fn(async () => []),
  getBedById: vi.fn(),
  updateBedStatus: vi.fn(),
  assignPhysicalBed: vi.fn(),
  logBedHistoryEntry: vi.fn(),
  getCheckinsByMonth: vi.fn(async () => []),
  getAllBookings: vi.fn(async () => []),
  getMonthKey: vi.fn(() => "2026-09"),
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
  q.hashPassword.mockResolvedValue("hash");
  q.getAllUsers.mockResolvedValue([]);
  q.getUserByUsername.mockResolvedValue(null);
  q.getTasks.mockResolvedValue([]);
  q.getDb.mockReturnValue({ delete: () => ({ where: async () => undefined }) });
});

describe("Management Users admin_only gate", () => {
  it("admin can list and create users", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getAllUsers.mockResolvedValue([{ id: 1, username: "ada", role: "staff", permissions: "{}" }]);
    expect((await POST(req({ action: "getUsers" }))).status).toBe(200);

    const created = await POST(req({
      action: "createUser",
      newUsername: "bob",
      userPassword: "secret12",
      displayName: "Bob",
      userRole: "staff",
      permissions: { canViewMenu: true },
    }));
    expect(created.status).toBe(200);
    expect(q.createUser).toHaveBeenCalled();
    expect(q.hashPassword).toHaveBeenCalledWith("secret12");
  });

  it("manager and staff cannot getUsers / createUser / deleteUser even with broad page perms", async () => {
    for (const role of ["manager", "staff"] as const) {
      q.authenticateUser.mockResolvedValue({
        role,
        displayName: role,
        permissions: { canViewRecords: true, canViewMenu: true, canManageFoodSettings: true },
      });
      for (const action of ["getUsers", "createUser", "deleteUser"] as const) {
        const res = await POST(req({
          action,
          newUsername: "x",
          userPassword: "secret12",
          displayName: "X",
          userId: 9,
        }));
        expect(res.status, `${role}:${action}`).toBe(403);
      }
    }
    expect(q.createUser).not.toHaveBeenCalled();
    expect(q.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects duplicate username on create", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getUserByUsername.mockResolvedValue({ id: 2, username: "bob" });
    const res = await POST(req({
      action: "createUser",
      newUsername: "bob",
      userPassword: "secret12",
      displayName: "Bob",
    }));
    expect(res.status).toBe(409);
    expect(q.createUser).not.toHaveBeenCalled();
  });

  it("admin deleteUser removes the row", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getUserById.mockResolvedValue({ id: 9, username: "gone", role: "staff" });
    q.deleteUser.mockResolvedValue(undefined);
    q.getDb.mockReturnValue({ delete: () => ({ where: async () => undefined }) });
    expect((await POST(req({ action: "deleteUser", userId: 9 }))).status).toBe(200);
    expect(q.deleteUser).toHaveBeenCalledWith(9);
  });

  it("blocks deleteUser when the user still has assigned tasks", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getTasks.mockResolvedValueOnce([{ id: 1 }] as never);
    const res = await POST(req({ action: "deleteUser", userId: 9 }));
    expect(res.status).toBe(409);
    expect(q.deleteUser).not.toHaveBeenCalled();
  });
});
