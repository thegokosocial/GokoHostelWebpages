import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(), getFoodOrderById: vi.fn(), getFoodOrderItems: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(), getSetting: vi.fn(), updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(), addAuditEntry: vi.fn(), updateFoodOrderPayment: vi.fn(), updateFoodOrderStatus: vi.fn(),
  updateFoodOrderItemQuantity: vi.fn(), deleteFoodOrderItem: vi.fn(), addStock: vi.fn(), decrementStock: vi.fn(),
  restoreStock: vi.fn(),
  latestReceiptAccount: vi.fn(), createGuestReceipt: vi.fn(), resolveReceiptAccount: vi.fn(),
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
  addStock: q.addStock, decrementStock: q.decrementStock, restoreStock: q.restoreStock,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/guestReceipts", () => ({ latestReceiptAccount: q.latestReceiptAccount, createGuestReceipt: q.createGuestReceipt, receiptBusinessDate: vi.fn(() => "2026-09-22"), resolveReceiptAccount: q.resolveReceiptAccount }));

import { POST } from "@/app/api/admin/food-orders/route";

const order = { id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "pending", discount: 0, total: 0 };
const pendingItem = { id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 0, quantity: 2, lineTotal: 0, pricingStatus: "pending", status: "active" };

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "setFoodOrderItemPrice", ...body }) });
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
  q.updateFoodOrderItemQuantity.mockImplementation(async (id: number, quantity: number, price: number) => Object.assign(pendingItem, { quantity, lineTotal: quantity * price }));
  q.getDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [pendingItem] }) }) }),
    update: () => ({ set: (data: Partial<typeof pendingItem>) => ({ where: async () => Object.assign(pendingItem, data) }) }),
  });
});

describe("admin market-pricing workflows", () => {
  it("finalizes a pending line using quantity and recalculates totals", async () => {
    const response = await POST(req({ orderId: 10, orderItemId: 20, price: 45000 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ subtotal: 90000, tax: 4500, total: 94500, notes: "" });
    expect(q.updateFoodOrder).toHaveBeenCalledWith(10, { subtotal: 90000, tax: 4500, total: 94500, discount: 0 });
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

  it("reopens a paid order after a quantity edit and reverses its online receipt", async () => {
    const paidOrder = {
      ...order,
      paymentStatus: "paid",
      paymentMethod: "online",
      total: 10000,
      cashReceived: 0,
      changeGiven: 0,
      checkinId: null,
    };
    const paidItem = { id: 20, orderId: 10, menuItemId: 4, itemName: "Seasonal Fish", itemPrice: 5000, quantity: 2, lineTotal: 10000, pricingStatus: "fixed", status: "active" };
    q.getFoodOrderById.mockResolvedValue(paidOrder);
    q.getFoodOrderItems.mockResolvedValue([paidItem]);
    q.latestReceiptAccount.mockResolvedValue(7);

    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "updateItemQuantity", orderId: 10, orderItemId: 20, newQuantity: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(q.updateFoodOrder).toHaveBeenCalledWith(10, expect.objectContaining({ paymentStatus: "pending", paymentMethod: "", cashReceived: 0, changeGiven: 0 }));
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 10, kind: "reversal", accountId: 7, amount: -10000 }));
    expect(q.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "food_payment_reopened", target: "order:10" }));
  });
});
