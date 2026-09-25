import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { POST } from "@/app/api/admin/expenses/route";

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({
  authenticateUser: async () => ({ role: "admin", displayName: "Admin", permissions: {} }),
}));

const skippedPiMigrations = new Set([
  "0035_site_cms.sql", "0041_splits.sql", "0064_food_bill_share_tokens.sql", "0077_food_bill_walkin_identity.sql",
  "0066_gateway_receivables.sql", "0068_gateway_settlement_allocations.sql",
]);

let sqlite: SQLite.Database;

function request(accountId: number | "cash", overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/expenses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "getAccountActivity", password: "test", accountId,
      fromDate: "2026-09-23", toDate: "2026-09-23", page: 1, pageSize: 50, ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("GOKO_RUNTIME", "pi");
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (!skippedPiMigrations.has(file)) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  state.db = drizzle(sqlite, { schema }) as unknown as Database;

  sqlite.exec(`
    INSERT INTO accounts (id, name, account_type, is_active, opening_balance, is_virtual, created_at)
      VALUES (1, 'HDFC', 'savings', 1, 0, 0, '2026-09-23T08:00:00Z');
    INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, payment_status, created_at, updated_at)
      VALUES (11, 'D262-11', 'Viswambar Chowdary', 100000, 100000, 'paid', '2026-09-23T09:00:00Z', '2026-09-23T09:00:00Z'),
             (12, 'D262-12', 'Viswambar Chowdary', 92000, 92000, 'paid', '2026-09-23T09:05:00Z', '2026-09-23T09:05:00Z'),
             (13, 'D262-13', 'Separate Guest', 500, 500, 'paid', '2026-09-23T10:00:00Z', '2026-09-23T10:00:00Z');
    INSERT INTO guest_receipts
      (receipt_id, operation_id, source_type, source_id, kind, account_id, amount, business_date, notes, created_by, created_at)
      VALUES ('bill-1920:food:11', 'bill-1920', 'food_order', 11, 'food', 1, 100000, '2026-09-23', 'Food order D262-11', 'admin', '2026-09-23T09:10:00Z'),
             ('bill-1920:food:12', 'bill-1920', 'food_order', 12, 'food', 1, 92000, '2026-09-23', 'Food order D262-12', 'admin', '2026-09-23T09:10:00Z'),
             ('legacy-single', NULL, 'food_order', 13, 'food', 1, 500, '2026-09-23', 'Food order D262-13', 'admin', '2026-09-23T10:05:00Z');

    INSERT INTO cash_payment_events
      (event_id, operation_id, source_type, source_id, event_type, amount_paise, business_date, corrects_event_id, guest_name_snapshot, reference_snapshot, actor, created_at)
      VALUES ('food-cash-in', 'food-cash-op', 'food_order', 11, 'collection', 10000, '2026-09-23', NULL, 'Viswambar Chowdary', 'D262-11', 'admin', '2026-09-23T11:00:00Z'),
             ('food-cash-fix', 'food-cash-op', 'food_order', 11, 'correction', -1000, '2026-09-23', 'food-cash-in', 'Viswambar Chowdary', 'D262-11', 'admin', '2026-09-23T11:05:00Z'),
             ('food-refund', 'food-refund-op', 'food_order', 11, 'refund', -2000, '2026-09-23', NULL, 'Viswambar Chowdary', 'D262-11', 'admin', '2026-09-23T12:00:00Z'),
             ('stay-cash-in', 'stay-cash-op', 'booking', 21, 'collection', 25000, '2026-09-23', NULL, 'Room Guest', 'GOKO-21', 'admin', '2026-09-23T13:00:00Z');

    INSERT INTO bookings
      (id, guest_name, platform, checkin_date, persons, status, source, created_at, booking_cycle)
      VALUES (21, 'Room Guest', 'booking.com', '2026-09-23', 1, 'checked_in', 'channel_manager', '2026-09-23T08:00:00Z', 1);
    INSERT INTO booking_payment_events
      (event_id, booking_id, booking_cycle, event_type, amount_paise, cash_paise, online_paise, unknown_paise,
       cash_tender_paise, change_paise, currency, ota_payment_terms, business_date, is_opening, corrects_event_id,
       guest_name_snapshot, booking_ref_snapshot, platform_snapshot, checkin_date_snapshot, actor, created_at,
       sync_id, sync_updated_at, sync_source)
      VALUES ('ota-cash-in', 21, 1, 'collection', 5000, 5000, 0, 0, 5000, 0, 'INR', 'pay_at_hotel', '2026-09-23', 0, NULL,
              'Room Guest', 'OTA-21', 'booking.com', '2026-09-23', 'admin', '2026-09-23T14:00:00Z',
              'ota-cash-in-sync', '2026-09-23T14:00:00Z', 'pi'),
             ('ota-cash-fix', 21, 1, 'correction', -1000, -1000, 0, 0, -1000, 0, 'INR', 'pay_at_hotel', '2026-09-23', 0, 'ota-cash-in',
              'Room Guest', 'OTA-21', 'booking.com', '2026-09-23', 'admin', '2026-09-23T14:05:00Z',
              'ota-cash-fix-sync', '2026-09-23T14:05:00Z', 'pi');
    INSERT INTO daily_income (date, account_id, type, amount, source, description, created_by, created_at)
      VALUES ('2026-09-23', NULL, 'cash', 10000, 'other', 'Manual cash income', 'admin', '2026-09-23T15:00:00Z');
    INSERT INTO expenses (amount, category, purpose, account_id, payment_method, created_by, created_at, expense_date, created_month)
      VALUES (3000, 'supplies', 'Cash supplies', NULL, 'cash', 'admin', '2026-09-23T16:00:00Z', '2026-09-23', '2026-09');
  `);
});

