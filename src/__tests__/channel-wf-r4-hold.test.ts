import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  addCalendarDays,
  computeNightAvailability,
  countUnassignedOtaRooms,
  exclusiveEndDate,
  explodeUnassignedOtaHolds,
  occupiedNights,
  tagBedsForPicker,
} from "@/lib/inventoryAvailability";

const queries = readFileSync("src/db/queries.ts", "utf8");
const reservations = readFileSync("src/app/api/aiosell/reservations/route.ts", "utf8");
const unassignedUi = readFileSync("src/components/admin/booking-dashboard/UnassignedBookings.tsx", "utf8");
const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
const aiosell = readFileSync("src/lib/aiosell.ts", "utf8");
const inventory = readFileSync("src/lib/inventoryAvailability.ts", "utf8");

const roomCountSql = queries.match(
  /export async function getUnassignedOtaRoomCountForDorm[\s\S]*?\nexport async function getUnassignedOtaHoldsForRange/,
)?.[0] ?? "";
const holdsSql = queries.match(
  /export async function getUnassignedOtaHoldsForRange[\s\S]*?\nexport async function checkBedAvailability/,
)?.[0] ?? "";
const autoAssignFn = reservations.match(/async function tryAutoAssignChannelBeds[\s\S]*?\nasync function /)?.[0]
  ?? reservations.match(/async function tryAutoAssignChannelBeds[\s\S]*$/)?.[0]
  ?? "";
const countFn = inventory.match(/export function countUnassignedOtaRooms[\s\S]*?\nexport type UnassignedOtaHold/)?.[0] ?? "";
const explodeFn = inventory.match(/export function explodeUnassignedOtaHolds[\s\S]*?\n\/\*\*/)?.[0] ?? "";

const EXEC = 8;
const DORM = 9;
const mappings = [
  { dormId: EXEC, channelRoomCode: "executive" },
  { dormId: DORM, channelRoomCode: "dorm-6" },
];

function rawRooms(rooms: Array<{ roomCode?: string; occupancy?: { adults?: number; children?: number } }>) {
  return JSON.stringify({ rooms });
}

function cmRow(over: {
  id?: number;
  checkinDate?: string;
  checkoutDate?: string | null;
  roomType?: string | null;
  rawData?: string | null;
} = {}) {
  return {
    id: 42,
    checkinDate: "2026-09-05",
    checkoutDate: "2026-09-07",
    roomType: "executive",
    rawData: rawRooms([{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }]),
    ...over,
  };
}

/** Mirrors getUnassignedOta* SQL CASE exclusive end (queries.ts). */
function sqlExclusiveEnd(checkin: string, checkout: string | null | undefined): string {
  if (checkout == null || checkout === "" || checkout <= checkin) {
    return addCalendarDays(checkin, 1);
  }
  return checkout;
}

function sqlCountOverlapsNight(checkin: string, checkout: string | null | undefined, date: string): boolean {
  return checkin <= date && sqlExclusiveEnd(checkin, checkout) > date;
}

function sqlRangeSelectsRow(
  checkin: string,
  checkout: string | null | undefined,
  startDate: string,
  endExclusive: string,
): boolean {
  return checkin < endExclusive && sqlExclusiveEnd(checkin, checkout) > startDate;
}

/** Mirrors booking-level NOT EXISTS (any online assignment drops the whole row). */
function sqlHoldRows<T extends { id?: number }>(
  rows: T[],
  assignments: Array<{ bookingId: number; status?: string; inventoryPool?: string | null }>,
): T[] {
  const released = new Set(
    assignments
      .filter((a) => (a.status ?? "assigned") === "assigned" && (a.inventoryPool ?? "online") === "online")
      .map((a) => a.bookingId),
  );
  return rows.filter((r) => r.id == null || !released.has(r.id));
}

function executiveBeds() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    dormId: EXEC,
    bedId: `EXE-${i + 1}`,
  }));
}

