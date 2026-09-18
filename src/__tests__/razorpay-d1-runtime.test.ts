import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { createPreviewAttempt, claimPreviewCheckout, reconcilePreviewAttempt, refundPreviewPayment, receivePreviewWebhook, previewSnapshot } from "@/lib/razorpayPreview";
import { compareAndSetWebsiteSettings } from "@/lib/websiteBookingSettingsStore";
import { createNativeInventoryHold, releaseNativeInventoryHold, getNativeInventoryHold, getNativeSelectionAvailability } from "@/lib/nativeInventoryHold";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { acceptNativeQuote, getNativeAcceptedQuote } from "@/lib/nativeAcceptedQuote";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS } from "@/lib/websiteBookingSettings";

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock("@/db", () => ({ getDb: () => { if (!state.db) throw new Error("Test binding unavailable"); return state.db; } }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => false }));
vi.mock("@/db/queries", () => ({ getAllBeds: async () => [{ id: 1, dormId: 1, bedId: "A1", type: "Bunk" }],
  getAvailableBedsForRange: async () => [{ id: 1, dormId: 1, bedId: "A1", type: "Bunk", pool: "online" }],
}));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp-before"),
  pushIfOtaChanged: vi.fn(async () => ({ attempted: false, accepted: true })),
}));
let runtime: Miniflare;
let binding: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let order: Record<string, unknown>, refund: Record<string, unknown> | null;
let captured: boolean, lostOrder: boolean, lostRefund: boolean, orderPosts: number, refundPosts: number;
const KEY = "DUMMY_D1_API_SECRET", HOOK = "DUMMY_D1_WEBHOOK_SECRET";
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const providerPayment = () => ({ entity: "payment", id: "pay_D1TEST", order_id: order.id, amount: 100,
  currency: "INR", status: captured ? "captured" : "authorized", captured, amount_refunded: 0 });

