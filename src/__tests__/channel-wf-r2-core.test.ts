import { describe, expect, it } from "vitest";
import {
  occupancyBedCount,
  channelBedNeeds,
  pickOnlineBedsForChannelRooms,
  autoAssignOnlineChannelBeds,
  assignedBedsMatchNeeds,
  channelAssignmentNeedsReseat,
  channelPersonCount,
} from "@/lib/channelAutoAssign";

const mappings = [
  { dormId: 8, channelRoomCode: "executive", dormName: "Executive", isActive: 1 },
  { dormId: 9, channelRoomCode: "dorm-6", dormName: "Dorm 1", isActive: 1 },
  { dormId: 10, channelRoomCode: "closed", dormName: "Closed", isActive: 0 },
];

function online(dormId: number, n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id: startId + i,
    dormId,
    pool: "online" as const,
    bedId: `B${startId + i}`,
    dormName: dormId === 8 ? "Executive" : "Dorm 1",
  }));
}

describe("occupancyBedCount strings and children-only", () => {
  it("coerces occupancy strings including zeros", () => {
    expect(occupancyBedCount({ adults: "2", children: "1" } as never)).toBe(3);
    expect(occupancyBedCount({ adults: "0", children: "0" } as never)).toBe(1);
  });

  it("counts children-only occupancy as persons", () => {
    expect(occupancyBedCount({ adults: 0, children: 3 })).toBe(3);
    expect(occupancyBedCount({ adults: "0", children: "2" } as never)).toBe(2);
  });
});

describe("channelBedNeeds occupancySpecified vs missing occupancy", () => {
  it("two rooms[] with the same roomCode occupancy 1+1 ignore persons", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
      ],
      persons: 5,
    })).toEqual([{ roomCode: "executive", count: 2, units: 2 }]);
  });

  it("two rooms[] with the same roomCode and no occupancy use persons (1 each, extra on first)", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive" }, { roomCode: "executive" }],
      persons: 2,
    })).toEqual([
      { roomCode: "executive", count: 1 },
      { roomCode: "executive", count: 1 },
    ]);
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive" }, { roomCode: "executive" }],
      persons: 3,
    })).toEqual([
      { roomCode: "executive", count: 2 },
      { roomCode: "executive", count: 1 },
    ]);
  });

  it("occupancy strings on rooms[] still split per room", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive", occupancy: { adults: "1", children: "1" } as never },
        { roomCode: "dorm-6", occupancy: { adults: "0", children: "2" } as never },
      ],
    })).toEqual([
      { roomCode: "executive", count: 2, units: 1 },
      { roomCode: "dorm-6", count: 2, units: 1 },
    ]);
  });

  it("children-only rooms[] occupancy needs that many beds", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "dorm-6", occupancy: { adults: 0, children: 2 } }],
      persons: 9,
    })).toEqual([{ roomCode: "dorm-6", count: 2, units: 1 }]);
  });

  it("occupancy {adults:0,children:0} is empty so persons is used", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive", occupancy: { adults: 0, children: 0 } }],
      persons: 3,
    })).toEqual([{ roomCode: "executive", count: 3 }]);
  });

  it("6 suite rooms occupancy 3 is 6 beds (capacity), 1 executive occupancy 2 is still 2", () => {
    expect(channelBedNeeds({
      rooms: Array.from({ length: 6 }, () => ({
        roomCode: "suite",
        occupancy: { adults: 3, children: 0 },
      })),
    })).toEqual([{ roomCode: "suite", count: 6, units: 6 }]);
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
    })).toEqual([{ roomCode: "executive", count: 2, units: 1 }]);
  });

  it("counts every repeated-room occupancy as guests without changing sellable-unit needs", () => {
    const rooms = [
      { roomCode: "single", occupancy: { adults: 1, children: 0 } },
      ...Array.from({ length: 4 }, () => ({ roomCode: "double", occupancy: { adults: 2, children: 0 } })),
    ];
    expect(channelPersonCount({ rooms })).toBe(9);
    expect(channelBedNeeds({ rooms })).toEqual([
      { roomCode: "single", count: 1, units: 1 },
      { roomCode: "double", count: 4, units: 4 },
    ]);
    expect(channelPersonCount({ rooms: Array.from({ length: 6 }, () => ({ roomCode: "suite", occupancy: { adults: 3, children: 0 } })) })).toBe(18);
  });

  it.each([
    ["single, one guest", [{ roomCode: "single", occupancy: { adults: 1, children: 0 } }], 1, [{ roomCode: "single", count: 1, units: 1 }]],
    ["double, one guest", [{ roomCode: "double", occupancy: { adults: 1, children: 0 } }], 1, [{ roomCode: "double", count: 1, units: 1 }]],
    ["double, two guests", [{ roomCode: "double", occupancy: { adults: 2, children: 0 } }], 2, [{ roomCode: "double", count: 2, units: 1 }]],
    ["double, adult plus child", [{ roomCode: "double", occupancy: { adults: 1, children: 1 } }], 2, [{ roomCode: "double", count: 2, units: 1 }]],
    ["two doubles, one guest each", Array.from({ length: 2 }, () => ({ roomCode: "double", occupancy: { adults: 1, children: 0 } })), 2, [{ roomCode: "double", count: 2, units: 2 }]],
    ["two doubles, two guests each", Array.from({ length: 2 }, () => ({ roomCode: "double", occupancy: { adults: 2, children: 0 } })), 4, [{ roomCode: "double", count: 2, units: 2 }]],
  ])("keeps %s guest count separate from its sellable units", (_name, rooms, persons, needs) => {
    expect(channelPersonCount({ rooms })).toBe(persons);
    expect(channelBedNeeds({ rooms })).toEqual(needs);
  });

  it("missing occupancy on a single room uses all persons", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive" }],
      persons: 3,
    })).toEqual([{ roomCode: "executive", count: 3 }]);
  });

  it("empty occupancy object {} is not specified and uses persons", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive", occupancy: {} }],
      persons: 3,
    })).toEqual([{ roomCode: "executive", count: 3 }]);
  });

  it("mixed specified occupancy + missing occupancy puts leftover persons on the unspecified room", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6" },
      ],
      persons: 4,
    })).toEqual([
      { roomCode: "executive", count: 2, units: 1 },
      { roomCode: "dorm-6", count: 2 },
    ]);
  });

  it("mixed specified occupancy + missing occupancy does not add a bed when persons is already covered", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6" },
      ],
      persons: 2,
    })).toEqual([
      { roomCode: "executive", count: 2, units: 1 },
    ]);
  });
});

