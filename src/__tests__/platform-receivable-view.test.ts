import { describe, expect, it } from "vitest";
import { matchesReceivableFilters, pruneReceivableSelection, selectedReceivableTotals } from "@/lib/platformReceivableView";

describe("platform receivable list view", () => {
  it("filters inclusively by platform and check-in date", () => {
    expect(matchesReceivableFilters("makemytrip", "2026-09-23", "makemytrip", "2026-09-23", "2026-09-25")).toBe(true);
    expect(matchesReceivableFilters("goibibo", "2026-09-23", "makemytrip", "", "")).toBe(false);
    expect(matchesReceivableFilters("makemytrip", "2026-09-22", "", "2026-09-23", "2026-09-25")).toBe(false);
    expect(matchesReceivableFilters("razorpay-website", null, "", "2026-09-23", "2026-09-25")).toBe(false);
    expect(matchesReceivableFilters("razorpay-website", null, "", "", "")).toBe(true);
  });

  it("totals mixed rows while preserving pending Razorpay signals", () => {
    const totals = selectedReceivableTotals([
      { key: "ota:1:1", grossPaise: 90000, taxChargedPaise: 4500, taxWithheldPaise: 0, commissionPaise: 16200, tdsPaise: 90, tcsPaise: 0, otherDeductionsPaise: 0, expectedNetPaise: 73710, allocatedPaise: 0, outstandingPaise: 73710 },
      { key: "website:pay_1", grossPaise: 10000, taxChargedPaise: 0, taxWithheldPaise: 0, commissionPaise: 200, tdsPaise: 0, tcsPaise: 0, otherDeductionsPaise: 500, expectedNetPaise: null, allocatedPaise: 1000, outstandingPaise: null, pendingCommission: true },
    ], { "ota:1:1": "737.10", "website:pay_1": "bad" });

    expect(totals).toMatchObject({
      grossPaise: 100000, commissionPaise: 16400, otherDeductionsPaise: 500,
      expectedNetPaise: 73710, allocatedPaise: 1000, outstandingPaise: 73710,
      allocationPaise: 73710, pendingCommission: true,
      pendingExpectedNet: true, pendingOutstanding: true,
    });
  });

  it("removes hidden selections and allocation drafts", () => {
    expect(pruneReceivableSelection(["ota:1:1", "ota:2:1"], { "ota:1:1": "10", "ota:2:1": "20" }, ["ota:2:1"]))
      .toEqual({ selected: ["ota:2:1"], amounts: { "ota:2:1": "20" } });
  });
});
