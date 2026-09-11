import { NextRequest, NextResponse } from "next/server";
import {
  getAllMenuCategories, addMenuCategory, updateMenuCategory, deleteMenuCategory,
  getAllMenuItems, addMenuItem, updateMenuItem, deleteMenuItem,
  getMenuItemById,
  toggleMenuItemAvailability, getMenuItemsByCategory,
  getSetting, setSetting,
  addStock as addStockQuery, getLowStockItems as getLowStockItemsQuery,
} from "@/db/queries";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { sanitizeFoodImageUrl } from "@/lib/foodImage";
import { mediaUrlToKey } from "@/lib/mediaKeys";
import { deleteMediaKeys } from "@/lib/mediaR2";

async function deleteMenuPhotos(urls: Array<string | null | undefined>) {
  const keys = urls
    .map((url) => mediaUrlToKey(String(url || "")))
    .filter((key): key is string => Boolean(key?.startsWith("menu/")));
  if (!keys.length) return;
  try {
    await deleteMediaKeys(keys);
  } catch (error) {
    console.error("Could not delete replaced menu photo:", error);
  }
}

const FOOD_SETTINGS_KEYS = [
  "food_kitchen_whatsapp",
  "food_tax_rate",
  "food_kitchen_hours",
  "food_kitchen_open",
  "food_kitchen_close",
  "food_tab_limit",
  "food_checkout_grace_days",
  "food_cafe_tables",
  "food_confirm_with_guest",
  "food_payment_history_days",
  "food_kannada_kitchen_print",
  "food_kannada_kitchen_display",
  "food_approval_in_kitchen",
  "food_kitchen_busy",
  "food_customer_whatsapp",
  "food_show_out_of_stock",
];

