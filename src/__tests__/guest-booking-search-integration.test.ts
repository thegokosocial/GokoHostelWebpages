import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { searchGuestRooms } from "@/lib/guestBookingSearch";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
const state = vi.hoisted(() => ({ db: null as any, pool: "online", broken: false, active: true, ambiguous: false, settings: null as string | null, taxRate: "0" as string, taxApplyWebsite: null as string | null, adult1: null as number | null, adult2: null as number | null, missingDoubleNight: false, closedDeparture: false }));
vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/db/queries", () => ({
  getAllDorms: async () => [{ id: 1, name: "Mixed dorm", deletedAt: null }],
  getSetting: async (key: string) => {
    if (key === "booking_tax_rate") return state.taxRate;
    if (key === "booking_tax_apply_website") return state.taxApplyWebsite;
    return state.settings;
  },
  getAvailableBedsForRange: async () => { if (state.broken) throw new Error("PRIVATE"); return [{ id: 1, pool: state.pool, guestName: "PRIVATE" }, ...[2, 3, 4].map(id => ({ id, pool: state.pool }))]; },
  getRoomTypeMappings: async () => state.ambiguous ? [{ id: 1, dormId: 1, isActive: 1 }, { id: 2, dormId: 1, isActive: 1 }] : [{ id: 1, dormId: 1, isActive: 1 }],
  getRatePlanMappings: async () => [{ id: 1, roomMappingId: 1, isActive: state.active ? 1 : 0, ratePlanName: "Standard" }],
  getAllDailyRates: async (start: string, end: string) => [start, addCalendarDays(start, 1), end].map(date => ({ ratePlanId: 1, date, rate: 850, adult1Rate: state.adult1, adult2Rate: date === end || (state.missingDoubleNight && date === start) ? null : state.adult2, stopSell: 0, minimumStay: 1, maximumStay: null, closeOnArrival: 0, closeOnDeparture: date === end && state.closedDeparture ? 1 : 0, minimumAdvanceReservation: null, maximumAdvanceReservation: null })),
}));
let sqlite: SQLite.Database;
const stay = () => ({ checkinDate: addCalendarDays(todayIST(), 1), checkoutDate: addCalendarDays(todayIST(), 3) });
beforeEach(() => {
  state.pool = "online"; state.broken = false; state.active = true; state.ambiguous = false;
  state.settings = null; state.taxRate = "0"; state.taxApplyWebsite = null; state.adult1 = null;
  state.adult2 = null; state.missingDoubleNight = false; state.closedDeparture = false;
  sqlite = new SQLite(":memory:");
  sqlite.exec("CREATE TABLE beds (id INTEGER PRIMARY KEY,dorm_id INTEGER,bed_id TEXT,type TEXT,deleted_at TEXT); INSERT INTO beds VALUES(1,1,'A1','Bunk',NULL),(2,1,'A2','Bunk','deleted'); CREATE TABLE native_inventory_holds(bed_ids TEXT,state TEXT,expires_at INTEGER,checkin_date TEXT,checkout_date TEXT)");
  state.db = drizzle(sqlite);
});
afterEach(() => sqlite.close());
describe("Guest availability SQL and rate assembly", () => {
  it("requires double prices on occupied nights, not checkout, but enforces departure restrictions", async () => {
    sqlite.exec("INSERT INTO beds VALUES(3,1,'D1','Double',NULL),(4,1,'D2','Double',NULL)");
    state.adult2 = 1400;
    const doubleRate = async () => (await searchGuestRooms(stay())).rooms.find(room => room.type === "Double")?.rates;
    expect(await doubleRate()).toMatchObject([{ subtotalRupees: 2800 }]);
    state.missingDoubleNight = true; expect(await doubleRate()).toEqual([]);
    state.missingDoubleNight = false; state.closedDeparture = true; expect(await doubleRate()).toEqual([]);
  });
  it("uses Inventory occupancy tariffs, returns saved limits, and rejects corrupt settings", async () => {
    state.adult1 = 700; state.settings = JSON.stringify({ maxSelectedBeds: 12 });
    const result = await searchGuestRooms(stay());
    expect(result.maxSelectedBeds).toBe(12);
    expect(result.rooms[0].rates?.[0]).toMatchObject({ subtotalRupees: 1400, nightlyRates: [{ rupees: 700 }, { rupees: 700 }] });
    state.settings = JSON.stringify({ maxSelectedBeds: 0 });
    await expect(searchGuestRooms(stay())).rejects.toThrow();
  });
  it("uses current online data, filters deleted beds and returns configured whole-stay prices", async () => {
    const result = await searchGuestRooms(stay());
    expect(result.rooms[0]).toMatchObject({ availableUnits: 1, rates: [{ name: "Standard", subtotalRupees: 1700 }] });
    expect(result.nativeCheckoutReady).toBe(false); expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result.taxPercent).toBe(0);
    state.pool = "offline"; expect((await searchGuestRooms(stay())).rooms).toEqual([]);
  });
  it("returns taxPercent 0 when website tax apply is off even if rate is set", async () => {
    state.taxRate = "5";
    state.taxApplyWebsite = "0";
    expect((await searchGuestRooms(stay())).taxPercent).toBe(0);
    state.taxApplyWebsite = "1";
    expect((await searchGuestRooms(stay())).taxPercent).toBe(5);
  });
  it("subtracts active overlapping holds using database time, but permits adjacent/expired/released holds", async () => {
    const input = stay();
    sqlite.prepare("INSERT INTO native_inventory_holds VALUES('[1]','held',CAST(strftime('%s','now') AS INTEGER)+600,?,?)").run(input.checkinDate, input.checkoutDate);
    expect((await searchGuestRooms(input)).rooms).toEqual([]);
    sqlite.exec("UPDATE native_inventory_holds SET expires_at=0"); expect((await searchGuestRooms(input)).rooms).toHaveLength(1);
    sqlite.exec("UPDATE native_inventory_holds SET state='released', expires_at=9999999999"); expect((await searchGuestRooms(input)).rooms).toHaveLength(1);
    sqlite.prepare("UPDATE native_inventory_holds SET state='held', checkin_date=?, checkout_date=?").run(input.checkoutDate, addCalendarDays(input.checkoutDate, 1));
    expect((await searchGuestRooms(input)).rooms).toHaveLength(1);
  });
  it("permits the pre-hold schema for read-only browsing but rejects corrupt holds or picker outages", async () => {
    sqlite.exec("INSERT INTO native_inventory_holds VALUES('invalid','held',9999999999,'2000-01-01','2099-01-01')");
    await expect(searchGuestRooms(stay())).rejects.toThrow();
    sqlite.exec("DROP TABLE native_inventory_holds"); expect((await searchGuestRooms(stay())).rooms).toHaveLength(1);
    state.broken = true; await expect(searchGuestRooms(stay())).rejects.toThrow();
  });
  it("never selects an inactive plan or guesses an ambiguous mapping", async () => {
    state.active = false; expect((await searchGuestRooms(stay())).rooms[0].rates).toEqual([]);
    state.active = true; state.ambiguous = true; expect((await searchGuestRooms(stay())).rooms[0].rates).toEqual([]);
  });
});
