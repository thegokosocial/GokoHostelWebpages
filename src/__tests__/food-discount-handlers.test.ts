import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getFoodOrderById: vi.fn(),
  getFoodOrderItems: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(),
  getSetting: vi.fn(),
  updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(),
  addAuditEntry: vi.fn(),
  updateFoodOrderPayment: vi.fn(),
  updateFoodOrderStatus: vi.fn(),
  getDb: vi.fn(),
  batch: vi.fn(async (writes: unknown[]) => Promise.all(writes as Promise<unknown>[])),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: q.getFoodOrderById,
  getFoodOrderItems: q.getFoodOrderItems,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
  getMenuItemCategoryExemptions: q.getMenuItemCategoryExemptions,
  getSetting: q.getSetting,
  updateFoodOrder: q.updateFoodOrder,
  addOrderModification: q.addOrderModification,
  addAuditEntry: q.addAuditEntry,
  updateFoodOrderPayment: q.updateFoodOrderPayment,
  updateFoodOrderStatus: q.updateFoodOrderStatus,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/guestReceipts", () => ({
  latestReceiptAccount: vi.fn(),
  createGuestReceipt: vi.fn(),
  receiptBusinessDate: vi.fn(() => "2026-09-22"),
  resolveReceiptAccount: vi.fn(),
}));
vi.mock("@/lib/pushNotify", () => ({ dispatchPush: vi.fn(), notificationFoodBody: vi.fn() }));
vi.mock("@/lib/cashPaymentJournal", () => ({
  assertCashDateOpen: vi.fn(async () => undefined),
  assertCashPaymentCorrectionOpen: vi.fn(async () => undefined),
  recordCashPaymentEvent: vi.fn(async () => ({ duplicate: false })),
  recordCashPaymentCorrection: vi.fn(async () => ({ duplicate: false })),
}));

import { POST } from "@/app/api/admin/food-orders/route";

function actionReq(action: string, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/food-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action, ...body }),
  });
}

function unpaidOrder(id: number, total = 10000) {
  return {
    id,
    orderNumber: `F-${id}`,
    status: "placed",
    paymentStatus: "pending",
    amountPaid: 0,
    amountRefunded: 0,
    discount: 0,
    total,
    subtotal: total,
    tax: 0,
  };
}

function line(menuItemId: number, lineTotal: number) {
  return { id: menuItemId * 10, menuItemId, itemName: `Item ${menuItemId}`, itemPrice: lineTotal, quantity: 1, lineTotal, status: "active", pricingStatus: "fixed" };
}

const updateSets: Record<string, unknown>[] = [];

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  updateSets.length = 0;
  q.batch.mockImplementation(async (writes: unknown[]) => Promise.all(writes as Promise<unknown>[]));
  q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  q.getSetting.mockResolvedValue("0");
  q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
  q.getDb.mockReturnValue({
    batch: q.batch,
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        updateSets.push(payload);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({ values: async () => undefined }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  });
});

