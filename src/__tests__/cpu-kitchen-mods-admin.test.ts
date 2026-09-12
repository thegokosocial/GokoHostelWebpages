import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

const kitchenMocks = vi.hoisted(() => ({
  authenticateKitchen: vi.fn(),
  getActiveFoodOrders: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getMenuItemTagsByIds: vi.fn(),
  getSetting: vi.fn(),
  getAllMenuItems: vi.fn(),
  getActiveMenuCategories: vi.fn(),
  getFoodOrderItems: vi.fn(),
  getOrderModifications: vi.fn(),
  updateFoodOrderStatus: vi.fn(),
  toggleMenuItemAvailability: vi.fn(),
  addOrderModification: vi.fn(),
  updateFoodOrder: vi.fn(),
  updateFoodOrderItemQuantity: vi.fn(),
  deleteFoodOrderItem: vi.fn(),
  setSetting: vi.fn(),
  getUserByUsername: vi.fn(),
  addStock: vi.fn(),
  decrementStock: vi.fn(),
  getMenuItemById: vi.fn(),
  getFoodOrderById: vi.fn(),
  areAllOrderItemsInventory: vi.fn(),
  getMenuItemCategoryExemptions: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateKitchen: kitchenMocks.authenticateKitchen }));
vi.mock("@/db", () => ({ getDb: kitchenMocks.getDb }));
vi.mock("@/db/queries", () => ({
  getActiveFoodOrders: kitchenMocks.getActiveFoodOrders,
  getFoodOrderItemsBatch: kitchenMocks.getFoodOrderItemsBatch,
  getMenuItemTagsByIds: kitchenMocks.getMenuItemTagsByIds,
  getSetting: kitchenMocks.getSetting,
  getAllMenuItems: kitchenMocks.getAllMenuItems,
  getActiveMenuCategories: kitchenMocks.getActiveMenuCategories,
  getFoodOrderItems: kitchenMocks.getFoodOrderItems,
  getOrderModifications: kitchenMocks.getOrderModifications,
  updateFoodOrderStatus: kitchenMocks.updateFoodOrderStatus,
  toggleMenuItemAvailability: kitchenMocks.toggleMenuItemAvailability,
  addOrderModification: kitchenMocks.addOrderModification,
  updateFoodOrder: kitchenMocks.updateFoodOrder,
  updateFoodOrderItemQuantity: kitchenMocks.updateFoodOrderItemQuantity,
  deleteFoodOrderItem: kitchenMocks.deleteFoodOrderItem,
  setSetting: kitchenMocks.setSetting,
  getUserByUsername: kitchenMocks.getUserByUsername,
  addStock: kitchenMocks.addStock,
  decrementStock: kitchenMocks.decrementStock,
  getMenuItemById: kitchenMocks.getMenuItemById,
  getFoodOrderById: kitchenMocks.getFoodOrderById,
  areAllOrderItemsInventory: kitchenMocks.areAllOrderItemsInventory,
  getMenuItemCategoryExemptions: kitchenMocks.getMenuItemCategoryExemptions,
}));

import { POST } from "@/app/api/food/kitchen/route";

const ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

