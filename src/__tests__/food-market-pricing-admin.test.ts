import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(), getFoodOrderById: vi.fn(), getFoodOrderItems: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(), getSetting: vi.fn(), updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(), addAuditEntry: vi.fn(), updateFoodOrderPayment: vi.fn(), updateFoodOrderStatus: vi.fn(),
  updateFoodOrderItemQuantity: vi.fn(), deleteFoodOrderItem: vi.fn(), addStock: vi.fn(), decrementStock: vi.fn(), decrementStockIfAvailable: vi.fn(),
  restoreStock: vi.fn(),
  createFoodOrder: vi.fn(), addFoodOrderItems: vi.fn(), getNextOrderNumber: vi.fn(), getMenuItemById: vi.fn(),
  getFoodOrderByIdempotencyKey: vi.fn(),
  countFoodOrderItems: vi.fn(),
  abandonIncompleteFoodOrder: vi.fn(),
  dispatchPush: vi.fn(), notificationFoodBody: vi.fn(),
  latestReceiptAccount: vi.fn(), createGuestReceipt: vi.fn(), resolveReceiptAccount: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getPendingPriceOrderIds: vi.fn(),
  getDb: vi.fn(),
  releaseFoodQrForDeskPayment: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: q.getFoodOrderById, getFoodOrderItems: q.getFoodOrderItems,
  getMenuItemCategoryExemptions: q.getMenuItemCategoryExemptions, getSetting: q.getSetting,
  updateFoodOrder: q.updateFoodOrder, addOrderModification: q.addOrderModification,
  addAuditEntry: q.addAuditEntry, updateFoodOrderPayment: q.updateFoodOrderPayment,
  updateFoodOrderStatus: q.updateFoodOrderStatus,
  updateFoodOrderItemQuantity: q.updateFoodOrderItemQuantity, deleteFoodOrderItem: q.deleteFoodOrderItem,
  addStock: q.addStock, decrementStock: q.decrementStock, decrementStockIfAvailable: q.decrementStockIfAvailable, restoreStock: q.restoreStock,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
  getPendingPriceOrderIds: q.getPendingPriceOrderIds,
  createFoodOrder: q.createFoodOrder, addFoodOrderItems: q.addFoodOrderItems,
  getNextOrderNumber: q.getNextOrderNumber, getMenuItemById: q.getMenuItemById,
  getFoodOrderByIdempotencyKey: q.getFoodOrderByIdempotencyKey,
  countFoodOrderItems: q.countFoodOrderItems,
  abandonIncompleteFoodOrder: q.abandonIncompleteFoodOrder,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/foodQrPayment", () => ({
  hasActiveFoodQrClaim: vi.fn(async () => false),
  releaseFoodQrForDeskPayment: q.releaseFoodQrForDeskPayment,
  FoodQrError: class FoodQrError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.name = "FoodQrError";
      this.status = status;
    }
  },
}));
vi.mock("@/lib/guestReceipts", () => ({ latestReceiptAccount: q.latestReceiptAccount, createGuestReceipt: q.createGuestReceipt, receiptBusinessDate: vi.fn(() => "2026-09-22"), resolveReceiptAccount: q.resolveReceiptAccount }));
vi.mock("@/lib/pushNotify", () => ({ dispatchPush: q.dispatchPush, notificationFoodBody: q.notificationFoodBody }));

import { POST } from "@/app/api/admin/food-orders/route";

const order = { id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "pending", discount: 0, total: 0 };
const pendingItem = { id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 0, quantity: 2, lineTotal: 0, pricingStatus: "pending", status: "active" };

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "setFoodOrderItemPrice", ...body }) });
}

function actionReq(action: string, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/food-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action, ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  Object.assign(pendingItem, { itemPrice: 0, quantity: 2, lineTotal: 0, pricingStatus: "pending" });
  q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  q.getFoodOrderById.mockResolvedValue(order);
  q.getFoodOrderItems.mockResolvedValue([pendingItem]);
  q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
  q.getSetting.mockResolvedValue("5");
  q.updateFoodOrder.mockResolvedValue(undefined);
  q.addOrderModification.mockResolvedValue(undefined);
  q.addAuditEntry.mockResolvedValue(undefined);
  q.updateFoodOrderStatus.mockResolvedValue(undefined);
  q.restoreStock.mockResolvedValue(undefined);
  q.latestReceiptAccount.mockResolvedValue(null);
  q.resolveReceiptAccount.mockResolvedValue(7);
  q.createGuestReceipt.mockResolvedValue(undefined);
  q.addFoodOrderItems.mockResolvedValue(undefined);
  q.dispatchPush.mockResolvedValue(undefined);
  q.notificationFoodBody.mockReturnValue("New food order");
  q.getFoodOrderItemsBatch.mockResolvedValue(new Map());
  q.getPendingPriceOrderIds.mockResolvedValue(new Set());
  q.getMenuItemById.mockResolvedValue({ id: 4, name: "Seasonal Fish", trackInventory: 0, stockQuantity: 0 });
  q.getFoodOrderByIdempotencyKey.mockResolvedValue(null);
  q.countFoodOrderItems.mockResolvedValue(1);
  q.abandonIncompleteFoodOrder.mockResolvedValue({ abandoned: true, order: null });
  q.updateFoodOrderItemQuantity.mockImplementation(async (id: number, quantity: number, price: number) => Object.assign(pendingItem, { quantity, lineTotal: quantity * price }));
  q.getDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [pendingItem] }) }) }),
    update: () => ({ set: (data: Partial<typeof pendingItem>) => ({ where: async () => Object.assign(pendingItem, data) }) }),
  });
  q.releaseFoodQrForDeskPayment.mockResolvedValue({ releasedAttemptIds: [] });
});

