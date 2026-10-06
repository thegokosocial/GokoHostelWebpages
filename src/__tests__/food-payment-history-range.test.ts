import { describe, expect, it } from "vitest";
import { foodPaymentHistoryDateRange } from "@/lib/foodPaymentHistoryRange";

describe("foodPaymentHistoryDateRange", () => {
  it("uses inclusive IST calendar dates across a year boundary", () => {
    expect(foodPaymentHistoryDateRange(7, new Date("2026-01-02T18:00:00.000Z"))).toEqual({
      from: "2025-12-27",
      to: "2026-01-02",
    });
  });

  it("keeps today in a 30-day range", () => {
    expect(foodPaymentHistoryDateRange(30, new Date("2026-10-05T20:00:00.000Z"))).toEqual({
      from: "2026-09-07",
      to: "2026-10-06",
    });
  });
});
