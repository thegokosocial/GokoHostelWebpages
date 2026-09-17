import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { createNativeInventoryHold, releaseNativeInventoryHold, getNativeInventoryHold, getNativeSelectionAvailability } from "@/lib/nativeInventoryHold";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { getSyncableTableNames } from "@/lib/syncEngine";

const state = vi.hoisted(() => ({ db: null as any, pi: false, pool: "online", missingDouble: false, pickerFailure: false }));
const fixtureBeds = [{ id: 1, dormId: 1, bedId: "A1", type: "Bunk" }, { id: 2, dormId: 2, bedId: "D1", type: "Double" }, { id: 3, dormId: 2, bedId: "D2", type: "Double" }];
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@/db/queries", () => ({ getAllBeds: async () => fixtureBeds.filter((b) => !state.missingDouble || b.id !== 3),
  getAvailableBedsForRange: async () => { if (state.pickerFailure) throw new Error("DUMMY_PRIVATE_DB_ERROR"); return fixtureBeds.map((b) => ({ ...b, pool: state.pool, guestName: "DUMMY_PRIVATE" })); },
}));
let sqlite: SQLite.Database;
const token = "a".repeat(64);
const selection = (bedIds = [1]) => ({ requestKey: crypto.randomUUID(), ownerToken: token, bedIds,
  checkinDate: addCalendarDays(todayIST(), 1), checkoutDate: addCalendarDays(todayIST(), 3) });
