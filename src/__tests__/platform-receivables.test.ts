import { describe, expect, it } from "vitest";
import { allocatePlatformSettlementBatch, applyManualGatewayFees, bookingAmountsFromRaw, expectedNetPaise, gatewayExpectedNetPaise, mergeProviderGatewayFees, parsePlatformAmounts, PLATFORM_RECEIVABLE_BACKFILL_FROM, recognizeMissingPlatformBookings, rupeesToPaise, subtractPlatformAmounts } from "@/lib/platformReceivables";
import { razorpayPaymentSchema } from "@/lib/razorpay";
import { readFileSync } from "fs";
import { join } from "path";

describe("platform receivables money rules", () => {
  it("deducts Razorpay fee, fee tax and refunds from website settlement expectations", () => {
    expect(gatewayExpectedNetPaise(10000, 500, 250, 45)).toBe(9205);
    expect(gatewayExpectedNetPaise(10000, 500, null, 45)).toBeNull();
    expect(gatewayExpectedNetPaise(10000, 500, 250, null)).toBeNull();
  });

  it("lets Razorpay provider fee/tax overwrite stored values including prior manual entry", () => {
    const merged = mergeProviderGatewayFees({ feePaise: 100, taxPaise: 18 }, { fee: 236, tax: 36 });
    expect(merged).toEqual({ feePaise: 236, taxPaise: 36, changed: true });
    expect(mergeProviderGatewayFees({ feePaise: 100, taxPaise: null }, { fee: null, tax: 36 }))
      .toEqual({ feePaise: 100, taxPaise: 36, changed: true });
    expect(mergeProviderGatewayFees({ feePaise: 100, taxPaise: 18 }, { fee: undefined, tax: undefined }).changed).toBe(false);
  });

  it("allows manual gateway fee/tax only while the field is still null", () => {
    expect(applyManualGatewayFees({ feePaise: null, taxPaise: null }, { feePaise: 236, taxPaise: 36 }))
      .toEqual({ feePaise: 236, taxPaise: 36 });
    expect(applyManualGatewayFees({ feePaise: 100, taxPaise: null }, { taxPaise: 18 }))
      .toEqual({ feePaise: 100, taxPaise: 18 });
    expect(() => applyManualGatewayFees({ feePaise: 100, taxPaise: null }, { feePaise: 200 }))
      .toThrow(/already verified/);
    expect(() => applyManualGatewayFees({ feePaise: null, taxPaise: null }, {}))
      .toThrow(/Enter a pending/);
  });

  it("treats zero fee and tax as verified provider evidence", () => {
    const merged = mergeProviderGatewayFees({ feePaise: null, taxPaise: null }, { fee: 0, tax: 0 });
    expect(merged).toEqual({ feePaise: 0, taxPaise: 0, changed: true });
    expect(gatewayExpectedNetPaise(10000, 0, 0, 0)).toBe(10000);
    expect(applyManualGatewayFees({ feePaise: null, taxPaise: null }, { feePaise: 0, taxPaise: 0 }))
      .toEqual({ feePaise: 0, taxPaise: 0 });
  });

  it("rejects backfill start dates before the Sep 20 floor", async () => {
    await expect(recognizeMissingPlatformBookings("admin", "2026-09-19"))
      .rejects.toThrow(/on or after 2026-09-20/);
    await expect(recognizeMissingPlatformBookings("admin", "not-a-date"))
      .rejects.toThrow(/on or after 2026-09-20/);
  });

  it("wires platform settlement fee and recognition actions to the documented permissions", () => {
    expect(PLATFORM_RECEIVABLE_BACKFILL_FROM).toBe("2026-09-20");
    const route = readFileSync(join(process.cwd(), "src/app/api/admin/platform-settlements/route.ts"), "utf8");
    expect(route).toContain('adjustActions = new Set(["adjust", "setWebsiteFees", "recognizeMissing"])');
    expect(route).toContain('action === "refreshWebsiteFees"');
    expect(route).toContain('from "@/lib/websiteGatewayFees"');
    expect(route).not.toContain('from "@/lib/nativeGuestCheckout"');
    const ui = readFileSync(join(process.cwd(), "src/components/admin/PlatformReceivables.tsx"), "utf8");
    expect(ui).toContain('call("refreshWebsiteFees"');
    expect(ui).toContain('call("setWebsiteFees"');
    expect(ui).not.toContain('call("recognizeMissing")');
    expect(ui).toContain("websiteCompatible");
    expect(ui).not.toContain("razorpayPayout");
    const checkIn = readFileSync(join(process.cwd(), "src/app/api/admin/bookings/route.ts"), "utf8");
    expect(checkIn).toMatch(/if \(isPrepaidStatus\(detail\.booking\.paymentStatus\)\)[\s\S]*recognizePlatformBooking/);
    expect(checkIn).not.toMatch(/if \(prepaidRecorded > 0\)[\s\S]{0,80}recognizePlatformBooking/);
  });
  it("converts decimal rupees exactly including IEEE float noise from Aiosell numbers", () => {
    expect(rupeesToPaise("450")).toBe(45000);
    expect(rupeesToPaise("22.50")).toBe(2250);
    expect(rupeesToPaise(0.45)).toBe(45);
    expect(rupeesToPaise(448.20000000000005)).toBe(44820);
    expect(rupeesToPaise(81)).toBe(8100);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(/Invalid monetary amount/);
  });

  it("calculates expected payout without treating guest tax as a platform deduction by default", () => {
    expect(expectedNetPaise({
      grossPaise: 45000,
      taxChargedPaise: 2250,
      taxWithheldPaise: 0,
      commissionPaise: 8100,
      tdsPaise: 45,
      tcsPaise: 0,
      otherDeductionsPaise: 0,
    }, { taxCharged: false, taxWithheld: true, commission: true, tds: true, tcs: true, otherDeductions: true })).toBe(36855);
  });

  it("extracts deductions from the real Aiosell booking payload", () => {
    const amounts = bookingAmountsFromRaw(JSON.stringify({ amount: {
      amountAfterTax: 450,
      amountBeforeTax: 427.5,
      tax: 22.5,
      commission: 81,
      tcs: 0,
      tds: 0.45,
    } }));
    expect(amounts).toEqual({
      grossPaise: 45000,
      taxChargedPaise: 2250,
      taxWithheldPaise: 0,
      commissionPaise: 8100,
      tdsPaise: 45,
      tcsPaise: 0,
      otherDeductionsPaise: 0,
    });
    expect(expectedNetPaise(amounts, { taxCharged: false, taxWithheld: true, commission: true, tds: true, tcs: true, otherDeductions: true })).toBe(36855);
  });

  it("rejects non-integer platform ledger amounts", () => {
    expect(() => parsePlatformAmounts({ grossPaise: "450.5" })).toThrow("Invalid platform amount: grossPaise");
  });

  it("rejects malformed multi-booking payout allocations before database access", async () => {
    await expect(allocatePlatformSettlementBatch({ settlementId: 1, actor: "Admin", allocations: [
      { bookingId: 1, bookingCycle: 1, allocatedPaise: 0 },
    ] })).rejects.toThrow("Allocation must be positive paise");
    await expect(allocatePlatformSettlementBatch({ settlementId: 1, actor: "Admin", allocations: [
      { bookingId: 1, bookingCycle: 1, allocatedPaise: 100 },
      { bookingId: 1, bookingCycle: 1, allocatedPaise: 100 },
    ] })).rejects.toThrow("unique");
  });

  it("accepts optional verified gateway fee and tax evidence on captured payments", () => {
    const payment = razorpayPaymentSchema.parse({ entity: "payment", id: "pay_1234567890", order_id: "order_1234567890", amount: 10000, currency: "INR", status: "captured", captured: true, amount_refunded: 0, fee: 236, tax: 36 });
    expect(payment.fee).toBe(236);
    expect(payment.tax).toBe(36);
  });

  it("records modifications as deltas, not a second full booking", () => {
    expect(subtractPlatformAmounts(
      { grossPaise: 50000, taxChargedPaise: 2500, taxWithheldPaise: 0, commissionPaise: 9000, tdsPaise: 50, tcsPaise: 0, otherDeductionsPaise: 0 },
      { grossPaise: 45000, taxChargedPaise: 2250, taxWithheldPaise: 0, commissionPaise: 8100, tdsPaise: 45, tcsPaise: 0, otherDeductionsPaise: 0 },
    )).toEqual({ grossPaise: 5000, taxChargedPaise: 250, taxWithheldPaise: 0, commissionPaise: 900, tdsPaise: 5, tcsPaise: 0, otherDeductionsPaise: 0 });
  });
});
