import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { POST as webhookApi } from "@/app/api/webhooks/razorpay/route";
import { createPreviewAttempt } from "@/lib/razorpayPreview";
import { peekRazorpayNotes } from "@/lib/nativeGuestCheckout";

const state = vi.hoisted(() => ({ db: null as any, pi: false }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no cloudflare context"); } }));

const KEY = "DUMMY_API_SECRET", HOOK = "DUMMY_WEBHOOK_SECRET";
const AMOUNT = 1000;
let sqlite: SQLite.Database;
let providerOrders: Map<string, any>, providerPayments: Map<string, any>;
let calls: { path: string; method: string; body: any }[];

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const sign = (value: string | Uint8Array, secret = HOOK) => createHmac("sha256", secret).update(value).digest("hex");
const encode = (s: string) => new TextEncoder().encode(s);
const hookRequest = (body: string, eventId = "evt_NATIVE1", signature = sign(body)) => new NextRequest("https://preview.example/api/webhooks/razorpay", {
  method: "POST", headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId }, body,
});

function seedCheckout(overrides: { id?: string; orderId?: string; state?: string } = {}) {
  const id = overrides.id || crypto.randomUUID();
  const orderId = overrides.orderId || "order_NATIVE1";
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO native_booking_checkouts (
    id, request_key, request_hash, owner_hash, guest_access_hash,
    payment_choice, environment, state, razorpay_order_id, razorpay_key_id,
    receipt, due_now_paise, guest_name, guest_email, guest_phone, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, crypto.randomUUID(), "a".repeat(64), "b".repeat(64), "c".repeat(64),
    "full", "test", overrides.state || "ready", orderId, "rzp_test_DUMMYPUBLIC",
    `gbk_${id.replace(/-/g, "").slice(0, 32)}`, AMOUNT, "Test Guest", "guest@example.test", "", now, now,
  );
  return { id, orderId };
}

function payment(checkout: { id: string; orderId: string }, status: "authorized" | "captured" | "failed" = "captured", id = "pay_NATIVE1") {
  const p = {
    entity: "payment", id, order_id: checkout.orderId, amount: AMOUNT, currency: "INR", status,
    captured: ["captured", "refunded"].includes(status), amount_refunded: 0,
    notes: { goko_checkout_id: checkout.id },
    email: "DUMMY_PRIVATE@example.test",
  };
  providerPayments.set(id, p);
  return p;
}

const payload = (p: any, event = "payment.captured") => JSON.stringify({
  event, account_id: "acc_DUMMY", payload: { payment: { entity: p } },
});

beforeEach(() => {
  state.pi = false;
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE beds (id INTEGER PRIMARY KEY); INSERT INTO beds VALUES (1),(2),(3);
    CREATE TABLE booking_bed_assignments (bed_id INTEGER, status TEXT, checkin_date TEXT, checkout_date TEXT);
    CREATE TABLE bed_blocks (bed_id INTEGER, is_active INTEGER, start_date TEXT, end_date TEXT);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY);
  `);
  for (const file of [
    "0057_razorpay_test_preview.sql",
    "0058_razorpay_webhook_refund_id.sql",
    "0059_native_inventory_hold_primitive.sql",
    "0060_native_accepted_quotes.sql",
    "0061_guest_booking_lookup.sql",
    "0062_native_guest_checkout.sql",
  ]) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  state.db = drizzle(sqlite, { schema });
  vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_DUMMYPUBLIC");
  vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", KEY);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", HOOK);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", "DUMMY_DISTINCT_LIVE");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_TEST_ACCOUNT_ID", "acc_DUMMY");
  vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "true");
  calls = [];
  providerOrders = new Map();
  providerPayments = new Map();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api.razorpay.com");
    const path = parsed.pathname.replace("/v1/", "");
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (path === "orders" && method === "POST") {
      const id = `order_DUMMY${providerOrders.size + 1}`;
      const order = { entity: "order", id, ...body, status: "created" };
      providerOrders.set(id, order);
      return json(order);
    }
    if (path === "orders") {
      return json({
        entity: "collection",
        items: [...providerOrders.values()].filter((o) => !parsed.searchParams.get("receipt") || o.receipt === parsed.searchParams.get("receipt")),
      });
    }
    const orderPayments = path.match(/^orders\/(order_[A-Za-z0-9]+)\/payments$/);
    if (orderPayments) {
      return json({ entity: "collection", items: [...providerPayments.values()].filter((p) => p.order_id === orderPayments[1]) });
    }
    const pay = path.match(/^payments\/(pay_[A-Za-z0-9]+)$/);
    if (pay) return providerPayments.has(pay[1]) ? json(providerPayments.get(pay[1])) : json({ error: "unknown" }, 404);
    throw new Error(`Unexpected mock gateway request: ${path}`);
  }));
});

afterEach(() => {
  if (sqlite.open) sqlite.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Native guest webhook routing and ledger", () => {
  it("peekRazorpayNotes detects goko_checkout_id vs goko_preview_attempt", () => {
    const checkoutId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    expect(peekRazorpayNotes(encode(JSON.stringify({
      payload: { payment: { entity: { notes: { goko_checkout_id: checkoutId } } } },
    })))).toEqual({ checkoutId });
    expect(peekRazorpayNotes(encode(JSON.stringify({
      payload: { order: { entity: { notes: { goko_preview_attempt: attemptId } } } },
    })))).toEqual({ previewAttemptId: attemptId });
    expect(peekRazorpayNotes(encode(JSON.stringify({
      payload: { payment: { entity: { notes: { goko_checkout_id: checkoutId, goko_preview_attempt: attemptId } } } },
    })))).toEqual({ checkoutId });
    expect(peekRazorpayNotes(encode("{}"))).toEqual({});
  });

  it("webhook with goko_checkout_id routes to native ledger", async () => {
    const checkoutId = crypto.randomUUID();
    const raw = JSON.stringify({
      event: "settlement.processed", account_id: "acc_DUMMY",
      payload: { payment: { entity: { id: "pay_ROUTE1", notes: { goko_checkout_id: checkoutId } } } },
    });
    const response = await webhookApi(hookRequest(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "ignored" });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_webhooks").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT checkout_id, state FROM native_booking_webhooks").get()).toEqual({
      checkout_id: checkoutId, state: "ignored",
    });
  });

  it("webhook with goko_preview_attempt still goes to gateway_preview_webhooks", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    const p = {
      entity: "payment", id: "pay_PREVIEW1", order_id: first.attempt.orderId, amount: 100, currency: "INR",
      status: "captured", captured: true, amount_refunded: 0,
      notes: { goko_preview_attempt: first.attempt.id },
    };
    providerPayments.set(p.id, p);
    const raw = payload(p);
    expect((await webhookApi(hookRequest(raw, "evt_PREVIEW1"))).status).toBe(200);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_webhooks").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT attempt_id, state FROM gateway_preview_webhooks").get()).toEqual({
      attempt_id: first.attempt.id, state: "processed",
    });
  });

  it("payment.captured for native checkout records payment and attempts fulfil", async () => {
    const checkout = seedCheckout();
    const p = payment(checkout);
    const response = await webhookApi(hookRequest(payload(p)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "processed" });
    expect(sqlite.prepare("SELECT id, captured, status FROM native_booking_payments").get()).toEqual({
      id: "pay_NATIVE1", captured: 1, status: "captured",
    });
    expect(sqlite.prepare("SELECT state FROM native_booking_checkouts WHERE id=?").get(checkout.id)).toEqual({ state: "captured" });
    expect(sqlite.prepare("SELECT state FROM native_booking_webhooks").get()).toEqual({ state: "processed" });
    expect(calls.some((c) => c.path === "payments/pay_NATIVE1")).toBe(true);
  });

  it("capture retry: 503 when evidence missing, then succeeds", async () => {
    const checkout = seedCheckout();
    const p = payment(checkout, "authorized");
    const raw = payload({ ...p, status: "captured", captured: true });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    expect(sqlite.prepare("SELECT state FROM native_booking_webhooks").get()).toEqual({ state: "retry" });
    expect(sqlite.prepare("SELECT captured FROM native_booking_payments").get()).toEqual({ captured: 0 });
    payment(checkout);
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect(sqlite.prepare("SELECT state FROM native_booking_webhooks").get()).toEqual({ state: "processed" });
    expect(sqlite.prepare("SELECT captured, status FROM native_booking_payments").get()).toEqual({
      captured: 1, status: "captured",
    });
  });

  it("rejects bad signature before persistence", async () => {
    const checkout = seedCheckout();
    const raw = payload(payment(checkout));
    expect((await webhookApi(hookRequest(raw, "evt_BAD", "0".repeat(64)))).status).toBe(400);
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_webhooks").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 0 });
    expect(calls).toHaveLength(0);
  });

  it("rejects conflicting webhook replay under the same event ID", async () => {
    const checkout = seedCheckout();
    const p = payment(checkout);
    expect((await webhookApi(hookRequest(payload(p)))).status).toBe(200);
    expect((await webhookApi(hookRequest(payload(p, "payment.authorized")))).status).toBe(409);
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_webhooks").get()).toEqual({ n: 1 });
  });

  it("stores unsupported signed native event as ignored", async () => {
    const checkoutId = crypto.randomUUID();
    const raw = JSON.stringify({
      event: "settlement.processed", account_id: "acc_DUMMY",
      payload: { payment: { entity: { id: "pay_IGNORE1", notes: { goko_checkout_id: checkoutId } } } },
    });
    const response = await webhookApi(hookRequest(raw, "evt_IGNORE1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "ignored" });
    expect(calls).toHaveLength(0);
    expect(sqlite.prepare("SELECT state, event_type FROM native_booking_webhooks").get()).toEqual({
      state: "ignored", event_type: "settlement.processed",
    });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_payments").get()).toEqual({ n: 0 });
  });
});
