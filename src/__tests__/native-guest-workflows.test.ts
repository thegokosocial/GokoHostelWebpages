import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import {
  prepareGuestCheckout, verifyGuestPayment, cancelGuestBooking, GuestCheckoutError,
} from "@/lib/nativeGuestCheckout";
import { getSyncableTableNames } from "@/lib/syncEngine";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";
import { WEBSITE_BOOKING_SETTINGS_KEY, DEFAULT_WEBSITE_BOOKING_SETTINGS } from "@/lib/websiteBookingSettings";

const state = vi.hoisted(() => ({
  db: null as any,
  pi: false,
  assignFail: false,
  onAssign: null as null | (() => void),
}));
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
    getGuestBookingConfig: async () => ({ bookingEngineUrl: "/book", apiBaseUrl: "" }),
    assignBedToBooking: async (data: Parameters<typeof actual.assignBedToBooking>[0]) => {
      state.onAssign?.();
      if (state.assignFail) return false;
      return actual.assignBedToBooking(data);
    },
  };
});
vi.mock("@/lib/email", () => ({ sendBookingConfirmationEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
}));

const KEY = "DUMMY_API_SECRET";
const HOOK = "DUMMY_WEBHOOK_SECRET";
let sqlite: SQLite.Database;
let providerOrders: Map<string, any>;
let providerPayments: Map<string, any>;
let providerRefunds: Map<string, any>;
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

function seedRates(checkinDate: string, checkoutDate: string, rate = 1000) {
  sqlite.prepare(`
    INSERT OR IGNORE INTO room_type_mapping (id, dorm_id, dorm_name, channel_room_code, total_inventory, is_active)
    VALUES (1, 1, 'Mixed', 'MIX', 10, 1)
  `).run();
  sqlite.prepare(`
    INSERT OR IGNORE INTO rate_plan_mapping (id, room_mapping_id, rate_plan_code, rate_plan_name, is_active)
    VALUES (1, 1, 'STD', 'Standard', 1)
  `).run();
  const now = new Date().toISOString();
  for (let d = checkinDate; d <= checkoutDate; d = addCalendarDays(d, 1)) {
    sqlite.prepare(`
      INSERT OR IGNORE INTO daily_rates (rate_plan_id, date, rate, stop_sell, minimum_stay, close_on_arrival, close_on_departure, updated_at)
      VALUES (1, ?, ?, 0, 1, 0, 0, ?)
    `).run(d, rate, now);
  }
}

function selection(
  paymentChoice: "advance" | "full" | "property",
  checkinOffsetDays = 10,
) {
  const checkinDate = addCalendarDays(todayIST(), checkinOffsetDays);
  const checkoutDate = addCalendarDays(checkinDate, 1);
  seedRates(checkinDate, checkoutDate);
  return {
    requestKey: crypto.randomUUID(),
    checkinDate,
    checkoutDate,
    paymentChoice,
    guest: { name: "Workflow Guest", email: "workflow@example.test", phone: "+919876543210" },
    rooms: [{ roomId: "1-Bed", quantity: 1, ratePlanId: 1 }],
  };
}

async function payAndVerify(prepared: Awaited<ReturnType<typeof prepareGuestCheckout>>) {
  expect(prepared.ownerToken).toBeTruthy();
  expect(prepared.razorpay?.order_id).toBeTruthy();
  const orderId = prepared.razorpay!.order_id;
  const p = payment(orderId, prepared.dueNowPaise);
  return verifyGuestPayment(
    prepared.checkoutId, prepared.ownerToken!, p.id, orderId, sign(`${orderId}|${p.id}`),
  );
}

