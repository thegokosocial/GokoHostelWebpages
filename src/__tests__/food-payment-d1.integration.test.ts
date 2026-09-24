import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/d1";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getFoodOrderById: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  latestReceiptAccount: vi.fn(),
  resolveReceiptAccount: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: q.getFoodOrderById,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
}));
vi.mock("@/lib/guestReceipts", () => ({
  resolveReceiptAccount: q.resolveReceiptAccount,
  latestReceiptAccount: q.latestReceiptAccount,
  receiptBusinessDate: vi.fn(() => "2026-09-22"),
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/cashPaymentJournal", () => ({
  assertCashDateOpen: vi.fn(async () => undefined),
  assertCashPaymentCorrectionOpen: vi.fn(async () => undefined),
  recordCashPaymentEvent: vi.fn(async () => ({ duplicate: false })),
  recordCashPaymentCorrection: vi.fn(async () => ({ duplicate: false })),
}));

import { POST } from "@/app/api/admin/food-orders/route";

type D1Client = {
  prepare: (sql: string) => { bind: (...params: unknown[]) => { all: () => Promise<unknown>; run: () => Promise<unknown> } };
  batch: (statements: Array<{ run: () => Promise<unknown> }>) => Promise<unknown[]>;
};

function makeD1Client(sqlite: SQLite.Database): D1Client {
  const result = (value: unknown) => ({ results: value, success: true, meta: {} });
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async raw() {
              const rows = sqlite.prepare(sql).raw(true).all(...params) as unknown[][];
              return rows;
            },
            async all() {
              const rows = sqlite.prepare(sql).raw(true).all(...params) as unknown[][];
              return result(rows);
            },
            async run() {
              const execution = sqlite.prepare(sql).run(...params);
              return result({ changes: execution.changes, last_row_id: execution.lastInsertRowid });
            },
          };
        },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function createPaymentTables(sqlite: SQLite.Database) {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE food_orders (
      id INTEGER PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT,
      guest_type TEXT NOT NULL DEFAULT 'walkin',
      checkin_id INTEGER,
      guest_name TEXT NOT NULL DEFAULT 'Test Guest',
      guest_phone TEXT NOT NULL DEFAULT '',
      room_info TEXT DEFAULT '',
      table_number TEXT DEFAULT '',
      special_instructions TEXT DEFAULT '',
      subtotal INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      amount_paid INTEGER NOT NULL DEFAULT 0,
      amount_refunded INTEGER NOT NULL DEFAULT 0,
      refund_method TEXT NOT NULL DEFAULT '',
      refund_cash INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT NOT NULL DEFAULT '',
      refunded_by TEXT NOT NULL DEFAULT '',
      payment_method TEXT DEFAULT '',
      paid_by TEXT DEFAULT '',
      cash_received INTEGER DEFAULT 0,
      change_given INTEGER DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      discount_reason TEXT DEFAULT '',
      discount_by TEXT DEFAULT '',
      cancelled_reason TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'guest',
      created_at TEXT NOT NULL DEFAULT '2026-09-22T16:00:00.000Z',
      total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'placed',
      updated_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT,
      deleted_at TEXT
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_virtual INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE guest_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL UNIQUE,
      operation_id TEXT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      amount INTEGER NOT NULL,
      business_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      booking_event_id TEXT,
      guest_name_snapshot TEXT,
      booking_ref_snapshot TEXT,
      platform_snapshot TEXT,
      checkin_date_snapshot TEXT,
      checkout_date_snapshot TEXT,
      booking_cycle_snapshot INTEGER,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT
    );
    CREATE TABLE cash_payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      operation_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      business_date TEXT NOT NULL,
      corrects_event_id TEXT,
      guest_name_snapshot TEXT NOT NULL DEFAULT '',
      reference_snapshot TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_id INTEGER,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT DEFAULT '',
      details TEXT DEFAULT '',
      ip_address TEXT DEFAULT ''
    );
  `);
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/food-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action: "markOrderPaid", ...body }),
  });
}

describe("food payment D1 persistence", () => {
  let sqlite: SQLite.Database;

  beforeEach(() => {
    sqlite = new SQLite(":memory:");
    createPaymentTables(sqlite);
    sqlite.prepare("INSERT INTO accounts (id, name) VALUES (?, ?)").run(7, "Sunny HDFC");
    sqlite.prepare("INSERT INTO food_orders (id, order_number, total, updated_at) VALUES (?, ?, ?, ?)").run(10, "F-10", 400, "2026-09-22T16:00:00.000Z");

    const db = drizzle(makeD1Client(sqlite) as never, { schema });
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getFoodOrderById.mockResolvedValue({ id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "pending", total: 400 });
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, [{ status: "active", pricingStatus: "fixed" }]]]));
    q.resolveReceiptAccount.mockResolvedValue(7);
    q.latestReceiptAccount.mockResolvedValue(7);
    q.getDb.mockReturnValue(db);
  });

  afterEach(() => {
    vi.clearAllMocks();
    sqlite.close();
  });

  it("persists an online Save through real Drizzle D1 batch statements", async () => {
    const response = await POST(request({ orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }));

    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT payment_status, amount_paid, payment_method, paid_by FROM food_orders WHERE id = 10").get()).toMatchObject({
      payment_status: "paid", amount_paid: 400, payment_method: "online", paid_by: "Admin",
    });
    expect(sqlite.prepare("SELECT source_id, account_id, amount, kind FROM guest_receipts").all()).toEqual([
      { source_id: 10, account_id: 7, amount: 400, kind: "food" },
    ]);
    expect(sqlite.prepare("SELECT action, target FROM audit_log").all()).toEqual([
      { action: "food_order_paid", target: "orders:10" },
    ]);
  });

  it("persists a cash Save without creating an online receipt", async () => {
    const response = await POST(request({ orderIds: [10], paymentMethod: "cash", cashReceived: 500, changeGiven: 100 }));

    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT payment_status, amount_paid, payment_method, cash_received, change_given FROM food_orders WHERE id = 10").get()).toMatchObject({
      payment_status: "paid", amount_paid: 400, payment_method: "cash", cash_received: 500, change_given: 100,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM guest_receipts").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT amount_paise, event_type FROM cash_payment_events").all()).toEqual([{ amount_paise: 400, event_type: "collection" }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log").get()).toEqual({ count: 1 });
  });

  it("persists the online portion of a split Save and rejects a duplicate retry", async () => {
    const first = await POST(request({ orderIds: [10], paymentMethod: "split", cashReceived: 100, changeGiven: 0, onlineAccountId: 7 }));
    const retry = await POST(request({ orderIds: [10], paymentMethod: "split", cashReceived: 100, changeGiven: 0, onlineAccountId: 7 }));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(409);
    expect(sqlite.prepare("SELECT payment_method, cash_received, change_given FROM food_orders WHERE id = 10").get()).toMatchObject({
      payment_method: "split", cash_received: 100, change_given: 0,
    });
    expect(sqlite.prepare("SELECT account_id, amount FROM guest_receipts").all()).toEqual([{ account_id: 7, amount: 300 }]);
    expect(sqlite.prepare("SELECT amount_paise FROM cash_payment_events").all()).toEqual([{ amount_paise: 100 }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_log").get()).toEqual({ count: 1 });
  });

  it("keeps one operation id across a combined online payment", async () => {
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(11, "F-11", "Test Guest", 600, "2026-09-22T16:00:00.000Z");
    q.getFoodOrderById.mockImplementation(async (id: number) => ({ id, orderNumber: `F-${id}`, guestName: "Test Guest", status: "placed", paymentStatus: "pending", total: id === 10 ? 400 : 600 }));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, [{ status: "active", pricingStatus: "fixed" }]], [11, [{ status: "active", pricingStatus: "fixed" }]]]));

    const response = await POST(request({ orderIds: [10, 11], paymentMethod: "online", onlineAccountId: 7, receiptId: "payment-1" }));

    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT operation_id, amount FROM guest_receipts ORDER BY source_id").all()).toEqual([
      { operation_id: "payment-1", amount: 400 }, { operation_id: "payment-1", amount: 600 },
    ]);
  });

  it("collects only the outstanding balance for a partially paid order", async () => {
    sqlite.prepare("UPDATE food_orders SET amount_paid = 200, payment_status = 'partial' WHERE id = 10").run();
    q.getFoodOrderById.mockResolvedValue({ id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "partial", amountPaid: 200, total: 400 });

    const response = await POST(request({ orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }));

    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT payment_status, amount_paid FROM food_orders WHERE id = 10").get()).toMatchObject({ payment_status: "paid", amount_paid: 400 });
    expect(sqlite.prepare("SELECT amount FROM guest_receipts").all()).toEqual([{ amount: 200 }]);
  });

  it("retains earlier cash when Order More is later paid online", async () => {
    sqlite.prepare("UPDATE food_orders SET amount_paid = 200, payment_status = 'partial', payment_method = 'cash', cash_received = 200 WHERE id = 10").run();
    q.getFoodOrderById.mockResolvedValue({ id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "partial", amountPaid: 200, total: 400, paymentMethod: "cash", cashReceived: 200 });
    expect((await POST(request({ orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }))).status).toBe(200);
    expect(sqlite.prepare("SELECT amount_paid, payment_method, cash_received FROM food_orders WHERE id = 10").get())
      .toEqual({ amount_paid: 400, payment_method: "split", cash_received: 200 });
    expect(sqlite.prepare("SELECT amount FROM guest_receipts").all()).toEqual([{ amount: 200 }]);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM cash_payment_events").get()).toEqual({ n: 0 });
  });
});
