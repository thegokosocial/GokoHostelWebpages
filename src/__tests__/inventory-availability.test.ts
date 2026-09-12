import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyBookingToNight,
  assignmentPool,
  bedsFitInventoryCap,
  bedsFreeToBlock,
  computeNightAvailability,
  exclusiveEndDate,
  exclusiveEndFromInclusive,
  addCalendarDays,
  inclusiveNights,
  civilWeekday,
  occupiedNights,
  pickInventoryOverride,
  remainingSplit,
  otaCeiling,
  countUnassignedOtaRooms,
  explodeUnassignedOtaHolds,
  splitAvailable,
  ceilingFromRemaining,
  heldOnline,
  overrideRemainingInput,
  overridePreview,
  overrideCeilingToSave,
  shouldPushPms,
  stayNights,
  stayNightCount,
  tagBedsForPicker,
  sellableUnits,
} from "@/lib/inventoryAvailability";

const queries = readFileSync("src/db/queries.ts", "utf8");
const route = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
const sync = readFileSync("src/lib/aiosellSync.ts", "utf8");
const reservations = readFileSync("src/app/api/aiosell/reservations/route.ts", "utf8");

function executiveBeds() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    dormId: 2,
    bedId: `EXE-${i + 1}`,
  }));
}

const override5 = [{ dormId: 2, date: "2026-08-31", onlineAvailable: 5, channelId: null }];

describe("double-bed sellable units", () => {
  const doubleBeds = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, dormId: 7, bedId: `DOR-${i + 1}`, type: "Double" }));

  it("groups eight internal slots into four rooms", () => {
    const units = sellableUnits(doubleBeds);
    expect(units).toHaveLength(4);
    expect(units[0]).toMatchObject({ label: "DOUBLE 1", capacity: 2 });
    expect(units[0].beds.map((b) => b.id)).toEqual([1, 2]);
  });

  it("counts a reserved pair as one sold room", () => {
    const snap = computeNightAvailability(7, "2026-09-05", doubleBeds, [], [
      { bedId: 1, dormId: 7, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "online" },
      { bedId: 2, dormId: 7, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "online" },
    ], []);
    expect(snap).toMatchObject({ total: 4, assigned: 1, available: 3, online: 3 });
  });

  it("blocking either internal slot blocks the whole room", () => {
    const snap = computeNightAvailability(7, "2026-09-05", doubleBeds, [
      { bedId: 2, dormId: 7, startDate: "2026-09-05", endDate: "2026-09-06" },
    ], [], []);
    expect(snap).toMatchObject({ total: 4, blocked: 1, available: 3 });
  });

  it("marks both internal slots blocked when either half is blocked", () => {
    const blocks = [{ bedId: 2, dormId: 7, startDate: "2026-09-05", endDate: "2026-09-06" }];
    const tagged = tagBedsForPicker(
      doubleBeds.filter((bed) => bed.id !== 2),
      doubleBeds.filter((bed) => bed.id === 2),
      doubleBeds,
      ["2026-09-05"],
      blocks,
      [],
      [],
    );
    expect(tagged.filter((bed) => bed.id === 1 || bed.id === 2).map((bed) => bed.pool)).toEqual(["block", "block"]);
  });
});

describe("stayNights", () => {
  it("uses exclusive checkout so 31 Aug–1 Sep is one night", () => {
    expect(stayNights("2026-08-31", "2026-09-01")).toEqual(["2026-08-31"]);
    expect(stayNights("2026-08-31", "2026-09-02")).toEqual(["2026-08-31", "2026-09-01"]);
  });
});

describe("stayNightCount", () => {
  it("covers 1-night, multi-night, month wrap, and year wrap", () => {
    expect(stayNightCount("2026-09-05", "2026-09-06")).toBe(1);
    expect(stayNightCount("2026-09-05", "2026-09-08")).toBe(3);
    expect(stayNightCount("2026-08-31", "2026-09-02")).toBe(2);
    expect(stayNightCount("2026-12-30", "2027-01-02")).toBe(3);
    expect(stayNightCount("2026-09-05")).toBe(1);
  });
});