describe("pickOnlineBedsForChannelRooms", () => {
  it("empty needs is not ok", () => {
    expect(pickOnlineBedsForChannelRooms([], mappings, online(8, 3))).toEqual({
      ok: false,
      reason: "no room type on booking",
    });
    expect(channelBedNeeds({})).toEqual([]);
  });

  it("ignores offline and block chips even when they are the only leftover", () => {
    const tagged = [
      { id: 1, dormId: 8, pool: "offline" as const, bedId: "OFF", dormName: "Executive" },
      { id: 2, dormId: 8, pool: "block" as const, bedId: "BLK", dormName: "Executive" },
    ];
    expect(pickOnlineBedsForChannelRooms(
      [{ roomCode: "executive", count: 1 }],
      mappings,
      tagged,
    )).toEqual({
      ok: false,
      reason: "no online beds left in Executive (executive)",
    });
  });

  it("picks only online when offline and block chips sit in the same dorm", () => {
    const tagged = [
      { id: 90, dormId: 8, pool: "offline" as const, bedId: "OFF", dormName: "Executive" },
      { id: 91, dormId: 8, pool: "block" as const, bedId: "BLK", dormName: "Executive" },
      ...online(8, 1, 5),
    ];
    const picked = pickOnlineBedsForChannelRooms(
      [{ roomCode: "executive", count: 1 }],
      mappings,
      tagged,
    );
    expect(picked).toMatchObject({ ok: true, picks: [{ bedId: 5, dormId: 8 }] });
  });

  it("reserves both internal slots for one sold double room", () => {
    const tagged = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      dormId: 8,
      pool: "online" as const,
      bedId: `D-${i + 1}`,
      dormName: "Double Room",
      type: "Double",
    }));
    const picked = pickOnlineBedsForChannelRooms(
      [{ roomCode: "executive", count: 1, units: 1 }],
      mappings,
      tagged,
    );
    expect(picked).toMatchObject({ ok: true });
    if (picked.ok) expect(picked.picks.map((p) => p.bedId)).toEqual([1, 2]);
  });

  it("two guests in one sold double room still consume only one unit", () => {
    const tagged = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      dormId: 8,
      pool: "online" as const,
      bedId: `D-${i + 1}`,
      dormName: "Double Room",
      type: "Double",
    }));
    const picked = pickOnlineBedsForChannelRooms(
      [{ roomCode: "executive", count: 2, units: 1 }],
      mappings,
      tagged,
    );
    expect(picked).toMatchObject({ ok: true });
    if (picked.ok) expect(picked.picks.map((p) => p.bedId)).toEqual([1, 2]);
  });
});

