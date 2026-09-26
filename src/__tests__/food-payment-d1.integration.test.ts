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

  it("shares one server-generated operation id when receiptId is omitted", async () => {
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(11, "F-11", "Test Guest", 600, "2026-09-22T16:00:00.000Z");
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(12, "F-12", "Test Guest", 200, "2026-09-22T16:00:00.000Z");
    q.getFoodOrderById.mockImplementation(async (id: number) => ({
      id, orderNumber: `F-${id}`, guestName: "Test Guest", status: "placed", paymentStatus: "pending",
      total: id === 10 ? 400 : id === 11 ? 600 : 200,
    }));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [10, [{ status: "active", pricingStatus: "fixed" }]],
      [11, [{ status: "active", pricingStatus: "fixed" }]],
      [12, [{ status: "active", pricingStatus: "fixed" }]],
    ]));

    const response = await POST(request({ orderIds: [10, 11, 12], paymentMethod: "online", onlineAccountId: 7 }));

    expect(response.status).toBe(200);
    const rows = sqlite.prepare("SELECT operation_id, amount, receipt_id FROM guest_receipts ORDER BY source_id").all() as Array<{
      operation_id: string; amount: number; receipt_id: string;
    }>;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.operation_id)).size).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(1200);
    expect(rows.every((row) => row.receipt_id.startsWith(`${rows[0].operation_id}:food:`))).toBe(true);
    expect(sqlite.prepare("SELECT target FROM audit_log WHERE action = 'food_order_paid'").get()).toEqual({
      target: "orders:10,11,12",
    });
  });

  it("shares one cash operation and reference snapshot across a multi-order pay without receiptId", async () => {
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(11, "F-11", "Sourav N G", 14000, "2026-09-22T16:00:00.000Z");
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(12, "F-12", "Sourav N G", 20000, "2026-09-22T16:00:00.000Z");
    sqlite.prepare("UPDATE food_orders SET total = 12000, guest_name = 'Sourav N G' WHERE id = 10").run();
    q.getFoodOrderById.mockImplementation(async (id: number) => ({
      id, orderNumber: `F-${id}`, guestName: "Sourav N G", status: "placed", paymentStatus: "pending",
      amountPaid: 0, amountRefunded: 0,
      total: id === 10 ? 12000 : id === 11 ? 14000 : 20000,
    }));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [10, [{ status: "active", pricingStatus: "fixed" }]],
      [11, [{ status: "active", pricingStatus: "fixed" }]],
      [12, [{ status: "active", pricingStatus: "fixed" }]],
    ]));

    const response = await POST(request({
      orderIds: [10, 11, 12], paymentMethod: "cash", cashReceived: 46000, changeGiven: 0,
    }));

    expect(response.status).toBe(200);
    const events = sqlite.prepare(
      "SELECT operation_id, amount_paise, reference_snapshot, guest_name_snapshot FROM cash_payment_events ORDER BY source_id",
    ).all() as Array<{
      operation_id: string; amount_paise: number; reference_snapshot: string; guest_name_snapshot: string;
    }>;
    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => event.operation_id)).size).toBe(1);
    expect(events.every((event) => event.reference_snapshot === "F-10 + 2 more")).toBe(true);
    expect(events.every((event) => event.guest_name_snapshot === "Sourav N G")).toBe(true);
    expect(events.reduce((sum, event) => sum + event.amount_paise, 0)).toBe(46000);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM guest_receipts").get()).toEqual({ count: 0 });
  });

  it("shares one operation id for a multi-guest Combined Bill online pay", async () => {
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(11, "F-11", "Guest A", 600, "2026-09-22T16:00:00.000Z");
    sqlite.prepare("INSERT INTO food_orders (id, order_number, guest_name, total, updated_at) VALUES (?, ?, ?, ?, ?)").run(12, "F-12", "Guest B", 200, "2026-09-22T16:00:00.000Z");
    q.getFoodOrderById.mockImplementation(async (id: number) => ({
      id,
      orderNumber: `F-${id}`,
      guestName: id === 10 ? "Guest A" : id === 11 ? "Guest A" : "Guest B",
      status: "placed",
      paymentStatus: "pending",
      total: id === 10 ? 400 : id === 11 ? 600 : 200,
    }));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [10, [{ status: "active", pricingStatus: "fixed" }]],
      [11, [{ status: "active", pricingStatus: "fixed" }]],
      [12, [{ status: "active", pricingStatus: "fixed" }]],
    ]));

    const response = await POST(request({
      orderIds: [10, 11, 12], paymentMethod: "online", onlineAccountId: 7, receiptId: "combined-bill-1",
    }));

    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT DISTINCT operation_id FROM guest_receipts").all()).toEqual([
      { operation_id: "combined-bill-1" },
    ]);
    expect(sqlite.prepare("SELECT SUM(amount) AS total FROM guest_receipts").get()).toEqual({ total: 1200 });
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

  it("blocks markOrderPaid when any line still has pending market price", async () => {
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, [{ status: "active", pricingStatus: "pending" }]]]));
    const response = await POST(request({ orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/final prices/i) });
    expect(sqlite.prepare("SELECT payment_status FROM food_orders WHERE id = 10").get()).toEqual({ payment_status: "pending" });
  });

  it("staff without canMarkPaid gets 403 on markOrderPaid", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "View",
      permissions: { canViewFoodOrders: true },
    });
    const response = await POST(request({ orderIds: [10], paymentMethod: "online", onlineAccountId: 7 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "permission_denied",
      requiredPermissions: ["canMarkPaid"],
    });
  });

  it("oldest-first split cash across two Combined Bill orders at D1 persistence", async () => {
    sqlite.prepare("INSERT INTO food_orders (id, order_number, total, updated_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
      11, "F-11", 300, "2026-09-22T16:00:00.000Z", "2026-09-22T15:00:00.000Z",
    );
    sqlite.prepare("INSERT INTO food_orders (id, order_number, total, updated_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
      12, "F-12", 500, "2026-09-22T17:00:00.000Z", "2026-09-22T16:00:00.000Z",
    );
    q.getFoodOrderById.mockImplementation(async (id: number) => ({
      id,
      orderNumber: `F-${id}`,
      status: "placed",
      paymentStatus: "pending",
      amountPaid: 0,
      amountRefunded: 0,
      total: id === 11 ? 300 : 500,
      createdAt: id === 11 ? "2026-09-22T15:00:00.000Z" : "2026-09-22T16:00:00.000Z",
    }));
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([
      [11, [{ status: "active", pricingStatus: "fixed" }]],
      [12, [{ status: "active", pricingStatus: "fixed" }]],
    ]));

    // Combined due 800; cash 300 covers older order fully, remainder online on newer.
    // Caller must pass orderIds oldest-first (UI Combined Bill does).
    const response = await POST(request({
      orderIds: [11, 12],
      paymentMethod: "split",
      cashReceived: 300,
      changeGiven: 0,
      onlineAccountId: 7,
    }));
    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT id, amount_paid, payment_status, payment_method, cash_received FROM food_orders WHERE id IN (11,12) ORDER BY id").all()).toEqual([
      { id: 11, amount_paid: 300, payment_status: "paid", payment_method: "split", cash_received: 300 },
      { id: 12, amount_paid: 500, payment_status: "paid", payment_method: "split", cash_received: 0 },
    ]);
    expect(sqlite.prepare("SELECT source_id, amount FROM guest_receipts ORDER BY source_id").all()).toEqual([
      { source_id: 12, amount: 500 },
    ]);
    expect(sqlite.prepare("SELECT source_id, amount_paise FROM cash_payment_events ORDER BY source_id").all()).toEqual([
      { source_id: 11, amount_paise: 300 },
    ]);
  });
});