beforeAll(async () => {
  runtime = new Miniflare({ modules: true, compatibilityDate: "2025-11-01", cf: false,
    script: "export default { fetch() { return new Response('isolated test fixture'); } };",
    d1Databases: { DB: "goko-payment-disposable-test" }, d1Persist: false,
  });
  binding = await runtime.getD1Database("DB");
  // Actual repository SQL through workerd's local D1 binding, no remote DB.
  for (const file of ["migrations/0057_razorpay_test_preview.sql", "migrations/0058_razorpay_webhook_refund_id.sql"]) {
    const statements = readFileSync(file, "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
    await binding.batch(statements.map((s) => binding.prepare(s)));
  }
  await binding.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, sync_updated_at TEXT, sync_source TEXT)").run();
  await binding.batch([
    binding.prepare("CREATE TABLE beds (id INTEGER PRIMARY KEY)"), binding.prepare("INSERT INTO beds VALUES (1)"),
    binding.prepare("CREATE TABLE booking_bed_assignments (bed_id INTEGER,status TEXT,checkin_date TEXT,checkout_date TEXT)"),
    binding.prepare("CREATE TABLE bed_blocks (bed_id INTEGER,is_active INTEGER,start_date TEXT,end_date TEXT)"),
  ]);
  // Preserve each compound trigger as one statement (do not split at BEGIN's SELECT).
  const nativeSql = readFileSync("migrations/0059_native_inventory_hold_primitive.sql", "utf8").replace(/^--.*$/gm, "");
  await binding.batch(nativeSql.split(/;\s*(?=CREATE (?:TABLE|INDEX|TRIGGER))/).map((s) => binding.prepare(s.trim())));
  const quoteSql = readFileSync("migrations/0060_native_accepted_quotes.sql", "utf8").replace(/^--.*$/gm, "");
  await binding.batch(quoteSql.split(/;\s*(?=CREATE (?:TABLE|INDEX|TRIGGER))/).map((s) => binding.prepare(s.trim())));
}, 30000);
afterAll(async () => { if (runtime) await runtime.dispose(); }, 30000);
beforeEach(async () => {
  state.db = drizzle(binding, { schema });
  // Fixture cleanup only: temporarily remove retention guard, wipe disposable quotes, restore it.
  const retainedSql = await binding.prepare("SELECT sql FROM sqlite_master WHERE name='native_quote_retained' AND type='trigger'").first<string>("sql");
  await binding.batch([binding.prepare("DROP TRIGGER native_quote_retained"), binding.prepare("DELETE FROM native_accepted_quotes"), binding.prepare(retainedSql!)]);
  await binding.batch(["native_inventory_holds", "booking_bed_assignments", "bed_blocks", "gateway_preview_webhooks", "gateway_preview_refunds", "gateway_preview_payments", "gateway_preview_attempts", "settings"]
    .map((table) => binding.prepare(`DELETE FROM ${table}`))); // Fixed fixture-owned names only.
  order = {}; refund = null; captured = false; lostOrder = false; lostRefund = false; orderPosts = 0; refundPosts = 0;
  vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_D1DUMMY"); vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", KEY);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", HOOK); vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", "DUMMY_DISTINCT_LIVE"); vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_TEST_ACCOUNT_ID", "acc_D1DUMMY"); vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "true");
  vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "true");
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return originalFetch(input, init);
    if (url.origin !== "https://api.razorpay.com") throw new Error("External network prohibited by test fixture");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa(`rzp_test_D1DUMMY:${KEY}`)}`);
    const path = url.pathname.replace("/v1/", ""), post = init?.method === "POST";
    if (path === "orders" && post) {
      orderPosts++; const body = z.record(z.unknown()).parse(JSON.parse(String(init?.body)));
      order = { ...body, entity: "order", id: "order_D1TEST", status: "created" };
      if (lostOrder) throw new Error("Simulated order response loss");
      return response(order);
    }
    if (path === "orders") return response({ entity: "collection", items: [order] });
    if (path === "orders/order_D1TEST/payments") return response({ entity: "collection", items: [providerPayment()] });
    if (path === "payments/pay_D1TEST") return response(providerPayment());
    if (path === "payments/pay_D1TEST/refund" && post) {
      refundPosts++; const body = z.record(z.unknown()).parse(JSON.parse(String(init?.body)));
      refund = { ...body, entity: "refund", id: "rfnd_D1TEST", payment_id: "pay_D1TEST", currency: "INR", status: "pending" };
      if (lostRefund) throw new Error("Simulated refund response loss");
      return response(refund);
    }
    if (path === "payments/pay_D1TEST/refunds") return response({ entity: "collection", items: refund ? [refund] : [] });
    if (path === "refunds/rfnd_D1TEST") return response(refund);
    throw new Error(`Unhandled mock provider path: ${path}`);
  }));
}, 30000);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Payment persistence using actual local D1/workerd binding", () => {
  it("holds one last unit under 20 concurrent requests and rejects other SQL assignment writers", async () => {
    const ownerToken = "a".repeat(64), checkinDate = addCalendarDays(todayIST(), 1), checkoutDate = addCalendarDays(todayIST(), 3);
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => createNativeInventoryHold({ requestKey: crypto.randomUUID(), ownerToken, bedIds: [1], checkinDate, checkoutDate })));
    const winners = outcomes.filter((r) => r.status === "fulfilled"); expect(winners).toHaveLength(1);
    await expect(binding.prepare("INSERT INTO booking_bed_assignments VALUES (1,'assigned',?,?)").bind(checkinDate, checkoutDate).run()).rejects.toThrow("NATIVE_HOLD_CONFLICT");
    await expect(binding.prepare("INSERT INTO bed_blocks VALUES (1,1,?,?)").bind(checkinDate, checkoutDate).run()).rejects.toThrow("NATIVE_HOLD_CONFLICT");
    await releaseNativeInventoryHold(winners[0].value.id, ownerToken);
    await binding.prepare("INSERT INTO booking_bed_assignments VALUES (1,'assigned',?,?)").bind(checkinDate, checkoutDate).run();
    expect(orderPosts).toBe(0); expect(refundPosts).toBe(0);
  });
  it("performs one order POST for 20 concurrent identical request keys", async () => {
    const key = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, () => createPreviewAttempt(key, "test admin")));
    expect(new Set(results.map((r) => r.attempt.id)).size).toBe(1); expect(orderPosts).toBe(1);
  });
  it("allows one of 20 concurrent checkout claims, never reopens after authorization", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "test admin");
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => claimPreviewCheckout(first.attempt.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await reconcilePreviewAttempt(first.attempt.id)).checkout).toBeNull();
  });
  it("recovers lost order response with original identity without another POST", async () => {
    lostOrder = true; const first = await createPreviewAttempt(crypto.randomUUID(), "test admin");
    expect(first.attempt.state).toBe("order_unknown");
    const recovered = await reconcilePreviewAttempt(first.attempt.id);
    expect(recovered.attempt.orderId).toBe("order_D1TEST"); expect(orderPosts).toBe(1);
  });
  it("reserves one refund under 20 concurrent requests and recovers a lost response", async () => {
    captured = true; lostRefund = true; const first = await createPreviewAttempt(crypto.randomUUID(), "test admin");
    await Promise.all(Array.from({ length: 20 }, () => refundPreviewPayment(first.attempt.id, "pay_D1TEST", "test admin")));
    expect(refundPosts).toBe(1); expect((await previewSnapshot(first.attempt.id)).refunds[0].state).toBe("unknown");
    refund!.status = "processed"; vi.stubEnv("RAZORPAY_TEST_PREVIEW_ENABLED", "false");
    expect((await reconcilePreviewAttempt(first.attempt.id)).refunds[0].state).toBe("processed"); expect(refundPosts).toBe(1);
  });
  it("retains delayed capture event and handles concurrent exact retries", async () => {
    const first = await createPreviewAttempt(crypto.randomUUID(), "test admin");
    const raw = JSON.stringify({ event: "payment.captured", account_id: "acc_D1DUMMY", payload: { payment: { entity: { ...providerPayment(), status: "captured", captured: true } } } });
    const signature = createHmac("sha256", HOOK).update(raw).digest("hex"), bytes = new TextEncoder().encode(raw);
    await expect(receivePreviewWebhook(bytes, signature, "evt_D1TEST")).rejects.toThrow("Capture evidence");
    captured = true;
    const results = await Promise.all(Array.from({ length: 20 }, () => receivePreviewWebhook(bytes, signature, "evt_D1TEST")));
    expect(results.every((r) => r.state === "processed")).toBe(true);
    expect((await previewSnapshot(first.attempt.id)).payments).toHaveLength(1);
    expect(await binding.prepare("SELECT count(*) n FROM gateway_preview_webhooks").first("n")).toBe(1);
  });
  it("allows one settings insert/update owner under concurrent stale edits", async () => {
    const inserted = await Promise.all(Array.from({ length: 20 }, (_, i) => compareAndSetWebsiteSettings(null, `draft_${i}`)));
    expect(inserted.filter(Boolean)).toHaveLength(1);
    const old = await binding.prepare("SELECT value FROM settings").first<string>("value");
    const updated = await Promise.all(Array.from({ length: 20 }, (_, i) => compareAndSetWebsiteSettings(old!, `new_${i}`)));
    expect(updated.filter(Boolean)).toHaveLength(1);
  });
  it("uses actual D1 time to hide held units and preserves owner recovery after disable", async () => {
    const request = { requestKey: crypto.randomUUID(), ownerToken: "a".repeat(64), bedIds: [1],
      checkinDate: addCalendarDays(todayIST(), 1), checkoutDate: addCalendarDays(todayIST(), 3) };
    const range = { checkinDate: request.checkinDate, checkoutDate: request.checkoutDate };
    expect((await getNativeSelectionAvailability(range)).units).toHaveLength(1);
    const hold = await createNativeInventoryHold(request);
    expect((await getNativeSelectionAvailability(range)).units).toEqual([]);
    vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false");
    expect(await getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: request.ownerToken })).toEqual(hold);
    await expect(getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: "b".repeat(64) })).rejects.toMatchObject({ status: 404 });
    await releaseNativeInventoryHold(hold.id, request.ownerToken);
    vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "true");
    expect((await getNativeSelectionAvailability(range)).units).toHaveLength(1);
    expect(orderPosts).toBe(0); expect(refundPosts).toBe(0);
  });
  it("fails closed on an incomplete D1 guard deployment", async () => {
    const guardSql = await binding.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='native_hold_insert_guard'").first<string>("sql");
    expect(guardSql).toBeTruthy();
    await binding.prepare("DROP TRIGGER native_hold_insert_guard").run();
    try {
      const request = { requestKey: crypto.randomUUID(), ownerToken: "a".repeat(64), bedIds: [1],
        checkinDate: addCalendarDays(todayIST(), 1), checkoutDate: addCalendarDays(todayIST(), 3) };
      await expect(createNativeInventoryHold(request)).rejects.toMatchObject({ status: 503 });
      await expect(getNativeSelectionAvailability({ checkinDate: request.checkinDate, checkoutDate: request.checkoutDate })).rejects.toMatchObject({ status: 503 });
      expect(await binding.prepare("SELECT count(*) n FROM native_inventory_holds").first("n")).toBe(0);
    } finally { await binding.prepare(guardSql!).run(); }
  });
  it("accepts one durable quote under 20 concurrent D1 calls and recovers after release/disable", async () => {
    const owner = { requestKey: crypto.randomUUID(), ownerToken: "a".repeat(64) }, checkinDate = addCalendarDays(todayIST(), 1), checkoutDate = addCalendarDays(todayIST(), 2);
    const hold = await createNativeInventoryHold({ ...owner, bedIds: [1], checkinDate, checkoutDate });
    const input = { checkinDate, checkoutDate, policyVersion: "DUMMY_PUBLISHED_v1", policy: { ...DEFAULT_WEBSITE_BOOKING_SETTINGS },
      taxBasisPoints: 500, paymentChoice: "advance" as const, units: [{ key: "1:bed:1", nightlyRates: [{ date: checkinDate, rupees: 1001 }] }] };
    const results = await Promise.all(Array.from({ length: 20 }, () => acceptNativeQuote(owner, input)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await binding.prepare("SELECT count(*) n FROM native_accepted_quotes").first("n")).toBe(1);
    await expect(binding.prepare("UPDATE native_accepted_quotes SET accepted_at=accepted_at+1").run()).rejects.toThrow("NATIVE_QUOTE_IMMUTABLE");
    await releaseNativeInventoryHold(hold.id, owner.ownerToken); vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false");
    expect(await getNativeAcceptedQuote(owner)).toEqual(results[0]); expect(await acceptNativeQuote(owner, input)).toEqual(results[0]);
    expect(orderPosts).toBe(0); expect(refundPosts).toBe(0);
  });
});