describe("occupiedNights", () => {
  it("does not include the checkout morning, unlike the old +1-day loop", () => {
    expect(occupiedNights("2026-08-31", "2026-09-01")).toEqual(["2026-08-31"]);
    expect(occupiedNights("2026-08-31", "2026-09-02")).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("treats a missing checkout as a single night", () => {
    expect(occupiedNights("2026-08-31")).toEqual(["2026-08-31"]);
    expect(occupiedNights("2026-08-31", "2026-08-31")).toEqual(["2026-08-31"]);
  });
});

describe("countUnassignedOtaRooms", () => {
  it("counts matching rooms from rawData, not persons", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "executive",
      rawData: JSON.stringify({
        rooms: [
          { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
          { roomCode: "suite", occupancy: { adults: 1, children: 0 } },
        ],
      }),
    }])).toBe(1);
  });

  it("matches room codes case-insensitively like auto-assign", () => {
    expect(countUnassignedOtaRooms(["executive"], [{
      roomType: "Executive",
      rawData: JSON.stringify({ rooms: [{ roomCode: "Executive" }] }),
    }])).toBe(1);
  });

  it("falls back to comma-separated roomType when prices/rooms are missing", () => {
    expect(countUnassignedOtaRooms(["executive", "dorm-1"], [
      { roomType: "executive, dorm-1", rawData: "" },
    ])).toBe(2);
  });
});

describe("explodeUnassignedOtaHolds", () => {
  const mappings = [{ dormId: 9, channelRoomCode: "executive" }];
  const row = {
    id: 114,
    checkinDate: "2026-08-31",
    checkoutDate: "2026-09-01",
    roomType: "executive",
    rawData: JSON.stringify({ rooms: [{ roomCode: "executive" }] }),
  };

  it("places a 1-night unassigned OTA stay on that dorm/date", () => {
    expect(explodeUnassignedOtaHolds([row], mappings, "2026-08-31", "2026-09-03")).toEqual([
      { dormId: 9, date: "2026-08-31", rooms: 1 },
    ]);
  });

  it("excludes the booking being assigned so chips still exist", () => {
    expect(explodeUnassignedOtaHolds([row, { ...row, id: 113 }], mappings, "2026-08-31", "2026-09-01", 114)).toEqual([
      { dormId: 9, date: "2026-08-31", rooms: 1 },
    ]);
  });
});

describe("exclusiveEndDate", () => {
  it("fills a missing or equal end as start + 1 day", () => {
    expect(exclusiveEndDate("2026-09-02")).toBe("2026-09-03");
    expect(exclusiveEndDate("2026-09-02", "")).toBe("2026-09-03");
    expect(exclusiveEndDate("2026-09-02", "2026-09-02")).toBe("2026-09-03");
    expect(exclusiveEndDate("2026-09-02", "2026-09-04")).toBe("2026-09-04");
    expect(exclusiveEndDate("2026-09-02", "2026-09-01")).toBeNull();
    expect(exclusiveEndDate("")).toBeNull();
  });
});

