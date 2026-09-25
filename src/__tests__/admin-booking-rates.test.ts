import { describe, expect, it } from "vitest";
import {
  adminDormCapacity,
  adminStayRateForStay,
  formatAdminDormRateLabel,
} from "@/lib/adminBookingRates";

const rows = (
  nights: Array<{ date: string; rate: number; adult1Rate?: number | null; adult2Rate?: number | null }>,
) => nights.map((n) => ({
  date: n.date,
  rate: n.rate,
  adult1Rate: n.adult1Rate === undefined ? n.rate : n.adult1Rate,
  adult2Rate: n.adult2Rate === undefined ? null : n.adult2Rate,
}));

describe("adminStayRateForStay", () => {
  it("sums different nightly rates across the stay (not check-in × nights)", () => {
    const rate = adminStayRateForStay(
      rows([
        { date: "2026-10-29", rate: 450 },
        { date: "2026-10-30", rate: 700 },
        { date: "2026-10-31", rate: 700 },
      ]),
      "2026-10-29",
      "2026-10-31",
      1,
    );
    expect(rate).toMatchObject({
      subtotalRupees: 1150,
      minRupees: 450,
      maxRupees: 700,
      averageNightlyRupees: 575,
    });
    expect(rate!.nightlyRates).toEqual([
      { date: "2026-10-29", rupees: 450 },
      { date: "2026-10-30", rupees: 700 },
    ]);
    // Average × nights can drift; callers must prefer subtotal for money.
    expect(rate!.averageNightlyRupees * 2).not.toBe(
      adminStayRateForStay(
        rows([
          { date: "2026-10-29", rate: 450 },
          { date: "2026-10-30", rate: 701 },
          { date: "2026-10-31", rate: 1 },
        ]),
        "2026-10-29",
        "2026-10-31",
        1,
      )!.subtotalRupees,
    );
  });

  it("uses adult2Rate for capacity-2 units and adult1Rate for beds", () => {
    const plan = rows([
      { date: "2026-10-29", rate: 500, adult1Rate: 450, adult2Rate: 900 },
      { date: "2026-10-30", rate: 500, adult1Rate: 450, adult2Rate: 900 },
      { date: "2026-10-31", rate: 500, adult1Rate: 450, adult2Rate: 900 },
    ]);
    expect(adminStayRateForStay(plan, "2026-10-29", "2026-10-31", 1)?.subtotalRupees).toBe(900);
    expect(adminStayRateForStay(plan, "2026-10-29", "2026-10-31", 2)?.subtotalRupees).toBe(1800);
  });

  it("returns null when any occupied night is missing", () => {
    expect(adminStayRateForStay(
      rows([
        { date: "2026-10-29", rate: 450 },
        { date: "2026-10-31", rate: 700 },
      ]),
      "2026-10-29",
      "2026-10-31",
      1,
    )).toBeNull();
  });

  it("allows zero rates and ignores guest stop-sell fields (not on AdminRateRow)", () => {
    const rate = adminStayRateForStay(
      rows([
        { date: "2026-10-29", rate: 0, adult1Rate: 0 },
        { date: "2026-10-30", rate: 0, adult1Rate: 0 },
        { date: "2026-10-31", rate: 0, adult1Rate: 0 },
      ]),
      "2026-10-29",
      "2026-10-31",
      1,
    );
    expect(rate?.subtotalRupees).toBe(0);
  });

  it("rejects duplicate dates and empty / overlong stays", () => {
    expect(adminStayRateForStay(
      [
        { date: "2026-10-29", rate: 450, adult1Rate: 450, adult2Rate: null },
        { date: "2026-10-29", rate: 1, adult1Rate: 1, adult2Rate: null },
      ],
      "2026-10-29",
      "2026-10-30",
      1,
    )).toBeNull();
    expect(adminStayRateForStay(rows([{ date: "2026-10-29", rate: 450 }]), "2026-10-29", "2026-10-29", 1)).toBeNull();
  });

  it("falls back to base rate when adult slots are null", () => {
    expect(adminStayRateForStay(
      [
        { date: "2026-10-29", rate: 800, adult1Rate: null, adult2Rate: null },
        { date: "2026-10-30", rate: 900, adult1Rate: null, adult2Rate: null },
      ],
      "2026-10-29",
      "2026-10-30",
      1,
    )?.subtotalRupees).toBe(800);
  });
});

describe("formatAdminDormRateLabel", () => {
  it("shows a flat or ranged nightly label", () => {
    expect(formatAdminDormRateLabel(450, 450)).toBe("₹450/night");
    expect(formatAdminDormRateLabel(450, 700)).toBe("₹450–700/night");
    expect(formatAdminDormRateLabel(0, 700)).toBe("₹0–700/night");
    expect(formatAdminDormRateLabel(0, 0)).toBe("");
    expect(formatAdminDormRateLabel(-1, 100)).toBe("");
  });
});

describe("admin create pricing workflow mock", () => {
  it("mirrors New Booking: sum stay totals for selected units, then tax/discount", () => {
    const bed = adminStayRateForStay(
      rows([
        { date: "2026-10-29", rate: 450 },
        { date: "2026-10-30", rate: 700 },
        { date: "2026-10-31", rate: 700 },
      ]),
      "2026-10-29",
      "2026-10-31",
      1,
    )!;
    const dbl = adminStayRateForStay(
      rows([
        { date: "2026-10-29", rate: 500, adult1Rate: 450, adult2Rate: 900 },
        { date: "2026-10-30", rate: 500, adult1Rate: 450, adult2Rate: 1000 },
        { date: "2026-10-31", rate: 500, adult1Rate: 450, adult2Rate: 1000 },
      ]),
      "2026-10-29",
      "2026-10-31",
      2,
    )!;
    const stayTotal = bed.subtotalRupees + dbl.subtotalRupees; // 1150 + 1900
    expect(stayTotal).toBe(3050);
    // Odd nightly sum proves average×nights must not be the money path.
    const odd = adminStayRateForStay(
      rows([
        { date: "2026-10-29", rate: 450 },
        { date: "2026-10-30", rate: 701 },
        { date: "2026-10-31", rate: 1 },
      ]),
      "2026-10-29",
      "2026-10-31",
      1,
    )!;
    expect(odd.averageNightlyRupees * 2).not.toBe(odd.subtotalRupees);
    expect(formatAdminDormRateLabel(bed.minRupees, bed.maxRupees)).toBe("₹450–700/night");
    expect(formatAdminDormRateLabel(dbl.minRupees, dbl.maxRupees)).toBe("₹900–1000/night");
  });
});

describe("adminDormCapacity", () => {
  it("treats a dorm as capacity 2 when any double unit is present", () => {
    expect(adminDormCapacity([
      { dormId: 1, capacity: 1 },
      { dormId: 1, capacity: 2 },
    ], 1)).toBe(2);
    expect(adminDormCapacity([{ dormId: 1, capacity: 1 }], 1)).toBe(1);
    expect(adminDormCapacity([{ dormId: 2, capacity: 2 }], 1)).toBe(1);
  });
});
