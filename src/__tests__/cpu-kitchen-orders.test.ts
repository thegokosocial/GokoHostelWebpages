import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

function req(body: unknown) {
  return new NextRequest("http://localhost/api/food/kitchen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseTags(tagsStr: string): string[] {
  try {
    const parsed = JSON.parse(tagsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

describe("Kitchen listOrders workflows", () => {
  beforeEach(() => {
    for (const fn of Object.values(kitchenMocks)) fn.mockReset();
    kitchenMocks.authenticateKitchen.mockResolvedValue({ role: "staff", displayName: "Cook" });
    kitchenMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => {
          const grouped = { groupBy: async () => [] as { orderId: number; count: number }[] };
          return { ...grouped, where: () => grouped };
        },
      }),
    });
    kitchenMocks.getSetting.mockResolvedValue("false");
  });

  it("401s without listing orders", async () => {
    kitchenMocks.authenticateKitchen.mockResolvedValue(null);
    const res = await POST(req({ password: "bad", action: "listOrders" }));
    expect(res.status).toBe(401);
    expect(kitchenMocks.getActiveFoodOrders).not.toHaveBeenCalled();
  });

  it("authenticates the embedded admin kitchen with the admin session scope", async () => {
    kitchenMocks.authenticateKitchen.mockResolvedValue(null);
    const res = await POST(req({ password: "", scope: "admin", action: "listOrders" }));
    expect(res.status).toBe(401);
    expect(kitchenMocks.authenticateKitchen).toHaveBeenCalledWith("", "admin");
  });

  it("short-circuits tags on an empty ticket list and reports not busy", async () => {
    kitchenMocks.getActiveFoodOrders.mockResolvedValue([]);
    kitchenMocks.getFoodOrderItemsBatch.mockResolvedValue(new Map());
    kitchenMocks.getMenuItemTagsByIds.mockResolvedValue(new Map());
    const res = await POST(req({ password: "ok", action: "listOrders" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ orders: [], isBusy: false });
    expect(kitchenMocks.getMenuItemTagsByIds).toHaveBeenCalledWith([]);
    expect(kitchenMocks.getAllMenuItems).not.toHaveBeenCalled();
    expect(kitchenMocks.getFoodOrderItemsBatch).toHaveBeenCalledTimes(1);
    expect(kitchenMocks.getDb).not.toHaveBeenCalled();
  });

  it("returns old placed orders instead of applying an age cutoff", async () => {
    kitchenMocks.getActiveFoodOrders.mockResolvedValue([{ id: 11, status: "placed", orderNumber: "OLD-1", createdAt: "2024-01-01T00:00:00.000Z" }]);
    kitchenMocks.getFoodOrderItemsBatch.mockResolvedValue(new Map([[11, []]]));
    kitchenMocks.getMenuItemTagsByIds.mockResolvedValue(new Map());
    const res = await POST(req({ password: "ok", action: "listOrders" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.orders).toMatchObject([{ id: 11, status: "placed", createdAt: "2024-01-01T00:00:00.000Z" }]);
  });

  it("dedupes menu ids, skips non-numeric ids, maps tags, and flags modifications", async () => {
    kitchenMocks.getActiveFoodOrders.mockResolvedValue([{ id: 10, status: "placed", orderNumber: "K-1" }]);
    kitchenMocks.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [10, [
        { id: 1, menuItemId: 5, itemName: "Dosa", itemPrice: 80, quantity: 1, lineTotal: 80, status: "placed" },
        { id: 2, menuItemId: 5, itemName: "Dosa", itemPrice: 80, quantity: 1, lineTotal: 80, status: "placed" },
        { id: 3, menuItemId: null, itemName: "Note", itemPrice: 0, quantity: 1, lineTotal: 0, status: "placed" },
        { id: 4, menuItemId: 9, itemName: "Tea", itemPrice: 20, quantity: 1, lineTotal: 20, status: "placed" },
      ]],
    ]));
    kitchenMocks.getMenuItemTagsByIds.mockResolvedValue(new Map([
      [5, '["veg","jain"]'],
    ]));
    kitchenMocks.getDb.mockReturnValue({
      select: () => ({
        from: () => {
          const grouped = { groupBy: async () => [{ orderId: 10, count: 2 }] };
          return { ...grouped, where: () => grouped };
        },
      }),
    });
    kitchenMocks.getSetting.mockResolvedValue("true");

    const res = await POST(req({ password: "ok", action: "listOrders" }));
    const json = await res.json();
    expect(kitchenMocks.getMenuItemTagsByIds).toHaveBeenCalledWith([5, 9]);
    expect(json.data.isBusy).toBe(true);
    expect(json.data.orders[0].hasModifications).toBe(true);
    const items = json.data.orders[0].items;
    expect(parseTags(items[0].tags)).toEqual(["veg", "jain"]);
    expect(parseTags(items[2].tags)).toEqual([]);
    expect(parseTags(items[3].tags)).toEqual([]);
    expect(kitchenMocks.getAllMenuItems).not.toHaveBeenCalled();
  });

  it("treats isBusy as false for any setting other than the string true", async () => {
    kitchenMocks.getActiveFoodOrders.mockResolvedValue([]);
    kitchenMocks.getFoodOrderItemsBatch.mockResolvedValue(new Map());
    kitchenMocks.getMenuItemTagsByIds.mockResolvedValue(new Map());
    kitchenMocks.getSetting.mockResolvedValue("1");
    const json = await (await POST(req({ password: "ok", action: "listOrders" }))).json();
    expect(json.data.isBusy).toBe(false);
  });

  it("still loads the full menu for the sold-out panel", async () => {
    kitchenMocks.getAllMenuItems.mockResolvedValue([{ id: 1, name: "Dosa", isAvailable: 0, tags: "[]", categoryId: 1, nameKannada: "", price: 80 }]);
    kitchenMocks.getActiveMenuCategories.mockResolvedValue([{ id: 1, name: "South", icon: "" }]);
    kitchenMocks.getSetting.mockResolvedValue("false");
    const res = await POST(req({ password: "ok", action: "getMenuItems" }));
    expect(res.status).toBe(200);
    expect(kitchenMocks.getAllMenuItems).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.data.items[0].isAvailable).toBe(0);
  });
});

describe("Kitchen ticket tag parsing", () => {
  it("accepts arrays and ignores invalid payloads", () => {
    expect(parseTags('["veg"]')).toEqual(["veg"]);
    expect(parseTags("[]")).toEqual([]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags("{ \"veg\": true }")).toEqual([]);
    expect(parseTags("not-json")).toEqual([]);
  });
});
