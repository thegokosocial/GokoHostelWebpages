import { describe, expect, it } from "vitest";
import {
  bookingDiscountRupees,
  bookingTaxPercent,
  bookingTaxApplyEnabled,
  bookingTotals,
  effectiveBookingTaxPercent,
  parseGokoWalkin,
  patchGokoWalkin,
  stringifyGokoWalkin,
  walkinDiscountOnGross,
  nextGokoWalkinRaw,
} from "@/lib/bookingPricing";

describe("bookingPricing", () => {
  it("defaults tax to 5% and rejects negatives", () => {
    expect(bookingTaxPercent(undefined)).toBe(5);
    expect(bookingTaxPercent(null)).toBe(5);
    expect(bookingTaxPercent("")).toBe(5);
    expect(bookingTaxPercent(-1)).toBe(5);
    expect(bookingTaxPercent("12")).toBe(12);
    expect(bookingTaxPercent(0)).toBe(0);
    expect(bookingTaxPercent("0")).toBe(0);
    expect(bookingTaxPercent(150)).toBe(100);
  });

  it("apply flags default on and zero effective tax when off", () => {
    expect(bookingTaxApplyEnabled(null)).toBe(true);
    expect(bookingTaxApplyEnabled(undefined)).toBe(true);
    expect(bookingTaxApplyEnabled("")).toBe(true);
    expect(bookingTaxApplyEnabled("1")).toBe(true);
    expect(bookingTaxApplyEnabled("0")).toBe(false);
    expect(bookingTaxApplyEnabled(false)).toBe(false);
    expect(effectiveBookingTaxPercent("5", null)).toBe(5);
    expect(effectiveBookingTaxPercent("5", "0")).toBe(0);
    expect(effectiveBookingTaxPercent("0", "1")).toBe(0);
    expect(effectiveBookingTaxPercent(8, "false")).toBe(0);
  });

  it("sync allowlist includes booking tax apply keys", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const src = readFileSync("src/lib/syncEngine.ts", "utf8");
    expect(src).toContain('"booking_tax_apply_website"');
    expect(src).toContain('"booking_tax_apply_admin"');
  });

  it("taxes 0% as zero, not the default 5%", () => {
    expect(bookingTotals(1100, { taxPercent: 0 })).toEqual({
      gross: 1100, discount: 0, beforeTax: 1100, tax: 0, total: 1100,
    });
    expect(bookingTotals(1100, { discountPercent: 10, taxPercent: 0 })).toEqual({
      gross: 1100, discount: 110, beforeTax: 990, tax: 0, total: 990,
    });
  });

  it("prefers percent discount over amount and caps at gross", () => {
    expect(bookingDiscountRupees(1100, { percent: 10 })).toBe(110);
    expect(bookingDiscountRupees(1100, { amount: 200 })).toBe(200);
    expect(bookingDiscountRupees(1100, { percent: 10, amount: 9999 })).toBe(110);
    expect(bookingDiscountRupees(1100, { amount: 5000 })).toBe(1100);
    expect(bookingDiscountRupees(1100, {})).toBe(0);
  });

  it("taxes the amount after discount", () => {
    expect(bookingTotals(1100, { taxPercent: 5 })).toEqual({
      gross: 1100, discount: 0, beforeTax: 1100, tax: 55, total: 1155,
    });
    expect(bookingTotals(1100, { discountPercent: 10, taxPercent: 5 })).toEqual({
      gross: 1100, discount: 110, beforeTax: 990, tax: 50, total: 1040,
    });
  });

  it("round-trips gokoWalkin without treating Aiosell payloads as discounts", () => {
    const raw = stringifyGokoWalkin({
      discount: 110,
      discountPercent: 10,
      discountReason: "Loyalty Guest",
      taxPercent: 5,
    });
    expect(parseGokoWalkin(raw)?.discount).toBe(110);
    expect(parseGokoWalkin(JSON.stringify({ action: "book", rooms: [] }))).toBeNull();
    expect(walkinDiscountOnGross(2200, parseGokoWalkin(raw))).toBe(220);
  });

  it("patches walk-in rawData and refuses Aiosell payloads", () => {
    const walkin = stringifyGokoWalkin({ discount: 110, discountPercent: 10, taxPercent: 5 });
    const patched = patchGokoWalkin(walkin, { discount: 220, discountPercent: 10, taxPercent: 5 });
    expect(parseGokoWalkin(patched)?.discount).toBe(220);
    expect(patchGokoWalkin(JSON.stringify({ action: "book", rooms: [] }), { discount: 1, taxPercent: 5 })).toBeNull();
    expect(nextGokoWalkinRaw(
      JSON.stringify({ action: "book" }),
      "channel_manager",
      50,
      5,
    )).toBeUndefined();
    const manual = nextGokoWalkinRaw(walkin, "manual", 220, 8);
    expect(parseGokoWalkin(manual)?.discount).toBe(220);
    expect(parseGokoWalkin(manual)?.taxPercent).toBe(8);
    const cleared = nextGokoWalkinRaw(walkin, "manual", 0, 5, true);
    expect(parseGokoWalkin(cleared)?.discount).toBe(0);
    expect(parseGokoWalkin(cleared)?.discountPercent).toBeUndefined();
  });
});
