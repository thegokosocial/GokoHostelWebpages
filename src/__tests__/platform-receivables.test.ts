import { describe, expect, it } from "vitest";
import { allocatePlatformSettlementBatch, bookingAmountsFromRaw, expectedNetPaise, gatewayExpectedNetPaise, parsePlatformAmounts, rupeesToPaise, subtractPlatformAmounts } from "@/lib/platformReceivables";
import { razorpayPaymentSchema } from "@/lib/razorpay";

describe("platform receivables money rules", () => {
  it("deducts Razorpay fee, fee tax and refunds from website settlement expectations", () => {
    expect(gatewayExpectedNetPaise(10000, 500, 250, 45)).toBe(9205);
    expect(gatewayExpectedNetPaise(10000, 500, null, 45)).toBeNull();
    expect(gatewayExpectedNetPaise(10000, 500, 250, null)).toBeNull();
  });
  it("converts decimal rupees exactly", () => {
    expect(rupeesToPaise("450")).toBe(45000);
    expect(rupeesToPaise("22.50")).toBe(2250);
    expect(rupeesToPaise(0.45)).toBe(45);
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
