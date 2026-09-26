import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissionDeniedPayload } from "@/lib/actionPermissions";

const auth = vi.hoisted(() => ({ authenticateUser: vi.fn() }));
const q = vi.hoisted(() => ({
  addExpense: vi.fn(),
  getExpenseByIdempotencyKey: vi.fn(),
  getDailyIncomeByIdempotencyKey: vi.fn(),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  getSetting: vi.fn(),
  getMonthKey: vi.fn(),
  getDb: vi.fn(),
  hostelExpenseIsLinked: vi.fn(),
  addCheckin: vi.fn(),
  getCheckinByIdempotencyKey: vi.fn(),
  getActiveCheckins: vi.fn(),
  driveUploadFile: vi.fn(),
  driveGetOrCreateFolder: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: auth.authenticateUser }));
vi.mock("@/db/queries", () => ({
  addExpense: q.addExpense,
  getExpenseByIdempotencyKey: q.getExpenseByIdempotencyKey,
  getDailyIncomeByIdempotencyKey: q.getDailyIncomeByIdempotencyKey,
  addAuditEntry: q.addAuditEntry,
  addSystemLog: q.addSystemLog,
  getSetting: q.getSetting,
  getMonthKey: q.getMonthKey,
  addCheckin: q.addCheckin,
  getCheckinByIdempotencyKey: q.getCheckinByIdempotencyKey,
  getActiveCheckins: q.getActiveCheckins,
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/splitQueries", () => ({ hostelExpenseIsLinked: q.hostelExpenseIsLinked }));
vi.mock("@/lib/googleApiFetch", () => ({
  driveUploadFile: q.driveUploadFile,
  driveGetOrCreateFolder: q.driveGetOrCreateFolder,
  driveDeleteFile: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => true, isPiRuntime: () => false }));

import { POST as expensesPOST } from "@/app/api/admin/expenses/route";
import { POST as checkinsPOST } from "@/app/api/admin/checkins/route";

function expenseReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", ...body }),
  });
}

function checkinReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  auth.authenticateUser.mockReset();
  q.getExpenseByIdempotencyKey.mockResolvedValue(null);
  q.getDailyIncomeByIdempotencyKey.mockResolvedValue(null);
  q.getCheckinByIdempotencyKey.mockResolvedValue(null);
  q.addAuditEntry.mockResolvedValue(undefined);
  q.addSystemLog.mockResolvedValue(undefined);
  q.getSetting.mockResolvedValue("[]");
  q.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [], orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
  });
});

describe("permissionDeniedPayload", () => {
  it("names catalog labels and how to fix for OR-list creates", () => {
    const body = permissionDeniedPayload(["canPlaceOrders", "canViewFoodOrders"]);
    expect(body.code).toBe("permission_denied");
    expect(body.requiredPermissions).toEqual(["canPlaceOrders", "canViewFoodOrders"]);
    expect(body.error).toMatch(/Place orders for guests \(canPlaceOrders\)/);
    expect(body.error).toMatch(/View Food Orders \(canViewFoodOrders\)/);
    expect(body.howToFix).toMatch(/Management → Users/);
  });

  it("names a single required key for expense create", () => {
    const body = permissionDeniedPayload("canAddExpense");
    expect(body.requiredPermissions).toEqual(["canAddExpense"]);
    expect(body.error).toMatch(/Add expenses \(canAddExpense\)/);
  });
});

describe("create actions return actionable 403 for staff", () => {
  it("addExpense without canAddExpense", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timo",
      permissions: { canViewExpenses: true },
    });
    const res = await expensesPOST(expenseReq({
      action: "addExpense",
      amount: 10000,
      category: "Groceries",
      subCategory: "Groceries",
      purpose: "milk",
      paymentMethod: "cash",
      expenseDate: "2026-09-26",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "permission_denied",
      requiredPermissions: ["canAddExpense"],
    });
    expect(body.howToFix).toMatch(/Management → Users/);
    expect(q.addExpense).not.toHaveBeenCalled();
  });

  it("addDailyIncome without canAddIncome", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timo",
      permissions: { canViewAccounts: true },
    });
    const res = await expensesPOST(expenseReq({
      action: "addDailyIncome",
      amount: 50000,
      category: "stay",
      incomeDate: "2026-09-26",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermissions).toEqual(["canAddIncome"]);
    expect(body.error).toMatch(/canAddIncome/);
  });

  it("checkin add without canAddCheckin", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Timo",
      permissions: { canViewRecords: true },
    });
    const res = await checkinsPOST(checkinReq({
      action: "add",
      name: "Guest",
      contact: "9876543210",
      nationality: "India",
      idType: "passport",
      arrivalDate: "2026-09-26",
      stayingDays: "2",
      comingFrom: "Goa",
      numberOfPersons: "1",
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermissions).toEqual(["canAddCheckin"]);
    expect(body.error).toMatch(/canAddCheckin/);
    expect(body.howToFix).toMatch(/Management → Users/);
    expect(q.addCheckin).not.toHaveBeenCalled();
  });

  it("env manager with empty permissions is forbidden with clear keys (not silent)", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Manager",
      permissions: {},
    });
    const res = await expensesPOST(expenseReq({
      action: "addExpense",
      amount: 1000,
      category: "Groceries",
      subCategory: "Groceries",
      purpose: "x",
      paymentMethod: "cash",
      expenseDate: "2026-09-26",
      idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "permission_denied",
      requiredPermissions: ["canAddExpense"],
    });
  });
});
