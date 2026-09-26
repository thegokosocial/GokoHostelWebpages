import { expect, type Page } from "@playwright/test";

export type FoodRequest = Record<string, unknown>;

export const SAMPLE_ORDER = {
  id: 10,
  orderNumber: "D265-10",
  guestType: "walkin",
  checkinId: null,
  guestName: "Pawan test",
  guestPhone: "123454321",
  roomInfo: "",
  specialInstructions: "",
  subtotal: 40000,
  tax: 0,
  total: 40000,
  amountPaid: 0,
  amountRefunded: 0,
  status: "served",
  paymentStatus: "pending",
  paymentMethod: "",
  paidBy: "",
  cashReceived: 0,
  changeGiven: 0,
  discount: 0,
  discountReason: "",
  discountBy: "",
  cancelledReason: "",
  createdBy: "admin",
  createdAt: "2026-09-23T06:00:00.000Z",
  updatedAt: "2026-09-23T06:00:00.000Z",
  hasModifications: false,
  items: [
    {
      id: 20,
      menuItemId: 4,
      itemName: "Shampoo",
      itemPrice: 20000,
      quantity: 2,
      lineTotal: 40000,
      status: "active",
      pricingStatus: "fixed",
      notes: "",
    },
  ],
};

export const KITCHEN_ORDER = {
  id: 42,
  orderNumber: "D270-1",
  guestType: "walkin",
  guestName: "Kitchen Guest",
  guestPhone: "9000000001",
  roomInfo: "",
  tableNumber: "",
  specialInstructions: "",
  subtotal: 10000,
  tax: 0,
  total: 10000,
  status: "placed",
  createdBy: "guest",
  createdAt: new Date().toISOString(),
  items: [
    {
      id: 1,
      menuItemId: 7,
      itemName: "Masala Dosa",
      itemPrice: 10000,
      quantity: 1,
      lineTotal: 10000,
      status: "active",
      tags: "[]",
    },
  ],
};

