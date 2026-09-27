import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getChannelConfig: vi.fn(async () => null),
  getChannelSyncLogs: vi.fn(async () => ({ logs: [], total: 0 })),
  getSetting: vi.fn(async () => ""),
  getMappingHealth: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/aiosellMappingCheck", () => ({
  checkMappings: vi.fn(async () => ({ ok: true })),
  getMappingHealth: q.getMappingHealth,
}));
vi.mock("@/db/queries", () => ({
  getChannelConfig: q.getChannelConfig,
  upsertChannelConfig: vi.fn(),
  getRoomTypeMappings: vi.fn(async () => []),
  upsertRoomTypeMapping: vi.fn(),
  deleteRoomTypeMapping: vi.fn(),
  getRatePlanMappings: vi.fn(async () => []),
  upsertRatePlanMapping: vi.fn(),
  deleteRatePlanMapping: vi.fn(),
  getDailyRates: vi.fn(async () => []),
  bulkUpsertDailyRates: vi.fn(),
  getChannelSyncLogs: q.getChannelSyncLogs,
  getAllDorms: vi.fn(async () => []),
  getAllBeds: vi.fn(async () => []),
  getSetting: q.getSetting,
  setSetting: vi.fn(),
}));
vi.mock("@/lib/aiosell", () => ({
  getAiosellPropertyDetails: vi.fn(),
}));

import { POST } from "@/app/api/admin/channel-manager/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/channel-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "cm", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.getChannelConfig.mockResolvedValue(null);
  q.getChannelSyncLogs.mockResolvedValue({ logs: [], total: 0 });
  q.getSetting.mockResolvedValue("");
  q.getMappingHealth.mockResolvedValue({ ok: true });
});

describe("Channel manager admin / logs RBAC", () => {
  it("rejects unauthenticated requests", async () => {
    q.authenticateUser.mockResolvedValue(null);
    expect((await POST(req({ action: "getConfig" }))).status).toBe(401);
  });

  it("non-admin cannot getConfig / mapping (401 Unauthorized)", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canViewLogs: true, canViewManagement: true },
    });
    const res = await POST(req({ action: "getConfig" }));
    expect(res.status).toBe(401);
    expect(q.getChannelConfig).not.toHaveBeenCalled();
  });

  it("getSyncLogs allows canViewLogs without admin role", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Logs",
      permissions: { canViewLogs: true },
    });
    const res = await POST(req({ action: "getSyncLogs" }));
    expect(res.status).toBe(200);
    expect(q.getChannelSyncLogs).toHaveBeenCalled();
  });

  it("getSyncLogs forbids staff without canViewLogs", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "NoLogs",
      permissions: {},
    });
    expect((await POST(req({ action: "getSyncLogs" }))).status).toBe(403);
    expect(q.getChannelSyncLogs).not.toHaveBeenCalled();
  });

  it("admin can getConfig", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "admin",
      displayName: "Admin",
      permissions: {},
    });
    const res = await POST(req({ action: "getConfig" }));
    expect(res.status).toBe(200);
    expect(q.getChannelConfig).toHaveBeenCalled();
  });
});
