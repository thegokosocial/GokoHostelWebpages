import { expect, test, type Page } from "@playwright/test";

const ATTEMPT_ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_CREATING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type FoodPayBody = { action?: string; attemptId?: string };

async function mockRazorpayPaymentsAdmin(page: Page) {
  type AttemptRow = {
    id: string;
    state: string;
    environment: string;
    paymentAmountPaise: number;
    qrCodeId: string | null;
    guestName: string;
    guestPhone: string;
    createdAt: string;
    closeBy: string | null;
    foodOrderIds: string;
    payments: Array<{ id: string; status: string; captured: number; amountPaise: number }>;
  };
  let attempts: AttemptRow[] = [
    {
      id: ATTEMPT_ACTIVE,
      state: "active",
      environment: "test",
      paymentAmountPaise: 200,
      qrCodeId: "qr_abc123",
      guestName: "Pawan test",
      guestPhone: "123454321",
      createdAt: "2026-09-27T17:19:26.000Z",
      closeBy: "2026-10-04T17:19:26.000Z",
      foodOrderIds: "[68]",
      payments: [],
    },
    {
      id: ATTEMPT_CREATING,
      state: "creating",
      environment: "test",
      paymentAmountPaise: 455400,
      qrCodeId: null,
      guestName: "Manu",
      guestPhone: "1122334455",
      createdAt: "2026-09-27T15:33:19.000Z",
      closeBy: null,
      foodOrderIds: "[70]",
      payments: [],
    },
  ];

  const calls: FoodPayBody[] = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role: "admin", username: "e2e-user", permissions: {} } });
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
    const body = JSON.parse(route.request().postData() || "{}") as FoodPayBody & { action?: string };
    if (body.action === "auth") {
      await route.fulfill({ json: { role: "admin", permissions: {} } });
      return;
    }
    if (url.pathname === "/api/admin/food-payments") {
      calls.push(body);
      if (body.action === "listFoodQrAttempts") {
        await route.fulfill({ json: { attempts } });
        return;
      }
      if (body.action === "reconcileFoodQrAttempt") {
        const row = attempts.find((a) => a.id === body.attemptId);
        if (!row?.qrCodeId) {
          await route.fulfill({ status: 400, json: { error: "No gateway QR yet" } });
          return;
        }
        await route.fulfill({ json: { attempt: { ...row, state: "active" } } });
        return;
      }
      if (body.action === "closeActiveFoodQr") {
        attempts = attempts.map((a) =>
          a.id === body.attemptId ? { ...a, state: "closed", qrCodeId: a.qrCodeId } : a,
        );
        await route.fulfill({ json: { releasedAttemptIds: [body.attemptId] } });
        return;
      }
      await route.fulfill({ json: {} });
      return;
    }
    // Minimal stubs for Management shell
    if (body.action === "getSettings" || body.action === "listDorms") {
      await route.fulfill({ json: { dorms: [], settings: {} } });
      return;
    }
    await route.fulfill({ json: { success: true } });
  });

  return { calls, getAttempts: () => attempts };
}

async function openFoodLedger(page: Page) {
  await page.goto("/admin?section=management&tab=razorpayPayments");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("tab", { name: "Food", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Food payments" })).toBeVisible({ timeout: 15_000 });
}

test.describe("Food Razorpay payments ledger", () => {
  test("Reconcile and Retire QR on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { calls } = await mockRazorpayPaymentsAdmin(page);
    await openFoodLedger(page);

    await expect(page.getByText("Pawan test")).toBeVisible();
    await expect(page.getByText("Manu")).toBeVisible();
    await expect(page.getByText("Retire QR").first()).toBeVisible();
    await expect(page.getByText(/Retire QR cancels an unpaid open QR/i)).toBeVisible();

    // Creating row has no qrCodeId — Reconcile disabled; Retire still available
    const retireButtons = page.getByRole("button", { name: "Retire QR" });
    await expect(retireButtons).toHaveCount(2);

    await page.getByRole("button", { name: "Reconcile" }).first().click();
    await expect.poll(() => calls.some((c) => c.action === "reconcileFoodQrAttempt")).toBe(true);

    await retireButtons.first().click();
    await expect.poll(() => calls.some((c) => c.action === "closeActiveFoodQr")).toBe(true);
    await expect(page.getByText(/QR retired/i)).toBeVisible({ timeout: 5000 });
  });

  test("desktop Food tab lists Outcome and search", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockRazorpayPaymentsAdmin(page);
    await openFoodLedger(page);

    await expect(page.getByRole("columnheader", { name: "Outcome" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Orders" })).toBeVisible();
    await page.getByPlaceholder(/Guest, phone, order id/i).fill("Manu");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Manu")).toBeVisible();
    await expect(page.getByText("Pawan test")).toHaveCount(0);
  });
});
