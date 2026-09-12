import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  computeNightAvailability,
  countUnassignedOtaRooms,
  explodeUnassignedOtaHolds,
  occupiedNights,
  tagBedsForPicker,
} from "@/lib/inventoryAvailability";

const queries = readFileSync("src/db/queries.ts", "utf8");
const reservations = readFileSync("src/app/api/aiosell/reservations/route.ts", "utf8");
const unassignedUi = readFileSync("src/components/admin/booking-dashboard/UnassignedBookings.tsx", "utf8");
const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");

const roomCountSql = queries.match(
  /export async function getUnassignedOtaRoomCountForDorm[\s\S]*?\nexport async function getUnassignedOtaHoldsForRange/,
)?.[0] ?? "";
const holdsSql = queries.match(
  /export async function getUnassignedOtaHoldsForRange[\s\S]*?\nexport async function checkBedAvailability/,
)?.[0] ?? "";
const autoAssignFn = reservations.match(/async function tryAutoAssignChannelBeds[\s\S]*?\nasync function /)?.[0]
  ?? reservations.match(/async function tryAutoAssignChannelBeds[\s\S]*$/)?.[0]
  ?? "";
const assignTagged = bookingsRoute.match(/async function assignTaggedBeds[\s\S]*?\nfunction assignFailed/)?.[0] ?? "";
const getAvailableBedsAction = bookingsRoute.match(
  /action === "getAvailableBeds"[\s\S]*?action === "getBookingHistory"/,
)?.[0] ?? "";

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

/** Mirrors exclusiveEndDate used by getUnassignedOta* SQL. */
function sqlExclusiveEnd(checkin: string, checkout: string | null | undefined): string {
  if (checkout && checkout > checkin) return checkout;
  const [y, m, d] = checkin.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Mirrors getUnassignedOtaRoomCountForDorm WHERE (queries.ts date predicate). */
function sqlCountOverlapsNight(checkin: string, checkout: string | null | undefined, date: string): boolean {
  return checkin <= date && sqlExclusiveEnd(checkin, checkout) > date;
}

/** Mirrors getUnassignedOtaHoldsForRange WHERE (queries.ts range predicate). */
function sqlRangeSelectsRow(
  checkin: string,
  checkout: string | null | undefined,
  startDate: string,
  endExclusive: string,
): boolean {
  return checkin < endExclusive && sqlExclusiveEnd(checkin, checkout) > startDate;
}

function executiveBeds() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    dormId: EXEC,
    bedId: `EXE-${i + 1}`,
  }));
}

describe("countUnassignedOtaRooms: rooms not persons", () => {
  it("2 persons in 1 executive room still holds 1", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: rawRooms([{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }]),
    }])).toBe(1);
  });

  it("2 executive rooms hold 2 even when persons is 2", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive, executive",
      rawData: rawRooms([
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
      ]),
    }])).toBe(2);
  });

  it("mixed room codes hold only the mapped code, case-insensitively", () => {
    const booking = {
      roomType: "Executive, Dorm-6",
      rawData: rawRooms([
        { roomCode: "Executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "Dorm-6", occupancy: { adults: 1, children: 0 } },
      ]),
    };
    expect(countUnassignedOtaRooms(["executive"], [booking])).toBe(1);
    expect(countUnassignedOtaRooms(["dorm-6"], [booking])).toBe(1);
    expect(countUnassignedOtaRooms(["executive", "dorm-6"], [booking])).toBe(2);
    expect(countUnassignedOtaRooms(["penthouse"], [booking])).toBe(0);
  });

  it("falls back to comma-separated roomType when rooms[] is missing", () => {
    expect(countUnassignedOtaRooms(["executive", "dorm-6"], [
      { roomType: " Executive , Dorm-6 ", rawData: "" },
    ])).toBe(2);
  });

  it("rooms[] with no matching roomCode does not fall back to roomType", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: rawRooms([{ occupancy: { adults: 2, children: 0 } }]),
    }])).toBe(0);
  });

  it("invalid JSON rawData falls back to roomType", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: "{not-json",
    }])).toBe(1);
  });
});

