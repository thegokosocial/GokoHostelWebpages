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

describe("release before mutate (dynamic QR = static ops)", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.isPiRuntime.mockReturnValue(false);
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getFoodOrderById.mockResolvedValue(order);
    q.getFoodOrderItems.mockResolvedValue([item]);
    q.getMenuItemCategoryExemptions.mockResolvedValue(new Map());
    q.getSetting.mockResolvedValue("0");
    q.getMenuItemById.mockResolvedValue({ id: 4, trackInventory: 0 });
    q.releaseFoodQrForDeskPayment.mockResolvedValue({ releasedAttemptIds: [ATTEMPT] });
    q.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    });
  });

  it.each([
    ["saveOrderEdits", {
      orderId: 10,
      operationId: "11111111-1111-4111-8111-111111111111",
      changes: [{ itemId: 20, quantity: 2 }],
    }, [10]],
    ["updateItemQuantity", { orderId: 10, orderItemId: 20, newQuantity: 3 }, [10]],
    ["setFoodOrderItemPrice", { orderId: 10, orderItemId: 20, price: 300 }, [10]],
    ["voidItem", { orderId: 10, orderItemId: 20, reason: "oops" }, [10]],
    ["cancelUnpaidOrder", { orderId: 10 }, [10]],
    ["applyDiscount", { orderIds: [10], discountAmount: 1000, reason: "comp" }, [10]],
    ["removeDiscount", { orderIds: [10] }, [10]],
    ["reassignOrder", { orderId: 10, checkinId: 1 }, [10]],
    ["updatePaymentDetails", { orderId: 10, paymentStatus: "paid", paymentMethod: "cash" }, [10]],
  ] as const)("%s releases open QR then continues (not ACTIVE_FOOD_QR_EDIT_BLOCKED)", async (action, body, orderIds) => {
    const res = await foodOrdersPost(ordersReq(action, { ...body }));
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([...orderIds]);
    const data = await res.json().catch(() => ({}));
    expect(data.error).not.toBe(ACTIVE_FOOD_QR_EDIT_BLOCKED);
    expect(String(data.error || "")).not.toMatch(/active Razorpay QR payment/i);
  });

  it("updateItemQuantity succeeds after release (qty change applies)", async () => {
    q.updateFoodOrderItemQuantity.mockResolvedValue(undefined);
    q.updateFoodOrder.mockResolvedValue(undefined);
    q.addOrderModification.mockResolvedValue(undefined);
    const res = await foodOrdersPost(ordersReq("updateItemQuantity", {
      orderId: 10,
      orderItemId: 20,
      newQuantity: 3,
    }));
    expect(res.status).toBe(200);
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([10]);
    expect(q.updateFoodOrderItemQuantity).toHaveBeenCalled();
  });

  it("capture race aborts mutator before domain work", async () => {
    const { FoodQrError } = await import("@/lib/foodQrPayment");
    q.releaseFoodQrForDeskPayment.mockRejectedValue(new FoodQrError("Already paid via Razorpay", 409));
    const res = await foodOrdersPost(ordersReq("saveOrderEdits", {
      orderId: 10,
      operationId: "11111111-1111-4111-8111-111111111111",
      changes: [{ itemId: 20, quantity: 2 }],
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Already paid via Razorpay/i);
    expect(q.updateFoodOrderItemQuantity).not.toHaveBeenCalled();
  });

  it("scopes release to the edited order id", async () => {
    q.getFoodOrderById.mockResolvedValue({ ...order, id: 11 });
    q.getFoodOrderItems.mockResolvedValue([]);
    await foodOrdersPost(ordersReq("updateItemQuantity", {
      orderId: 11,
      orderItemId: 20,
      newQuantity: 2,
    }));
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([11]);
  });

  it("no open QR (empty release) still allows mutators", async () => {
    q.releaseFoodQrForDeskPayment.mockResolvedValue({ releasedAttemptIds: [] });
    q.getFoodOrderItems.mockResolvedValue([]);
    const res = await foodOrdersPost(ordersReq("updateItemQuantity", {
      orderId: 10,
      orderItemId: 20,
      newQuantity: 2,
    }));
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([10]);
    expect(res.status).toBe(404);
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
    const list = await foodPaymentsPost(paymentsReq("listFoodQrAttempts", { page: 1, query: "x" }));
    expect(list.status).toBe(403);
    const close = await foodPaymentsPost(paymentsReq("closeActiveFoodQr", { attemptId: ATTEMPT }));
    expect(close.status).toBe(200);
  });
});

