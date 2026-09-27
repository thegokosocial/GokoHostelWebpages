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
  razorpayCredentials: vi.fn(() => ({ keyId: "rzp_test_xxxxxxxxx", keySecret: "sec" })),
  workerEnv: vi.fn(() => ({
    RAZORPAY_TEST_KEY_ID: "rzp_test_xxxxxxxxx",
    RAZORPAY_TEST_KEY_SECRET: "test_secret_value_ok",
  })),
  allRazorpayWebhookSecrets: vi.fn(() => []),
  verifyRazorpaySignature: vi.fn(async () => false),
  RazorpayError: class RazorpayError extends Error {
    constructor(code: string, public httpStatus = 503) {
      super(
        code === "UNAVAILABLE" || code === "INVALID_RESPONSE"
          ? "Unable to verify the gateway result. Reconcile before trying again."
          : code,
      );
      this.name = "RazorpayError";
    }
  },
}));

const runtime = vi.hoisted(() => ({ isPi: false }));
const getDb = vi.hoisted(() => vi.fn());
const queries = vi.hoisted(() => ({
  getSetting: vi.fn(async () => "razorpay_test"),
  getFoodOrdersByIds: vi.fn(async () => [] as Array<Record<string, unknown>>),
  getFoodOrderItemsBatch: vi.fn(async () => new Map()),
  updateFoodOrderPayment: vi.fn(async () => undefined),
}));

vi.mock("@/db", () => ({ getDb }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => runtime.isPi }));
vi.mock("@/lib/razorpay", () => razorpay);
vi.mock("@/db/queries", () => queries);