describe("explodeUnassignedOtaHolds: nights, mixed codes, excludeBookingId", () => {
  it("places a 2-person 1-room stay as 1 room on each occupied night", () => {
    expect(explodeUnassignedOtaHolds([cmRow()], mappings, "2026-09-05", "2026-09-07")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
      { dormId: EXEC, date: "2026-09-06", rooms: 1 },
    ]);
  });

  it("splits mixed room codes onto their mapped dorms", () => {
    const row = cmRow({
      roomType: "executive, dorm-6",
      rawData: rawRooms([
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
      ]),
    });
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-06")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
      { dormId: DORM, date: "2026-09-05", rooms: 1 },
    ]);
  });

  it("excludeBookingId drops that stay's hold so webhook auto-assign can take its online slots", () => {
    const self = cmRow({ id: 42 });
    const other = cmRow({ id: 99 });
    expect(explodeUnassignedOtaHolds([self, other], mappings, "2026-09-05", "2026-09-07", 42)).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
      { dormId: EXEC, date: "2026-09-06", rooms: 1 },
    ]);
    expect(explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-07", 42)).toEqual([]);
  });

  it("equal CI=CO is one occupied night in explode (occupiedNights)", () => {
    const row = cmRow({ checkinDate: "2026-09-05", checkoutDate: "2026-09-05" });
    expect(occupiedNights("2026-09-05", "2026-09-05")).toEqual(["2026-09-05"]);
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-06")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
  });

  it("has no status field — a cancelled-looking row still holds if the caller did not filter", () => {
    const row = cmRow({ id: 7 });
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-09-05", "2026-09-06")).toEqual([
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
  });
});

describe("SQL hold overlap vs occupiedNights", () => {
  it("missing checkout: SQL and occupiedNights both hold the check-in night", () => {
    expect(occupiedNights("2026-09-05", "")).toEqual(["2026-09-05"]);
    expect(sqlCountOverlapsNight("2026-09-05", "", "2026-09-05")).toBe(true);
    expect(sqlRangeSelectsRow("2026-09-05", "", "2026-09-05", "2026-09-06")).toBe(true);
  });

  it("normal exclusive checkout: SQL and occupiedNights agree", () => {
    expect(occupiedNights("2026-09-05", "2026-09-07")).toEqual(["2026-09-05", "2026-09-06"]);
    expect(sqlCountOverlapsNight("2026-09-05", "2026-09-07", "2026-09-05")).toBe(true);
    expect(sqlCountOverlapsNight("2026-09-05", "2026-09-07", "2026-09-06")).toBe(true);
    expect(sqlCountOverlapsNight("2026-09-05", "2026-09-07", "2026-09-07")).toBe(false);
    expect(sqlRangeSelectsRow("2026-09-05", "2026-09-07", "2026-09-05", "2026-09-07")).toBe(true);
  });

  it("equal CI=CO: SQL matches occupiedNights (one night)", () => {
    expect(occupiedNights("2026-09-05", "2026-09-05")).toEqual(["2026-09-05"]);
    expect(sqlCountOverlapsNight("2026-09-05", "2026-09-05", "2026-09-05")).toBe(true);
    expect(sqlCountOverlapsNight("2026-09-05", "2026-09-05", "2026-09-06")).toBe(false);
    expect(sqlRangeSelectsRow("2026-09-05", "2026-09-05", "2026-09-05", "2026-09-06")).toBe(true);
    expect(sqlRangeSelectsRow("2026-09-05", "2026-09-05", "2026-09-04", "2026-09-06")).toBe(true);
    expect(sqlRangeSelectsRow("2026-09-05", "2026-09-05", "2026-09-06", "2026-09-07")).toBe(false);
  });
});

