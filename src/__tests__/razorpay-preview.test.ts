import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { getSyncableTableNames } from "@/lib/syncEngine";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { POST as adminApi } from "@/app/api/admin/booking-payments/route";
import { POST as webhookApi } from "@/app/api/webhooks/razorpay/route";
import { createPreviewAttempt, previewSnapshot, reconcilePreviewAttempt, verifyPreviewCallback, claimPreviewCheckout,
  refundPreviewPayment, processPreviewWebhook } from "@/lib/razorpayPreview";
import { verifyRazorpaySignature, checkRazorpayTestConnectivity, testRazorpayCredentials } from "@/lib/razorpay";

const state = vi.hoisted(() => ({ db: null as any, role: "admin", pi: false, unavailableAuth: false }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no cloudflare context"); } }));
vi.mock("@/lib/auth", () => ({ authenticateUser: async (password: string) => {
  if (state.unavailableAuth) throw new Error("DUMMY_AUTH_INTERNAL");
  return password === "DUMMY_PASSWORD" ? { role: state.role, displayName: "Test Admin", permissions: {
    canManageAccounts: true, canViewAccounts: true, canManageInventory: true, canSettlePlatformPayments: true,
  } } : null;
} }));
const KEY = "DUMMY_API_SECRET", HOOK = "DUMMY_WEBHOOK_SECRET";
let sqlite: SQLite.Database;
let providerOrders: Map<string, any>, providerPayments: Map<string, any>, providerRefunds: Map<string, any>;
let calls: { path: string; method: string; body: any }[];
let failOrderResponse: boolean, failRefundResponse: boolean, failGets: boolean, malformedOrder: boolean;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const sign = (value: string | Uint8Array, secret = HOOK) => createHmac("sha256", secret).update(value).digest("hex");
const adminRequest = (action: string, extra = {}, password = "DUMMY_PASSWORD") => new NextRequest("https://preview.example/api/admin/booking-payments", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, password, ...extra }),
});
const hookRequest = (body: string, eventId = "evt_DUMMY1", signature = sign(body)) => new NextRequest("https://preview.example/api/webhooks/razorpay", {
  method: "POST", headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId }, body,
});
function payment(attempt: any, status = "captured", id = "pay_DUMMY1") {
  const p = { entity: "payment", id, order_id: attempt.orderId, amount: 100, currency: "INR", status,
    captured: ["captured", "refunded"].includes(status), amount_refunded: status === "refunded" ? 100 : 0,
    email: "DUMMY_PRIVATE@example.test", card: { last4: "DUMMY_PRIVATE_CARD" },
  };
  providerPayments.set(id, p); return p;
}
const payload = (p: any, event = "payment.captured") => JSON.stringify({ event, account_id: "acc_DUMMY", payload: { payment: { entity: p } } });

