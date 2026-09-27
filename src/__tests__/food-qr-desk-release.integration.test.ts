import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

const razorpay = vi.hoisted(() => ({
  closeRazorpayFoodQr: vi.fn(async (_id?: string, _env?: string) => ({
    id: "qr_test1",
    status: "closed",
    image_url: null as string | null,
    image_content: null as string | null,
    close_by: null as number | null,
    close_reason: null as string | null,
  })),
  fetchRazorpayFoodQr: vi.fn(async (_id?: string, _env?: string) => ({
    id: "qr_test1",
    status: "active",
    image_url: "https://example.com/p.png" as string | null,
    image_content: null as string | null,
    close_by: Math.floor(Date.now() / 1000) + 86400 as number | null,
    close_reason: null as string | null,
  })),
  fetchRazorpayFoodQrPayments: vi.fn(async (_id?: string, _env?: string) => [] as Array<{
    id: string; amount: number; status: string; captured: boolean;
    amount_refunded: number; fee?: number; tax?: number; method?: string;
  }>),
  createRazorpayFoodQr: vi.fn(),
  razorpayId: (prefix: string) => ({
    parse: (value: string) => {
      if (!value.startsWith(`${prefix}_`)) throw new Error(`bad ${prefix} id`);
      return value;
    },
  }),
  razorpayCredentials: vi.fn(() => ({ keyId: "rzp_test_x", keySecret: "sec" })),
  workerEnv: vi.fn(() => "cloudflare"),
  allRazorpayWebhookSecrets: vi.fn(() => []),
  verifyRazorpaySignature: vi.fn(async () => false),
  RazorpayError: class RazorpayError extends Error {
    constructor(code: string, public status = 400) {
      super(code);
      this.name = "RazorpayError";
    }
  },
}));

const runtime = vi.hoisted(() => ({ isPi: false }));
const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({ getDb }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => runtime.isPi }));
vi.mock("@/lib/razorpay", () => razorpay);
vi.mock("@/db/queries", () => ({
  getSetting: vi.fn(async () => "razorpay_test"),
  getFoodOrdersByIds: vi.fn(async () => []),
  getFoodOrderItemsBatch: vi.fn(async () => new Map()),
  updateFoodOrderPayment: vi.fn(async () => undefined),
}));

import {
  FoodQrError,
  foodQrSnapshot,
  releaseFoodQrForDeskPayment,
} from "@/lib/foodQrPayment";

const ATTEMPT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createFoodQrTables(sqlite: SQLite.Database) {
  sqlite.exec(`
    CREATE TABLE food_qr_attempts (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      environment TEXT NOT NULL,
      key_id TEXT NOT NULL DEFAULT 'rzp_test_x',
      state TEXT NOT NULL,
      qr_code_id TEXT,
      qr_image_url TEXT,
      payment_amount_paise INTEGER NOT NULL,
      snapshot_due_paise INTEGER NOT NULL,
      food_order_ids TEXT NOT NULL DEFAULT '[]',
      guest_name TEXT NOT NULL DEFAULT '',
      guest_phone TEXT NOT NULL DEFAULT '',
      checkin_id INTEGER,
      close_by TEXT,
      notes TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT 'test',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE food_qr_order_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES food_qr_attempts(id),
      order_id INTEGER NOT NULL,
      claimed_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE food_qr_payments (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL REFERENCES food_qr_attempts(id),
      amount_paise INTEGER NOT NULL,
      status TEXT NOT NULL,
      captured INTEGER NOT NULL DEFAULT 0,
      refunded_paise INTEGER NOT NULL DEFAULT 0,
      fee_paise INTEGER,
      tax_paise INTEGER,
      method TEXT,
      verified_at TEXT NOT NULL
    );
    CREATE TABLE food_orders (
      id INTEGER PRIMARY KEY,
      order_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      amount_paid INTEGER NOT NULL DEFAULT 0,
      amount_refunded INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 10000,
      payment_method TEXT DEFAULT '',
      paid_by TEXT DEFAULT '',
      updated_at TEXT
    );
  `);
}

