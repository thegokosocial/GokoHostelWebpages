import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

const q = vi.hoisted(() => ({
  getActiveMenuCategories: vi.fn(),
  getAvailableMenuItems: vi.fn(),
  getAllMenuItems: vi.fn(),
  getSetting: vi.fn(),
  getFoodOrderByIdempotencyKey: vi.fn(),
  getMenuItemById: vi.fn(),
  getGuestTabTotal: vi.fn(),
  getNextOrderNumber: vi.fn(),
  createFoodOrder: vi.fn(),
  addFoodOrderItems: vi.fn(),
  getActiveCheckins: vi.fn(),
  getRecentlyCheckedOutGuests: vi.fn(),
  decrementStock: vi.fn(),
  updateFoodOrderStatus: vi.fn(),
  getFoodOrderByNumber: vi.fn(),
  getFoodOrderItems: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  getGuestAllFoodOrders: vi.fn(),
  dispatchPush: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getActiveMenuCategories: q.getActiveMenuCategories,
  getAvailableMenuItems: q.getAvailableMenuItems,
  getAllMenuItems: q.getAllMenuItems,
  getSetting: q.getSetting,
  getFoodOrderByIdempotencyKey: q.getFoodOrderByIdempotencyKey,
  getMenuItemById: q.getMenuItemById,
  getGuestTabTotal: q.getGuestTabTotal,
  getNextOrderNumber: q.getNextOrderNumber,
  createFoodOrder: q.createFoodOrder,
  addFoodOrderItems: q.addFoodOrderItems,
  getActiveCheckins: q.getActiveCheckins,
  getRecentlyCheckedOutGuests: q.getRecentlyCheckedOutGuests,
  decrementStock: q.decrementStock,
  updateFoodOrderStatus: q.updateFoodOrderStatus,
  getFoodOrderByNumber: q.getFoodOrderByNumber,
  getFoodOrderItems: q.getFoodOrderItems,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
  getGuestAllFoodOrders: q.getGuestAllFoodOrders,
}));

vi.mock("@/lib/pushNotify", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pushNotify")>(),
  dispatchPush: q.dispatchPush,
}));

import { GET as getMenu } from "@/app/api/food/menu/route";
import { POST as postOrder } from "@/app/api/food/order/route";
import { GET as getStatus } from "@/app/api/food/status/route";

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_HOURS = "08:00-15:00,18:00-23:30";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

function mockSettings(overrides: Record<string, string | null> = {}) {
  q.getSetting.mockImplementation(async (key: string) => {
    const defaults: Record<string, string | null> = {
      food_show_out_of_stock: "false",
      food_kitchen_hours: "00:00-23:59",
      food_kitchen_busy: "false",
      food_tax_rate: "5",
      food_kitchen_whatsapp: "",
      food_customer_whatsapp: "true",
      food_checkout_grace_days: "10",
      food_tab_limit: "0",
      food_confirm_with_guest: "false",
    };
    return key in overrides ? overrides[key] : (defaults[key] ?? null);
  });
}

