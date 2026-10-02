import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({ db: null as any, sqlite: null as any }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ authenticateUser: vi.fn(async () => ({ role: "admin", displayName: "Admin", permissions: {} })) }));
vi.mock("@/db/queries", () => ({
  addExpense: vi.fn(), getExpensesByUser: vi.fn(), getExpenseById: vi.fn(async (id: number) => state.db.select().from(schema.expenses).where(require("drizzle-orm").eq(schema.expenses.id, id)).limit(1).then((rows: any[]) => rows[0] || null)),
  getExpenseByIdempotencyKey: vi.fn(async (key: string) => state.db.select().from(schema.expenses).where(require("drizzle-orm").eq(schema.expenses.idempotencyKey, key)).limit(1).then((rows: any[]) => rows[0] || null)),
  getDailyIncomeByIdempotencyKey: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn(), addAuditEntry: vi.fn(), addSystemLog: vi.fn(), getSetting: vi.fn(), getMonthKey: vi.fn(),
}));
vi.mock("@/db/splitQueries", () => ({ hostelExpenseIsLinked: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => true, isPiRuntime: () => false }));
vi.mock("@/lib/googleApiFetch", () => ({ driveUploadFile: vi.fn(), driveGetOrCreateFolder: vi.fn(), driveDeleteFile: vi.fn() }));

import { POST } from "@/app/api/admin/expenses/route";

function req(action: string, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw", action, ...body }) });
}

describe("payable bill API workflow", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:"); sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`CREATE TABLE vendors (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, nickname TEXT, is_active INTEGER DEFAULT 1, is_virtual INTEGER DEFAULT 0);
      CREATE TABLE daily_ledger (id INTEGER PRIMARY KEY, date TEXT, account_id INTEGER, is_reconciled INTEGER DEFAULT 0);
      CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, category TEXT NOT NULL, custom_category TEXT DEFAULT '', purpose TEXT DEFAULT '', bill_image_link TEXT DEFAULT '', vendor_id INTEGER, account_id INTEGER, payment_method TEXT DEFAULT 'cash', main_category TEXT DEFAULT '', sub_category TEXT DEFAULT '', task_id INTEGER, created_by TEXT NOT NULL DEFAULT '', updated_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT '', expense_date TEXT NOT NULL DEFAULT '', created_month TEXT NOT NULL DEFAULT '', idempotency_key TEXT UNIQUE, transfer_id TEXT, transfer_method TEXT, reverses_transfer_id TEXT, sync_id TEXT, sync_updated_at TEXT, sync_source TEXT, deleted_at TEXT);`);
    sqlite.exec(readFileSync("migrations/0087_payable_bills.sql", "utf8"));
    sqlite.prepare("INSERT INTO accounts VALUES (1, 'HDFC', 'HDFC', 1, 0)").run(); state.sqlite = sqlite; state.db = drizzle(sqlite, { schema });
  });
  afterEach(() => sqlite.close());

  it("creates a non-financial bill, posts partial and final linked expenses, then reopens after correction", async () => {
    const created = await POST(req("createPayableBill", { title: "Construction", originalAmount: 5500000, category: "Maintenance", billDate: "2026-10-02" }));
    expect(created.status).toBe(200); const billId = (await created.json()).id;
    expect(sqlite.prepare("SELECT COUNT(*) count FROM expenses").get()).toMatchObject({ count: 0 });
    const partial = await POST(req("recordPayableBillPayment", { id: billId, amount: 1000000, expenseDate: "2026-10-02", paymentMethod: "online", accountId: 1, idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    expect(partial.status).toBe(200);
    expect(sqlite.prepare("SELECT amount, payable_bill_id, account_id FROM expenses").get()).toMatchObject({ amount: 1000000, payable_bill_id: billId, account_id: 1 });
    const open = await POST(req("getPayableBill", { id: billId })); expect((await open.json()).bill).toMatchObject({ paid: 1000000, remaining: 4500000, status: "open" });
    const final = await POST(req("recordPayableBillPayment", { id: billId, amount: 4500000, expenseDate: "2026-10-02", paymentMethod: "cash", idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    expect(final.status).toBe(200);
    expect((await (await POST(req("getPayableBill", { id: billId }))).json()).bill).toMatchObject({ paid: 5500000, remaining: 0, status: "paid" });
    expect((await POST(req("recordPayableBillPayment", { id: billId, amount: 1, expenseDate: "2026-10-02", paymentMethod: "cash", idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }))).status).toBe(400);
    const secondExpense = sqlite.prepare("SELECT id FROM expenses WHERE amount = 4500000").get() as { id: number };
    expect((await POST(req("deleteExpense", { id: secondExpense.id }))).status).toBe(200);
    expect((await (await POST(req("getPayableBill", { id: billId }))).json()).bill).toMatchObject({ paid: 1000000, remaining: 4500000, status: "open" });
  });
});