describe("SQL exclusive end vs occupiedNights vs exclusiveEndDate (empty checkout)", () => {
  it("empty string, null, and missing checkout are one night in SQL and occupiedNights", () => {
    for (const co of ["", null, undefined] as const) {
      expect(occupiedNights("2026-09-05", co)).toEqual(["2026-09-05"]);
      expect(sqlExclusiveEnd("2026-09-05", co)).toBe("2026-09-06");
      expect(exclusiveEndDate("2026-09-05", co ?? "")).toBe("2026-09-06");
      expect(sqlCountOverlapsNight("2026-09-05", co, "2026-09-05")).toBe(true);
      expect(sqlCountOverlapsNight("2026-09-05", co, "2026-09-06")).toBe(false);
      expect(sqlRangeSelectsRow("2026-09-05", co, "2026-09-05", "2026-09-06")).toBe(true);
      expect(sqlRangeSelectsRow("2026-09-05", co, "2026-09-06", "2026-09-07")).toBe(false);
    }
  });

  it("explode empty/null checkout holds only the check-in night (matches SQL overlap)", () => {
    for (const co of ["", null] as const) {
      const row = cmRow({ checkoutDate: co });
      expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-07")).toEqual([
        { dormId: EXEC, date: "2026-09-05", rooms: 1 },
      ]);
      expect(sqlRangeSelectsRow(row.checkinDate, co, "2026-09-05", "2026-09-07")).toBe(true);
      expect(sqlCountOverlapsNight(row.checkinDate, co, "2026-09-05")).toBe(true);
      expect(sqlCountOverlapsNight(row.checkinDate, co, "2026-09-06")).toBe(false);
    }
  });

  it("month wrap and year wrap empty checkout still match addCalendarDays / occupiedNights", () => {
    expect(sqlExclusiveEnd("2026-09-30", "")).toBe("2026-10-01");
    expect(occupiedNights("2026-09-30", "")).toEqual(["2026-09-30"]);
    expect(sqlCountOverlapsNight("2026-09-30", "", "2026-10-01")).toBe(false);
    expect(sqlExclusiveEnd("2026-12-31", null)).toBe("2027-01-01");
    expect(occupiedNights("2026-12-31", null)).toEqual(["2026-12-31"]);
    expect(sqlRangeSelectsRow("2026-12-31", "", "2027-01-01", "2027-01-02")).toBe(false);
    expect(sqlExclusiveEnd("2028-02-29", "")).toBe("2028-03-01");
  });

  it("equal CI=CO is one night in SQL, occupiedNights, exclusiveEndDate, and explode", () => {
    expect(occupiedNights("2026-09-30", "2026-09-30")).toEqual(["2026-09-30"]);
    expect(sqlExclusiveEnd("2026-09-30", "2026-09-30")).toBe("2026-10-01");
    expect(exclusiveEndDate("2026-09-30", "2026-09-30")).toBe("2026-10-01");
    expect(explodeUnassignedOtaHolds(
      [cmRow({ checkinDate: "2026-09-30", checkoutDate: "2026-09-30" })],
      mappings, "2026-09-30", "2026-10-02",
    )).toEqual([{ dormId: EXEC, date: "2026-09-30", rooms: 1 }]);
  });

  it("inverted checkout: SQL and occupiedNights hold one night; exclusiveEndDate is null (auto-assign/Unassigned refuse)", () => {
    expect(occupiedNights("2026-09-05", "2026-09-01")).toEqual(["2026-09-05"]);
    expect(sqlExclusiveEnd("2026-09-05", "2026-09-01")).toBe("2026-09-06");
    expect(sqlCountOverlapsNight("2026-09-05", "2026-09-01", "2026-09-05")).toBe(true);
    expect(exclusiveEndDate("2026-09-05", "2026-09-01")).toBeNull();
    expect(explodeUnassignedOtaHolds(
      [cmRow({ checkoutDate: "2026-09-01" })],
      mappings, "2026-09-05", "2026-09-07",
    )).toEqual([{ dormId: EXEC, date: "2026-09-05", rooms: 1 }]);
  });

  it("both hold SQL CASE arms treat NULL, empty string, and checkout <= checkin as date(checkin, '+1 day')", () => {
    for (const src of [roomCountSql, holdsSql]) {
      expect(src).toContain("checkoutDate} IS NULL");
      expect(src).toContain("checkoutDate} = ''");
      expect(src).toContain("checkoutDate} <= ${bookings.checkinDate}");
      expect(src).toContain("date(${bookings.checkinDate}, '+1 day')");
    }
  });
});