describe("Picker: 2 persons / 1 room holds 1 online slot; excludeBookingId restores it", () => {
  const beds = executiveBeds();
  const override5 = [{ dormId: EXEC, date: "2026-09-05", onlineAvailable: 5, channelId: null }];

  it("a 2-person sold room holds 1 OTA slot so 4 online chips remain", () => {
    const snap = computeNightAvailability(EXEC, "2026-09-05", beds, [], [], override5, 1);
    expect(snap.unassignedOta).toBe(1);
    expect(snap.online).toBe(4);
    const tagged = tagBedsForPicker(beds, [], beds, ["2026-09-05"], [], [], override5, [
      { dormId: EXEC, date: "2026-09-05", rooms: 1 },
    ]);
    expect(tagged.filter((b) => b.pool === "online")).toHaveLength(4);
  });

  it("excluding the booking's own hold restores the full online ceiling", () => {
    const self = cmRow({ id: 42, checkoutDate: "2026-09-06" });
    const without = explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-06");
    const withExclude = explodeUnassignedOtaHolds([self], mappings, "2026-09-05", "2026-09-06", 42);
    expect(without).toEqual([{ dormId: EXEC, date: "2026-09-05", rooms: 1 }]);
    expect(withExclude).toEqual([]);
    const taggedHeld = tagBedsForPicker(beds, [], beds, ["2026-09-05"], [], [], override5, without);
    const taggedFree = tagBedsForPicker(beds, [], beds, ["2026-09-05"], [], [], override5, withExclude);
    expect(taggedHeld.filter((b) => b.pool === "online")).toHaveLength(4);
    expect(taggedFree.filter((b) => b.pool === "online")).toHaveLength(5);
  });
});

describe("Source-read: online-only release, cancelled filter, webhook vs Unassigned", () => {
  it("hold SQL still counts the sold room until an ONLINE assignment exists", () => {
    expect(roomCountSql).toContain("countUnassignedOtaRooms");
    expect(roomCountSql).toContain("eq(bookings.source, \"channel_manager\")");
    expect(roomCountSql).toContain("coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'");
    expect(holdsSql).toContain("explodeUnassignedOtaHolds(rows, mappings, startDate, endExclusive, excludeBookingId)");
    expect(holdsSql).toContain("coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'");
    expect(holdsSql).toContain("excludeBookingId?: number");
    expect(holdsSql).not.toMatch(/inventoryPool}, 'online'\) = 'offline'/);
  });

  it("cancelled / checked_out / no_show stays are excluded from both hold queries", () => {
    expect(roomCountSql).toContain("NOT IN ('cancelled', 'checked_out', 'no_show')");
    expect(holdsSql).toContain("NOT IN ('cancelled', 'checked_out', 'no_show')");
  });

  it("release is booking-level NOT EXISTS (any online assignment drops the whole hold, including mixed rooms)", () => {
    expect(roomCountSql).toContain("NOT EXISTS");
    expect(holdsSql).toContain("NOT EXISTS");
    expect(roomCountSql).not.toContain("countUnassignedOtaRooms(codes, rows.filter");
  });

  it("getUnassignedOta* SQL uses exclusiveEndDate (equal CI=CO is one night)", () => {
    expect(roomCountSql).toContain("date(${bookings.checkinDate}, '+1 day')");
    expect(roomCountSql).toContain("checkoutDate} <= ${bookings.checkinDate}");
    expect(holdsSql).toContain("date(${bookings.checkinDate}, '+1 day')");
    expect(holdsSql).toContain("checkoutDate} <= ${bookings.checkinDate}");
  });

  it("webhook tryAutoAssignChannelBeds passes excludeBookingId; refresh uses the same loader", () => {
    expect(autoAssignFn).toContain("getAvailableBedsForRange(checkin, co, undefined, bookingId)");
    expect(autoAssignFn).toContain("refreshTagged: loadTagged");
    expect(autoAssignFn).not.toMatch(/getAvailableBedsForRange\(checkin, co\)\s*;/);
  });

  it("staff Unassigned getAvailableBeds payload passes bookingId", () => {
    const payload = unassignedUi.match(/payload: Record<string, unknown> = \{[^}]+\}/)?.[0] ?? "";
    expect(payload).toContain('action: "getAvailableBeds"');
    expect(payload).toContain("checkinDate, checkoutDate");
    expect(payload).toContain("bookingId: booking.id");
  });

  it("admin getAvailableBeds forwards body.bookingId for the Unassigned picker", () => {
    expect(getAvailableBedsAction).toContain("const { checkinDate, checkoutDate, bookingId } = body");
    expect(getAvailableBedsAction).toContain("getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId)");
  });

  it("assignTaggedBeds excludes the current booking so its own hold can be completed", () => {
    expect(assignTagged).toContain("getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId)");
  });
});
