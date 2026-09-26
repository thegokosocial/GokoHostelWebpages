import { expect, test } from "@playwright/test";
import {
  SAMPLE_ORDER,
  defaultFoodOrdersResponse,
  loginAdmin,
  mockAdminShell,
  openWalkinOrderDrawer,
} from "./helpers/foodMocks";

test.describe.configure({ timeout: 90_000 });

test("Order Summary cash pay records markOrderPaid", async ({ page }) => {
  const { foodRequests } = await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canMarkPaid: true },
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  await drawer.getByRole("button", { name: "Bill" }).click();
  await expect(drawer.getByText("Unpaid bill")).toBeVisible();
  await drawer.getByRole("button", { name: /Pay · ₹/ }).click();
  await expect(page.getByRole("heading", { name: "Record Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "markOrderPaid")).toHaveLength(1);
  expect(foodRequests.find((r) => r.action === "markOrderPaid")).toMatchObject({
    orderIds: [10],
    paymentMethod: "cash",
  });
});

test("Order Summary discount applies via Apply Discount", async ({ page }) => {
  const { foodRequests } = await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canMarkPaid: true, canApplyFoodDiscounts: true },
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  await drawer.getByRole("button", { name: "Bill" }).click();
  await expect(drawer.getByText("Unpaid bill")).toBeVisible();
  const discountBtn = drawer.getByRole("button", { name: /^Discount/ });
  await discountBtn.scrollIntoViewIfNeeded();
  await discountBtn.click();
  await expect(page.getByRole("heading", { name: "Apply Discount" })).toBeVisible({ timeout: 10_000 });
  const discountModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: "Apply Discount" }) });
  await discountModal.getByPlaceholder("0").fill("10");
  await discountModal.locator("select").selectOption("Complimentary");
  await discountModal.getByRole("button", { name: "Apply Discount" }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "applyDiscount")).toHaveLength(1);
});

test("void line item stages cancel then saveOrderEdits", async ({ page }) => {
  const { foodRequests } = await mockAdminShell(page, {
    permissions: {
      canViewFoodOrders: true,
      canViewFoodTabs: true,
      canEditFoodOrders: true,
      canVoidFoodOrders: true,
    },
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  const orderCard = drawer.locator('[data-order-id="10"]');
  await orderCard.getByRole("button", { name: "Edit food items for D265-10" }).click();
  await orderCard.locator('[title="Cancel item"]').click();
  await expect(orderCard.getByText(/Cancel "Shampoo"\?/)).toBeVisible();
  await orderCard.getByRole("button", { name: "Wrong order", exact: true }).click();
  await orderCard.getByRole("button", { name: "Cancel Item" }).last().click();
  await orderCard.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "saveOrderEdits")).toHaveLength(1);
  const save = foodRequests.find((r) => r.action === "saveOrderEdits");
  expect(save).toMatchObject({ orderId: 10 });
  expect(JSON.stringify(save?.changes || [])).toMatch(/quantity.:0|quantity":0/);
});

test("incomplete order banner is shown when items are missing", async ({ page }) => {
  const incomplete = {
    ...SAMPLE_ORDER,
    items: [] as typeof SAMPLE_ORDER.items,
    status: "placed",
  };
  await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canVoidFoodOrders: true },
    onFoodOrders: (body) => ({ json: defaultFoodOrdersResponse(body, incomplete) }),
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  await expect(drawer.getByText(/This order has no line items \(create failed\)/i)).toBeVisible();
});

test("payment correction Save reversal sends updatePaymentDetails", async ({ page }) => {
  const paid = {
    ...SAMPLE_ORDER,
    amountPaid: 40000,
    paymentStatus: "paid",
    paymentMethod: "cash",
    cashReceived: 40000,
  };
  const { foodRequests } = await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canMarkPaid: true },
    onFoodOrders: (body) => ({ json: defaultFoodOrdersResponse(body, paid) }),
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  await drawer.getByRole("button", { name: "Edit payment for D265-10" }).click();
  await expect(page.getByRole("heading", { name: "Revert mistaken payment" })).toBeVisible();
  await page.getByRole("button", { name: "Save reversal" }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "updatePaymentDetails")).toHaveLength(1);
});

