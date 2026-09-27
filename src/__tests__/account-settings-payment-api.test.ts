import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getDb: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  ensurePlatformProfile: vi.fn(),
  isPiRuntime: vi.fn(() => false),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/queries", () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }));
vi.mock("@/lib/platformReceivables", () => ({ ensurePlatformProfile: mocks.ensurePlatformProfile }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => mocks.isPiRuntime() }));

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
    mocks.ensurePlatformProfile.mockResolvedValue({ platformKey: "razorpay-website" });
    mocks.isPiRuntime.mockReturnValue(false);
  });

  it("returns active real accounts plus Razorpay Website virtual to a canMarkPaid user", async () => {
    const banks = [{ id: 3, name: "Sunny HDFC", nickname: "HDFC", isActive: 1 }];
    const razorpay = [{ id: 9, name: "Razorpay Website Receivable", nickname: "", isActive: 1 }];
    const limit = vi.fn().mockResolvedValue(razorpay);
    const where = vi.fn(() => Object.assign(Promise.resolve(banks), { limit }));
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) });
    mocks.authenticateUser.mockResolvedValue({ ...staff, permissions: { canMarkPaid: true } });

    const response = await POST(request("getFoodReceiptAccounts"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accounts: [
        ...banks,
        { id: 9, name: "Razorpay Website Receivable", nickname: "Website / Razorpay", isActive: 1 },
      ],
      foodOnlineReceiptAccountId: "",
    });
    expect(mocks.ensurePlatformProfile).toHaveBeenCalledWith("Razorpay Website");
    expect(where).toHaveBeenCalled();
    expect(limit).toHaveBeenCalled();
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
