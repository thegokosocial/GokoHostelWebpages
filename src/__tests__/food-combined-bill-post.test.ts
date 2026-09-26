import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getFoodOrdersByCheckinIds: vi.fn(),
  getFoodOrdersByIds: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getFoodOrderById: vi.fn(),
  getSetting: vi.fn(),
  getAllBeds: vi.fn(),
  addAuditEntry: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrdersByCheckinIds: q.getFoodOrdersByCheckinIds,
  getFoodOrdersByIds: q.getFoodOrdersByIds,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
  getFoodOrderById: q.getFoodOrderById,
  getSetting: q.getSetting,
  getAllBeds: q.getAllBeds,
  addAuditEntry: q.addAuditEntry,
  getMenuItemCategoryExemptions: vi.fn(async () => new Map()),
  updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(),
  updateFoodOrderPayment: vi.fn(),
  updateFoodOrderStatus: vi.fn(),
  getFoodOrderItems: vi.fn(),
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

function order(partial: Record<string, unknown>) {
  return {
    id: 1,
    orderNumber: "F-1",
    guestType: "walkin",
    checkinId: null,
    guestName: "Walk",
    guestPhone: "9000000001",
    roomInfo: "",
    subtotal: 1000,
    tax: 0,
    total: 1000,
    amountPaid: 0,
    amountRefunded: 0,
    discount: 0,
    status: "placed",
    paymentStatus: "pending",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...partial,
  };
}

function fixedItems(orderId: number, lineTotal = 1000) {
  return [{ id: orderId * 10, orderId, menuItemId: 1, itemName: "Tea", itemPrice: lineTotal, quantity: 1, lineTotal, status: "active", pricingStatus: "fixed" }];
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  q.getSetting.mockResolvedValue("0");
  q.getAllBeds.mockResolvedValue([]);
  q.getFoodOrdersByCheckinIds.mockResolvedValue([]);
  q.getFoodOrdersByIds.mockResolvedValue([]);
  q.getFoodOrderItemsBatch.mockResolvedValue(new Map());
  q.getDb.mockReturnValue(makeDb([]));
});

/** Fluent select mock: supports .where().orderBy / .groupBy and awaitable .where() for IN batches. */
function makeDb(orderByRows: unknown[] = [], whereRows: unknown[] = []) {
  const thenable = (rows: unknown[]) => {
    const p = Promise.resolve(rows) as Promise<unknown[]> & {
      groupBy: () => Promise<unknown[]>;
      orderBy: () => Promise<unknown[]>;
      limit: () => Promise<unknown[]>;
    };
    p.groupBy = async () => [];
    p.orderBy = async () => orderByRows;
    p.limit = async () => whereRows;
    return p;
  };
  return {
    select: () => ({
      from: () => ({
        where: () => thenable(whereRows),
        orderBy: async () => orderByRows,
        groupBy: async () => [],
      }),
    }),
  };
}

