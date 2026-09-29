import { describe, expect, it } from "vitest";
import { recurrenceDate, recurrenceDatesThrough } from "@/lib/recurringExpenses";

describe("recurring expense calendar", () => {
  it("keeps monthly rules anchored to their original day", () => {
    expect(recurrenceDatesThrough("2027-01-31", "monthly", "2027-03-31")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("uses February 28 for leap-day yearly rules", () => {
    expect(recurrenceDate("2028-02-29", "yearly", 1)).toBe("2029-02-28");
  });
  it("moves weekly rules in seven-day increments", () => {
    expect(recurrenceDate("2026-12-29", "weekly", 1)).toBe("2027-01-05");
  });
});