describe("countUnassignedOtaRooms: rooms not persons; rooms[] vs roomType fallback", () => {
  it("3 persons / 1 room and children occupancy still hold 1", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: rawRooms([{ roomCode: "executive", occupancy: { adults: 2, children: 1 } }]),
    }])).toBe(1);
  });

  it("stored webhook payload (full ReservationPayload JSON) still counts rooms, not persons", () => {
    const payload = {
      action: "book",
      hotelCode: "GOKO-001",
      bookingId: "BK-R4",
      rooms: [{
        roomCode: "executive",
        rateplanCode: "executive-s-ep",
        guestName: "Ada",
        occupancy: { adults: 2, children: 0 },
        prices: [{ date: "2026-09-05", sellRate: 3700 }],
      }],
    };
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: JSON.stringify(payload),
    }])).toBe(1);
  });

  it("empty rooms[] falls back to comma-separated roomType", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: JSON.stringify({ rooms: [] }),
    }])).toBe(1);
  });

  it("missing rooms / null JSON / {} fall back to roomType", () => {
    expect(countUnassignedOtaRooms(["executive"], [{ roomType: "executive", rawData: "" }])).toBe(1);
    expect(countUnassignedOtaRooms(["executive"], [{ roomType: "executive", rawData: "null" }])).toBe(1);
    expect(countUnassignedOtaRooms(["executive"], [{ roomType: "executive", rawData: "{}" }])).toBe(1);
  });

  it("non-empty rooms[] with no roomCode skips roomType fallback (hold 0)", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: rawRooms([{ occupancy: { adults: 2, children: 0 } }]),
    }])).toBe(0);
  });

  it("non-empty rooms[] with an unmatched roomCode skips roomType fallback", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: rawRooms([{ roomCode: "penthouse", occupancy: { adults: 1, children: 0 } }]),
    }])).toBe(0);
  });

  it("mixed matching + missing roomCode counts only the matching rooms (no extra roomType fallback)", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive, dorm-6",
      rawData: rawRooms([
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { occupancy: { adults: 1, children: 0 } },
      ]),
    }])).toBe(1);
  });

  it("countUnassignedOtaRooms continues after a non-empty rooms[] (no roomType fallback path)", () => {
    expect(countFn).toContain("if (Array.isArray(rooms) && rooms.length > 0)");
    expect(countFn).toContain("continue;");
    expect(countFn).toContain("for (const part of (b.roomType || \"\").split(\",\"))");
  });
});

