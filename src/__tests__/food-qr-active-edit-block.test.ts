import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import {
  ACTIVE_FOOD_QR_EDIT_BLOCKED,
  foodQrAttemptIsCloseable,
  foodQrAttemptMatchesQuery,
  foodQrAttemptOutcome,
  parseFoodQrOrderIds,
} from "@/lib/foodBillQrUi";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getFoodOrderById: vi.fn(),
  getFoodOrderItems: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(),
  getSetting: vi.fn(),
  updateFoodOrder: vi.fn(),
  addOrderModification: vi.fn(),
  addAuditEntry: vi.fn(),
  updateFoodOrderPayment: vi.fn(),
  updateFoodOrderStatus: vi.fn(),
  updateFoodOrderItemQuantity: vi.fn(),
  deleteFoodOrderItem: vi.fn(),
  addStock: vi.fn(),
  decrementStock: vi.fn(),
  decrementStockIfAvailable: vi.fn(),
  restoreStock: vi.fn(),
  getMenuItemById: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getDb: vi.fn(),
  hasActiveFoodQrClaim: vi.fn(),
  releaseFoodQrForDeskPayment: vi.fn(),
  closeActiveFoodQrAttempt: vi.fn(),
  listFoodQrAttempts: vi.fn(),
  reconcileFoodQrAttempt: vi.fn(),
  ensureActiveFoodQrForOrders: vi.fn(),
  getFoodQrAttempt: vi.fn(),
  isPiRuntime: vi.fn(() => false),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: q.getFoodOrderById,
  getFoodOrderItems: q.getFoodOrderItems,
  getMenuItemCategoryExemptions: q.getMenuItemCategoryExemptions,
  getSetting: q.getSetting,
  updateFoodOrder: q.updateFoodOrder,
  addOrderModification: q.addOrderModification,
  addAuditEntry: q.addAuditEntry,
  updateFoodOrderPayment: q.updateFoodOrderPayment,
  updateFoodOrderStatus: q.updateFoodOrderStatus,
  updateFoodOrderItemQuantity: q.updateFoodOrderItemQuantity,
  deleteFoodOrderItem: q.deleteFoodOrderItem,
  addStock: q.addStock,
  decrementStock: q.decrementStock,
  decrementStockIfAvailable: q.decrementStockIfAvailable,
  restoreStock: q.restoreStock,
  getMenuItemById: q.getMenuItemById,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/foodQrPayment", () => ({
  hasActiveFoodQrClaim: (...args: unknown[]) => q.hasActiveFoodQrClaim(...args),
  releaseFoodQrForDeskPayment: (...args: unknown[]) => q.releaseFoodQrForDeskPayment(...args),
  closeActiveFoodQrAttempt: (...args: unknown[]) => q.closeActiveFoodQrAttempt(...args),
  listFoodQrAttempts: (...args: unknown[]) => q.listFoodQrAttempts(...args),
  reconcileFoodQrAttempt: (...args: unknown[]) => q.reconcileFoodQrAttempt(...args),
  ensureActiveFoodQrForOrders: (...args: unknown[]) => q.ensureActiveFoodQrForOrders(...args),
  getFoodQrAttempt: (...args: unknown[]) => q.getFoodQrAttempt(...args),
  FoodQrError: class FoodQrError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.name = "FoodQrError";
      this.status = status;
    }
  },
}));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => q.isPiRuntime() }));
vi.mock("@/lib/guestReceipts", () => ({
  latestReceiptAccount: vi.fn(),
  createGuestReceipt: vi.fn(),
  receiptBusinessDate: vi.fn(() => "2026-09-27"),
  resolveReceiptAccount: vi.fn(),
}));
vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: vi.fn(),
  notificationFoodBody: vi.fn(),
}));

import { POST as foodOrdersPost } from "@/app/api/admin/food-orders/route";
import { POST as foodPaymentsPost } from "@/app/api/admin/food-payments/route";

const order = {
  id: 10,
  orderNumber: "F-10",
  status: "placed",
  paymentStatus: "pending",
  discount: 0,
  total: 200,
  subtotal: 200,
  tax: 0,
  amountPaid: 0,
};
const item = {
  id: 20,
  orderId: 10,
  menuItemId: 4,
  itemName: "Shampoo",
  itemPrice: 200,
  quantity: 1,
  lineTotal: 200,
  pricingStatus: "priced",
  status: "active",
};

function ordersReq(action: string, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/food-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action, ...body }),
  });
}

function paymentsReq(action: string, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/food-payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action, ...body }),
  });
}

