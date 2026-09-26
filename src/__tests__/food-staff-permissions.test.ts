import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_FOOD_STAFF_PERMISSION_KEYS,
  ensureDefaultFoodStaffPermissions,
  hasConfiguredFoodStaffPermissions,
  withDefaultFoodStaffPermissions,
} from "@/lib/foodStaffPermissions";
import { actionAllowed } from "@/lib/actionPermissions";
import { readFileSync } from "node:fs";

describe("food staff default permissions", () => {
  it("grants the full Food & Kitchen set when no food keys are configured", () => {
    const granted = withDefaultFoodStaffPermissions({ canViewDashboard: true });
    for (const key of DEFAULT_FOOD_STAFF_PERMISSION_KEYS) {
      expect(granted[key]).toBe(true);
    }
    expect(granted.canViewDashboard).toBe(true);
    expect(granted.canManageFoodSettings).toBe(true);
    expect(granted.canManageMenuItems).toBe(true);
    expect(granted.canManageInventory).toBe(true);
  });

  it("force-grants every food key even when one was explicitly false", () => {
    expect(hasConfiguredFoodStaffPermissions({ canPlaceOrders: false })).toBe(true);
    expect(withDefaultFoodStaffPermissions({ canPlaceOrders: false }).canPlaceOrders).toBe(true);
  });

  it("ensureDefault / grantAll sets every food key to true", () => {
    const ensured = ensureDefaultFoodStaffPermissions({
      canViewFoodOrders: true,
      canPlaceOrders: false,
    });
    expect(ensured.canPlaceOrders).toBe(true);
    expect(ensured.canEditFoodOrders).toBe(true);
    expect(ensured.canVoidFoodOrders).toBe(true);
    expect(ensured.canMarkPaid).toBe(true);
    expect(ensured.canManageMenuItems).toBe(true);
    expect(ensured.canManageFoodSettings).toBe(true);
  });

  it("Users form and createUser/updateUser wire food defaults", () => {
    const usersUi = readFileSync("src/components/admin/ManagementUsers.tsx", "utf8");
    expect(usersUi).toContain("withDefaultFoodStaffPermissions");
    expect(usersUi).toContain("ensureDefaultFoodStaffPermissions");
    const checkins = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    expect(checkins).toContain("ensureDefaultFoodStaffPermissions");
  });

  it("auth and session refresh force-grant the full food set for non-admins", () => {
    const auth = readFileSync("src/lib/auth.ts", "utf8");
    expect(auth).toContain("grantAllFoodStaffPermissions");
    expect(auth).toMatch(/role !== "admin"\) permissions = grantAllFoodStaffPermissions/);
    const sessions = readFileSync("src/lib/authSession.ts", "utf8");
    expect(sessions).toContain("grantAllFoodStaffPermissions");
  });
});