function req(body: unknown) {
  return new NextRequest("http://localhost/api/food/kitchen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Kitchen getOrderModifications workflow", () => {
  beforeEach(() => {
    for (const fn of Object.values(kitchenMocks)) fn.mockReset();
    kitchenMocks.authenticateKitchen.mockResolvedValue({ role: "staff", displayName: "Cook" });
    kitchenMocks.getSetting.mockResolvedValue("false");
    kitchenMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: async () => [] as { id: number; itemName: string }[],
        }),
      }),
    });
  });

  it("401s when authenticateKitchen returns null", async () => {
    kitchenMocks.authenticateKitchen.mockResolvedValue(null);
    const res = await POST(req({ password: "bad", action: "getOrderModifications", orderId: 10 }));
    expect(res.status).toBe(401);
    expect(kitchenMocks.getOrderModifications).not.toHaveBeenCalled();
    expect(kitchenMocks.getAllMenuItems).not.toHaveBeenCalled();
    expect(kitchenMocks.getDb).not.toHaveBeenCalled();
  });

  it("400s getOrderModifications without orderId", async () => {
    const res = await POST(req({ password: "ok", action: "getOrderModifications" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing orderId");
    expect(kitchenMocks.getOrderModifications).not.toHaveBeenCalled();
    expect(kitchenMocks.getAllMenuItems).not.toHaveBeenCalled();
  });

  it("formats modifications using order-line names then the menu name map", async () => {
    kitchenMocks.getOrderModifications.mockResolvedValue([
      { action: "quantity_changed", itemId: 101, oldValue: "2", newValue: "1", modifiedBy: "Cook", createdAt: "2026-08-01T00:00:00Z" },
      { action: "item_added", itemId: 5, oldValue: "", newValue: "1", modifiedBy: "Cook", createdAt: "2026-08-01T00:01:00Z" },
      { action: "item_voided", itemId: 999, oldValue: "active", newValue: "voided", modifiedBy: "Cook", createdAt: "2026-08-01T00:02:00Z" },
      { action: "note", itemId: null, oldValue: "", newValue: "extra spicy", modifiedBy: "Cook", createdAt: "2026-08-01T00:03:00Z" },
    ]);
    kitchenMocks.getAllMenuItems.mockResolvedValue([
      { id: 5, name: "Idli" },
      { id: 101, name: "MenuDosa" },
    ]);
    kitchenMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: async () => [{ id: 101, itemName: "Dosa" }],
        }),
      }),
    });

    const res = await POST(req({ password: "ok", action: "getOrderModifications", orderId: 10 }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(kitchenMocks.getOrderModifications).toHaveBeenCalledWith(10);
    expect(kitchenMocks.getAllMenuItems).toHaveBeenCalledTimes(1);
    expect(kitchenMocks.getDb).toHaveBeenCalledTimes(1);
    expect(json.data.modifications).toEqual([
      { action: "quantity_changed", itemName: "Dosa", oldValue: "2", newValue: "1", modifiedBy: "Cook", createdAt: "2026-08-01T00:00:00Z" },
      { action: "item_added", itemName: "Idli", oldValue: "", newValue: "1", modifiedBy: "Cook", createdAt: "2026-08-01T00:01:00Z" },
      { action: "item_voided", itemName: "Item #999", oldValue: "active", newValue: "voided", modifiedBy: "Cook", createdAt: "2026-08-01T00:02:00Z" },
      { action: "note", itemName: "", oldValue: "", newValue: "extra spicy", modifiedBy: "Cook", createdAt: "2026-08-01T00:03:00Z" },
    ]);
  });
});

describe("Kitchen listOrders modification-count query", () => {
  beforeEach(() => {
    for (const fn of Object.values(kitchenMocks)) fn.mockReset();
    kitchenMocks.authenticateKitchen.mockResolvedValue({ role: "staff", displayName: "Cook" });
    kitchenMocks.getSetting.mockResolvedValue("false");
  });

  it("calls getDb and where() before groupBy when one order is active", async () => {
    kitchenMocks.getActiveFoodOrders.mockResolvedValue([{ id: 10, status: "placed", orderNumber: "K-1" }]);
    kitchenMocks.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [10, [{ id: 1, menuItemId: 5, itemName: "Dosa", itemPrice: 80, quantity: 1, lineTotal: 80, status: "placed" }]],
    ]));
    kitchenMocks.getMenuItemTagsByIds.mockResolvedValue(new Map([[5, '["veg"]']]));

    const chain: string[] = [];
    const groupBy = vi.fn(async () => {
      chain.push("groupBy");
      return [{ orderId: 10, count: 1 }];
    });
    const where = vi.fn(() => {
      chain.push("where");
      return { groupBy };
    });
    kitchenMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({ where }),
      }),
    });

    const res = await POST(req({ password: "ok", action: "listOrders" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(kitchenMocks.getDb).toHaveBeenCalled();
    expect(where).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(chain).toEqual(["where", "groupBy"]);
    expect(kitchenMocks.getMenuItemTagsByIds).toHaveBeenCalledWith([5]);
    expect(kitchenMocks.getAllMenuItems).not.toHaveBeenCalled();
    expect(json.data.orders[0].hasModifications).toBe(true);
  });

  it("does not call getDb when the ticket list is empty", async () => {
    kitchenMocks.getActiveFoodOrders.mockResolvedValue([]);
    kitchenMocks.getFoodOrderItemsBatch.mockResolvedValue(new Map());
    kitchenMocks.getMenuItemTagsByIds.mockResolvedValue(new Map());
    const res = await POST(req({ password: "ok", action: "listOrders" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ orders: [], isBusy: false });
    expect(kitchenMocks.getDb).not.toHaveBeenCalled();
    expect(kitchenMocks.getMenuItemTagsByIds).toHaveBeenCalledWith([]);
    expect(kitchenMocks.getAllMenuItems).not.toHaveBeenCalled();
  });
});

