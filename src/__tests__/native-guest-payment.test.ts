import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { hashToken } from "@/lib/bookingReference";
import { createNativeInventoryHold } from "@/lib/nativeInventoryHold";
import {
  claimGuestCheckout, reconcileGuestCheckout, verifyGuestPayment, GuestCheckoutError,
} from "@/lib/nativeGuestCheckout";
import { createRazorpayBookingOrder, RazorpayError } from "@/lib/razorpay";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";

const state = vi.hoisted(() => ({ db: null as any, pi: false }));
const fixtureBeds = [{ id: 1, dormId: 1, bedId: "A1", type: "Bunk" as const }];
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no cloudflare context"); } }));
vi.mock("@/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/queries")>();
  return {
    ...actual,
    getAllBeds: async () => fixtureBeds,
    getAvailableBedsForRange: async () => fixtureBeds.map((b) => ({ ...b, pool: "online" as const })),
    getSetting: async () => null,
    getGuestBookingConfig: async () => ({ bookingEngineUrl: "/book", apiBaseUrl: "" }),
    assignBedToBooking: vi.fn(async () => true),
    unassignBookingBeds: vi.fn(async () => undefined),
    addBookingHistoryEntry: vi.fn(async () => undefined),
  };
});
vi.mock("@/lib/email", () => ({ sendBookingConfirmationEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
}));

const KEY = "DUMMY_API_SECRET";
const HOOK = "DUMMY_WEBHOOK_SECRET";
const OWNER = "a".repeat(64);
const GUEST = "b".repeat(64);
let sqlite: SQLite.Database;
let providerOrders: Map<string, any>;
let providerPayments: Map<string, any>;
let calls: { path: string; method: string; body: any }[];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const sign = (value: string, secret = KEY) => createHmac("sha256", secret).update(value).digest("hex");

function payment(orderId: string, amount: number, status = "captured", id = "pay_DUMMY1") {
  const p = {
    entity: "payment", id, order_id: orderId, amount, currency: "INR", status,
    captured: ["captured", "refunded"].includes(status),
    amount_refunded: status === "refunded" ? amount : 0,
  };
  providerPayments.set(id, p);
  return p;
}