describe("POST getCombinedBill handler", () => {
  it("loads checkin orders via getFoodOrdersByCheckinIds and returns grandTotal", async () => {
    const due = order({ id: 10, guestType: "hostel", checkinId: 5, guestName: "Stay", guestPhone: "", total: 1500 });
    q.getFoodOrdersByCheckinIds.mockResolvedValue([due]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, fixedItems(10, 1500)]]));

    const res = await POST(actionReq("getCombinedBill", { checkinIds: [5], orderIds: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grandTotal).toBe(1500);
    expect(body.guests).toHaveLength(1);
    expect(q.getFoodOrdersByCheckinIds).toHaveBeenCalledWith([5]);
    expect(q.getFoodOrdersByIds).not.toHaveBeenCalled();
  });

  it("loads walk-in orderIds only", async () => {
    const walk = order({ id: 20, guestName: "Cafe", total: 800 });
    q.getFoodOrdersByIds.mockResolvedValue([walk]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[20, fixedItems(20, 800)]]));

    const res = await POST(actionReq("getCombinedBill", { checkinIds: [], orderIds: [20] }));
    expect(res.status).toBe(200);
    expect((await res.json()).grandTotal).toBe(800);
    expect(q.getFoodOrdersByIds).toHaveBeenCalledWith([20]);
    expect(q.getFoodOrdersByCheckinIds).not.toHaveBeenCalled();
  });

  it("sums hostel + walk-in sides", async () => {
    q.getFoodOrdersByCheckinIds.mockResolvedValue([
      order({ id: 1, guestType: "hostel", checkinId: 9, guestName: "H", guestPhone: "", total: 1000 }),
    ]);
    q.getFoodOrdersByIds.mockResolvedValue([
      order({ id: 2, guestName: "W", total: 500 }),
    ]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [1, fixedItems(1, 1000)],
      [2, fixedItems(2, 500)],
    ]));

    const res = await POST(actionReq("getCombinedBill", { checkinIds: [9], orderIds: [2] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grandTotal).toBe(1500);
    expect(body.guests).toHaveLength(2);
  });

  it("dedupes overlapping checkinId + orderId so grandTotal is not doubled", async () => {
    const shared = order({ id: 42, guestType: "hostel", checkinId: 7, guestName: "Overlap", total: 1500 });
    q.getFoodOrdersByCheckinIds.mockResolvedValue([shared]);
    q.getFoodOrdersByIds.mockResolvedValue([shared, order({ id: 43, guestName: "Extra", total: 500 })]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [42, fixedItems(42, 1500)],
      [43, fixedItems(43, 500)],
    ]));

    const res = await POST(actionReq("getCombinedBill", { checkinIds: [7], orderIds: [42, 43] }));
    expect(res.status).toBe(200);
    expect((await res.json()).grandTotal).toBe(2000);
  });

  it("rejects pending market price lines", async () => {
    q.getFoodOrdersByIds.mockResolvedValue([order({ id: 30, total: 0 })]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[30, [
      { id: 1, orderId: 30, menuItemId: 4, itemName: "Fish", itemPrice: 0, quantity: 1, lineTotal: 0, status: "active", pricingStatus: "pending" },
    ]]]));

    const res = await POST(actionReq("getCombinedBill", { orderIds: [30] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/final prices/i) });
  });

  it("rejects empty checkinIds and orderIds", async () => {
    const res = await POST(actionReq("getCombinedBill", { checkinIds: [], orderIds: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/at least one/i) });
  });

  it("batches large dual selections (26+26) through the loaders", async () => {
    const checkinIds = Array.from({ length: 26 }, (_, i) => i + 1);
    const orderIds = Array.from({ length: 26 }, (_, i) => i + 100);
    q.getFoodOrdersByCheckinIds.mockResolvedValue(
      checkinIds.map((id) => order({ id, guestType: "hostel", checkinId: id, guestName: `H${id}`, total: 100 })),
    );
    q.getFoodOrdersByIds.mockResolvedValue(
      orderIds.map((id) => order({ id, guestName: `W${id}`, total: 100 })),
    );
    const items = new Map<number, ReturnType<typeof fixedItems>>();
    for (const id of [...checkinIds, ...orderIds]) items.set(id, fixedItems(id, 100));
    q.getFoodOrderItemsBatch.mockResolvedValue(items);

    const res = await POST(actionReq("getCombinedBill", { checkinIds, orderIds }));
    expect(res.status).toBe(200);
    expect((await res.json()).grandTotal).toBe(5200);
    expect(q.getFoodOrdersByCheckinIds).toHaveBeenCalledWith(checkinIds);
    expect(q.getFoodOrdersByIds).toHaveBeenCalledWith(orderIds);
  });

  it("backfills guestPhone from checkins when order phone is empty", async () => {
    q.getFoodOrdersByCheckinIds.mockResolvedValue([
      order({ id: 50, guestType: "hostel", checkinId: 88, guestName: "Silent", guestPhone: "", total: 700 }),
    ]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[50, fixedItems(50, 700)]]));
    q.getDb.mockReturnValue(makeDb([], [{ id: 88, contact: "+91 98765 43210" }]));

    const res = await POST(actionReq("getCombinedBill", { checkinIds: [88] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests[0].guestPhone).toMatch(/98765/);
  });
});

describe("POST getCombinedBillOptions walk-in grouping", () => {
  it("keeps same phone '1' with different names as separate guests", async () => {
    const rows = [
      order({ id: 1, guestName: "Alice", guestPhone: "1", total: 300, createdAt: "2026-09-20T10:00:00.000Z" }),
      order({ id: 2, guestName: "Bob", guestPhone: "1", total: 400, createdAt: "2026-09-20T11:00:00.000Z" }),
    ];
    q.getDb.mockReturnValue(makeDb(rows));

    const res = await POST(actionReq("getCombinedBillOptions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.guests.map((g: { name: string }) => g.name).sort();
    expect(names).toEqual(["Alice", "Bob"]);
    expect(body.guests).toHaveLength(2);
  });
});
