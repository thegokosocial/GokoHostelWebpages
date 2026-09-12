import { describe, expect, it } from "vitest";
import {
  occupancyBedCount,
  channelBedNeeds,
  pickOnlineBedsForChannelRooms,
  autoAssignOnlineChannelBeds,
  assignedBedsMatchNeeds,
  channelAssignmentNeedsReseat,
  enrichUnassignedBooking,
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

describe("occupancyBedCount", () => {
  it("is one bed per person", () => {
    expect(occupancyBedCount({ adults: 1, children: 0 })).toBe(1);
    expect(occupancyBedCount({ adults: 2, children: 0 })).toBe(2);
    expect(occupancyBedCount({ adults: 1, children: 1 })).toBe(2);
    expect(occupancyBedCount({ adults: 0, children: 2 })).toBe(2);
    expect(occupancyBedCount({ adults: 0, children: 0 })).toBe(1);
    expect(occupancyBedCount(undefined)).toBe(1);
  });

  it("counts JSON occupancy strings as persons", () => {
    expect(occupancyBedCount({ adults: "2", children: "0" } as never)).toBe(2);
    expect(occupancyBedCount({ adults: "1", children: "1" } as never)).toBe(2);
    expect(occupancyBedCount({ adults: "0", children: "2" } as never)).toBe(2);
    expect(occupancyBedCount({ adults: "0", children: "0" } as never)).toBe(1);
  });
});

describe("channelBedNeeds", () => {
  it("1 person in executive is 1 executive bed", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive", occupancy: { adults: 1, children: 0 } }],
    })).toEqual([{ roomCode: "executive", count: 1, units: 1 }]);
  });

  it("2 persons for any stay length is 2 beds of that room type", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "dorm-6", occupancy: { adults: 2, children: 0 } }],
      persons: 2,
    })).toEqual([{ roomCode: "dorm-6", count: 2, units: 1 }]);
  });

  it("splits mixed room types by each room's occupancy", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive", occupancy: { adults: 2, children: 0 } },
        { roomCode: "dorm-6", occupancy: { adults: 1, children: 0 } },
      ],
    })).toEqual([
      { roomCode: "executive", count: 2, units: 1 },
      { roomCode: "dorm-6", count: 1, units: 1 },
    ]);
  });

  it("falls back to booking.persons when only roomType is stored", () => {
    expect(channelBedNeeds({ roomType: "executive", persons: 2 })).toEqual([
      { roomCode: "executive", count: 2 },
    ]);
  });

  it("counts children as persons for that room type", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive", occupancy: { adults: 1, children: 1 } }],
    })).toEqual([{ roomCode: "executive", count: 2, units: 1 }]);
    expect(channelBedNeeds({
      rooms: [{ roomCode: "dorm-6", occupancy: { adults: 0, children: 2 } }],
    })).toEqual([{ roomCode: "dorm-6", count: 2, units: 1 }]);
  });

  it("coerces occupancy strings so 2 persons still need 2 beds", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive", occupancy: { adults: "2", children: "0" } as never }],
    })).toEqual([{ roomCode: "executive", count: 2, units: 1 }]);
  });

  it("gives each rooms[] row its own bed when the same roomCode repeats", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
        { roomCode: "executive", occupancy: { adults: 1, children: 0 } },
      ],
    })).toEqual([{ roomCode: "executive", count: 2, units: 2 }]);
  });

  it("treats occupancy on repeated same-code rooms as capacity, not extra beds", () => {
    const suiteRow = {
      roomCode: "suite",
      occupancy: { adults: 3, children: 0 },
    };
    expect(channelBedNeeds({
      rooms: Array.from({ length: 6 }, () => ({ ...suiteRow })),
    })).toEqual([{ roomCode: "suite", count: 6, units: 6 }]);
  });

  it("JSON occupancy adults 0 children 0 uses persons when set", () => {
    expect(channelBedNeeds({
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 0, children: 0 } }],
      }),
      persons: 2,
    })).toEqual([{ roomCode: "executive", count: 2 }]);
    expect(channelBedNeeds({
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 0, children: 0 } }],
      }),
    })).toEqual([{ roomCode: "executive", count: 1 }]);
  });

  it("splits comma-separated roomType when rooms[] is missing", () => {
    expect(channelBedNeeds({ roomType: "executive, dorm-6", persons: 2 })).toEqual([
      { roomCode: "executive", count: 1 },
      { roomCode: "dorm-6", count: 1 },
    ]);
    expect(channelBedNeeds({ roomType: "executive, dorm-6", persons: 3 })).toEqual([
      { roomCode: "executive", count: 2 },
      { roomCode: "dorm-6", count: 1 },
    ]);
  });

  it("uses persons when rooms[] has no occupancy", () => {
    expect(channelBedNeeds({
      rooms: [{ roomCode: "executive" }],
      persons: 2,
    })).toEqual([{ roomCode: "executive", count: 2 }]);
  });

  it("distributes leftover persons onto the first rooms[] row without occupancy", () => {
    expect(channelBedNeeds({
      rooms: [
        { roomCode: "executive" },
        { roomCode: "dorm-6" },
      ],
      persons: 3,
    })).toEqual([
      { roomCode: "executive", count: 2 },
      { roomCode: "dorm-6", count: 1 },
    ]);
  });
});

