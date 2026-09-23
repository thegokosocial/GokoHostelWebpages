import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import SQLite from "better-sqlite3";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { eq, SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ authenticateUser: async () => ({ role: "admin", displayName: "Test", permissions: {} }) }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: async (id: number) => (await state.db.select().from(schema.foodOrders).where(eq(schema.foodOrders.id, id)))[0],
  getSetting: async () => "0",
  getMenuItemCategoryExemptions: async () => new Map(),
}));
vi.mock("@/lib/guestReceipts", () => ({ resolveReceiptAccount: async () => 7, receiptBusinessDate: () => "2026-09-23" }));
import { POST } from "@/app/api/admin/food-orders/route";

let runtime: Miniflare;
let binding: Awaited<ReturnType<Miniflare["getD1Database"]>>;
const now = "2026-09-23T10:00:00.000Z";
const request = (overrides: Record<string, unknown> = {}) => POST(new NextRequest("http://localhost/api/admin/food-orders", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "test", action: "saveOrderEdits", orderId: 10, operationId: "edit-test-001", changes: [{ itemId: 20, quantity: 4 }], ...overrides }),
}));
const rows = (table: string) => binding.prepare(`SELECT * FROM ${table}`).all();

beforeAll(async () => {
  runtime = new Miniflare({ modules: true, compatibilityDate: "2025-11-01", cf: false,
    script: "export default { fetch() { return new Response('fixture'); } };",
    d1Databases: { DB: "food-edits-disposable" }, d1Persist: false });
  binding = await runtime.getD1Database("DB");
  const dialect = new SQLiteSyncDialect();
  // Build unrelated fixture columns from the schema; use the actual migration
  // for the edit guard and refund constraints, whose behavior is under test.
  for (const table of [schema.foodOrders, schema.foodOrderItems, schema.menuItems, schema.orderModifications, schema.accounts, schema.guestReceipts, schema.auditLog]) {
    const config = getTableConfig(table);
    const columns = config.columns.filter((c) => config.name !== "food_orders" || !["amount_refunded", "refund_method", "refund_cash", "refunded_at", "refunded_by"].includes(c.name));
    await binding.prepare(`CREATE TABLE ${config.name} (${columns.map((c) => {
      const def = c.default === undefined ? "" : ` DEFAULT ${c.default instanceof SQL ? dialect.sqlToQuery(c.default).sql : typeof c.default === "string" ? `'${c.default.replaceAll("'", "''")}'` : c.default}`;
      return `${c.name} ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def}`;
    }).join(",")})`).run();
  }
  const statements = readFileSync("migrations/0072_food_order_edit_batches_and_refunds.sql", "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  await binding.batch(statements.map((s) => binding.prepare(s)));
}, 30000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  state.db = drizzle(binding, { schema });
  await binding.prepare("DROP TRIGGER IF EXISTS fail_edit_audit").run();
  for (const name of ["food_payment_events", "food_order_edit_batches", "guest_receipts", "order_modifications", "food_order_items", "food_orders", "menu_items", "audit_log", "accounts"]) await binding.prepare(`DELETE FROM ${name}`).run();
  await state.db.insert(schema.accounts).values({ id: 7, name: "Test bank", type: "bank", createdAt: now });
  await state.db.insert(schema.menuItems).values({ id: 4, categoryId: 1, name: "Shampoo", price: 100, trackInventory: 1, stockQuantity: 10 });
  await state.db.insert(schema.foodOrders).values({ id: 10, orderNumber: "D266-05", guestName: "Test", subtotal: 200, total: 200, createdAt: now, updatedAt: now });
  await state.db.insert(schema.foodOrderItems).values({ id: 20, orderId: 10, menuItemId: 4, itemName: "Shampoo", itemPrice: 100, quantity: 2, lineTotal: 200 });
});

