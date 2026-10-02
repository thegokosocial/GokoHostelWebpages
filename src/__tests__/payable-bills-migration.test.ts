import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

describe("payable bills migration", () => {
  it("caps installments, permits correction deletion, and preserves positive adjustments", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE vendors (id INTEGER PRIMARY KEY); CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, category TEXT NOT NULL, custom_category TEXT DEFAULT '', purpose TEXT DEFAULT '',
      bill_image_link TEXT DEFAULT '', vendor_id INTEGER, account_id INTEGER, payment_method TEXT DEFAULT 'cash', main_category TEXT DEFAULT '', sub_category TEXT DEFAULT '',
      task_id INTEGER, created_by TEXT NOT NULL DEFAULT '', updated_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT '', expense_date TEXT NOT NULL DEFAULT '', created_month TEXT NOT NULL DEFAULT '', deleted_at TEXT
    );`);
    db.exec(readFileSync("migrations/0087_payable_bills.sql", "utf8"));
    db.prepare(`INSERT INTO payable_bills (title, original_amount, category, bill_date, created_by, created_at, updated_at) VALUES ('Wall work', 5500000, 'Maintenance', '2026-10-02', 'admin', 'x', 'x')`).run();
    const insert = db.prepare(`INSERT INTO expenses (amount, category, created_by, created_at, expense_date, created_month, payable_bill_id) VALUES (?, 'Maintenance', 'admin', 'x', '2026-10-02', '2026-10', 1)`);
    insert.run(1000000);
    expect(() => insert.run(4500001)).toThrow(/exceeds remaining/i);
    db.prepare("INSERT INTO payable_bill_adjustments (payable_bill_id, amount, reason, created_by, created_at) VALUES (1, 500000, 'extra materials', 'admin', 'x')").run();
    insert.run(4500000);
    insert.run(500000);
    expect(db.prepare("SELECT SUM(amount) total FROM expenses WHERE payable_bill_id = 1 AND deleted_at IS NULL").get()).toMatchObject({ total: 6000000 });
    expect(() => db.prepare("UPDATE expenses SET amount = 4500001 WHERE id = 2").run()).toThrow(/exceeds remaining/i);
    expect(() => db.prepare("UPDATE expenses SET payable_bill_id = NULL WHERE id = 2").run()).toThrow(/immutable/i);
    db.prepare("UPDATE expenses SET deleted_at = 'x' WHERE id = 3").run();
    expect(db.prepare("SELECT SUM(amount) total FROM expenses WHERE payable_bill_id = 1 AND deleted_at IS NULL").get()).toMatchObject({ total: 5500000 });
    expect(() => db.prepare("INSERT INTO payable_bill_adjustments (payable_bill_id, amount, reason, created_by, created_at) VALUES (1, -1, 'bad', 'admin', 'x')").run()).toThrow();
    db.close();
  });
});