async function seedReadyCheckout(overrides: { state?: string; orderId?: string | null; amount?: number } = {}) {
  const amount = overrides.amount ?? 50000;
  const requestKey = crypto.randomUUID();
  const checkinDate = addCalendarDays(todayIST(), 1);
  const checkoutDate = addCalendarDays(todayIST(), 2);
  const hold = await createNativeInventoryHold({
    requestKey, ownerToken: OWNER, bedIds: [1], checkinDate, checkoutDate,
  });
  const gokoId = `GOKOTEST${requestKey.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const bookingInsert = await state.db.insert(schema.bookings).values({
    guestName: "Test Guest", contact: "", platform: "Website", bookingRef: gokoId, gokoBookingId: gokoId,
    checkinDate, checkoutDate, roomType: "Bed", persons: 1, status: "hold", source: "website",
    paymentStatus: "pending", amountTotal: amount / 100, amountPaid: 0, currency: "INR",
    email: "guest@example.test", createdAt: new Date().toISOString(),
  }).returning({ id: schema.bookings.id });
  const bookingId = bookingInsert[0].id as number;
  const id = crypto.randomUUID();
  const receipt = `gbk_${id.replace(/-/g, "").slice(0, 32)}`;
  const orderId = overrides.orderId === null ? null : (overrides.orderId ?? `order_DUMMY${providerOrders.size + 1}`);
  if (orderId) {
    providerOrders.set(orderId, {
      entity: "order", id: orderId, amount, currency: "INR", receipt, status: "created",
      notes: { goko_checkout_id: id },
    });
  }
  const now = new Date().toISOString();
  await state.db.insert(schema.nativeBookingCheckouts).values({
    id, requestKey, requestHash: await hashToken(requestKey),
    ownerHash: await hashToken(OWNER), guestAccessHash: await hashToken(GUEST),
    bookingId, holdId: hold.id, paymentChoice: "full", environment: "test",
    state: overrides.state ?? "ready", razorpayOrderId: orderId, razorpayKeyId: "rzp_test_DUMMYPUBLIC",
    receipt: amount >= 100 ? receipt : null, dueNowPaise: amount,
    guestName: "Test Guest", guestEmail: "guest@example.test", guestPhone: "",
    createdAt: now, updatedAt: now,
  });
  return { id, orderId, amount, receipt, bookingId, holdId: hold.id };
}

beforeEach(() => {
  state.pi = false;
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE beds (id INTEGER PRIMARY KEY);
    INSERT INTO beds VALUES (1);
    CREATE TABLE booking_bed_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER, bed_id INTEGER, dorm_id INTEGER,
      checkin_date TEXT, checkout_date TEXT, status TEXT, assigned_by TEXT, assigned_at TEXT, inventory_pool TEXT
    );
    CREATE TABLE bed_blocks (bed_id INTEGER, is_active INTEGER, start_date TEXT, end_date TEXT);
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guest_name TEXT NOT NULL, contact TEXT DEFAULT '',
      platform TEXT NOT NULL, booking_ref TEXT DEFAULT '', checkin_date TEXT NOT NULL,
      checkout_date TEXT DEFAULT '', room_type TEXT DEFAULT '', persons INTEGER NOT NULL DEFAULT 1,
      payment_status TEXT DEFAULT 'unknown', payment_override INTEGER NOT NULL DEFAULT 0,
      special_requests TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'hold', source TEXT DEFAULT 'website',
      property TEXT DEFAULT 'goko_hostel', raw_data TEXT DEFAULT '', created_at TEXT NOT NULL,
      synced_at TEXT DEFAULT '', amount_before_tax INTEGER DEFAULT 0, amount_tax INTEGER DEFAULT 0,
      amount_total INTEGER DEFAULT 0, amount_paid INTEGER DEFAULT 0, payment_method TEXT NOT NULL DEFAULT '',
      cash_received INTEGER NOT NULL DEFAULT 0, change_given INTEGER NOT NULL DEFAULT 0,
      amount_refunded INTEGER NOT NULL DEFAULT 0, refund_method TEXT NOT NULL DEFAULT '',
      refund_cash INTEGER NOT NULL DEFAULT 0, refunded_at TEXT NOT NULL DEFAULT '',
      refunded_by TEXT NOT NULL DEFAULT '', booking_cycle INTEGER NOT NULL DEFAULT 1,
      nightly_rate INTEGER DEFAULT 0, currency TEXT DEFAULT 'INR', email TEXT DEFAULT '',
      cm_booking_id TEXT DEFAULT '', goko_booking_id TEXT DEFAULT '', rate_plan TEXT DEFAULT '',
      hold_expires_at TEXT DEFAULT '', cancelled_at TEXT DEFAULT '', cancelled_by TEXT DEFAULT '',
      checked_in_at TEXT DEFAULT '', checked_in_by TEXT DEFAULT '', checked_out_at TEXT DEFAULT '',
      checked_out_by TEXT DEFAULT '', no_show_pms_status TEXT NOT NULL DEFAULT 'not_required',
      no_show_pms_error TEXT NOT NULL DEFAULT '', no_show_pms_attempted_at TEXT NOT NULL DEFAULT '',
      sync_updated_at TEXT, sync_source TEXT, sync_id TEXT, deleted_at TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, sync_updated_at TEXT, sync_source TEXT);
    CREATE TABLE channel_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, hotel_code TEXT, pms_id TEXT,
      api_base_url TEXT, api_username TEXT, api_password TEXT, webhook_secret TEXT,
      booking_engine_url TEXT DEFAULT '/book', is_active INTEGER DEFAULT 1, created_at TEXT
    );
  `);
  for (const file of [
    "0059_native_inventory_hold_primitive.sql",
    "0060_native_accepted_quotes.sql",
    "0061_guest_booking_lookup.sql",
    "0062_native_guest_checkout.sql",
  ]) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  state.db = drizzle(sqlite, { schema });
  vi.stubEnv("GOKO_NATIVE_GUEST_CHECKOUT_ENABLED", "true");
  vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "true");
  vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_DUMMYPUBLIC");
  vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", KEY);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", HOOK);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", "DUMMY_DISTINCT_LIVE");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS", "");
  calls = [];
  providerOrders = new Map();
  providerPayments = new Map();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
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
    if (path.startsWith("orders?") || path === "orders") {
      return json({
        entity: "collection",
        items: [...providerOrders.values()].filter((o) =>
          !parsed.searchParams.get("receipt") || o.receipt === parsed.searchParams.get("receipt")),
      });
    }
    const orderPayments = path.match(/^orders\/(order_[A-Za-z0-9]+)\/payments$/);
    if (orderPayments) {
      return json({
        entity: "collection",
        items: [...providerPayments.values()].filter((p) => p.order_id === orderPayments[1]),
      });
    }
    const pay = path.match(/^payments\/(pay_[A-Za-z0-9]+)$/);
    if (pay) {
      return providerPayments.has(pay[1]) ? json(providerPayments.get(pay[1])) : json({ error: "unknown" }, 404);
    }
    throw new Error(`Unexpected mock gateway request: ${path}`);
  }));
});
afterEach(() => {
  if (sqlite.open) sqlite.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Native guest payment verify / reconcile / min-amount", () => {
  it("verifyGuestPayment succeeds with valid HMAC and captured payment then fulfils", async () => {
    const seeded = await seedReadyCheckout();
    const p = payment(seeded.orderId!, seeded.amount);
    const result = await verifyGuestPayment(
      seeded.id, OWNER, p.id, seeded.orderId!, sign(`${seeded.orderId}|${p.id}`),
    );
    expect(result.state).toBe("fulfilled");
    expect(sqlite.prepare("SELECT captured, status FROM native_booking_payments WHERE id=?").get(p.id))
      .toEqual({ captured: 1, status: "captured" });
    expect(sqlite.prepare("SELECT status FROM bookings WHERE id=?").get(seeded.bookingId))
      .toEqual({ status: "received" });
  });

  it("verifyGuestPayment rejects a bad signature before provider lookup", async () => {
    const seeded = await seedReadyCheckout();
    const before = calls.length;
    await expect(verifyGuestPayment(seeded.id, OWNER, "pay_DUMMY1", seeded.orderId!, "0".repeat(64)))
      .rejects.toBeInstanceOf(RazorpayError);
    await expect(verifyGuestPayment(seeded.id, OWNER, "pay_DUMMY1", seeded.orderId!, "0".repeat(64)))
      .rejects.toMatchObject({ code: "SIGNATURE" });
    expect(calls).toHaveLength(before);
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_payments").get()).toEqual({ n: 0 });
  });

  it("verifyGuestPayment rejects order ID mismatch before provider lookup", async () => {
    const seeded = await seedReadyCheckout();
    const before = calls.length;
    await expect(verifyGuestPayment(
      seeded.id, OWNER, "pay_DUMMY1", "order_EVIL", sign("order_EVIL|pay_DUMMY1"),
    )).rejects.toMatchObject({ code: "MISMATCH" });
    expect(calls).toHaveLength(before);
  });

  it("reconcileGuestCheckout recovers after payment.failed then a later capture", async () => {
    const seeded = await seedReadyCheckout();
    payment(seeded.orderId!, seeded.amount, "failed", "pay_DUMMYFAIL");
    let snap = await reconcileGuestCheckout(seeded.id, OWNER);
    expect(snap.state).toBe("ready");
    expect(sqlite.prepare("SELECT status, captured FROM native_booking_payments WHERE id=?").get("pay_DUMMYFAIL"))
      .toEqual({ status: "failed", captured: 0 });

    payment(seeded.orderId!, seeded.amount, "captured", "pay_DUMMYFAIL");
    snap = await reconcileGuestCheckout(seeded.id, OWNER);
    expect(snap.state).toBe("fulfilled");
    expect(sqlite.prepare("SELECT status, captured FROM native_booking_payments WHERE id=?").get("pay_DUMMYFAIL"))
      .toEqual({ status: "captured", captured: 1 });
  });

  it("verifyGuestPayment on a cancelled checkout records capture but does not fulfil", async () => {
    const seeded = await seedReadyCheckout({ state: "cancelled" });
    const p = payment(seeded.orderId!, seeded.amount);
    const result = await verifyGuestPayment(
      seeded.id, OWNER, p.id, seeded.orderId!, sign(`${seeded.orderId}|${p.id}`),
    );
    expect(result.state).toBe("cancelled");
    expect(sqlite.prepare("SELECT captured, status FROM native_booking_payments WHERE id=?").get(p.id))
      .toEqual({ captured: 1, status: "captured" });
    expect(sqlite.prepare("SELECT status FROM bookings WHERE id=?").get(seeded.bookingId))
      .toEqual({ status: "hold" });
    await expect(claimGuestCheckout(seeded.id, OWNER)).rejects.toBeInstanceOf(GuestCheckoutError);
  });

  it("duplicate verifyGuestPayment callback is idempotent", async () => {
    const seeded = await seedReadyCheckout();
    const p = payment(seeded.orderId!, seeded.amount);
    const sig = sign(`${seeded.orderId}|${p.id}`);
    const first = await verifyGuestPayment(seeded.id, OWNER, p.id, seeded.orderId!, sig);
    const second = await verifyGuestPayment(seeded.id, OWNER, p.id, seeded.orderId!, sig);
    expect(first.state).toBe("fulfilled");
    expect(second.state).toBe("fulfilled");
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_payments").get()).toEqual({ n: 1 });
  });

  it("createRazorpayBookingOrder rejects dueNowPaise between 1 and 99 (Razorpay min)", async () => {
    for (const amountPaise of [1, 50, 99]) {
      await expect(createRazorpayBookingOrder({
        amountPaise, receipt: "gbk_min_test", checkoutId: crypto.randomUUID(), environment: "test",
      })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
    // Schema also rejects sub-min online dues on the ledger.
    expect(() => sqlite.prepare(`
      INSERT INTO native_booking_checkouts (
        id, request_key, request_hash, owner_hash, guest_access_hash, payment_choice, environment,
        state, due_now_paise, guest_name, guest_email, guest_phone, created_at, updated_at
      ) VALUES (?, ?, 'h', 'h', 'h', 'full', 'test', 'preparing', 50, 'G', 'e@x.test', '', 'now', 'now')
    `).run(crypto.randomUUID(), crypto.randomUUID())).toThrow(/CHECK|constraint/i);
  });

  it("claimGuestCheckout is blocked when state is order_unknown", async () => {
    const seeded = await seedReadyCheckout({ state: "order_unknown", orderId: null });
    await expect(claimGuestCheckout(seeded.id, OWNER))
      .rejects.toBeInstanceOf(GuestCheckoutError);
    await expect(claimGuestCheckout(seeded.id, OWNER))
      .rejects.toThrow(/unresolved|reconcile/i);
  });

  it("createRazorpayBookingOrder notes include goko_checkout_id", async () => {
    const checkoutId = crypto.randomUUID();
    const order = await createRazorpayBookingOrder({
      amountPaise: 10000, receipt: "gbk_note_check_receipt", checkoutId, environment: "test",
    });
    expect(calls.filter((c) => c.method === "POST" && c.path === "orders")).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      amount: 10000, currency: "INR", partial_payment: false,
      notes: { goko_checkout_id: checkoutId },
    });
    expect(order.notes).toMatchObject({ goko_checkout_id: checkoutId });
  });
});