export async function mockAdminShell(
  page: Page,
  opts: {
    role?: string;
    permissions?: Record<string, boolean>;
    onFoodOrders?: (body: FoodRequest, requests: FoodRequest[]) => { status?: number; json: Record<string, unknown> } | null;
    onAdminFood?: (body: FoodRequest, requests: FoodRequest[]) => { status?: number; json: Record<string, unknown> } | null;
    onKitchen?: (body: FoodRequest, requests: FoodRequest[]) => { status?: number; json: Record<string, unknown> } | null;
  } = {},
) {
  const role = opts.role ?? "admin";
  const permissions = opts.permissions ?? {};
  const foodRequests: FoodRequest[] = [];
  const adminFoodRequests: FoodRequest[] = [];
  const kitchenRequests: FoodRequest[] = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role, username: "e2e-user", permissions } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (url.pathname === "/api/auth/logout") {
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (url.pathname === "/api/food/kitchen") {
      const body = JSON.parse(route.request().postData() || "{}") as FoodRequest;
      kitchenRequests.push(body);
      const custom = opts.onKitchen?.(body, kitchenRequests);
      if (custom) {
        await route.fulfill({ status: custom.status ?? 200, json: custom.json });
        return;
      }
      if (body.action === "listOrders") {
        await route.fulfill({ json: { success: true, data: { orders: [KITCHEN_ORDER], isBusy: false } } });
        return;
      }
      if (body.action === "getMenuItems") {
        await route.fulfill({
          json: {
            success: true,
            data: {
              items: [],
              categories: [{ id: 1, name: "Snacks", nameKannada: "", icon: "", isActive: 1 }],
              kannadaPrint: false,
              kannadaDisplay: false,
              approvalInKitchen: false,
            },
          },
        });
        return;
      }
      if (body.action === "updateStatus" || body.action === "updateStatusBulk") {
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({ json: { success: true, data: {} } });
      return;
    }

    if (!url.pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const body = JSON.parse(route.request().postData() || "{}") as FoodRequest;
    if (body.action === "auth") {
      await route.fulfill({ json: { role, permissions } });
      return;
    }

    if (url.pathname === "/api/admin/account-settings" && body.action === "getFoodReceiptAccounts") {
      await route.fulfill({
        json: {
          accounts: [{ id: 9, name: "HDFC", nickname: "HDFC", isActive: 1 }],
          foodOnlineReceiptAccountId: 9,
        },
      });
      return;
    }

    if (url.pathname === "/api/admin/food") {
      adminFoodRequests.push(body);
      const custom = opts.onAdminFood?.(body, adminFoodRequests);
      if (custom) {
        await route.fulfill({ status: custom.status ?? 200, json: custom.json });
        return;
      }
      if (body.action === "getCategories") {
        await route.fulfill({
          json: { categories: [{ id: 1, name: "Snacks", nameKannada: "", icon: "🍪", description: "", displayOrder: 1, isActive: 1 }] },
        });
        return;
      }
      if (body.action === "getMenuItems") {
        await route.fulfill({
          json: {
            items: [{
              id: 41,
              categoryId: 1,
              name: "Soap",
              nameKannada: "",
              description: "",
              price: 50000,
              priceText: "",
              tags: "[]",
              ingredients: "",
              imageUrl: "",
              isAvailable: 1,
              trackInventory: 1,
              stockQuantity: 2,
              displayOrder: 1,
              priceOnRequest: 0,
            }],
          },
        });
        return;
      }
      if (body.action === "addMenuItem" || body.action === "addStock" || body.action === "addCategory") {
        await route.fulfill({ json: { success: true, id: 99 } });
        return;
      }
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (url.pathname === "/api/admin/food-orders") {
      foodRequests.push(body);
      const custom = opts.onFoodOrders?.(body, foodRequests);
      if (custom) {
        await route.fulfill({ status: custom.status ?? 200, json: custom.json });
        return;
      }
      await route.fulfill({ json: defaultFoodOrdersResponse(body) });
      return;
    }

    await route.fulfill({ json: {} });
  });

  return { foodRequests, adminFoodRequests, kitchenRequests };
}

export function defaultFoodOrdersResponse(body: FoodRequest, order: typeof SAMPLE_ORDER = SAMPLE_ORDER) {
  const action = body.action;
  if (action === "getGuestsWithTabs") return { guests: [] };
  if (action === "getWalkinOrders") return { orders: [order] };
  if (action === "listOrders" && body.status === "all_history") return { orders: [] };
  if (action === "listOrders") return { orders: [] };
  if (action === "getMenu") {
    return {
      categories: [{ id: 1, name: "Snacks", discountExempt: 0 }],
      items: [{ id: 4, categoryId: 1, name: "Shampoo", nameKannada: "", description: "", price: 20000, priceText: "", tags: "[]", isAvailable: 1 }],
      paymentHistoryDays: 7,
      settings: { taxRate: 0 },
    };
  }
  if (action === "getCombinedBillOptions") {
    return {
      guests: [{
        key: "walkin_phone_123454321",
        checkinId: null,
        guestType: "walkin",
        name: "Pawan test",
        contact: "123454321",
        bedInfo: "",
        orderIds: [order.id],
        tabTotal: order.total - (order.amountPaid || 0),
        orderCount: 1,
      }],
    };
  }
  if (action === "getCombinedBill") {
    return {
      guests: [{
        key: "walkin_phone_123454321",
        checkinId: null,
        guestName: "Pawan test",
        guestPhone: "123454321",
        amountDue: order.total,
        subtotal: order.subtotal,
        orders: [order],
      }],
      grandTotal: order.total,
    };
  }
  if (action === "markOrderPaid" || action === "applyDiscount" || action === "removeDiscount" || action === "updatePaymentDetails") {
    return { success: true };
  }
  if (action === "saveOrderEdits") return { success: true, duplicate: false, total: order.total, refundAmount: 0 };
  if (action === "cancelUnpaidOrder") return { success: true };
  if (action === "getOrderModifications") return { modifications: [] };
  if (action === "getActiveGuests") return { guests: [] };
  return { guests: [], orders: [], categories: [], items: [] };
}

export async function loginAdmin(page: Page, section = "foodOrders") {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin?section=${section}`);
  await page.locator("#admin-user").fill("e2e-user");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
}

export async function openWalkinOrderDrawer(page: Page, guestName = "Pawan test") {
  await expect(page.getByRole("heading", { name: /Order Summary/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: guestName }).click();
  const drawer = page.locator(".fixed.inset-0.z-50");
  await expect(drawer).toBeVisible();
  return drawer;
}
