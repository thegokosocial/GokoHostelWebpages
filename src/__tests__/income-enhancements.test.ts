import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateManualIncome } from "@/lib/income";

const route = readFileSync("src/app/api/admin/expenses/route.ts", "utf8");
const form = readFileSync("src/components/admin/IncomeForm.tsx", "utf8");
const tabs = readFileSync("src/components/admin/AdminExpenditure.tsx", "utf8");
const ledger = readFileSync("src/components/admin/DailyLedger.tsx", "utf8");
const bulk = readFileSync("src/app/api/admin/bulk-import-accounts/route.ts", "utf8");

describe("manual income enhancements", () => {
  it("supports refund and required Other source detail in UI and API", () => {
    expect(form).toContain("DEFAULT_INCOME_CATEGORIES");
    expect(form).toContain('source === "other" && !sourceDetail.trim()');
    expect(validateManualIncome({ date: "2026-09-01", amount: 12550, type: "cash", source: "refund" }).value).toMatchObject({ source: "refund", amount: 12550 });
    expect(validateManualIncome({ date: "2026-09-01", amount: 500, type: "cash", source: "other" }).error).toBe("Specify the other income source");
    expect(validateManualIncome({ date: "2026-09-01", amount: 500, type: "cash", source: " OTHER ", sourceDetail: "  Scrap sale  ", description: "  Metal  " }).value).toMatchObject({ source: "other", sourceDetail: "Scrap sale", description: "Metal" });
  });

  it("keeps account and payment type synchronized and validates the invariant server-side", () => {
    expect(form).toContain('setType(value ? "online" : "cash")');
    expect(form).toContain('setAccountId("")');
    expect(form).toContain('accounts.find((account) => account.isDefault) || accounts[0]');
    expect(validateManualIncome({ date: "2026-09-01", amount: 100, type: "cash", accountId: 3, source: "stay" }).error).toBe("Cash income must use the Cash account");
    expect(validateManualIncome({ date: "2026-09-01", amount: 100, type: "online", source: "food" }).error).toBe("Select an account for online income");
    expect(validateManualIncome({ date: "2026-09-01", amount: 100, type: "online", accountId: "3", source: "food" }).value).toMatchObject({ type: "online", accountId: 3 });
    expect(route).toContain('eq(accounts.isActive, 1)');
  });

  it("rejects malformed dates, amounts, sources, and misplaced details", () => {
    const base = { date: "2026-09-01", amount: 100, type: "cash", source: "stay" };
    expect(validateManualIncome({ ...base, date: "2026-02-29" }).error).toBe("A valid date is required");
    expect(validateManualIncome({ ...base, date: "2024-02-29" }).value?.date).toBe("2024-02-29");
    expect(validateManualIncome({ ...base, amount: 1.5 }).error).toContain("positive integer");
    expect(validateManualIncome({ ...base, source: "donation" }).error).toBe("Invalid income source");
    expect(validateManualIncome({ ...base, sourceDetail: "not allowed" }).error).toBe("Source detail is only valid for Other income");
  });

  it("separates add, ledger, expense records, and income records by permission", () => {
    expect(tabs).toContain('{ id: "addIncome", label: "Add Income"');
    expect(tabs).toContain('{ id: "dailyLedger", label: "Daily Ledger"');
    expect(tabs).toContain('permission: "canViewAccounts"');
    expect(tabs).toContain('{ id: "billRecords", label: "Expense Records"');
    expect(tabs).toContain('{ id: "incomeRecords", label: "Income Records"');
    expect(ledger).toContain('hasPermission(role, permissions, "canAddIncome")');
    expect(route).toContain('deleteDailyIncome: "canDeleteExpense"');
    expect(route).toContain('getIncomeAccounts: "canAddIncome"');
    expect(readFileSync("src/components/admin/AdminAddIncome.tsx", "utf8")).toContain('action: "getIncomeAccounts"');
  });

  it("keeps bulk import rules consistent with manual entry", () => {
    expect(bulk).toContain('parseIncomeCategories(await getSetting("income_categories"))');
    expect(bulk).toContain('source_detail is required when source is other');
    expect(bulk).toContain('Online income requires an account_name');
    expect(bulk).toContain('dailyIncome.sourceDetail');
  });

  it("protects reconciled balances and retains historical accounts in reporting", () => {
    expect(route).toContain('Undo reconciliation before adding income');
    expect(route).toContain('Undo reconciliation before deleting income');
    expect(route).toContain('entry[0].accountId === null ? isNull(dailyLedger.accountId)');
    expect(route).toContain('.from(accounts).orderBy(accounts.name)');
    expect(route).toContain('new Set([month, ...monthRows.map');
  });

  it("uses the entered expense date for accounting instead of creation time", () => {
    const form = readFileSync("src/components/admin/AdminAddExpense.tsx", "utf8");
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const migration = readFileSync("migrations/0054_expense_date.sql", "utf8");
    expect(form).toContain('type="date"');
    expect(form).toContain("expenseDate");
    expect(route).toContain("expenseDate must be a valid non-future date");
    expect(route).toContain("eq(expenses.expenseDate, date)");
    expect(schema).toContain('expenseDate: text("expense_date")');
    expect(migration).toContain("UPDATE expenses SET expense_date = substr(created_at, 1, 10)");
  });
});