function orderReq(body: unknown) {
  return new NextRequest("http://localhost/api/food/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function statusReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/food/status");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const validOrder = {
  guestName: "Ada",
  items: [{ menuItemId: 1, quantity: 1 }],
};

describe("GET /api/food/menu", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.dispatchPush.mockResolvedValue(undefined);
    q.getActiveMenuCategories.mockResolvedValue([{ id: 1, name: "South" }]);
    q.getAvailableMenuItems.mockResolvedValue([{ id: 1, name: "Dosa", isAvailable: 1 }]);
    q.getAllMenuItems.mockResolvedValue([
      { id: 1, name: "Dosa", isAvailable: 1 },
      { id: 2, name: "Idli", isAvailable: 0 },
    ]);
    mockSettings();
  });

  it("loads available items when show_out_of_stock is not true", async () => {
    mockSettings({ food_show_out_of_stock: "false" });
    const res = await getMenu();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.settings.showOutOfStock).toBe(false);
    expect(json.items).toEqual([{ id: 1, name: "Dosa", isAvailable: 1 }]);
    expect(q.getAvailableMenuItems).toHaveBeenCalledTimes(1);
    expect(q.getAllMenuItems).not.toHaveBeenCalled();
  });

  it("loads the full menu when show_out_of_stock is true", async () => {
    mockSettings({ food_show_out_of_stock: "true" });
    const res = await getMenu();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.settings.showOutOfStock).toBe(true);
    expect(json.items).toHaveLength(2);
    expect(q.getAllMenuItems).toHaveBeenCalledTimes(1);
    expect(q.getAvailableMenuItems).not.toHaveBeenCalled();
  });

  it("sets isBusy only when food_kitchen_busy is the string true", async () => {
    mockSettings({ food_kitchen_busy: "true" });
    const busy = await (await getMenu()).json();
    expect(busy.settings.isBusy).toBe(true);

    mockSettings({ food_kitchen_busy: "1" });
    const notBusy = await (await getMenu()).json();
    expect(notBusy.settings.isBusy).toBe(false);
  });

  it("defaults kitchenHours when the setting is null", async () => {
    mockSettings({ food_kitchen_hours: null });
    const json = await (await getMenu()).json();
    expect(json.settings.kitchenHours).toBe(DEFAULT_HOURS);
  });

  it("returns taxRate 0 when food_tax_rate is 0", async () => {
    mockSettings({ food_tax_rate: "0" });
    const json = await (await getMenu()).json();
    expect(json.settings.taxRate).toBe(0);
  });
});

