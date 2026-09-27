import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  isOfflineMode: vi.fn(() => true),
  getDb: vi.fn(),
  getAuditRetention: vi.fn(),
  getAuditEntriesBefore: vi.fn(),
  deleteAuditEntriesBefore: vi.fn(),
  setSetting: vi.fn(),
  addAuditEntry: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: q.authenticateUser,
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => q.isOfflineMode() }));
vi.mock("@/lib/googleApiFetch", () => ({ driveDeleteFile: vi.fn() }));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/queries", () => ({
  getCheckinsByMonth: vi.fn(async () => []),
  getCheckinsByDateRange: vi.fn(async () => []),
  getActiveCheckins: vi.fn(),
  addCheckin: vi.fn(),
  getCheckinByIdempotencyKey: vi.fn(async () => null),
  updateCheckin: vi.fn(),
  deleteCheckin: vi.fn(),
  getCheckinMonths: vi.fn(),
  markVibeMatched: vi.fn(),
  getAllBeds: vi.fn(async () => []),
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
  getSetting: q.getSetting,
  setSetting: q.setSetting,
  getAllStats: vi.fn(async () => ({})),
  incrementStat: vi.fn(),
  getMonthKey: vi.fn(() => "2026-09"),
  getAllBookings: vi.fn(async () => []),
  getUpcomingBookings: vi.fn(async () => []),
  addBooking: vi.fn(),
  updateBookingStatus: vi.fn(),
  deleteBooking: vi.fn(),
  createRateScrape: vi.fn(),
  getLatestRateScrape: vi.fn(),
  getRateScrapeById: vi.fn(),
  updateRateScrape: vi.fn(),
  getAllUsers: vi.fn(async () => []),
  getUserByUsername: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  addAuditEntry: q.addAuditEntry,
  getAuditEntries: vi.fn(async () => []),
  getInventoryAuditEntries: vi.fn(async () => []),
  getAuditPresentationContext: vi.fn(async () => ({})),
  getAuditEntriesBefore: q.getAuditEntriesBefore,
  deleteAuditEntriesBefore: q.deleteAuditEntriesBefore,
  getAuditRetention: q.getAuditRetention,
  addSystemLog: vi.fn(),
  getSystemLogs: vi.fn(async () => ({ logs: [], total: 0, sources: [] })),
  createReviewRequest: vi.fn(),
  getReviewRequestByCheckinId: vi.fn(async () => null),
}));

import { POST } from "@/app/api/admin/checkins/route";

function req(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "ops", action, ...extra }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.isOfflineMode.mockReturnValue(true);
  q.getAuditRetention.mockResolvedValue({
    years: 1, months: 0, totalMonths: 12, cutoff: "2025-09-27",
    eligible: { auditLog: 0, bookingHistory: 0, attendanceHistory: 0, total: 0 },
  });
  q.getAuditEntriesBefore.mockResolvedValue({
    auditLog: 0, bookingHistory: 0, attendanceHistory: 0, total: 0,
  });
  q.deleteAuditEntriesBefore.mockResolvedValue({
    auditLog: 0, bookingHistory: 0, attendanceHistory: 0,
  });
  q.setSetting.mockResolvedValue(undefined);
  q.addAuditEntry.mockResolvedValue(undefined);
  q.getDb.mockReturnValue({
    select: () => ({
      from: async () => [{ one: 1 }],
    }),
  });
});

describe("Management Health / Backup / Audit retention RBAC", () => {
  it("canViewAudit can read logs but not retention, cleanup, health, or backup", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Audit",
      permissions: { canViewAudit: true, canViewLogs: true },
    });
    expect((await POST(req("getAuditLog"))).status).toBe(200);
    expect((await POST(req("getSystemLogs"))).status).toBe(200);
    expect((await POST(req("getAuditRetention"))).status).toBe(403);
    expect((await POST(req("cleanupAuditLog"))).status).toBe(403);
    expect((await POST(req("setAuditRetention", { years: 1, months: 0 }))).status).toBe(403);
    expect((await POST(req("healthCheck"))).status).toBe(403);
    expect((await POST(req("runBackup"))).status).toBe(403);
  });

  it("admin healthCheck skips Google checks offline", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.isOfflineMode.mockReturnValue(true);
    const health = await POST(req("healthCheck"));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      results: { d1: { status: "ok" }, drive: { status: "skipped" } },
    });
  });

  it("admin runBackup is 503 offline and succeeds online", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.isOfflineMode.mockReturnValue(true);
    expect((await POST(req("runBackup"))).status).toBe(503);

    q.isOfflineMode.mockReturnValue(false);
    expect((await POST(req("runBackup"))).status).toBe(200);
    expect(q.setSetting).toHaveBeenCalledWith("last_backup", expect.any(String));
  });

  it("admin getAuditRetention / setAuditRetention / cleanupAuditLog", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    expect((await POST(req("getAuditRetention"))).status).toBe(200);

    const set = await POST(req("setAuditRetention", { years: 0, months: 0 }));
    expect(set.status).toBe(400);

    const ok = await POST(req("setAuditRetention", { years: 1, months: 0 }));
    expect(ok.status).toBe(200);
    expect(q.setSetting).toHaveBeenCalled();

    expect((await POST(req("cleanupAuditLog"))).status).toBe(200);
    expect(q.deleteAuditEntriesBefore).toHaveBeenCalled();
  });

  it("env manager with empty permissions is blocked from admin_only ops", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "EnvMgr",
      permissions: {},
    });
    expect((await POST(req("healthCheck"))).status).toBe(403);
    expect((await POST(req("runBackup"))).status).toBe(403);
    expect((await POST(req("getAuditRetention"))).status).toBe(403);
  });
});
