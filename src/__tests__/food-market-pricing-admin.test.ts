import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(), getFoodOrderById: vi.fn(), getFoodOrderItems: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(), getSetting: vi.fn(), updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(), addAuditEntry: vi.fn(), updateFoodOrderPayment: vi.fn(), updateFoodOrderStatus: vi.fn(),
  updateFoodOrderItemQuantity: vi.fn(), deleteFoodOrderItem: vi.fn(), addStock: vi.fn(), decrementStock: vi.fn(), decrementStockIfAvailable: vi.fn(),
  restoreStock: vi.fn(),
  createFoodOrder: vi.fn(), addFoodOrderItems: vi.fn(), getNextOrderNumber: vi.fn(), getMenuItemById: vi.fn(),
  dispatchPush: vi.fn(), notificationFoodBody: vi.fn(),
  latestReceiptAccount: vi.fn(), createGuestReceipt: vi.fn(), resolveReceiptAccount: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getDb: vi.fn(),
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
  createFoodOrder: q.createFoodOrder, addFoodOrderItems: q.addFoodOrderItems,
  getNextOrderNumber: q.getNextOrderNumber, getMenuItemById: q.getMenuItemById,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
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
  q.getMenuItemById.mockResolvedValue({ id: 4, name: "Seasonal Fish", trackInventory: 0, stockQuantity: 0 });
  q.updateFoodOrderItemQuantity.mockImplementation(async (id: number, quantity: number, price: number) => Object.assign(pendingItem, { quantity, lineTotal: quantity * price }));
  q.getDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [pendingItem] }) }) }),
    update: () => ({ set: (data: Partial<typeof pendingItem>) => ({ where: async () => Object.assign(pendingItem, data) }) }),
  });
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
    q.createFoodOrder.mockResolvedValue([{ id: 99, orderNumber: "D266-11" }]);
    q.getSetting.mockResolvedValue("0");

    const response = await POST(actionReq("placeOrderForGuest", {
      guestType: "walkin",
      guestName: "Pawan test",
      guestPhone: "123454321",
      items: [{ menuItemId: 41, quantity: 1 }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, orderId: 99, orderNumber: "D266-11", total: 500 });
    expect(q.createFoodOrder).toHaveBeenCalledWith(expect.objectContaining({
      guestName: "Pawan test",
      total: 500,
      paymentStatus: "pending",
      createdBy: "Admin",
    }));
    expect(q.addFoodOrderItems).toHaveBeenCalledWith([expect.objectContaining({
      orderId: 99,
      itemName: "Soap",
      quantity: 1,
      lineTotal: 500,
    })]);
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_order_placed", target: "order:99" }));
  });

  it("finalizes a pending line using quantity and recalculates totals", async () => {
    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 45000 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ subtotal: 90000, tax: 4500, total: 94500, notes: "" });
    expect(q.updateFoodOrder).toHaveBeenCalledWith(10, expect.objectContaining({ subtotal: 90000, tax: 4500, total: 94500, discount: 0, amountPaid: 0, paymentStatus: "pending" }));
    expect(q.addOrderModification).toHaveBeenCalledWith(expect.objectContaining({ action: "price_finalized", oldValue: "0", newValue: "45000" }));
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

  it("preserves a partial payment and charges only the incremental balance", async () => {
    const partialOrder = {
      ...order,
      updatedAt: "2026-09-23T06:00:00.000Z",
      total: 200,
      subtotal: 200,
      tax: 0,
      amountPaid: 100,
      amountRefunded: 0,
      paymentStatus: "partial",
      paymentMethod: "cash",
      paidBy: "Admin",
    };
    const partialItem = {
      id: 20, orderId: 10, menuItemId: 4, itemName: "Shampoo", itemPrice: 100,
      quantity: 2, lineTotal: 200, pricingStatus: "fixed", status: "active", notes: "",
    };
    const updates: Record<string, unknown>[] = [];
    q.getFoodOrderById.mockResolvedValue(partialOrder);
    q.getSetting.mockResolvedValue("0");
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
    q.getDb.mockReturnValue({
      transaction: async (callback: (tx: any) => unknown) => {
        let selectIndex = 0;
        const selectValues = [[], [partialOrder], [partialItem], [{ trackInventory: 0 }]];
        return callback({
          select: () => ({ from: () => ({ where: () => {
            const value = selectValues[selectIndex++] || [];
            return { limit: async () => value, then: (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject) };
          } }) }),
          insert: () => ({ values: async () => undefined }),
          update: () => ({ set: (value: Record<string, unknown>) => {
            updates.push(value);
            return { where: () => ({ returning: async () => [{ id: 10 }] }) };
          } }),
        });
      },
    });

    const response = await POST(actionReq("saveOrderEdits", {
      orderId: 10,
      operationId: "edit-partial-001",
      changes: [{ itemId: 20, quantity: 3 }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, total: 300, refundAmount: 0 });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ total: 300, amountPaid: 100, amountRefunded: 0, paymentStatus: "partial" }),
    ]));
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

  it("rejects an admin quantity increase when tracked stock is exhausted", async () => {
    const trackedItem = { ...pendingItem, itemPrice: 200, quantity: 2, lineTotal: 400, pricingStatus: "fixed" };
    q.getFoodOrderItems.mockResolvedValue([trackedItem]);
    q.getMenuItemById.mockResolvedValue({ id: 4, name: "Shampoo", trackInventory: 1, stockQuantity: 0 });
    q.decrementStockIfAvailable.mockResolvedValue(false);

    const response = await POST(actionReq("updateItemQuantity", {
      orderId: 10, orderItemId: 20, newQuantity: 3,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Shampoo");
    expect(q.updateFoodOrderItemQuantity).not.toHaveBeenCalled();
    expect(q.addOrderModification).not.toHaveBeenCalled();
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

  it("saves multiple staged edits in one idempotent transaction and preserves gross money collected", async () => {
    const currentOrder = {
      ...order,
      updatedAt: "2026-09-23T06:00:00.000Z",
      total: 210,
      subtotal: 200,
      tax: 10,
      amountPaid: 210,
      amountRefunded: 0,
      paymentStatus: "paid",
      paymentMethod: "online",
      paidBy: "Admin",
    };
    const currentItem = {
      id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 100,
      quantity: 2, lineTotal: 200, pricingStatus: "fixed", status: "active", notes: "",
    };
    q.getFoodOrderById.mockResolvedValue(currentOrder);
    q.getSetting.mockResolvedValue("5");
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());

    let savedBatch: Record<string, unknown> | undefined;
    const inserts: Record<string, unknown>[] = [];
    const makeTx = () => {
      let selectIndex = 0;
      const selectValues = [
        savedBatch ? [savedBatch] : [],
        [currentOrder],
        [currentItem],
        [{ trackInventory: 0 }],
      ];
      const select = () => ({
        from: () => ({
          where: () => {
            const value = selectValues[selectIndex++] || [];
            const builder = {
              limit: async () => value,
              then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
            };
            return builder;
          },
        }),
      });
      const insert = () => ({
        values: async (value: Record<string, unknown>) => {
          inserts.push(value);
          if (value.operationId) savedBatch = value;
        },
      });
      const update = () => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ id: 10 }],
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve([]).then(resolve, reject),
          }),
        }),
      });
      return { select, insert, update };
    };
    q.getDb.mockReturnValue({ transaction: async (callback: (tx: ReturnType<typeof makeTx>) => unknown) => callback(makeTx()) });

    const body = {
      orderId: 10,
      operationId: "edit-batch-001",
      changes: [{ itemId: 20, quantity: 3, reason: "Guest added one" }],
    };
    const response = await POST(actionReq("saveOrderEdits", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, duplicate: false, total: 315, refundAmount: 0 });
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: "edit-batch-001", orderId: 10 }),
      expect.objectContaining({ action: "quantity_changed", oldValue: "2", newValue: "3" }),
      expect.objectContaining({ action: "food_order_edited" }),
    ]));

    const retry = await POST(actionReq("saveOrderEdits", body));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ success: true, duplicate: true });
    expect(inserts.filter((value) => value.operationId === "edit-batch-001")).toHaveLength(1);
  });

  it("rejects a staged quantity increase above tracked stock before writing the edit batch", async () => {
    const currentOrder = {
      ...order,
      updatedAt: "2026-09-23T06:00:00.000Z",
      total: 200,
      subtotal: 200,
      tax: 0,
      amountPaid: 0,
      amountRefunded: 0,
      paymentStatus: "pending",
    };
    const currentItem = {
      id: 20, orderId: 10, menuItemId: 4, itemName: "Shampoo", itemPrice: 100,
      quantity: 2, lineTotal: 200, pricingStatus: "fixed", status: "active", notes: "",
    };
    const inserts: Record<string, unknown>[] = [];
    q.getFoodOrderById.mockResolvedValue(currentOrder);
    q.getSetting.mockResolvedValue("0");
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
    (q.getDb as any).__selectCalls = 0;
    q.getDb.mockReturnValue({
      transaction: async (callback: (tx: any) => unknown) => callback({
        select: () => ({ from: () => ({ where: () => ({
          limit: async () => {
            const calls = (q.getDb as any).__selectCalls = ((q.getDb as any).__selectCalls || 0) + 1;
            if (calls === 1) return [];
            if (calls === 2) return [currentOrder];
            return [{ name: "Shampoo", trackInventory: 1, stockQuantity: 0 }];
          },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve([currentItem]).then(resolve, reject),
        }) }) }),
        insert: () => ({ values: async (value: Record<string, unknown>) => { inserts.push(value); } }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 10 }] }) }) }),
      }),
    });

    const response = await POST(actionReq("saveOrderEdits", {
      orderId: 10,
      operationId: "edit-stock-001",
      changes: [{ itemId: 20, quantity: 3 }],
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Shampoo");
    expect(inserts).toHaveLength(0);
  });

  it("requires an exact refund for a paid reduction, then journals the audited refund atomically", async () => {
    const currentOrder = {
      ...order,
      orderNumber: "F-10",
      updatedAt: "2026-09-23T06:00:00.000Z",
      total: 210,
      subtotal: 200,
      tax: 10,
      amountPaid: 210,
      amountRefunded: 0,
      paymentStatus: "paid",
      paymentMethod: "online",
      paidBy: "Admin",
    };
    const currentItem = {
      id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 100,
      quantity: 2, lineTotal: 200, pricingStatus: "fixed", status: "active", notes: "",
    };
    q.getFoodOrderById.mockResolvedValue(currentOrder);
    q.getSetting.mockResolvedValue("5");
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
    q.resolveReceiptAccount.mockResolvedValue(7);
    const inserts: Record<string, unknown>[] = [];
    q.getDb.mockReturnValue({
      transaction: async (callback: (tx: any) => unknown) => {
        let selectIndex = 0;
        const selectValues = [[], [currentOrder], [currentItem], [{ trackInventory: 0 }]];
        return callback({
          select: () => ({ from: () => ({ where: () => {
            const value = selectValues[selectIndex++] || [];
            return { limit: async () => value, then: (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject) };
          } }) }),
          insert: () => ({ values: async (value: Record<string, unknown>) => { inserts.push(value); } }),
          update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 10 }] }) }) }),
        });
      },
    });

    const edit = { orderId: 10, operationId: "edit-reduce-001", changes: [{ itemId: 20, quantity: 1 }] };
    const needsRefund = await POST(actionReq("saveOrderEdits", edit));
    expect(needsRefund.status).toBe(409);
    expect(await needsRefund.json()).toMatchObject({ requiresRefund: true, refundAmount: 105 });
    expect(inserts).toHaveLength(0);

    const saved = await POST(actionReq("saveOrderEdits", {
      ...edit,
      refund: { amountPaise: 105, method: "online", onlineAccountId: 7, operationId: "refund-001", receiptId: "refund-receipt-001", note: "Paid reduction" },
    }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ success: true, total: 105, refundAmount: 105 });
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "refund", amountPaise: 105, onlinePaise: 105, accountId: 7, eventId: "refund-001" }),
      expect.objectContaining({ kind: "refund", amount: -105, accountId: 7, receiptId: "refund-receipt-001" }),
      expect.objectContaining({ action: "food_order_edited_refunded" }),
    ]));
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
});
