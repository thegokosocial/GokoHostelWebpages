import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  correctionDisabledHint,
  parseCorrectionAmountInput,
  remainingCorrectableOnEvent,
  resolveCorrectionConfirmAmounts,
} from "@/lib/otaPaymentCorrectionUi";
import {
  isRedundantOtaMoneyHistoryAction,
  OTA_MONEY_HISTORY_ACTIONS,
} from "@/lib/otaPaymentHistory";

describe("parseCorrectionAmountInput", () => {
  it("treats explicit 0 as full remaining revert", () => {
    expect(parseCorrectionAmountInput("0", 1)).toEqual({ status: "ok", amountRupees: 1, fullRevert: true });
    expect(parseCorrectionAmountInput("0.00", 1.5)).toEqual({ status: "ok", amountRupees: 1.5, fullRevert: true });
  });

  it("does not treat empty as full revert", () => {
    expect(parseCorrectionAmountInput("", 1)).toEqual({ status: "empty" });
    expect(parseCorrectionAmountInput("   ", 1)).toEqual({ status: "empty" });
  });

  it("rejects over-max and invalid amounts", () => {
    expect(parseCorrectionAmountInput("2", 1)).toEqual({ status: "over_max" });
    expect(parseCorrectionAmountInput("-1", 1)).toEqual({ status: "invalid" });
    expect(parseCorrectionAmountInput("abc", 1)).toEqual({ status: "invalid" });
  });

  it("accepts partial amounts within the max", () => {
    expect(parseCorrectionAmountInput("0.50", 1)).toEqual({ status: "ok", amountRupees: 0.5, fullRevert: false });
    expect(parseCorrectionAmountInput("1", 1)).toEqual({ status: "ok", amountRupees: 1, fullRevert: false });
  });
});

describe("correctionDisabledHint", () => {
  const base = {
    saving: false,
    note: "Mistaken entry",
    amountParse: { status: "ok" as const, amountRupees: 1, fullRevert: true },
    totalRupees: 1,
    activeTab: "online" as const,
    splitCashVal: 0,
    splitOnlineVal: 0,
    splitExact: false,
  };

  it("requires a reason before amount checks", () => {
    expect(correctionDisabledHint({ ...base, note: "" })).toBe("Enter a reason");
  });

  it("explains empty, over-max, and allows full-revert 0 without split fields", () => {
    expect(correctionDisabledHint({ ...base, amountParse: { status: "empty" } })).toBe(
      "Enter an amount (0 = reverse full amount)",
    );
    expect(correctionDisabledHint({ ...base, amountParse: { status: "over_max" } })).toBe(
      "Amount cannot exceed ₹1.00",
    );
    expect(correctionDisabledHint({ ...base, activeTab: "split" })).toBeNull();
  });

  it("requires split inputs for partial split reversals", () => {
    expect(correctionDisabledHint({
      ...base,
      activeTab: "split",
      amountParse: { status: "ok", amountRupees: 0.5, fullRevert: false },
      splitCashVal: 0,
      splitOnlineVal: 0.5,
      splitExact: false,
    })).toBe("Split needs both cash and online amounts");
  });
});

describe("remainingCorrectableOnEvent", () => {
  it("nets prior corrections from amount and tender", () => {
    expect(remainingCorrectableOnEvent(
      { amountPaise: 10000, cashPaise: 4000, onlinePaise: 6000 },
      [{ amountPaise: -2000, cashPaise: -1000, onlinePaise: -1000 }],
    )).toEqual({ amountPaise: 8000, cashPaise: 3000, onlinePaise: 5000 });
  });

  it("reaches zero after a full correction so the Revert button disappears", () => {
    expect(remainingCorrectableOnEvent(
      { amountPaise: 100, cashPaise: 0, onlinePaise: 100 },
      [{ amountPaise: -100, cashPaise: 0, onlinePaise: -100 }],
    )).toEqual({ amountPaise: 0, cashPaise: 0, onlinePaise: 0 });
  });
});

describe("resolveCorrectionConfirmAmounts", () => {
  it("maps UI 0 or full max to remaining tender (full revert)", () => {
    expect(resolveCorrectionConfirmAmounts({
      amountToApplyRupees: 0,
      maxPaise: 100,
      remainingCashPaise: 40,
      remainingOnlinePaise: 60,
      method: "online",
      cashReceivedRupees: 0,
    })).toEqual({ amountPaise: 100, cashPaise: 40, onlinePaise: 60 });

    expect(resolveCorrectionConfirmAmounts({
      amountToApplyRupees: 1,
      maxPaise: 100,
      remainingCashPaise: 40,
      remainingOnlinePaise: 60,
      method: "split",
      cashReceivedRupees: 0.1,
    })).toEqual({ amountPaise: 100, cashPaise: 40, onlinePaise: 60 });
  });

  it("keeps partial online and split tender from the modal method", () => {
    expect(resolveCorrectionConfirmAmounts({
      amountToApplyRupees: 0.5,
      maxPaise: 100,
      remainingCashPaise: 40,
      remainingOnlinePaise: 60,
      method: "online",
      cashReceivedRupees: 0,
    })).toEqual({ amountPaise: 50, cashPaise: 0, onlinePaise: 50 });

    expect(resolveCorrectionConfirmAmounts({
      amountToApplyRupees: 0.5,
      maxPaise: 100,
      remainingCashPaise: 40,
      remainingOnlinePaise: 60,
      method: "split",
      cashReceivedRupees: 0.2,
    })).toEqual({ amountPaise: 50, cashPaise: 20, onlinePaise: 30 });
  });
});

describe("OTA money history dedupe and Revert button scope", () => {
  it("recognizes legacy dual-write actions", () => {
    for (const action of OTA_MONEY_HISTORY_ACTIONS) {
      expect(isRedundantOtaMoneyHistoryAction(action)).toBe(true);
    }
    expect(isRedundantOtaMoneyHistoryAction("Marked No-Show")).toBe(false);
  });

  it("modal defaults correction amount to 0 and shows disabled hints", () => {
    const modal = readFileSync("src/components/admin/RecordPaymentModal.tsx", "utf8");
    expect(modal).toContain('correction ? "0"');
    expect(modal).toContain("Revert mistaken payment");
    expect(modal).toContain("disabledHint");
    expect(modal).toContain("parseCorrectionAmountInput");
  });

  it("only offers Revert on collection/refund rows, never on correction events", () => {
    const panel = readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8");
    expect(panel).toContain('["collection", "refund"].includes(event.eventType)');
    expect(panel).toContain("resolveCorrectionConfirmAmounts");
    expect(panel).toContain("isRedundantOtaMoneyHistoryAction");
    expect(panel).not.toMatch(/eventType === "correction"[^\n]*canCorrect/);
  });

  it("audit merge filters redundant OTA money history and keeps journal corrections", () => {
    const route = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
    expect(route).toContain("isRedundantOtaMoneyHistoryAction(entry.action)");
    expect(route).toContain('event.eventType === "correction" ? "OTA payment corrected"');
    expect(route).toContain("username: event.actor || \"system\"");
  });
});
