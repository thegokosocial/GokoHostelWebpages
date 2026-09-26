import { describe, expect, it } from "vitest";
import {
  cancellationRate,
  collectionRate,
  computeAdr,
  computeRevpar,
  daysInRangeInclusive,
  formatPercentDelta,
  nextCalendarDate,
  outstandingBalance,
  overlapNightCount,
  percentDelta,
  priorDateRange,
  prorateByOverlapNights,
  shouldShowPickupOccupancyTip,
  showPickupZeroHint,
} from "@/lib/analyticsMetrics";

describe("analyticsMetrics", () => {
  describe("overlapNightCount / prorateByOverlapNights", () => {
    it("counts full stay inside the range", () => {
      expect(overlapNightCount("2026-09-29", "2026-10-02", "2026-09-29", "2026-10-04")).toBe(3);
      expect(prorateByOverlapNights(900, "2026-09-29", "2026-10-02", "2026-09-29", "2026-10-04")).toBe(900);
    });

    it("prorates stays that straddle the range start", () => {
      // Stay 27–30 Sep; range 29 Sep–3 Oct exclusive end 4 Oct → nights 29,30 = 2 of 3
      expect(overlapNightCount("2026-09-27", "2026-09-30", "2026-09-29", "2026-10-04")).toBe(1);
      expect(prorateByOverlapNights(900, "2026-09-27", "2026-09-30", "2026-09-29", "2026-10-04")).toBe(300);
    });

    it("prorates stays that straddle the range end", () => {
      expect(overlapNightCount("2026-10-02", "2026-10-05", "2026-09-29", "2026-10-04")).toBe(2);
      expect(prorateByOverlapNights(1000, "2026-10-02", "2026-10-05", "2026-09-29", "2026-10-04")).toBeCloseTo(666.666, 2);
    });

    it("returns 0 when checkout equals range start (no consumed night)", () => {
      expect(overlapNightCount("2026-09-28", "2026-09-29", "2026-09-29", "2026-10-04")).toBe(0);
      expect(prorateByOverlapNights(500, "2026-09-28", "2026-09-29", "2026-09-29", "2026-10-04")).toBe(0);
    });

    it("counts one night when checkout is the day after from", () => {
      expect(overlapNightCount("2026-09-29", "2026-09-30", "2026-09-29", "2026-10-04")).toBe(1);
    });

    it("returns 0 for invalid or empty overlap", () => {
      expect(overlapNightCount("2026-10-05", "2026-10-06", "2026-09-29", "2026-10-04")).toBe(0);
      expect(prorateByOverlapNights(Number.NaN, "2026-09-29", "2026-10-02", "2026-09-29", "2026-10-04")).toBe(0);
    });
  });

  describe("ADR / RevPAR", () => {
    it("divides booked value by nights / available bed-nights", () => {
      expect(computeAdr(1000, 4)).toBe(250);
      expect(computeRevpar(1000, 10)).toBe(100);
    });

    it("returns 0 when denominators are zero", () => {
      expect(computeAdr(1000, 0)).toBe(0);
      expect(computeRevpar(1000, 0)).toBe(0);
    });
  });

  describe("priorDateRange / daysInRangeInclusive", () => {
    it("preserves inclusive day count and ends the day before fromDate", () => {
      expect(daysInRangeInclusive("2026-09-29", "2026-10-03")).toBe(5);
      expect(priorDateRange("2026-09-29", "2026-10-03")).toEqual({
        fromDate: "2026-09-24",
        toDate: "2026-09-28",
      });
      expect(daysInRangeInclusive("2026-09-24", "2026-09-28")).toBe(5);
    });

    it("handles single-day ranges", () => {
      expect(priorDateRange("2026-10-01", "2026-10-01")).toEqual({
        fromDate: "2026-09-30",
        toDate: "2026-09-30",
      });
    });

    it("nextCalendarDate advances one UTC day", () => {
      expect(nextCalendarDate("2026-09-30")).toBe("2026-10-01");
    });
  });

  describe("rates and deltas", () => {
    it("computes cancellation and collection rates with null when undefined", () => {
      expect(cancellationRate(2, 10)).toBe(20);
      expect(cancellationRate(1, 0)).toBeNull();
      expect(collectionRate(2500, 10000)).toBe(25);
      expect(collectionRate(100, 0)).toBeNull();
    });

    it("computes outstanding without going negative", () => {
      expect(outstandingBalance(10000, 2500)).toBe(7500);
      expect(outstandingBalance(1000, 1500)).toBe(0);
    });

    it("percentDelta handles zero prior", () => {
      expect(percentDelta(110, 100)).toBeCloseTo(10);
      expect(percentDelta(0, 0)).toBe(0);
      expect(percentDelta(50, 0)).toBeNull();
      expect(percentDelta(80, 100)).toBeCloseTo(-20);
    });

    it("formats percent deltas and pickup-zero hint for the UI", () => {
      expect(formatPercentDelta(12.4)).toBe("+12%");
      expect(formatPercentDelta(-3.2)).toBe("-3%");
      expect(formatPercentDelta(null)).toBeNull();
      expect(showPickupZeroHint(0, 36)).toBe(true);
      expect(showPickupZeroHint(2, 36)).toBe(false);
      expect(showPickupZeroHint(0, 0)).toBe(false);
    });

    it("shows pickup tip when occupancy exists on zero-pickup days", () => {
      expect(shouldShowPickupOccupancyTip([
        { bookings: 5, occupancy: 40 },
        { bookings: 0, occupancy: 100 },
      ])).toBe(true);
      expect(shouldShowPickupOccupancyTip([
        { bookings: 2, occupancy: 50 },
        { bookings: 0, occupancy: null },
      ])).toBe(false);
    });
  });
});
