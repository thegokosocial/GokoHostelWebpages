import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getInventoryGridData: vi.fn(async () => ({ nights: [], dorms: [] })),
  getBedTypeConfigs: vi.fn(async () => []),
  getChannels: vi.fn(async () => []),
  triggerInventoryPush: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush: q.triggerInventoryPush,
  triggerRatePush: vi.fn(),
  triggerRestrictionPush: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  getInventoryGridData: q.getInventoryGridData,
  getChannels: q.getChannels,
  upsertChannel: vi.fn(),
  deleteChannel: vi.fn(),
  getBedTypeConfigs: q.getBedTypeConfigs,
  upsertBedTypeConfig: vi.fn(),
  getActiveBedBlocks: vi.fn(async () => []),
  createBedBlock: vi.fn(),
  deactivateBedBlock: vi.fn(),
  deactivateBedBlocksByBedIds: vi.fn(),
  upsertInventoryOverride: vi.fn(),
  deleteInventoryOverride: vi.fn(),
  bulkReplaceInventoryOverrides: vi.fn(),
  markInventoryDirty: vi.fn(),
  getBedsFreeToBlock: vi.fn(async () => []),
  getAllDorms: vi.fn(async () => []),
  getAvailabilitySnapshot: vi.fn(),
  getUnassignedOtaHoldsForRange: vi.fn(async () => []),
  getRoomTypeMappings: vi.fn(async () => []),
  addAuditEntry: vi.fn(),
  getChannelRatesForRange: vi.fn(async () => []),
  upsertChannelRate: vi.fn(),
  getDailyRates: vi.fn(async () => []),
  upsertDailyRate: vi.fn(),
  getAllBeds: vi.fn(async () => []),
}));

import { POST } from "@/app/api/admin/inventory/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "inv", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.getInventoryGridData.mockResolvedValue({ nights: [], dorms: [] });
  q.getBedTypeConfigs.mockResolvedValue([]);
  q.getChannels.mockResolvedValue([]);
});

describe("Inventory API RBAC (raw permission key, no actionAllowed aliases)", () => {
  it("401 without auth", async () => {
    q.authenticateUser.mockResolvedValue(null);
    expect((await POST(req({ action: "getInventoryGrid", startDate: "2026-09-27", endDate: "2026-09-28" }))).status).toBe(401);
  });

  it("unknown action is 400", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    expect((await POST(req({ action: "nope" }))).status).toBe(400);
  });

  it("staff without canManageInventory is 403 even with food inventory-ish keys", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Menu",
      permissions: { canViewMenu: true, canManageMenuItems: true },
    });
    expect((await POST(req({
      action: "getInventoryGrid", startDate: "2026-09-27", endDate: "2026-09-28",
    }))).status).toBe(403);
    expect(q.getInventoryGridData).not.toHaveBeenCalled();
  });

  it("staff with canManageInventory can load the grid", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Inv",
      permissions: { canManageInventory: true },
    });
    const res = await POST(req({
      action: "getInventoryGrid", startDate: "2026-09-27", endDate: "2026-09-28",
    }));
    expect(res.status).toBe(200);
    expect(q.getInventoryGridData).toHaveBeenCalledWith("2026-09-27", "2026-09-28");
  });

  it("env manager with empty permissions is forbidden (no admin bypass)", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "EnvMgr",
      permissions: {},
    });
    expect((await POST(req({ action: "getChannels" }))).status).toBe(403);
  });

  it("admin bypasses the canManageInventory key", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "admin",
      displayName: "Admin",
      permissions: {},
    });
    expect((await POST(req({ action: "getChannels" }))).status).toBe(200);
    expect(q.getChannels).toHaveBeenCalled();
  });

  it("getInventoryGrid requires dates after the permission gate", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Inv",
      permissions: { canManageInventory: true },
    });
    expect((await POST(req({ action: "getInventoryGrid" }))).status).toBe(400);
  });
});
