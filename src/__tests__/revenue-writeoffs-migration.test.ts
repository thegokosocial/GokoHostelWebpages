import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { getSyncableTableNames } from "@/lib/syncEngine";

describe("revenue write-offs migration", () => {
  it("adds zeroed source totals and an append-only ledger with sync metadata", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE bookings (id INTEGER PRIMARY KEY); CREATE TABLE food_orders (id INTEGER PRIMARY KEY);");
    db.exec(readFileSync("migrations/0090_revenue_writeoffs.sql", "utf8"));

    expect((db.prepare("PRAGMA table_info(bookings)").all() as Array<{ name: string }>).map((column) => column.name)).toContain("write_off_amount");
    expect((db.prepare("PRAGMA table_info(food_orders)").all() as Array<{ name: string }>).map((column) => column.name)).toContain("write_off_amount");
    expect((db.prepare("PRAGMA table_info(revenue_writeoffs)").all() as Array<{ name: string }>).map((column) => column.name)).toEqual(expect.arrayContaining([
      "idempotency_key", "source_type", "source_id", "booking_cycle", "amount_paise", "sync_id", "sync_updated_at", "sync_source",
    ]));

    const insert = db.prepare("INSERT INTO revenue_writeoffs (idempotency_key, source_type, source_id, amount_paise, reason, actor, created_at) VALUES (?, 'food_order', 7, 20000, 'unreachable', 'admin', '2026-10-05T00:00:00.000Z')");
    insert.run("writeoff-1");
    expect(db.prepare("SELECT note, guest_name_snapshot, reference_snapshot, sync_source FROM revenue_writeoffs").get()).toEqual({
      note: "", guest_name_snapshot: "", reference_snapshot: "", sync_source: "cloudflare",
    });
    expect(() => insert.run("writeoff-1")).toThrow();
    expect(() => db.prepare("INSERT INTO revenue_writeoffs (idempotency_key, source_type, source_id, amount_paise, reason, actor, created_at) VALUES ('bad-type', 'expense', 7, 1, 'x', 'admin', 'x')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO revenue_writeoffs (idempotency_key, source_type, source_id, amount_paise, reason, actor, created_at) VALUES ('zero', 'booking', 7, 0, 'x', 'admin', 'x')").run()).toThrow();
    db.close();
  });

  it("is included in append-only synchronization", () => {
    expect(getSyncableTableNames()).toContain("revenue_writeoffs");
  });
});
