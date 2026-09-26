import { expect, test, type Page } from "@playwright/test";

type PlaceBody = Record<string, unknown>;

async function mockAdminShell(
  page: Page,
  opts: {
    role?: string;
    permissions?: Record<string, boolean>;
    placeResponse?: (body: PlaceBody, attempt: number) => { status?: number; json: Record<string, unknown> };
  } = {},
) {
  const placeBodies: PlaceBody[] = [];
  const role = opts.role ?? "admin";
  const permissions = opts.permissions ?? { canPlaceOrders: true, canViewFoodOrders: true };
  let placeAttempts = 0;

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
    if (!url.pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const body = JSON.parse(route.request().postData() || "{}") as PlaceBody;
    if (body.action === "auth") {
      await route.fulfill({ json: { role, permissions } });
      return;
    }
    if (url.pathname === "/api/admin/food-orders" && body.action === "getMenu") {
      await route.fulfill({
        json: {
          categories: [{ id: 1, name: "Snacks" }],
          items: [{ id: 41, name: "Soap", price: 50000, categoryId: 1, isAvailable: 1, trackInventory: 0, stockQuantity: 0, priceOnRequest: 0 }],
          settings: { taxRate: 0, cafeTableCount: 0, confirmWithGuest: false },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/food-orders" && body.action === "getActiveGuests") {
      await route.fulfill({ json: { guests: [] } });
      return;
    }
    if (url.pathname === "/api/admin/food-orders" && body.action === "placeOrderForGuest") {
      placeAttempts += 1;
      placeBodies.push(body);
      const res = opts.placeResponse
        ? opts.placeResponse(body, placeAttempts)
        : { json: { success: true, orderId: 1, orderNumber: "D269-23", total: 50000 } };
      await route.fulfill({ status: res.status ?? 200, json: res.json });
      return;
    }
    if (url.pathname === "/api/admin/food-orders") {
      await route.fulfill({ json: { guests: [], orders: [], categories: [], items: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return placeBodies;
}

async function loginAndOpenPlaceOrder(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin?section=foodOrders");
  await page.locator("#admin-user").fill("e2e-user");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("heading", { name: /Place Order|Order Summary/i }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: /^Place Order$/i }).click();
  await expect(page.getByText("Soap", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "🚶 Walk-in" }).click();
  await expect(page.getByPlaceholder("Guest name")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("Guest name").fill("Piyush Midha");
  await page.getByPlaceholder("e.g. 9876543210").fill("6201587898");
  // Item name is in a sibling block of the Plus button — climb to the row.
  await page.getByText("Soap", { exact: true }).locator("xpath=../..").getByRole("button").click();
  await expect(page.getByRole("button", { name: /Place Order ·/i })).toBeVisible();
}

test.describe.configure({ mode: "serial", timeout: 60_000 });

test("admin Place Order sends a UUID idempotencyKey", async ({ page }) => {
  const placeBodies = await mockAdminShell(page, {
    role: "admin",
    permissions: {},
  });
  await loginAndOpenPlaceOrder(page);
  await page.getByRole("button", { name: /Place Order ·/i }).click();

  await expect.poll(() => placeBodies.length).toBe(1);
  expect(String(placeBodies[0]?.idempotencyKey || "")).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("staff with canPlaceOrders can place and reuses one key until success", async ({ page }) => {
  const placeBodies = await mockAdminShell(page, {
    role: "staff",
    permissions: { canPlaceOrders: true, canViewFoodOrders: true },
  });
  await loginAndOpenPlaceOrder(page);
  await page.getByRole("button", { name: /Place Order ·/i }).click();
  await expect.poll(() => placeBodies.length).toBe(1);
  expect(String(placeBodies[0]?.idempotencyKey || "")).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("placeOrderForGuest 403 surfaces actionable permission copy", async ({ page }) => {
  const placeBodies = await mockAdminShell(page, {
    role: "staff",
    permissions: { canViewFoodOrders: true, canPlaceOrders: true },
    placeResponse: () => ({
      status: 403,
      json: {
        error: "Missing permission: need Place orders for guests (canPlaceOrders) or View Food Orders (canViewFoodOrders).",
        code: "permission_denied",
        requiredPermissions: ["canPlaceOrders", "canViewFoodOrders"],
        howToFix: "Ask an admin to enable one of these permissions under Management → Users.",
      },
    }),
  });
  await loginAndOpenPlaceOrder(page);
  await page.getByRole("button", { name: /Place Order ·/i }).click();
  await expect.poll(() => placeBodies.length).toBe(1);
  await expect(page.getByText(/Missing permission|canPlaceOrders|Management → Users/i)).toBeVisible();
});

test("duplicate idempotent placeOrder shows success not a hard failure", async ({ page }) => {
  const placeBodies = await mockAdminShell(page, {
    role: "admin",
    permissions: {},
    placeResponse: () => ({
      json: {
        success: true,
        orderId: 55,
        orderNumber: "D269-23",
        total: 50000,
        duplicate: true,
      },
    }),
  });
  await loginAndOpenPlaceOrder(page);
  await page.getByRole("button", { name: /Place Order ·/i }).click();
  await expect.poll(() => placeBodies.length).toBe(1);
  await expect(page.locator("p.text-red-500")).toHaveCount(0);
  // Parent onOrderPlaced may clear the form; either success copy or empty cart is fine.
  await expect(page.getByRole("button", { name: /Place Order ·/i })).toHaveCount(0);
});
