import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/queries", () => ({}));

import { POST } from "@/app/api/admin/food-orders/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/food-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action: "listOrders", ...body }),
  });
}

describe("Payment History", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  });

  it("returns paid order headers without querying modification badges", async () => {
    const orders = [{ id: 77, orderNumber: "F-77", guestName: "Paid Guest", paymentStatus: "paid", total: 50000 }];
    const limit = vi.fn(async () => orders);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn((_condition: unknown) => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    mocks.getDb.mockReturnValue({ select });

    const response = await POST(request({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-21",
      includeItems: false,
      includeModifications: false,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orders: [{ id: 77, paymentStatus: "paid", hasModifications: false }] });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("applies paid status and date bounds in the bounded payment-summary query", async () => {
    const orders = [{ id: 78, orderNumber: "F-78", paymentStatus: "paid", total: 25000 }];
    const offset = vi.fn(async () => orders);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn((_condition: unknown) => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    mocks.getDb.mockReturnValue({ select });

    const response = await POST(request({
      status: "all_history",
      paymentStatus: "paid",
      dateFrom: "2026-09-14",
      dateTo: "2026-09-21",
      limit: 200,
      offset: 200,
      includeItems: false,
      includeModifications: false,
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).orders).toMatchObject([{ id: 78, paymentStatus: "paid" }]);
    const compiled = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0] as any);
    expect(compiled.params).toContain("paid");
    expect(compiled.params).toContain("2026-09-14");
    expect(compiled.params).toContain("2026-09-21T23:59:59");
    expect(limit).toHaveBeenCalledWith(200);
    expect(offset).toHaveBeenCalledWith(200);
  });

  it("loads recent paid orders in Payment Summary and merges duplicate order IDs", () => {
    const source = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    const summary = source.slice(source.indexOf("function PaymentSummary("), source.indexOf("function PaymentHistoryPanel("));
    expect(summary).toContain('paymentStatus: "paid"');
    expect(summary).toContain("dateFrom: localDateStr(paidFrom)");
    expect(summary).toContain("dateTo: localDateStr(new Date())");
    expect(summary).toContain("while (true)");
    expect(summary).toContain("paidOffset += page.length");
    expect(summary).toContain("new Map(orders.map((order) => [order.id, order]))");
  });
});