describe("explodeUnassignedOtaHolds: mixed codes + excludeBookingId", () => {
  const mixed = cmRow({
    id: 42,
    roomType: "executive, dorm-6",
    rawData: rawRooms([
      { roomCode: "Executive", occupancy: { adults: 2, children: 0 } },
      { roomCode: "Dorm-6", occupancy: { adults: 1, children: 0 } },
    ]),
  });

  it("case-insensitive mixed codes split onto mapped dorms for each occupied night", () => {
    expect(explodeUnassignedOtaHolds([mixed], mappings, "2026-09-05", "2026-09-07")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
      { dormId: DORM, date: "2026-09-05", rooms: 1 },
      { dormId: EXEC, date: "2026-09-06", rooms: 1 },
      { dormId: DORM, date: "2026-09-06", rooms: 1 },
    ]);
  });

  it("excludeBookingId drops the mixed stay on every mapped dorm, leaving the other booking", () => {
    const other = cmRow({ id: 99, checkoutDate: "2026-09-06" });
    expect(explodeUnassignedOtaHolds([mixed, other], mappings, "2026-09-05", "2026-09-06", 42)).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
    expect(explodeUnassignedOtaHolds([mixed], mappings, "2026-09-05", "2026-09-07", 42)).toEqual([]);
  });

  it("empty checkout + excludeBookingId restores the single held night", () => {
    const self = cmRow({ id: 42, checkoutDate: "" });
    expect(explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-07")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
    expect(explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-07", 42)).toEqual([]);
  });

  it("a row without id is not dropped by excludeBookingId (strict ===)", () => {
    const { id: _id, ...noId } = cmRow();
    expect(explodeUnassignedOtaHolds([noId], mappings, "2026-09-05", "2026-09-06", 42)).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
  });

  it("unmapped extra roomCode is ignored; mapped rooms still hold", () => {
    const row = cmRow({
      roomType: "executive, penthouse",
      rawData: rawRooms([
        { roomCode: "executive" },
        { roomCode: "penthouse" },
      ]),
    });
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-06")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
  });

  it("range clip: 3-night mixed stay queried for the middle night holds both dorms once", () => {
    const row = cmRow({
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      roomType: "executive, dorm-6",
      rawData: rawRooms([{ roomCode: "executive" }, { roomCode: "dorm-6" }]),
    });
    expect(sqlRangeSelectsRow("2026-09-05", "2026-09-08", "2026-09-06", "2026-09-07")).toBe(true);
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-06", "2026-09-07")).toEqual([
      { dormId: EXEC, date: "2026-09-06", rooms: 1 },
      { dormId: DORM, date: "2026-09-06", rooms: 1 },
    ]);
  });
});

describe("Booking-level NOT EXISTS: any online assignment drops the whole hold", () => {
  const mixed = cmRow({
    id: 42,
    roomType: "executive, dorm-6",
    rawData: rawRooms([{ roomCode: "executive" }, { roomCode: "dorm-6" }]),
  });

  it("1 online assignment on a 2-room mixed stay over-releases the unassigned dorm room", () => {
    const kept = sqlHoldRows([mixed], [
      { bookingId: 42, status: "assigned", inventoryPool: "online" },
    ]);
    expect(kept).toEqual([]);
    expect(explodeUnassignedOtaHolds(kept, mappings, "2026-09-05", "2026-09-07")).toEqual([]);
  });

  it("offline-only assignment does not release — both rooms still hold", () => {
    const kept = sqlHoldRows([mixed], [
      { bookingId: 42, status: "assigned", inventoryPool: "offline" },
    ]);
    expect(kept).toEqual([mixed]);
    expect(explodeUnassignedOtaHolds(kept, mappings, "2026-09-05", "2026-09-06")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
      { dormId: DORM, date: "2026-09-05", rooms: 1 },
    ]);
  });

  it("2 executive rooms + 1 online assignment drops the whole 2-room hold", () => {
    const twoExec = cmRow({
      id: 7,
      roomType: "executive, executive",
      rawData: rawRooms([{ roomCode: "executive" }, { roomCode: "executive" }]),
    });
    expect(countUnassignedOtaRooms(["executive"], [twoExec])).toBe(2);
    const kept = sqlHoldRows([twoExec], [
      { bookingId: 7, status: "assigned", inventoryPool: "online" },
    ]);
    expect(explodeUnassignedOtaHolds(kept, mappings, "2026-09-05", "2026-09-06")).toEqual([]);
  });

  it("null inventory_pool coalesces to online and releases", () => {
    expect(sqlHoldRows([cmRow({ id: 42 })], [
      { bookingId: 42, status: "assigned", inventoryPool: null },
    ])).toEqual([]);
  });

  it("unassigned status does not release; another booking's online assign does not release this one", () => {
    const self = cmRow({ id: 42 });
    const other = cmRow({ id: 99 });
    expect(sqlHoldRows([self, other], [
      { bookingId: 42, status: "unassigned", inventoryPool: "online" },
      { bookingId: 99, status: "assigned", inventoryPool: "online" },
    ])).toEqual([self]);
  });

  it("explode itself is assignment-blind — SQL NOT EXISTS is what drops the row", () => {
    expect(explodeFn).not.toContain("inventoryPool");
    expect(explodeFn).not.toContain("NOT EXISTS");
    expect(roomCountSql).toContain("NOT EXISTS");
    expect(holdsSql).toContain("NOT EXISTS");
    expect(roomCountSql).not.toContain("countUnassignedOtaRooms(codes, rows.filter");
    expect(holdsSql).not.toMatch(/rooms\s*-\s*1/);
  });
});

