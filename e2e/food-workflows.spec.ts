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
  page.on("dialog", (dialog) => dialog.accept());
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
  await expect(discountModal.getByRole("button", { name: "Fixed Amount" })).toHaveClass(/border-purple-600/);
  await discountModal.getByRole("button", { name: "Percentage" }).click();
  await discountModal.getByPlaceholder("0").fill("101");
  await expect(discountModal.getByText("max discount % can be 100 itself.")).toBeVisible();
  await expect(discountModal.getByRole("button", { name: "Apply Discount" })).toBeDisabled();
  await discountModal.getByPlaceholder("0").fill("10");
  await discountModal.locator("select").selectOption("Complimentary");
  await discountModal.getByRole("button", { name: "Apply Discount" }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "applyDiscount")).toHaveLength(1);
  expect(foodRequests.find((r) => r.action === "applyDiscount")?.orderIds).toEqual([10]);
});

test("Order Summary Remove Discount clears zero-collection discounts", async ({ page }) => {
  const discounted = {
    ...SAMPLE_ORDER,
    discount: 20000,
    discountReason: "Complimentary",
    discountBy: "timo",
    subtotal: 0,
    tax: 0,
    total: 0,
    amountPaid: 0,
    paymentStatus: "paid" as const,
  };
  const { foodRequests } = await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canMarkPaid: true, canApplyFoodDiscounts: true },
    onFoodOrders: (body) => {
      if (body.action === "getWalkinOrders") return { json: { orders: [discounted] } };
      if (body.action === "listOrders" && body.status === "all_history") return { json: { orders: [discounted] } };
      return null;
    },
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  await drawer.getByRole("button", { name: "Bill" }).click();
  await expect(drawer.getByRole("button", { name: /^Discount/ })).toBeVisible({ timeout: 10_000 });
  await drawer.getByRole("button", { name: /^Discount/ }).click();
  await expect(page.getByRole("heading", { name: "Apply Discount" })).toBeVisible({ timeout: 10_000 });
  const discountModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: "Apply Discount" }) });
  await discountModal.getByRole("button", { name: "Remove Discount" }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "removeDiscount")).toHaveLength(1);
  expect(foodRequests.find((r) => r.action === "removeDiscount")).toMatchObject({ orderIds: [10] });
});

