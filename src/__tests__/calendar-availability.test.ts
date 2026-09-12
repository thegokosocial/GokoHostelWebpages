import { describe, expect, it } from "vitest";
import { calendarAvailability, inclusiveNights, tagBedsForPicker } from "@/lib/inventoryAvailability";

const beds = [1, 2, 3].map((id) => ({ id, bedId: `B-${id}`, dormId: 1 }));
const nights = inclusiveNights("2026-09-05", "2026-09-08");

describe("calendar nightly availability", () => {
  it("blocks only the applicable nights, including the final visible night", () => {
    const blocks = [{ bedId: 1, dormId: 1, startDate: "2026-09-06", endDate: "2026-09-08" }, { bedId: 2, dormId: 1, startDate: "2026-09-08", endDate: "2026-09-09" }];
    const result = calendarAvailability(beds, nights, blocks, [], [], []);
    expect(Object.values(result.beds[1])).toEqual(["online", "block", "block", "online"]);
    expect(result.beds[2]["2026-09-08"]).toBe("block");
    expect(result.dorms[1]["2026-09-05"].blocked).toBe(0);
    expect(result.dorms[1]["2026-09-07"].blocked).toBe(1);
  });

  it("matches the picker pools and counts for each night with overrides and OTA holds", () => {
    const overrides = nights.map((date) => ({ dormId: 1, date, onlineAvailable: 2 }));
    const holds = [{ dormId: 1, date: nights[0], rooms: 1 }];
    const result = calendarAvailability(beds, nights, [], [], overrides, holds);
    for (const date of nights) {
      const picker = tagBedsForPicker(beds, [], beds, [date], [], [], overrides, holds);
      for (const bed of beds) expect(result.beds[bed.id][date]).toBe(picker.find((b) => b.id === bed.id)?.pool ?? "held");
    }
    expect(result.dorms[1][nights[0]]).toMatchObject({ online: 1, offline: 1, unassignedOta: 1 });
    expect(Object.values(result.beds).map((dates) => dates[nights[0]])).toEqual(["online", "offline", "held"]);
  });

  it("keeps an unassigned OTA hold visible as held rather than available", () => {
    const result = calendarAvailability(beds, nights, [], [
      { bedId: 1, dormId: 1, checkinDate: nights[0], checkoutDate: nights[1], status: "assigned" },
      { bedId: 2, dormId: 1, checkinDate: nights[0], checkoutDate: nights[1], status: "assigned" },
    ], [], [{ dormId: 1, date: nights[0], rooms: 1 }]);
    expect(result.dorms[1][nights[0]]).toMatchObject({ total: 3, assigned: 2, blocked: 0, unassignedOta: 1, available: 0, online: 0, offline: 0 });
  });

  it("counts double rooms once and applies either slot's block or assignment to the whole room", () => {
    const doubles = [1, 2, 3, 4].map((id) => ({ id, bedId: `D-${id}`, dormId: 1, type: "Double" }));
    const result = calendarAvailability(doubles, nights, [{ bedId: 2, dormId: 1, startDate: nights[0], endDate: nights[1] }], [{ bedId: 4, dormId: 1, checkinDate: nights[0], checkoutDate: nights[1], status: "assigned" }], [], []);
    expect(Object.keys(result.beds)).toEqual(["1", "3"]);
    expect(result.beds[1][nights[0]]).toBe("block");
    expect(result.beds[3][nights[0]]).toBe("occupied");
    expect(result.dorms[1][nights[0]]).toMatchObject({ total: 2, blocked: 1, assigned: 1, available: 0 });
    expect(result.dorms[1][nights[1]].available).toBe(2);
  });

  it("distinguishes fully blocked, occupied, and walk-in-only nights", () => {
    const blocked = calendarAvailability(beds, nights, beds.map((b) => ({ bedId: b.id, dormId: 1, startDate: nights[0], endDate: nights[1] })), [], [], []);
    expect(blocked.dorms[1][nights[0]]).toMatchObject({ blocked: 3, online: 0, offline: 0 });
    const occupied = calendarAvailability(beds, nights, [], beds.map((b) => ({ bedId: b.id, dormId: 1, checkinDate: nights[0], checkoutDate: nights[1] })), [], []);
    expect(occupied.dorms[1][nights[0]]).toMatchObject({ blocked: 0, assigned: 3, available: 0 });
    const offline = calendarAvailability(beds, nights, [], [], [{ dormId: 1, date: nights[0], onlineAvailable: 0 }], []);
    expect(offline.dorms[1][nights[0]]).toMatchObject({ online: 0, offline: 3 });
    expect(offline.beds[1][nights[0]]).toBe("offline");
  });

  it("ignores cancelled assignments and preserves occupied status over conflicting blocks", () => {
    const result = calendarAvailability(beds, nights, [{ bedId: 2, dormId: 1, startDate: nights[0], endDate: nights[1] }], [
      { bedId: 1, dormId: 1, checkinDate: nights[0], checkoutDate: nights[1], status: "cancelled" },
      { bedId: 2, dormId: 1, checkinDate: nights[0], checkoutDate: nights[1], status: "assigned" },
    ], [], []);
    expect(result.beds[1][nights[0]]).toBe("online");
    expect(result.beds[2][nights[0]]).toBe("occupied");
  });
});
