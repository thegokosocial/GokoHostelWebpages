import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHECKIN_COLUMNS, parseBedRow } from "@/components/admin/types";

describe("bed / checkin wire formats", () => {
  it("parseBedRow reads id at index 10 and checkinId at index 11", () => {
    const row = [
      "Dorm A", "B1", "Lower", "Bunk", "occupied",
      "Ada", "9876543210", "2026-09-20", "2026-09-22", "2",
      "42", "99",
    ];
    expect(parseBedRow(row)).toEqual({
      id: 42,
      dormName: "Dorm A",
      bedId: "B1",
      position: "Lower",
      type: "Bunk",
      status: "occupied",
      guestName: "Ada",
      guestContact: "9876543210",
      checkinDate: "2026-09-20",
      expectedCheckout: "2026-09-22",
      stayingDays: "2",
      checkinId: 99,
    });
  });

  it("parseBedRow stays safe on short rows and missing checkinId", () => {
    expect(parseBedRow(["Dorm", "B2"])).toMatchObject({
      id: 0,
      dormName: "Dorm",
      bedId: "B2",
      checkinId: undefined,
    });
    expect(parseBedRow([
      "Dorm", "B3", "Upper", "Bunk", "available",
      "", "", "", "", "",
      "7", "",
    ]).checkinId).toBeUndefined();
  });

  it("getBeds occupied layout places numeric id@10 and checkinId@11", () => {
    const route = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    const section = route.match(/if \(action === "getBeds"\)[\s\S]*?if \(action === "assignBed"\)/)?.[0];
    expect(section).toBeTruthy();
    expect(section!).toContain("String(b.id), String(b.checkinId || \"\")");
    expect(section!).toMatch(/b\.dormName,\s*b\.bedId,\s*b\.position/);
  });

  it("getBeds.unassigned layout length differs from CHECKIN_COLUMNS semantics (id is not @10)", () => {
    const route = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    const unassigned = route.match(/const unassignedArr = unassignedCheckins\.map\(\(r\) => \[[\s\S]*?\]\);/)?.[0];
    expect(unassigned).toBeTruthy();
    // Unassigned ends with String(r.id), bookingId — Records CHECKIN_COLUMNS put Platform/Booking earlier.
    expect(unassigned!).toContain("String(r.id), r.bookingId || \"\"");
    expect(CHECKIN_COLUMNS).toContain("Platform");
    expect(CHECKIN_COLUMNS).toContain("Booking ID");
    expect(CHECKIN_COLUMNS.indexOf("Platform")).toBe(11);
    // Mixing unassigned indices with parseBedRow would treat emergencyPhone as id.
    const fakeUnassigned = [
      "2026-09-01T00:00:00.000Z", "2026-09-01", "14:00", "Ada", "1",
      "900", "2", "Goa", "IN", "Mom",
      "911", "Aadhaar", "id.pdf", "", "yes",
      "55", "BK-1",
    ];
    const mistaken = parseBedRow(fakeUnassigned as string[]);
    expect(mistaken.id).toBe(911); // emergency phone slot — landmine if parsers are mixed
    expect(mistaken.id).not.toBe(55);
  });

  it("CHECKIN_COLUMNS keep platform / bookingId / idType / id slots stable", () => {
    expect(CHECKIN_COLUMNS.slice(11, 15)).toEqual([
      "Platform", "Booking ID", "ID Type", "ID Card",
    ]);
    expect(CHECKIN_COLUMNS).toHaveLength(17);
  });
});