describe("autoAssignOnlineChannelBeds concurrency retry", () => {
  it("without refreshTagged fails after the first conflict", async () => {
    let assigns = 0;
    let unassigns = 0;
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      mappings,
      tagged: online(8, 2),
      assignBed: async () => {
        assigns++;
        return false;
      },
      unassignAll: async () => { unassigns++; },
    });
    expect(assigns).toBe(1);
    expect(unassigns).toBe(1);
    expect(result).toEqual({ assigned: 0, labels: [], reason: "bed conflict while auto-assigning" });
  });

  it("skips a failed bed and tries the next online chip even if refresh still lists the first", async () => {
    const pickedIds: number[] = [];
    let refreshes = 0;
    const tagged = online(8, 2);
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      mappings,
      tagged,
      assignBed: async ({ bedId }) => {
        pickedIds.push(bedId);
        return bedId !== 1;
      },
      unassignAll: async () => {},
      refreshTagged: async () => {
        refreshes++;
        return tagged;
      },
    });
    expect(pickedIds).toEqual([1, 2]);
    expect(refreshes).toBe(1);
    expect(result.assigned).toBe(1);
  });

  it("exhausts 3 attempts then Unassigned when every assignBed fails", async () => {
    let attempts = 0;
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      mappings,
      tagged: online(8, 1),
      assignBed: async () => {
        attempts++;
        return false;
      },
      unassignAll: async () => {},
      refreshTagged: async () => online(8, 1, 10 + attempts),
    });
    expect(attempts).toBe(3);
    expect(result).toEqual({ assigned: 0, labels: [], reason: "bed conflict while auto-assigning" });
  });
});

describe("assignedBedsMatchNeeds exact dorm counts", () => {
  it("matches two same-code rooms[] as two beds in the mapped dorm", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 8, status: "assigned" }, { dormId: 8, status: "assigned" }],
      [
        { roomCode: "executive", count: 1 },
        { roomCode: "executive", count: 1 },
      ],
      mappings,
    )).toBe(true);
  });

  it("is false when staff overflow sits in another dorm", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 8, status: "assigned" }, { dormId: 9, status: "assigned" }],
      [{ roomCode: "executive", count: 1 }],
      mappings,
    )).toBe(false);
  });
});

describe("channelAssignmentNeedsReseat", () => {
  it("does not treat a missing next roomType as a type change", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      previousRoomType: "executive",
      nextRoomType: "",
    })).toBe(false);
  });

  it("does not reseat when previous roomType is undefined and counts match", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      previousRoomType: undefined,
      nextRoomType: "executive",
    })).toBe(false);
  });

  it("does not reseat staff overflow when assigned count and type are unchanged", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      previousRoomType: "executive",
      nextRoomType: "executive",
    })).toBe(false);
  });

  it("does not reseat an extra overflow bed when occupancy and type are unchanged", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 2,
      needs: [{ roomCode: "executive", count: 1 }],
      previousNeedCount: 1,
      previousRoomType: "executive",
      nextRoomType: "executive",
    })).toBe(false);
  });

  it("reseats when OTA occupancy shrinks", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 2,
      needs: [{ roomCode: "executive", count: 1 }],
      previousNeedCount: 2,
      previousRoomType: "executive",
      nextRoomType: "executive",
    })).toBe(true);
  });

  it("treats comma-separated roomType order as the same type", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 2,
      needs: [
        { roomCode: "executive", count: 1 },
        { roomCode: "dorm-6", count: 1 },
      ],
      previousRoomType: "dorm-6, executive",
      nextRoomType: "executive, dorm-6",
    })).toBe(false);
  });
});
