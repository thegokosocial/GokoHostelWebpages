import { expect, test, type Page } from "@playwright/test";
import { KITCHEN_ORDER } from "./helpers/foodMocks";

test.describe.configure({ timeout: 90_000 });

async function mockGuestFoodApis(
  page: Page,
  opts: {
    placeResponse?: (attempt: number) => { status?: number; json: Record<string, unknown> };
  } = {},
) {
  const placeBodies: Record<string, unknown>[] = [];
  let placeAttempts = 0;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/food/menu" && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          categories: [{
            id: 1,
            name: "Snacks",
            nameKannada: "",
            icon: "",
            description: "",
            displayOrder: 1,
          }],
          items: [{
            id: 41,
            categoryId: 1,
            name: "Soap",
            nameKannada: "",
            description: "",
            price: 50000,
            priceText: "",
            priceOnRequest: 0,
            tags: "[]",
            ingredients: "",
            imageUrl: "",
            isAvailable: 1,
            displayOrder: 1,
            trackInventory: 1,
            stockQuantity: 1,
          }],
          settings: {
            kitchenHours: "00:00-23:59",
            isBusy: false,
            taxRate: 0,
            whatsappNumber: "",
            customerWhatsappEnabled: false,
            showOutOfStock: true,
          },
        },
      });
      return;
    }
    if (url.pathname === "/api/food/lookup") {
      await route.fulfill({
        json: { found: false, guests: [] },
      });
      return;
    }
    if (url.pathname === "/api/food/status") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }
    if (url.pathname === "/api/food/order" && route.request().method() === "POST") {
      placeAttempts += 1;
      const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      placeBodies.push(body);
      const res = opts.placeResponse?.(placeAttempts) ?? {
        json: { success: true, orderId: 1, orderNumber: "G100-1", total: 50000 },
      };
      await route.fulfill({ status: res.status ?? 200, json: res.json });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return placeBodies;
}

async function guestEnterAndAddSoap(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.removeItem("gokoFoodPhone");
    localStorage.removeItem("gokoFoodCart");
    sessionStorage.removeItem("gokoFoodSession");
  });
  await page.goto("/food-order");
  await expect(page.getByRole("heading", { name: /Enter your phone number/i })).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("98765 43210").fill("9876543210");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible({ timeout: 15_000 });
  await page.getByText("Snacks", { exact: true }).click();
  await expect(page.getByText("Soap", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByRole("button", { name: /View Cart/i }).click();
  await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
  await page.getByPlaceholder("Enter your name").fill("Guest E2E");
}

test("guest /food-order places successfully", async ({ page }) => {
  const placeBodies = await mockGuestFoodApis(page);
  await guestEnterAndAddSoap(page);
  await page.getByRole("button", { name: /Place Order/i }).click();
  await expect(page.getByRole("heading", { name: /Order Placed/i })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => placeBodies.length).toBe(1);
  expect(String(placeBodies[0]?.idempotencyKey || "")).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("guest place shows stock insufficiency error", async ({ page }) => {
  const placeBodies = await mockGuestFoodApis(page, {
    placeResponse: () => ({
      status: 400,
      json: { error: '"Soap" only has 0 left in stock' },
    }),
  });
  await guestEnterAndAddSoap(page);
  await page.getByRole("button", { name: /Place Order/i }).click();
  await expect.poll(() => placeBodies.length).toBe(1);
  await expect(page.getByText(/only has 0 left in stock/i)).toBeVisible();
});

test("guest place shows healed success copy path without hard failure", async ({ page }) => {
  const placeBodies = await mockGuestFoodApis(page, {
    placeResponse: () => ({
      json: {
        success: true,
        orderId: 88,
        orderNumber: "G100-88",
        total: 50000,
        healed: true,
        duplicate: true,
      },
    }),
  });
  await guestEnterAndAddSoap(page);
  await page.getByRole("button", { name: /Place Order/i }).click();
  await expect.poll(() => placeBodies.length).toBe(1);
  await expect(page.getByRole("heading", { name: /Order Placed/i })).toBeVisible({ timeout: 15_000 });
});

test("live /kitchen advances placed → preparing", async ({ page }) => {
  const kitchenBodies: Record<string, unknown>[] = [];
  let status = "placed";

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role: "staff", username: "kitchen", permissions: {} } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (url.pathname === "/api/food/kitchen") {
      const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      kitchenBodies.push(body);
      if (body.action === "listOrders") {
        await route.fulfill({
          json: {
            success: true,
            data: { orders: [{ ...KITCHEN_ORDER, status }], isBusy: false },
          },
        });
        return;
      }
      if (body.action === "getMenuItems") {
        await route.fulfill({
          json: {
            success: true,
            data: {
              items: [],
              categories: [],
              kannadaPrint: false,
              kannadaDisplay: false,
              approvalInKitchen: false,
            },
          },
        });
        return;
      }
      if (body.action === "updateStatus") {
        status = String(body.status || status);
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({ json: { success: true, data: {} } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/kitchen");
  await page.getByPlaceholder("Enter password").fill("e2e-kitchen");
  await page.getByRole("button", { name: "Enter Kitchen" }).click();
  await expect(page.getByRole("heading", { name: "Kitchen" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("D270-1").first()).toBeVisible();
  await page.getByRole("button", { name: "START PREPARING" }).first().click();
  await expect.poll(() => kitchenBodies.filter((b) => b.action === "updateStatus")).toHaveLength(1);
  expect(kitchenBodies.find((b) => b.action === "updateStatus")).toMatchObject({
    orderId: 42,
    status: "preparing",
    scope: "kitchen",
  });
});

test("kitchen Out of Stock panel toggles item availability", async ({ page }) => {
  const kitchenBodies: Record<string, unknown>[] = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role: "staff", username: "kitchen", permissions: {} } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (url.pathname === "/api/food/kitchen") {
      const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      kitchenBodies.push(body);
      if (body.action === "listOrders") {
        await route.fulfill({ json: { success: true, data: { orders: [], isBusy: false } } });
        return;
      }
      if (body.action === "getMenuItems") {
        await route.fulfill({
          json: {
            success: true,
            data: {
              items: [{
                id: 7,
                categoryId: 1,
                name: "Masala Dosa",
                nameKannada: "",
                price: 10000,
                isAvailable: 1,
                trackInventory: 0,
                stockQuantity: 5,
                lowStockThreshold: 2,
              }],
              categories: [{ id: 1, name: "Snacks", nameKannada: "", icon: "🍪", isActive: 1 }],
              kannadaPrint: false,
              kannadaDisplay: false,
              approvalInKitchen: false,
            },
          },
        });
        return;
      }
      if (body.action === "toggleItemAvailability") {
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({ json: { success: true, data: {} } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/kitchen");
  await page.getByPlaceholder("Enter password").fill("e2e-kitchen");
  await page.getByRole("button", { name: "Enter Kitchen" }).click();
  await expect(page.getByRole("heading", { name: "Kitchen" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Out of Stock/i }).click();
  await expect(page.getByText("Masala Dosa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Available", exact: true }).click();
  await expect.poll(() => kitchenBodies.filter((b) => b.action === "toggleItemAvailability")).toHaveLength(1);
  expect(kitchenBodies.find((b) => b.action === "toggleItemAvailability")).toMatchObject({
    menuItemId: 7,
    isAvailable: false,
  });
});