function insertActiveAttempt(
  sqlite: SQLite.Database,
  opts: { attemptId: string; orderId: number; requestKey: string; qrCodeId?: string | null; notes?: string },
) {
  const now = new Date().toISOString();
  const closeBy = new Date(Date.now() + 86400000).toISOString();
  sqlite.prepare(`
    INSERT INTO food_qr_attempts (
      id, request_key, environment, state, qr_code_id, qr_image_url, payment_amount_paise, snapshot_due_paise,
      food_order_ids, close_by, notes, created_at, updated_at
    ) VALUES (?, ?, 'test', 'active', ?, 'https://example.com/p.png', 10000, 10000, ?, ?, ?, ?, ?)
  `).run(
    opts.attemptId,
    opts.requestKey,
    opts.qrCodeId === undefined ? "qr_test1" : opts.qrCodeId,
    JSON.stringify([opts.orderId]),
    closeBy,
    opts.notes ?? "{}",
    now,
    now,
  );
  sqlite.prepare(`
    INSERT INTO food_qr_order_claims (attempt_id, order_id, claimed_at, released_at)
    VALUES (?, ?, ?, NULL)
  `).run(opts.attemptId, opts.orderId, now);
}

describe("releaseFoodQrForDeskPayment (disposable SQLite)", () => {
  let sqlite: SQLite.Database;

  beforeEach(() => {
    runtime.isPi = false;
    sqlite = new SQLite(":memory:");
    createFoodQrTables(sqlite);
    getDb.mockReturnValue(drizzle(sqlite, { schema }));
    razorpay.closeRazorpayFoodQr.mockClear();
    razorpay.fetchRazorpayFoodQr.mockClear();
    razorpay.fetchRazorpayFoodQrPayments.mockClear();
    razorpay.fetchRazorpayFoodQrPayments.mockResolvedValue([]);
    razorpay.fetchRazorpayFoodQr.mockResolvedValue({
      id: "qr_test1",
      status: "active",
      image_url: "https://example.com/p.png",
      image_content: null,
      close_by: Math.floor(Date.now() / 1000) + 86400,
      close_reason: null,
    });
    razorpay.closeRazorpayFoodQr.mockResolvedValue({
      id: "qr_test1",
      status: "closed",
      image_url: null,
      image_content: null,
      close_by: null,
      close_reason: null,
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("no-ops for empty order ids and on Pi", async () => {
    await expect(releaseFoodQrForDeskPayment([])).resolves.toEqual({ releasedAttemptIds: [] });
    runtime.isPi = true;
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-pi" });
    await expect(releaseFoodQrForDeskPayment([10])).resolves.toEqual({ releasedAttemptIds: [] });
    expect(razorpay.closeRazorpayFoodQr).not.toHaveBeenCalled();
  });

  it("no-ops when there are no unreleased claims", async () => {
    await expect(releaseFoodQrForDeskPayment([99])).resolves.toEqual({ releasedAttemptIds: [] });
    expect(razorpay.closeRazorpayFoodQr).not.toHaveBeenCalled();
  });

  it("closes Razorpay QR, releases claims, and marks attempt closed", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-1" });

    const result = await releaseFoodQrForDeskPayment([10]);
    expect(result.releasedAttemptIds).toEqual([ATTEMPT_A]);
    expect(razorpay.closeRazorpayFoodQr).toHaveBeenCalledWith("qr_test1", "test");

    const claim = sqlite.prepare("SELECT released_at FROM food_qr_order_claims WHERE order_id = 10").get() as {
      released_at: string | null;
    };
    expect(claim.released_at).toBeTruthy();
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_A)).toEqual({
      state: "closed",
    });
  });

  it("still releases when Razorpay close fails but no capture is visible", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-close-fail" });
    razorpay.closeRazorpayFoodQr.mockRejectedValueOnce(new Error("network"));

    await expect(releaseFoodQrForDeskPayment([10])).resolves.toEqual({ releasedAttemptIds: [ATTEMPT_A] });
    expect(sqlite.prepare("SELECT released_at IS NOT NULL AS released FROM food_qr_order_claims WHERE order_id = 10").get())
      .toEqual({ released: 1 });
  });

  it("aborts when a captured payment row already exists (no desk double-settle)", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-cap" });
    sqlite.prepare(`
      INSERT INTO food_qr_payments (id, attempt_id, amount_paise, status, captured, refunded_paise, verified_at)
      VALUES ('pay_cap1', ?, 10000, 'captured', 1, 0, ?)
    `).run(ATTEMPT_A, new Date().toISOString());

    await expect(releaseFoodQrForDeskPayment([10])).rejects.toBeInstanceOf(FoodQrError);
    await expect(releaseFoodQrForDeskPayment([10])).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already captured/i),
    });
    expect(sqlite.prepare("SELECT released_at FROM food_qr_order_claims WHERE order_id = 10").get()).toEqual({
      released_at: null,
    });
    expect(razorpay.closeRazorpayFoodQr).not.toHaveBeenCalled();
  });

  it("aborts when second reconcile sees a capture after close", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-race" });
    let fetchCount = 0;
    razorpay.fetchRazorpayFoodQrPayments.mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount < 3) return [];
      return [{
        id: "pay_late",
        amount: 10000,
        status: "captured",
        captured: true,
        amount_refunded: 0,
        fee: 0,
        tax: 0,
        method: "upi",
      }];
    });
    razorpay.closeRazorpayFoodQr.mockImplementation(async () => {
      sqlite.prepare(`
        INSERT INTO food_qr_payments (id, attempt_id, amount_paise, status, captured, refunded_paise, verified_at)
        VALUES ('pay_late', ?, 10000, 'captured', 1, 0, ?)
      `).run(ATTEMPT_A, new Date().toISOString());
      return {
        id: "qr_test1",
        status: "closed",
        image_url: null as string | null,
        image_content: null as string | null,
        close_by: null as number | null,
        close_reason: "paid" as string | null,
      };
    });

    await expect(releaseFoodQrForDeskPayment([10])).rejects.toMatchObject({ status: 409 });
    expect(sqlite.prepare("SELECT released_at FROM food_qr_order_claims WHERE order_id = 10").get()).toEqual({
      released_at: null,
    });
  });

  it("releases multiple distinct attempts covering the selected orders", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-a", qrCodeId: "qr_a" });
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_B, orderId: 11, requestKey: "rk-b", qrCodeId: "qr_b" });
    razorpay.fetchRazorpayFoodQr.mockImplementation(async (id?: string) => ({
      id: id || "qr_test1",
      status: "active",
      image_url: "https://example.com/p.png",
      image_content: null as string | null,
      close_by: Math.floor(Date.now() / 1000) + 86400 as number | null,
      close_reason: null as string | null,
    }));

    const result = await releaseFoodQrForDeskPayment([10, 11]);
    expect(result.releasedAttemptIds.sort()).toEqual([ATTEMPT_A, ATTEMPT_B].sort());
    expect(razorpay.closeRazorpayFoodQr).toHaveBeenCalledTimes(2);
  });

  it("heals stuck unreleased claims on already-closed attempts without calling close", async () => {
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO food_qr_attempts (
        id, request_key, environment, state, qr_code_id, qr_image_url, payment_amount_paise, snapshot_due_paise,
        food_order_ids, close_by, notes, created_at, updated_at
      ) VALUES (?, 'rk-stuck', 'test', 'closed', 'qr_old', NULL, 10000, 10000, '[10]', NULL, '{}', ?, ?)
    `).run(ATTEMPT_A, now, now);
    sqlite.prepare(`
      INSERT INTO food_qr_order_claims (attempt_id, order_id, claimed_at, released_at)
      VALUES (?, 10, ?, NULL)
    `).run(ATTEMPT_A, now);

    const result = await releaseFoodQrForDeskPayment([10]);
    expect(result.releasedAttemptIds).toEqual([ATTEMPT_A]);
    expect(razorpay.closeRazorpayFoodQr).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT released_at IS NOT NULL AS released FROM food_qr_order_claims WHERE order_id = 10").get())
      .toEqual({ released: 1 });
  });

  it("exposes hasUpiIntent on snapshots", async () => {
    insertActiveAttempt(sqlite, {
      attemptId: ATTEMPT_A,
      orderId: 10,
      requestKey: "rk-intent",
      notes: JSON.stringify({ upiIntent: "upi://pay?pa=x@ybl&am=100.00" }),
    });
    const snap = await foodQrSnapshot(ATTEMPT_A);
    expect(snap.hasUpiIntent).toBe(true);
    expect(snap.upiIntent).toContain("upi://pay");
  });
});

describe("releaseFoodQrForDeskPayment missing-table safety", () => {
  it("treats missing food_qr tables as no claims (pre-0083 / disposable)", async () => {
    runtime.isPi = false;
    const empty = new SQLite(":memory:");
    getDb.mockReturnValue(drizzle(empty, { schema }));
    await expect(releaseFoodQrForDeskPayment([1])).resolves.toEqual({ releasedAttemptIds: [] });
    empty.close();
  });
});
