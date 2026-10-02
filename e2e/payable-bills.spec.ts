import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, viewOnly = false) {
  const calls: any[] = [];
  const bill: any = { id: 1, title: "Tiles", description: "Dorm construction", category: "Maintenance", mainCategory: "goko_expense", vendorName: "Tile supplier", billDate: "2026-09-01", dueDate: "2026-09-10", createdBy: "admin", createdAt: "2026-09-01T10:00:00Z", total: 60000, paid: 10000, remaining: 50000, status: "open", billImageLink: "https://drive.google.com/file/d/original", notes: [{ id: 1, body: "Delivered", authorUsername: "staff", createdAt: "2026-09-02T12:00:00Z" }], adjustments: [{ id: 1, amount: 10000, reason: "Extra tiles", createdBy: "admin", createdAt: "2026-09-02T11:00:00Z" }], payments: [{ id: 1, amount: 10000, expenseDate: "2026-09-02", paymentMethod: "cash", accountName: "Cash", purpose: "First payment", createdBy: "admin", createdAt: "2026-09-02T10:00:00Z" }] };
  const second = { ...bill, id: 2, title: "Paint", description: "Wall paint", status: "paid", remaining: 0, paid: 60000, notes: [], payments: [], adjustments: [], billImageLink: "" };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = JSON.parse(route.request().postData() || "{}");
    if (path === "/api/auth/login") return route.fulfill({ json: { role: viewOnly ? "staff" : "admin", username: "e2e", permissions: { canViewAccounts: true, canViewExpenses: true } } });
    if (path === "/api/auth/session") return route.fulfill({ status: 401, json: {} });
    if (path === "/api/admin/expenses") {
      calls.push(body);
      if (body.action === "listPayableBills") return route.fulfill({ json: { bills: [bill, second] } });
      if (body.action === "getPayableBill") return route.fulfill({ json: { bill: body.id === 1 ? bill : second } });
      if (body.action === "getExpenseEditOptions") return route.fulfill({ json: { accounts: [{ id: 7, name: "Bank" }], vendors: [] } });
      if (body.action === "recordPayableBillPayment") {
        if (calls.filter(call => call.action === body.action).length === 1) return route.fulfill({ status: 503, json: { error: "Temporary upload failure" } });
        bill.paid += body.amount; bill.remaining -= body.amount;
        bill.status = bill.remaining === 0 ? "paid" : "open";
        bill.payments.push({ id: 2, amount: body.amount, expenseDate: body.expenseDate, paymentMethod: body.paymentMethod, accountName: "Bank", purpose: body.paymentNote, createdBy: "e2e", createdAt: "2026-10-02T14:00:00Z", billImageLink: "https://drive.google.com/file/d/payment" });
      }
      if (body.action === "addPayableBillNote") bill.notes.push({ id: 2, body: body.body, authorUsername: "e2e", createdAt: "2026-10-02T13:00:00Z" });
      return route.fulfill({ json: { success: true, id: 3 } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/admin?section=expenditure&tab=unpaidBills");
  await page.locator("#admin-user").fill("e2e");
  await page.locator("#admin-pw").fill("pw");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unpaid Bills", exact: true })).toBeVisible();
  return calls;
}

test("mobile records show detailed bills and combined expandable activity, with isolated drafts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page);
  await page.getByRole("button", { name: "Unpaid Bills", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Accounts sections" }).getByText("Reports & Charts")).toBeVisible();
  await page.getByRole("option", { name: "Bills Payable", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add unpaid bill" })).toBeVisible();
  await page.getByRole("button", { name: "Bills Payable", exact: true }).click();
  await page.getByRole("option", { name: "Unpaid Bills", exact: true }).click();
  await expect(page).toHaveURL(/tab=unpaidBills/);
  const tile = page.locator("article").filter({ hasText: "Tiles" }).first();
  await expect(tile.getByText("Vendor: Tile supplier")).toBeVisible();
  await expect(tile.getByText(/Overdue/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tile.locator("summary").click();
  await expect(tile.locator("li").nth(0)).toContainText("Delivered");
  await expect(tile.locator("li").nth(1)).toContainText("Extra tiles");
  await expect(tile.locator("li").nth(2)).toContainText("First payment");
  await expect(tile.locator("li").nth(0).getByRole("link")).toHaveCount(0);
  await tile.getByRole("button", { name: "Add note", exact: true }).click();
  let modal = page.getByRole("dialog");
  await expect(modal.locator('input[type="file"]')).toHaveCount(0);
  await modal.getByLabel("Note", { exact: true }).fill("Supplier confirmed");
  await modal.getByRole("button", { name: "Save note" }).click();
  await expect(modal.locator("li").first()).toContainText("Supplier confirmed");
  await modal.getByRole("button", { name: "Make payment", exact: true }).click();
  await modal.getByLabel("Amount (₹)", { exact: true }).fill("12");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Show paid").check();
  await page.locator("article").filter({ hasText: "Paint" }).getByRole("button", { name: "View bill" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await tile.getByRole("button", { name: "Make payment" }).click();
  modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Amount (₹)", { exact: true })).toHaveValue("");
  await expect(modal.getByLabel("Payment note *")).toHaveValue("");
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await modal.getByLabel("Amount (₹)", { exact: true }).fill("500");
  await modal.getByLabel("Method", { exact: true }).selectOption("online");
  await modal.getByLabel("Account", { exact: true }).selectOption("7");
  await modal.getByLabel("Payment note *").fill("Final installment");
  await modal.getByLabel("Add invoice files (optional)").setInputFiles([{ name: "bill.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") }, { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("png") }]);
  await modal.getByRole("button", { name: "Make payment", exact: true }).last().click();
  await expect(page.getByText("Could not record payment", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Make payment", exact: true }).last().click();
  await expect(modal.locator("li").first()).toContainText("Final installment");
  const payments = calls.filter(call => call.action === "recordPayableBillPayment");
  expect(payments).toHaveLength(2);
  expect(payments[0].idempotencyKey).toBe(payments[1].idempotencyKey);
  expect(payments[1]).toMatchObject({ amount: 50000, accountId: 7, billFiles: [{ name: "bill.pdf" }, { name: "photo.png" }] });
  await expect(modal.getByLabel("Amount (₹)", { exact: true })).toHaveCount(0);
  await expect(modal.getByRole("link", { name: "Invoice 1" }).last()).toHaveAttribute("href", "https://drive.google.com/file/d/payment");
});

test("desktop creation stays separate and view-only users cannot mutate bills", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const calls = await setup(page);
  await page.getByRole("button", { name: "Bills Payable", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add unpaid bill" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
  await page.getByLabel("Expense name *").fill("Building work");
  await page.getByLabel("Total (₹) *").fill("55000");
  await page.getByLabel("Category *", { exact: true }).selectOption("Maintenance");
  await page.getByLabel("Original invoice (optional)").setInputFiles({ name: "original.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
  await page.getByRole("button", { name: "Create unpaid bill" }).click();
  await expect(page.getByRole("button", { name: "View unpaid bills" })).toBeVisible();
  expect(calls.find(call => call.action === "createPayableBill")).toMatchObject({ originalAmount: 5500000, billFiles: [{ name: "original.pdf" }] });
  await page.getByRole("button", { name: "View unpaid bills" }).click();
  await page.getByLabel("Search unpaid bills").fill("not found");
  await expect(page.getByText("No bills match your search.")).toBeVisible();
  await page.getByLabel("Search unpaid bills").fill("supplier");
  await expect(page.locator("article")).toHaveCount(1);
  const context = await page.context().browser()!.newContext();
  const staffPage = await context.newPage();
  await setup(staffPage, true);
  await expect(staffPage.getByRole("button", { name: "Bills Payable", exact: true })).toHaveCount(0);
  await expect(staffPage.getByRole("button", { name: "Make payment" })).toHaveCount(0);
  await expect(staffPage.getByRole("button", { name: "Increase total" })).toHaveCount(0);
  await context.close();
});