describe("pickOnlineBedsForChannelRooms", () => {
  it("picks 2 online executive beds for 2 persons and ignores offline leftover", () => {
    const tagged = [
      ...online(8, 2, 1),
      { id: 90, dormId: 8, pool: "offline" as const, bedId: "OFF", dormName: "Executive" },
    ];
    const picked = pickOnlineBedsForChannelRooms([{ roomCode: "executive", count: 2 }], mappings, tagged);
    expect(picked).toMatchObject({
      ok: true,
      picks: [
        { bedId: 1, dormId: 8 },
        { bedId: 2, dormId: 8 },
      ],
    });
  });

  it("leaves Unassigned when online is exhausted even if offline beds exist", () => {
    const tagged = [
      { id: 90, dormId: 8, pool: "offline" as const, bedId: "OFF", dormName: "Executive" },
    ];
    expect(pickOnlineBedsForChannelRooms([{ roomCode: "executive", count: 1 }], mappings, tagged)).toEqual({
      ok: false,
      reason: "no online beds left in Executive (executive)",
    });
  });

  it("is all-or-nothing when a 2-person stay has only 1 online bed", () => {
    expect(pickOnlineBedsForChannelRooms(
      [{ roomCode: "executive", count: 2 }],
      mappings,
      online(8, 1),
    ).ok).toBe(false);
  });

  it("picks mixed types by occupancy, not by night count", () => {
    const tagged = [...online(8, 2, 1), ...online(9, 1, 40)];
    const picked = pickOnlineBedsForChannelRooms(
      [
        { roomCode: "executive", count: 2 },
        { roomCode: "dorm-6", count: 1 },
      ],
      mappings,
      tagged,
    );
    expect(picked).toMatchObject({
      ok: true,
      picks: [
        { bedId: 1, dormId: 8 },
        { bedId: 2, dormId: 8 },
        { bedId: 40, dormId: 9 },
      ],
    });
  });

  it("matches room codes case-insensitively", () => {
    const picked = pickOnlineBedsForChannelRooms(
      [{ roomCode: "DORM-6", count: 1 }],
      mappings,
      online(9, 1, 40),
    );
    expect(picked).toMatchObject({ ok: true, picks: [{ bedId: 40, dormId: 9 }] });
  });

  it("does not use an inactive mapping", () => {
    expect(pickOnlineBedsForChannelRooms(
      [{ roomCode: "closed", count: 1 }],
      mappings,
      online(10, 3),
    )).toMatchObject({ ok: false, reason: "unmapped room type: closed" });
  });

  it("picks two online beds when two rooms[] share the same roomCode", () => {
    const picked = pickOnlineBedsForChannelRooms(
      [{ roomCode: "executive", count: 2 }],
      mappings,
      online(8, 2),
    );
    expect(picked).toMatchObject({
      ok: true,
      picks: [
        { bedId: 1, dormId: 8 },
        { bedId: 2, dormId: 8 },
      ],
    });
  });

  it("picks 6 suite beds for 6 sold suite rooms, not 18", () => {
    const suiteMap = [...mappings, { dormId: 11, channelRoomCode: "suite", dormName: "Suite", isActive: 1 }];
    const tagged = Array.from({ length: 6 }, (_, i) => ({
      id: 101 + i,
      dormId: 11,
      pool: "online" as const,
      bedId: `SUI-${i + 1}`,
      dormName: "Suite",
    }));
    const needs = channelBedNeeds({
      rooms: Array.from({ length: 6 }, () => ({
        roomCode: "suite",
        occupancy: { adults: 3, children: 0 },
      })),
    });
    expect(needs).toEqual([{ roomCode: "suite", count: 6, units: 6 }]);
    const picked = pickOnlineBedsForChannelRooms(needs, suiteMap, tagged);
    expect(picked.ok).toBe(true);
    if (picked.ok) expect(picked.picks).toHaveLength(6);
  });

  it("is all-or-nothing across mixed types when dorm has no online bed", () => {
    const picked = pickOnlineBedsForChannelRooms(
      [
        { roomCode: "executive", count: 2 },
        { roomCode: "dorm-6", count: 1 },
      ],
      mappings,
      [...online(8, 2), { id: 90, dormId: 9, pool: "offline" as const, bedId: "DOFF", dormName: "Dorm 1" }],
    );
    expect(picked.ok).toBe(false);
    expect(picked).toMatchObject({ reason: "no online beds left in Dorm 1 (dorm-6)" });
  });
});

