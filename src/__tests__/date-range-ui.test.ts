import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookings = readFileSync("src/components/admin/booking-dashboard/DateRangeSelector.tsx", "utf8");
const inventory = readFileSync("src/components/admin/InventoryRatePlan.tsx", "utf8");
const timeline = readFileSync("src/components/admin/AdminTimeline.tsx", "utf8");

function inclusiveDays(start: string, end: string): number {
  return Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86400000) + 1;
}

describe("admin custom date ranges", () => {
  it("applies Bookings custom dates directly and accepts ranges longer than 30 days", () => {
    expect(bookings).toContain("DateRangePicker");
    expect(bookings).toContain('applyMode="manual"');
    expect(bookings).toContain("onChange({ startDate: customStart, endDate: customEnd, mode: \"custom\" });");
    expect(bookings).not.toContain("diffDays > 30");
    expect(bookings).toContain("Choose a valid date range.");
  });

  it("keeps custom ranges inclusive across Inventory and Timeline", () => {
    expect(inventory).toContain("setRangeDays(diff + 1)");
    expect(inventory).toContain("const endDate = dates[dates.length - 1] || rangeStart;");
    expect(timeline).toContain("setNumDays(diff + 1)");
    expect(timeline).toContain("addCalendarDays(startDate, i)");
    expect(inclusiveDays("2026-09-15", "2026-11-30")).toBe(77);
  });

  it.each([
    ["two months", "2026-09-01", "2026-10-31", 61],
    ["three months", "2026-09-01", "2026-11-30", 91],
  ])("maps a %s range to every visible day", (_label, start, end, expected) => {
    expect(inclusiveDays(start, end)).toBe(expected);
  });
});
