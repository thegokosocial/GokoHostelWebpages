/** Remaining correctable tender on an OTA journal event after prior corrections. */
export function remainingCorrectableOnEvent(
  event: { amountPaise?: number | null; cashPaise?: number | null; onlinePaise?: number | null },
  corrections: Array<{ amountPaise?: number | null; cashPaise?: number | null; onlinePaise?: number | null }>,
): { amountPaise: number; cashPaise: number; onlinePaise: number } {
  const correctedAmount = corrections.reduce((sum, entry) => sum + Math.abs(entry.amountPaise || 0), 0);
  const correctedCash = corrections.reduce((sum, entry) => sum + Math.abs(entry.cashPaise || 0), 0);
  const correctedOnline = corrections.reduce((sum, entry) => sum + Math.abs(entry.onlinePaise || 0), 0);
  const cashPaise = Math.max(0, Math.abs(event.cashPaise || 0) - correctedCash);
  const onlinePaise = Math.max(0, Math.abs(event.onlinePaise || 0) - correctedOnline);
  const amountPaise = Math.min(
    Math.max(0, Math.abs(event.amountPaise || 0) - correctedAmount),
    cashPaise + onlinePaise,
  );
  return { amountPaise, cashPaise, onlinePaise };
}

export type CorrectionAmountParse =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "over_max" }
  | { status: "ok"; amountRupees: number; fullRevert: boolean };

/** Explicit 0 = full remaining; empty stays empty (not full revert). */
export function parseCorrectionAmountInput(raw: string, totalRupees: number): CorrectionAmountParse {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return { status: "empty" };
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) return { status: "invalid" };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { status: "invalid" };
  if (n === 0) return { status: "ok", amountRupees: totalRupees, fullRevert: true };
  if (Math.round(n * 100) > Math.round(totalRupees * 100)) return { status: "over_max" };
  return { status: "ok", amountRupees: n, fullRevert: false };
}

export function correctionDisabledHint(opts: {
  saving: boolean;
  note: string;
  amountParse: CorrectionAmountParse;
  totalRupees: number;
  activeTab: "cash" | "online" | "split";
  splitCashVal: number;
  splitOnlineVal: number;
  splitExact: boolean;
}): string | null {
  if (opts.saving) return null;
  if (!opts.note.trim()) return "Enter a reason";
  if (opts.amountParse.status === "empty") return "Enter an amount (0 = reverse full amount)";
  if (opts.amountParse.status === "invalid") return "Enter a valid amount";
  if (opts.amountParse.status === "over_max") {
    return `Amount cannot exceed ₹${opts.totalRupees.toFixed(2)}`;
  }
  // Full revert uses remaining tender from the original event (panel), not the split inputs.
  if (opts.amountParse.status === "ok" && opts.amountParse.fullRevert) return null;
  if (opts.activeTab === "split") {
    if (!(opts.splitCashVal > 0 && opts.splitOnlineVal > 0)) {
      return "Split needs both cash and online amounts";
    }
    if (!opts.splitExact) return "Split total must match the amount to reverse";
  }
  return null;
}

/** Maps modal confirm payload to journal correction paise (0 or full max → remaining tender). */
export function resolveCorrectionConfirmAmounts(opts: {
  amountToApplyRupees: number;
  maxPaise: number;
  remainingCashPaise: number;
  remainingOnlinePaise: number;
  method: string;
  cashReceivedRupees: number;
}): { amountPaise: number; cashPaise: number; onlinePaise: number } {
  let amountPaise = Math.round((opts.amountToApplyRupees || 0) * 100);
  if (amountPaise === 0 || amountPaise === opts.maxPaise) {
    return {
      amountPaise: opts.maxPaise,
      cashPaise: opts.remainingCashPaise,
      onlinePaise: opts.remainingOnlinePaise,
    };
  }
  const cashPaise = opts.method === "cash"
    ? amountPaise
    : opts.method === "split"
      ? Math.round(opts.cashReceivedRupees * 100)
      : 0;
  return { amountPaise, cashPaise, onlinePaise: amountPaise - cashPaise };
}
