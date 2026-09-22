export type StayPayMethod = "cash" | "online" | "split";

export function isStayPayMethod(v: unknown): v is StayPayMethod {
  return v === "cash" || v === "online" || v === "split";
}

type Amount = number | null | undefined;

export function isPrepaidStatus(v?: string | null): boolean {
  return (v || "").toLowerCase() === "prepaid";
}

/** Hotel-due rupees. Prepaid OTA is never due at the desk (even after check-in records amountPaid). */
export function stayDueAtHotel(
  paymentStatus?: string | null,
  amountTotal: Amount = 0,
  amountPaid: Amount = 0,
  amountRefunded: Amount = 0,
): number {
  if (isPrepaidStatus(paymentStatus)) return 0;
  return Math.max(0, (amountTotal || 0) - ((amountPaid || 0) - (amountRefunded || 0)));
}

export function cashCollected(method?: string | null, amountPaid: Amount = 0, cashReceived: Amount = 0): number {
  const m = (method || "").toLowerCase();
  const paid = amountPaid || 0;
  const cash = cashReceived || 0;
  if (m === "cash") return paid;
  if (m === "split") return Math.max(0, cash);
  return 0;
}

export function onlineCollected(method?: string | null, amountPaid: Amount = 0, cashReceived: Amount = 0): number {
  const m = (method || "").toLowerCase();
  const paid = amountPaid || 0;
  const cash = cashReceived || 0;
  if (m === "online") return paid;
  if (m === "split") return Math.max(0, paid - cash);
  return 0;
}

export function cashRefunded(method?: string | null, amountRefunded: Amount = 0, refundCash: Amount = 0): number {
  const m = (method || "").toLowerCase();
  const refunded = amountRefunded || 0;
  const cash = refundCash || 0;
  if (m === "cash") return refunded;
  if (m === "split") return Math.max(0, cash);
  return 0;
}

export function onlineRefunded(method?: string | null, amountRefunded: Amount = 0, refundCash: Amount = 0): number {
  const m = (method || "").toLowerCase();
  const refunded = amountRefunded || 0;
  const cash = refundCash || 0;
  if (m === "online") return refunded;
  if (m === "split") return Math.max(0, refunded - cash);
  return 0;
}

export function occupiedForRoomRevenue(status?: string | null, checkedInAt?: string | null): boolean {
  if (status === "checked_in" || status === "checked_out") return true;
  if (status === "cancelled" && (checkedInAt || "").length > 0) return true;
  return false;
}

/** Goko till refund ceiling: never more than collected. Later unpaid is 0; prepaid after check-in has amountPaid. */
export function stayRefundCap(amountPaid: Amount): number {
  return Math.max(0, amountPaid || 0);
}

/**
 * Calendar check-in of OTA prepaid: copy total onto amountPaid as online so Room Revenue
 * and cancel-refund see it. paymentStatus stays prepaid. Ingest still leaves amountPaid 0.
 * Returns null when there is nothing to record (not prepaid, ₹0, or already paid).
 */
export function prepaidCheckInWrite(
  paymentStatus?: string | null,
  amountTotal: Amount = 0,
  amountPaid: Amount = 0,
): { amountPaid: number; paymentMethod: "online"; cashReceived: 0; changeGiven: 0 } | null {
  if (!isPrepaidStatus(paymentStatus)) return null;
  const total = amountTotal || 0;
  const paid = amountPaid || 0;
  if (total <= 0 || paid > 0) return null;
  return { amountPaid: total, paymentMethod: "online", cashReceived: 0, changeGiven: 0 };
}