describe("applyDiscount / removeDiscount handlers", () => {
  it("applies a fixed-amount discount on an unpaid order", async () => {
    q.getFoodOrderById.mockResolvedValue(unpaidOrder(10, 10000));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, [line(1, 10000)]]]));

    const res = await POST(actionReq("applyDiscount", {
      orderIds: [10],
      discountAmount: 2000,
      reason: "Regular",
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(q.batch).toHaveBeenCalled();
    const writes = q.batch.mock.calls[0][0] as unknown[];
    expect(writes.length).toBeGreaterThanOrEqual(2);
  });

  it("applies a percent discount and leaves tax-exempt lines out of the discountable base", async () => {
    q.getSetting.mockResolvedValue("5");
    q.getFoodOrderById.mockResolvedValue(unpaidOrder(11, 15000));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[11, [line(1, 10000), line(2, 5000)]]]));
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map([[2, true]]));

    const res = await POST(actionReq("applyDiscount", {
      orderIds: [11],
      discountPercent: 10,
      reason: "Staff",
    }));
    expect(res.status).toBe(200);
    expect(q.getMenuItemCategoryExemptions).toHaveBeenCalledWith([1, 2]);
    // 10% of discountable 10000 (item 2 exempt) = 1000 → subtotal 14000, tax 5% = 700
    expect(updateSets[0]).toMatchObject({
      discount: 1000,
      subtotal: 14000,
      tax: 700,
      total: 14700,
    });
  });

  it("rejects percent > 100 without mutating", async () => {
    q.getFoodOrderById.mockResolvedValue(unpaidOrder(12));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[12, [line(1, 10000)]]]));

    const res = await POST(actionReq("applyDiscount", {
      orderIds: [12],
      discountPercent: 101,
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/100/i) });
    expect(q.batch).not.toHaveBeenCalled();
  });

  it("rejects discount that would drop total below already-collected payment", async () => {
    q.getFoodOrderById.mockResolvedValue({
      ...unpaidOrder(13, 10000),
      amountPaid: 9000,
      paymentStatus: "partial",
    });
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[13, [line(1, 10000)]]]));

    const res = await POST(actionReq("applyDiscount", {
      orderIds: [13],
      discountAmount: 2000,
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/already been paid|correction or refund/i) });
    expect(q.batch).not.toHaveBeenCalled();
  });

  it("removeDiscount clears an unpaid discounted order", async () => {
    q.getFoodOrderById.mockResolvedValue({
      ...unpaidOrder(14, 8000),
      discount: 2000,
      subtotal: 8000,
    });
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[14, [line(1, 10000)]]]));

    const res = await POST(actionReq("removeDiscount", { orderIds: [14] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      removedOrderIds: [14],
      skippedPaidOrderIds: [],
    });
    expect(q.batch).toHaveBeenCalled();
  });

  it("removeDiscount skips paid discounted orders and clears unpaid ones", async () => {
    q.getFoodOrderById
      .mockResolvedValueOnce({ ...unpaidOrder(15, 8000), discount: 2000 })
      .mockResolvedValueOnce({
        id: 16,
        orderNumber: "F-16",
        status: "placed",
        paymentStatus: "paid",
        amountPaid: 8000,
        amountRefunded: 0,
        discount: 2000,
        total: 8000,
        subtotal: 8000,
        tax: 0,
      });
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[15, [line(1, 10000)]]]));

    const res = await POST(actionReq("removeDiscount", { orderIds: [15, 16] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      removedOrderIds: [15],
      skippedPaidOrderIds: [16],
    });
  });

  it("removeDiscount returns 409 when every selected discount is paid-collected", async () => {
    q.getFoodOrderById.mockResolvedValue({
      id: 17,
      orderNumber: "F-17",
      status: "placed",
      paymentStatus: "paid",
      amountPaid: 8000,
      amountRefunded: 0,
      discount: 2000,
      total: 8000,
      subtotal: 8000,
      tax: 0,
    });

    const res = await POST(actionReq("removeDiscount", { orderIds: [17] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/payment collected/i) });
    expect(q.batch).not.toHaveBeenCalled();
  });

  it("applies one Combined Bill discount across multiple unpaid orderIds", async () => {
    q.getFoodOrderById
      .mockResolvedValueOnce(unpaidOrder(21, 5000))
      .mockResolvedValueOnce(unpaidOrder(22, 5000));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [21, [line(1, 5000)]],
      [22, [line(2, 5000)]],
    ]));

    const res = await POST(actionReq("applyDiscount", {
      orderIds: [21, 22],
      discountAmount: 1000,
      reason: "Combined",
    }));
    expect(res.status).toBe(200);
    expect(q.batch).toHaveBeenCalled();
    const writes = q.batch.mock.calls[0][0] as unknown[];
    // 2 orders × (update + mod) + 1 audit
    expect(writes.length).toBe(5);
  });

  it("removeDiscount across Combined Bill multi-id unpaid set", async () => {
    q.getFoodOrderById
      .mockResolvedValueOnce({ ...unpaidOrder(23, 4000), discount: 1000 })
      .mockResolvedValueOnce({ ...unpaidOrder(24, 4000), discount: 1000 });
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [23, [line(1, 5000)]],
      [24, [line(2, 5000)]],
    ]));

    const res = await POST(actionReq("removeDiscount", { orderIds: [23, 24] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      removedOrderIds: [23, 24],
      skippedPaidOrderIds: [],
    });
  });

  it("staff without discount/pay permissions gets 403 on apply and remove", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "ViewOnly",
      permissions: { canViewFoodOrders: true },
    });

    const apply = await POST(actionReq("applyDiscount", { orderIds: [10], discountAmount: 100 }));
    expect(apply.status).toBe(403);
    expect(await apply.json()).toMatchObject({
      code: "permission_denied",
      requiredPermissions: expect.arrayContaining(["canApplyFoodDiscounts"]),
    });

    const remove = await POST(actionReq("removeDiscount", { orderIds: [10] }));
    expect(remove.status).toBe(403);
    expect(q.batch).not.toHaveBeenCalled();
  });
});