beforeEach(() => {
  state.role = "admin"; state.pi = false; state.unavailableAuth = false;
  sqlite = new SQLite(":memory:"); sqlite.pragma("foreign_keys = ON");
  // Exact source migration, isolated memory DB. No live D1/Pi migration occurs.
  sqlite.exec(readFileSync("migrations/0057_razorpay_test_preview.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0058_razorpay_webhook_refund_id.sql", "utf8"));
  state.db = drizzle(sqlite, { schema });
  vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_DUMMYPUBLIC"); vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", KEY);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", HOOK); vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", "DUMMY_DISTINCT_LIVE"); vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_TEST_ACCOUNT_ID", "acc_DUMMY"); vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "true");
  calls = []; providerOrders = new Map(); providerPayments = new Map(); providerRefunds = new Map();
  failOrderResponse = false; failRefundResponse = false; failGets = false; malformedOrder = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url); expect(parsed.origin).toBe("https://api.razorpay.com");
    expect(init.redirect).toBe("manual"); expect(init.cache).toBe("no-store");
    expect((init.headers as any).Authorization).toBe(`Basic ${btoa(`rzp_test_DUMMYPUBLIC:${KEY}`)}`);
    const path = parsed.pathname.replace("/v1/", ""), method = init.method || "GET", body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (failGets && method === "GET") throw new Error("DUMMY_PRIVATE_PROVIDER_FAILURE");
    if (path === "orders" && method === "POST") {
      const id = `order_DUMMY${providerOrders.size + 1}`;
      const order = { entity: "order", id, ...body, status: "created", ...(malformedOrder ? { amount: 999 } : {}) };
      providerOrders.set(id, order);
      if (failOrderResponse) throw new Error("Response lost after remote order creation");
      return json(order);
    }
    if (path === "orders") return json({ entity: "collection", items: [...providerOrders.values()].filter((o) => !parsed.searchParams.get("receipt") || o.receipt === parsed.searchParams.get("receipt")) });
    const orderPayments = path.match(/^orders\/(order_[A-Za-z0-9]+)\/payments$/);
    if (orderPayments) return json({ entity: "collection", items: [...providerPayments.values()].filter((p) => p.order_id === orderPayments[1]) });
    const pay = path.match(/^payments\/(pay_[A-Za-z0-9]+)$/);
    if (pay) return providerPayments.has(pay[1]) ? json(providerPayments.get(pay[1])) : json({ error: "DUMMY_PRIVATE_UNKNOWN_PAYMENT" }, 404);
    const refund = path.match(/^payments\/(pay_[A-Za-z0-9]+)\/refund$/);
    if (refund && method === "POST") {
      const id = `rfnd_DUMMY${providerRefunds.size + 1}`;
      const r = { entity: "refund", id, payment_id: refund[1], ...body, currency: "INR", status: "pending" };
      providerRefunds.set(id, r);
      if (failRefundResponse) throw new Error("Response lost after remote refund creation");
      return json(r);
    }
    const refundList = path.match(/^payments\/(pay_[A-Za-z0-9]+)\/refunds$/);
    if (refundList) return json({ entity: "collection", items: [...providerRefunds.values()].filter((r) => r.payment_id === refundList[1]) });
    const exactRefund = path.match(/^refunds\/(rfnd_[A-Za-z0-9]+)$/);
    if (exactRefund) return providerRefunds.has(exactRefund[1]) ? json(providerRefunds.get(exactRefund[1])) : json({}, 404);
    throw new Error(`Unexpected mock gateway request: ${path}`);
  }));
});
afterEach(() => { if (sqlite.open) sqlite.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Razorpay adapter and security boundaries", () => {
  it.each(["gateway_preview_attempts", "gateway_preview_payments", "gateway_preview_refunds", "gateway_preview_webhooks"])("blocks new orders before provider POST if required table %s is missing", async (table) => {
    sqlite.exec(`DROP TABLE ${table}`); // Fixture-owned fixed cases only.
    expect((await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it("blocks new orders when exact refund identity migration is missing", async () => {
    sqlite.exec("ALTER TABLE gateway_preview_webhooks DROP COLUMN refund_id");
    expect((await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }))).status).toBe(503);
    expect(calls).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_attempts").get()).toEqual({ n: 0 });
  });
  it("requires a current test webhook secret for new operations, even with a previous secret", async () => {
    vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", ""); vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", HOOK);
    expect((await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it("blocks new operations when test and live webhook secrets are shared", async () => {
    vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS", HOOK);
    expect((await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it("authenticates test connectivity without creating an order/payment", async () => {
    expect(await checkRazorpayTestConnectivity()).toEqual({ authenticated: true, environment: "test", nativeCheckoutReady: false });
    expect(calls).toHaveLength(1); expect(calls[0].method).toBe("GET");
  });
  it("maps rejected Razorpay credentials to a clear admin error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { description: "Authentication failed" } }), { status: 401 })));
    await expect(checkRazorpayTestConnectivity()).rejects.toMatchObject({ code: "REJECTED" });
  });
  it("parses real Razorpay order list shapes returned by connectivity checks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      entity: "collection", count: 1, items: [{
        id: "order_DUMMY1", entity: "order", amount: 100, amount_paid: null, amount_due: 100,
        currency: "INR", receipt: "goko_connectivity_probe", status: "created", notes: [],
      }],
    })));
    await expect(checkRazorpayTestConnectivity()).resolves.toEqual({ authenticated: true, environment: "test", nativeCheckoutReady: false });
  });
  it.each(["rzp_live_DUMMY", "rzp_test_", "rzp_test_BAD/ID", " rzp_test_DUMMY"])("rejects non-test/malformed key %s before network", async (id) => {
    vi.stubEnv("RAZORPAY_TEST_KEY_ID", id);
    expect(() => testRazorpayCredentials()).toThrow(); expect(calls).toHaveLength(0);
  });
  it.each(["", " ", " DUMMY", "DUMMY\n", "DUMMY:☃"])("rejects malformed API secret %s", (secret) => {
    vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", secret); expect(() => testRazorpayCredentials()).toThrow();
  });
  it("verifies exact bytes with independent HMAC and rejects reformatted JSON/invalid signature", async () => {
    const raw = '{ "snowman": "☃", "x": 1 }';
    expect(await verifyRazorpaySignature(new TextEncoder().encode(raw), sign(raw), HOOK)).toBe(true);
    expect(await verifyRazorpaySignature(JSON.stringify(JSON.parse(raw)), sign(raw), HOOK)).toBe(false);
    expect(await verifyRazorpaySignature(raw, "0".repeat(64), HOOK)).toBe(false);
    expect(await verifyRazorpaySignature(raw, "nope", HOOK)).toBe(false);
  });
  it.each(["manager", "staff"])("rejects %s even with stored broad permissions", async (role) => {
    state.role = role;
    expect((await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it("denies every test action to manager/staff without provider or ledger side effects", async () => {
    const attemptId = crypto.randomUUID(), requestKey = crypto.randomUUID();
    const actions: [string, object][] = [
      ["checkTestConnectivity", {}], ["listTestAttempts", {}], ["createTestAttempt", { requestKey }],
      ["getTestRequest", { requestKey }], ["getTestAttempt", { attemptId }], ["claimTestCheckout", { attemptId }],
      ["reconcileTestAttempt", { attemptId }], ["refundTestPayment", { attemptId, paymentId: "pay_DUMMY1" }],
      ["verifyTestCallback", { attemptId, paymentId: "pay_DUMMY1", orderId: "order_DUMMY1", signature: "0".repeat(64) }],
      ["retryTestWebhook", { eventId: "evt_DUMMY1" }],
    ];
    for (const role of ["manager", "staff"]) {
      state.role = role;
      for (const [action, extra] of actions) expect((await adminApi(adminRequest(action, extra))).status).toBe(403);
    }
    expect(calls).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_attempts").get()).toEqual({ n: 0 });
  });
  it("rejects incorrect auth and reports auth outages without internal details", async () => {
    expect((await adminApi(adminRequest("listTestAttempts", {}, "incorrect"))).status).toBe(401);
    state.unavailableAuth = true;
    const response = await adminApi(adminRequest("listTestAttempts")); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("DUMMY_AUTH_INTERNAL");
  });
  it("rejects Pi before DB/network operations for admin, webhook and services", async () => {
    state.pi = true;
    expect((await adminApi(adminRequest("checkTestConnectivity"))).status).toBe(403);
    expect((await webhookApi(hookRequest("{}"))).status).toBe(403);
    await expect(createPreviewAttempt(crypto.randomUUID(), "admin")).rejects.toThrow("Cloudflare-owned");
    expect(calls).toHaveLength(0);
  });
  it.each([{ environment: "live" }, { amount: 999 }, { keySecret: "DUMMY_PRIVATE" }, { bookingId: 123 }])("rejects injected client fields %j", async (extra) => {
    const response = await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID(), ...extra }));
    expect(response.status).toBe(400); expect(calls).toHaveLength(0);
  });
  it("requires deployment opt-in for creation and never considers live credentials", async () => {
    vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    expect((await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it("bounds actual admin and webhook bodies even without Content-Length", async () => {
    expect((await adminApi(new NextRequest("https://preview.example/api/admin/booking-payments", { method: "POST", body: "x".repeat(8193) }))).status).toBe(413);
    expect((await webhookApi(hookRequest("x".repeat(65537)))).status).toBe(413); expect(calls).toHaveLength(0);
  });
  it("fails closed on unavailable ledger and does not perform a POST", async () => {
    sqlite.close();
    const response = await adminApi(adminRequest("createTestAttempt", { requestKey: crypto.randomUUID() }));
    expect(response.status).toBe(503); expect(calls).toHaveLength(0);
  });
});

describe("Durable test order/capture/refund workflows", () => {
  it("creates only fixed integer paise test order and persists before POST", async () => {
    const result = await createPreviewAttempt(crypto.randomUUID(), "admin");
    expect(result.attempt).toMatchObject({ environment: "test", amountPaise: 100, state: "created" });
    expect(result.checkout).toMatchObject({ key: "rzp_test_DUMMYPUBLIC", amount: 100, currency: "INR" });
    expect(calls[0].body).toMatchObject({ amount: 100, currency: "INR", partial_payment: false, notes: { goko_preview_attempt: result.attempt.id } });
    expect(result.attempt.receipt.length).toBeLessThanOrEqual(40);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_attempts").get()).toEqual({ n: 1 });
  });
  it("deduplicates concurrent/replayed request keys without a second POST", async () => {
    const key = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => createPreviewAttempt(key, "admin")));
    expect(new Set(results.map((r) => r.attempt.id)).size).toBe(1);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("allows exactly one checkout claim, including concurrent tabs and lost claim responses", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => claimPreviewCheckout(first.attempt.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(11);
    expect((await previewSnapshot(first.attempt.id)).checkout).toBeNull();
    await expect(claimPreviewCheckout(first.attempt.id)).rejects.toThrow("already started");
    expect((await previewSnapshot(first.attempt.id)).attempt.checkoutStartedAt).toBeTruthy();
  });
  it("does not release a checkout claim when reconciliation finds no payment yet", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); await claimPreviewCheckout(first.attempt.id);
    expect((await reconcilePreviewAttempt(first.attempt.id)).checkout).toBeNull();
    await expect(claimPreviewCheckout(first.attempt.id)).rejects.toThrow("already started");
  });
  it("does not permit checkout after earlier provider evidence or deployment disable", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt, "authorized");
    await reconcilePreviewAttempt(first.attempt.id); await expect(claimPreviewCheckout(first.attempt.id)).rejects.toThrow("payment evidence");
    const other = await createPreviewAttempt(crypto.randomUUID(), "admin"); vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    await expect(claimPreviewCheckout(other.attempt.id)).rejects.toThrow("disabled");
  });
  it("recovers an order after lost creation response using exact receipt and note, not another POST", async () => {
    failOrderResponse = true; const key = crypto.randomUUID();
    const first = await createPreviewAttempt(key, "admin"); expect(first.attempt.state).toBe("order_unknown"); expect(first.checkout).toBeNull();
    await createPreviewAttempt(key, "admin"); expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    const recovered = await reconcilePreviewAttempt(first.attempt.id);
    expect(recovered.attempt.state).toBe("created"); expect(recovered.checkout).not.toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("does not reinterpret zero lookup matches as permission to create another order", async () => {
    failOrderResponse = true; const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); providerOrders.clear();
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("still unresolved");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("rejects malformed order amount or mismatched recovery ownership", async () => {
    malformedOrder = true; const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    expect(first.attempt.state).toBe("order_unknown");
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("does not match");
    [...providerOrders.values()][0].amount = 100; [...providerOrders.values()][0].notes.goko_preview_attempt = crypto.randomUUID();
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("does not match");
  });
  it("uses stored order for callback HMAC, fetches capture and drops gateway PII", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt);
    const result = await verifyPreviewCallback(first.attempt.id, p.id, first.attempt.orderId!, sign(`${first.attempt.orderId}|${p.id}`, KEY));
    expect(result.payments).toHaveLength(1); expect(result.payments[0].captured).toBe(1); expect(result.checkout).toBeNull();
    expect(JSON.stringify(result)).not.toContain("DUMMY_PRIVATE"); expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(HOOK);
    await verifyPreviewCallback(first.attempt.id, p.id, first.attempt.orderId!, sign(`${first.attempt.orderId}|${p.id}`, KEY));
    expect((await previewSnapshot(first.attempt.id)).payments).toHaveLength(1);
  });
  it("rejects forged signature/wrong callback order before provider lookup", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); const count = calls.length;
    await expect(verifyPreviewCallback(first.attempt.id, "pay_DUMMY1", first.attempt.orderId!, "0".repeat(64))).rejects.toThrow("signature");
    await expect(verifyPreviewCallback(first.attempt.id, "pay_DUMMY1", "order_EVIL", sign("order_EVIL|pay_DUMMY1", KEY))).rejects.toThrow("does not match");
    expect(calls).toHaveLength(count);
  });
  it.each([{ amount: 99 }, { currency: "USD" }, { order_id: "order_EVIL" }, { id: "pay_EVIL" }, { amount: 100.5 }, { captured: false }])("rejects inconsistent or wrong payment evidence %j without credit", async (override) => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); const p = payment(first.attempt);
    Object.assign(p, override);
    await expect(verifyPreviewCallback(first.attempt.id, "pay_DUMMY1", first.attempt.orderId!, sign(`${first.attempt.orderId}|pay_DUMMY1`, KEY))).rejects.toThrow();
    expect((await previewSnapshot(first.attempt.id)).payments).toHaveLength(0);
  });
  it("surfaces Razorpay failure metadata on failed payments in preview snapshots", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    const p = payment(first.attempt, "failed", "pay_DUMMYFAIL1");
    Object.assign(p, { error_code: "BAD_REQUEST_ERROR", error_reason: "authentication_failed",
      error_description: "Payment was unsuccessful as customer entered incorrect OTP" });
    providerPayments.set("pay_DUMMYFAIL1", p);
    await reconcilePreviewAttempt(first.attempt.id);
    expect((await previewSnapshot(first.attempt.id)).payments[0]).toMatchObject({
      status: "failed", errorCode: "BAD_REQUEST_ERROR", errorReason: "authentication_failed",
      errorDescription: expect.stringContaining("incorrect OTP"),
    });
  });
  it("authorized is not captured, does not allow refund, and stale failed state cannot regress later capture", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt, "authorized");
    let result = await reconcilePreviewAttempt(first.attempt.id); expect(result.payments[0].captured).toBe(0); expect(result.checkout).toBeNull();
    await expect(refundPreviewPayment(first.attempt.id, p.id, "admin")).rejects.toThrow("Only a verified");
    payment(first.attempt, "captured"); await reconcilePreviewAttempt(first.attempt.id);
    payment(first.attempt, "failed"); result = await reconcilePreviewAttempt(first.attempt.id);
    expect(result.payments[0]).toMatchObject({ status: "captured", captured: 1 });
  });
  it("recovers captured payment without browser callback and after disabling new previews", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    expect((await reconcilePreviewAttempt(first.attempt.id)).payments[0].captured).toBe(1);
    await expect(refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin")).rejects.toThrow("disabled");
  });
  it("recovers a lost creation response by request key even after new previews are disabled", async () => {
    failOrderResponse = true; const key = crypto.randomUUID(); const first = await createPreviewAttempt(key, "admin");
    vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    const response = await adminApi(adminRequest("getTestRequest", { requestKey: key }));
    expect(response.status).toBe(200); expect((await response.json()).attempt.id).toBe(first.attempt.id);
    expect((await adminApi(adminRequest("getTestRequest", { requestKey: crypto.randomUUID() }))).status).toBe(404);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("blocks historical reconciliation after credentials/account key changes", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_DIFFERENT");
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("original test credentials");
  });
  it("deduplicates concurrent full-refund reservations and POSTs", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await Promise.all(Array.from({ length: 12 }, () => refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin")));
    expect(calls.filter((c) => c.path.endsWith("/refund") && c.method === "POST")).toHaveLength(1);
    expect((await previewSnapshot(first.attempt.id)).refunds).toHaveLength(1);
  });
  it("recovers lost refund response by receipt without repeating POST", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt); failRefundResponse = true;
    let result = await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); expect(result.refunds[0].state).toBe("unknown");
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin");
    [...providerRefunds.values()][0].status = "processed";
    result = await reconcilePreviewAttempt(first.attempt.id); expect(result.refunds[0].state).toBe("processed");
    expect(calls.filter((c) => c.path.endsWith("/refund") && c.method === "POST")).toHaveLength(1);
  });
  it("reconciles known refund even when the provider order-payment collection is temporarily empty", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); [...providerRefunds.values()][0].status = "processed";
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => url.endsWith("/payments") && url.includes("/orders/")
      ? json({ entity: "collection", items: [] }) : previousFetch(url, init)));
    expect((await reconcilePreviewAttempt(first.attempt.id)).refunds[0].state).toBe("processed");
  });
  it("unknown refund with no lookup match remains reserved, not failed or refunded", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt); failRefundResponse = true;
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); providerRefunds.clear();
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("Refund result is unresolved");
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("unknown");
  });
  it("processed refund is immutable and failed refund does not create an automatic retry POST", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0];
    r.status = "failed"; await reconcilePreviewAttempt(first.attempt.id);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin");
    expect(calls.filter((c) => c.path.endsWith("/refund") && c.method === "POST")).toHaveLength(1);
    r.status = "processed"; await reconcilePreviewAttempt(first.attempt.id); r.status = "pending";
    expect((await reconcilePreviewAttempt(first.attempt.id)).refunds[0].state).toBe("processed");
  });
  it("refuses refund under another attempt or an externally refunded payment", async () => {
    const a = await createPreviewAttempt(crypto.randomUUID(), "admin"), b = await createPreviewAttempt(crypto.randomUUID(), "admin");
    payment(a.attempt);
    await expect(refundPreviewPayment(b.attempt.id, "pay_DUMMY1", "admin")).rejects.toThrow("does not match");
    payment(a.attempt, "refunded"); await expect(refundPreviewPayment(a.attempt.id, "pay_DUMMY1", "admin")).rejects.toThrow("Only a verified");
    expect(calls.filter((c) => c.path.endsWith("/refund"))).toHaveLength(0);
  });
  it("rejects mismatched refund evidence and leaves unresolved reservation protected", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt); failRefundResponse = true;
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0]; r.amount = 99;
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("does not match");
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("unknown");
  });
  it("enforces migration guards for test-only amounts/environments and payment ownership", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    expect(() => sqlite.prepare("UPDATE gateway_preview_attempts SET environment='live' WHERE id=?").run(first.attempt.id)).toThrow("CHECK");
    expect(() => sqlite.prepare("UPDATE gateway_preview_attempts SET amount_paise=101 WHERE id=?").run(first.attempt.id)).toThrow("CHECK");
    expect(() => sqlite.prepare("INSERT INTO gateway_preview_payments VALUES ('pay_bad','missing',100,'captured',1,0,'now')").run()).toThrow("FOREIGN KEY");
  });
  it("keeps migration columns/defaults and Drizzle source definitions synchronized", () => {
    for (const table of [schema.gatewayPreviewAttempts, schema.gatewayPreviewPayments, schema.gatewayPreviewRefunds, schema.gatewayPreviewWebhooks]) {
      const config = getTableConfig(table), actual = sqlite.prepare(`PRAGMA table_info("${config.name}")`).all() as { name: string; notnull: number; dflt_value: string | null }[];
      expect(actual.map((c) => c.name)).toEqual(config.columns.map((c) => c.name));
      for (const column of config.columns) {
        const persisted = actual.find((c) => c.name === column.name)!;
        expect(Boolean(persisted.notnull)).toBe(column.notNull);
        if (typeof column.default === "string") expect(persisted.dflt_value).toBe(`'${column.default}'`);
        if (typeof column.default === "number") expect(persisted.dflt_value).toBe(String(column.default));
      }
    }
    expect(getSyncableTableNames().filter((name) => name.startsWith("gateway_preview_"))).toEqual([]);
  });
  it("executes the Drizzle D1 adapter's generated SQL/RETURNING against disposable SQLite", async () => {
    // Emulates D1 statement result shapes, not real Cloudflare concurrency/network.
    const binding = { prepare: (query: string) => {
      const build = (args: unknown[] = []): any => ({
        bind: (...next: unknown[]) => build(next),
        all: async () => ({ success: true, results: sqlite.prepare(query).all(...args) }),
        raw: async () => sqlite.prepare(query).raw(true).all(...args),
        run: async () => { const r = sqlite.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
      }); return build();
    } };
    state.db = drizzleD1(binding as any, { schema });
    const a = await createPreviewAttempt(crypto.randomUUID(), "admin");
    await claimPreviewCheckout(a.attempt.id); await expect(claimPreviewCheckout(a.attempt.id)).rejects.toThrow("already started");
    payment(a.attempt); expect((await reconcilePreviewAttempt(a.attempt.id)).payments[0].captured).toBe(1);
    await refundPreviewPayment(a.attempt.id, "pay_DUMMY1", "admin"); [...providerRefunds.values()][0].status = "processed";
    expect((await reconcilePreviewAttempt(a.attempt.id)).refunds[0].state).toBe("processed");
    expect(calls.filter((c) => c.path.endsWith("/refund") && c.method === "POST")).toHaveLength(1);
  });
});