beforeEach(() => {
  state.pi = false;
  state.assignFail = false;
  state.onAssign = null;
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
    CREATE TABLE booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER, action TEXT, details TEXT,
      performed_by TEXT, performed_at TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, sync_updated_at TEXT, sync_source TEXT);
    CREATE TABLE channel_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, hotel_code TEXT, pms_id TEXT,
      api_base_url TEXT, api_username TEXT, api_password TEXT, webhook_secret TEXT,
      booking_engine_url TEXT DEFAULT '/book', is_active INTEGER DEFAULT 0, created_at TEXT
    );
    CREATE TABLE room_type_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT, dorm_id INTEGER NOT NULL, dorm_name TEXT NOT NULL,
      channel_room_code TEXT NOT NULL, total_inventory INTEGER NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE rate_plan_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_mapping_id INTEGER NOT NULL,
      rate_plan_code TEXT NOT NULL, rate_plan_name TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE daily_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rate_plan_id INTEGER NOT NULL, date TEXT NOT NULL,
      rate INTEGER NOT NULL, stop_sell INTEGER DEFAULT 0, minimum_stay INTEGER DEFAULT 1,
      maximum_stay INTEGER, close_on_arrival INTEGER DEFAULT 0, close_on_departure INTEGER DEFAULT 0,
      minimum_advance_reservation INTEGER, maximum_advance_reservation INTEGER,
      adult1_rate INTEGER, adult2_rate INTEGER, child_rate INTEGER, infant_rate INTEGER,
      extra_person_rate INTEGER, updated_by TEXT DEFAULT '', updated_at TEXT NOT NULL, synced_at TEXT DEFAULT ''
    );
  `);
  for (const file of [
    "0059_native_inventory_hold_primitive.sql",
    "0060_native_accepted_quotes.sql",
    "0061_guest_booking_lookup.sql",
    "0062_native_guest_checkout.sql",
  ]) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  state.db = drizzle(sqlite, { schema });
  sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("booking_tax_rate", "0");
  sqlite.prepare(`
    INSERT INTO channel_config (provider, hotel_code, pms_id, api_base_url, api_username, api_password, booking_engine_url, is_active, created_at)
    VALUES ('aiosell', 'H', 'P', 'https://api.example', 'u', 'p', '/book', 0, ?)
  `).run(new Date().toISOString());

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
  providerRefunds = new Map();
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
    const refund = path.match(/^payments\/(pay_[A-Za-z0-9]+)\/refund$/);
    if (refund && method === "POST") {
      const id = `rfnd_DUMMY${providerRefunds.size + 1}`;
      const r = { entity: "refund", id, payment_id: refund[1], ...body, currency: "INR", status: "processed" };
      providerRefunds.set(id, r);
      return json(r);
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

describe("Native guest checkout end-to-end workflows", () => {
  it("advance 50% payment → captured → booking received → beds assigned", async () => {
    const input = selection("advance");
    const prepared = await prepareGuestCheckout(input);
    expect(prepared.state).toBe("ready");
    expect(prepared.dueNowPaise).toBe(50000); // 50% of ₹1000
    expect(prepared.requiresPayment).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.path === "orders")).toHaveLength(1);

    const result = await payAndVerify(prepared);
    expect(result).toMatchObject({ state: "fulfilled", bookingStatus: "received", paymentChoice: "advance" });
    expect(result.amountPaid).toBe(500);
    expect(sqlite.prepare("SELECT count(*) n FROM booking_bed_assignments WHERE status='assigned' AND bed_id=1").get())
      .toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT state FROM native_inventory_holds").get()).toEqual({ state: "released" });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_payments WHERE captured=1").get()).toEqual({ n: 1 });
  });

  it("full payment → captured → booking received → beds assigned", async () => {
    const prepared = await prepareGuestCheckout(selection("full"));
    expect(prepared.dueNowPaise).toBe(100000);
    const result = await payAndVerify(prepared);
    expect(result).toMatchObject({ state: "fulfilled", bookingStatus: "received", paymentChoice: "full" });
    expect(result.amountPaid).toBe(1000);
    expect(result.dueAtPropertyPaise).toBe(0);
    expect(sqlite.prepare("SELECT count(*) n FROM booking_bed_assignments WHERE status='assigned'").get())
      .toEqual({ n: 1 });
  });

  it("pay at property → no Razorpay order, booking received, balance due", async () => {
    const beforeOrders = calls.filter((c) => c.method === "POST" && c.path === "orders").length;
    const prepared = await prepareGuestCheckout(selection("property"));
    expect(prepared).toMatchObject({
      state: "fulfilled",
      bookingStatus: "received",
      paymentChoice: "property",
      dueNowPaise: 0,
      requiresPayment: false,
      razorpay: null,
    });
    expect(prepared.amountTotal).toBe(1000);
    expect(prepared.amountPaid).toBe(0);
    expect(prepared.dueAtPropertyPaise).toBe(100000);
    expect(calls.filter((c) => c.method === "POST" && c.path === "orders")).toHaveLength(beforeOrders);
    expect(sqlite.prepare("SELECT payment_status FROM bookings").get()).toEqual({ payment_status: "pay_at_property" });
    expect(sqlite.prepare("SELECT count(*) n FROM booking_bed_assignments WHERE status='assigned'").get())
      .toEqual({ n: 1 });
  });

  it("guest cancel before deadline releases hold", async () => {
    const input = selection("advance", 10);
    const prepared = await prepareGuestCheckout(input);
    expect(prepared.state).toBe("ready");
    expect(sqlite.prepare("SELECT state FROM native_inventory_holds").get()).toEqual({ state: "held" });

    const cancelled = await cancelGuestBooking(prepared.reference!, prepared.guestAccessToken!);
    expect(cancelled).toMatchObject({ state: "cancelled", bookingStatus: "cancelled" });
    expect(sqlite.prepare("SELECT state FROM native_inventory_holds").get()).toEqual({ state: "released" });
    expect(sqlite.prepare("SELECT count(*) n FROM booking_bed_assignments WHERE status='assigned'").get())
      .toEqual({ n: 0 });
  });

  it("guest cancel after deadline is rejected", async () => {
    // Default 48h deadline with arrival tomorrow → already past self-service window.
    const prepared = await prepareGuestCheckout(selection("advance", 1));
    await expect(cancelGuestBooking(prepared.reference!, prepared.guestAccessToken!))
      .rejects.toBeInstanceOf(GuestCheckoutError);
    await expect(cancelGuestBooking(prepared.reference!, prepared.guestAccessToken!))
      .rejects.toThrow(/deadline/i);
    expect(sqlite.prepare("SELECT state FROM native_booking_checkouts").get()).toEqual({ state: "ready" });
    expect(sqlite.prepare("SELECT status FROM bookings").get()).toEqual({ status: "hold" });
    expect(sqlite.prepare("SELECT state FROM native_inventory_holds").get()).toEqual({ state: "held" });
  });

  it("assignBedToBooking failure after capture → captured_unfulfilled without double charge", async () => {
    state.assignFail = true;
    const prepared = await prepareGuestCheckout(selection("full"));
    const orderPosts = calls.filter((c) => c.method === "POST" && c.path === "orders").length;
    expect(orderPosts).toBe(1);

    await expect(payAndVerify(prepared)).rejects.toThrow(/do not pay again/i);
    expect(sqlite.prepare("SELECT state, closure_reason FROM native_booking_checkouts").get())
      .toEqual({ state: "captured_unfulfilled", closure_reason: "cannot_fulfil" });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_payments WHERE captured=1").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT status FROM bookings").get()).toEqual({ status: "hold" });
    expect(sqlite.prepare("SELECT count(*) n FROM booking_bed_assignments WHERE status='assigned'").get())
      .toEqual({ n: 0 });
    expect(calls.filter((c) => c.method === "POST" && c.path === "orders")).toHaveLength(1);

    // Replay verify must not create another order or payment row.
    const orderId = prepared.razorpay!.order_id;
    await expect(verifyGuestPayment(
      prepared.checkoutId, prepared.ownerToken!, "pay_DUMMY1", orderId, sign(`${orderId}|pay_DUMMY1`),
    )).rejects.toThrow(/do not pay again/i);
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_payments").get()).toEqual({ n: 1 });
    expect(calls.filter((c) => c.method === "POST" && c.path === "orders")).toHaveLength(1);
  });

  it("fulfilment releases hold BEFORE assign (no NATIVE_HOLD_CONFLICT)", async () => {
    const prepared = await prepareGuestCheckout(selection("full"));
    const events: string[] = [];
    state.onAssign = () => {
      const hold = sqlite.prepare("SELECT state FROM native_inventory_holds").get() as { state: string };
      expect(hold.state).toBe("released");
      events.push("assign-while-released");
    };
    const result = await payAndVerify(prepared);
    expect(result.state).toBe("fulfilled");
    expect(events).toEqual(["assign-while-released"]);
    expect(sqlite.prepare("SELECT count(*) n FROM booking_bed_assignments WHERE status='assigned'").get())
      .toEqual({ n: 1 });
  });

  it("sync allowlist excludes native_booking_* tables", () => {
    const names = getSyncableTableNames();
    expect(names).not.toContain("native_booking_checkouts");
    expect(names).not.toContain("native_booking_payments");
    expect(names).not.toContain("native_booking_refunds");
    expect(names).not.toContain("native_booking_webhooks");
    expect(names).not.toContain("native_inventory_holds");
    expect(names).not.toContain("native_accepted_quotes");
  });

  it("uses published advancePercent from saved website booking settings", async () => {
    sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      WEBSITE_BOOKING_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_WEBSITE_BOOKING_SETTINGS, advancePercent: 25 }),
    );
    const prepared = await prepareGuestCheckout(selection("advance"));
    expect(prepared.dueNowPaise).toBe(25000);
  });
});
