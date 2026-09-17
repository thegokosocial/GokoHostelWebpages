import { describe, expect, it } from "vitest";
import { bookingAmountsFromRaw, expectedNetPaise, parsePlatformAmounts, rupeesToPaise, subtractPlatformAmounts } from "@/lib/platformReceivables";

describe("platform receivables money rules", () => {
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

  it("records modifications as deltas, not a second full booking", () => {
    expect(subtractPlatformAmounts(
      { grossPaise: 50000, taxChargedPaise: 2500, taxWithheldPaise: 0, commissionPaise: 9000, tdsPaise: 50, tcsPaise: 0, otherDeductionsPaise: 0 },
      { grossPaise: 45000, taxChargedPaise: 2250, taxWithheldPaise: 0, commissionPaise: 8100, tdsPaise: 45, tcsPaise: 0, otherDeductionsPaise: 0 },
    )).toEqual({ grossPaise: 5000, taxChargedPaise: 250, taxWithheldPaise: 0, commissionPaise: 900, tdsPaise: 5, tcsPaise: 0, otherDeductionsPaise: 0 });
  });
});