describe("Picker: empty checkout 2p/1 room holds 1; excludeBookingId restores it", () => {
  const beds = executiveBeds();
  const override5 = [{ dormId: EXEC, date: "2026-09-05", onlineAvailable: 5, channelId: null }];

  it("empty checkout 2-person sold room holds 1 online slot", () => {
    const self = cmRow({ checkoutDate: "" });
    const holds = explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-06");
    expect(holds).toEqual([{ dormId: EXEC, date: "2026-09-05", rooms: 1 }]);
    const snap = computeNightAvailability(EXEC, "2026-09-05", beds, [], [], override5, 1);
    expect(snap.online).toBe(4);
    const tagged = tagBedsForPicker(beds, [], beds, ["2026-09-05"], [], [], override5, holds);
    expect(tagged.filter((b) => b.pool === "online")).toHaveLength(4);
  });

  it("webhook excludeBookingId restores the ceiling; staff path without it keeps the hold", () => {
    const self = cmRow({ id: 42, checkoutDate: "" });
    const taggedHeld = tagBedsForPicker(
      beds, [], beds, ["2026-09-05"], [], [], override5,
      explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-06"),
    );
    const taggedFree = tagBedsForPicker(
      beds, [], beds, ["2026-09-05"], [], [], override5,
      explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-06", 42),
    );
    expect(taggedHeld.filter((b) => b.pool === "online")).toHaveLength(4);
    expect(taggedFree.filter((b) => b.pool === "online")).toHaveLength(5);
  });
});

describe("Source-read: excludeBookingId, room count vs persons, Aiosell rooms[]", () => {
  it("getUnassignedOtaHoldsForRange forwards excludeBookingId; getUnassignedOtaRoomCountForDorm cannot", () => {
    expect(holdsSql).toContain("excludeBookingId?: number");
    expect(holdsSql).toContain("explodeUnassignedOtaHolds(rows, mappings, startDate, endExclusive, excludeBookingId)");
    expect(roomCountSql).not.toContain("excludeBookingId");
    expect(roomCountSql).toContain("countUnassignedOtaRooms(codes, rows)");
    expect(roomCountSql).not.toContain("persons");
  });

  it("webhook and Unassigned paths pass the correct current booking id", () => {
    expect(autoAssignFn).toContain("getAvailableBedsForRange(checkin, co, undefined, bookingId)");
    expect(autoAssignFn).toContain("refreshTagged: loadTagged");
    const payload = unassignedUi.match(/payload: Record<string, unknown> = \{[^}]+\}/)?.[0] ?? "";
    expect(payload).toContain('action: "getAvailableBeds"');
    expect(payload).toContain("bookingId: booking.id");
    expect(bookingsRoute).toContain("getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId)");
  });

  it("parseReservationPayload does not require rooms[].roomCode; typed Aiosell rooms include roomCode", () => {
    expect(aiosell).toContain("if (!data.hotelCode || !data.bookingId) return null;");
    expect(aiosell).not.toContain("if (!data.rooms)");
    expect(aiosell).toMatch(/rooms\?: Array<\{[\s\S]*?roomCode: string;/);
  });
});
