import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateUser, getCheckinsByMonth, getCheckinsByDateRange, getMonthKey, getSystemLogs } = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getCheckinsByMonth: vi.fn(),
  getCheckinsByDateRange: vi.fn(),
  getMonthKey: vi.fn(() => "2026-08"),
  getSystemLogs: vi.fn(),
}));
const getAuditEntries = vi.hoisted(() => vi.fn());
const getInventoryAuditEntries = vi.hoisted(() => vi.fn());
const getAuditPresentationContext = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const createRateScrape = vi.hoisted(() => vi.fn());
const updateRateScrape = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  authenticateUser,
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => false }));
vi.mock("@/lib/googleApiFetch", () => ({ driveDeleteFile: vi.fn() }));
vi.mock("@/lib/aiosellSync", () => ({ triggerInventoryPush: vi.fn() }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("@/db/queries", () => ({
  getCheckinsByMonth,
  getCheckinsByDateRange,
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
  getMonthKey,
  getAllBookings: vi.fn(),
  getUpcomingBookings: vi.fn(),
  addBooking: vi.fn(),
  updateBookingStatus: vi.fn(),
  deleteBooking: vi.fn(),
  createRateScrape,
  getLatestRateScrape: vi.fn(),
  getRateScrapeById: vi.fn(),
  updateRateScrape,
  getAllUsers: vi.fn(),
  getUserByUsername: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  addAuditEntry: vi.fn(),
  getAuditEntries,
  getInventoryAuditEntries,
  getAuditPresentationContext,
  addSystemLog: vi.fn(),
  getSystemLogs,
  createReviewRequest: vi.fn(),
  getReviewRequestByCheckinId: vi.fn(),
}));

import { POST } from "@/app/api/admin/checkins/route";
import { firstVisibleAdminSection } from "@/lib/adminNav";

const bookingsOnly = {
  role: "staff" as const,
  displayName: "Bo",
  permissions: { canViewBookings: true },
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Checkins auth-vs-list workflows", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    getCheckinsByMonth.mockReset();
    getCheckinsByDateRange.mockReset();
    getSystemLogs.mockReset();
    createRateScrape.mockReset();
    updateRateScrape.mockReset();
    getAuditEntries.mockReset();
    getInventoryAuditEntries.mockReset();
    getAuditPresentationContext.mockReset();
    getAuditPresentationContext.mockResolvedValue({});
    getMonthKey.mockReturnValue("2026-08");
  });

  it("401s before the auth shortcut when the password is wrong", async () => {
    authenticateUser.mockResolvedValue(null);
    const res = await POST(req({ password: "nope", action: "auth" }));
    expect(res.status).toBe(401);
    expect(getCheckinsByMonth).not.toHaveBeenCalled();
  });

  it("lets bookings-only staff authenticate without loading records", async () => {
    authenticateUser.mockResolvedValue(bookingsOnly);
    const res = await POST(req({ password: "x", action: "auth" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "staff", permissions: { canViewBookings: true } });
    expect(getCheckinsByMonth).not.toHaveBeenCalled();
  });

  it("still forbids bookings-only staff from list", async () => {
    authenticateUser.mockResolvedValue(bookingsOnly);
    const res = await POST(req({ password: "x", action: "list", month: "2026-08" }));
    expect(res.status).toBe(403);
    expect(getCheckinsByMonth).not.toHaveBeenCalled();
  });

  it("passes scrape dates from the request to the GitHub scraper", async () => {
    authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    createRateScrape.mockResolvedValue({ id: 42 });
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubEnv("GITHUB_REPO", "example/repo");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const res = await POST(req({
      password: "x", action: "startRateScrape", city: "Gokarna",
      startDate: "2026-10-01", endDate: "2026-10-08", propertyType: "hostels",
    }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/example/repo/actions/workflows/scrape-rates.yml/dispatches",
      expect.objectContaining({
        body: JSON.stringify({ ref: "main", inputs: { scrapeId: "42", city: "Gokarna", startDate: "2026-10-01", endDate: "2026-10-08", propertyType: "hostels", proxyUrl: "" } }),
      }),
    );
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
  });

  it("returns actionable diagnostics when a rate scrape date is missing", async () => {
    authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    const res = await POST(req({ password: "x", action: "startRateScrape", city: "Gokarna", endDate: "2026-10-08" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("x-goko-request-id")).toBeTruthy();
    expect(await res.json()).toMatchObject({
      error: "City and dates are required before starting a rate scrape.",
      code: "VALIDATION_ERROR",
      action: "startRateScrape",
      stage: "request_validation",
      field: "startDate",
      retryable: false,
    });
    expect(createRateScrape).not.toHaveBeenCalled();
  });

  it("accepts in_progress heartbeats without completedAt or result payload", async () => {
    authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    updateRateScrape.mockResolvedValue(undefined);
    const res = await POST(req({
      password: "x",
      action: "updateRateScrapeResults",
      scrapeId: 7,
      status: "in_progress",
      results: "[]",
    }));
    expect(res.status).toBe(200);
    expect(updateRateScrape).toHaveBeenCalledWith(7, { status: "in_progress" });
    expect(updateRateScrape.mock.calls[0][1]).not.toHaveProperty("completedAt");
  });

  it("rejects invalid rate scrape statuses", async () => {
    authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    const res = await POST(req({
      password: "x",
      action: "updateRateScrapeResults",
      scrapeId: 7,
      status: "queued",
      results: "[]",
    }));
    expect(res.status).toBe(400);
    expect(updateRateScrape).not.toHaveBeenCalled();
  });

  it("writes terminal scrape results with completedAt", async () => {
    authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    updateRateScrape.mockResolvedValue(undefined);
    const results = JSON.stringify({ version: 2, properties: [], failedDates: [] });
    const res = await POST(req({
      password: "x",
      action: "updateRateScrapeResults",
      scrapeId: 9,
      status: "done",
      results,
    }));
    expect(res.status).toBe(200);
    expect(updateRateScrape).toHaveBeenCalledWith(9, expect.objectContaining({
      status: "done",
      results,
      completedAt: expect.any(String),
    }));
  });

  it("loads month rows for list after a permitted login, not for auth", async () => {
    authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Rec",
      permissions: { canViewRecords: true },
    });
    getCheckinsByMonth.mockResolvedValue([]);
    const authRes = await POST(req({ password: "x", action: "auth" }));
    expect(authRes.status).toBe(200);
    expect(getCheckinsByMonth).not.toHaveBeenCalled();

    const listRes = await POST(req({ password: "x", action: "list", month: "2026-08" }));
    expect(listRes.status).toBe(200);
    expect(getCheckinsByMonth).toHaveBeenCalledWith("2026-08");
  });

  it("loads an inclusive arrival-date range for records", async () => {
    authenticateUser.mockResolvedValue({ role: "staff", displayName: "Rec", permissions: { canViewRecords: true } });
    getCheckinsByDateRange.mockResolvedValue([]);
    const res = await POST(req({ password: "x", action: "list", startDate: "2026-08-01", endDate: "2026-08-31" }));
    expect(res.status).toBe(200);
    expect(getCheckinsByDateRange).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
  });

  it("rejects an incomplete or inverted records date range", async () => {
    authenticateUser.mockResolvedValue({ role: "staff", displayName: "Rec", permissions: { canViewRecords: true } });
    const res = await POST(req({ password: "x", action: "list", startDate: "2026-09-01", endDate: "2026-08-31" }));
    expect(res.status).toBe(400);
    expect(getCheckinsByDateRange).not.toHaveBeenCalled();
  });

  it("rejects non-passport IDs for foreign admin records", async () => {
    authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Front Desk",
      permissions: { canAddCheckin: true },
    });
    const entry = Array(17).fill("");
    entry[8] = "France";
    entry[13] = "aadhaar";
    const res = await POST(req({ password: "x", action: "add", entry }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Foreign nationals must provide a passport" });
  });

  it("rejects foreign admin records without a visa link", async () => {
    authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Front Desk",
      permissions: { canAddCheckin: true },
    });
    const entry = Array(17).fill("");
    entry[8] = "France";
    entry[13] = "passport";
    const res = await POST(req({ password: "x", action: "add", entry }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Visa document is required for foreign nationals" });
  });

  it("forbids staff from getSystemLogs without the logs permission", async () => {
    authenticateUser.mockResolvedValue(bookingsOnly);
    const res = await POST(req({ password: "x", action: "getSystemLogs" }));
    expect(res.status).toBe(403);
    expect(getSystemLogs).not.toHaveBeenCalled();
  });

  it("allows staff with the logs permission to read system logs", async () => {
    authenticateUser.mockResolvedValue({ role: "staff", displayName: "Logs", permissions: { canViewLogs: true } });
    getSystemLogs.mockResolvedValue({ logs: [], total: 0, sources: [] });
    const res = await POST(req({ password: "x", action: "getSystemLogs" }));
    expect(res.status).toBe(200);
    expect(getSystemLogs).toHaveBeenCalled();
  });

  it("allows managers with the audit permission to read both audit streams", async () => {
    authenticateUser.mockResolvedValue({ role: "manager", displayName: "Audit", permissions: { canViewAudit: true } });
    getAuditEntries.mockResolvedValue([]);
    getInventoryAuditEntries.mockResolvedValue([]);
    const general = await POST(req({ password: "x", action: "getAuditLog" }));
    const inventory = await POST(req({ password: "x", action: "getInventoryAuditLog" }));
    expect(general.status).toBe(200);
    expect(inventory.status).toBe(200);
    expect(getAuditEntries).toHaveBeenCalledOnce();
    expect(getInventoryAuditEntries).toHaveBeenCalledOnce();
  });

  it("getSystemLogs paginates with level and source filters", async () => {
    authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    getSystemLogs.mockResolvedValue({ logs: [{ id: 9, message: "x" }], total: 90, sources: ["checkin"] });
    const res = await POST(req({
      password: "x",
      action: "getSystemLogs",
      page: 2,
      pageSize: 50,
      level: "error",
      source: "checkin",
    }));
    expect(res.status).toBe(200);
    expect(getSystemLogs).toHaveBeenCalledWith(50, {
      level: "error",
      source: "checkin",
      offset: 50,
    });
    expect(await res.json()).toEqual({
      logs: [{ id: 9, message: "x" }],
      total: 90,
      page: 2,
      pageSize: 50,
      sources: ["checkin"],
    });
  });
});

describe("firstVisibleAdminSection", () => {
  it("keeps the current section for admin and for staff already on an allowed tab", () => {
    expect(firstVisibleAdminSection("admin", {}, "dashboard")).toBe("dashboard");
    expect(firstVisibleAdminSection("staff", { canViewBookings: true }, "bookings")).toBe("bookings");
  });

  it("sends bookings-only staff off dashboard before the dashboard tab can mount", () => {
    expect(firstVisibleAdminSection("staff", { canViewBookings: true }, "dashboard")).toBe("bookings");
  });

  it("routes a permissionless authenticated user to self-service Management", () => {
    expect(firstVisibleAdminSection("manager", {}, "dashboard")).toBe("management");
  });

  it("keeps Splits for staff with canViewSplits and does not use it as a Pi landing pad in ADMIN_NAV_PERMS", () => {
    expect(firstVisibleAdminSection("staff", { canViewSplits: true }, "splits")).toBe("splits");
    expect(firstVisibleAdminSection("admin", {}, "splits")).toBe("splits");
  });
});