describe("food edits through actual D1/workerd", () => {
  it.each([0, 100, 200])("saves unpaid/partial/paid additions once (collected %i)", async (paid) => {
    await state.db.update(schema.foodOrders).set({ amountPaid: paid, paymentStatus: paid === 200 ? "paid" : paid ? "partial" : "pending" });
    const response = await request();
    expect(await response.json()).toMatchObject({ success: true, total: 400 });
    expect((await rows("food_orders")).results[0]).toMatchObject({ total: 400, amount_paid: paid });
    expect((await rows("food_order_items")).results[0]).toMatchObject({ quantity: 4, line_total: 400 });
    expect((await rows("menu_items")).results[0]).toMatchObject({ stock_quantity: 8 });
    expect(await (await request()).json()).toMatchObject({ success: true, duplicate: true });
    expect((await rows("order_modifications")).results).toHaveLength(1);
    expect((await rows("audit_log")).results).toHaveLength(1);
    expect((await request({ changes: [{ itemId: 20, quantity: 5 }] })).status).toBe(409);
  });
  it("rejects insufficient stock without any writes", async () => {
    await state.db.update(schema.menuItems).set({ stockQuantity: 1 });
    expect((await request()).status).toBe(409);
    expect((await rows("food_order_edit_batches")).results).toHaveLength(0);
    expect((await rows("food_order_items")).results[0]).toMatchObject({ quantity: 2 });
  });
  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER])("rejects invalid or overflowing quantity %s without writes", async (quantity) => {
    expect((await request({ changes: [{ itemId: 20, quantity }] })).status).toBe(400);
    expect((await rows("food_order_edit_batches")).results).toHaveLength(0);
  });
  it("requires the exact refund and journals it once", async () => {
    await state.db.update(schema.foodOrders).set({ amountPaid: 200, paymentStatus: "paid", paymentMethod: "online" });
    const edit = { changes: [{ itemId: 20, quantity: 1, reason: "Wrong order" }] };
    expect(await (await request(edit)).json()).toMatchObject({ requiresRefund: true, refundAmount: 100 });
    expect((await rows("food_order_edit_batches")).results).toHaveLength(0);
    const refund = { amountPaise: 100, method: "online", onlineAccountId: 7, operationId: "refund-test-001" };
    expect((await request({ ...edit, refund })).status).toBe(200);
    expect((await request({ ...edit, refund })).status).toBe(200);
    expect((await rows("food_payment_events")).results).toHaveLength(1);
    expect((await rows("guest_receipts")).results[0]).toMatchObject({ amount: -100, kind: "refund" });
    expect((await rows("menu_items")).results[0]).toMatchObject({ stock_quantity: 11 });
  });
  it("rolls back every write when the last statement fails", async () => {
    await binding.prepare("CREATE TRIGGER fail_edit_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
    expect((await request()).status).toBeGreaterThanOrEqual(500);
    expect((await rows("food_order_items")).results[0]).toMatchObject({ quantity: 2 });
    expect((await rows("menu_items")).results[0]).toMatchObject({ stock_quantity: 10 });
    for (const table of ["food_order_edit_batches", "order_modifications", "audit_log"]) expect((await rows(table)).results).toHaveLength(0);
  });
  it("aborts when an item changes between preparation and the batch", async () => {
    const batch = state.db.batch.bind(state.db);
    state.db.batch = async (writes: unknown[]) => {
      await binding.prepare("UPDATE food_order_items SET quantity = 3 WHERE id = 20").run();
      return batch(writes);
    };
    expect((await request()).status).toBe(409);
    expect((await rows("food_order_items")).results[0]).toMatchObject({ quantity: 3 });
    expect((await rows("food_order_edit_batches")).results).toHaveLength(0);
    expect((await rows("menu_items")).results[0]).toMatchObject({ stock_quantity: 10 });
  });
  it.each(["UPDATE food_orders SET amount_paid = 100 WHERE id = 10", "UPDATE menu_items SET stock_quantity = 0 WHERE id = 4"])("rejects a concurrent payment or stock change: %s", async (mutation) => {
    const batch = state.db.batch.bind(state.db);
    state.db.batch = async (writes: unknown[]) => { await binding.prepare(mutation).run(); return batch(writes); };
    expect((await request()).status).toBe(409);
    expect((await rows("food_order_items")).results[0]).toMatchObject({ quantity: 2 });
    expect((await rows("food_order_edit_batches")).results).toHaveLength(0);
  });
  it("allows only one concurrent claim of the last stock unit", async () => {
    await state.db.update(schema.menuItems).set({ stockQuantity: 1 });
    const batch = state.db.batch.bind(state.db);
    let arrivals = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    state.db.batch = async (writes: unknown[]) => {
      if (++arrivals === 2) release();
      await ready;
      return batch(writes);
    };
    const responses = await Promise.all(["concurrent-a", "concurrent-b"].map((operationId) => request({ operationId, changes: [{ itemId: 20, quantity: 3 }] })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await rows("menu_items")).results[0]).toMatchObject({ stock_quantity: 0 });
    expect((await rows("food_order_edit_batches")).results).toHaveLength(1);
  });
  it("saves a large multi-line edit within per-statement bind limits", async () => {
    await state.db.update(schema.menuItems).set({ stockQuantity: 100 });
    for (let id = 21; id <= 46; id++) await state.db.insert(schema.foodOrderItems).values({ id, orderId: 10, menuItemId: 4, itemName: `Line ${id}`, itemPrice: 100, quantity: 1, lineTotal: 100 });
    await state.db.update(schema.foodOrders).set({ total: 2800, subtotal: 2800 });
    const changes = Array.from({ length: 27 }, (_, i) => ({ itemId: 20 + i, quantity: 3, reason: "Shared reason" }));
    expect((await request({ changes })).status).toBe(200);
    expect((await rows("food_orders")).results[0]).toMatchObject({ total: 8100 });
    expect((await rows("menu_items")).results[0]).toMatchObject({ stock_quantity: 47 });
    expect((await rows("order_modifications")).results).toHaveLength(27);
  });
  it("rolls back refund, receipts, stock and history on a late failure", async () => {
    await state.db.update(schema.foodOrders).set({ amountPaid: 200, paymentStatus: "paid" });
    await binding.prepare("CREATE TRIGGER fail_edit_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
    expect((await request({ changes: [{ itemId: 20, quantity: 0 }], refund: { amountPaise: 200, method: "online", operationId: "refund-rollback-001" } })).status).toBeGreaterThanOrEqual(500);
    for (const table of ["food_payment_events", "guest_receipts", "food_order_edit_batches", "order_modifications"]) expect((await rows(table)).results).toHaveLength(0);
    expect((await rows("food_orders")).results[0]).toMatchObject({ total: 200, amount_paid: 200, amount_refunded: 0 });
    expect((await rows("food_order_items")).results[0]).toMatchObject({ status: "active", quantity: 2 });
  });
  it("finalizes a pending price even when the amount stays equal", async () => {
    await state.db.update(schema.foodOrderItems).set({ pricingStatus: "pending" });
    expect((await request({ changes: [{ itemId: 20, price: 100, label: "Fish" }] })).status).toBe(200);
    expect((await rows("food_order_items")).results[0]).toMatchObject({ pricing_status: "fixed", notes: "Fish" });
  });
  it("supports the real synchronous Pi SQLite transaction fallback", async () => {
    const sqlite = new SQLite(":memory:");
    try {
      const tables = await binding.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string; sql: string }>();
      for (const table of tables.results) {
        sqlite.exec(table.sql);
        for (const row of (await rows(table.name)).results) {
          const keys = Object.keys(row);
          sqlite.prepare(`INSERT INTO ${table.name} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
        }
      }
      state.db = sqliteDrizzle(sqlite, { schema });
      expect((await request()).status).toBe(200);
      expect(sqlite.prepare("SELECT quantity FROM food_order_items").get()).toEqual({ quantity: 4 });
      sqlite.exec("CREATE TRIGGER fail_edit_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
      expect((await request({ operationId: "pi-failure-001", changes: [{ itemId: 20, quantity: 5 }] })).status).toBeGreaterThanOrEqual(500);
      expect(sqlite.prepare("SELECT quantity FROM food_order_items").get()).toEqual({ quantity: 4 });
    } finally { sqlite.close(); }
  });
});
