import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "fs";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  addExpense: vi.fn(),
  getExpenseByIdempotencyKey: vi.fn(),
  getDailyIncomeByIdempotencyKey: vi.fn(),
  getExpenseById: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  getExpensesByUser: vi.fn(),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  getSetting: vi.fn(),
  getMonthKey: vi.fn(),
  getDb: vi.fn(),
  hostelExpenseIsLinked: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  addExpense: q.addExpense,
  getExpenseByIdempotencyKey: q.getExpenseByIdempotencyKey,
  getDailyIncomeByIdempotencyKey: q.getDailyIncomeByIdempotencyKey,
  getExpenseById: q.getExpenseById,
  updateExpense: q.updateExpense,
  deleteExpense: q.deleteExpense,
  getExpensesByUser: q.getExpensesByUser,
  addAuditEntry: q.addAuditEntry,
  addSystemLog: q.addSystemLog,
  getSetting: q.getSetting,
  getMonthKey: q.getMonthKey,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/splitQueries", () => ({ hostelExpenseIsLinked: q.hostelExpenseIsLinked }));
vi.mock("@/lib/googleApiFetch", () => ({
  driveUploadFile: vi.fn(),
  driveGetOrCreateFolder: vi.fn(),
  driveDeleteFile: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => true, isPiRuntime: () => false }));

import { POST } from "@/app/api/admin/expenses/route";

const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  q.getExpenseByIdempotencyKey.mockResolvedValue(null);
  q.getDailyIncomeByIdempotencyKey.mockResolvedValue(null);
  q.addExpense.mockResolvedValue(91);
  q.addAuditEntry.mockResolvedValue(undefined);
  q.addSystemLog.mockResolvedValue(undefined);
  q.getSetting.mockResolvedValue(JSON.stringify([{ id: "stay", label: "Stay" }]));
  q.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 77 }],
      }),
    }),
  });
});

describe("expense / income create idempotency", () => {
  it("addExpense returns duplicate without a second insert", async () => {
    q.getExpenseByIdempotencyKey.mockResolvedValue({ id: 44, amount: 10000 });
    const res = await POST(req({
      action: "addExpense",
      amount: 10000,
      category: "Groceries",
      subCategory: "Groceries",
      purpose: "milk",
      paymentMethod: "cash",
      expenseDate: "2026-09-26",
      idempotencyKey: KEY,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, id: 44, duplicate: true });
    expect(q.addExpense).not.toHaveBeenCalled();
  });

  it("addExpense requires idempotencyKey", async () => {
    const res = await POST(req({
      action: "addExpense",
      amount: 10000,
      category: "Groceries",
      paymentMethod: "cash",
      expenseDate: "2026-09-26",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "idempotencyKey required" });
  });

  it("addExpense stores the key on create", async () => {
    const res = await POST(req({
      action: "addExpense",
      amount: 10000,
      category: "Groceries",
      subCategory: "Groceries",
      purpose: "milk",
      paymentMethod: "cash",
      expenseDate: "2026-09-26",
      idempotencyKey: KEY,
    }));
    expect(res.status).toBe(200);
    expect(q.addExpense).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: KEY, amount: 10000 }));
  });

  it("addDailyIncome returns duplicate on key hit", async () => {
    q.getDailyIncomeByIdempotencyKey.mockResolvedValue({ id: 9, amount: 5000 });
    const res = await POST(req({
      action: "addDailyIncome",
      date: "2026-09-26",
      type: "cash",
      accountId: null,
      amount: 5000,
      source: "stay",
      sourceDetail: "",
      description: "cash",
      idempotencyKey: KEY,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, id: 9, duplicate: true });
  });

  it("clients mint a stable create key", () => {
    const expense = fs.readFileSync("src/components/admin/AdminAddExpense.tsx", "utf8");
    const income = fs.readFileSync("src/components/admin/IncomeForm.tsx", "utf8");
    expect(expense).toMatch(/useState\(\(\) => crypto\.randomUUID\(\)\)/);
    expect(expense).toMatch(/idempotencyKey,/);
    expect(income).toMatch(/useState\(\(\) => crypto\.randomUUID\(\)\)/);
    expect(income).toMatch(/idempotencyKey,/);
  });
});
