import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(), getFoodOrderById: vi.fn(), getFoodOrderItems: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(), getSetting: vi.fn(), updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(), addAuditEntry: vi.fn(), updateFoodOrderPayment: vi.fn(),
  updateFoodOrderItemQuantity: vi.fn(), deleteFoodOrderItem: vi.fn(), addStock: vi.fn(), decrementStock: vi.fn(),
  restoreStock: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: q.getFoodOrderById, getFoodOrderItems: q.getFoodOrderItems,
  getMenuItemCategoryExemptions: q.getMenuItemCategoryExemptions, getSetting: q.getSetting,
  updateFoodOrder: q.updateFoodOrder, addOrderModification: q.addOrderModification,
  addAuditEntry: q.addAuditEntry, updateFoodOrderPayment: q.updateFoodOrderPayment,
  updateFoodOrderItemQuantity: q.updateFoodOrderItemQuantity, deleteFoodOrderItem: q.deleteFoodOrderItem,
  addStock: q.addStock, decrementStock: q.decrementStock, restoreStock: q.restoreStock,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));

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
    expect(await response.json()).toMatchObject({ subtotal: 90000, tax: 4500, total: 94500 });
    expect(q.updateFoodOrder).toHaveBeenCalledWith(10, { subtotal: 90000, tax: 4500, total: 94500, discount: 0 });
    expect(q.addOrderModification).toHaveBeenCalledWith(expect.objectContaining({ action: "price_finalized", oldValue: "0", newValue: "45000" }));
  });

  it("blocks payment while any active line is still pending", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action: "updatePaymentDetails", orderId: 10, paymentStatus: "paid" }) }));
    expect(response.status).toBe(400);
    expect(q.updateFoodOrderPayment).not.toHaveBeenCalled();
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
});