beforeEach(() => {
  state.pi = false; state.pool = "online"; state.missingDouble = false; state.pickerFailure = false;
  sqlite = new SQLite(":memory:");
  sqlite.exec("CREATE TABLE beds (id INTEGER PRIMARY KEY); INSERT INTO beds VALUES (1),(2),(3); CREATE TABLE booking_bed_assignments (bed_id INTEGER,status TEXT,checkin_date TEXT,checkout_date TEXT); CREATE TABLE bed_blocks (bed_id INTEGER,is_active INTEGER,start_date TEXT,end_date TEXT)");
  sqlite.exec(readFileSync("migrations/0059_native_inventory_hold_primitive.sql", "utf8"));
  state.db = drizzle(sqlite, { schema }); vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "true");
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Internal native inventory hold primitive — no public checkout", () => {
  it("recovers read-only by original request and owner after disable, without exposing ownership data", async () => {
    const request = selection(), result = await createNativeInventoryHold(request);
    vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false");
    expect(await getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: token })).toEqual(result);
    await expect(getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: "b".repeat(64) })).rejects.toMatchObject({ status: 404 });
    await expect(getNativeInventoryHold({ requestKey: crypto.randomUUID(), ownerToken: token })).rejects.toMatchObject({ status: 404 });
    await releaseNativeInventoryHold(result.id, token);
    expect((await getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: token })).state).toBe("released");
    expect(sqlite.prepare("SELECT count(*) n FROM native_inventory_holds").get()).toEqual({ n: 1 });
  });
  it("recovers a committed insert whose response was lost without reserving again", async () => {
    const request = selection(), originalInsert = state.db.insert.bind(state.db);
    vi.spyOn(state.db, "insert").mockImplementationOnce((...args: unknown[]) => {
      const builder = originalInsert(...args), originalValues = builder.values.bind(builder);
      builder.values = (...values: unknown[]) => {
        const insert = originalValues(...values), originalReturning = insert.returning.bind(insert);
        insert.returning = async () => { await originalReturning(); throw new Error("Simulated response loss"); };
        return insert;
      };
      return builder;
    });
    await expect(createNativeInventoryHold(request)).rejects.toMatchObject({ status: 503 });
    const recovered = await getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: token });
    expect(await createNativeInventoryHold(request)).toEqual(recovered);
    expect(sqlite.prepare("SELECT count(*) n FROM native_inventory_holds").get()).toEqual({ n: 1 });
  });
  it("shows only complete online units, without picker guest data, and removes active holds", async () => {
    const request = selection(), range = { checkinDate: request.checkinDate, checkoutDate: request.checkoutDate };
    const initial = await getNativeSelectionAvailability(range);
    expect(initial.units.map((u) => u.bedIds)).toEqual([[1], [2, 3]]);
    expect(JSON.stringify(initial)).not.toContain("DUMMY_PRIVATE");
    const hold = await createNativeInventoryHold(request);
    expect((await getNativeSelectionAvailability(range)).units.map((u) => u.bedIds)).toEqual([[2, 3]]);
    await releaseNativeInventoryHold(hold.id, token);
    expect(await getNativeSelectionAvailability(range)).toEqual(initial);
    state.pool = "offline"; expect((await getNativeSelectionAvailability(range)).units).toEqual([]);
  });
  it("does not hide adjacent dates or let an orphaned Double slot be selected", async () => {
    const request = selection(); await createNativeInventoryHold(request);
    const adjacent = await getNativeSelectionAvailability({ checkinDate: request.checkoutDate, checkoutDate: addCalendarDays(request.checkoutDate, 1) });
    expect(adjacent.units.some((u) => u.bedIds.includes(1))).toBe(true);
    state.missingDouble = true;
    expect(adjacent.nativeCheckoutReady).toBe(false);
    expect((await getNativeSelectionAvailability({ checkinDate: request.checkinDate, checkoutDate: request.checkoutDate })).units).toEqual([]);
    await expect(createNativeInventoryHold(selection([2]))).rejects.toThrow("complete double");
  });
  it.each(["native_hold_insert_guard", "native_hold_immutable", "assignment_native_hold_insert_guard", "assignment_native_hold_update_guard", "block_native_hold_insert_guard", "block_native_hold_update_guard"])("fails closed without guard %s", async (name) => {
    sqlite.exec(`DROP TRIGGER ${name}`); // Fixed test-owned names only.
    await expect(createNativeInventoryHold(selection())).rejects.toMatchObject({ status: 503 });
    const request = selection();
    await expect(getNativeSelectionAvailability({ checkinDate: request.checkinDate, checkoutDate: request.checkoutDate })).rejects.toMatchObject({ status: 503 });
    expect(sqlite.prepare("SELECT count(*) n FROM native_inventory_holds").get()).toEqual({ n: 0 });
  });
  it("sanitizes missing schema and picker failures without successful availability or release", async () => {
    const request = selection(); state.pickerFailure = true;
    await expect(getNativeSelectionAvailability({ checkinDate: request.checkinDate, checkoutDate: request.checkoutDate })).rejects.toThrow("Native selection availability is unavailable");
    await expect(createNativeInventoryHold(request)).rejects.toThrow("Native selection availability is unavailable");
    sqlite.exec("DROP TABLE native_inventory_holds");
    await expect(createNativeInventoryHold(request)).rejects.toMatchObject({ status: 503 });
    await expect(getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: token })).rejects.toMatchObject({ status: 503 });
    await expect(releaseNativeInventoryHold(crypto.randomUUID(), token)).rejects.toMatchObject({ status: 503 });
  });
  it("does not mistake a same-named trigger on the wrong table for a hold guard", async () => {
    sqlite.exec("DROP TRIGGER native_hold_insert_guard; CREATE TRIGGER native_hold_insert_guard BEFORE INSERT ON beds BEGIN SELECT 1; END");
    await expect(createNativeInventoryHold(selection())).rejects.toMatchObject({ status: 503 });
  });
  it("hides a held Double as one complete unit and restores it after release", async () => {
    const request = selection([2, 3]), range = { checkinDate: request.checkinDate, checkoutDate: request.checkoutDate };
    const hold = await createNativeInventoryHold(request);
    expect((await getNativeSelectionAvailability(range)).units.map((u) => u.bedIds)).toEqual([[1]]);
    await releaseNativeInventoryHold(hold.id, token);
    expect((await getNativeSelectionAvailability(range)).units.map((u) => u.bedIds)).toEqual([[1], [2, 3]]);
  });
  it.each([{ checkinDate: "2026-02-30", checkoutDate: "2026-03-02" }, { checkinDate: "2026-12-01", checkoutDate: "2026-12-01" },
    { checkinDate: "2026-12-01", checkoutDate: "2027-02-01" }])("rejects invalid availability stay %j", async (range) => {
    await expect(getNativeSelectionAvailability(range)).rejects.toThrow();
  });
  it("denies availability by default and all new recovery/release services on Pi", async () => {
    const request = selection(), range = { checkinDate: request.checkinDate, checkoutDate: request.checkoutDate };
    vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false");
    await expect(getNativeSelectionAvailability(range)).rejects.toMatchObject({ status: 403 });
    state.pi = true; state.db = null;
    await expect(getNativeSelectionAvailability(range)).rejects.toThrow("Cloudflare-owned");
    await expect(getNativeInventoryHold({ requestKey: request.requestKey, ownerToken: token })).rejects.toThrow("Cloudflare-owned");
    await expect(releaseNativeInventoryHold(crypto.randomUUID(), token)).rejects.toThrow("Cloudflare-owned");
  });
  it("holds selected units with a bounded immutable expiry and no secret/guest data in response", async () => {
    const result = await createNativeInventoryHold(selection());
    expect(result).toMatchObject({ state: "held", bedIds: [1], nativeCheckoutReady: false });
    expect(result.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(900);
    expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain("DUMMY_PRIVATE");
  });
  it("allows one last-unit reservation among 20 distinct concurrent request keys", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => createNativeInventoryHold(selection())));
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sqlite.prepare("SELECT count(*) n FROM native_inventory_holds").get()).toEqual({ n: 1 });
  });
  it("recovers the same request without extending expiry, including after disable", async () => {
    const request = selection(), result = await createNativeInventoryHold(request);
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => createNativeInventoryHold(request)));
    expect(new Set(outcomes.map((r) => r.id))).toEqual(new Set([result.id]));
    vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false"); expect(await createNativeInventoryHold(request)).toEqual(result);
  });
  it("rejects changed selections or ownership under an existing request key", async () => {
    const request = selection(); await createNativeInventoryHold(request);
    await expect(createNativeInventoryHold({ ...request, bedIds: [2, 3] })).rejects.toThrow("different selection");
    await expect(createNativeInventoryHold({ ...request, ownerToken: "b".repeat(64) })).rejects.toThrow("not found");
  });
  it("releases idempotently only for its owner, without reactivating on replay", async () => {
    const request = selection(), result = await createNativeInventoryHold(request);
    await expect(releaseNativeInventoryHold(result.id, "b".repeat(64))).rejects.toThrow("not found");
    expect((await releaseNativeInventoryHold(result.id, token)).state).toBe("released");
    expect((await releaseNativeInventoryHold(result.id, token)).state).toBe("released");
    expect((await createNativeInventoryHold(request)).state).toBe("released");
    expect((await createNativeInventoryHold(selection())).state).toBe("held");
  });
  it.each(["offline", "block"])("rejects units in %s pool", async (pool) => {
    state.pool = pool; await expect(createNativeInventoryHold(selection())).rejects.toThrow("unavailable online");
  });
  it("requires a complete double and canonicalizes unordered selections", async () => {
    await expect(createNativeInventoryHold(selection([2]))).rejects.toThrow("complete double");
    const request = selection([3, 2]); const result = await createNativeInventoryHold(request);
    expect(result.bedIds).toEqual([2, 3]); expect(await createNativeInventoryHold({ ...request, bedIds: [2, 3] })).toEqual(result);
  });
  it("does not partially reserve a multi-unit selection when one unit is taken", async () => {
    await createNativeInventoryHold(selection());
    await expect(createNativeInventoryHold(selection([1, 2, 3]))).rejects.toThrow("just reserved");
    expect((await createNativeInventoryHold(selection([2, 3]))).bedIds).toEqual([2, 3]);
  });
  it.each(["assignment", "block"])("atomically rejects conflicts with an existing %s", async (kind) => {
    const request = selection();
    if (kind === "assignment") sqlite.prepare("INSERT INTO booking_bed_assignments VALUES (1,'assigned',?,?)").run(request.checkinDate, request.checkoutDate);
    else sqlite.prepare("INSERT INTO bed_blocks VALUES (1,1,?,?)").run(request.checkinDate, request.checkoutDate);
    await expect(createNativeInventoryHold(request)).rejects.toThrow("just reserved");
    expect(sqlite.prepare("SELECT count(*) n FROM native_inventory_holds").get()).toEqual({ n: 0 });
  });
  it("guards assignment insert and date/bed update by other SQL writers", async () => {
    const request = selection(); await createNativeInventoryHold(request);
    expect(() => sqlite.prepare("INSERT INTO booking_bed_assignments VALUES (1,'assigned',?,?)").run(request.checkinDate, request.checkoutDate)).toThrow("NATIVE_HOLD_CONFLICT");
    sqlite.prepare("INSERT INTO booking_bed_assignments VALUES (2,'assigned',?,?)").run(request.checkinDate, request.checkoutDate);
    expect(() => sqlite.prepare("UPDATE booking_bed_assignments SET bed_id=1").run()).toThrow("NATIVE_HOLD_CONFLICT");
  });
  it("guards block insertion/reactivation by other SQL writers", async () => {
    const request = selection(); await createNativeInventoryHold(request);
    expect(() => sqlite.prepare("INSERT INTO bed_blocks VALUES (1,1,?,?)").run(request.checkinDate, request.checkoutDate)).toThrow("NATIVE_HOLD_CONFLICT");
    sqlite.prepare("INSERT INTO bed_blocks VALUES (1,0,?,?)").run(request.checkinDate, request.checkoutDate);
    expect(() => sqlite.prepare("UPDATE bed_blocks SET is_active=1").run()).toThrow("NATIVE_HOLD_CONFLICT");
  });
  it("allows adjacent stays with exclusive checkout semantics", async () => {
    const request = selection(); await createNativeInventoryHold(request);
    expect((await createNativeInventoryHold({ ...selection(), checkinDate: request.checkoutDate, checkoutDate: addCalendarDays(request.checkoutDate, 2) })).state).toBe("held");
  });
  it("expired holds stop blocking without deleting recovery evidence", async () => {
    const request = selection(), result = await createNativeInventoryHold(request); await releaseNativeInventoryHold(result.id, token);
    const row = sqlite.prepare("SELECT * FROM native_inventory_holds").get() as any, now = Math.floor(Date.now() / 1000);
    const expiredKey = crypto.randomUUID();
    sqlite.prepare("INSERT INTO native_inventory_holds VALUES (?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), expiredKey, row.request_hash, row.owner_hash, row.bed_ids, row.checkin_date, row.checkout_date, now - 1, "held", now - 901);
    expect((await createNativeInventoryHold({ ...request, requestKey: expiredKey })).state).toBe("expired");
    expect((await getNativeInventoryHold({ requestKey: expiredKey, ownerToken: token })).state).toBe("expired");
    expect((await getNativeSelectionAvailability({ checkinDate: request.checkinDate, checkoutDate: request.checkoutDate })).units.some((u) => u.bedIds.includes(1))).toBe(true);
    expect((await createNativeInventoryHold(selection())).state).toBe("held");
  });
  it("prevents SQL allocation/expiry rewrite and resurrection", async () => {
    const result = await createNativeInventoryHold(selection());
    expect(() => sqlite.prepare("UPDATE native_inventory_holds SET expires_at=expires_at+1").run()).toThrow("IMMUTABLE");
    await releaseNativeInventoryHold(result.id, token);
    expect(() => sqlite.prepare("UPDATE native_inventory_holds SET state='held'").run()).toThrow("IMMUTABLE");
  });
  it.each([{ checkinDate: "2026-02-30" }, { checkoutDate: "garbage" }, { bedIds: [1, 1] }, { bedIds: [] }, { ownerToken: "guess" }])("rejects malformed request %j", async (override) => {
    await expect(createNativeInventoryHold({ ...selection(), ...override })).rejects.toThrow();
  });
  it("denies new creation by default and rejects Pi before DB access", async () => {
    vi.stubEnv("GOKO_NATIVE_HOLD_INTERNAL_ENABLED", "false"); await expect(createNativeInventoryHold(selection())).rejects.toThrow("disabled");
    state.pi = true; state.db = null; await expect(createNativeInventoryHold(selection())).rejects.toThrow("Cloudflare-owned");
    expect(getSyncableTableNames()).not.toContain("native_inventory_holds");
  });
});
