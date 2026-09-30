import { describe, expect, it } from "vitest";
import { calendarMarkersForRange } from "@/lib/calendarMarkers";

describe("calendar markers", () => {
  it("uses Friday and Saturday as weekends, not Sunday", () => {
    const markers = calendarMarkersForRange("2026-08-28", "2026-08-30", []);
    expect(markers["2026-08-28"].weekend).toBe(true);
    expect(markers["2026-08-29"].weekend).toBe(true);
    expect(markers["2026-08-30"].weekend).toBe(false);
  });

  it("matches exact and annual holidays, retaining names that share a date", () => {
    const markers = calendarMarkersForRange("2027-10-31", "2027-11-01", [
      { name: "Diwali", date: "2026-11-01", recurrence: "annual" },
      { name: "Local holiday", date: "2027-11-01", recurrence: "once" },
    ]);
    expect(markers["2027-11-01"].holidays).toEqual(["Diwali", "Local holiday"]);
  });

  it("marks every visible day in a long weekend, including a run that starts before the range", () => {
    const markers = calendarMarkersForRange("2026-10-02", "2026-10-03", [
      { name: "Holiday", date: "2026-10-01", recurrence: "once" },
    ]);
    expect(markers["2026-10-02"]).toMatchObject({ longWeekend: true, longWeekendStart: "2026-10-01", longWeekendEnd: "2026-10-03" });
    expect(markers["2026-10-03"].longWeekend).toBe(true);
  });

  it("bridges Friday and Monday holidays across Sunday, then merges overlapping windows", () => {
    const markers = calendarMarkersForRange("2026-08-28", "2026-08-31", [
      { name: "Friday holiday", date: "2026-08-28", recurrence: "once" },
      { name: "Monday holiday", date: "2026-08-31", recurrence: "once" },
    ]);
    for (const date of ["2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"]) expect(markers[date]).toMatchObject({ longWeekend: true, longWeekendStart: "2026-08-28", longWeekendEnd: "2026-08-31" });
  });

  it("does not bridge a holiday that is neither Friday nor Monday", () => {
    expect(calendarMarkersForRange("2026-08-25", "2026-08-27", [{ name: "Tuesday holiday", date: "2026-08-25", recurrence: "once" }])["2026-08-26"].longWeekend).toBe(false);
  });

  it("does not invent annual leap-day holidays in non-leap years", () => {
    expect(calendarMarkersForRange("2027-02-28", "2027-03-01", [{ name: "Leap day", date: "2024-02-29", recurrence: "annual" }])["2027-02-28"].holidays).toEqual([]);
  });
});
