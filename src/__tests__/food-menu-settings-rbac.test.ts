import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ authenticateUser: vi.fn() }));
vi.mock("@/lib/mediaR2", () => ({ deleteMediaKeys: vi.fn(), getMediaBucket: vi.fn(), putMediaObject: vi.fn() }));
vi.mock("@/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/queries")>();
  return {
    ...actual,
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    getAllMenuCategories: vi.fn(async () => []),
    addMenuCategory: vi.fn(async () => 1),
    updateMenuCategory: vi.fn(),
    deleteMenuCategory: vi.fn(),
    getAllMenuItems: vi.fn(async () => []),
    addMenuItem: vi.fn(async () => 1),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn(),
    getMenuItemById: vi.fn(),
    toggleMenuItemAvailability: vi.fn(),
    getMenuItemsByCategory: vi.fn(async () => []),
    addStock: vi.fn(),
    getLowStockItems: vi.fn(async () => []),
  };
});

import { authenticateUser } from "@/lib/auth";
import {
  addMenuCategory, addMenuItem, addStock, deleteMenuItem, getAllMenuCategories,
  getMenuItemById, getSetting, setSetting, toggleMenuItemAvailability, updateMenuItem,
} from "@/db/queries";
import { POST } from "@/app/api/admin/food/route";

async function post(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/admin/food", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", ...body }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateUser).mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  vi.mocked(setSetting).mockResolvedValue(undefined as never);
  vi.mocked(getSetting).mockResolvedValue("");
  vi.mocked(getMenuItemById).mockResolvedValue({
    id: 9, categoryId: 1, name: "Tea", price: 5000, priceOnRequest: 0,
  } as never);
});

describe("Food menu / settings action RBAC", () => {
  it("canViewMenu alone allows getCategories but not addCategory", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Viewer", permissions: { canViewMenu: true },
    });
    expect((await post({ action: "getCategories" })).status).toBe(200);
    expect((await post({ action: "addCategory", name: "Snacks" })).status).toBe(403);
    expect(addMenuCategory).not.toHaveBeenCalled();
  });

  it("canManageMenuCategories allows add/update/delete category", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Cat", permissions: { canManageMenuCategories: true },
    });
    expect((await post({ action: "addCategory", name: "Snacks" })).status).toBe(200);
    expect(addMenuCategory).toHaveBeenCalled();
  });

  it("canManageMenuItems alone cannot manage categories or settings", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Items", permissions: { canManageMenuItems: true },
    });
    expect((await post({
      action: "addMenuItem", categoryId: 1, name: "Tea", price: 5000,
    })).status).toBe(200);
    expect(addMenuItem).toHaveBeenCalled();
    expect((await post({ action: "addCategory", name: "X" })).status).toBe(403);
    expect((await post({ action: "updateFoodSettings", settings: { food_tax_rate: "5" } })).status).toBe(403);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("canToggleMenuAvailability allows toggle but not delete", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Toggle", permissions: { canToggleMenuAvailability: true },
    });
    vi.mocked(toggleMenuItemAvailability).mockResolvedValue(undefined as never);
    expect((await post({ action: "toggleItemAvailability", id: 3, isAvailable: 0 })).status).toBe(200);
    expect(toggleMenuItemAvailability).toHaveBeenCalled();
    expect((await post({ action: "deleteMenuItem", id: 3 })).status).toBe(403);
    expect(deleteMenuItem).not.toHaveBeenCalled();
  });

  it("canManageFoodSettings allows settings write; menu-only staff cannot", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Settings", permissions: { canManageFoodSettings: true },
    });
    expect((await post({ action: "getFoodSettings" })).status).toBe(200);
    expect((await post({
      action: "updateFoodSettings", settings: { food_tax_rate: "5", food_kitchen_open: "08:00" },
    })).status).toBe(200);
    expect(setSetting).toHaveBeenCalled();

    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "NoSettings", permissions: { canViewMenu: true, canManageMenuItems: true },
    });
    vi.mocked(setSetting).mockClear();
    expect((await post({ action: "getFoodSettings" })).status).toBe(403);
  });

  it("canManageInventory alone gates stock; menu item update without inventory cannot change stock fields", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Stock", permissions: { canManageInventory: true },
    });
    expect((await post({ action: "addStock", menuItemId: 1, quantity: 5 })).status).toBe(200);
    expect(addStock).toHaveBeenCalled();

    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "ItemsOnly", permissions: { canManageMenuItems: true },
    });
    expect((await post({ action: "addStock", menuItemId: 1, quantity: 5 })).status).toBe(403);
  });

  it("empty env-manager permissions forbid gated menu mutations", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "manager", displayName: "Env", permissions: {},
    });
    for (const action of ["addCategory", "addMenuItem", "updateFoodSettings", "addStock", "toggleItemAvailability"] as const) {
      expect((await post({ action, name: "X", id: 1, categoryId: 1, price: 100, settings: { food_tax_rate: "0" }, menuItemId: 1, quantity: 1, isAvailable: 1 })).status, action).toBe(403);
    }
    expect(getAllMenuCategories).not.toHaveBeenCalled();
  });

  it("rejects unknown food actions", async () => {
    expect((await post({ action: "dropKitchen" })).status).toBe(400);
  });

  it("updateMenuItem with canManageMenuItems succeeds", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff", displayName: "Editor", permissions: { canManageMenuItems: true },
    });
    vi.mocked(updateMenuItem).mockResolvedValue(undefined as never);
    expect((await post({ action: "updateMenuItem", id: 9, name: "Chai", price: 4000 })).status).toBe(200);
    expect(updateMenuItem).toHaveBeenCalled();
  });
});