describe("exclusiveEndFromInclusive: bulk dates include both nights", () => {
  it("1 Sep–2 Sep covers both nights (exclusive end 3 Sep)", () => {
    expect(exclusiveEndFromInclusive("2026-09-01", "2026-09-02")).toBe("2026-09-03");
    expect(stayNights("2026-09-01", "2026-09-03")).toEqual(["2026-09-01", "2026-09-02"]);
    expect(addCalendarDays("2026-09-01", 1)).toBe("2026-09-02");
  });

  it("addCalendarDays and inclusiveNights do not depend on the host timezone", () => {
    expect(addCalendarDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(inclusiveNights("2026-08-30", "2026-08-31")).toEqual(["2026-08-30", "2026-08-31"]);
    expect(civilWeekday("2026-08-30")).toBe(0);
    expect(civilWeekday("2026-08-31")).toBe(1);
  });

  it("same start and end is one night", () => {
    expect(exclusiveEndFromInclusive("2026-08-31", "2026-08-31")).toBe("2026-09-01");
    expect(stayNights("2026-08-31", "2026-09-01")).toEqual(["2026-08-31"]);
  });
});

describe("bedsFreeToBlock: hide booked and already-blocked", () => {
  const beds = executiveBeds();

  it("on 2 Sept with 2 EXECUTIVE beds booked, offers the other 10", () => {
    const assignments = [
      { bedId: 1, checkinDate: "2026-09-02", checkoutDate: "2026-09-03", status: "assigned" },
      { bedId: 2, checkinDate: "2026-09-01", checkoutDate: "2026-09-04", status: "assigned" },
    ];
    const free = bedsFreeToBlock(beds, "2026-09-02", "2026-09-03", assignments, []);
    expect(free.map((b) => b.bedId)).toEqual(beds.slice(2).map((b) => b.bedId));
    expect(free).toHaveLength(10);
  });

  it("hides a bed that is already blocked for that night", () => {
    const blocks = [{ bedId: 3, startDate: "2026-09-02", endDate: "2026-09-03" }];
    const free = bedsFreeToBlock(beds, "2026-09-02", "2026-09-03", [], blocks);
    expect(free.map((b) => b.id)).not.toContain(3);
    expect(free).toHaveLength(11);
  });

  it("does not hide a bed that checks out the morning the block starts", () => {
    const assignments = [
      { bedId: 1, checkinDate: "2026-09-01", checkoutDate: "2026-09-02", status: "assigned" },
    ];
    const free = bedsFreeToBlock(beds, "2026-09-02", "2026-09-03", assignments, []);
    expect(free.map((b) => b.id)).toContain(1);
    expect(free).toHaveLength(12);
  });

  it("ignores cancelled assignments and returns none until dates are a real range", () => {
    const assignments = [
      { bedId: 1, checkinDate: "2026-09-02", checkoutDate: "2026-09-03", status: "cancelled" },
    ];
    expect(bedsFreeToBlock(beds, "2026-09-02", "2026-09-03", assignments, [])).toHaveLength(12);
    expect(bedsFreeToBlock(beds, "2026-09-02", "2026-09-02", [], [])).toEqual([]);
    expect(bedsFreeToBlock(beds, "", "2026-09-03", [], [])).toEqual([]);
  });

  it("31st–1st shows min leftover (8), 1st–2nd shows min leftover (10)", () => {
    const assignments = [
      { bedId: 1, checkinDate: "2026-08-31", checkoutDate: "2026-09-01", status: "assigned" },
      { bedId: 2, checkinDate: "2026-08-31", checkoutDate: "2026-09-01", status: "assigned" },
      { bedId: 5, checkinDate: "2026-09-02", checkoutDate: "2026-09-03", status: "assigned" },
    ];
    const blocks = [
      { bedId: 11, startDate: "2026-08-31", endDate: "2026-09-01" },
      { bedId: 12, startDate: "2026-08-31", endDate: "2026-09-01" },
      { bedId: 12, startDate: "2026-09-02", endDate: "2026-09-03" },
    ];
    const end31to1 = exclusiveEndFromInclusive("2026-08-31", "2026-09-01")!;
    expect(bedsFreeToBlock(beds, "2026-08-31", end31to1, assignments, blocks)).toHaveLength(8);
    const end1to2 = exclusiveEndFromInclusive("2026-09-01", "2026-09-02")!;
    expect(bedsFreeToBlock(beds, "2026-09-01", end1to2, assignments, blocks)).toHaveLength(10);
  });
});

describe("tagBedsForPicker pool allocation", () => {
  it("does not let occupied units consume the remaining offline slot", () => {
    const beds = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1, dormId: 16, bedId: `FEM-${i + 1}`, type: "Bunk",
    }));
    const physical = [beds[3]];
    const assignments = [...beds.slice(0, 3), ...beds.slice(4)].map((bed) => ({
      bedId: bed.id, dormId: 16, checkinDate: "2026-09-12", checkoutDate: "2026-09-13", status: "assigned",
    }));
    const tagged = tagBedsForPicker(physical, [], beds, ["2026-09-12"], [], assignments, [
      { dormId: 16, date: "2026-09-12", onlineAvailable: 0 },
    ]);
    expect(tagged.map((bed) => [bed.bedId, bed.pool])).toEqual([
      ["FEM-4", "offline"],
    ]);
  });
});

describe("pickInventoryOverride", () => {
  it("prefers the dorm-wide (null channel) row over a channel-specific one", () => {
    const picked = pickInventoryOverride(
      [
        { dormId: 2, date: "2026-08-31", channelId: 9, onlineAvailable: 2 },
        { dormId: 2, date: "2026-08-31", channelId: null, onlineAvailable: 5 },
      ],
      2,
      "2026-08-31",
    );
    expect(picked?.onlineAvailable).toBe(5);
  });
});

