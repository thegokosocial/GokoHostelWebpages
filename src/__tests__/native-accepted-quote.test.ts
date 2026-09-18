import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { createNativeInventoryHold, releaseNativeInventoryHold } from "@/lib/nativeInventoryHold";
import { acceptNativeQuote, getNativeAcceptedQuote } from "@/lib/nativeAcceptedQuote";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS } from "@/lib/websiteBookingSettings";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";
import { getSyncableTableNames } from "@/lib/syncEngine";

const state = vi.hoisted(() => ({ db: null as Database | null, pi: false }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@/db/queries", () => ({ getAllBeds: async () => [{ id: 1, dormId: 1, bedId: "A1", type: "Bunk" }],
  getAvailableBedsForRange: async () => [{ id: 1, dormId: 1, bedId: "A1", type: "Bunk", pool: "online" }],
}));
let sqlite: SQLite.Database;
const owner = () => ({ requestKey: crypto.randomUUID(), ownerToken: "a".repeat(64) });
const quote = () => ({ checkinDate: addCalendarDays(todayIST(), 1), checkoutDate: addCalendarDays(todayIST(), 2),
  policyVersion: "server-published-test-v1", policy: { ...DEFAULT_WEBSITE_BOOKING_SETTINGS }, taxBasisPoints: 500,
  paymentChoice: "advance" as const, units: [{ key: "1:bed:1", nightlyRates: [{ date: addCalendarDays(todayIST(), 1), rupees: 1001 }] }],
});
async function hold(identity: ReturnType<typeof owner>) { const input = quote(); return createNativeInventoryHold({ ...identity,
  checkinDate: input.checkinDate, checkoutDate: input.checkoutDate, bedIds: [1] }); }