const FOOD_ACTION_PERMISSIONS: Record<string, ActionPerm> = {
  getCategories: "canViewMenu",
  getMenuItems: "canViewMenu",
  getMenuItemsByCategory: "canViewMenu",
  addCategory: "canManageMenuCategories",
  updateCategory: "canManageMenuCategories",
  toggleCategoryAvailability: "canToggleMenuAvailability",
  deleteCategory: "canManageMenuCategories",
  addMenuItem: "canManageMenuItems",
  updateMenuItem: "canManageMenuItems",
  deleteMenuItem: "canManageMenuItems",
  toggleItemAvailability: "canToggleMenuAvailability",
  bulkToggleAvailability: "canToggleMenuAvailability",
  addStock: "canManageInventory",
  getLowStockItems: "canManageInventory",
  getFoodSettings: "canManageFoodSettings",
  updateFoodSettings: "canManageFoodSettings",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...params } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const required = FOOD_ACTION_PERMISSIONS[action];
    const access = actionAllowed(auth.role, auth.permissions, required || "admin_only");
    if (access !== "allowed") {
      return NextResponse.json({ error: access === "admin_required" ? "Admin access required" : "Insufficient permissions" }, { status: 403 });
    }
    const canManageInventory = actionAllowed(auth.role, auth.permissions, "canManageInventory") === "allowed";

    switch (action) {
      // --- Categories ---
      case "getCategories": {
        const categories = await getAllMenuCategories();
        const allItems = await getAllMenuItems();
        const countsMap: Record<number, number> = {};
        for (const item of allItems) {
          countsMap[item.categoryId] = (countsMap[item.categoryId] || 0) + 1;
        }
        return NextResponse.json({
          categories: categories.map((c) => ({ ...c, itemCount: countsMap[c.id] || 0 })),
        });
      }

      case "addCategory": {
        const { name, nameKannada, icon, description, displayOrder, discountExempt } = params;
        if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
        await addMenuCategory({
          name: name.trim(),
          nameKannada: nameKannada || "",
          icon: icon || "🍽️",
          description: description || "",
          displayOrder: displayOrder ?? 0,
          discountExempt: discountExempt ? 1 : 0,
        });
        return NextResponse.json({ ok: true });
      }

      case "updateCategory": {
        const { id, ...data } = params;
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        await updateMenuCategory(id, data);
        return NextResponse.json({ ok: true });
      }

      case "toggleCategoryAvailability": {
        const { id, isActive } = params;
        if (!id || isActive === undefined) return NextResponse.json({ error: "id and isActive are required" }, { status: 400 });
        await updateMenuCategory(id, { isActive: isActive ? 1 : 0 });
        return NextResponse.json({ ok: true });
      }

      case "deleteCategory": {
        const { id } = params;
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const categoryItems = await getMenuItemsByCategory(id);
        await deleteMenuCategory(id);
        await deleteMenuPhotos(categoryItems.map((item) => item.imageUrl));
        return NextResponse.json({ ok: true });
      }

      // --- Menu Items ---
      case "getMenuItems": {
        const items = await getAllMenuItems();
        const categories = await getAllMenuCategories();
        const catMap: Record<number, string> = {};
        for (const c of categories) catMap[c.id] = c.name;
        return NextResponse.json({
          items: items.map((item) => ({
            ...item,
            categoryName: catMap[item.categoryId] || "Unknown",
          })),
        });
      }

      case "getMenuItemsByCategory": {
        const { categoryId } = params;
        if (!categoryId) return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
        const items = await getMenuItemsByCategory(categoryId);
        return NextResponse.json({ items });
      }

      case "addMenuItem": {
        const { categoryId, name, nameKannada, description, price, priceText, tags, ingredients, imageUrl, displayOrder, trackInventory, stockQuantity, lowStockThreshold } = params;
        if (!categoryId || !name?.trim()) return NextResponse.json({ error: "categoryId and name are required" }, { status: 400 });
        if (typeof price !== "number" || price < 0) return NextResponse.json({ error: "Valid price is required" }, { status: 400 });
        const safeImageUrl = sanitizeFoodImageUrl(imageUrl);
        if (imageUrl && !safeImageUrl) return NextResponse.json({ error: "Invalid item photo" }, { status: 400 });
        await addMenuItem({
          categoryId,
          name: name.trim(),
          nameKannada: nameKannada || "",
          description: description || "",
          price,
          priceText: priceText || "",
          tags: typeof tags === "string" ? tags : JSON.stringify(tags || []),
          ingredients: typeof ingredients === "string" ? ingredients : JSON.stringify(ingredients || []),
          imageUrl: safeImageUrl,
          displayOrder: displayOrder ?? 0,
          trackInventory: canManageInventory ? trackInventory ?? 0 : 0,
          stockQuantity: canManageInventory ? stockQuantity ?? 0 : 0,
          lowStockThreshold: canManageInventory ? lowStockThreshold ?? 5 : 5,
        });
        return NextResponse.json({ ok: true });
      }

      case "updateMenuItem": {
        const { id, ...data } = params;
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const previous = await getMenuItemById(id);
        if (!previous) return NextResponse.json({ error: "Menu item not found" }, { status: 404 });
        if (data.tags && typeof data.tags !== "string") data.tags = JSON.stringify(data.tags);
        if (data.ingredients && typeof data.ingredients !== "string") data.ingredients = JSON.stringify(data.ingredients);
        if (Object.prototype.hasOwnProperty.call(data, "imageUrl")) {
          const safeImageUrl = sanitizeFoodImageUrl(data.imageUrl);
          if (data.imageUrl && !safeImageUrl) return NextResponse.json({ error: "Invalid item photo" }, { status: 400 });
          data.imageUrl = safeImageUrl;
        }
        if (!canManageInventory) {
          delete data.trackInventory;
          delete data.stockQuantity;
          delete data.lowStockThreshold;
        }
        await updateMenuItem(id, data);
        if (Object.prototype.hasOwnProperty.call(data, "imageUrl") && previous.imageUrl !== data.imageUrl) {
          await deleteMenuPhotos([previous.imageUrl]);
        }
        return NextResponse.json({ ok: true });
      }

      case "deleteMenuItem": {
        const { id } = params;
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const previous = await getMenuItemById(id);
        await deleteMenuItem(id);
        await deleteMenuPhotos([previous?.imageUrl]);
        return NextResponse.json({ ok: true });
      }

      case "toggleItemAvailability": {
        const { id, isAvailable } = params;
        if (!id || isAvailable === undefined) return NextResponse.json({ error: "id and isAvailable are required" }, { status: 400 });
        await toggleMenuItemAvailability(id, isAvailable ? 1 : 0);
        return NextResponse.json({ ok: true });
      }

      case "bulkToggleAvailability": {
        const { categoryId, isAvailable } = params;
        if (!categoryId || isAvailable === undefined) return NextResponse.json({ error: "categoryId and isAvailable required" }, { status: 400 });
        const items = await getMenuItemsByCategory(categoryId);
        for (const item of items) {
          await toggleMenuItemAvailability(item.id, isAvailable ? 1 : 0);
        }
        return NextResponse.json({ ok: true, updated: items.length });
      }

      // --- Inventory ---
      case "addStock": {
        const { menuItemId, quantity } = params;
        if (!menuItemId || !quantity || quantity < 1) return NextResponse.json({ error: "menuItemId and positive quantity required" }, { status: 400 });
        await addStockQuery(menuItemId, quantity);
        return NextResponse.json({ ok: true });
      }

      case "getLowStockItems": {
        const lowStockItems = await getLowStockItemsQuery();
        return NextResponse.json({ items: lowStockItems });
      }

      // --- Food Settings ---
      case "getFoodSettings": {
        const result: Record<string, string> = {};
        for (const key of FOOD_SETTINGS_KEYS) {
          result[key] = (await getSetting(key)) ?? "";
        }
        return NextResponse.json({ settings: result });
      }

      case "updateFoodSettings": {
        const { settings: settingsData } = params;
        if (!settingsData || typeof settingsData !== "object") {
          return NextResponse.json({ error: "settings object is required" }, { status: 400 });
        }
        for (const [key, value] of Object.entries(settingsData)) {
          if (FOOD_SETTINGS_KEYS.includes(key)) {
            await setSetting(key, String(value));
          }
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error("Admin food API error:", err);
    const raw = err?.message || "Internal error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : raw;
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