describe("food-orders mutation RBAC is not view-only", () => {
  it("view Food Orders alone cannot place, edit, void, or cancel", () => {
    const viewOnly = { canViewFoodOrders: true };
    expect(actionAllowed("staff", viewOnly, "canPlaceOrders")).toBe("forbidden");
    expect(actionAllowed("staff", viewOnly, "canEditFoodOrders")).toBe("forbidden");
    expect(actionAllowed("staff", viewOnly, "canVoidFoodOrders")).toBe("forbidden");
  });

  it("route ACTION_PERMISSIONS require dedicated mutation keys", () => {
    const route = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    expect(route).toContain('placeOrderForGuest: "canPlaceOrders"');
    expect(route).toContain('cancelUnpaidOrder: "canVoidFoodOrders"');
    expect(route).toContain('voidItem: "canVoidFoodOrders"');
    expect(route).toContain('saveOrderEdits: "canEditFoodOrders"');
    expect(route).not.toMatch(/placeOrderForGuest:\s*\["canPlaceOrders",\s*"canViewFoodOrders"\]/);
  });

  it("Order Summary edit/cancel UI keys match dedicated perms", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toContain('hasPermission(role || "staff", permissions || {}, "canEditFoodOrders")');
    expect(ui).toContain('hasPermission(role || "staff", permissions || {}, "canVoidFoodOrders")');
  });
});

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getFoodOrderByIdempotencyKey: vi.fn(),
  getMenuItemById: vi.fn(),
  getSetting: vi.fn(),
  getNextOrderNumber: vi.fn(),
  createFoodOrder: vi.fn(),
  addFoodOrderItems: vi.fn(),
  countFoodOrderItems: vi.fn(),
  abandonIncompleteFoodOrder: vi.fn(),
  decrementStock: vi.fn(),
  updateFoodOrderStatus: vi.fn(),
  addAuditEntry: vi.fn(),
  addOrderModification: vi.fn(),
  dispatchPush: vi.fn(),
  notificationFoodBody: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getFoodOrderByIdempotencyKey: q.getFoodOrderByIdempotencyKey,
  getMenuItemById: q.getMenuItemById,
  getSetting: q.getSetting,
  getNextOrderNumber: q.getNextOrderNumber,
  createFoodOrder: q.createFoodOrder,
  addFoodOrderItems: q.addFoodOrderItems,
  countFoodOrderItems: q.countFoodOrderItems,
  abandonIncompleteFoodOrder: q.abandonIncompleteFoodOrder,
  decrementStock: q.decrementStock,
  updateFoodOrderStatus: q.updateFoodOrderStatus,
  addAuditEntry: q.addAuditEntry,
  addOrderModification: q.addOrderModification,
  getFoodOrderById: vi.fn(),
  getFoodOrderItems: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getActiveFoodOrders: vi.fn(),
  restoreStock: vi.fn(),
  areAllOrderItemsInventory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: q.authenticateUser,
}));

vi.mock("@/lib/pushNotify", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pushNotify")>(),
  dispatchPush: q.dispatchPush,
  notificationFoodBody: q.notificationFoodBody,
}));

import { POST as foodOrdersPost } from "@/app/api/admin/food-orders/route";

function placeReq(perms: Record<string, boolean>) {
  q.authenticateUser.mockResolvedValue({ role: "staff", displayName: "Staff", permissions: perms });
  return new NextRequest("http://localhost/api/admin/food-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "pw",
      action: "placeOrderForGuest",
      guestType: "walkin",
      guestName: "Ada",
      guestPhone: "9000000000",
      items: [{ menuItemId: 1, quantity: 1 }],
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
  });
}

describe("placeOrderForGuest staff permission gate (API)", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.dispatchPush.mockResolvedValue(undefined);
    q.notificationFoodBody.mockReturnValue("body");
    q.getFoodOrderByIdempotencyKey.mockResolvedValue(null);
    q.countFoodOrderItems.mockResolvedValue(1);
    q.getSetting.mockResolvedValue("0");
    q.getMenuItemById.mockResolvedValue({
      id: 1, name: "Thali", price: 10000, priceOnRequest: 0, trackInventory: 0, stockQuantity: 0, isAvailable: 1,
    });
  });

  it("403s when staff only has canViewFoodOrders", async () => {
    const res = await foodOrdersPost(placeReq({ canViewFoodOrders: true }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("permission_denied");
    expect(body.requiredPermissions).toEqual(["canPlaceOrders"]);
    expect(q.createFoodOrder).not.toHaveBeenCalled();
  });

  it("allows place when staff has canPlaceOrders", async () => {
    q.getNextOrderNumber.mockResolvedValue("D1");
    q.createFoodOrder.mockResolvedValue([{ id: 1, orderNumber: "D1", total: 10000 }]);
    q.addFoodOrderItems.mockResolvedValue(undefined);
    q.decrementStock.mockResolvedValue(undefined);
    const res = await foodOrdersPost(placeReq({ canPlaceOrders: true }));
    expect(res.status).toBe(200);
    expect(q.createFoodOrder).toHaveBeenCalled();
  });
});