describe("autoAssignOnlineChannelBeds", () => {
  it("assigns a mixed OTA booking when its own temporary hold is excluded", async () => {
    const mixedMappings = [
      { dormId: 13, channelRoomCode: "dorm-1---double-bed", dormName: "Dorm 1 - double bed", isActive: 1 },
      { dormId: 16, channelRoomCode: "female-dorm", dormName: "Female dorm", isActive: 1 },
    ];
    const tagged = [
      { id: 101, dormId: 13, pool: "online" as const, bedId: "DOR-1", dormName: "Dorm 1 - double bed", type: "Double" },
      { id: 102, dormId: 13, pool: "online" as const, bedId: "DOR-2", dormName: "Dorm 1 - double bed", type: "Double" },
      { id: 106, dormId: 16, pool: "online" as const, bedId: "FEM-6", dormName: "Female dorm", type: "Bunk" },
    ];
    const assigned: Array<{ bedId: number; dormId: number }> = [];
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 201,
      needs: [
        { roomCode: "dorm-1---double-bed", count: 2, units: 1 },
        { roomCode: "female-dorm", count: 1, units: 1 },
      ],
      mappings: mixedMappings,
      tagged,
      assignBed: async (pick) => {
        assigned.push(pick);
        return true;
      },
      unassignAll: async () => { assigned.length = 0; },
    });

    expect(result).toMatchObject({ assigned: 3 });
    expect(assigned).toEqual([
      { bedId: 101, dormId: 13 },
      { bedId: 102, dormId: 13 },
      { bedId: 106, dormId: 16 },
    ]);
  });

  it("rolls back if the second person-bed fails to write", async () => {
    const assigned: number[] = [];
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 1,
      needs: [{ roomCode: "executive", count: 2 }],
      mappings,
      tagged: online(8, 2),
      assignBed: async ({ bedId }) => {
        if (bedId === 2) return false;
        assigned.push(bedId);
        return true;
      },
      unassignAll: async () => { assigned.length = 0; },
    });
    expect(result.assigned).toBe(0);
    expect(assigned).toEqual([]);
    expect(result.reason).toMatch(/conflict/);
  });

  it("does not assign any bed when mixed types are short on one type", async () => {
    const assigned: number[] = [];
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 1,
      needs: [
        { roomCode: "executive", count: 2 },
        { roomCode: "dorm-6", count: 1 },
      ],
      mappings,
      tagged: online(8, 2),
      assignBed: async ({ bedId }) => {
        assigned.push(bedId);
        return true;
      },
      unassignAll: async () => { assigned.length = 0; },
    });
    expect(result.assigned).toBe(0);
    expect(assigned).toEqual([]);
    expect(result.reason).toMatch(/Dorm 1 \(dorm-6\)/);
  });

  it("retries after a conflict once refreshTagged offers another online bed", async () => {
    const assigned: number[] = [];
    let attempt = 0;
    const result = await autoAssignOnlineChannelBeds({
      bookingId: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      mappings,
      tagged: online(8, 1, 1),
      assignBed: async ({ bedId }) => {
        attempt++;
        if (bedId === 1) return false;
        assigned.push(bedId);
        return true;
      },
      unassignAll: async () => { assigned.length = 0; },
      refreshTagged: async () => online(8, 1, 2),
    });
    expect(result.assigned).toBe(1);
    expect(assigned).toEqual([2]);
    expect(attempt).toBe(2);
  });
});

