import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import {
  allocateGuestSelection, prepareGuestCheckout, claimGuestCheckout, GuestCheckoutError,
} from "@/lib/nativeGuestCheckout";
import { createNativeInventoryHold } from "@/lib/nativeInventoryHold";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { WEBSITE_BOOKING_SETTINGS_KEY } from "@/lib/websiteBookingSettings";

const state = vi.hoisted(() => ({
  db: null as any,
  pi: false,
  pool: "online",
}));

const fixtureBeds = [
  { id: 1, dormId: 1, bedId: "A1", type: "Bunk" },
  { id: 2, dormId: 1, bedId: "D1", type: "Double" },
  { id: 3, dormId: 1, bedId: "D2", type: "Double" },
  { id: 4, dormId: 1, bedId: "D3", type: "Double" },
  { id: 5, dormId: 1, bedId: "D4", type: "Double" },
  { id: 6, dormId: 1, bedId: "D5", type: "Double" },
  { id: 7, dormId: 1, bedId: "D6", type: "Double" },
];

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => { throw new Error("no cloudflare context"); },
}));
vi.mock("@/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/queries")>();
  return {
    ...actual,
    getAllBeds: async () => fixtureBeds,
    getAllDorms: async () => [{ id: 1, name: "Mixed", deletedAt: null }],
    getAvailableBedsForRange: async () => fixtureBeds.map((b) => ({
      ...b, pool: state.pool, guestName: "DUMMY_PRIVATE",
    })),
  };
});
vi.mock("@/lib/email", () => ({
  sendBookingConfirmationEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: async () => "fp",
  pushIfOtaChanged: async () => ({ attempted: false, accepted: true }),
}));

const KEY = "DUMMY_API_SECRET";
const HOOK = "DUMMY_WEBHOOK_SECRET";
let sqlite: SQLite.Database;
let providerOrders: Map<string, any>;
let calls: { path: string; method: string; body: any }[];

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

const stay = () => ({
  checkinDate: addCalendarDays(todayIST(), 1),
  checkoutDate: addCalendarDays(todayIST(), 3),
});

const guest = { name: "Ada Lovelace", email: "ada@example.test", phone: "+910000000000" };

function seedRates(checkin: string, checkout: string) {
  const nights = [checkin, addCalendarDays(checkin, 1), checkout];
  const now = new Date().toISOString();
  for (const date of nights) {
    sqlite.prepare(`INSERT INTO daily_rates (rate_plan_id, date, rate, adult1_rate, adult2_rate, stop_sell, minimum_stay, close_on_arrival, close_on_departure, updated_at)
      VALUES (1, ?, 850, 850, 1400, 0, 1, 0, 0, ?)`).run(date, now);
  }
}

function prepareInput(overrides: Record<string, unknown> = {}) {
  const dates = stay();
  return {
    requestKey: crypto.randomUUID(),
    ...dates,
    paymentChoice: "property" as const,
    guest,
    persons: 1,
    rooms: [{ roomId: "1-Bed", quantity: 1, ratePlanId: 1 }],
    ...overrides,
  };
}

