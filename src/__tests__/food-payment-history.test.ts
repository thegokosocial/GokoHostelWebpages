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

  it("loads recent paid orders in Order Summary and keeps payment actions consolidated", () => {
    const source = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    const summary = source.slice(source.indexOf("function OrderSummary("), source.indexOf("function PaymentSummary("));
    expect(summary).toContain('paymentStatus: "paid"');
    expect(summary).toContain("dateFrom: localDateStr(paidFrom)");
    expect(summary).toContain("dateTo: localDateStr(new Date())");
    expect(summary).toContain("while (true)");
    expect(summary).toContain("paidOffset += page.length");
    expect(summary).toContain('const unpaidOrders = orders.filter((o) => o.paymentStatus !== "paid")');
    expect(summary).toContain('const unpaidGroups = filteredGroups.filter((group) => group.pendingAmount > 0)');
    expect(summary).toContain('const paidGroups = filteredGroups.filter((group) => group.pendingAmount <= 0)');
    expect(summary).toContain('const hasLoadedOrders = Object.prototype.hasOwnProperty.call(hostelOrdersMap, g.checkinId)');
    expect(summary).toContain('cachedOrders.filter((o) => o.paymentStatus !== "paid")');
    expect(summary).toContain(': g.tabTotal');
    expect(summary).toContain('group.pendingAmount <= 0');
    expect(summary).toContain('group.paidAmount > 0');
    expect(summary).toContain('border-l-red-400');
    expect(summary).toContain('border-l-orange-400');
    expect(summary).toContain('border-l-green-400');
    expect(summary).toContain('const unpaid = selectedGroupOrders.filter((o) => o.paymentStatus !== "paid")');
    expect(source).toContain('hasPermission(role, permissions, "canViewFoodOrders")');
    expect(summary).toContain('<OrderPaymentBadge paymentStatus={order.paymentStatus} />');
    expect(source).toContain('paid ? "Paid" : "Unpaid"');
    expect(summary).toContain('orders={billOrders.map((o) => ({');
    expect(summary).toContain('paymentDue={actualGroupPending}');
    expect(summary).toContain('aria-label={`Edit payment for ${order.orderNumber}`}');
    expect(summary).toContain('<BanknoteIcon className="h-3.5 w-3.5" />');
    expect(summary).toContain('{item.quantity}× {item.itemName}');
    expect(summary).toContain('aria-label={`Edit items for ${order.orderNumber}`}');
    expect(summary).toContain('<UtensilsIcon className="h-3.5 w-3.5" />');
    expect(summary).toContain('title="Edit food items"');
    expect(source).toContain('<BanknoteIcon className="h-3 w-3" /> Edit Payment');
    expect(summary).toContain('setDrawerView("orders"); setEditingOrderId(order.id)');
    expect(summary).toContain('scrollIntoView({ behavior: "smooth", block: "center" })');
    expect(summary).toContain('data-order-id={order.id}');
    expect(summary).toContain('>Editing</span>');
    expect(summary).toContain('ring-2 ring-brand-green/25');
    expect(summary).toContain('setEditingOrderId(null)');
    expect(summary).toContain('const canEditOrderItems = hasPermission');
    expect(summary).toContain('Payment History');
  });

  it("reopens paid orders when bill items change", () => {
    const source = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    expect(source).toContain("async function reopenPaidOrder");
    expect(source).toContain('action: "food_payment_reopened"');
    expect(source).toContain('kind: "reversal"');
    expect(source).toContain('Bill item voided; payment returned to pending');
    expect(source).toContain('Order quantity changed; payment returned to pending');
  });

  it("keeps payment and food-edit actions distinct and guarded by their permissions", () => {
    const source = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    const summary = source.slice(source.indexOf("function OrderSummary("), source.indexOf("function PaymentSummary("));
    expect(summary).toContain('hasPermission(role || "staff", permissions || {}, "canMarkPaid")');
    expect(summary).toContain('hasPermission(role || "staff", permissions || {}, "canEditFoodOrders")');
    expect(summary).toContain('title="Edit payment"');
    expect(summary).toContain('title="Edit order items"');
    expect(summary).toContain("setVoidingItemId(null)");
    expect(summary).toContain("setPaymentEditOrder(null)");
  });

  it("prevents duplicate payment submits while the modal request is in flight", () => {
    const source = readFileSync("src/components/admin/RecordPaymentModal.tsx", "utf8");
    expect(source).toContain("if (saving) return;");
    expect(source).toContain("setSaving(true)");
    expect(source).toContain("await onConfirm");
    expect(source).toContain("setSaving(false)");
  });
});