describe("foodQrAttemptOutcome + search helpers", () => {
  it("derives Room-like outcomes", () => {
    expect(foodQrAttemptOutcome({ state: "paid" })).toBe("Paid");
    expect(foodQrAttemptOutcome({ state: "active", payments: [{ captured: 1 }] })).toBe("Paid");
    expect(foodQrAttemptOutcome({ state: "active" })).toBe("Active");
    expect(foodQrAttemptOutcome({ state: "expired" })).toBe("Expired");
    expect(foodQrAttemptOutcome({ state: "closed" })).toBe("Closed");
    expect(foodQrAttemptOutcome({ state: "creating" })).toBe("Creating");
    expect(foodQrAttemptIsCloseable("active")).toBe(true);
    expect(foodQrAttemptIsCloseable("paid")).toBe(false);
  });

  it("parses order ids and matches ledger search", () => {
    expect(parseFoodQrOrderIds("[10,20]")).toEqual([10, 20]);
    expect(parseFoodQrOrderIds([10, "x"])).toEqual([10]);
    expect(foodQrAttemptMatchesQuery({
      guestName: "Pawan",
      guestPhone: "123",
      qrCodeId: "qr_abc",
      foodOrderIds: "[68]",
      payments: [{ id: "pay_xyz" }],
    }, "pay_xyz")).toBe(true);
    expect(foodQrAttemptMatchesQuery({ guestName: "Pawan" }, "manu")).toBe(false);
  });
});

describe("active QR blocks saveOrderEdits / updateItemQuantity", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.isPiRuntime.mockReturnValue(false);
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getFoodOrderById.mockResolvedValue(order);
    q.getFoodOrderItems.mockResolvedValue([item]);
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
    q.getSetting.mockResolvedValue("0");
    q.getMenuItemById.mockResolvedValue({ id: 4, trackInventory: 0 });
    q.hasActiveFoodQrClaim.mockResolvedValue(true);
  });

  it("saveOrderEdits returns 409 with ACTIVE_FOOD_QR_EDIT_BLOCKED when claim exists", async () => {
    const res = await foodOrdersPost(ordersReq("saveOrderEdits", {
      orderId: 10,
      operationId: "11111111-1111-4111-8111-111111111111",
      changes: [{ itemId: 20, quantity: 2 }],
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: ACTIVE_FOOD_QR_EDIT_BLOCKED });
    expect(q.hasActiveFoodQrClaim).toHaveBeenCalledWith([10]);
    expect(q.updateFoodOrderItemQuantity).not.toHaveBeenCalled();
  });

  it("updateItemQuantity returns 409 when claim exists", async () => {
    const res = await foodOrdersPost(ordersReq("updateItemQuantity", {
      orderId: 10,
      orderItemId: 20,
      newQuantity: 3,
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(ACTIVE_FOOD_QR_EDIT_BLOCKED);
  });

  it("scopes claim check to the edited order id; no claim ⇒ not 409", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, id: 11 });
    q.hasActiveFoodQrClaim.mockResolvedValue(true);
    const blocked = await foodOrdersPost(ordersReq("saveOrderEdits", {
      orderId: 11,
      operationId: "22222222-2222-4222-8222-222222222222",
      changes: [{ itemId: 20, quantity: 2 }],
    }));
    expect(blocked.status).toBe(409);
    expect(q.hasActiveFoodQrClaim).toHaveBeenCalledWith([11]);

    q.hasActiveFoodQrClaim.mockResolvedValue(false);
    q.getFoodOrderItems.mockResolvedValue([]);
    const open = await foodOrdersPost(ordersReq("updateItemQuantity", {
      orderId: 11,
      orderItemId: 20,
      newQuantity: 2,
    }));
    expect(open.status).toBe(404);
    expect(q.hasActiveFoodQrClaim).toHaveBeenLastCalledWith([11]);
  });
});

describe("closeActiveFoodQr admin action", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.isPiRuntime.mockReturnValue(false);
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.closeActiveFoodQrAttempt.mockResolvedValue({ releasedAttemptIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] });
  });

  it("closeActiveFoodQr releases attempt and is staff-allowed via canMarkPaid", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canMarkPaid: true },
    });
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", {
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      releasedAttemptIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    });
    expect(q.closeActiveFoodQrAttempt).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});

describe("wiring: ledger columns + kitchen reject + admin banner", () => {
  it("FoodPaymentsLedger exposes Room-like columns and Close QR", () => {
    const ledger = readFileSync("src/components/admin/FoodPaymentsLedger.tsx", "utf8");
    expect(ledger).toContain("Outcome");
    expect(ledger).toContain("Orders");
    expect(ledger).toContain("QR / payments");
    expect(ledger).toContain("closeActiveFoodQr");
    expect(ledger).toContain("Close QR");
    expect(ledger).toContain("Reconcile");
    expect(ledger).toContain("foodQrAttemptOutcome");
  });

  it("kitchen updateItemQuantity rejects active QR claims", () => {
    const kitchen = readFileSync("src/app/api/food/kitchen/route.ts", "utf8");
    expect(kitchen).toContain("hasActiveFoodQrClaim");
    expect(kitchen).toContain("ACTIVE_FOOD_QR_EDIT_BLOCKED");
  });

  it("AdminFoodOrders banners Close QR and uses ACTIVE_FOOD_QR_EDIT_BLOCKED", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toContain("Active Razorpay QR locks");
    expect(ui).toContain("closeActiveFoodQr");
    expect(ui).toContain("ACTIVE_FOOD_QR_EDIT_BLOCKED");
  });
});
