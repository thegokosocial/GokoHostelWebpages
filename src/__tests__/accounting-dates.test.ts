import { describe, expect, it } from "vitest";
import { defaultAccountingDateRange, isValidAccountingDateRange, resolveActivityAnchor } from "@/lib/accountingDates";

describe("accounting date ranges", () => {
  it("defaults to the prior month start through today, including year boundaries", () => {
    expect(defaultAccountingDateRange("2026-09-21")).toEqual({ fromDate: "2026-08-01", toDate: "2026-09-21" });
    expect(defaultAccountingDateRange("2026-01-02")).toEqual({ fromDate: "2025-12-01", toDate: "2026-01-02" });
  });

  it("accepts inclusive calendar ranges and rejects invalid or reversed dates", () => {
    expect(isValidAccountingDateRange("2026-08-01", "2026-09-21", "2026-09-21")).toBe(true);
    expect(isValidAccountingDateRange("2026-02-30", "2026-09-21", "2026-09-21")).toBe(false);
    expect(isValidAccountingDateRange("2026-09-22", "2026-09-22", "2026-09-21")).toBe(false);
    expect(isValidAccountingDateRange("2026-09-21", "2026-09-01", "2026-09-21")).toBe(false);
  });

  it("anchors account activity to the newest actual close or opening adjustment", () => {
    expect(resolveActivityAnchor(1000, { date: "2026-09-10", actualClosing: 5000 }, { date: "2026-09-15", openingBalance: 7500 })).toEqual({ date: "2026-09-15", balance: 7500, type: "opening_adjustment", includeAnchorDay: true });
    expect(resolveActivityAnchor(1000, { date: "2026-09-18", actualClosing: 6000 }, { date: "2026-09-15", openingBalance: 7500 })).toEqual({ date: "2026-09-18", balance: 6000, type: "actual_close", includeAnchorDay: false });
    expect(resolveActivityAnchor(1000)).toEqual({ date: null, balance: 1000, type: "opening_balance", includeAnchorDay: true });
  });
});
