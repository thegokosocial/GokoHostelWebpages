import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GATEWAY_ALLOC_INSERT_CHUNK } from "@/lib/platformReceivables";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getDb: vi.fn(),
  allocatePlatformSettlementBatch: vi.fn(),
  isPiRuntime: vi.fn(() => false),
  batch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: q.isPiRuntime }));
vi.mock("@/lib/platformReceivables", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platformReceivables")>();
  return {
    ...actual,
    allocatePlatformSettlementBatch: q.allocatePlatformSettlementBatch,
  };
});
vi.mock("@/db", () => ({ getDb: q.getDb }));

import { POST } from "@/app/api/admin/platform-settlements/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/platform-settlements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", ...body }),
  });
}

function websiteAllocations(count: number, allocatedPaise = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    type: "website",
    paymentId: `pay_${i + 1}`,
    allocatedPaise,
  }));
}

function mockWebsiteHappyPath(paymentCount: number, settlementPaise: number) {
  const payments = Array.from({ length: paymentCount }, (_, i) => ({
    payment: {
      id: `pay_${i + 1}`,
      captured: 1,
      amountPaise: 1100,
      refundedPaise: 0,
      feePaise: 50,
      taxPaise: 50,
    },
    environment: "live" as const,
  }));

  q.batch.mockImplementation(async (statements: Array<Promise<Array<{ id: number }> | (() => Promise<Array<{ id: number }>>)>>) => {
    const out: Array<Array<{ id: number }>> = [];
    for (const stmt of statements) {
      const rows = typeof stmt === "function" ? await stmt() : await stmt;
      out.push(Array.isArray(rows) ? rows : [{ id: out.length + 1 }]);
    }
    return out;
  });

  q.getDb.mockReturnValue({
    batch: q.batch,
    select: () => ({
      from: () => ({
        // .limit → settlement row; bare await → prior/existing allocations []
        where: () => ({
          limit: async () => [{
            id: 1,
            platformKey: "razorpay-website",
            actualAmountPaise: settlementPaise,
          }],
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve([]).then(resolve, reject),
        }),
        innerJoin: () => ({
          where: async () => payments,
        }),
      }),
    }),
    insert: () => ({
      values: (chunk: Array<{ paymentId: string }>) => ({
        returning: () => Promise.resolve(chunk.map((_, i) => ({ id: i + 1 }))),
      }),
    }),
  });
}

beforeEach(() => {
  q.authenticateUser.mockReset();
  q.getDb.mockReset();
  q.allocatePlatformSettlementBatch.mockReset();
  q.isPiRuntime.mockReset();
  q.batch.mockReset();
  q.isPiRuntime.mockReturnValue(false);
  q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
});

describe("website allocateBatch via platform-settlements route", () => {
  it("rejects >100 website selections before any write", async () => {
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 1,
      allocations: websiteAllocations(101),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/1 and 100/i) });
    expect(q.batch).not.toHaveBeenCalled();
  });

  it("rejects mixed OTA + website allocations", async () => {
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 1,
      allocations: [
        { type: "website", paymentId: "pay_1", allocatedPaise: 100 },
        { bookingId: 5, bookingCycle: 1, allocatedPaise: 100 },
      ],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/one receivable source/i) });
  });

  it.each([13, 15])("chunks %i website rows through db.batch", async (count) => {
    mockWebsiteHappyPath(count, count * 1000);
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 1,
      allocations: websiteAllocations(count),
    }));
    const body = await res.json();
    expect({ status: res.status, body }).toEqual({
      status: 200,
      body: expect.objectContaining({ success: true, ids: expect.any(Array) }),
    });
    expect(body.ids).toHaveLength(count);
    expect(q.batch).toHaveBeenCalledTimes(1);
    expect((q.batch.mock.calls[0][0] as unknown[]).length).toBe(Math.ceil(count / GATEWAY_ALLOC_INSERT_CHUNK));
  });

  it("rejects duplicate website paymentIds", async () => {
    mockWebsiteHappyPath(1, 2000);
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 1,
      allocations: [
        { type: "website", paymentId: "pay_1", allocatedPaise: 500 },
        { type: "website", paymentId: "pay_1", allocatedPaise: 500 },
      ],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unique/i) });
    expect(q.batch).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when db.batch is missing", async () => {
    mockWebsiteHappyPath(3, 5000);
    const db = q.getDb();
    delete (db as { batch?: unknown }).batch;
    q.getDb.mockReturnValue(db);

    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 1,
      allocations: websiteAllocations(3),
    }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/batch API unavailable/i) });
  });
});

describe("OTA allocateBatch via route", () => {
  it("forwards mid-size 50 OTA allocations to the batch helper", async () => {
    q.allocatePlatformSettlementBatch.mockResolvedValue({
      ids: Array.from({ length: 50 }, (_, i) => i + 1),
      unallocatedPaise: 0,
    });
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 9,
      allocations: Array.from({ length: 50 }, (_, i) => ({
        bookingId: i + 1,
        bookingCycle: 1,
        allocatedPaise: 100,
      })),
    }));
    expect(res.status).toBe(200);
    expect(q.allocatePlatformSettlementBatch.mock.calls[0][0].allocations).toHaveLength(50);
  });

  it("surfaces duplicate booking-cycle rejection from the helper", async () => {
    q.allocatePlatformSettlementBatch.mockRejectedValue(
      new Error("Each selected booking cycle must be valid and unique"),
    );
    const res = await POST(req({
      action: "allocateBatch",
      settlementId: 9,
      allocations: [
        { bookingId: 1, bookingCycle: 1, allocatedPaise: 100 },
        { bookingId: 1, bookingCycle: 1, allocatedPaise: 100 },
      ],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unique/i) });
  });
});