describe("Inventory split: EXECUTIVE 12 beds, 5 online / 7 walk-in", () => {
  const beds = executiveBeds();

  it("starts at 5 OTA and 7 walk-in with 12 physical available", () => {
    const snap = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    expect(snap).toMatchObject({ total: 12, blocked: 0, assigned: 0, available: 12, online: 5, offline: 7, overridden: true });
  });

  it("tags EXE-1..5 as online and EXE-6..12 as walk-in so New Booking shows the 7 offline beds", () => {
    const tagged = tagBedsForPicker(beds, [], beds, ["2026-08-31"], [], [], override5);
    expect(tagged.filter((b) => b.pool === "online").map((b) => b.bedId)).toEqual(["EXE-1", "EXE-2", "EXE-3", "EXE-4", "EXE-5"]);
    expect(tagged.filter((b) => b.pool === "offline")).toHaveLength(7);
    expect(tagged).toHaveLength(12);
  });

  it("holds unassigned OTA against the online ceiling so New Booking cannot resell those rooms", () => {
    const snap = computeNightAvailability(2, "2026-08-31", beds, [], [], override5, 3);
    expect(snap.online).toBe(2);
    expect(snap.offline).toBe(7);
    expect(snap.unassignedOta).toBe(3);
    const tagged = tagBedsForPicker(beds, [], beds, ["2026-08-31"], [], [], override5, [
      { dormId: 2, date: "2026-08-31", rooms: 3 },
    ]);
    expect(tagged.filter((b) => b.pool === "online")).toHaveLength(2);
  });

  it("override modal remaining matches the grid OTA/walk-in split when unassigned OTA holds the ceiling", () => {
    const snap = computeNightAvailability(2, "2026-08-31", beds, [
      { bedId: 10, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" },
      { bedId: 11, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" },
      { bedId: 12, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" },
    ], [], override5, 5);
    expect(snap).toMatchObject({ total: 12, blocked: 3, assigned: 0, available: 4, online: 0, offline: 4, unassignedOta: 5 });
    expect(overrideRemainingInput(snap, 5)).toBe("0");
    expect(overridePreview(snap, NaN)).toEqual({ online: 0, offline: 4 });
    expect(snap.assigned + snap.blocked + snap.unassignedOta + snap.online + snap.offline).toBe(12);
    expect(overrideCeilingToSave(snap, 0)).toBe(5);
    expect(overrideCeilingToSave(snap, 2)).toBe(7);
    expect(remainingSplit(4, 7, heldOnline(snap))).toEqual({ online: 2, offline: 2 });
  });

  it("assigned online beds and unassigned OTA share the ceiling so modal remaining matches the grid", () => {
    const assignments = [{
      dormId: 2, checkinDate: "2026-08-31", checkoutDate: "2026-09-01",
      status: "assigned", inventoryPool: "online" as const,
    }];
    const snap = computeNightAvailability(2, "2026-08-31", beds, [], assignments, override5, 3);
    expect(snap.onlineAssigned).toBe(1);
    expect(snap.unassignedOta).toBe(3);
    expect(heldOnline(snap)).toBe(4);
    expect(snap.online).toBe(1);
    expect(overrideRemainingInput(snap, 5)).toBe("1");
    expect(overridePreview(snap, NaN)).toEqual({ online: snap.online, offline: snap.offline });
    expect(snap.assigned + snap.blocked + snap.unassignedOta + snap.online + snap.offline).toBe(snap.total);
  });

  it("no override: unassigned OTA still drops OTA remaining and empty modal preview matches the grid", () => {
    const snap = computeNightAvailability(2, "2026-08-31", beds, [], [], [], 4);
    expect(snap.overridden).toBe(false);
    expect(snap.online).toBe(8);
    expect(snap.offline).toBe(0);
    expect(overrideRemainingInput(snap, null)).toBe("");
    expect(overridePreview(snap, NaN)).toEqual({ online: 8, offline: 0 });
  });

  it("no override: unblocking returns beds to OTA, not walk-in", () => {
    const assigned = Array.from({ length: 5 }, () => ({
      dormId: 2,
      checkinDate: "2026-08-31",
      checkoutDate: "2026-09-01",
      status: "assigned" as const,
      inventoryPool: "online" as const,
    }));
    const threeBlocked = [10, 11, 12].map((bedId) => ({
      bedId, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01",
    }));
    expect(otaCeiling(12, 3, null)).toBe(9);
    expect(otaCeiling(12, 1, null)).toBe(11);
    expect(otaCeiling(12, 1, 5)).toBe(5);

    const before = computeNightAvailability(2, "2026-08-31", beds, threeBlocked, assigned, [], 4);
    expect(before).toMatchObject({ blocked: 3, assigned: 5, available: 0, online: 0, offline: 0, unassignedOta: 4 });

    const after = computeNightAvailability(2, "2026-08-31", beds, threeBlocked.slice(2), assigned, [], 4);
    expect(after).toMatchObject({ blocked: 1, available: 2, online: 2, offline: 0 });
    expect(after.assigned + after.blocked + after.unassignedOta + after.online + after.offline).toBe(12);
  });
});

describe("Mock workflows", () => {
  const beds = executiveBeds();

  it("walk-in on an offline bed: online stays 5, no PMS push", () => {
    const before = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    const after = applyBookingToNight(before, "offline");
    expect(after.online).toBe(5);
    expect(after.offline).toBe(6);
    expect(after.available).toBe(11);
    expect(shouldPushPms(["offline"])).toBe(false);
  });

  it("walk-in after an unassigned OTA hold keeps the hold on the snapshot", () => {
    const before = computeNightAvailability(2, "2026-08-31", beds, [], [], override5, 3);
    const after = applyBookingToNight(before, "offline");
    expect(after.unassignedOta).toBe(3);
    expect(after.online).toBe(2);
    expect(after.offline).toBe(6);
  });

  it("OTA bed selected: online drops to 4 and PMS should push", () => {
    const before = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    const after = applyBookingToNight(before, "online");
    expect(after.online).toBe(4);
    expect(after.offline).toBe(7);
    expect(shouldPushPms(["online"])).toBe(true);
    expect(shouldPushPms(["offline", "online"])).toBe(true);
  });

  it("blocking 2 beds keeps online at 5 and shrinks walk-in", () => {
    const blocks = [
      { bedId: 11, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" },
      { bedId: 12, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" },
    ];
    const snap = computeNightAvailability(2, "2026-08-31", beds, blocks, [], override5);
    expect(snap.blocked).toBe(2);
    expect(snap.available).toBe(10);
    expect(snap.online).toBe(5);
    expect(snap.offline).toBe(5);
  });

  it("overlapping blocks on the same bed count as one blocked bed", () => {
    const blocks = [
      { bedId: 12, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-02" },
      { bedId: 12, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" },
    ];
    const snap = computeNightAvailability(2, "2026-08-31", beds, blocks, [], override5);
    expect(snap.blocked).toBe(1);
    expect(snap.available).toBe(11);
    expect(snap.online).toBe(5);
    expect(snap.offline).toBe(6);
  });

  it("booking a blocked bed clears the block, online stays 5, no PMS push", () => {
    const blocks = [{ bedId: 12, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" }];
    const before = computeNightAvailability(2, "2026-08-31", beds, blocks, [], override5);
    expect(before.blocked).toBe(1);
    expect(before.online).toBe(5);
    const after = applyBookingToNight(before, "block");
    expect(after.blocked).toBe(0);
    expect(after.assigned).toBe(1);
    expect(after.online).toBe(5);
    expect(after.available).toBe(before.available);
    expect(shouldPushPms(["block"])).toBe(false);
  });

  it("blocked beds appear in the picker as pool=block alongside walk-in beds", () => {
    const blocks = [{ bedId: 12, dormId: 2, startDate: "2026-08-31", endDate: "2026-09-01" }];
    const free = beds.filter((b) => b.id !== 12);
    const blockedOnly = beds.filter((b) => b.id === 12);
    const tagged = tagBedsForPicker(free, blockedOnly, beds, ["2026-08-31"], blocks, [], override5);
    expect(tagged.find((b) => b.bedId === "EXE-12")?.pool).toBe("block");
    expect(tagged.filter((b) => b.pool === "offline").length).toBeGreaterThan(0);
  });

  it("legacy assignments without a pool count as online so existing PMS numbers do not jump up", () => {
    expect(assignmentPool(null)).toBe("online");
    expect(assignmentPool("offline")).toBe("offline");
    const assignments = [{ dormId: 2, checkinDate: "2026-08-31", checkoutDate: "2026-09-01", status: "assigned" }];
    const snap = computeNightAvailability(2, "2026-08-31", beds, [], assignments, override5);
    expect(snap.onlineAssigned).toBe(1);
    expect(snap.online).toBe(4);
  });

  it("rejects beds that are not in the tagged picker list", () => {
    expect(bedsFitInventoryCap([{ id: 99 }], new Set([1, 2]))).toBe("One or more beds are not available for these dates");
    expect(bedsFitInventoryCap([{ id: 1 }], new Set([1, 2]))).toBeNull();
  });

  it("mixed online + walk-in selection pushes because an OTA bed was taken", () => {
    let snap = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    snap = applyBookingToNight(snap, "offline");
    const beforeOnline = snap.online;
    snap = applyBookingToNight(snap, "online");
    expect(shouldPushPms(["offline", "online"], { online: beforeOnline }, snap)).toBe(true);
    expect(snap.online).toBe(4);
    expect(snap.offline).toBe(6);
  });

  it("multi-night stay tags only the min OTA slots across nights as online", () => {
    const overrides = [
      { dormId: 2, date: "2026-08-31", onlineAvailable: 5, channelId: null },
      { dormId: 2, date: "2026-09-01", onlineAvailable: 2, channelId: null },
    ];
    const tagged = tagBedsForPicker(beds, [], beds, ["2026-08-31", "2026-09-01"], [], [], overrides);
    expect(tagged.filter((b) => b.pool === "online")).toHaveLength(2);
    expect(tagged.filter((b) => b.pool === "offline")).toHaveLength(7);
    expect(tagged).toHaveLength(9);
  });

  it("walk-in that eats past OTA slack drops remaining OTA and should push", () => {
    let snap = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    for (let i = 0; i < 7; i++) snap = applyBookingToNight(snap, "offline");
    expect(snap.online).toBe(5);
    expect(snap.available).toBe(5);
    const before = { online: snap.online };
    snap = applyBookingToNight(snap, "offline");
    expect(snap.online).toBe(4);
    expect(shouldPushPms(["offline"])).toBe(false);
    expect(shouldPushPms(["offline"], before, snap)).toBe(true);
  });

  it("remaining walk-in uses ceiling minus online-assigned, not ceiling minus available", () => {
    const split = remainingSplit(11, 5, 1);
    expect(split).toEqual({ online: 4, offline: 7 });
  });

  it("2 Sept EXECUTIVE: 2 booked, 10 available, type 9 online → 1 walk-in (do not subtract booked again)", () => {
    expect(splitAvailable(10, 9)).toEqual({ online: 9, offline: 1 });
    const ceiling = ceilingFromRemaining(9, 2);
    expect(ceiling).toBe(11);
    expect(remainingSplit(10, ceiling, 2)).toEqual({ online: 9, offline: 1 });
    expect(2 + 0 + 9 + 1).toBe(12);
  });

  it("blocked beds are already out of available, so 10 left and 9 online is still 1 walk-in", () => {
    const blocks = [
      { bedId: 11, dormId: 2, startDate: "2026-09-02", endDate: "2026-09-03" },
      { bedId: 12, dormId: 2, startDate: "2026-09-02", endDate: "2026-09-03" },
    ];
    const snap = computeNightAvailability(2, "2026-09-02", beds, blocks, [], [
      { dormId: 2, date: "2026-09-02", onlineAvailable: 9, channelId: null },
    ]);
    expect(snap.blocked).toBe(2);
    expect(snap.available).toBe(10);
    expect(splitAvailable(snap.available, 9)).toEqual({ online: 9, offline: 1 });
    expect(snap.assigned + snap.blocked + snap.online + snap.offline).toBe(snap.total);
  });
});

describe("Wiring", () => {
  it("tags picker beds including blocked, stores inventory_pool, and only pushes PMS when OTA numbers change", () => {
    expect(queries).toContain("tagBedsForPicker(physical, blockedOnly");
    expect(queries).toContain("getUnassignedOtaHoldsForRange");
    expect(queries).toContain("unassignedHolds");
    expect(queries).toContain("inventory_pool");
    expect(queries).toContain("coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'");
    expect(queries).toContain("deactivateBedBlocksByBedIds");
    expect(queries).toContain("pickInventoryOverride(rows, dormId, date)");
    expect(queries).toContain("[...new Set(rows.map(r => r.bedId))]");
    expect(route).toContain("assignTaggedBeds");
    expect(route).toContain('status: "cancelled"');
    expect(route).toContain("pushIfOtaChanged");
    expect(route).toContain("occupiedNights");
    expect(sync).toContain("getOnlineAssignmentCountForDorm");
    expect(sync).toContain("getUnassignedOtaRoomCountForDorm");
    expect(sync).toContain("computeNightAvailability");
    expect(sync).toContain("if (before !== after) return await triggerInventoryPush(dates, dormIds)");
    expect(sync).toContain("mappings.some((m) => m.dormId === dormId)");
    expect(queries).toContain("if (nights.length === 0) return []");
    expect(route).toContain("checkoutDate must be after checkinDate");
    expect(route).toContain("pool: b.pool");
    expect(reservations).toContain("occupiedNights(existing.checkinDate, existing.checkoutDate)");
    expect(reservations).toContain("if (moveDates && newCheckin && newCheckout)");
    expect(reservations).toContain("ingestFetchedReservations");
    expect(reservations).not.toContain("function cancelDateRange");
    const checkins = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    expect(checkins).not.toContain("triggerInventoryPush");
  });

  it("drains unmapped dirty rows so incremental CM push cannot stick on empty updates", () => {
    const push = readFileSync("src/app/api/aiosell/push-inventory/route.ts", "utf8");
    expect(push).toContain("unmappedIds");
    expect(push).toContain("mappedDirty");
    expect(push).toContain("if (mappedDirty.length === 0)");
    expect(push).toMatch(/let mode: \"incremental\" \| \"full\" = \"full\"/);
  });

  it("skips inventory push when unblock matches no active blocks", () => {
    const inv = readFileSync("src/app/api/admin/inventory/route.ts", "utf8");
    expect(inv).toContain("if (pushDates && pushDates.length > 0)");
  });

  it("clears a block only after the bed assignment succeeds", () => {
    const helper = route.match(/async function assignTaggedBeds[\s\S]*?\nfunction diffDays/)![0];
    expect(helper.indexOf("assignBedToBooking")).toBeLessThan(helper.indexOf("deactivateBedBlocksByBedIds"));
  });
});

describe("Sequential mock: create offline then online then blocked, with PMS log", () => {
  it("writes three bookings and only logs a PMS push for the online one", () => {
    const beds = executiveBeds();
    let snap = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    const pmsLog: Array<{ booking: string; action: "push" | "skip"; online: number; offline: number }> = [];

    function create(name: string, pool: "online" | "offline" | "block") {
      const action = shouldPushPms([pool]) ? "push" : "skip";
      snap = applyBookingToNight(snap, pool);
      pmsLog.push({ booking: name, action, online: snap.online, offline: snap.offline });
    }

    create("offline-walkin", "offline");
    create("online-ota", "online");
    create("took-block", "block");

    expect(pmsLog).toEqual([
      { booking: "offline-walkin", action: "skip", online: 5, offline: 6 },
      { booking: "online-ota", action: "push", online: 4, offline: 6 },
      { booking: "took-block", action: "skip", online: 4, offline: 6 },
    ]);
    expect(pmsLog.filter((e) => e.action === "push")).toHaveLength(1);
    expect(snap.assigned).toBe(3);
  });

  it("round 2: mixed pick pushes, walk-in slack does not, squeeze walk-in does", () => {
    const beds = executiveBeds();
    let snap = computeNightAvailability(2, "2026-08-31", beds, [], [], override5);
    const log: Array<"push" | "skip"> = [];

    function book(pool: "online" | "offline" | "block") {
      const before = { online: snap.online };
      snap = applyBookingToNight(snap, pool);
      log.push(shouldPushPms([pool], before, snap) ? "push" : "skip");
    }

    book("offline");
    book("offline");
    book("online");
    book("block");
    for (let i = 0; i < 5; i++) book("offline");
    book("offline");

    expect(log).toEqual([
      "skip", "skip", "push", "skip",
      "skip", "skip", "skip", "skip", "skip",
      "push",
    ]);
    expect(snap.online).toBe(3);
    expect(snap.assigned).toBe(10);
  });
});