describe("wiring: ledger + kitchen release + admin Static-parity UX", () => {
  it("FoodPaymentsLedger exposes Room-like columns, open-only Reconcile, and order collapse", () => {
    const ledger = readFileSync("src/components/admin/FoodPaymentsLedger.tsx", "utf8");
    expect(ledger).toContain("Outcome");
    expect(ledger).toContain("Orders");
    expect(ledger).toContain("QR / payments");
    expect(ledger).toContain("closeActiveFoodQr");
    expect(ledger).toContain("Retire QR");
    expect(ledger).toContain("Reconcile");
    expect(ledger).toContain("foodQrAttemptOutcome");
    expect(ledger).toContain("foodQrAttemptCanReconcile");
    expect(ledger).toContain("formatFoodQrOrderIdsPreview");
    expect(ledger).toContain("+{hiddenCount} more");
    expect(ledger).toContain("DateRangePicker");
    expect(ledger).toContain("fromDate");
    expect(ledger).toContain("toDate");
    expect(ledger).toContain("25 entries per page");
    expect(ledger).toContain("canReconcile &&");
  });

  it("kitchen updateItemQuantity releases open QR before qty change", () => {
    const kitchen = readFileSync("src/app/api/food/kitchen/route.ts", "utf8");
    expect(kitchen).toContain("releaseFoodQrForDeskPayment");
    expect(kitchen).not.toContain("ACTIVE_FOOD_QR_EDIT_BLOCKED");
    expect(kitchen).not.toContain("hasActiveFoodQrClaim");
  });

  it("AdminFoodOrders unlocks Save; Retire optional; no edit lock banner", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).not.toContain("locks Save changes");
    expect(ui).not.toContain("Active Razorpay QR locks");
    expect(ui).not.toContain("foodBillQrUiLocksEdits");
    expect(ui).not.toContain("ACTIVE_FOOD_QR_EDIT_BLOCKED");
    expect(ui).toContain("Editing totals retires this unpaid QR automatically");
    expect(ui).toContain("closeActiveFoodQr");
    expect(ui).toContain("reconcileFoodQrAttempt");
    expect(ui).toContain("Retire QR");
    expect(ui).toContain("foodBillQrRetireAttemptId");
    expect(ui).toContain("disabled={actionBusy === `save_${order.id}`}");
  });

  it("food-orders route uses releaseFoodQrOrConflict; no rejectIfActiveFoodQr", () => {
    const route = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    expect(route).toContain("releaseFoodQrOrConflict");
    expect(route).toContain("releaseFoodQrForDeskPayment");
    expect(route).not.toContain("rejectIfActiveFoodQr");
    expect(route).not.toContain("ACTIVE_FOOD_QR_EDIT_BLOCKED");
  });

  it("foodQrPayment wires Retire via finalizeOpenFoodQrAttempt + desk release", () => {
    const src = readFileSync("src/lib/foodQrPayment.ts", "utf8");
    expect(src).toContain("export async function closeActiveFoodQrAttempt");
    expect(src).toContain("export async function retireAllOpenFoodQrAttempts");
    expect(src).toContain("return releaseFoodQrForDeskPayment(orderIds)");
    expect(src).toContain("finalizeOpenFoodQrAttempt");
    expect(src).toContain('finalizeOpenFoodQrAttempt(existing.attemptId, "expired")');
    expect(src).toContain("FOOD_QR_LIST_PAGE_SIZE");
    expect(src).toContain("foodQrCreatedAtBounds");
  });

  it("Bill Settings updateFoodSettings retires open QRs when switching to static", () => {
    const route = readFileSync("src/app/api/admin/food/route.ts", "utf8");
    const bill = readFileSync("src/components/admin/AdminBillSettings.tsx", "utf8");
    expect(route).toContain("shouldRetireOpenFoodQrsOnModeChange");
    expect(route).toContain("retireAllOpenFoodQrAttempts");
    expect(route).toContain("retiredFoodQrAttemptIds");
    expect(bill).toContain("Saving Static closes any open Razorpay bill QRs");
    expect(bill).toContain("retiredFoodQrAttemptIds");
  });
});
