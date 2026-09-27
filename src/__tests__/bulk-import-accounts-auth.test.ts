import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateSimple: vi.fn(),
  getSetting: vi.fn(async () => "[]"),
}));

vi.mock("@/lib/auth", () => ({ authenticateSimple: q.authenticateSimple }));
vi.mock("@/db/queries", () => ({
  getSetting: q.getSetting,
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  getMonthKey: vi.fn(() => "SEPTEMBER-2026"),
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

import { POST } from "@/app/api/admin/bulk-import-accounts/route";

function templateReq(action: string) {
  return new NextRequest("http://localhost/api/admin/bulk-import-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "anyone", action }),
  });
}

beforeEach(() => {
  q.authenticateSimple.mockReset();
  q.getSetting.mockResolvedValue("[]");
});

describe("Bulk import accounts auth landmine", () => {
  it("401 without authentication", async () => {
    q.authenticateSimple.mockResolvedValue(false);
    expect((await POST(templateReq("expenseTemplate"))).status).toBe(401);
  });

  it("any authenticated user can download templates (no expense/income permission gate)", async () => {
    q.authenticateSimple.mockResolvedValue(true);
    const expense = await POST(templateReq("expenseTemplate"));
    expect(expense.status).toBe(200);
    expect(expense.headers.get("Content-Type")).toMatch(/spreadsheetml/);

    const income = await POST(templateReq("incomeTemplate"));
    expect(income.status).toBe(200);
    expect(income.headers.get("Content-Type")).toMatch(/spreadsheetml/);
  });

  it("unknown action is 400 after auth", async () => {
    q.authenticateSimple.mockResolvedValue(true);
    expect((await POST(templateReq("nope"))).status).toBe(400);
  });
});
