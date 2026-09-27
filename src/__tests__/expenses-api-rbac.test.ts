import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ authenticateUser: vi.fn() }));
const q = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getExpensesByUser: vi.fn(),
  getDb: vi.fn(),
  hostelExpenseIsLinked: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: auth.authenticateUser }));
vi.mock("@/db/queries", () => ({
  addExpense: vi.fn(),
  getExpensesByUser: q.getExpensesByUser,
  getExpenseById: vi.fn(),
  getExpenseByIdempotencyKey: vi.fn(),
  getDailyIncomeByIdempotencyKey: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  getSetting: q.getSetting,
  getMonthKey: vi.fn(() => "SEPTEMBER-2026"),
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

function request(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "staff1", action, ...extra }),
  });
}

function listDb() {
  const rows: unknown[] = [];
  const ordered = {
    orderBy: async () => rows,
    limit: async () => rows,
  };
  const joined = {
    leftJoin: () => joined,
    where: () => ordered,
    orderBy: async () => rows,
  };
  return {
    select: () => ({
      from: () => joined,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  q.getSetting.mockResolvedValue("[]");
  q.getExpensesByUser.mockResolvedValue([]);
  q.hostelExpenseIsLinked.mockResolvedValue(false);
  q.getDb.mockReturnValue(listDb());
});

describe("Expenses API RBAC (route)", () => {
  it("canViewExpenses lists and getMyExpenses but cannot add or delete", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Viewer",
      permissions: { canViewExpenses: true },
    });
    expect((await POST(request("listExpenses", { fromDate: "2026-09-01", toDate: "2026-09-27" }))).status).toBe(200);
    expect((await POST(request("getMyExpenses"))).status).toBe(200);
    expect((await POST(request("getExpenseCategories"))).status).toBe(403);
    expect((await POST(request("deleteExpense", { id: 1 }))).status).toBe(403);
  });

  it("canAddExpense reads categories but cannot list or delete", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Adder",
      permissions: { canAddExpense: true },
    });
    expect((await POST(request("getExpenseCategories"))).status).toBe(200);
    expect((await POST(request("listExpenses", { fromDate: "2026-09-01", toDate: "2026-09-27" }))).status).toBe(403);
    expect((await POST(request("deleteExpense", { id: 1 }))).status).toBe(403);
  });

  it("getAccountActivity requires BOTH canViewAccounts and canViewExpenses (inner AND)", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "AccountsOnly",
      permissions: { canViewAccounts: true },
    });
    const accountsOnly = await POST(request("getAccountActivity", {
      accountId: "cash", fromDate: "2026-09-01", toDate: "2026-09-27",
    }));
    expect(accountsOnly.status).toBe(403);
    expect(await accountsOnly.json()).toMatchObject({
      error: expect.stringMatching(/account and expense/i),
    });

    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "ExpensesOnly",
      permissions: { canViewExpenses: true },
    });
    expect((await POST(request("getAccountActivity", {
      accountId: "cash", fromDate: "2026-09-01", toDate: "2026-09-27",
    }))).status).toBe(403);
  });

  it("canViewAccounts alone can ledger/reconcile read but not income create", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Books",
      permissions: { canViewAccounts: true },
    });
    expect((await POST(request("listIncomeRecords", { fromDate: "2026-09-01", toDate: "2026-09-27" }))).status).toBe(200);
    expect((await POST(request("getIncomeCategories"))).status).toBe(403);
    expect((await POST(request("addDailyIncome", {
      date: "2026-09-27", amount: 100, type: "cash", source: "other", description: "tip",
    }))).status).toBe(403);
  });

  it("undoReconciliation is admin_only; reconcile OR keys do not unlock undo", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Cash",
      permissions: { canReconcileCash: true, canReconcileOnline: true, canViewAccounts: true },
    });
    const undo = await POST(request("undoReconciliation", { date: "2026-09-26", target: { type: "cash" } }));
    expect(undo.status).toBe(403);
    expect(await undo.json()).toMatchObject({ error: "Admin access required" });
  });

  it("saveReconciliation without either reconcile key is forbidden", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "NoRec",
      permissions: { canViewAccounts: true },
    });
    expect((await POST(request("saveReconciliation", {
      date: "2026-09-26", target: { type: "cash" }, expectedCash: 0, expectedOnline: 0,
    }))).status).toBe(403);
  });

  it("adjustOpeningBalance needs canManageAccountSettings", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Books",
      permissions: { canViewAccounts: true, canReconcileCash: true },
    });
    expect((await POST(request("adjustOpeningBalance", {
      accountId: null, date: "2026-09-01", amount: 0,
    }))).status).toBe(403);
  });
});