describe("assignedBedsMatchNeeds", () => {
  it("matches one bed per person in the mapped dorm", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 8, status: "assigned" }, { dormId: 8, status: "assigned" }],
      [{ roomCode: "executive", count: 2 }],
      mappings,
    )).toBe(true);
  });

  it("is false when occupancy grows from 1 to 2", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 8, status: "assigned" }],
      [{ roomCode: "executive", count: 2 }],
      mappings,
    )).toBe(false);
  });

  it("is false when the assigned dorm is a different room type", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 9, status: "assigned" }],
      [{ roomCode: "executive", count: 1 }],
      mappings,
    )).toBe(false);
  });

  it("counts getBedById rows whose status is available (not assignment status)", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 8, status: "available" }, { dormId: 8, status: "occupied" }],
      [{ roomCode: "executive", count: 2 }],
      mappings,
    )).toBe(true);
  });

  it("still skips unassigned assignment rows", () => {
    expect(assignedBedsMatchNeeds(
      [{ dormId: 8, status: "assigned" }, { dormId: 8, status: "unassigned" }],
      [{ roomCode: "executive", count: 1 }],
      mappings,
    )).toBe(true);
  });
});

describe("channelAssignmentNeedsReseat", () => {
  it("reseats when occupancy grows", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "executive", count: 2 }],
      previousRoomType: "executive",
      nextRoomType: "executive",
    })).toBe(true);
  });

  it("keeps staff overflow in another dorm when count and type are unchanged", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      previousRoomType: "executive",
      nextRoomType: "executive",
    })).toBe(false);
  });

  it("reseats when the OTA room type changes", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "dorm-6", count: 1 }],
      previousRoomType: "executive",
      nextRoomType: "dorm-6",
    })).toBe(true);
  });

  it("does not treat extra overflow beds as occupancy growth", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 2,
      needs: [{ roomCode: "executive", count: 1 }],
      previousNeedCount: 1,
      previousRoomType: "executive",
      nextRoomType: "executive",
    })).toBe(false);
  });

  it("does not treat a missing stored roomType as a type change", () => {
    expect(channelAssignmentNeedsReseat({
      assignedCount: 1,
      needs: [{ roomCode: "executive", count: 1 }],
      previousRoomType: "",
      nextRoomType: "executive",
    })).toBe(false);
  });
});

describe("enrichUnassignedBooking", () => {
  it("surfaces requested room type, dorm, and person bed count", () => {
    const row = enrichUnassignedBooking({
      roomType: "executive",
      persons: 2,
      rawData: JSON.stringify({
        rooms: [{ roomCode: "executive", occupancy: { adults: 2, children: 0 } }],
      }),
    }, mappings);
    expect(row.requestedRoomCodes).toEqual(["executive"]);
    expect(row.requestedDormIds).toEqual([8]);
    expect(row.requestedDormNames).toEqual(["Executive"]);
    expect(row.requestedBedCount).toBe(2);
    expect(row.requestedNeedLabels).toBe("2 Executive");
    expect(row.requestedNeeds).toEqual([{ dormId: 8, count: 2, units: 2, name: "Executive" }]);
  });

  it("splits comma-separated roomType into dorms and person bed count", () => {
    const row = enrichUnassignedBooking({
      roomType: "executive, dorm-6",
      persons: 3,
    }, mappings);
    expect(row.requestedRoomCodes).toEqual(["executive", "dorm-6"]);
    expect(row.requestedDormIds).toEqual([8, 9]);
    expect(row.requestedDormNames).toEqual(["Executive", "Dorm 1"]);
    expect(row.requestedBedCount).toBe(3);
    expect(row.requestedNeedLabels).toBe("2 Executive, 1 Dorm 1");
    expect(row.requestedNeeds).toEqual([
      { dormId: 8, count: 2, units: 2, name: "Executive" },
      { dormId: 9, count: 1, units: 1, name: "Dorm 1" },
    ]);
  });

  it("6 suite rooms with occupancy 3 are 6 beds, not 18", () => {
    const row = enrichUnassignedBooking({
      roomType: "suite, suite, suite, suite, suite, suite",
      persons: 18,
      rawData: JSON.stringify({
        rooms: Array.from({ length: 6 }, () => ({
          roomCode: "suite",
          occupancy: { adults: 3, children: 0 },
        })),
      }),
    }, [...mappings, { dormId: 11, channelRoomCode: "suite", dormName: "Suite", isActive: 1 }]);
    expect(row.requestedBedCount).toBe(6);
    expect(row.persons).toBe(6);
    expect(row.requestedNeedLabels).toBe("6 Suite");
    expect(row.requestedNeeds).toEqual([{ dormId: 11, count: 6, units: 6, name: "Suite" }]);
  });
});