afterEach(() => {
  state.db = null;
  sqlite.close();
  vi.unstubAllEnvs();
});

describe("Account Activity payment-level grouping", () => {
  it("shows one online row for a combined bill while preserving unrelated and legacy payments", async () => {
    const response = await POST(request(1));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.balanceAsOf).toBe(192500);
    expect(body.activity.map((row: { amount: number }) => row.amount).sort((a: number, b: number) => b - a)).toEqual([192000, 500]);
    expect(body.activity.find((row: { amount: number }) => row.amount === 192000)).toMatchObject({
      kind: "food", description: "Food payment · Viswambar Chowdary", reference: "D262-11 + 1 more",
    });
  });

  it("shows every cash source, nets corrections into the original payment, and keeps refunds separate", async () => {
    const response = await POST(request("cash"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(6);
    expect(body.balanceAsOf).toBe(43000);
    expect(body.activity.map((row: { amount: number }) => row.amount).sort((a: number, b: number) => b - a))
      .toEqual([25000, 10000, 9000, 4000, -2000, -3000]);
    expect(body.activity.find((row: { amount: number }) => row.amount === 9000)).toMatchObject({ kind: "food", reference: "D262-11" });
    expect(body.activity.find((row: { amount: number }) => row.amount === -2000)).toMatchObject({ kind: "refund", description: "Food refund · Viswambar Chowdary" });
  });

  it("keeps reconciliation preview, saved closing, and account activity consistent", async () => {
    const preview = await POST(request("cash", { action: "getReconciliation", date: "2026-09-23" }));
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.balances.find((balance: { accountId: number | null }) => balance.accountId === null))
      .toMatchObject({ totalIncome: 46000, totalExpense: 3000, expectedClosing: 43000, dayIncome: 46000 });
    const saved = await POST(request("cash", {
      action: "saveReconciliation", date: "2026-09-23", target: { type: "cash" }, actualClosing: 43000,
    }));
    expect(saved.status).toBe(200);
    expect(sqlite.prepare("SELECT total_income, expected_closing FROM daily_ledger WHERE account_id IS NULL").get())
      .toEqual({ total_income: 46000, expected_closing: 43000 });
    const activity = await (await POST(request("cash"))).json();
    expect(activity.balanceAsOf).toBe(43000);
  });

  it("counts payments before paginating and does not merge separate saves for the same guest", async () => {
    const insert = sqlite.prepare(`INSERT INTO guest_receipts
      (receipt_id, operation_id, source_type, source_id, kind, account_id, amount, business_date, created_by, created_at)
      VALUES (?, ?, 'food_order', 11, 'food', 1, 100, '2026-09-23', 'admin', '2026-09-23T15:00:00Z')`);
    for (let i = 0; i < 15; i++) insert.run(`separate-${i}`, `separate-${i}`);
    const first = await (await POST(request(1, { pageSize: 10 }))).json();
    const second = await (await POST(request(1, { pageSize: 10, page: 2 }))).json();
    expect(first.total).toBe(17);
    expect(first.activity).toHaveLength(10);
    expect(second.activity).toHaveLength(7);
    expect(new Set([...first.activity, ...second.activity].map((entry) => entry.id)).size).toBe(17);
    expect(first.balanceAsOf).toBe(194000);
  });

  it("groups repaired multi-order receipts that share operation_id despite divergent receipt prefixes", async () => {
    sqlite.exec(`
      INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, payment_status, created_at, updated_at)
        VALUES (225, 'D262-S13', 'Sourav N G', 20000, 20000, 'paid', '2026-09-23T13:00:00Z', '2026-09-23T13:30:10Z'),
               (234, 'D262-S22', 'Sourav N G', 12000, 12000, 'paid', '2026-09-23T13:00:00Z', '2026-09-23T13:30:10Z'),
               (243, 'D262-S31', 'Sourav N G', 14000, 14000, 'paid', '2026-09-23T13:00:00Z', '2026-09-23T13:30:10Z');
      INSERT INTO guest_receipts
        (receipt_id, operation_id, source_type, source_id, kind, account_id, amount, business_date, notes, created_by, created_at)
        VALUES ('88d173b7:food:225', '88d173b7', 'food_order', 225, 'food', 1, 20000, '2026-09-23', 'Food order D262-S13', 'admin', '2026-09-23T13:30:10Z'),
               ('d4effa60:food:234', '88d173b7', 'food_order', 234, 'food', 1, 12000, '2026-09-23', 'Food order D262-S22', 'admin', '2026-09-23T13:30:10Z'),
               ('b48b2c27:food:243', '88d173b7', 'food_order', 243, 'food', 1, 14000, '2026-09-23', 'Food order D262-S31', 'admin', '2026-09-23T13:30:10Z');
    `);

    const body = await (await POST(request(1))).json();
    const sourav = body.activity.find((row: { description?: string }) => row.description === "Food payment · Sourav N G");
    expect(sourav).toMatchObject({
      kind: "food",
      amount: 46000,
      reference: "D262-S13 + 2 more",
    });
    expect(body.activity.filter((row: { description?: string }) => row.description === "Food payment · Sourav N G")).toHaveLength(1);
  });

  it("shows Combined bill description when one operation covers multiple guests", async () => {
    sqlite.exec(`
      INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, payment_status, created_at, updated_at)
        VALUES (301, 'D300-01', 'Guest A', 30000, 30000, 'paid', '2026-09-23T16:00:00Z', '2026-09-23T16:00:00Z'),
               (302, 'D300-02', 'Guest B', 20000, 20000, 'paid', '2026-09-23T16:00:00Z', '2026-09-23T16:00:00Z');
      INSERT INTO guest_receipts
        (receipt_id, operation_id, source_type, source_id, kind, account_id, amount, business_date, notes, created_by, created_at)
        VALUES ('combo:food:301', 'combo-op', 'food_order', 301, 'food', 1, 30000, '2026-09-23', 'Food order D300-01', 'Sunny', '2026-09-23T16:05:00Z'),
               ('combo:food:302', 'combo-op', 'food_order', 302, 'food', 1, 20000, '2026-09-23', 'Food order D300-02', 'Sunny', '2026-09-23T16:05:00Z');
    `);

    const body = await (await POST(request(1))).json();
    const combined = body.activity.find((row: { amount: number }) => row.amount === 50000);
    expect(combined).toMatchObject({
      kind: "food",
      description: "Food payment · Combined bill",
      reference: "D300-01 + 1 more",
    });
  });
});
