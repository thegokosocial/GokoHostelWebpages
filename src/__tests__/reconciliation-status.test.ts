import { describe, expect, it } from "vitest";
import { summarizeReconciliation } from "@/lib/reconciliation";

const accounts = [
  { id: 1, name: "Primary Bank", nickname: "HDFC" },
  { id: 2, name: "Card", nickname: null },
];

describe("summarizeReconciliation", () => {
  it("requires Cash and every active account", () => {
    const status = summarizeReconciliation("2026-09-09", accounts, [
      { accountId: null, isReconciled: 1 },
      { accountId: 1, isReconciled: 1 },
    ]);

    expect(status).toEqual({
      date: "2026-09-09",
      isReconciled: false,
      requiredAccountCount: 3,
      reconciledAccountCount: 2,
      missingAccountNames: ["Card"],
    });
  });

  it("is complete only when every required row is reconciled", () => {
    const status = summarizeReconciliation("2026-09-09", accounts, [
      { accountId: null, isReconciled: 1 },
      { accountId: 1, isReconciled: 1 },
      { accountId: 2, isReconciled: 1 },
    ]);

    expect(status.isReconciled).toBe(true);
    expect(status.missingAccountNames).toEqual([]);
  });

  it("does not require virtual platform accounts", () => {
    const status = summarizeReconciliation("2026-09-09", [
      ...accounts,
      { id: 3, name: "MakeMyTrip Receivable", nickname: "MMT", isVirtual: 1 },
    ], [
      { accountId: null, isReconciled: 1 },
      { accountId: 1, isReconciled: 1 },
      { accountId: 2, isReconciled: 1 },
    ]);
    expect(status.isReconciled).toBe(true);
    expect(status.requiredAccountCount).toBe(3);
  });
});
