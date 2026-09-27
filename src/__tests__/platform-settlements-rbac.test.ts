import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  isPiRuntime: vi.fn(() => false),
  getDb: vi.fn(),
  getPlatformReceivableSummary: vi.fn(async () => ({ platforms: [] })),
  createPlatformSettlement: vi.fn(async () => ({ id: 1 })),
  allocatePlatformSettlement: vi.fn(async () => ({ id: 1 })),
  recordPlatformAdjustment: vi.fn(async () => ({ id: 1 })),
  recognizeMissingPlatformBookings: vi.fn(async () => ({ created: 0 })),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: q.isPiRuntime }));
vi.mock("@/lib/platformReceivables", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platformReceivables")>();
  return {
    ...actual,
    getPlatformReceivableSummary: q.getPlatformReceivableSummary,
    createPlatformSettlement: q.createPlatformSettlement,
    allocatePlatformSettlement: q.allocatePlatformSettlement,
    recordPlatformAdjustment: q.recordPlatformAdjustment,
    recognizeMissingPlatformBookings: q.recognizeMissingPlatformBookings,
  };
});
vi.mock("@/db", () => ({ getDb: q.getDb }));

import { POST } from "@/app/api/admin/platform-settlements/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/platform-settlements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "staff1", ...body }),
  });
}

function listDb(bookingRows: unknown[] = []) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
          limit: async () => bookingRows,
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve([]).then(resolve, reject),
        }),
        orderBy: async () => [],
        innerJoin: () => ({
          leftJoin: () => ({
            where: async () => [],
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.isPiRuntime.mockReturnValue(false);
  q.getPlatformReceivableSummary.mockResolvedValue({ platforms: [] });
  q.createPlatformSettlement.mockResolvedValue({ id: 1 });
  q.allocatePlatformSettlement.mockResolvedValue({ id: 1 });
  q.recordPlatformAdjustment.mockResolvedValue({ id: 1 });
  q.recognizeMissingPlatformBookings.mockResolvedValue({ created: 0 });
  q.getDb.mockReturnValue(listDb());
});

describe("Platform settlements route RBAC", () => {
  it("canViewAccounts lists but cannot createSettlement or allocate", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Viewer",
      permissions: { canViewAccounts: true },
    });
    expect((await POST(req({ action: "list" }))).status).toBe(200);
    expect(q.getPlatformReceivableSummary).toHaveBeenCalled();

    expect((await POST(req({
      action: "createSettlement",
      platform: "booking.com",
      amount: 1000,
      payoutDate: "2026-09-27",
      bankAccountId: 1,
    }))).status).toBe(403);
    expect(q.createPlatformSettlement).not.toHaveBeenCalled();

    expect((await POST(req({
      action: "allocate",
      settlementId: 1,
      bookingId: 2,
      amount: 100,
    }))).status).toBe(403);
  });

  it("canSettlePlatformPayments can create but not adjust", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Settler",
      permissions: { canSettlePlatformPayments: true },
    });
    expect((await POST(req({ action: "list" }))).status).toBe(403);

    const create = await POST(req({
      action: "createSettlement",
      platform: "booking.com",
      amount: 1000,
      payoutDate: "2026-09-27",
      bankAccountId: 1,
    }));
    expect(create.status).toBe(200);
    expect(q.createPlatformSettlement).toHaveBeenCalled();

    expect((await POST(req({
      action: "adjust",
      bookingId: 1,
      bookingCycle: 1,
      amount: 10,
      reason: "fee",
    }))).status).toBe(403);
    expect(q.recordPlatformAdjustment).not.toHaveBeenCalled();
  });

  it("canAdjustPlatformReceivables passes the gate (404 missing booking) and recognizeMissing", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Adjuster",
      permissions: { canAdjustPlatformReceivables: true },
    });
    // Empty booking row → past RBAC, business 404 (not 403).
    expect((await POST(req({
      action: "adjust",
      bookingId: 99,
      bookingCycle: 1,
      reason: "fee",
    }))).status).toBe(404);
    expect(q.recordPlatformAdjustment).not.toHaveBeenCalled();

    expect((await POST(req({ action: "recognizeMissing" }))).status).toBe(200);
    expect(q.recognizeMissingPlatformBookings).toHaveBeenCalled();

    expect((await POST(req({
      action: "createSettlement",
      platform: "booking.com",
      amount: 1000,
      payoutDate: "2026-09-27",
      bankAccountId: 1,
    }))).status).toBe(403);
  });

  it("website allocateBatch is 400 on Pi even with settle permission", async () => {
    q.isPiRuntime.mockReturnValue(true);
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Settler",
      permissions: { canSettlePlatformPayments: true },
    });
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 1,
      allocations: [{ type: "website", paymentId: "pay_1", allocatedPaise: 100 }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Cloudflare/i) });
  });
});