test("Combined Bill preview and cash pay", async ({ page }) => {
  const { foodRequests } = await mockAdminShell(page, {
    permissions: {
      canViewFoodOrders: true,
      canViewFoodTabs: true,
      canGenerateFoodBills: true,
      canMarkPaid: true,
    },
  });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Combined Bill", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Combined Bill" })).toBeVisible();
  await page.getByText("Pawan test").click();
  await page.getByRole("button", { name: /Preview Combined Bill/ }).click();
  await expect(page.getByRole("heading", { name: "Bill Preview" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => foodRequests.some((r) => r.action === "getCombinedBill")).toBe(true);
  await page.getByRole("button", { name: /Pay · ₹/ }).click();
  await expect(page.getByRole("heading", { name: "Record Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "markOrderPaid")).toHaveLength(1);
});

test("RBAC hides pay, cancel, combined, and place when keys missing", async ({ page }) => {
  await mockAdminShell(page, {
    role: "staff",
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true },
  });
  await loginAdmin(page);
  await expect(page.getByRole("button", { name: "Order Summary", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Place Order", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Combined Bill", exact: true })).toHaveCount(0);
  const drawer = await openWalkinOrderDrawer(page);
  await expect(drawer.getByRole("button", { name: "Cancel order D265-10" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Bill" }).click();
  await expect(drawer.getByRole("button", { name: /Pay · ₹/ })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Discount", exact: true })).toHaveCount(0);
});

test("RBAC 403 on saveOrderEdits surfaces when staff cannot edit", async ({ page }) => {
  const { foodRequests } = await mockAdminShell(page, {
    role: "staff",
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canEditFoodOrders: false },
    onFoodOrders: (body, requests) => {
      if (body.action === "saveOrderEdits") {
        return {
          status: 403,
          json: {
            error: "Missing permission: need Edit food orders (canEditFoodOrders).",
            code: "permission_denied",
            requiredPermissions: ["canEditFoodOrders"],
            howToFix: "Ask an admin to enable this permission under Management → Users.",
          },
        };
      }
      return { json: defaultFoodOrdersResponse(body) };
    },
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  const orderCard = drawer.locator('[data-order-id="10"]');
  await orderCard.getByRole("button", { name: "Edit food items for D265-10" }).click();
  await orderCard.getByRole("button", { name: "+" }).click();
  await orderCard.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "saveOrderEdits")).toHaveLength(1);
  await expect(page.getByText(/Save order edits|Missing permission|canEditFoodOrders|Management → Users/i)).toBeVisible({ timeout: 10_000 });
});

test("Menu Management add item and add stock", async ({ page }) => {
  const { adminFoodRequests } = await mockAdminShell(page, {
    permissions: {
      canViewMenu: true,
      canManageMenuItems: true,
      canManageInventory: true,
      canManageMenuCategories: true,
    },
  });
  await loginAdmin(page, "management&tab=menu");
  await expect(page.getByRole("heading", { name: "Menu Management" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Add Item" }).click();
  await expect(page.getByRole("heading", { name: "Add Item" })).toBeVisible();
  await page.getByPlaceholder("e.g. Masala Dosa").fill("E2E Idli");
  await page.locator('input[type="number"][min="0"]').first().fill("80");
  await page.locator("div").filter({ has: page.getByRole("heading", { name: "Add Item" }) }).getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => adminFoodRequests.filter((r) => r.action === "addMenuItem")).toHaveLength(1);

  await page.getByRole("button", { name: "Add Stock" }).first().click();
  await page.getByPlaceholder("Qty").fill("5");
  await page.getByTitle("Confirm").click();
  await expect.poll(() => adminFoodRequests.filter((r) => r.action === "addStock")).toHaveLength(1);
});

test("Active Orders advances kitchen status via updateStatus", async ({ page }) => {
  const { kitchenRequests } = await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canEditFoodOrders: true },
  });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Active Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kitchen" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("D270-1").first()).toBeVisible();
  await page.getByRole("button", { name: "START PREPARING" }).first().click();
  await expect.poll(() => kitchenRequests.filter((r) => r.action === "updateStatus")).toHaveLength(1);
  expect(kitchenRequests.find((r) => r.action === "updateStatus")).toMatchObject({
    orderId: 42,
    status: "preparing",
    scope: "admin",
  });
});
