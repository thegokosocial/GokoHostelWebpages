import { describe, expect, it } from "vitest";
import { checkinVisitKey, dedupeCheckins, isSameCheckinVisit } from "@/lib/checkinDuplicate";

const base = {
  name: "Sameer Joshi",
  contact: "+91 98765 43210",
  arrivalDate: "2026-09-12",
};

describe("check-in duplicate protection", () => {
  it("matches formatting variants for the same visit", () => {
    expect(isSameCheckinVisit(base, { ...base, name: " sameer-joshi ", contact: "9876543210" })).toBe(true);
    expect(checkinVisitKey(base)).toBe(checkinVisitKey({ ...base }));
  });

  it("keeps different visits and allows a new visit after checkout", () => {
    expect(isSameCheckinVisit(base, { ...base, arrivalDate: "2026-09-13" })).toBe(false);
    const changedDetails = { ...base, stayingDays: "3", bookingId: "BOOK-2" } as typeof base;
    expect(isSameCheckinVisit(base, changedDetails)).toBe(true);
  });

  it("collapses exact legacy duplicates but does not collapse incomplete identities", () => {
    const rows = [
      { id: 3, ...base },
      { id: 2, ...base },
      { id: 4, ...base, stayingDays: "3", bookingId: "BOOK-2" },
      { id: 1, ...base, name: "" },
    ];
    expect(dedupeCheckins(rows).map((row) => row.id)).toEqual([3, 1]);
    expect(dedupeCheckins(rows, new Set([3])).map((row) => row.id)).toEqual([1]);
  });
});
