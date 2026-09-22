import { describe, expect, it } from "vitest";
import {
  buildFoodLookupGuests,
  foodTaxPercent,
  foodTaxRateFromAmounts,
  parseFoodCheckoutGraceDays,
} from "@/lib/foodLookup";

describe("food lookup and pricing boundaries", () => {
  it("preserves an explicit zero tax rate and clamps valid percentages", () => {
    expect(foodTaxPercent("0")).toBe(0);
    expect(foodTaxPercent(125)).toBe(100);
    expect(foodTaxPercent(-1)).toBe(5);
    expect(foodTaxPercent("not-a-number")).toBe(5);
  });

  it("derives tax rate safely from zero and positive subtotals", () => {
    expect(foodTaxRateFromAmounts(0, 500)).toBe(0);
    expect(foodTaxRateFromAmounts(10000, 500)).toBe(5);
    expect(foodTaxRateFromAmounts(3000, 100)).toBe(3);
  });

  it("defaults invalid checkout grace settings without hiding zero", () => {
    expect(parseFoodCheckoutGraceDays(undefined)).toBe(10);
    expect(parseFoodCheckoutGraceDays("bad")).toBe(10);
    expect(parseFoodCheckoutGraceDays("0")).toBe(0);
    expect(parseFoodCheckoutGraceDays("3")).toBe(3);
  });

  it("returns active matches before unique checked-out matches", () => {
    expect(buildFoodLookupGuests(
      "9876543210",
      [
        { id: 1, name: "Active", contact: "+91 98765 43210" },
        { id: 2, name: "Other", contact: "9000000000" },
      ],
      [{ guestContact: "9876543210", dormName: "Female", bedId: "F-1" }],
      [
        { id: 1, name: "Old row", contact: "9876543210" },
        { id: 3, name: "Checked out", contact: "9876543210" },
      ],
    )).toEqual([
      { checkinId: 1, name: "Active", phone: "9876543210", roomInfo: "Female - Bed F-1", checkedOut: false },
      { checkinId: 3, name: "Checked out", phone: "9876543210", roomInfo: "", checkedOut: true },
    ]);
  });
});
