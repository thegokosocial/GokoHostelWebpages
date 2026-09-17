import { describe, expect, it } from "vitest";
import {
  applyRangeSelection,
  dateRangeToIso,
  isoRangeToDateRange,
  normalizeStayRange,
  parseCalendarDate,
  stayNightCount,
  toCalendarDateString,
} from "@/lib/dateRangePicker";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";

describe("dateRangePicker helpers", () => {
  it("parses and formats calendar dates at UTC noon", () => {
    const d = parseCalendarDate("2026-10-01");
    expect(toCalendarDateString(d)).toBe("2026-10-01");
    expect(d.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("counts stay nights with exclusive checkout", () => {
    expect(stayNightCount("2026-10-01", "2026-10-03")).toBe(2);
    expect(stayNightCount("2026-10-01", "2026-10-01")).toBe(0);
  });

  it("normalizes guest Oct 1–3 range", () => {
    const result = normalizeStayRange("2026-10-01", "2026-10-03", { minNights: 1, maxNights: 30 });
    expect(result).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      valid: true,
    });
  });

  it("bumps checkout when check-in changes invalidate range", () => {
    const result = normalizeStayRange("2026-10-07", "2026-10-08", { minNights: 1 });
    expect(result.startDate).toBe("2026-10-07");
    expect(result.endDate).toBe("2026-10-08");
    expect(result.valid).toBe(true);

    const bumped = normalizeStayRange("2026-10-08", "2026-10-08", { minNights: 1 });
    expect(bumped.endDate).toBe("2026-10-09");
  });

  it("caps guest range at maxNights 30", () => {
    const result = normalizeStayRange("2026-10-01", "2026-11-15", { maxNights: 30, minNights: 1 });
    expect(stayNightCount(result.startDate, result.endDate)).toBeLessThanOrEqual(30);
    expect(result.endDate).toBe(addCalendarDays("2026-10-01", 30));
  });

  it("allows admin ranges longer than 30 days when maxNights omitted", () => {
    const result = normalizeStayRange("2026-09-01", "2026-11-30", { minNights: 0 });
    expect(result.valid).toBe(true);
    expect(stayNightCount(result.startDate, result.endDate)).toBe(90);
  });

  it("respects minDate floor", () => {
    const today = todayIST();
    const result = normalizeStayRange(addCalendarDays(today, -5), addCalendarDays(today, 2), {
      minDate: today,
      minNights: 1,
    });
    expect(result.startDate).toBe(today);
  });

  it("converts between iso strings and DateRange", () => {
    const range = isoRangeToDateRange("2026-10-01", "2026-10-03");
    expect(dateRangeToIso({ from: range.from, to: range.to })).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
  });

  it("uses local calendar parts when formatting DayPicker dates", () => {
    const localMidnight = new Date(2026, 9, 1);
    expect(toCalendarDateString(localMidnight)).toBe("2026-10-01");
  });

  it("keeps checkout empty on partial range selection", () => {
    const partial = applyRangeSelection(
      { from: new Date(2026, 9, 1) },
      { minNights: 1, maxNights: 30 },
    );
    expect(partial).toEqual({
      startDate: "2026-10-01",
      endDate: "",
      complete: false,
      valid: false,
    });
  });

  it("commits guest Oct 1–3 only when range is complete", () => {
    const complete = applyRangeSelection(
      { from: new Date(2026, 9, 1), to: new Date(2026, 9, 3) },
      { minNights: 1, maxNights: 30 },
    );
    expect(complete).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      complete: true,
      valid: true,
    });
  });

  it("allows inclusive same-day admin ranges", () => {
    const sameDay = applyRangeSelection(
      { from: new Date(2026, 8, 15), to: new Date(2026, 8, 15) },
      { minNights: 0 },
    );
    expect(sameDay).toEqual({
      startDate: "2026-09-15",
      endDate: "2026-09-15",
      complete: true,
      valid: true,
    });
  });
});
