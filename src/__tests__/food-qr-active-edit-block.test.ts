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

const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  hasActiveFoodQrClaim: q.hasActiveFoodQrClaim,
  releaseFoodQrForDeskPayment: q.releaseFoodQrForDeskPayment,
  closeActiveFoodQrAttempt: q.closeActiveFoodQrAttempt,
  listFoodQrAttempts: q.listFoodQrAttempts,
  reconcileFoodQrAttempt: q.reconcileFoodQrAttempt,
  ensureActiveFoodQrForOrders: q.ensureActiveFoodQrForOrders,
  getFoodQrAttempt: q.getFoodQrAttempt,
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
  it.each([
    [{ state: "paid" }, "Paid"],
    [{ state: "active", payments: [{ captured: 1 }] }, "Paid"],
    [{ state: "active", payments: [{ captured: true }] }, "Paid"],
    [{ state: "active", payments: [{ captured: 0 }] }, "Active"],
    [{ state: "active" }, "Active"],
    [{ state: "expired" }, "Expired"],
    [{ state: "closed" }, "Closed"],
    [{ state: "creating" }, "Creating"],
    [{ state: "qr_unknown" }, "Creating"],
    [{ state: "weird" }, "Unknown"],
  ])("outcome %# → %j", (input, expected) => {
    expect(foodQrAttemptOutcome(input)).toBe(expected);
  });

  it.each([
    ["active", true],
    ["creating", true],
    ["qr_unknown", true],
    ["paid", false],
    ["expired", false],
    ["closed", false],
    ["loading", false],
  ] as const)("foodQrAttemptIsCloseable(%s) = %s", (state, expected) => {
    expect(foodQrAttemptIsCloseable(state)).toBe(expected);
  });

  it("parses order ids from arrays, JSON strings, and rejects junk", () => {
    expect(parseFoodQrOrderIds("[10,20]")).toEqual([10, 20]);
    expect(parseFoodQrOrderIds([10, "x", -1, 0, 3.5, "7"])).toEqual([10, 7]);
    expect(parseFoodQrOrderIds("not-json")).toEqual([]);
    expect(parseFoodQrOrderIds(null)).toEqual([]);
    expect(parseFoodQrOrderIds(undefined)).toEqual([]);
    expect(parseFoodQrOrderIds("")).toEqual([]);
  });

  it("matches ledger search across guest, phone, order, qr_, pay_, attempt id", () => {
    const row = {
      id: ATTEMPT,
      guestName: "Pawan Dhiran",
      guestPhone: "9876543210",
      qrCodeId: "qr_abc123",
      foodOrderIds: "[68,69]",
      payments: [{ id: "pay_xyz" }, { id: "pay_other" }],
    };
    expect(foodQrAttemptMatchesQuery(row, "")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "  ")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "pawan")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "9876")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "68")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "qr_abc")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "pay_xyz")).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, ATTEMPT.slice(0, 8))).toBe(true);
    expect(foodQrAttemptMatchesQuery(row, "manu")).toBe(false);
    expect(foodQrAttemptMatchesQuery({ guestName: "Pawan" }, "pay_")).toBe(false);
  });
});

describe("active QR blocks mutating food-order actions", () => {
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

  it("voidItem returns 409 when claim exists", async () => {
    const res = await foodOrdersPost(ordersReq("voidItem", {
      orderId: 10,
      orderItemId: 20,
      reason: "oops",
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(ACTIVE_FOOD_QR_EDIT_BLOCKED);
    expect(q.getDb).not.toHaveBeenCalled();
  });

  it("cancelUnpaidOrder returns 409 when claim exists", async () => {
    const res = await foodOrdersPost(ordersReq("cancelUnpaidOrder", { orderId: 10 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(ACTIVE_FOOD_QR_EDIT_BLOCKED);
    expect(q.updateFoodOrderStatus).not.toHaveBeenCalled();
  });

  it("applyDiscount returns 409 when claim exists", async () => {
    const res = await foodOrdersPost(ordersReq("applyDiscount", {
      orderIds: [10],
      discountAmount: 1000,
      reason: "comp",
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(ACTIVE_FOOD_QR_EDIT_BLOCKED);
  });

  it("updatePaymentDetails returns 409 when claim exists", async () => {
    const res = await foodOrdersPost(ordersReq("updatePaymentDetails", {
      orderId: 10,
      paymentStatus: "paid",
      paymentMethod: "cash",
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
    q.closeActiveFoodQrAttempt.mockResolvedValue({ releasedAttemptIds: [ATTEMPT] });
  });

  it("closeActiveFoodQr releases attempt and is staff-allowed via canMarkPaid", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canMarkPaid: true },
    });
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releasedAttemptIds: [ATTEMPT] });
    expect(q.closeActiveFoodQrAttempt).toHaveBeenCalledWith(ATTEMPT);
  });

  it.each([
    { canGenerateFoodBills: true },
    { canViewFoodOrders: true },
  ])("allows staff with %j", async (permissions) => {
    q.authenticateUser.mockResolvedValue({ role: "staff", displayName: "Staff", permissions });
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(res.status).toBe(200);
  });

  it("forbids staff without bill/pay/view permissions", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canEditFoodOrders: true },
    });
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(res.status).toBe(403);
    expect(q.closeActiveFoodQrAttempt).not.toHaveBeenCalled();
  });

  it("rejects invalid attemptId before calling close helper", async () => {
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(q.closeActiveFoodQrAttempt).not.toHaveBeenCalled();
  });

  it("maps FoodQrError from close helper to HTTP status", async () => {
    const { FoodQrError } = await import("@/lib/foodQrPayment");
    q.closeActiveFoodQrAttempt.mockRejectedValue(new FoodQrError("already captured", 409));
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already captured/i);
  });

  it("returns 403 on Pi runtime", async () => {
    q.isPiRuntime.mockReturnValue(true);
    const res = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(res.status).toBe(403);
    expect(q.closeActiveFoodQrAttempt).not.toHaveBeenCalled();
  });

  it("keeps listFoodQrAttempts admin-only while close is staff-OR", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canMarkPaid: true },
    });
    const list = await foodPaymentsPost(paymentsReq("listFoodQrAttempts", { limit: 10 }));
    expect(list.status).toBe(403);
    const close = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(close.status).toBe(200);
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
    expect(ledger).toContain("limit: 100");
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
    expect(ui).toContain("reconcileFoodQrAttempt");
    expect(ui).toContain("ACTIVE_FOOD_QR_EDIT_BLOCKED");
    expect(ui).toContain("Open Bill to Reconcile");
  });

  it("foodQrPayment wires closeActiveFoodQrAttempt through desk release", () => {
    const src = readFileSync("src/lib/foodQrPayment.ts", "utf8");
    expect(src).toContain("export async function closeActiveFoodQrAttempt");
    expect(src).toContain("return releaseFoodQrForDeskPayment(orderIds)");
    expect(src).toContain("Math.min(opts.limit || 100, 100)");
  });
});