beforeEach(() => {
  state.pi = false; sqlite = new SQLite(":memory:"); sqlite.pragma("foreign_keys = ON");
  sqlite.exec("CREATE TABLE beds (id INTEGER PRIMARY KEY); INSERT INTO beds VALUES (1); CREATE TABLE booking_bed_assignments (bed_id INTEGER, booking_id INTEGER, status TEXT, checkin_date TEXT, checkout_date TEXT); CREATE TABLE bed_blocks (bed_id INTEGER,is_active INTEGER,start_date TEXT,end_date TEXT)");
  for (const file of ["0059_native_inventory_hold_primitive.sql", "0060_native_accepted_quotes.sql"]) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  // 0063 hold column + trigger rewrite (checkout table absent in this suite).
  sqlite.exec("ALTER TABLE native_inventory_holds ADD COLUMN exclude_booking_id INTEGER;");
  const amendSql = readFileSync("migrations/0063_guest_booking_amend.sql", "utf8");
  sqlite.exec(amendSql.slice(amendSql.indexOf("DROP TRIGGER IF EXISTS native_hold_insert_guard")));
  state.db = drizzle(sqlite, { schema }) as unknown as Database; vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "true");
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("Durable owner-bound accepted native quote — internal only", () => {
  it("stores the exact accepted contract and recovers it without repricing", async () => {
    const identity = owner(); const allocation = await hold(identity), input = quote();
    const accepted = await acceptNativeQuote(identity, input);
    input.policy.advancePercent = 100; input.units[0].nightlyRates[0].rupees = 1;
    expect(await getNativeAcceptedQuote(identity)).toEqual(accepted);
    expect(accepted.holdId).toBe(allocation.id); expect(accepted.quote.totalRupees).toBe(1051);
    expect(accepted.nativeCheckoutReady).toBe(false);
    expect(JSON.stringify(accepted)).not.toContain(identity.ownerToken);
  });
  it("deduplicates 20 concurrent accepts with stable identity and timestamp", async () => {
    const identity = owner(); await hold(identity);
    const results = await Promise.all(Array.from({ length: 20 }, () => acceptNativeQuote(identity, quote())));
    expect(new Set(results.map((r) => r.id)).size).toBe(1); expect(new Set(results.map((r) => r.acceptedAt)).size).toBe(1);
    expect(sqlite.prepare("SELECT count(*) n FROM native_accepted_quotes").get()).toEqual({ n: 1 });
  });
  it("allows only one set of terms among 20 competing amounts", async () => {
    const identity = owner(); await hold(identity);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => {
      const input = quote(); input.units[0].nightlyRates[0].rupees += i; return acceptNativeQuote(identity, input);
    }));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sqlite.prepare("SELECT count(*) n FROM native_accepted_quotes").get()).toEqual({ n: 1 });
  });
  it("recovers accepted terms after disable and release, but never accepts new terms", async () => {
    const identity = owner(), allocation = await hold(identity), accepted = await acceptNativeQuote(identity, quote());
    await releaseNativeInventoryHold(allocation.id, identity.ownerToken); vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false");
    expect(await getNativeAcceptedQuote(identity)).toEqual(accepted); expect(await acceptNativeQuote(identity, quote())).toEqual(accepted);
    await expect(acceptNativeQuote(identity, { ...quote(), policyVersion: "different" })).rejects.toMatchObject({ status: 409 });
  });
  it("denies other owners, Pi and missing accepted contracts", async () => {
    const identity = owner(); await hold(identity);
    await expect(getNativeAcceptedQuote(identity)).rejects.toMatchObject({ status: 404 });
    await acceptNativeQuote(identity, quote());
    await expect(getNativeAcceptedQuote({ ...identity, ownerToken: "b".repeat(64) })).rejects.toMatchObject({ status: 404 });
    await expect(acceptNativeQuote({ ...identity, ownerToken: "b".repeat(64) }, quote())).rejects.toMatchObject({ status: 404 });
    state.pi = true; state.db = null; await expect(getNativeAcceptedQuote(identity)).rejects.toThrow("Cloudflare-owned");
    expect(getSyncableTableNames()).not.toContain("native_accepted_quotes");
  });
  it("rejects quote dates or units not matching the held allocation", async () => {
    const identity = owner(); await hold(identity);
    const input = quote(); input.checkoutDate = addCalendarDays(input.checkoutDate, 1); input.units[0].nightlyRates.push({ date: addCalendarDays(input.checkinDate, 1), rupees: 100 });
    await expect(acceptNativeQuote(identity, input)).rejects.toThrow("dates do not match");
    const wrongUnit = quote(); wrongUnit.units[0].key = "other-unit";
    await expect(acceptNativeQuote(identity, wrongUnit)).rejects.toThrow("units do not match");
  });
  it("checks release at the SQL write boundary", async () => {
    const identity = owner(), allocation = await hold(identity); await releaseNativeInventoryHold(allocation.id, identity.ownerToken);
    await expect(acceptNativeQuote(identity, quote())).rejects.toThrow("expired or was released");
    expect(sqlite.prepare("SELECT count(*) n FROM native_accepted_quotes").get()).toEqual({ n: 0 });
  });
  it.each(["native_quote_insert_guard", "native_quote_immutable", "native_quote_retained"])("fails closed if guard %s is missing", async (name) => {
    const identity = owner(); await hold(identity); sqlite.exec(`DROP TRIGGER ${name}`);
    await expect(acceptNativeQuote(identity, quote())).rejects.toMatchObject({ status: 503 });
  });
  it("prevents SQL mutation/deletion and retains the referenced hold", async () => {
    const identity = owner(); await hold(identity); await acceptNativeQuote(identity, quote());
    expect(() => sqlite.exec("UPDATE native_accepted_quotes SET accepted_at=accepted_at+1")).toThrow("IMMUTABLE");
    expect(() => sqlite.exec("DELETE FROM native_accepted_quotes")).toThrow("RETAINED");
    expect(() => sqlite.exec("DELETE FROM native_inventory_holds")).toThrow("FOREIGN KEY");
  });
  it("rejects new acceptance while disabled", async () => {
    const identity = owner(); await hold(identity); vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false");
    await expect(acceptNativeQuote(identity, quote())).rejects.toMatchObject({ status: 403 });
  });
  it("uses database-clock expiry at acceptance and retains previously accepted evidence", async () => {
    const identity = owner(); await hold(identity);
    const accepted = await acceptNativeQuote(identity, quote());
    const nextIdentity = owner();
    const firstHold = await createNativeInventoryHold({ ...nextIdentity, checkinDate: addCalendarDays(todayIST(), 3),
      checkoutDate: addCalendarDays(todayIST(), 4), bedIds: [1] });
    const now = Math.floor(Date.now() / 1000);
    sqlite.function("strftime", { varargs: true }, () => String(now + 901)); // Test-owned database clock, no row mutation.
    const input = quote(); input.checkinDate = firstHold.checkinDate; input.checkoutDate = firstHold.checkoutDate;
    input.units[0].nightlyRates[0].date = firstHold.checkinDate;
    await expect(acceptNativeQuote(nextIdentity, input)).rejects.toThrow("expired or was released");
    expect(await getNativeAcceptedQuote(identity)).toEqual(accepted);
  });
  it("does not accept terms when a shared hold guard disappears", async () => {
    const identity = owner(); await hold(identity); sqlite.exec("DROP TRIGGER assignment_native_hold_insert_guard");
    await expect(acceptNativeQuote(identity, quote())).rejects.toMatchObject({ status: 503 });
  });
  it("recovers through a fresh database wrapper and preserves exact original terms", async () => {
    const identity = owner(); await hold(identity); const accepted = await acceptNativeQuote(identity, quote());
    state.db = drizzle(sqlite, { schema }) as unknown as Database;
    expect(await getNativeAcceptedQuote(identity)).toEqual(accepted);
  });
  it("sanitizes unavailable schema instead of pretending acceptance succeeded", async () => {
    const identity = owner(); await hold(identity); sqlite.exec("DROP TABLE native_accepted_quotes");
    await expect(acceptNativeQuote(identity, quote())).rejects.toMatchObject({ status: 503 });
    await expect(getNativeAcceptedQuote(identity)).rejects.toMatchObject({ status: 503 });
  });
  it("refuses malformed stored totals rather than exposing checkout evidence", async () => {
    const identity = owner(), allocation = await hold(identity), input = quote();
    // Simulate imported/corrupt evidence from an independent SQL writer, not service acceptance.
    sqlite.prepare("INSERT INTO native_accepted_quotes VALUES (?,?,?,?)").run(crypto.randomUUID(), allocation.id,
      JSON.stringify({ ...input, currency: "INR", nativeCheckoutReady: false, totalPaise: 1 }), Math.floor(Date.now() / 1000));
    await expect(getNativeAcceptedQuote(identity)).rejects.toMatchObject({ status: 503 });
  });
  it("recovers acceptance after SQL committed but its response was lost", async () => {
    const identity = owner(); await hold(identity);
    const originalPrepare = sqlite.prepare.bind(sqlite);
    vi.spyOn(sqlite, "prepare").mockImplementation((source: string) => {
      const statement = originalPrepare(source);
      if (source.startsWith('insert into "native_accepted_quotes"')) {
        const originalAll = statement.all.bind(statement);
        vi.spyOn(statement, "all").mockImplementationOnce((...parameters: unknown[]) => {
          originalAll(...parameters); throw new Error("Simulated committed response loss");
        });
      }
      return statement;
    });
    const accepted = await acceptNativeQuote(identity, quote());
    expect(await getNativeAcceptedQuote(identity)).toEqual(accepted);
    expect(sqlite.prepare("SELECT count(*) n FROM native_accepted_quotes").get()).toEqual({ n: 1 });
  });
});