describe("POST /api/food/order", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.dispatchPush.mockResolvedValue(undefined);
    q.getFoodOrderByIdempotencyKey.mockResolvedValue(null);
    q.getActiveCheckins.mockResolvedValue([]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([]);
    mockSettings();
  });

  it("400s when guestName or items are missing", async () => {
    const noName = await postOrder(orderReq({ items: validOrder.items }));
    expect(noName.status).toBe(400);
    expect(await noName.json()).toMatchObject({ error: "Missing required fields" });

    const noItems = await postOrder(orderReq({ guestName: "Ada" }));
    expect(noItems.status).toBe(400);

    const emptyItems = await postOrder(orderReq({ guestName: "Ada", items: [] }));
    expect(emptyItems.status).toBe(400);
    expect(q.createFoodOrder).not.toHaveBeenCalled();
  });

  it("400s when quantity is 0 or 51", async () => {
    const zero = await postOrder(orderReq({ guestName: "Ada", items: [{ menuItemId: 1, quantity: 0 }] }));
    expect(zero.status).toBe(400);
    expect(await zero.json()).toMatchObject({ error: "Invalid item quantity" });

    const tooMany = await postOrder(orderReq({ guestName: "Ada", items: [{ menuItemId: 1, quantity: 51 }] }));
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: "Invalid item quantity" });
    expect(q.createFoodOrder).not.toHaveBeenCalled();
  });

  it("400s Kitchen is currently closed when hours are empty", async () => {
    // "" is falsy so the route uses default hours; freeze IST to the afternoon gap.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T10:30:00.000Z"));
    mockSettings({ food_kitchen_hours: "" });
    try {
      const res = await postOrder(orderReq(validOrder));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toBe("Kitchen is currently closed");
      expect(q.createFoodOrder).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("503s when the kitchen is open all day but busy", async () => {
    mockSettings({ food_kitchen_hours: "00:00-23:59", food_kitchen_busy: "true" });
    const res = await postOrder(orderReq(validOrder));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "Kitchen is currently busy and not accepting new orders. Please try again later.",
    });
    expect(q.createFoodOrder).not.toHaveBeenCalled();
    expect(q.getMenuItemById).not.toHaveBeenCalled();
  });

  it("403s hostel guests whose phone does not match getActiveCheckins", async () => {
    q.getActiveCheckins.mockResolvedValue([{ id: 9, contact: "1111111111" }]);
    const res = await postOrder(
      orderReq({
        ...validOrder,
        guestType: "hostel",
        checkinId: 9,
        guestPhone: "9876543210",
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Guest verification failed" });
    expect(q.getActiveCheckins).toHaveBeenCalledTimes(1);
    expect(q.createFoodOrder).not.toHaveBeenCalled();
    expect(q.getFoodOrderByIdempotencyKey).not.toHaveBeenCalled();
  });

  it("does not honor checked-out guests when grace days is 0", async () => {
    q.getActiveCheckins.mockResolvedValue([]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([{ id: 9, contact: "9876543210" }]);
    mockSettings({ food_checkout_grace_days: "0" });
    const res = await postOrder(
      orderReq({
        ...validOrder,
        guestType: "hostel",
        checkinId: 9,
        guestPhone: "9876543210",
      }),
    );
    expect(res.status).toBe(403);
    expect(q.getRecentlyCheckedOutGuests).not.toHaveBeenCalled();
    expect(q.createFoodOrder).not.toHaveBeenCalled();
  });

  it("returns duplicate: true on an idempotencyKey hit without createFoodOrder", async () => {
    q.getFoodOrderByIdempotencyKey.mockResolvedValue({
      id: 42,
      orderNumber: "F-42",
      total: 105,
    });
    const res = await postOrder(orderReq({ ...validOrder, idempotencyKey: "guest-key-1" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      orderId: 42,
      orderNumber: "F-42",
      total: 105,
      duplicate: true,
    });
    expect(q.getFoodOrderByIdempotencyKey).toHaveBeenCalledWith("guest-key-1");
    expect(q.createFoodOrder).not.toHaveBeenCalled();
    expect(q.dispatchPush).not.toHaveBeenCalled();
  });

  it("accepts a price-on-request item and stores it as pending", async () => {
    q.getMenuItemById.mockResolvedValue({ id: 3, name: "Seasonal Fish", price: 0, priceOnRequest: 1, isAvailable: 1, trackInventory: 0, stockQuantity: 0 });
    q.createFoodOrder.mockResolvedValue([{ id: 7, orderNumber: "F-7" }]);
    const res = await postOrder(orderReq({ ...validOrder, items: [{ menuItemId: 3, quantity: 2, notes: "Large fish" }] }));
    expect(res.status).toBe(200);
    expect(q.addFoodOrderItems).toHaveBeenCalledWith([expect.objectContaining({ itemPrice: 0, lineTotal: 0, pricingStatus: "pending", notes: "Large fish" })]);
  });
});

describe("GET /api/food/status", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.dispatchPush.mockResolvedValue(undefined);
    q.getActiveCheckins.mockResolvedValue([]);
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map());
    mockSettings();
  });

  it("400s when phone is missing", async () => {
    const res = await getStatus(statusReq({ order: "F-1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ found: false, error: "Missing phone" });
    expect(q.getFoodOrderByNumber).not.toHaveBeenCalled();
  });

  it("returns found: false when the order phone does not match", async () => {
    q.getFoodOrderByNumber.mockResolvedValue({
      id: 7,
      orderNumber: "F-7",
      guestPhone: "9999999999",
      status: "placed",
    });
    const res = await getStatus(statusReq({ order: "F-7", phone: "9876543210" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
    expect(q.getFoodOrderItems).not.toHaveBeenCalled();
  });

  it("returns the order and items when order+phone match", async () => {
    q.getFoodOrderByNumber.mockResolvedValue({
      id: 7,
      orderNumber: "F-7",
      status: "placed",
      guestName: "Ada",
      guestPhone: "9876543210",
      subtotal: 100,
      tax: 5,
      total: 105,
      discount: 0,
      specialInstructions: "",
      createdAt: "2026-08-29T10:00:00.000Z",
    });
    q.getFoodOrderItems.mockResolvedValue([
      { menuItemId: 1, itemName: "Dosa", itemPrice: 100, quantity: 1, lineTotal: 100 },
    ]);
    const res = await getStatus(statusReq({ order: "F-7", phone: "9876543210" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.found).toBe(true);
    expect(json.order.orderNumber).toBe("F-7");
    expect(json.order.items).toEqual([
      { menuItemId: 1, name: "Dosa", price: 100, quantity: 1, lineTotal: 100 },
    ]);
    expect(q.getFoodOrderItems).toHaveBeenCalledWith(7);
    expect(q.getGuestAllFoodOrders).not.toHaveBeenCalled();
  });

  it("returns found: false and orders [] when phone has no active checkin", async () => {
    q.getActiveCheckins.mockResolvedValue([{ id: 3, contact: "1111111111" }]);
    const res = await getStatus(statusReq({ phone: "9876543210" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false, orders: [] });
    expect(q.getGuestAllFoodOrders).not.toHaveBeenCalled();
    expect(q.getFoodOrderItemsBatch).not.toHaveBeenCalled();
  });

  it("loads guest orders with one getFoodOrderItemsBatch when phone matches an active checkin", async () => {
    q.getActiveCheckins.mockResolvedValue([{ id: 3, contact: "9876543210" }]);
    q.getGuestAllFoodOrders.mockResolvedValue([
      { id: 7, orderNumber: "F-7", status: "placed", total: 105, createdAt: "2026-08-29T10:00:00.000Z" },
      { id: 8, orderNumber: "F-8", status: "ready", total: 50, createdAt: "2026-08-29T11:00:00.000Z" },
    ]);
    q.getFoodOrderItemsBatch.mockResolvedValue(
      new Map([
        [7, [{ menuItemId: 1, itemName: "Dosa", itemPrice: 100, quantity: 1, lineTotal: 100 }]],
        [8, [{ menuItemId: 2, itemName: "Tea", itemPrice: 25, quantity: 2, lineTotal: 50 }]],
      ]),
    );
    const res = await getStatus(statusReq({ phone: "9876543210" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.found).toBe(true);
    expect(json.orders).toHaveLength(2);
    expect(json.orders[0].items[0].name).toBe("Dosa");
    expect(q.getGuestAllFoodOrders).toHaveBeenCalledWith(3);
    expect(q.getFoodOrderItemsBatch).toHaveBeenCalledTimes(1);
    expect(q.getFoodOrderItemsBatch).toHaveBeenCalledWith([7, 8]);
    expect(q.getFoodOrderItems).not.toHaveBeenCalled();
  });
});

describe("food-order CPU/SSR split", () => {
  it("statically imports PhoneEntry and dynamically loads MenuBrowser and FoodCart with ssr:false", () => {
    const page = readFile("src/app/food-order/page.tsx");
    expect(page).toContain('import { PhoneEntry, type GuestInfo } from "@/components/food/PhoneEntry"');
    expect(page).not.toMatch(/import\("@\/components\/food\/PhoneEntry"\)/);
    expect(page).toContain('import("@/components/food/MenuBrowser")');
    expect(page).toContain('import("@/components/food/FoodCart")');
    expect(page.split("ssr: false").length - 1).toBe(2);
  });

  it("marks the food-order layout force-static", () => {
    expect(readFile("src/app/food-order/layout.tsx")).toContain('export const dynamic = "force-static"');
  });

  it("centers the cart FAB and reorder toast without Framer y fighting left-1/2 translate", () => {
    const page = readFile("src/app/food-order/page.tsx");
    expect(page).toContain("inset-x-4");
    expect(page).not.toContain("left-1/2");
    expect(page).not.toContain("-translate-x-1/2");
  });

  it("keeps the home category view and adds a selected-category rail for guests", () => {
    const page = readFile("src/app/food-order/page.tsx");
    const menu = readFile("src/components/food/MenuBrowser.tsx");
    expect(menu).toContain('aria-label="Food categories"');
    expect(menu).toContain('aria-current={cat.id === selectedCategory ? "page" : undefined}');
    expect(menu).toContain("grid-cols-[4.25rem_minmax(0,1fr)]");
    expect(menu).toContain("grid grid-cols-2 gap-2 sm:gap-3");
    expect(menu).toContain("onClick={() => selectCategory(cat.id)}");
    expect(menu).toContain("h-[calc(100dvh-6.5rem)]");
    expect(menu).toContain("pb-14");
    expect(menu).toContain("overflow-y-auto overscroll-contain");
    expect(menu).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(menu).not.toContain("{item.description}");
    expect(menu).toContain("flex-nowrap gap-1 overflow-x-auto");
    expect(page).toContain('view === "menu" ? "max-w-7xl pb-0 pt-1"');
    expect(page).toContain('className="hidden sm:inline"');
  });

  it("preserves seasonal pricing metadata from menu cards into the guest cart", () => {
    const menu = readFile("src/components/food/MenuBrowser.tsx");
    const page = readFile("src/app/food-order/page.tsx");
    for (const field of ["priceOnRequest", "indicativeMinPrice", "indicativeMaxPrice", "priceBasis"]) {
      expect(menu).toContain(`${field}: item.${field}`);
      expect(page).toContain(`${field}: menuItem.${field}`);
    }
  });
});
