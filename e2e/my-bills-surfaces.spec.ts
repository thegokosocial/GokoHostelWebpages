import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const UNPAID = {
  id: 101,
  orderNumber: "G100-1",
  status: "served",
  guestType: "walkin",
  guestName: "Vishakh Vishakh",
  roomInfo: null,
  subtotal: 386000,
  tax: 0,
  total: 386000,
  amountPaid: 0,
  discount: 0,
  paymentStatus: "on_tab",
  paymentMethod: null,
  createdAt: "2026-09-27T09:00:00.000Z",
  checkinId: null,
  items: [
    { menuItemId: 1, name: "Pineapple Juice", quantity: 1, price: 12000, lineTotal: 12000 },
    { menuItemId: 2, name: "Watermelon Juice", quantity: 1, price: 12000, lineTotal: 12000 },
    { menuItemId: 3, name: "Staff Food", quantity: 3, price: 15000, lineTotal: 45000 },
  ],
};

const PAID = {
  ...UNPAID,
  id: 202,
  orderNumber: "G090-1",
  total: 450000,
  subtotal: 450000,
  amountPaid: 450000,
  paymentStatus: "paid",
  paymentMethod: "cash",
  createdAt: "2026-09-17T08:39:00.000Z",
  items: [{ menuItemId: 9, name: "Old Tab Item", quantity: 1, price: 450000, lineTotal: 450000 }],
};

const BRANDING_STATIC = {
  hostelName: "Goko Hostel",
  location: "Gokarna, Karnataka",
  accent: "#E67E22",
  upiId: "thegokosocial@ybl",
  qrUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  footer: "Thanks for dining with us! Visit again",
  taxRate: 0,
  qrMode: "static",
};

const BRANDING_RZP = { ...BRANDING_STATIC, qrMode: "razorpay_test", qrUrl: "", upiId: "" };

async function mockBillsApis(
  page: Page,
  opts: {
    viaToken?: boolean;
    qrMode?: "static" | "razorpay_test";
    unpaid?: typeof UNPAID[];
    paid?: typeof PAID[];
    qrEnsure?: { status?: number; json: Record<string, unknown> };
  } = {},
) {
  const viaToken = !!opts.viaToken;
  const unpaid = opts.unpaid ?? [UNPAID];
  const paid = opts.paid ?? [PAID];
  const branding = opts.qrMode === "razorpay_test" ? BRANDING_RZP : BRANDING_STATIC;
  const qrCalls: Record<string, unknown>[] = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/food/bills" && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          unpaidOrders: unpaid,
          paidOrders: paid,
          billBranding: branding,
          viaToken,
          phone: viaToken ? undefined : "9876543210",
        },
      });
      return;
    }
    if (url.pathname === "/api/food/bills/qr" && route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      qrCalls.push(body);
      const res = opts.qrEnsure ?? {
        json: {
          attempt: {
            attemptId: "11111111-2222-3333-4444-555555555555",
            state: "active",
            imageUrl: BRANDING_STATIC.qrUrl,
            closeBy: "2099-01-01T00:00:00.000Z",
            amountPaise: 386000,
            paymentMethodLabel: "razorpay_test",
          },
        },
      };
      await route.fulfill({ status: res.status ?? 200, json: res.json });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return { qrCalls };
}

test.describe("My Bills guest surfaces (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("menu phone lookup shows items only — no QR, no paid history, no spend summary", async ({ page }) => {
    const { qrCalls } = await mockBillsApis(page, { viaToken: false, qrMode: "razorpay_test" });
    await page.goto("/my-bills?phone=9876543210", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Pineapple Juice")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Grand Total")).toBeVisible();
    await expect(page.getByText("Payment QR")).toHaveCount(0);
    await expect(page.getByText("Pay", { exact: false }).filter({ hasText: "via UPI" })).toHaveCount(0);
    await expect(page.getByText("thegokosocial@ybl")).toHaveCount(0);
    await expect(page.getByText("Total Spent")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Paid" })).toHaveCount(0);
    await expect(page.getByText("Old Tab Item")).toHaveCount(0);
    await expect(page.getByText("Shared bill link")).toHaveCount(0);
    expect(qrCalls).toHaveLength(0);
  });

  test("share token shows open tab through static pay QR — no paid history", async ({ page }) => {
    const { qrCalls } = await mockBillsApis(page, { viaToken: true, qrMode: "static" });
    await page.goto("/my-bills?t=opaque-share-token-xyz", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Open tab" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Pineapple Juice")).toBeVisible();
    await expect(page.getByAltText("Payment QR")).toBeVisible();
    await expect(page.getByText(/via UPI/)).toBeVisible();
    await expect(page.getByText("thegokosocial@ybl")).toBeVisible();
    await expect(page.getByText("Total Spent")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Paid" })).toHaveCount(0);
    await expect(page.getByText("Old Tab Item")).toHaveCount(0);
    // static mode must not call ensure
    expect(qrCalls).toHaveLength(0);
  });

  test("share token + razorpay mode ensures dynamic QR once", async ({ page }) => {
    const { qrCalls } = await mockBillsApis(page, { viaToken: true, qrMode: "razorpay_test" });
    await page.goto("/my-bills?t=opaque-share-token-xyz", { waitUntil: "domcontentloaded" });

    await expect(page.getByAltText("Payment QR")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/exact amount|via UPI/)).toBeVisible();
    await expect.poll(() => qrCalls.length).toBeGreaterThanOrEqual(1);
    expect(qrCalls[0]).toMatchObject({ action: "ensure" });
    expect(qrCalls[0].orderIds).toEqual([101]);
    expect(qrCalls[0].token).toBe("opaque-share-token-xyz");
    expect(qrCalls[0]).not.toHaveProperty("amountPaise");
  });

  test("share token paid ensure response shows Razorpay received, not dead QR", async ({ page }) => {
    await mockBillsApis(page, {
      viaToken: true,
      qrMode: "razorpay_test",
      qrEnsure: { status: 409, json: { paid: true, error: "Nothing unpaid on these orders" } },
    });
    await page.goto("/my-bills?t=opaque-share-token-xyz", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Already paid")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByAltText("Payment QR")).toHaveCount(0);
  });

  test("empty open tab copy when only paid orders exist", async ({ page }) => {
    await mockBillsApis(page, { viaToken: false, unpaid: [], paid: [PAID] });
    await page.goto("/my-bills?phone=9876543210", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("No open tab — all settled")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Old Tab Item")).toHaveCount(0);
  });
});
