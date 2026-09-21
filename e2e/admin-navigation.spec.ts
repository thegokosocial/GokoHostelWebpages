import { expect, test, type Page } from "@playwright/test";

async function mockAdminApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const rawBody = route.request().postData();
    const body = rawBody ? JSON.parse(rawBody) as { action?: string } : {};
    const response = body.action === "auth"
      ? { role: "admin", permissions: {} }
      : body.action === "getBedHistory"
        ? { rows: [] }
        : body.action === "getUsers"
          ? { users: [] }
          : body.action === "getFoodSettings"
            ? { settings: {} }
            : {};

    await route.fulfill({ json: response });
  });
}

async function signInToManagement(page: Page) {
  await page.goto("/admin?section=management&tab=history");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: "Bed History" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockAdminApi(page);
});

test("mobile drawer closes from blank space, X, and navigation selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.locator("#admin-mobile-navigation");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Bookings" }).click();
  await expect(page).toHaveURL(/section=bookings/);
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.click({ position: { x: 370, y: 800 } });
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toBeHidden();
});

test("mobile Management options select their tab, including Food Settings children", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/tab=users/);
  await expect(page.getByRole("heading", { name: "Users & Permissions" })).toBeVisible();

  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Food Settings", exact: true }).click();
  await expect(page).toHaveURL(/tab=foodSettings/);
  await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Menu", exact: true }).click();
  await expect(page).toHaveURL(/tab=menu/);
  await expect(page.getByRole("tab", { name: "Menu", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Bill Settings" }).click();
  await expect(page).toHaveURL(/tab=billSettings/);
  await expect(page.getByRole("tab", { name: "Bill Settings" })).toHaveAttribute("aria-selected", "true");
});

test("desktop Management tabs still switch directly", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToManagement(page);

  await page.getByRole("button", { name: "Rates", exact: true }).click();
  await expect(page).toHaveURL(/tab=rates/);
});