/** Reverse prepaidCheckInWrite on rollbackCheckIn. Leaves real desk collects alone. */
export function prepaidCheckInRollback(booking: {
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  amountTotal?: Amount;
  amountPaid?: Amount;
} | null | undefined): { amountPaid: 0; paymentMethod: ""; cashReceived: 0; changeGiven: 0 } | null {
  if (!booking || !isPrepaidStatus(booking.paymentStatus)) return null;
  if ((booking.paymentMethod || "").toLowerCase() !== "online") return null;
  const total = booking.amountTotal || 0;
  const paid = booking.amountPaid || 0;
  if (paid <= 0 || paid !== total) return null;
  return { amountPaid: 0, paymentMethod: "", cashReceived: 0, changeGiven: 0 };
}

/**
 * Split cash of 0 or the full amount is really Online / Cash.
 * Split cash cannot exceed the amount being applied.
 */
export function coerceStayMethod(
  method: StayPayMethod,
  cashReceived: number,
  amount: number,
): { method: StayPayMethod; cashReceived: number } {
  if (method === "online") return { method: "online", cashReceived: 0 };
  if (method === "cash") return { method: "cash", cashReceived: cashReceived };
  const cap = Math.max(0, amount);
  const cash = Math.max(0, Math.min(cashReceived, cap));
  if (cash <= 0) return { method: "online", cashReceived: 0 };
  if (cash >= cap) return { method: "cash", cashReceived: cap };
  return { method: "split", cashReceived: cash };
}

export function stayRefundWrite(
  method: StayPayMethod,
  refundAmount: number,
  refundCash: Amount,
): { refundMethod: StayPayMethod; refundCash: number } {
  const coerced = coerceStayMethod(method, refundCash || 0, refundAmount);
  return {
    refundMethod: coerced.method,
    refundCash: coerced.method === "cash" ? refundAmount : coerced.cashReceived,
  };
}

/** Apply a full or remainder desk collect. amountPaid becomes amountTotal. */
export function mergeStayCollect(args: {
  existingMethod?: string | null;
  existingCashReceived?: Amount;
  existingPaid?: Amount;
  existingChangeGiven?: Amount;
  amountTotal: Amount;
  newMethod: StayPayMethod;
  newCashReceived: Amount;
  newChangeGiven: Amount;
}): {
  amountPaid: number;
  paymentStatus: "paid";
  paymentMethod: StayPayMethod;
  cashReceived: number;
  changeGiven: number;
} {
  const oldPaid = args.existingPaid || 0;
  const newPaid = args.amountTotal || 0;
  const delta = Math.max(0, newPaid - oldPaid);
  const oldMethod = (args.existingMethod || "").toLowerCase();
  const oldCashRecv = args.existingCashReceived || 0;
  const applied = oldPaid <= 0 ? newPaid : delta;
  const coerced = coerceStayMethod(args.newMethod, args.newCashReceived || 0, applied);
  const method = coerced.method;
  const incomingCash = coerced.cashReceived;
  const newChange = args.newChangeGiven || 0;
  const oldChange = args.existingChangeGiven || 0;

  if (oldPaid <= 0) {
    return {
      amountPaid: newPaid,
      paymentStatus: "paid",
      paymentMethod: method,
      cashReceived: method === "online" ? 0 : incomingCash,
      changeGiven: method === "cash" ? newChange : 0,
    };
  }

  if (oldMethod === method) {
    const cashReceived = method === "split" || method === "cash"
      ? oldCashRecv + incomingCash
      : 0;
    return {
      amountPaid: newPaid,
      paymentStatus: "paid",
      paymentMethod: method,
      cashReceived,
      changeGiven: method === "cash" ? oldChange + newChange : 0,
    };
  }

  const oldCash = cashCollected(oldMethod, oldPaid, oldCashRecv);
  const newCash = cashCollected(method, delta, incomingCash);
  const combined = oldCash + newCash;
  const final = coerceStayMethod("split", combined, newPaid);
  return {
    amountPaid: newPaid,
    paymentStatus: "paid",
    paymentMethod: final.method,
    cashReceived: final.method === "online" ? 0 : final.cashReceived,
    changeGiven: 0,
  };
}