describe("Kitchen bulk status workflow", () => {
  beforeEach(() => {
    for (const fn of Object.values(kitchenMocks)) fn.mockReset();
    kitchenMocks.authenticateKitchen.mockResolvedValue({ role: "staff", displayName: "Cook" });
  });

  it("rejects transitions that do not advance exactly one kitchen stage", async () => {
    const res = await POST(req({ password: "ok", action: "updateStatusBulk", orderIds: [1], status: "cancelled" }));
    expect(res.status).toBe(400);
    expect(kitchenMocks.getFoodOrderById).not.toHaveBeenCalled();
    expect(kitchenMocks.updateFoodOrderStatus).not.toHaveBeenCalled();
  });

  it("updates unique orders still in the expected stage and skips stale orders", async () => {
    kitchenMocks.getFoodOrderById.mockImplementation(async (id: number) =>
      id === 1 ? { id, status: "preparing" } : { id, status: "ready" },
    );

    const res = await POST(req({
      password: "ok",
      action: "updateStatusBulk",
      orderIds: [1, 1, 2],
      status: "ready",
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(kitchenMocks.updateFoodOrderStatus).toHaveBeenCalledTimes(1);
    expect(kitchenMocks.updateFoodOrderStatus).toHaveBeenCalledWith(1, "ready");
    expect(json.data).toEqual({ updated: 1, skipped: 1 });
  });

  it("validates the bulk payload before reading or mutating orders", async () => {
    const res = await POST(req({ password: "ok", action: "updateStatusBulk", orderIds: [1, "2"], status: "served" }));
    expect(res.status).toBe(400);
    expect(kitchenMocks.getFoodOrderById).not.toHaveBeenCalled();
    expect(kitchenMocks.updateFoodOrderStatus).not.toHaveBeenCalled();
  });
});

describe("Admin bookings shell source-scan", () => {
  it("logs in with action auth, fills inventory/bookings viewport, and client-loads BookingDashboard", () => {
    const adminPage = readFile("src/app/admin/page.tsx");
    expect(adminPage).toContain('action: "auth"');
    expect(adminPage).not.toMatch(/action: "list"/);
    expect(adminPage).toMatch(/fillViewport = section === "inventory" \|\| section === "bookings"/);
    expect(adminPage).toMatch(/fillViewport \? "h-dvh" : "min-h-screen"/);
    expect(adminPage).not.toMatch(/framer-motion/);
    expect(adminPage).toMatch(/const BookingDashboard = dynamic\([\s\S]*ssr:\s*false/);
  });

  it("marks the admin layout force-static", () => {
    expect(readFile("src/app/admin/layout.tsx")).toMatch(/export const dynamic = "force-static"/);
  });

  it("loads getAvailableBeds rates once via getAllDailyRates", () => {
    const route = readFile("src/app/api/admin/bookings/route.ts");
    const section = route.match(/action === "getAvailableBeds"[\s\S]*?action === "getBookingHistory"/)?.[0];
    expect(section).toBeTruthy();
    expect(section!.split("getAllDailyRates").length - 1).toBe(1);
    expect(section).toContain("getAllDailyRates(checkinDate, checkinDate)");
    expect(section).not.toMatch(/await getDailyRates\(/);
  });

  it("keeps SiteShell off marketing errors and on the root error page", () => {
    expect(readFile("src/app/(marketing)/error.tsx")).not.toContain("SiteShell");
    expect(readFile("src/app/error.tsx")).toContain("SiteShell");
  });

  it("renders one guarded bulk action for each kitchen stage", () => {
    const kitchen = readFile("src/components/kitchen/KitchenDashboard.tsx");
    expect(kitchen.match(/bulkActionLabel="START ALL"/g)).toHaveLength(2);
    expect(kitchen.match(/bulkActionLabel="MARK ALL READY"/g)).toHaveLength(2);
    expect(kitchen.match(/bulkActionLabel="MARK ALL SERVED"/g)).toHaveLength(2);
    expect(readFile("src/app/api/food/kitchen/route.ts")).toContain('action === "updateStatusBulk"');
  });
});
