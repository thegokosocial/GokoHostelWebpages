import { describe, expect, it } from "vitest";
import SQLite from "better-sqlite3";
import { readFileSync } from "node:fs";

describe("batched food-order editing and refund persistence", () => {
  it("keeps the Drizzle schema and production migration aligned", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const migration = readFileSync("migrations/0072_food_order_edit_batches_and_refunds.sql", "utf8");

    for (const column of ["amountRefunded", "refundMethod", "refundCash", "refundedAt", "refundedBy"]) {
      expect(schema).toContain(column);
      expect(migration).toContain(column.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
    }
    expect(schema).toContain('foodOrderEditBatches = sqliteTable("food_order_edit_batches"');
    expect(schema).toContain('foodPaymentEvents = sqliteTable("food_payment_events"');
    expect(migration).toContain("CREATE TABLE food_order_edit_batches");
    expect(migration).toContain("CREATE TABLE food_payment_events");
    expect(migration).toContain("CHECK (cash_paise + online_paise = amount_paise)");
  });

  it("applies cleanly to a production-shaped pre-0072 database and enforces refund tender integrity", () => {
    const sqlite = new SQLite(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY);
      CREATE TABLE food_orders (id INTEGER PRIMARY KEY, amount_paid INTEGER NOT NULL DEFAULT 0);
    `);
    sqlite.exec(readFileSync("migrations/0072_food_order_edit_batches_and_refunds.sql", "utf8"));

    const columns = sqlite.prepare("PRAGMA table_info(food_orders)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "amount_refunded", "refund_method", "refund_cash", "refunded_at", "refunded_by",
    ]));
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('food_order_edit_batches', 'food_payment_events') ORDER BY name").all()).toHaveLength(2);

    sqlite.prepare("INSERT INTO food_orders (id) VALUES (1)").run();
    expect(() => sqlite.prepare(`INSERT INTO food_payment_events
      (event_id, order_id, event_type, amount_paise, cash_paise, online_paise, actor, created_at)
      VALUES (?, ?, 'refund', 100, 70, 0, 'admin', '2026-09-23T00:00:00.000Z')`).run("bad-tender", 1)).toThrow();
    sqlite.close();
  });
});