describe("Signed durable webhook and recovery workflows", () => {
  it("preserves directly verified refund completion despite a stale refund collection", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0]; r.status = "processed";
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => url.includes("/refunds?count=")
      ? json({ entity: "collection", items: [{ ...r, status: "pending" }] }) : previousFetch(url, init)));
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: r } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("processed");
    expect((await reconcilePreviewAttempt(first.attempt.id)).refunds[0].state).toBe("processed");
  });
  it("backfills legacy refund identity only from matching signed redelivery", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0];
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: { ...r, status: "processed" } } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    sqlite.prepare("UPDATE gateway_preview_webhooks SET refund_id=NULL").run();
    await expect(processPreviewWebhook("evt_DUMMY1")).rejects.toThrow("Refund identity unavailable");
    expect((await webhookApi(hookRequest(raw, "evt_DUMMY1", "0".repeat(64)))).status).toBe(400);
    expect(sqlite.prepare("SELECT refund_id FROM gateway_preview_webhooks").get()).toEqual({ refund_id: null });
    r.status = "processed";
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect(sqlite.prepare("SELECT refund_id,state FROM gateway_preview_webhooks").get()).toEqual({ refund_id: r.id, state: "processed" });
  });
  it("recovers an unknown refund and retained event after reopening the persisted SQLite ledger", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt); failRefundResponse = true;
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0];
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: { ...r, status: "processed" } } } });
    failGets = true; expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    const persisted = sqlite.serialize(); sqlite.close(); sqlite = new SQLite(persisted); sqlite.pragma("foreign_keys = ON");
    state.db = drizzle(sqlite, { schema }); vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("unknown");
    failGets = false; r.status = "processed";
    expect(await processPreviewWebhook("evt_DUMMY1")).toEqual({ state: "processed" });
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("processed");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });
  it("rejects a full order lookup page rather than attaching an apparently unique filtered match", async () => {
    failOrderResponse = true; const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), order = [...providerOrders.values()][0];
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => url.includes("orders?receipt=")
      ? json({ entity: "collection", items: Array.from({ length: 100 }, (_, i) => i === 0 ? order : { ...order, id: `order_EXTRA${i}`, receipt: `unrelated_${i}` }) })
      : previousFetch(url, init)));
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("Unable to verify");
    expect((await previewSnapshot(first.attempt.id)).attempt.orderId).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("retains exact refund identity and retries processed event until provider result is visible", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0];
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: { ...r, status: "processed" } } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    expect(sqlite.prepare("SELECT state,refund_id FROM gateway_preview_webhooks").get()).toEqual({ state: "retry", refund_id: r.id });
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("pending");
    vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false"); r.status = "processed";
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("processed");
    expect(calls.filter((c) => c.path.endsWith("/refund") && c.method === "POST")).toHaveLength(1);
  });
  it("does not acknowledge an external refund before exact result exists or create a local refund claim", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    const r = { entity: "refund", id: "rfnd_EXTERNAL", payment_id: "pay_DUMMY1", amount: 100, currency: "INR", receipt: null, status: "processed" };
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: r } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    providerRefunds.set(r.id, r); payment(first.attempt, "refunded");
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    const snapshot = await previewSnapshot(first.attempt.id);
    expect(snapshot.payments[0].refundedPaise).toBe(100); expect(snapshot.refunds).toHaveLength(0);
    expect(calls.filter((c) => c.path.endsWith("/refund"))).toHaveLength(0);
  });
  it.each([{ payment_id: "pay_OTHER" }, { amount: 99 }, { id: "rfnd_OTHER" }, { currency: "USD" }])("rejects exact refund evidence mismatch %j", async (override) => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0];
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: { ...r, status: "processed" } } } });
    providerRefunds.set(r.id, { ...r, status: "processed", ...override });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    expect(sqlite.prepare("SELECT state FROM gateway_preview_webhooks").get()).toEqual({ state: "retry" });
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("pending");
  });
  it("rejects refund events with missing identity before inbox writes", async () => {
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { payment: { entity: { id: "pay_DUMMY1" } } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(400);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 0 });
    expect(calls).toHaveLength(0);
  });
  it("keeps failed refund event retryable while pending and accepts verified processed terminal outcome", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0];
    const raw = JSON.stringify({ event: "refund.failed", account_id: "acc_DUMMY", payload: { refund: { entity: { ...r, status: "failed" } } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    r.status = "processed";
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("processed");
  });
  it("handles concurrent duplicate capture webhooks without duplicate financial evidence", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), raw = payload(payment(first.attempt));
    const results = await Promise.all(Array.from({ length: 12 }, () => webhookApi(hookRequest(raw))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 1 });
    expect((await previewSnapshot(first.attempt.id)).payments).toHaveLength(1);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("retries a captured webhook until API capture is visible, including after new tests are disabled", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt, "authorized");
    const raw = payload({ ...p, status: "captured", captured: true });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    expect(sqlite.prepare("SELECT state FROM gateway_preview_webhooks").get()).toEqual({ state: "retry" });
    expect((await previewSnapshot(first.attempt.id)).payments[0].captured).toBe(0);
    vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    payment(first.attempt);
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).payments[0].captured).toBe(1);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("does not acknowledge order.paid with empty or authorized API evidence", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), order = [...providerOrders.values()][0];
    const raw = JSON.stringify({ event: "order.paid", account_id: "acc_DUMMY", payload: { order: { entity: { ...order, status: "paid" } } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    payment(first.attempt, "authorized");
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    payment(first.attempt);
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect(sqlite.prepare("SELECT state FROM gateway_preview_webhooks").get()).toEqual({ state: "processed" });
  });
  it("fetches capture and deduplicates exact event replay without reprocessing", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt);
    const raw = payload(p);
    expect((await webhookApi(hookRequest(raw))).status).toBe(200); const count = calls.length;
    expect((await webhookApi(hookRequest(raw))).status).toBe(200); expect(calls).toHaveLength(count);
    const stored = sqlite.prepare("SELECT * FROM gateway_preview_webhooks").get() as any;
    expect(stored.state).toBe("processed"); expect(stored.payload_hash).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toContain("DUMMY_PRIVATE");
    expect((await previewSnapshot(first.attempt.id)).payments[0].captured).toBe(1);
  });
  it("rejects bad signature before persistence or lookup", async () => {
    expect((await webhookApi(hookRequest("{}", "evt_BAD", "0".repeat(64)))).status).toBe(400);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 0 }); expect(calls).toHaveLength(0);
  });
  it("rejects changed payload under same event ID", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt);
    expect((await webhookApi(hookRequest(payload(p)))).status).toBe(200);
    expect((await webhookApi(hookRequest(payload(p, "payment.authorized")))).status).toBe(409);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 1 });
  });
  it("retains transient provider failure and finishes on retry after browser is gone", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt); failGets = true;
    expect((await webhookApi(hookRequest(payload(p)))).status).toBe(503);
    expect(sqlite.prepare("SELECT state FROM gateway_preview_webhooks").get()).toEqual({ state: "retry" });
    failGets = false; expect(await processPreviewWebhook("evt_DUMMY1")).toEqual({ state: "processed" });
  });
  it("does not acknowledge an orphan and can recover after attaching a lost order response", async () => {
    failOrderResponse = true; const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    const order = [...providerOrders.values()][0], p = payment({ ...first.attempt, orderId: order.id });
    expect((await webhookApi(hookRequest(payload(p)))).status).toBe(503);
    await reconcilePreviewAttempt(first.attempt.id); expect(await processPreviewWebhook("evt_DUMMY1")).toEqual({ state: "processed" });
  });
  it("order.paid event recovers its attempt note but fetches payment evidence rather than trusting paid status", async () => {
    failOrderResponse = true; const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); const order = [...providerOrders.values()][0];
    payment({ ...first.attempt, orderId: order.id });
    const raw = JSON.stringify({ event: "order.paid", account_id: "acc_DUMMY", payload: { order: { entity: { ...order, status: "paid" } } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).payments[0].captured).toBe(1);
  });
  it("stale failure payload cannot regress a current captured provider result", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"), p = payment(first.attempt);
    expect((await webhookApi(hookRequest(payload({ ...p, status: "failed", captured: false }, "payment.failed")))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).payments[0]).toMatchObject({ status: "captured", captured: 1 });
  });
  it("refund webhook finds payment ownership, fetches result and preserves processed terminal state", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin"); payment(first.attempt);
    await refundPreviewPayment(first.attempt.id, "pay_DUMMY1", "admin"); const r = [...providerRefunds.values()][0]; r.status = "processed";
    const raw = JSON.stringify({ event: "refund.processed", account_id: "acc_DUMMY", payload: { refund: { entity: r } } });
    expect((await webhookApi(hookRequest(raw))).status).toBe(200);
    expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("processed");
  });
  it("supports previous test webhook secret for provider retries", async () => {
    vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", "DUMMY_OLD_HOOK");
    const raw = JSON.stringify({ event: "settlement.processed", account_id: "acc_DUMMY", payload: {} });
    expect((await webhookApi(hookRequest(raw, "evt_OLD", sign(raw, "DUMMY_OLD_HOOK")))).status).toBe(200);
  });
  it("rejects wrong account, live signature and shared test/live webhook secrets", async () => {
    const raw = JSON.stringify({ event: "settlement.processed", account_id: "acc_EVIL", payload: {} });
    expect((await webhookApi(hookRequest(raw))).status).toBe(400);
    expect((await webhookApi(hookRequest(raw, "evt_LIVE", sign(raw, "DUMMY_DISTINCT_LIVE")))).status).toBe(400);
    vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", HOOK);
    expect((await webhookApi(hookRequest(raw))).status).toBe(503);
    expect(sqlite.prepare("SELECT count(*) n FROM gateway_preview_webhooks").get()).toEqual({ n: 0 });
  });
  it("marks unsupported signed test event ignored without inventing bank receipts", async () => {
    const raw = JSON.stringify({ event: "settlement.processed", account_id: "acc_DUMMY", payload: {} });
    const response = await webhookApi(hookRequest(raw)); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "ignored" }); expect(calls).toHaveLength(0);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toHaveLength(4);
  });
  it("does not permit a full page of payment evidence to masquerade as complete recovery", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "admin");
    for (let n = 0; n < 100; n++) payment(first.attempt, "failed", `pay_DUMMY${n}`);
    await expect(reconcilePreviewAttempt(first.attempt.id)).rejects.toThrow("Unable to verify");
    expect((await previewSnapshot(first.attempt.id)).payments).toHaveLength(0);
  });
});