beforeEach(() => {
  state.pi = false;
  state.pool = "online";
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE beds (id INTEGER PRIMARY KEY);
    INSERT INTO beds VALUES (1),(2),(3),(4),(5),(6),(7);
    CREATE TABLE booking_bed_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER, bed_id INTEGER, dorm_id INTEGER,
      checkin_date TEXT, checkout_date TEXT, status TEXT,
      assigned_by TEXT, assigned_at TEXT, inventory_pool TEXT DEFAULT 'online'
    );
    CREATE TABLE bed_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bed_id INTEGER, dorm_id INTEGER, start_date TEXT, end_date TEXT,
      is_active INTEGER DEFAULT 1, reason TEXT, blocked_by TEXT, blocked_at TEXT
    );
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_name TEXT NOT NULL, contact TEXT, platform TEXT NOT NULL, booking_ref TEXT,
      checkin_date TEXT NOT NULL, checkout_date TEXT, room_type TEXT, persons INTEGER DEFAULT 1,
      payment_status TEXT, payment_override INTEGER DEFAULT 0, special_requests TEXT,
      status TEXT NOT NULL DEFAULT 'received', source TEXT, property TEXT, raw_data TEXT,
      created_at TEXT NOT NULL, synced_at TEXT,
      amount_before_tax INTEGER DEFAULT 0, amount_tax INTEGER DEFAULT 0, amount_total INTEGER DEFAULT 0,
      amount_paid INTEGER DEFAULT 0, payment_method TEXT DEFAULT '', cash_received INTEGER DEFAULT 0,
      change_given INTEGER DEFAULT 0, amount_refunded INTEGER DEFAULT 0, refund_method TEXT DEFAULT '',
      refund_cash INTEGER DEFAULT 0, refunded_at TEXT DEFAULT '', refunded_by TEXT DEFAULT '',
      booking_cycle INTEGER DEFAULT 1, nightly_rate INTEGER DEFAULT 0, currency TEXT DEFAULT 'INR',
      ota_payment_terms TEXT, ota_currency TEXT,
      email TEXT, cm_booking_id TEXT, goko_booking_id TEXT, rate_plan TEXT,
      hold_expires_at TEXT, cancelled_at TEXT, cancelled_by TEXT,
      checked_in_at TEXT, checked_in_by TEXT, checked_out_at TEXT, checked_out_by TEXT,
      no_show_pms_status TEXT DEFAULT 'not_required', no_show_pms_error TEXT DEFAULT '',
      no_show_pms_attempted_at TEXT DEFAULT '',
      sync_id TEXT, sync_updated_at TEXT, sync_source TEXT, deleted_at TEXT
    );
    CREATE TABLE booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL, action TEXT NOT NULL, details TEXT,
      performed_by TEXT NOT NULL, performed_at TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, sync_updated_at TEXT, sync_source TEXT);
    CREATE TABLE channel_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL DEFAULT 'aiosell',
      hotel_code TEXT NOT NULL, pms_id TEXT NOT NULL, api_base_url TEXT NOT NULL,
      api_username TEXT NOT NULL, api_password TEXT NOT NULL, webhook_secret TEXT DEFAULT '',
      booking_engine_url TEXT DEFAULT '', is_active INTEGER NOT NULL DEFAULT 0,
      auto_push_inventory INTEGER NOT NULL DEFAULT 1, auto_push_rates INTEGER NOT NULL DEFAULT 0,
      auto_push_rate_restrictions INTEGER NOT NULL DEFAULT 0, auto_push_inv_restrictions INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE room_type_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT, dorm_id INTEGER NOT NULL, dorm_name TEXT NOT NULL,
      channel_room_code TEXT NOT NULL, total_inventory INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE rate_plan_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_mapping_id INTEGER NOT NULL,
      rate_plan_code TEXT NOT NULL, rate_plan_name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE daily_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rate_plan_id INTEGER NOT NULL, date TEXT NOT NULL,
      rate INTEGER NOT NULL, stop_sell INTEGER NOT NULL DEFAULT 0, minimum_stay INTEGER NOT NULL DEFAULT 1,
      maximum_stay INTEGER, close_on_arrival INTEGER NOT NULL DEFAULT 0, close_on_departure INTEGER NOT NULL DEFAULT 0,
      minimum_advance_reservation INTEGER, maximum_advance_reservation INTEGER,
      adult1_rate INTEGER, adult2_rate INTEGER, child_rate INTEGER, infant_rate INTEGER, extra_person_rate INTEGER,
      updated_by TEXT DEFAULT '', updated_at TEXT NOT NULL, synced_at TEXT DEFAULT ''
    );
  `);

  sqlite.exec(readFileSync("migrations/0059_native_inventory_hold_primitive.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0060_native_accepted_quotes.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0061_guest_booking_lookup.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0062_native_guest_checkout.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0063_guest_booking_amend.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0065_native_hold_lease_renew.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0066_gateway_receivables.sql", "utf8"));

  sqlite.prepare(`INSERT INTO channel_config
    (hotel_code, pms_id, api_base_url, api_username, api_password, booking_engine_url, is_active, created_at)
    VALUES ('H1','P1','https://api.example.test','u','p','/book',1,?)`).run(new Date().toISOString());
  sqlite.prepare(`INSERT INTO room_type_mapping (dorm_id, dorm_name, channel_room_code, total_inventory, is_active)
    VALUES (1,'Mixed','MIX',7,1)`).run();
  sqlite.prepare(`INSERT INTO rate_plan_mapping (room_mapping_id, rate_plan_code, rate_plan_name, is_active)
    VALUES (1,'STD','Standard',1)`).run();
  sqlite.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(WEBSITE_BOOKING_SETTINGS_KEY, JSON.stringify({
    maxSelectedBeds: 4, advancePercent: 50, allowFullPayment: true, allowPayAtProperty: true,
    holdMinutes: 15, unresolvedPaymentMaxMinutes: 30, cancellationDeadlineHours: 48,
    cancellationRefundPercent: 100, policyText: "", gatewayEnvironment: "test",
  }));
  sqlite.prepare(`INSERT INTO settings (key, value) VALUES ('booking_tax_rate', '0')`).run();
  const dates = stay();
  seedRates(dates.checkinDate, dates.checkoutDate);

  state.db = drizzle(sqlite, { schema });
  vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "true");
  vi.stubEnv("GOKO_NATIVE_GUEST_CHECKOUT_ENABLED", "true");
  vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_DUMMYPUBLIC");
  vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", KEY);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", HOOK);
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", "DUMMY_DISTINCT_LIVE");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS", "");
  vi.stubEnv("RAZORPAY_TEST_ACCOUNT_ID", "acc_DUMMY");

  calls = [];
  providerOrders = new Map();
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
    if (path === "orders") {
      return json({
        entity: "collection",
        items: [...providerOrders.values()].filter((o) =>
          !parsed.searchParams.get("receipt") || o.receipt === parsed.searchParams.get("receipt")),
      });
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

describe("allocateGuestSelection", () => {
  it("rejects more than 4 physical beds (e.g. 3 doubles)", async () => {
    const dates = stay();
    await expect(allocateGuestSelection({
      checkinDate: dates.checkinDate, checkoutDate: dates.checkoutDate,
      rooms: [{ roomId: "1-Double", quantity: 3, ratePlanId: 1 }],
    })).rejects.toThrow(/more than 4 physical beds/);
  });

  it("maps dormId-type room keys to bed IDs", async () => {
    const dates = stay();
    const result = await allocateGuestSelection({
      checkinDate: dates.checkinDate, checkoutDate: dates.checkoutDate,
      rooms: [
        { roomId: "1-Bed", quantity: 1, ratePlanId: 1 },
        { roomId: "1-Double", quantity: 1, ratePlanId: 1 },
      ],
    });
    expect(result.bedIds).toEqual([1, 2, 3]);
    expect(result.units).toHaveLength(2);
    expect(result.units[0]).toMatchObject({ dormId: 1, type: "Bed", bedIds: [1] });
    expect(result.units[1]).toMatchObject({ dormId: 1, type: "Double", bedIds: [2, 3] });
  });
});

describe("prepareGuestCheckout", () => {
  it("fulfils pay-at-property (dueNow=0) without Razorpay", async () => {
    const result = await prepareGuestCheckout(prepareInput());
    expect(result).toMatchObject({
      recovered: false, state: "fulfilled", paymentChoice: "property",
      dueNowPaise: 0, requiresPayment: false, razorpay: null,
    });
    expect(result.ownerToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.guestAccessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_checkouts").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT status FROM bookings").get()).toEqual({ status: "received" });
  });

  it("is idempotent on the same requestKey", async () => {
    const input = prepareInput();
    const first = await prepareGuestCheckout(input);
    const second = await prepareGuestCheckout(input);
    expect(second).toMatchObject({
      recovered: true, checkoutId: first.checkoutId, state: "fulfilled",
      ownerToken: null, guestAccessToken: null,
    });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_checkouts").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT count(*) n FROM bookings").get()).toEqual({ n: 1 });
  });

  it("rejects a different payload under the same requestKey", async () => {
    const input = prepareInput();
    await prepareGuestCheckout(input);
    await expect(prepareGuestCheckout({
      ...input,
      guest: { ...guest, name: "Different Guest" },
    })).rejects.toThrow(/different checkout/);
    await expect(prepareGuestCheckout({
      ...input,
      persons: 2,
    })).rejects.toThrow(/different checkout/);
  });

  it("rejects when destination is not native", async () => {
    sqlite.prepare("UPDATE channel_config SET booking_engine_url=?").run("https://external.example/book");
    await expect(prepareGuestCheckout(prepareInput())).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/\/book|not ready|Channel Manager/i),
    });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_checkouts").get()).toEqual({ n: 0 });
  });

  it("rejects when GOKO_NATIVE_GUEST_CHECKOUT_ENABLED is false", async () => {
    vi.stubEnv("GOKO_NATIVE_GUEST_CHECKOUT_ENABLED", "false");
    await expect(prepareGuestCheckout(prepareInput())).rejects.toMatchObject({ status: 403 });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_checkouts").get()).toEqual({ n: 0 });
  });

  it("enforces maxSelectedBeds server-side before allocating beds", async () => {
    sqlite.prepare("UPDATE settings SET value=? WHERE key=?").run(JSON.stringify({
      maxSelectedBeds: 2, advancePercent: 50, allowFullPayment: true, allowPayAtProperty: true,
      holdMinutes: 15, unresolvedPaymentMaxMinutes: 30, cancellationDeadlineHours: 48,
      cancellationRefundPercent: 100, policyText: "", gatewayEnvironment: "test",
    }), WEBSITE_BOOKING_SETTINGS_KEY);
    await expect(prepareGuestCheckout(prepareInput({
      rooms: [{ roomId: "1-Bed", quantity: 3, ratePlanId: 1 }],
    }))).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/at most 2 beds/i),
    });
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_checkouts").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT count(*) n FROM bookings").get()).toEqual({ n: 0 });
  });

  it("stores guest-entered persons and rejects over capacity", async () => {
    await prepareGuestCheckout(prepareInput({
      rooms: [
        { roomId: "1-Bed", quantity: 1, ratePlanId: 1 },
        { roomId: "1-Double", quantity: 1, ratePlanId: 1 },
      ],
      persons: 2, // capacity = 1 + 2 = 3
    }));
    expect(sqlite.prepare("SELECT persons FROM bookings").get()).toEqual({ persons: 2 });

    await expect(prepareGuestCheckout(prepareInput({
      rooms: [{ roomId: "1-Bed", quantity: 1, ratePlanId: 1 }],
      persons: 2, // capacity 1
    }))).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/sleeping capacity/i),
    });
  });

  it("skips tax when website tax apply is off even if booking_tax_rate is set", async () => {
    sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'booking_tax_rate'").run("5");
    sqlite.prepare("INSERT INTO settings (key, value) VALUES ('booking_tax_apply_website', '0')").run();
    await prepareGuestCheckout(prepareInput());
    // Two nights at ₹850 (stay is check-in+1 → check-in+3).
    expect(sqlite.prepare("SELECT amount_tax, amount_before_tax, amount_total FROM bookings").get()).toEqual({
      amount_tax: 0,
      amount_before_tax: 1700,
      amount_total: 1700,
    });
  });

  it("rejects missing or invalid persons", async () => {
    const { persons: _drop, ...without } = prepareInput();
    await expect(prepareGuestCheckout(without as never)).rejects.toThrow();
    await expect(prepareGuestCheckout(prepareInput({ persons: 0 }))).rejects.toThrow();
    await expect(prepareGuestCheckout(prepareInput({ persons: 1.5 }))).rejects.toThrow();
  });
});

describe("claimGuestCheckout and holds", () => {
  it("allows claim exactly once for a paid checkout", async () => {
    const result = await prepareGuestCheckout(prepareInput({ paymentChoice: "full" }));
    expect(result.state).toBe("ready");
    expect(result.razorpay?.order_id).toMatch(/^order_DUMMY/);
    expect(calls.filter((c) => c.path === "orders" && c.method === "POST")).toHaveLength(1);

    const before = sqlite.prepare("SELECT created_at, expires_at FROM native_inventory_holds").get() as {
      created_at: number; expires_at: number;
    };
    const claimed = await claimGuestCheckout(result.checkoutId, result.ownerToken!);
    expect(claimed.checkout.order_id).toBe(result.razorpay!.order_id);
    const after = sqlite.prepare("SELECT created_at, expires_at FROM native_inventory_holds").get() as {
      created_at: number; expires_at: number;
    };
    expect(after.expires_at).toBeGreaterThanOrEqual(before.expires_at);
    expect(after.expires_at - after.created_at).toBeLessThanOrEqual(900);

    await expect(claimGuestCheckout(result.checkoutId, result.ownerToken!))
      .rejects.toThrow(/already started|Reconcile/);
  });

  it("rejects prepare when an active hold already owns the Bed unit", async () => {
    const dates = stay();
    await createNativeInventoryHold({
      requestKey: crypto.randomUUID(), ownerToken: "b".repeat(64), bedIds: [1],
      checkinDate: dates.checkinDate, checkoutDate: dates.checkoutDate,
    });
    await expect(prepareGuestCheckout(prepareInput())).rejects.toBeInstanceOf(GuestCheckoutError);
    expect(sqlite.prepare("SELECT count(*) n FROM native_booking_checkouts").get()).toEqual({ n: 0 });
  });

  it("allows prepare after hold expiry frees the bed", async () => {
    const dates = stay();
    const token = "c".repeat(64);
    const hold = await createNativeInventoryHold({
      requestKey: crypto.randomUUID(), ownerToken: token, bedIds: [1],
      checkinDate: dates.checkinDate, checkoutDate: dates.checkoutDate,
    });
    const row = sqlite.prepare("SELECT * FROM native_inventory_holds WHERE id=?").get(hold.id) as any;
    const now = Math.floor(Date.now() / 1000);
    sqlite.prepare("DELETE FROM native_inventory_holds WHERE id=?").run(hold.id);
    sqlite.prepare(`INSERT INTO native_inventory_holds
      (id, request_key, request_hash, owner_hash, bed_ids, checkin_date, checkout_date, expires_at, state, created_at, exclude_booking_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.id, row.request_key, row.request_hash, row.owner_hash, row.bed_ids,
      row.checkin_date, row.checkout_date, now - 1, "held", now - 901, null,
    );
    const result = await prepareGuestCheckout(prepareInput());
    expect(result.state).toBe("fulfilled");
    expect(result.dueNowPaise).toBe(0);
  });
});