describe("admin market-pricing workflows", () => {
  it("places Order More for a guest whose previous order is fully paid", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41,
      name: "Soap",
      price: 500,
      priceOnRequest: 0,
      trackInventory: 0,
      stockQuantity: 0,
    });
    q.getNextOrderNumber.mockResolvedValue("D266-11");
    q.createFoodOrder.mockResolvedValue([{ id: 99, orderNumber: "D266-11", total: 500 }]);
    q.getSetting.mockResolvedValue("0");

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Pawan test",
      guestPhone: "123454321",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, orderId: 99, orderNumber: "D266-11", total: 500 });
    // Walk-in (non-table): normalizePhone only — no cafe session mint / table occupancy query.
    expect(q.createFoodOrder).toHaveBeenCalledWith(expect.objectContaining({
      guestType: "walkin",
      guestName: "Pawan test",
      guestPhone: "123454321",
      roomInfo: "",
      total: 500,
      paymentStatus: "pending",
      createdBy: "Admin",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }));
    expect(q.addFoodOrderItems).toHaveBeenCalledWith([expect.objectContaining({
      orderId: 99,
      itemName: "Soap",
      quantity: 1,
      lineTotal: 500,
    })]);
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_order_placed", target: "order:99" }));
  });

  it("placeOrderForGuest hostel path is unchanged (checkin tab, no cafe session logic)", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D266-h1");
    q.createFoodOrder.mockResolvedValue([{ id: 88, orderNumber: "D266-h1", total: 500 }]);

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "hostel",
      guestName: "Goko Guest",
      checkinId: 42,
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    }));

    expect(response.status).toBe(200);
    expect(q.createFoodOrder).toHaveBeenCalledWith(expect.objectContaining({
      guestType: "hostel",
      checkinId: 42,
      guestName: "Goko Guest",
      guestPhone: "",
      paymentStatus: "on_tab",
    }));
  });

  it("finalizes a pending line in static QR mode, persists it, and recalculates totals", async () => {
    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 45000 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ subtotal: 90000, tax: 4500, total: 94500, notes: "" });
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([10]);
    expect(pendingItem).toMatchObject({ itemPrice: 45000, lineTotal: 90000, pricingStatus: "fixed" });
    expect(q.updateFoodOrder).toHaveBeenCalledWith(10, expect.objectContaining({ subtotal: 90000, tax: 4500, total: 94500, discount: 0, amountPaid: 0, paymentStatus: "pending" }));
    expect(q.addOrderModification).toHaveBeenCalledWith(expect.objectContaining({ action: "price_finalized", oldValue: "0", newValue: "45000" }));
  });

  it.each(["razorpay_test", "razorpay_live"])("retires a %s dynamic QR before persisting the final price", async () => {
    q.releaseFoodQrForDeskPayment.mockResolvedValue({ releasedAttemptIds: ["attempt-1"] });

    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 100 }));

    expect(response.status).toBe(200);
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([10]);
    expect(pendingItem).toMatchObject({ itemPrice: 100, lineTotal: 200, pricingStatus: "fixed" });
  });

  it.each(["razorpay_test", "razorpay_live"])("does not change a pending price when the %s QR capture race wins", async () => {
    const { FoodQrError } = await import("@/lib/foodQrPayment");
    q.releaseFoodQrForDeskPayment.mockRejectedValue(new FoodQrError("Already paid via Razorpay", 409));

    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 100 }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Already paid via Razorpay" });
    expect(pendingItem).toMatchObject({ itemPrice: 0, lineTotal: 0, pricingStatus: "pending" });
    expect(q.updateFoodOrder).not.toHaveBeenCalled();
    expect(q.addOrderModification).not.toHaveBeenCalled();
  });

  it("stores an optional custom label on the line notes", async () => {
    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 20000, label: "  Outside split  " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ notes: "Outside split" });
    expect(pendingItem).toMatchObject({ itemPrice: 20000, lineTotal: 40000, pricingStatus: "fixed", notes: "Outside split" });
    expect(q.addOrderModification).toHaveBeenCalledWith(expect.objectContaining({
      action: "price_finalized",
      reason: "Final market price · Outside split",
    }));
  });

  it("trims custom labels to 24 characters", async () => {
    const long = "abcdefghijklmnopqrstuvwxyz";
    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 10000, label: long }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ notes: "abcdefghijklmnopqrstuvwx" });
  });

  it("blocks payment while any active line is still pending", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "updatePaymentDetails", orderId: 10, paymentStatus: "paid" }) }));
    expect(response.status).toBe(400);
    expect(q.updateFoodOrderPayment).not.toHaveBeenCalled();
  });

  it("corrects the receiving account for an already-paid online order", async () => {
    const paidOrder = {
      ...order,
      paymentStatus: "paid",
      paymentMethod: "online",
      total: 10000,
      cashReceived: 0,
      changeGiven: 0,
      paidBy: "Admin",
    };
    q.getFoodOrderById.mockResolvedValue(paidOrder);
    q.getFoodOrderItems.mockResolvedValue([{ ...pendingItem, pricingStatus: "fixed", itemPrice: 5000, lineTotal: 10000 }]);
    q.latestReceiptAccount.mockResolvedValue(7);
    q.resolveReceiptAccount.mockResolvedValue(9);

    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "updatePaymentDetails", orderId: 10, paymentMethod: "online", onlineAccountId: 9 }),
    }));

    expect(response.status).toBe(200);
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: "reversal", accountId: 7, amount: -10000 }));
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: "food", accountId: 9, amount: 10000 }));
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_payment_modified", details: expect.stringContaining("Receiving account changed") }));
  });

  it("rejects duplicate payment selections before loading or mutating orders", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "markOrderPaid", orderIds: [10, 10], paymentMethod: "cash", cashReceived: 0, changeGiven: 0 }),
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/duplicate/i);
    expect(q.getFoodOrderById).not.toHaveBeenCalled();
  });

  it("does not pay an order that is already paid or cancelled", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, paymentStatus: "paid" });
    const paidResponse = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "markOrderPaid", orderIds: [10], paymentMethod: "online" }),
    }));
    expect(paidResponse.status).toBe(409);

    q.getFoodOrderById.mockResolvedValue({ ...order, status: "cancelled", paymentStatus: "pending" });
    const cancelledResponse = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "markOrderPaid", orderIds: [10], paymentMethod: "online" }),
    }));
    expect(cancelledResponse.status).toBe(409);
  });

  it("records online payment atomically through the D1 batch path", async () => {
    const payableOrder = { ...order, total: 400, paymentMethod: "", paymentStatus: "pending" };
    q.getFoodOrderById.mockResolvedValue(payableOrder);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, [{ status: "active", pricingStatus: "fixed" }]]]));
    q.resolveReceiptAccount.mockResolvedValue(7);

    const currentRows = vi.fn(async () => [payableOrder]);
    const updateWhere = vi.fn(async () => undefined);
    const update = vi.fn(() => ({ set: () => ({ where: updateWhere }) }));
    const insertValues = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values: insertValues }));
    const batch = vi.fn(async (writes: unknown[]) => {
      expect(writes).toHaveLength(3);
      return [];
    });
    q.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: currentRows }) }),
      update,
      insert,
      batch,
    });

    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "markOrderPaid", orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }),
    }));

    expect(response.status).toBe(200);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("uses the net outstanding balance when a legacy paid flag is stale", async () => {
    const stalePaidOrder = {
      ...order,
      total: 300,
      amountPaid: 100,
      paymentStatus: "paid",
      paymentMethod: "online",
    };
    q.getFoodOrderById.mockResolvedValue(stalePaidOrder);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, [{ status: "active", pricingStatus: "fixed" }]]]));
    q.resolveReceiptAccount.mockResolvedValue(7);

    const currentRows = vi.fn(async () => [stalePaidOrder]);
    const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
    const insertValues = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values: insertValues }));
    q.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: currentRows }) }),
      update,
      insert,
      batch: vi.fn(async () => []),
    });

    const response = await POST(actionReq("markOrderPaid", { orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }));

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ amount: 200, kind: "food" }));
  });

  it("reverts a paid online order to pending and reverses its receipt with an audit entry", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, paymentStatus: "paid", paymentMethod: "online", total: 10000, paidBy: "Admin" });
    q.latestReceiptAccount.mockResolvedValue(7);

    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "updatePaymentDetails", orderId: 10, paymentStatus: "pending", paymentMethod: "" }),
    }));

    expect(response.status).toBe(200);
    expect(q.getDb).toHaveBeenCalled();
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: "reversal", accountId: 7, amount: -10000 }));
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_payment_modified", target: "order:10" }));
  });

  it("refuses to rewrite or reverse a Razorpay food QR capture via updatePaymentDetails", async () => {
    q.getFoodOrderById.mockResolvedValue({
      ...order,
      paymentStatus: "paid",
      paymentMethod: "razorpay_test",
      total: 10000,
      amountPaid: 10000,
      paidBy: "razorpay",
    });

    const methodRewrite = await POST(actionReq("updatePaymentDetails", {
      orderId: 10,
      paymentMethod: "cash",
    }));
    expect(methodRewrite.status).toBe(409);
    expect(await methodRewrite.json()).toMatchObject({ error: expect.stringMatching(/cannot be rewritten/i) });

    const statusRevert = await POST(actionReq("updatePaymentDetails", {
      orderId: 10,
      paymentStatus: "pending",
    }));
    expect(statusRevert.status).toBe(409);
    expect(await statusRevert.json()).toMatchObject({ error: expect.stringMatching(/cannot be reversed/i) });
    expect(q.updateFoodOrderPayment).not.toHaveBeenCalled();
  });

  it("collects only the outstanding balance when a partial order is completed", async () => {
    q.getFoodOrderById.mockResolvedValue({
      ...order,
      paymentStatus: "partial",
      paymentMethod: "online",
      amountPaid: 400,
      total: 600,
    });
    q.getFoodOrderItems.mockResolvedValue([{ ...pendingItem, pricingStatus: "fixed", itemPrice: 200, quantity: 3, lineTotal: 600 }]);
    q.resolveReceiptAccount.mockResolvedValue(7);

    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "updatePaymentDetails", orderId: 10, paymentStatus: "paid", paymentMethod: "online", onlineAccountId: 7 }),
    }));

    expect(response.status).toBe(200);
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: "food", amount: 200, accountId: 7 }));
    expect(q.createGuestReceipt).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "food", amount: 600 }));
  });

  it("preserves previous cash when payment editing completes a partial order online", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, paymentStatus: "partial", paymentMethod: "cash", amountPaid: 400, cashReceived: 500, changeGiven: 100, total: 600 });
    q.getFoodOrderItems.mockResolvedValue([{ ...pendingItem, pricingStatus: "fixed" }]);

    const response = await POST(actionReq("updatePaymentDetails", { orderId: 10, paymentStatus: "paid", paymentMethod: "online", onlineAccountId: 7 }));

    expect(response.status).toBe(200);
    expect(pendingItem).toMatchObject({ amountPaid: 600, paymentMethod: "split", cashReceived: 400, changeGiven: 0 });
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: "food", amount: 200 }));
  });

  it("cancels a food order, restores stock, and records the status audit", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "updateOrderStatus", orderId: 10, status: "cancelled", cancelledReason: "Guest cancelled" }),
    }));

    expect(response.status).toBe(200);
    expect(q.updateFoodOrderStatus).toHaveBeenCalledWith(10, "cancelled", "Guest cancelled");
    expect(q.restoreStock).toHaveBeenCalledWith(10);
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_order_status", target: "order:10", details: expect.stringContaining("Guest cancelled") }));
  });

  it("cancels an unpaid order through the explicit order-cancel action", async () => {
    const response = await POST(actionReq("cancelUnpaidOrder", { orderId: 10, cancelledReason: "Cancelled by admin" }));

    expect(response.status).toBe(200);
    expect(q.updateFoodOrderStatus).toHaveBeenCalledWith(10, "cancelled", "Cancelled by admin");
    expect(q.restoreStock).toHaveBeenCalledWith(10);
    expect(q.addOrderModification).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 10, action: "order_cancelled", newValue: "cancelled", reason: "Cancelled by admin",
    }));
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_order_status", target: "order:10" }));
  });

  it("rejects whole-order cancellation when any payment was collected", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, total: 1000, amountPaid: 500, paymentStatus: "partial" });

    const response = await POST(actionReq("cancelUnpaidOrder", { orderId: 10 }));

    expect(response.status).toBe(409);
    expect(q.updateFoodOrderStatus).not.toHaveBeenCalled();
    expect(q.restoreStock).not.toHaveBeenCalled();
    expect(q.addOrderModification).not.toHaveBeenCalled();
  });

  it("does not repeat stock restoration for an already cancelled order", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, status: "cancelled" });

    const response = await POST(actionReq("cancelUnpaidOrder", { orderId: 10 }));

    expect(response.status).toBe(409);
    expect(q.updateFoodOrderStatus).not.toHaveBeenCalled();
    expect(q.restoreStock).not.toHaveBeenCalled();
  });

  it("does not mutate when the order to cancel is missing", async () => {
    q.getFoodOrderById.mockResolvedValue(null);

    const response = await POST(actionReq("cancelUnpaidOrder", { orderId: 404 }));

    expect(response.status).toBe(404);
    expect(q.updateFoodOrderStatus).not.toHaveBeenCalled();
    expect(q.restoreStock).not.toHaveBeenCalled();
  });

  it("rejects non-positive final prices", async () => {
    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 0 }));
    expect(response.status).toBe(400);
    expect(q.updateFoodOrder).not.toHaveBeenCalled();
  });

  it("supports modifying and voiding lines before final pricing, then payment", async () => {
    const removedItem = { ...pendingItem, id: 21, itemName: "Second Fish" };
    let items = [pendingItem, removedItem];
    let dbItem = removedItem;
    q.getFoodOrderItems.mockImplementation(async () => items);
    q.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [dbItem], then: (resolve: (value: unknown) => unknown) => resolve(items) }) }) }),
      update: () => ({ set: (data: Record<string, unknown>) => ({ where: async () => { Object.assign(dbItem, data); if (data.status === "voided") items = items.filter((item) => item.id !== dbItem.id); } }) }),
    });
    q.deleteFoodOrderItem.mockImplementation(async (id: number) => { items = items.filter((item) => item.id !== id); });
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());

    const quantityResponse = await POST(new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "updateItemQuantity", orderId: 10, orderItemId: 20, newQuantity: 3 }) }));
    expect(quantityResponse.status).toBe(200);
    expect(pendingItem.quantity).toBe(3);
    const voidResponse = await POST(new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "voidItem", orderId: 10, orderItemId: 21, reason: "Guest changed selection" }) }));
    expect(voidResponse.status).toBe(200);
    expect(items).toHaveLength(1);
    dbItem = pendingItem;

    const priceResponse = await POST(req({ orderId: 10, orderItemId: 20, price: 45000 }));
    expect(priceResponse.status).toBe(200);
    const payResponse = await POST(new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "updatePaymentDetails", orderId: 10, paymentStatus: "paid", paymentMethod: "cash" }) }));
    expect(payResponse.status).toBe(200);
  });

  it("preserves a paid balance when a paid order quantity increases", async () => {
    const paidOrder = {
      ...order,
      paymentStatus: "paid",
      paymentMethod: "online",
      total: 10000,
      amountPaid: 10000,
      cashReceived: 0,
      changeGiven: 0,
      checkinId: null,
    };
    const paidItem = { id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 5000, quantity: 2, lineTotal: 10000, pricingStatus: "fixed", status: "active" };
    q.getFoodOrderById.mockResolvedValue(paidOrder);
    q.getFoodOrderItems.mockResolvedValue([paidItem]);
    q.updateFoodOrderItemQuantity.mockImplementation(async (_id: number, quantity: number, price: number) => Object.assign(paidItem, { quantity, lineTotal: quantity * price }));
    q.latestReceiptAccount.mockResolvedValue(7);

      const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "pw", action: "updateItemQuantity", orderId: 10, orderItemId: 20, newQuantity: 3 }),
      }));

    expect(response.status).toBe(200);
    expect(q.updateFoodOrder).toHaveBeenCalledWith(10, expect.objectContaining({ total: 15750, amountPaid: 10000, paymentStatus: "partial" }));
    expect(q.createGuestReceipt).not.toHaveBeenCalled();
  });

  it("reserves tracked stock before an admin quantity increase", async () => {
    const trackedItem = { ...pendingItem, itemPrice: 200, quantity: 2, lineTotal: 400, pricingStatus: "fixed" };
    q.getFoodOrderItems.mockResolvedValue([trackedItem]);
    q.getMenuItemById.mockResolvedValue({ id: 4, name: "Shampoo", trackInventory: 1, stockQuantity: 3 });
    q.getSetting.mockResolvedValue("0");
    q.decrementStockIfAvailable.mockResolvedValue(true);

    const response = await POST(actionReq("updateItemQuantity", {
      orderId: 10, orderItemId: 20, newQuantity: 3,
    }));

    expect(response.status).toBe(200);
    expect(q.decrementStockIfAvailable).toHaveBeenCalledWith(4, 1);
    expect(q.decrementStock).not.toHaveBeenCalled();
    expect(q.addOrderModification).toHaveBeenCalledWith(expect.objectContaining({
      action: "quantity_changed", oldValue: "2", newValue: "3", reason: "",
    }));
  });

  it("allows an admin quantity increase when tracked stock is exhausted", async () => {
    const trackedItem = { ...pendingItem, itemPrice: 200, quantity: 2, lineTotal: 400, pricingStatus: "fixed" };
    q.getFoodOrderItems.mockResolvedValue([trackedItem]);
    q.getMenuItemById.mockResolvedValue({ id: 4, name: "Shampoo", trackInventory: 1, stockQuantity: 0 });
    q.getSetting.mockResolvedValue("0");
    q.decrementStockIfAvailable.mockResolvedValue(true);

    const response = await POST(actionReq("updateItemQuantity", {
      orderId: 10, orderItemId: 20, newQuantity: 3,
    }));

    expect(response.status).toBe(200);
    expect(q.decrementStockIfAvailable).toHaveBeenCalledWith(4, 1);
    expect(q.updateFoodOrderItemQuantity).toHaveBeenCalled();
  });

  it("placeOrderForGuest succeeds when tracked stock is already negative", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 4, name: "Shampoo", price: 500, priceOnRequest: 0, trackInventory: 1, stockQuantity: -4, isAvailable: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D266-99");
    q.createFoodOrder.mockResolvedValue([{ id: 99, orderNumber: "D266-99", total: 1000 }]);

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Walk-in",
      guestPhone: "9876543210",
      items: [{ menuItemId: 4, quantity: 2 }],
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }));

    expect(response.status).toBe(200);
    expect(q.decrementStock).toHaveBeenCalledWith(4, 2);
  });

  it("placeOrderForGuest mints a new cafe session on a free table (ignores client phone)", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D266-t1");
    q.createFoodOrder.mockResolvedValue([{ id: 101, orderNumber: "D266-t1", total: 500 }]);
    q.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
    });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1727001234567);

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Aditya",
      guestPhone: "9999999999999",
      roomInfo: "Table 2",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }));

    expect(response.status).toBe(200);
    expect(q.createFoodOrder).toHaveBeenCalledWith(expect.objectContaining({
      guestPhone: "1727001234567",
      roomInfo: "Table 2",
      guestName: "Aditya",
    }));
    nowSpy.mockRestore();
  });

  it("placeOrderForGuest continues an unreleased paid table session (Order More after pay)", async () => {
    const openSession = "1727009999999";
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D266-t2");
    q.createFoodOrder.mockResolvedValue([{ id: 102, orderNumber: "D266-t2", total: 500 }]);
    q.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => [
              {
                id: 50,
                guestName: "Shashwat",
                guestPhone: openSession,
                roomInfo: "Table 1",
                total: 800,
                amountPaid: 800,
                amountRefunded: 0,
                status: "served",
                createdAt: "2026-09-28T12:00:00.000Z",
              },
              {
                id: 40,
                guestName: "Old Guest",
                guestPhone: "r:111",
                roomInfo: "Table 1",
                total: 500,
                amountPaid: 500,
                amountRefunded: 0,
                status: "served",
                createdAt: "2026-09-26T12:00:00.000Z",
              },
            ],
          }),
        }),
      }),
    });

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Table 1",
      guestPhone: "9999999999999",
      roomInfo: "table 1",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }));

    expect(response.status).toBe(200);
    expect(q.createFoodOrder).toHaveBeenCalledWith(expect.objectContaining({
      guestPhone: openSession,
      guestName: "Shashwat",
      roomInfo: "Table 1",
    }));
  });

  it("releaseCafeTable marks the paid session released and rejects unpaid tables", async () => {
    const session = "1727008888888";
    const unpaid = {
      id: 70,
      guestName: "Aaa",
      guestPhone: session,
      roomInfo: "Table 1",
      total: 48000,
      amountPaid: 0,
      amountRefunded: 0,
      status: "served",
      createdAt: "2026-09-28T12:00:00.000Z",
    };
    q.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => [unpaid],
          }),
        }),
      }),
    });
    const unpaidRes = await POST(actionReq("releaseCafeTable", {
      roomInfo: "Table 1", guestPhone: session,
    }));
    expect(unpaidRes.status).toBe(409);
    expect(q.updateFoodOrder).not.toHaveBeenCalled();

    const paid = { ...unpaid, amountPaid: 48000 };
    q.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => [paid],
          }),
        }),
      }),
    });
    q.getPendingPriceOrderIds.mockResolvedValueOnce(new Set([70]));
    const pendingPriceRes = await POST(actionReq("releaseCafeTable", {
      roomInfo: "Table 1", guestPhone: session,
    }));
    expect(pendingPriceRes.status).toBe(409);
    expect(await pendingPriceRes.json()).toMatchObject({ error: "Set final prices before releasing this table" });

    const paidRes = await POST(actionReq("releaseCafeTable", {
      roomInfo: "Table 1", guestPhone: session,
    }));
    expect(paidRes.status).toBe(200);
    expect(q.updateFoodOrder).toHaveBeenCalledWith(70, { guestPhone: `r:${session}` });
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_table_released" }));
  });

  it("releaseCafeTable rejects non-table walk-ins and hostel-style rooms", async () => {
    const res = await POST(actionReq("releaseCafeTable", {
      roomInfo: "Dorm A - Bed 1",
      guestPhone: "9876543210",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Cafe table and session required" });
    expect(q.updateFoodOrder).not.toHaveBeenCalled();
  });

  it("rejects a quantity reduction that would make the order overpaid", async () => {
    const paidOrder = { ...order, paymentStatus: "paid", paymentMethod: "online", total: 10000, amountPaid: 10000, checkinId: null };
    const paidItem = { id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 5000, quantity: 2, lineTotal: 10000, pricingStatus: "fixed", status: "active" };
    q.getFoodOrderById.mockResolvedValue(paidOrder);
    q.getFoodOrderItems.mockResolvedValue([paidItem]);
    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "updateItemQuantity", orderId: 10, orderItemId: 20, newQuantity: 1 }),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).requiresPaymentAdjustment).toBe(true);
    expect(q.updateFoodOrder).not.toHaveBeenCalled();
  });

  it("lists all outstanding walk-in groups for Combined Bill even when payment status is stale", async () => {
    const rows = [
      { ...order, id: 1, guestType: "walkin", guestName: "Paid", guestPhone: "9000000001", roomInfo: "", total: 100, amountPaid: 100, amountRefunded: 0, paymentStatus: "paid", status: "placed", createdAt: "2026-09-23T01:00:00.000Z" },
      { ...order, id: 2, guestType: "walkin", guestName: "Stale Paid", guestPhone: "9000000002", roomInfo: "", total: 300, amountPaid: 100, amountRefunded: 0, paymentStatus: "paid", status: "placed", createdAt: "2026-09-23T02:00:00.000Z" },
      { ...order, id: 3, guestType: "walkin", guestName: "Pending", guestPhone: "9000000003", roomInfo: "", total: 200, amountPaid: 0, amountRefunded: 0, paymentStatus: "pending", status: "placed", createdAt: "2026-09-23T03:00:00.000Z" },
      { ...order, id: 4, guestType: "walkin", guestName: "Cancelled", guestPhone: "9000000004", roomInfo: "", total: 500, amountPaid: 0, amountRefunded: 0, paymentStatus: "pending", status: "cancelled", createdAt: "2026-09-23T04:00:00.000Z" },
    ];
    const builder = {
      orderBy: async () => rows.filter((row) => row.status !== "cancelled"),
    };
    q.getDb.mockReturnValue({ select: () => ({ from: () => ({ where: () => builder }) }) });
    const response = await POST(actionReq("getCombinedBillOptions"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.guests).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Stale Paid", tabTotal: 200, orderIds: [2] }),
      expect.objectContaining({ name: "Pending", tabTotal: 200, orderIds: [3] }),
    ]));
    expect(body.guests).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Paid" })]));
    expect(body.guests).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Cancelled" })]));
  });

  it("placeOrderForGuest returns duplicate without creating when the key already exists", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 203000, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getFoodOrderByIdempotencyKey.mockResolvedValue({
      id: 55, orderNumber: "D269-23", subtotal: 203000, tax: 0, total: 203000, status: "placed",
    });
    q.countFoodOrderItems.mockResolvedValue(1);
    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "hostel",
      guestName: "Piyush Midha",
      checkinId: 12,
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, orderId: 55, orderNumber: "D269-23", total: 203000, duplicate: true,
    });
    expect(q.createFoodOrder).not.toHaveBeenCalled();
    expect(q.addFoodOrderItems).not.toHaveBeenCalled();
  });

  it("placeOrderForGuest requires a UUID idempotencyKey", async () => {
    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Ada",
      guestPhone: "9000000000",
      items: [{ menuItemId: 41, quantity: 1 }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "idempotencyKey required" });
    expect(q.createFoodOrder).not.toHaveBeenCalled();
  });

  it("placeOrderForGuest UNIQUE race on the same key returns the existing order", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D269-24");
    q.getFoodOrderByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 88, orderNumber: "D269-23", subtotal: 500, tax: 0, total: 500, status: "placed" });
    q.countFoodOrderItems.mockResolvedValue(1);
    q.createFoodOrder.mockRejectedValueOnce(new Error("UNIQUE constraint failed: food_orders.idempotency_key"));

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Piyush",
      guestPhone: "6201587898",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, orderId: 88, duplicate: true });
    expect(q.addFoodOrderItems).not.toHaveBeenCalled();
  });

  it("placeOrderForGuest staff without place/view food keys gets actionable 403", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timo",
      permissions: { canViewDashboard: true },
    });
    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Piyush",
      guestPhone: "6201587898",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("permission_denied");
    expect(body.requiredPermissions).toEqual(["canPlaceOrders"]);
    expect(body.error).toMatch(/canPlaceOrders/);
    expect(body.howToFix).toMatch(/Management → Users/);
    expect(q.createFoodOrder).not.toHaveBeenCalled();
  });

  it("cancelUnpaidOrder is forbidden for view-only staff", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timo",
      permissions: { canViewFoodOrders: true, canPlaceOrders: true },
    });
    const response = await POST(actionReq("cancelUnpaidOrder", { orderId: 10 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "permission_denied",
      requiredPermissions: ["canVoidFoodOrders"],
    });
    expect(q.updateFoodOrderStatus).not.toHaveBeenCalled();
  });

  it("placeOrderForGuest staff with canPlaceOrders is allowed", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timo",
      permissions: { canPlaceOrders: true },
    });
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D269-25");
    q.createFoodOrder.mockResolvedValue([{ id: 99, orderNumber: "D269-25" }]);
    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Piyush",
      guestPhone: "6201587898",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    }));
    expect(response.status).toBe(200);
    expect(q.createFoodOrder).toHaveBeenCalled();
  });

  it("placeOrderForGuest cancels the header when addFoodOrderItems fails", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getNextOrderNumber.mockResolvedValue("D269-99");
    q.createFoodOrder.mockResolvedValue([{ id: 380, orderNumber: "D269-99", total: 500 }]);
    q.addFoodOrderItems.mockRejectedValueOnce(new Error("D1 write failed"));

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Piyush",
      guestPhone: "6201587898",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/cancelled|line items/i) });
    expect(q.abandonIncompleteFoodOrder).toHaveBeenCalledWith(380, "Admin");
    expect(q.decrementStock).not.toHaveBeenCalled();
  });

  it("placeOrderForGuest heals an incomplete idempotent header when totals match", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 203000, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getFoodOrderByIdempotencyKey.mockResolvedValue({
      id: 380, orderNumber: "D269-23", subtotal: 203000, tax: 0, total: 203000, status: "placed", paymentStatus: "on_tab",
    });
    q.countFoodOrderItems.mockResolvedValue(0);

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "hostel",
      checkinId: 178,
      guestName: "Piyush Midha",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, orderId: 380, healed: true });
    expect(q.addFoodOrderItems).toHaveBeenCalledWith([expect.objectContaining({ orderId: 380, lineTotal: 203000 })]);
    expect(q.createFoodOrder).not.toHaveBeenCalled();
    expect(q.decrementStock).toHaveBeenCalled();
  });

  it("placeOrderForGuest abandons mismatched incomplete orphan instead of healing wrong cart", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getFoodOrderByIdempotencyKey.mockResolvedValue({
      id: 380, orderNumber: "D269-23", subtotal: 203000, tax: 0, total: 203000, status: "placed", paymentStatus: "on_tab", amountPaid: 0,
    });
    q.countFoodOrderItems.mockResolvedValue(0);

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Piyush",
      guestPhone: "6201587898",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "incomplete_food_order", orderId: 380 });
    expect(q.abandonIncompleteFoodOrder).toHaveBeenCalled();
    expect(q.addFoodOrderItems).not.toHaveBeenCalled();
  });

  it("placeOrderForGuest does not abandon a paid incomplete orphan (409 incomplete_food_order)", async () => {
    q.getMenuItemById.mockResolvedValue({
      id: 41, name: "Soap", price: 500, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0,
    });
    q.getSetting.mockResolvedValue("0");
    q.getFoodOrderByIdempotencyKey.mockResolvedValue({
      id: 381,
      orderNumber: "D269-24",
      subtotal: 203000,
      tax: 0,
      total: 203000,
      status: "placed",
      paymentStatus: "paid",
      amountPaid: 203000,
    });
    q.countFoodOrderItems.mockResolvedValue(0);

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Piyush",
      guestPhone: "6201587898",
      items: [{ menuItemId: 41, quantity: 1 }],
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "incomplete_food_order", orderId: 381 });
    expect(q.abandonIncompleteFoodOrder).not.toHaveBeenCalled();
    expect(q.addFoodOrderItems).not.toHaveBeenCalled();
  });

  it("admin Place Order mints one idempotency key until success", async () => {
    const source = await import("fs").then((fs) => fs.readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8"));
    expect(source).toMatch(/useState\(\(\) => crypto\.randomUUID\(\)\)/);
    expect(source).toMatch(/idempotencyKey,/);
    expect(source).toMatch(/setIdempotencyKey\(crypto\.randomUUID\(\)\)/);
    expect(source).toContain("INCOMPLETE_FOOD_ORDER_BANNER");
    expect(source).toContain("Needs pricing");
    expect(source).toContain("!selectedGroup.hasPendingPrice");
  });
});
