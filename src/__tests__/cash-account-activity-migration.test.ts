import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

describe("cash account activity migration", () => {
  it("backfills canonical food operation ids and creates the cash journal", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE guest_receipts (
      id INTEGER PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE, source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL, amount INTEGER NOT NULL
    );`);
    db.prepare("INSERT INTO guest_receipts VALUES (1, ?, 'food_order', 11, 400)").run("pay-1:food:11");
    db.prepare("INSERT INTO guest_receipts VALUES (2, ?, 'food_order', 12, 600)").run("pay-1:food:12");
    db.prepare("INSERT INTO guest_receipts VALUES (3, ?, 'food_order', 13, 100)").run("legacy-single");

    db.exec(readFileSync("migrations/0074_cash_account_activity.sql", "utf8"));

    expect(db.prepare("SELECT receipt_id, operation_id FROM guest_receipts ORDER BY id").all()).toEqual([
      { receipt_id: "pay-1:food:11", operation_id: "pay-1" },
      { receipt_id: "pay-1:food:12", operation_id: "pay-1" },
      { receipt_id: "legacy-single", operation_id: null },
    ]);
    db.prepare(`INSERT INTO cash_payment_events
      (event_id, operation_id, source_type, source_id, event_type, amount_paise, business_date, actor, created_at)
      VALUES ('cash-1', 'pay-1', 'food_order', 11, 'collection', 400, '2026-09-23', 'Admin', '2026-09-23T00:00:00Z')`).run();
    expect(db.prepare("SELECT operation_id, amount_paise FROM cash_payment_events").get()).toEqual({ operation_id: "pay-1", amount_paise: 400 });
    db.close();
  });
});