import {
  FoodQrError,
  closeActiveFoodQrAttempt,
  ensureActiveFoodQrForOrders,
  foodQrSnapshot,
  hasActiveFoodQrClaim,
  reconcileFoodQrAttempt,
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
  opts: {
    attemptId: string;
    orderId: number;
    requestKey: string;
    qrCodeId?: string | null;
    notes?: string;
    orderIds?: number[];
    amountPaise?: number;
    guestName?: string;
    guestPhone?: string;
    createdAt?: string;
  },
) {
  const now = opts.createdAt ?? new Date().toISOString();
  const closeBy = new Date(Date.now() + 86400000).toISOString();
  const orderIds = opts.orderIds ?? [opts.orderId];
  const amount = opts.amountPaise ?? 10000;
  const defaultNotes = JSON.stringify({
    fingerprint: orderIds.map((id) => `${id}:${amount}`).join("|"),
    orderSnapshot: orderIds.map((id) => ({ orderId: id, duePaise: amount, priorPaidPaise: 0, total: amount })),
  });
  sqlite.prepare(`
    INSERT INTO food_qr_attempts (
      id, request_key, environment, state, qr_code_id, qr_image_url, payment_amount_paise, snapshot_due_paise,
      food_order_ids, guest_name, guest_phone, close_by, notes, created_at, updated_at
    ) VALUES (?, ?, 'test', 'active', ?, 'https://example.com/p.png', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.attemptId,
    opts.requestKey,
    opts.qrCodeId === undefined ? "qr_test1" : opts.qrCodeId,
    amount,
    amount,
    JSON.stringify(orderIds),
    opts.guestName ?? "",
    opts.guestPhone ?? "",
    closeBy,
    opts.notes ?? defaultNotes,
    now,
    now,
  );
  for (const orderId of orderIds) {
    sqlite.prepare(`
      INSERT INTO food_qr_order_claims (attempt_id, order_id, claimed_at, released_at)
      VALUES (?, ?, ?, NULL)
    `).run(opts.attemptId, orderId, now);
  }
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

describe("closeActiveFoodQrAttempt (disposable SQLite)", () => {
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

  it("closes by attempt id and clears hasActiveFoodQrClaim for those orders", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-close-api" });
    await expect(hasActiveFoodQrClaim([10])).resolves.toBe(true);

    const result = await closeActiveFoodQrAttempt(ATTEMPT_A);
    expect(result.releasedAttemptIds).toEqual([ATTEMPT_A]);
    expect(razorpay.closeRazorpayFoodQr).toHaveBeenCalledWith("qr_test1", "test");
    await expect(hasActiveFoodQrClaim([10])).resolves.toBe(false);
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_A)).toEqual({
      state: "closed",
    });
  });

  it("404 when attempt is missing", async () => {
    await expect(closeActiveFoodQrAttempt(ATTEMPT_A)).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(/not found/i),
    });
  });

  it("400 when attempt has no parseable order ids", async () => {
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO food_qr_attempts (
        id, request_key, environment, state, qr_code_id, qr_image_url, payment_amount_paise, snapshot_due_paise,
        food_order_ids, close_by, notes, created_at, updated_at
      ) VALUES (?, 'rk-empty', 'test', 'active', 'qr_e', NULL, 10000, 10000, '[]', NULL, '{}', ?, ?)
    `).run(ATTEMPT_A, now, now);

    await expect(closeActiveFoodQrAttempt(ATTEMPT_A)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/no orders/i),
    });
  });

  it("400 when food_order_ids JSON is invalid", async () => {
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO food_qr_attempts (
        id, request_key, environment, state, qr_code_id, qr_image_url, payment_amount_paise, snapshot_due_paise,
        food_order_ids, close_by, notes, created_at, updated_at
      ) VALUES (?, 'rk-bad', 'test', 'active', 'qr_b', NULL, 10000, 10000, 'not-json', NULL, '{}', ?, ?)
    `).run(ATTEMPT_A, now, now);

    await expect(closeActiveFoodQrAttempt(ATTEMPT_A)).rejects.toMatchObject({ status: 400 });
  });

  it("aborts Close when Razorpay capture already exists (no double-settle)", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-close-cap" });
    sqlite.prepare(`
      INSERT INTO food_qr_payments (id, attempt_id, amount_paise, status, captured, refunded_paise, verified_at)
      VALUES ('pay_close_cap', ?, 10000, 'captured', 1, 0, ?)
    `).run(ATTEMPT_A, new Date().toISOString());

    await expect(closeActiveFoodQrAttempt(ATTEMPT_A)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already captured/i),
    });
    expect(sqlite.prepare("SELECT released_at FROM food_qr_order_claims WHERE order_id = 10").get()).toEqual({
      released_at: null,
    });
    await expect(hasActiveFoodQrClaim([10])).resolves.toBe(true);
  });

  it("refuses on Pi runtime via cloudOnly", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-pi-close" });
    runtime.isPi = true;
    await expect(closeActiveFoodQrAttempt(ATTEMPT_A)).rejects.toMatchObject({
      status: expect.any(Number),
    });
    expect(razorpay.closeRazorpayFoodQr).not.toHaveBeenCalled();
  });

  it("Retire proceeds when reconcile throws UNAVAILABLE (no local capture)", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-unavail" });
    razorpay.fetchRazorpayFoodQr.mockRejectedValue(new razorpay.RazorpayError("UNAVAILABLE"));

    await expect(closeActiveFoodQrAttempt(ATTEMPT_A)).resolves.toEqual({
      releasedAttemptIds: [ATTEMPT_A],
    });
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_A)).toEqual({
      state: "closed",
    });
    await expect(hasActiveFoodQrClaim([10])).resolves.toBe(false);
  });

  it("Retire proceeds when reconcile throws INVALID_RESPONSE", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-invalid" });
    razorpay.fetchRazorpayFoodQr.mockRejectedValue(new razorpay.RazorpayError("INVALID_RESPONSE"));

    await expect(releaseFoodQrForDeskPayment([10])).resolves.toEqual({
      releasedAttemptIds: [ATTEMPT_A],
    });
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_A)).toEqual({
      state: "closed",
    });
  });

  it("reconcile succeeds with null close_reason on active QR (schema regression path)", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-null-close" });
    razorpay.fetchRazorpayFoodQr.mockResolvedValue({
      id: "qr_test1",
      status: "active",
      image_url: "https://example.com/p.png",
      image_content: null,
      close_by: null,
      close_reason: null,
    });

    const snap = await reconcileFoodQrAttempt(ATTEMPT_A);
    expect(snap.state).toBe("active");
  });

  it("retireAllOpenFoodQrAttempts closes open QRs and skips captured ones", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-bulk-a", qrCodeId: "qr_bulk_a" });
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_B, orderId: 11, requestKey: "rk-bulk-b", qrCodeId: "qr_bulk_b" });
    sqlite.prepare(`
      INSERT INTO food_qr_payments (id, attempt_id, amount_paise, status, captured, refunded_paise, verified_at)
      VALUES ('pay_cap', ?, 10000, 'captured', 1, 0, ?)
    `).run(ATTEMPT_B, new Date().toISOString());

    const { retireAllOpenFoodQrAttempts } = await import("@/lib/foodQrPayment");
    const result = await retireAllOpenFoodQrAttempts();
    expect(result.retiredAttemptIds).toContain(ATTEMPT_A);
    expect(result.skippedCapturedIds).toContain(ATTEMPT_B);
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_A)).toEqual({
      state: "closed",
    });
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_B)).toEqual({
      state: "active",
    });
  });

  it("listFoodQrAttempts filters by guest query and IST date range", async () => {
    insertActiveAttempt(sqlite, {
      attemptId: ATTEMPT_A,
      orderId: 10,
      requestKey: "rk-list-a",
      qrCodeId: "qr_list_a",
      guestName: "Pawan test",
      guestPhone: "123454321",
      createdAt: "2026-09-27T10:00:00.000Z",
    });
    insertActiveAttempt(sqlite, {
      attemptId: ATTEMPT_B,
      orderId: 11,
      requestKey: "rk-list-b",
      qrCodeId: "qr_list_b",
      guestName: "Manu",
      guestPhone: "999",
      createdAt: "2026-09-20T10:00:00.000Z",
    });
    sqlite.prepare(`
      INSERT INTO food_qr_payments (id, attempt_id, amount_paise, status, captured, refunded_paise, verified_at)
      VALUES ('pay_list_a', ?, 10000, 'captured', 1, 0, ?)
    `).run(ATTEMPT_A, "2026-09-27T11:00:00.000Z");

    const { listFoodQrAttempts } = await import("@/lib/foodQrPayment");
    const byGuest = await listFoodQrAttempts({ query: "Pawan" });
    expect(byGuest.attempts.map((a) => a.id)).toEqual([ATTEMPT_A]);
    expect(byGuest.total).toBe(1);

    const byPay = await listFoodQrAttempts({ query: "pay_list_a" });
    expect(byPay.attempts.map((a) => a.id)).toEqual([ATTEMPT_A]);

    const byDay = await listFoodQrAttempts({ fromDate: "2026-09-27", toDate: "2026-09-27" });
    expect(byDay.attempts.map((a) => a.id)).toEqual([ATTEMPT_A]);

    const older = await listFoodQrAttempts({ fromDate: "2026-09-20", toDate: "2026-09-20" });
    expect(older.attempts.map((a) => a.id)).toEqual([ATTEMPT_B]);
  });
});

describe("ensureActiveFoodQrForOrders remint (disposable SQLite)", () => {
  let sqlite: SQLite.Database;

  beforeEach(() => {
    runtime.isPi = false;
    sqlite = new SQLite(":memory:");
    createFoodQrTables(sqlite);
    getDb.mockReturnValue(drizzle(sqlite, { schema }));
    queries.getSetting.mockResolvedValue("razorpay_test");
    queries.getFoodOrderItemsBatch.mockResolvedValue(new Map());
    queries.getFoodOrdersByIds.mockReset();
    razorpay.closeRazorpayFoodQr.mockClear();
    razorpay.fetchRazorpayFoodQr.mockClear();
    razorpay.fetchRazorpayFoodQrPayments.mockClear();
    razorpay.createRazorpayFoodQr.mockReset();
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
    razorpay.createRazorpayFoodQr.mockImplementation(async (input: { attemptId: string; amountPaise: number }) => ({
      id: `qr_new_${input.attemptId.slice(0, 6)}`,
      entity: "qr_code",
      usage: "single_use",
      type: "upi_qr",
      image_url: "https://example.com/new.png",
      image_content: "upi://pay?pa=x@ybl&am=200.00",
      payment_amount: input.amountPaise,
      status: "active",
      fixed_amount: true,
      close_by: Math.floor(Date.now() / 1000) + 86400,
      close_reason: null,
      notes: { goko_food_attempt: input.attemptId },
    }));
  });

  afterEach(() => {
    sqlite.close();
  });

  it("fingerprint mismatch provider-closes old QR, expires claims, mints new attempt", async () => {
    insertActiveAttempt(sqlite, {
      attemptId: ATTEMPT_A,
      orderId: 10,
      requestKey: "rk-old-bill",
      amountPaise: 10000,
    });
    queries.getFoodOrdersByIds.mockResolvedValue([
      {
        id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "pending",
        total: 10000, amountPaid: 0, amountRefunded: 0, guestName: "Pawan", guestPhone: "1", checkinId: null,
      },
      {
        id: 11, orderNumber: "F-11", status: "placed", paymentStatus: "pending",
        total: 10000, amountPaid: 0, amountRefunded: 0, guestName: "Pawan", guestPhone: "1", checkinId: null,
      },
    ]);

    const snap = await ensureActiveFoodQrForOrders({
      requestKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      orderIds: [10, 11],
      createdBy: "admin",
    });

    expect(razorpay.closeRazorpayFoodQr).toHaveBeenCalledWith("qr_test1", "test");
    expect(sqlite.prepare("SELECT state FROM food_qr_attempts WHERE id = ?").get(ATTEMPT_A)).toEqual({
      state: "expired",
    });
    expect(sqlite.prepare("SELECT released_at IS NOT NULL AS r FROM food_qr_order_claims WHERE order_id = 10").get())
      .toEqual({ r: 1 });
    expect(snap.state).toBe("active");
    expect(snap.attemptId).not.toBe(ATTEMPT_A);
    await expect(hasActiveFoodQrClaim([10, 11])).resolves.toBe(true);
  });

  it("remint aborts when old attempt already has capture", async () => {
    insertActiveAttempt(sqlite, { attemptId: ATTEMPT_A, orderId: 10, requestKey: "rk-paid-old" });
    sqlite.prepare(`
      INSERT INTO food_qr_payments (id, attempt_id, amount_paise, status, captured, refunded_paise, verified_at)
      VALUES ('pay_old', ?, 10000, 'captured', 1, 0, ?)
    `).run(ATTEMPT_A, new Date().toISOString());
    queries.getFoodOrdersByIds.mockResolvedValue([
      {
        id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "pending",
        total: 10000, amountPaid: 0, amountRefunded: 0, guestName: "Pawan", guestPhone: "1", checkinId: null,
      },
      {
        id: 11, orderNumber: "F-11", status: "placed", paymentStatus: "pending",
        total: 5000, amountPaid: 0, amountRefunded: 0, guestName: "Pawan", guestPhone: "1", checkinId: null,
      },
    ]);

    await expect(ensureActiveFoodQrForOrders({
      requestKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      orderIds: [10, 11],
      createdBy: "admin",
    })).rejects.toMatchObject({ status: 409 });
    expect(sqlite.prepare("SELECT released_at FROM food_qr_order_claims WHERE order_id = 10").get()).toEqual({
      released_at: null,
    });
  });

  it("stress: alternating fingerprints remint without leaked claims", async () => {
    const ordersA = [{
      id: 10, orderNumber: "F-10", status: "placed", paymentStatus: "pending",
      total: 10000, amountPaid: 0, amountRefunded: 0, guestName: "P", guestPhone: "1", checkinId: null,
    }];
    const ordersB = [
      ...ordersA,
      {
        id: 11, orderNumber: "F-11", status: "placed", paymentStatus: "pending",
        total: 10000, amountPaid: 0, amountRefunded: 0, guestName: "P", guestPhone: "1", checkinId: null,
      },
    ];

    queries.getFoodOrdersByIds.mockResolvedValue(ordersA);
    await ensureActiveFoodQrForOrders({
      requestKey: "11111111-1111-4111-8111-111111111111",
      orderIds: [10],
      createdBy: "admin",
    });

    for (let i = 0; i < 8; i++) {
      const useB = i % 2 === 0;
      queries.getFoodOrdersByIds.mockResolvedValue(useB ? ordersB : ordersA);
      razorpay.createRazorpayFoodQr.mockClear();
      razorpay.closeRazorpayFoodQr.mockClear();
      await ensureActiveFoodQrForOrders({
        requestKey: crypto.randomUUID(),
        orderIds: useB ? [10, 11] : [10],
        createdBy: "admin",
      });
      expect(razorpay.closeRazorpayFoodQr).toHaveBeenCalled();
      const openClaims = sqlite.prepare(`
        SELECT COUNT(*) AS n FROM food_qr_order_claims WHERE released_at IS NULL
      `).get() as { n: number };
      expect(openClaims.n).toBe(useB ? 2 : 1);
    }
  });
});