test("Order More keeps Ordering for guest on Place Order", async ({ page }) => {
  await mockAdminShell(page, {
    permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canPlaceOrders: true, canMarkPaid: true },
  });
  await loginAdmin(page);
  const drawer = await openWalkinOrderDrawer(page);
  await drawer.getByRole("button", { name: "Order More" }).click();
  await expect(page.getByRole("heading", { name: "Place Order" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ordering for")).toBeVisible();
  await expect(page.getByText("Pawan test").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Change guest" })).toBeVisible();
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

for (const qrMode of ["static", "razorpay_test", "razorpay_live"] as const) {
  test(`Set price persists and opens Bill in ${qrMode} mode`, async ({ page }) => {
    let finalized = false;
    const pending = {
      ...SAMPLE_ORDER,
      total: 0,
      subtotal: 0,
      paymentStatus: "paid" as const,
      items: [{ ...SAMPLE_ORDER.items[0], itemPrice: 0, lineTotal: 0, pricingStatus: "pending" }],
    };
    const priced = {
      ...pending,
      total: 500,
      subtotal: 500,
      paymentStatus: "pending" as const,
      items: [{ ...pending.items[0], itemPrice: 500, lineTotal: 1000, pricingStatus: "fixed", notes: "Market" }],
    };
    const { foodRequests, foodPaymentRequests } = await mockAdminShell(page, {
      permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canEditFoodOrders: true, canGenerateFoodBills: true },
      onAdminFood: (body) => body.action === "getBillBranding"
        ? { json: { settings: { food_bill_qr_mode: qrMode } } }
        : null,
      onFoodPayments: (body) => body.action === "ensureFoodQr"
        ? { json: { attempt: { id: "attempt-e2e", state: "active", imageUrl: "https://example.com/qr.png", amountPaise: 500, paymentMethodLabel: "Pay exact amount via UPI" } } }
        : { json: { success: true } },
      onFoodOrders: (body) => {
        if (body.action === "setFoodOrderItemPrice") {
          expect(body).toMatchObject({ orderId: 10, orderItemId: 20, price: 500, label: "Market" });
          finalized = true;
          return { json: { success: true, total: 500 } };
        }
        return { json: defaultFoodOrdersResponse(body, finalized ? priced : pending) };
      },
    });

    await loginAdmin(page);
    const drawer = await openWalkinOrderDrawer(page);
    await drawer.getByRole("button", { name: "Bill" }).click();
    await expect(drawer.getByText(/set price before opening bill/i)).toBeVisible();
    await drawer.getByRole("button", { name: "Set price" }).click();
    await page.getByLabel("Price per unit (₹)").fill("5");
    await page.getByRole("button", { name: "Market", exact: true }).click();
    await page.getByRole("button", { name: "Save price" }).click();
    await expect.poll(() => foodRequests.filter((request) => request.action === "setFoodOrderItemPrice")).toHaveLength(1);
    await expect(drawer.getByText(/set price before opening bill/i)).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Set price" })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Bill" }).click();
    await expect(drawer.getByText("Unpaid bill")).toBeVisible();
    if (qrMode === "static") {
      await expect.poll(() => foodPaymentRequests.filter((request) => request.action === "ensureFoodQr")).toHaveLength(0);
    } else {
      await expect.poll(() => foodPaymentRequests.filter((request) => request.action === "ensureFoodQr")).toHaveLength(1);
      expect(foodPaymentRequests.find((request) => request.action === "ensureFoodQr")).toMatchObject({ orderIds: [10] });
    }
  });

  test(`Set price failure keeps the pending-price block in ${qrMode} mode`, async ({ page }) => {
    const pending = {
      ...SAMPLE_ORDER,
      total: 0,
      subtotal: 0,
      paymentStatus: "paid" as const,
      items: [{ ...SAMPLE_ORDER.items[0], itemPrice: 0, lineTotal: 0, pricingStatus: "pending" }],
    };
    const { foodRequests, foodPaymentRequests } = await mockAdminShell(page, {
      permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canEditFoodOrders: true, canGenerateFoodBills: true },
      onAdminFood: (body) => body.action === "getBillBranding"
        ? { json: { settings: { food_bill_qr_mode: qrMode } } }
        : null,
      onFoodOrders: (body) => body.action === "setFoodOrderItemPrice"
        ? { status: 409, json: { error: "Already paid via Razorpay" } }
        : { json: defaultFoodOrdersResponse(body, pending) },
    });

    await loginAdmin(page);
    const drawer = await openWalkinOrderDrawer(page);
    await drawer.getByRole("button", { name: "Set price" }).click();
    await page.getByLabel("Price per unit (₹)").fill("5");
    await page.getByRole("button", { name: "Save price" }).click();
    await expect.poll(() => foodRequests.filter((request) => request.action === "setFoodOrderItemPrice")).toHaveLength(1);
    await expect(page.getByRole("heading", { name: "Set final price" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Set price" })).toBeVisible();
    await expect(drawer.getByText(/set price before opening bill/i)).toBeVisible();
    await expect.poll(() => foodPaymentRequests.filter((request) => request.action === "ensureFoodQr")).toHaveLength(0);
  });
}

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
  await page.getByRole("checkbox", { name: /Pawan test/ }).check();
  await page.getByRole("button", { name: /Preview Combined Bill/ }).click();
  await expect(page.getByRole("heading", { name: "Bill Preview" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => foodRequests.some((r) => r.action === "getCombinedBill")).toBe(true);
  await page.getByRole("button", { name: /Pay · ₹/ }).click();
  await expect(page.getByRole("heading", { name: "Record Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => foodRequests.filter((r) => r.action === "markOrderPaid")).toHaveLength(1);
});

for (const scenario of [
  {
    name: "static mode keeps the configured static QR without minting Razorpay",
    mode: "static" as const,
    expectEnsure: false,
    caption: "PhonePe static QR",
  },
  {
    name: "Razorpay mode mints an exact-total QR for the combined orders",
    mode: "razorpay_live" as const,
    expectEnsure: true,
    caption: "Razorpay UPI · exact amount",
  },
  {
    name: "Razorpay failure visibly falls back to the configured static QR",
    mode: "razorpay_live" as const,
    expectEnsure: true,
    caption: "Razorpay unavailable · PhonePe static QR",
    ensureError: true,
  },
] as const) {
  test(`Combined Bill QR: ${scenario.name}`, async ({ page }) => {
    const { foodPaymentRequests } = await mockAdminShell(page, {
      permissions: { canViewFoodOrders: true, canViewFoodTabs: true, canGenerateFoodBills: true },
      onAdminFood: (body) => body.action === "getBillBranding"
        ? {
          json: {
            settings: {
              food_bill_qr_mode: scenario.mode,
              food_bill_payment_qr_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
              food_bill_upi_id: "goko@ybl",
            },
          },
        }
        : null,
      onFoodPayments: (body) => body.action === "ensureFoodQr"
        ? scenario.ensureError
          ? { status: 503, json: { error: "Razorpay is unavailable" } }
          : {
            json: {
              attempt: {
                attemptId: "11111111-2222-3333-4444-555555555555",
                state: "active",
                upiIntent: "upi://pay?pa=goko.razorpay@hdfcbank&am=400.00&cu=INR",
                amountPaise: 40000,
                closeBy: "2099-01-01T00:00:00.000Z",
              },
            },
          }
        : null,
    });
    await loginAdmin(page);
    await page.getByRole("button", { name: "Combined Bill", exact: true }).click();
    await page.getByRole("checkbox", { name: /Pawan test/ }).check();
    await page.getByRole("button", { name: /Preview Combined Bill/ }).click();

    await expect(page.getByRole("heading", { name: "Bill Preview" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(scenario.caption)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Pay ₹400\.00 via UPI/)).toBeVisible();
    if (scenario.expectEnsure) {
      await expect.poll(() => foodPaymentRequests.filter((r) => r.action === "ensureFoodQr").length).toBe(1);
      expect(foodPaymentRequests.find((r) => r.action === "ensureFoodQr")).toMatchObject({ orderIds: [10] });
    } else {
      expect(foodPaymentRequests.filter((r) => r.action === "ensureFoodQr")).toHaveLength(0);
    }
  });
}

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
