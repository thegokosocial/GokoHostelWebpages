import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authenticateUser: vi.fn(), getDb: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn() }));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/queries", () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }));

import { POST } from "@/app/api/admin/account-settings/route";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const staff = { role: "staff" as const, displayName: "Staff", permissions: {} };

function request(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/account-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action, ...extra }),
  });
}

describe("Food payment account selection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateUser.mockResolvedValue(admin);
    mocks.getSetting.mockResolvedValue("");
    mocks.setSetting.mockResolvedValue(undefined);
  });

  it("returns active real accounts to a canMarkPaid user", async () => {
    const rows = [{ id: 3, name: "Sunny HDFC", nickname: "HDFC", isActive: 1 }];
    const where = vi.fn().mockResolvedValue(rows);
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) });
    mocks.authenticateUser.mockResolvedValue({ ...staff, permissions: { canMarkPaid: true } });

    const response = await POST(request("getFoodReceiptAccounts"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: rows, foodOnlineReceiptAccountId: "" });
    expect(where).toHaveBeenCalled();
  });

  it("does not expose payment accounts without canMarkPaid", async () => {
    mocks.authenticateUser.mockResolvedValue(staff);
    const select = vi.fn();
    mocks.getDb.mockReturnValue({ select });

    const response = await POST(request("getFoodReceiptAccounts"));

    expect(response.status).toBe(403);
    expect(select).not.toHaveBeenCalled();
  });

  it("rejects receipt defaults that are not active real accounts", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) });

    const response = await POST(request("saveReceiptDefaults", {
      foodOnlineReceiptAccountId: 3,
      roomOnlineReceiptAccountId: 3,
    }));

    expect(response.status).toBe(400);
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it("persists both validated online receipt defaults", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 3 }, { id: 4 }]);
    const where = vi.fn().mockReturnValue({ limit });
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) });

    const response = await POST(request("saveReceiptDefaults", {
      foodOnlineReceiptAccountId: 3,
      roomOnlineReceiptAccountId: 4,
    }));

    expect(response.status).toBe(200);
    expect(mocks.setSetting).toHaveBeenCalledWith("food_online_receipt_account_id", "3");
    expect(mocks.setSetting).toHaveBeenCalledWith("room_online_receipt_account_id", "4");
  });
});
