import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { accounts, bookingCycleSnapshots, bookingPaymentEvents, bookings, dailyLedger, guestReceipts } from "@/db/schema";
import { receiptBusinessDate } from "@/lib/guestReceipts";

export type OtaPaymentBooking = typeof bookings.$inferSelect;
export type OtaPaymentKind = "collection" | "refund";

export class BookingPaymentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BookingPaymentError";
    this.status = status;
  }
}

/** Converts a decimal rupee amount to paise without whole-rupee rounding. */
export function rupeesToPaise(value: number | string | null | undefined): number {
  const raw = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return Number.NaN;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const paise = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -paise : paise;
}

export function paiseToRupees(value: number): number {
  return Math.round(value) / 100;
}

export function isOtaPostpaidBooking(booking: Partial<OtaPaymentBooking> | null | undefined): boolean {
  return booking?.source === "channel_manager"
    && booking.otaPaymentTerms === "pay_at_hotel"
    && (booking.otaCurrency || "").toUpperCase() === "INR";
}

export function canCollectOtaPayment(booking: Partial<OtaPaymentBooking> | null | undefined): boolean {
  return isOtaPostpaidBooking(booking)
    && ["received", "hold", "checked_in", "checked_out"].includes(booking?.status || "")
    && rupeesToPaise(booking?.amountTotal) > rupeesToPaise(booking?.amountPaid) - rupeesToPaise(booking?.amountRefunded);
}

export function bookingEventMethod(event: Pick<typeof bookingPaymentEvents.$inferSelect, "cashPaise" | "onlinePaise" | "unknownPaise">): string {
  if (event.unknownPaise > 0) return "unknown";
  if (event.cashPaise > 0 && event.onlinePaise > 0) return "split";
  if (event.cashPaise > 0) return "cash";
  if (event.onlinePaise > 0) return "online";
  return "—";
}

function syncSource(): string {
  return process.env.GOKO_RUNTIME === "pi" ? "pi" : "cloudflare";
}

function paymentSnapshot(booking: OtaPaymentBooking) {
  return {
    guestNameSnapshot: booking.guestName,
    bookingRefSnapshot: booking.bookingRef || booking.cmBookingId || "",
    platformSnapshot: booking.platform || "",
    checkinDateSnapshot: booking.checkinDate,
    checkoutDateSnapshot: booking.checkoutDate || "",
  };
}

async function ensureOpenings(tx: Database, booking: OtaPaymentBooking): Promise<void> {
  const cycleEvents = await tx.select({ eventId: bookingPaymentEvents.eventId })
    .from(bookingPaymentEvents)
    .where(and(eq(bookingPaymentEvents.bookingId, booking.id), eq(bookingPaymentEvents.bookingCycle, booking.bookingCycle)));
  // Never seed an opening balance after this cycle has begun journaling. The booking
  // projection already includes those real events, so doing so would duplicate them.
  if (cycleEvents.length > 0) return;
  const now = booking.syncUpdatedAt || booking.createdAt;
  const source = booking.syncSource || syncSource();
  const snapshot = paymentSnapshot(booking);
  const rows: Array<typeof bookingPaymentEvents.$inferInsert> = [];

  const addOpening = (type: OtaPaymentKind, amountRupees: number, method: string, cashRupees: number, tenderRupees: number, changeRupees: number) => {
    const amountPaise = rupeesToPaise(amountRupees);
    if (amountPaise <= 0) return;
    const eventId = `opening-${type}:${booking.syncId}:${booking.bookingCycle}`;
    const cashPaise = method === "cash" ? amountPaise
      : method === "split" ? Math.min(amountPaise, Math.max(0, rupeesToPaise(cashRupees))) : 0;
    const onlinePaise = method === "online" ? amountPaise
      : method === "split" ? Math.max(0, amountPaise - cashPaise) : 0;
    rows.push({
      eventId, syncId: eventId, bookingId: booking.id, bookingCycle: booking.bookingCycle,
      eventType: type, amountPaise,
      cashPaise: type === "refund" ? -cashPaise : cashPaise,
      onlinePaise: type === "refund" ? -onlinePaise : onlinePaise,
      unknownPaise: method === "cash" || method === "online" || method === "split" ? 0 : amountPaise,
      cashTenderPaise: method === "cash" || method === "split" ? Math.max(cashPaise, rupeesToPaise(tenderRupees)) : 0,
      changePaise: method === "cash" ? Math.max(0, rupeesToPaise(changeRupees)) : 0,
      currency: booking.otaCurrency || "INR", otaPaymentTerms: booking.otaPaymentTerms || "pay_at_hotel",
      businessDate: null, isOpening: 1,
      ...snapshot, note: `Legacy opening ${type}`, actor: "migration",
      createdAt: booking.createdAt, syncUpdatedAt: now, syncSource: source,
    });
  };

  addOpening("collection", booking.amountPaid || 0, booking.paymentMethod || "", booking.cashReceived || 0, booking.cashReceived || 0, booking.changeGiven || 0);
  addOpening("refund", booking.amountRefunded || 0, booking.refundMethod || "", booking.refundCash || 0, booking.refundCash || 0, 0);
  if (rows.length) await tx.insert(bookingPaymentEvents).values(rows).onConflictDoNothing();
}

async function movementCoveredByClose(
  tx: Database,
  accountId: number | null,
  businessDate: string,
): Promise<boolean> {
  const close = await tx.select({ id: dailyLedger.id }).from(dailyLedger)
    .where(and(
      accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, accountId),
      gte(dailyLedger.date, businessDate),
      eq(dailyLedger.isReconciled, 1),
    )).limit(1);
  return close.length > 0;
}

export async function recordOtaBookingPayment(input: {
  booking: OtaPaymentBooking;
  eventId: string;
  kind: OtaPaymentKind;
  amountPaise: number;
  cashPaise: number;
  onlinePaise: number;
  cashTenderPaise?: number;
  changePaise?: number;
  accountId?: number | null;
  note?: string;
  actor: string;
  allowedStatuses?: string[];
  statusUpdate?: Partial<typeof bookings.$inferInsert>;
  enforceDue?: boolean;
  enforceRefundCap?: boolean;
}): Promise<{ eventId: string; booking: OtaPaymentBooking; duplicate: boolean }> {
  if (!input.eventId || input.eventId.length > 180) throw new BookingPaymentError("A valid payment operation ID is required");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new BookingPaymentError("Enter an amount greater than ₹0.00");
  if (![input.cashPaise, input.onlinePaise, input.cashTenderPaise || 0, input.changePaise || 0].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new BookingPaymentError("Payment components must be valid paise amounts");
  }
  if (input.cashPaise + input.onlinePaise !== input.amountPaise) throw new BookingPaymentError("Cash and online portions must add up to the payment amount");
  if (input.cashPaise === 0 && ((input.cashTenderPaise || 0) !== 0 || (input.changePaise || 0) !== 0)) {
    throw new BookingPaymentError("Cash tender and change require a cash portion");
  }
  if ((input.cashTenderPaise || 0) < input.cashPaise || (input.cashTenderPaise || 0) - input.cashPaise !== (input.changePaise || 0)) {
    throw new BookingPaymentError("Cash tender must equal the cash amount plus change");
  }
  if (input.onlinePaise > 0) {
    const accountId = Number(input.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) throw new BookingPaymentError("Choose an active receiving account");
    const activeAccount = await getDb().select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).limit(1);
    if (!activeAccount[0]) throw new BookingPaymentError("The selected receiving account is not active");
  } else if (input.accountId) {
    throw new BookingPaymentError("A receiving account is only used for online payments");
  }

  const db = getDb();
  const businessDate = receiptBusinessDate();
  const now = new Date().toISOString();
  const source = syncSource();
  if (process.env.GOKO_RUNTIME === "pi") {
    return recordOtaBookingPaymentPi(input, db as any, businessDate, now, source);
  }
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(bookingPaymentEvents).where(eq(bookingPaymentEvents.eventId, input.eventId)).limit(1);
    if (existing[0]) {
      const row = existing[0];
      const same = row.bookingId === input.booking.id && row.bookingCycle === input.booking.bookingCycle
        && row.eventType === input.kind && row.amountPaise === input.amountPaise
        && row.cashPaise === input.cashPaise && row.onlinePaise === input.onlinePaise
        && row.accountId === (input.onlinePaise > 0 ? Number(input.accountId) : null);
      if (!same) throw new BookingPaymentError("This operation ID was already used for a different payment", 409);
      await repairOnlineReceipt(tx, row);
      const current = await tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).limit(1);
      return { eventId: row.eventId, booking: current[0] || input.booking, duplicate: true };
    }

    const rows = await tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).limit(1);
    const current = rows[0];
    if (!current || !isOtaPostpaidBooking(current)) throw new BookingPaymentError("This is not an eligible INR pay-at-property OTA booking", 409);
    if (!current.syncId) throw new BookingPaymentError("Booking sync identity is missing. Run Server Sync → Backfill Sync IDs before recording OTA payments", 409);
    const allowed = input.allowedStatuses || ["received", "hold", "checked_in", "checked_out"];
    if (!allowed.includes(current.status)) throw new BookingPaymentError("The booking status no longer allows this payment", 409);
    if (current.bookingCycle !== input.booking.bookingCycle) throw new BookingPaymentError("The booking cycle changed. Reload the booking", 409);
    if (input.onlinePaise > 0) {
      const account = await tx.select({ id: accounts.id }).from(accounts).where(and(
        eq(accounts.id, Number(input.accountId)), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0),
      )).limit(1);
      if (!account[0]) throw new BookingPaymentError("The selected receiving account is no longer active", 409);
    }

    await ensureOpenings(tx, current);
    const events = await tx.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.bookingId, current.id), eq(bookingPaymentEvents.bookingCycle, current.bookingCycle),
    ));
    const openingCollection = events.filter((e) => e.eventType === "collection").reduce((sum, e) => sum + e.amountPaise, 0);
    const openingRefund = events.filter((e) => e.eventType === "refund").reduce((sum, e) => sum + e.amountPaise, 0);
    const projectedPaid = paiseToRupees(openingCollection);
    const projectedRefunded = paiseToRupees(openingRefund);
    if (Math.abs(rupeesToPaise(current.amountPaid) - openingCollection) > 0
      || Math.abs(rupeesToPaise(current.amountRefunded) - openingRefund) > 0) {
      throw new BookingPaymentError("The booking payment journal is not ready or needs reconciliation", 409);
    }

    if (input.kind === "collection" && input.enforceDue !== false) {
      const due = Math.max(0, rupeesToPaise(current.amountTotal) - (openingCollection - openingRefund));
      if (input.amountPaise > due) throw new BookingPaymentError("Payment exceeds the current balance", 409);
    }
    if (input.kind === "refund" && input.enforceRefundCap !== false) {
      const total = rupeesToPaise(current.amountTotal);
      const terminal = ["cancelled", "no_show"].includes(current.status)
        || ["cancelled", "no_show"].includes(String(input.statusUpdate?.status || ""));
      const cap = Math.max(0, openingCollection - openingRefund - (terminal ? 0 : total));
      if (input.amountPaise > cap) throw new BookingPaymentError(`Refund exceeds the current refundable balance of ${paiseToRupees(cap).toFixed(2)}`, 409);
    }

    if (await movementCoveredByClose(tx, null, businessDate)) throw new BookingPaymentError("Undo the cash reconciliation for this date before recording a payment", 409);
    if (input.onlinePaise > 0 && await movementCoveredByClose(tx, Number(input.accountId), businessDate)) {
      throw new BookingPaymentError("Undo the receiving account reconciliation for this date before recording a payment", 409);
    }

    const event: typeof bookingPaymentEvents.$inferInsert = {
      eventId: input.eventId, syncId: input.eventId, bookingId: current.id, bookingCycle: current.bookingCycle,
      eventType: input.kind, amountPaise: input.amountPaise, cashPaise: input.kind === "refund" ? -input.cashPaise : input.cashPaise,
      onlinePaise: input.kind === "refund" ? -input.onlinePaise : input.onlinePaise,
      cashTenderPaise: input.cashTenderPaise || 0, changePaise: input.changePaise || 0,
      accountId: input.onlinePaise > 0 ? Number(input.accountId) : null,
      currency: current.otaCurrency || "INR", otaPaymentTerms: current.otaPaymentTerms || "pay_at_hotel",
      businessDate, isOpening: 0, ...paymentSnapshot(current), note: input.note?.trim() || "",
      actor: input.actor, createdAt: now, syncUpdatedAt: now, syncSource: source,
    };

    // The booking row update is a compare-and-set on every financial/lifecycle input.
    // A failed CAS rolls back the event and receipt in this transaction.
    const collectionDelta = input.kind === "collection" ? input.amountPaise : 0;
    const refundDelta = input.kind === "refund" ? input.amountPaise : 0;
    const nextPaid = paiseToRupees(openingCollection + collectionDelta);
    const nextRefunded = paiseToRupees(openingRefund + refundDelta);
    const nextStatus = input.statusUpdate?.status || current.status;
    const progressStatus = openingCollection + collectionDelta - openingRefund - refundDelta >= rupeesToPaise(current.amountTotal)
      ? "paid"
      : current.otaPaymentTerms || current.paymentStatus || "pay_at_hotel";
    const updated = await tx.update(bookings).set({
      amountPaid: nextPaid,
      amountRefunded: nextRefunded,
      paymentStatus: progressStatus,
      paymentOverride: 1,
      paymentMethod: summarizeTender(events, "collection", input),
      cashReceived: paiseToRupees(events.filter((e) => e.eventType === "collection").reduce((sum, e) => sum + e.cashPaise, 0) + (input.kind === "collection" ? input.cashPaise : 0)),
      changeGiven: paiseToRupees(events.filter((e) => e.eventType === "collection").reduce((sum, e) => sum + e.changePaise, 0) + (input.kind === "collection" ? (input.changePaise || 0) : 0)),
      refundMethod: input.kind === "refund" ? summarizeTender(events, "refund", input) : current.refundMethod,
      refundCash: paiseToRupees(events.filter((e) => e.eventType === "refund").reduce((sum, e) => sum + Math.abs(e.cashPaise), 0) + (input.kind === "refund" ? input.cashPaise : 0)),
      refundedAt: input.kind === "refund" ? now : current.refundedAt,
      refundedBy: input.kind === "refund" ? input.actor : current.refundedBy,
      status: nextStatus,
      ...input.statusUpdate,
      syncUpdatedAt: now,
      syncSource: source,
    }).where(and(
      eq(bookings.id, current.id), eq(bookings.bookingCycle, current.bookingCycle),
      eq(bookings.status, current.status),
      current.amountTotal == null ? isNull(bookings.amountTotal) : eq(bookings.amountTotal, current.amountTotal),
      current.amountPaid == null ? isNull(bookings.amountPaid) : eq(bookings.amountPaid, current.amountPaid),
      current.amountRefunded == null ? isNull(bookings.amountRefunded) : eq(bookings.amountRefunded, current.amountRefunded),
      eq(bookings.otaPaymentTerms, current.otaPaymentTerms!), eq(bookings.otaCurrency, current.otaCurrency!),
      eq(bookings.paymentOverride, current.paymentOverride),
      current.paymentStatus == null ? isNull(bookings.paymentStatus) : eq(bookings.paymentStatus, current.paymentStatus),
    )).returning({ id: bookings.id });
    if (!updated[0]) throw new BookingPaymentError("Booking changed while this payment was being recorded. Reload and try again", 409);

    await tx.insert(bookingPaymentEvents).values(event);
    if (input.onlinePaise > 0) await insertOnlineReceipt(tx, event);
    const refreshed = await tx.select().from(bookings).where(eq(bookings.id, current.id)).limit(1);
    return { eventId: input.eventId, booking: refreshed[0], duplicate: false };
  });
}

/** Admin-only correction for a mistaken journal entry where that money did not move. */
export async function correctOtaBookingPayment(input: {
  booking: OtaPaymentBooking;
  eventId: string;
  correctsEventId: string;
  amountPaise: number;
  cashPaise: number;
  onlinePaise: number;
  note: string;
  actor: string;
}): Promise<{ eventId: string; booking: OtaPaymentBooking; duplicate: boolean }> {
  if (!input.eventId || input.eventId.length > 180) throw new BookingPaymentError("A valid correction operation ID is required");
  if (!input.correctsEventId) throw new BookingPaymentError("Choose the original payment event to correct");
  if (!input.note.trim()) throw new BookingPaymentError("Enter a reason for the correction");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0
    || !Number.isSafeInteger(input.cashPaise) || input.cashPaise < 0
    || !Number.isSafeInteger(input.onlinePaise) || input.onlinePaise < 0
    || input.cashPaise + input.onlinePaise !== input.amountPaise) {
    throw new BookingPaymentError("Correction amount and cash/online split must be valid and match");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const source = syncSource();
  if (process.env.GOKO_RUNTIME === "pi") {
    return correctOtaBookingPaymentPi(input, db as any, now, source);
  }
  return db.transaction(async (tx) => {
    const duplicateRows = await tx.select().from(bookingPaymentEvents).where(eq(bookingPaymentEvents.eventId, input.eventId)).limit(1);
    if (duplicateRows[0]) {
      const row = duplicateRows[0];
      const same = row.eventType === "correction" && row.bookingId === input.booking.id
        && row.bookingCycle === input.booking.bookingCycle && row.correctsEventId === input.correctsEventId
        && row.amountPaise === -input.amountPaise
        && Math.abs(row.cashPaise) === input.cashPaise && Math.abs(row.onlinePaise) === input.onlinePaise;
      if (!same) throw new BookingPaymentError("This operation ID was already used for a different correction", 409);
      await repairCorrectionReceipt(tx, row);
      const rows = await tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).limit(1);
      return { eventId: row.eventId, booking: rows[0] || input.booking, duplicate: true };
    }

    const bookingRows = await tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).limit(1);
    const current = bookingRows[0];
    if (!current || !isOtaPostpaidBooking(current) || current.bookingCycle !== input.booking.bookingCycle) {
      throw new BookingPaymentError("The OTA payment cycle changed. Reload the booking", 409);
    }
    if (!current.syncId) throw new BookingPaymentError("Booking sync identity is missing. Run Server Sync → Backfill Sync IDs before correcting OTA payments", 409);
    const originalRows = await tx.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.eventId, input.correctsEventId),
      eq(bookingPaymentEvents.bookingId, current.id),
      eq(bookingPaymentEvents.bookingCycle, current.bookingCycle),
    )).limit(1);
    const original = originalRows[0];
    if (!original || !["collection", "refund"].includes(original.eventType) || original.isOpening || !original.businessDate) {
      throw new BookingPaymentError("Only dated Goko collection/refund events can be corrected", 409);
    }

    const existingCorrections = await tx.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.correctsEventId, original.eventId), eq(bookingPaymentEvents.eventType, "correction"),
    ));
    const correctedAmount = existingCorrections.reduce((sum, event) => sum + Math.abs(event.amountPaise), 0);
    const correctedCash = existingCorrections.reduce((sum, event) => sum + Math.abs(event.cashPaise), 0);
    const correctedOnline = existingCorrections.reduce((sum, event) => sum + Math.abs(event.onlinePaise), 0);
    const remainingAmount = original.amountPaise - correctedAmount;
    const remainingCash = Math.abs(original.cashPaise) - correctedCash;
    const remainingOnline = Math.abs(original.onlinePaise) - correctedOnline;
    if (input.amountPaise > remainingAmount || input.cashPaise > remainingCash || input.onlinePaise > remainingOnline) {
      throw new BookingPaymentError("Correction exceeds the uncorrected amount or tender split", 409);
    }
    if (input.onlinePaise > 0) {
      if (!original.accountId) throw new BookingPaymentError("The original online payment has no receiving account to reverse", 409);
      if (await movementCoveredByClose(tx, original.accountId, original.businessDate)) {
        throw new BookingPaymentError("Undo the receiving account reconciliation covering the original payment before correcting it", 409);
      }
    }
    if (input.cashPaise > 0 && await movementCoveredByClose(tx, null, original.businessDate)) {
      throw new BookingPaymentError("Undo the cash reconciliation covering the original payment before correcting it", 409);
    }

    const reversesCollection = original.eventType === "collection";
    const event: typeof bookingPaymentEvents.$inferInsert = {
      eventId: input.eventId, syncId: input.eventId, bookingId: current.id, bookingCycle: current.bookingCycle,
      eventType: "correction", amountPaise: -input.amountPaise,
      cashPaise: reversesCollection ? -input.cashPaise : input.cashPaise,
      onlinePaise: reversesCollection ? -input.onlinePaise : input.onlinePaise,
      accountId: input.onlinePaise > 0 ? original.accountId : null,
      currency: original.currency, otaPaymentTerms: original.otaPaymentTerms,
      businessDate: original.businessDate, isOpening: 0, correctsEventId: original.eventId,
      guestNameSnapshot: original.guestNameSnapshot, bookingRefSnapshot: original.bookingRefSnapshot,
      platformSnapshot: original.platformSnapshot, checkinDateSnapshot: original.checkinDateSnapshot,
      checkoutDateSnapshot: original.checkoutDateSnapshot, note: input.note.trim(), actor: input.actor,
      createdAt: now, syncUpdatedAt: now, syncSource: source,
    };
    await tx.insert(bookingPaymentEvents).values(event);
    if (input.onlinePaise > 0) await insertCorrectionReceipt(tx, event);
    await rebuildBookingPaymentProjection(current.id, current.bookingCycle, tx);
    const refreshed = await tx.select().from(bookings).where(eq(bookings.id, current.id)).limit(1);
    return { eventId: input.eventId, booking: refreshed[0], duplicate: false };
  });
}

/** better-sqlite3 does not support async transaction callbacks; keep Pi writes fully synchronous. */
function recordOtaBookingPaymentPi(
  input: Parameters<typeof recordOtaBookingPayment>[0],
  database: any,
  businessDate: string,
  now: string,
  source: string,
) {
  return database.transaction((tx: any) => {
    const existing = tx.select().from(bookingPaymentEvents).where(eq(bookingPaymentEvents.eventId, input.eventId)).all()[0];
    if (existing) {
      const same = existing.bookingId === input.booking.id && existing.bookingCycle === input.booking.bookingCycle
        && existing.eventType === input.kind && existing.amountPaise === input.amountPaise
        && existing.cashPaise === (input.kind === "refund" ? -input.cashPaise : input.cashPaise)
        && existing.onlinePaise === (input.kind === "refund" ? -input.onlinePaise : input.onlinePaise)
        && existing.accountId === (input.onlinePaise > 0 ? Number(input.accountId) : null);
      if (!same) throw new BookingPaymentError("This operation ID was already used for a different payment", 409);
      repairOnlineReceiptPi(tx, existing);
      const current = tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).get();
      return { eventId: existing.eventId, booking: current || input.booking, duplicate: true };
    }

    const current = tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).get();
    if (!current || !isOtaPostpaidBooking(current)) throw new BookingPaymentError("This is not an eligible INR pay-at-property OTA booking", 409);
    if (!current.syncId) throw new BookingPaymentError("Booking sync identity is missing. Run Server Sync → Backfill Sync IDs before recording OTA payments", 409);
    const allowed = input.allowedStatuses || ["received", "hold", "checked_in", "checked_out"];
    if (!allowed.includes(current.status)) throw new BookingPaymentError("The booking status no longer allows this payment", 409);
    if (current.bookingCycle !== input.booking.bookingCycle) throw new BookingPaymentError("The booking cycle changed. Reload the booking", 409);
    if (input.onlinePaise > 0 && !tx.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.id, Number(input.accountId)), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0),
    )).get()) throw new BookingPaymentError("The selected receiving account is no longer active", 409);

    ensureOpeningsPi(tx, current);
    const events = tx.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.bookingId, current.id), eq(bookingPaymentEvents.bookingCycle, current.bookingCycle),
    )).all();
    const collected = events.filter((event: any) => event.eventType === "collection").reduce((sum: number, event: any) => sum + event.amountPaise, 0);
    const refunded = events.filter((event: any) => event.eventType === "refund").reduce((sum: number, event: any) => sum + event.amountPaise, 0);
    if (rupeesToPaise(current.amountPaid) !== collected || rupeesToPaise(current.amountRefunded) !== refunded) {
      throw new BookingPaymentError("The booking payment journal is not ready or needs reconciliation", 409);
    }
    if (input.kind === "collection" && input.enforceDue !== false
      && input.amountPaise > Math.max(0, rupeesToPaise(current.amountTotal) - (collected - refunded))) {
      throw new BookingPaymentError("Payment exceeds the current balance", 409);
    }
    if (input.kind === "refund" && input.enforceRefundCap !== false) {
      const terminal = ["cancelled", "no_show"].includes(current.status)
        || ["cancelled", "no_show"].includes(String(input.statusUpdate?.status || ""));
      const cap = Math.max(0, collected - refunded - (terminal ? 0 : rupeesToPaise(current.amountTotal)));
      if (input.amountPaise > cap) throw new BookingPaymentError(`Refund exceeds the current refundable balance of ${paiseToRupees(cap).toFixed(2)}`, 409);
    }
    if (input.cashPaise > 0 && movementCoveredByClosePi(tx, null, businessDate)) {
      throw new BookingPaymentError("Undo the cash reconciliation for this date before recording a payment", 409);
    }
    if (input.onlinePaise > 0 && movementCoveredByClosePi(tx, Number(input.accountId), businessDate)) {
      throw new BookingPaymentError("Undo the receiving account reconciliation for this date before recording a payment", 409);
    }

    const event: typeof bookingPaymentEvents.$inferInsert = {
      eventId: input.eventId, syncId: input.eventId, bookingId: current.id, bookingCycle: current.bookingCycle,
      eventType: input.kind, amountPaise: input.amountPaise,
      cashPaise: input.kind === "refund" ? -input.cashPaise : input.cashPaise,
      onlinePaise: input.kind === "refund" ? -input.onlinePaise : input.onlinePaise,
      cashTenderPaise: input.cashTenderPaise || 0, changePaise: input.changePaise || 0,
      accountId: input.onlinePaise > 0 ? Number(input.accountId) : null,
      currency: current.otaCurrency || "INR", otaPaymentTerms: current.otaPaymentTerms || "pay_at_hotel",
      businessDate, isOpening: 0, ...paymentSnapshot(current), note: input.note?.trim() || "",
      actor: input.actor, createdAt: now, syncUpdatedAt: now, syncSource: source,
    };
    const collections = events.filter((event: any) => event.eventType === "collection");
    const refunds = events.filter((event: any) => event.eventType === "refund");
    const collectionDelta = input.kind === "collection" ? input.amountPaise : 0;
    const refundDelta = input.kind === "refund" ? input.amountPaise : 0;
    const nextPaid = paiseToRupees(collected + collectionDelta);
    const nextRefunded = paiseToRupees(refunded + refundDelta);
    const progressStatus = collected + collectionDelta - refunded - refundDelta >= rupeesToPaise(current.amountTotal)
      ? "paid" : current.otaPaymentTerms || current.paymentStatus || "pay_at_hotel";
    const statusUpdate = input.statusUpdate || {};
    const changes = tx.update(bookings).set({
      amountPaid: nextPaid, amountRefunded: nextRefunded, paymentStatus: progressStatus,
      paymentOverride: 1,
      paymentMethod: summarizeTender(events, "collection", input),
      cashReceived: paiseToRupees(collections.reduce((sum: number, event: any) => sum + event.cashPaise, 0) + (input.kind === "collection" ? input.cashPaise : 0)),
      changeGiven: paiseToRupees(collections.reduce((sum: number, event: any) => sum + event.changePaise, 0) + (input.kind === "collection" ? (input.changePaise || 0) : 0)),
      refundMethod: input.kind === "refund" ? summarizeTender(events, "refund", input) : current.refundMethod,
      refundCash: paiseToRupees(refunds.reduce((sum: number, event: any) => sum + Math.abs(event.cashPaise), 0) + (input.kind === "refund" ? input.cashPaise : 0)),
      refundedAt: input.kind === "refund" ? now : current.refundedAt,
      refundedBy: input.kind === "refund" ? input.actor : current.refundedBy,
      status: statusUpdate.status || current.status, ...statusUpdate,
      syncUpdatedAt: now, syncSource: source,
    }).where(and(
      eq(bookings.id, current.id), eq(bookings.bookingCycle, current.bookingCycle), eq(bookings.status, current.status),
      current.amountTotal == null ? isNull(bookings.amountTotal) : eq(bookings.amountTotal, current.amountTotal),
      current.amountPaid == null ? isNull(bookings.amountPaid) : eq(bookings.amountPaid, current.amountPaid),
      current.amountRefunded == null ? isNull(bookings.amountRefunded) : eq(bookings.amountRefunded, current.amountRefunded),
      eq(bookings.otaPaymentTerms, current.otaPaymentTerms), eq(bookings.otaCurrency, current.otaCurrency),
      eq(bookings.paymentOverride, current.paymentOverride),
      current.paymentStatus == null ? isNull(bookings.paymentStatus) : eq(bookings.paymentStatus, current.paymentStatus),
    )).run();
    if (!changes.changes) throw new BookingPaymentError("Booking changed while this payment was being recorded. Reload and try again", 409);
    tx.insert(bookingPaymentEvents).values(event).run();
    if (input.onlinePaise > 0) insertOnlineReceiptPi(tx, event);
    const refreshed = tx.select().from(bookings).where(eq(bookings.id, current.id)).get();
    return { eventId: input.eventId, booking: refreshed, duplicate: false };
  });
}

function correctOtaBookingPaymentPi(
  input: Parameters<typeof correctOtaBookingPayment>[0],
  database: any,
  now: string,
  source: string,
) {
  return database.transaction((tx: any) => {
    const duplicate = tx.select().from(bookingPaymentEvents).where(eq(bookingPaymentEvents.eventId, input.eventId)).get();
    if (duplicate) {
      const same = duplicate.eventType === "correction" && duplicate.bookingId === input.booking.id
        && duplicate.bookingCycle === input.booking.bookingCycle && duplicate.correctsEventId === input.correctsEventId
        && duplicate.amountPaise === -input.amountPaise && Math.abs(duplicate.cashPaise) === input.cashPaise
        && Math.abs(duplicate.onlinePaise) === input.onlinePaise;
      if (!same) throw new BookingPaymentError("This operation ID was already used for a different correction", 409);
      repairCorrectionReceiptPi(tx, duplicate);
      const current = tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).get();
      return { eventId: duplicate.eventId, booking: current || input.booking, duplicate: true };
    }
    const current = tx.select().from(bookings).where(eq(bookings.id, input.booking.id)).get();
    if (!current || !isOtaPostpaidBooking(current) || current.bookingCycle !== input.booking.bookingCycle) {
      throw new BookingPaymentError("The OTA payment cycle changed. Reload the booking", 409);
    }
    if (!current.syncId) throw new BookingPaymentError("Booking sync identity is missing. Run Server Sync → Backfill Sync IDs before correcting OTA payments", 409);
    const original = tx.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.eventId, input.correctsEventId), eq(bookingPaymentEvents.bookingId, current.id),
      eq(bookingPaymentEvents.bookingCycle, current.bookingCycle),
    )).get();
    if (!original || !["collection", "refund"].includes(original.eventType) || original.isOpening || !original.businessDate) {
      throw new BookingPaymentError("Only dated Goko collection/refund events can be corrected", 409);
    }
    const corrections = tx.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.correctsEventId, original.eventId), eq(bookingPaymentEvents.eventType, "correction"),
    )).all();
    const correctedAmount = corrections.reduce((sum: number, event: any) => sum + Math.abs(event.amountPaise), 0);
    const correctedCash = corrections.reduce((sum: number, event: any) => sum + Math.abs(event.cashPaise), 0);
    const correctedOnline = corrections.reduce((sum: number, event: any) => sum + Math.abs(event.onlinePaise), 0);
    if (input.amountPaise > original.amountPaise - correctedAmount
      || input.cashPaise > Math.abs(original.cashPaise) - correctedCash
      || input.onlinePaise > Math.abs(original.onlinePaise) - correctedOnline) {
      throw new BookingPaymentError("Correction exceeds the uncorrected amount or tender split", 409);
    }
    if (input.onlinePaise > 0 && (!original.accountId || movementCoveredByClosePi(tx, original.accountId, original.businessDate))) {
      throw new BookingPaymentError("Undo the receiving account reconciliation covering the original payment before correcting it", 409);
    }
    if (input.cashPaise > 0 && movementCoveredByClosePi(tx, null, original.businessDate)) {
      throw new BookingPaymentError("Undo the cash reconciliation covering the original payment before correcting it", 409);
    }
    const reversesCollection = original.eventType === "collection";
    const event: typeof bookingPaymentEvents.$inferInsert = {
      eventId: input.eventId, syncId: input.eventId, bookingId: current.id, bookingCycle: current.bookingCycle,
      eventType: "correction", amountPaise: -input.amountPaise,
      cashPaise: reversesCollection ? -input.cashPaise : input.cashPaise,
      onlinePaise: reversesCollection ? -input.onlinePaise : input.onlinePaise,
      accountId: input.onlinePaise > 0 ? original.accountId : null,
      currency: original.currency, otaPaymentTerms: original.otaPaymentTerms,
      businessDate: original.businessDate, isOpening: 0, correctsEventId: original.eventId,
      guestNameSnapshot: original.guestNameSnapshot, bookingRefSnapshot: original.bookingRefSnapshot,
      platformSnapshot: original.platformSnapshot, checkinDateSnapshot: original.checkinDateSnapshot,
      checkoutDateSnapshot: original.checkoutDateSnapshot, note: input.note.trim(), actor: input.actor,
      createdAt: now, syncUpdatedAt: now, syncSource: source,
    };
    tx.insert(bookingPaymentEvents).values(event).run();
    if (input.onlinePaise > 0) insertCorrectionReceiptPi(tx, event);
    rebuildBookingPaymentProjectionPi(tx, current.id, current.bookingCycle, now, source);
    const refreshed = tx.select().from(bookings).where(eq(bookings.id, current.id)).get();
    return { eventId: input.eventId, booking: refreshed, duplicate: false };
  });
}

function ensureOpeningsPi(tx: any, booking: OtaPaymentBooking) {
  if (tx.select({ id: bookingPaymentEvents.id }).from(bookingPaymentEvents).where(and(
    eq(bookingPaymentEvents.bookingId, booking.id), eq(bookingPaymentEvents.bookingCycle, booking.bookingCycle),
  )).get()) return;
  const createdAt = booking.createdAt;
  const source = booking.syncSource || syncSource();
  const snapshot = paymentSnapshot(booking);
  const makeOpening = (type: OtaPaymentKind, amount: number, method: string, cash: number) => {
    const amountPaise = rupeesToPaise(amount);
    if (amountPaise <= 0) return null;
    const cashPaise = method === "cash" ? amountPaise : method === "split" ? Math.min(amountPaise, Math.max(0, rupeesToPaise(cash))) : 0;
    const onlinePaise = method === "online" ? amountPaise : method === "split" ? amountPaise - cashPaise : 0;
    const eventId = `opening-${type}:${booking.syncId}:${booking.bookingCycle}`;
    return {
      eventId, syncId: eventId, bookingId: booking.id, bookingCycle: booking.bookingCycle,
      eventType: type, amountPaise, cashPaise: type === "refund" ? -cashPaise : cashPaise,
      onlinePaise: type === "refund" ? -onlinePaise : onlinePaise,
      unknownPaise: ["cash", "online", "split"].includes(method) ? 0 : amountPaise,
      currency: booking.otaCurrency || "INR", otaPaymentTerms: booking.otaPaymentTerms || "pay_at_hotel",
      businessDate: null, isOpening: 1, ...snapshot, note: `Legacy opening ${type}`, actor: "migration",
      createdAt, syncUpdatedAt: booking.syncUpdatedAt || createdAt, syncSource: source,
    } as typeof bookingPaymentEvents.$inferInsert;
  };
  const rows = [
    makeOpening("collection", booking.amountPaid || 0, booking.paymentMethod || "", booking.cashReceived || 0),
    makeOpening("refund", booking.amountRefunded || 0, booking.refundMethod || "", booking.refundCash || 0),
  ].filter(Boolean);
  if (rows.length) tx.insert(bookingPaymentEvents).values(rows).run();
}

function movementCoveredByClosePi(tx: any, accountId: number | null, businessDate: string): boolean {
  return Boolean(tx.select({ id: dailyLedger.id }).from(dailyLedger).where(and(
    accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, accountId),
    gte(dailyLedger.date, businessDate), eq(dailyLedger.isReconciled, 1),
  )).get());
}

function insertOnlineReceiptPi(tx: any, event: typeof bookingPaymentEvents.$inferInsert) {
  const receiptId = `${event.eventId}:online`;
  tx.insert(guestReceipts).values({
    receiptId, sourceType: "booking", sourceId: event.bookingId!, kind: event.eventType === "refund" ? "refund" : "stay",
    accountId: event.accountId!, amount: event.eventType === "refund" ? -Math.abs(event.onlinePaise || 0) : Math.abs(event.onlinePaise || 0),
    businessDate: event.businessDate!, notes: event.note || `${event.eventType} · ${event.guestNameSnapshot}`,
    createdBy: event.actor!, createdAt: event.createdAt!, bookingEventId: event.eventId!,
    guestNameSnapshot: event.guestNameSnapshot!, bookingRefSnapshot: event.bookingRefSnapshot!,
    platformSnapshot: event.platformSnapshot!, checkinDateSnapshot: event.checkinDateSnapshot!,
    checkoutDateSnapshot: event.checkoutDateSnapshot!, bookingCycleSnapshot: event.bookingCycle!,
    syncId: receiptId, syncUpdatedAt: event.syncUpdatedAt!, syncSource: event.syncSource!,
  }).onConflictDoNothing().run();
}

function repairOnlineReceiptPi(tx: any, event: typeof bookingPaymentEvents.$inferSelect) {
  if (!event.onlinePaise || !event.accountId || !event.businessDate) return;
  if (tx.select({ id: guestReceipts.id }).from(guestReceipts).where(eq(guestReceipts.bookingEventId, event.eventId)).get()) return;
  insertOnlineReceiptPi(tx, event);
}

function insertCorrectionReceiptPi(tx: any, event: typeof bookingPaymentEvents.$inferInsert) {
  if (!event.accountId || !event.onlinePaise) return;
  const receiptId = `${event.eventId}:online`;
  tx.insert(guestReceipts).values({
    receiptId, sourceType: "booking", sourceId: event.bookingId!, kind: "reversal", accountId: event.accountId,
    amount: event.onlinePaise, businessDate: event.businessDate!,
    notes: `Correction for ${event.correctsEventId}: ${event.note}`,
    createdBy: event.actor!, createdAt: event.createdAt!, bookingEventId: event.eventId!,
    guestNameSnapshot: event.guestNameSnapshot!, bookingRefSnapshot: event.bookingRefSnapshot!,
    platformSnapshot: event.platformSnapshot!, checkinDateSnapshot: event.checkinDateSnapshot!,
    checkoutDateSnapshot: event.checkoutDateSnapshot!, bookingCycleSnapshot: event.bookingCycle!,
    syncId: receiptId, syncUpdatedAt: event.syncUpdatedAt!, syncSource: event.syncSource!,
  }).onConflictDoNothing().run();
}

function repairCorrectionReceiptPi(tx: any, event: typeof bookingPaymentEvents.$inferSelect) {
  if (!event.onlinePaise || !event.accountId || !event.businessDate) return;
  if (tx.select({ id: guestReceipts.id }).from(guestReceipts).where(eq(guestReceipts.bookingEventId, event.eventId)).get()) return;
  insertCorrectionReceiptPi(tx, event);
}

function rebuildBookingPaymentProjectionPi(tx: any, bookingId: number, bookingCycle: number, now: string, source: string) {
  const booking = tx.select().from(bookings).where(eq(bookings.id, bookingId)).get();
  if (!booking || booking.bookingCycle !== bookingCycle) return;
  const events = tx.select().from(bookingPaymentEvents).where(and(
    eq(bookingPaymentEvents.bookingId, bookingId), eq(bookingPaymentEvents.bookingCycle, bookingCycle),
  )).all();
  const collections = events.filter((event: any) => event.eventType === "collection");
  const refunds = events.filter((event: any) => event.eventType === "refund");
  const corrections = events.filter((event: any) => event.eventType === "correction");
  const originals = new Map(events.map((event: any) => [event.eventId, event]));
  const related = (type: string) => corrections.filter((event: any) => (originals.get(event.correctsEventId || "") as any)?.eventType === type);
  const collectionCorrections = related("collection");
  const refundCorrections = related("refund");
  const collected = collections.reduce((sum: number, event: any) => sum + event.amountPaise, 0)
    + collectionCorrections.reduce((sum: number, event: any) => sum + event.amountPaise, 0);
  const refunded = refunds.reduce((sum: number, event: any) => sum + event.amountPaise, 0)
    + refundCorrections.reduce((sum: number, event: any) => sum + event.amountPaise, 0);
  const cashCollected = collections.reduce((sum: number, event: any) => sum + event.cashPaise, 0)
    + collectionCorrections.reduce((sum: number, event: any) => sum + event.cashPaise, 0);
  const onlineCollected = collections.reduce((sum: number, event: any) => sum + event.onlinePaise, 0)
    + collectionCorrections.reduce((sum: number, event: any) => sum + event.onlinePaise, 0);
  const cashRefunded = Math.max(0, -refunds.reduce((sum: number, event: any) => sum + event.cashPaise, 0)
    - refundCorrections.reduce((sum: number, event: any) => sum + event.cashPaise, 0));
  const onlineRefunded = Math.max(0, -refunds.reduce((sum: number, event: any) => sum + event.onlinePaise, 0)
    - refundCorrections.reduce((sum: number, event: any) => sum + event.onlinePaise, 0));
  const status = collected - refunded >= rupeesToPaise(booking.amountTotal) ? "paid" : booking.otaPaymentTerms || booking.paymentStatus || "pay_at_hotel";
  tx.update(bookings).set({
    amountPaid: paiseToRupees(collected), amountRefunded: paiseToRupees(refunded),
    paymentStatus: status, paymentOverride: 1,
    paymentMethod: collections.some((event: any) => event.unknownPaise > 0) ? ""
      : cashCollected > 0 && onlineCollected > 0 ? "split" : cashCollected > 0 ? "cash" : onlineCollected > 0 ? "online" : "",
    cashReceived: paiseToRupees(cashCollected), refundCash: paiseToRupees(cashRefunded),
    refundMethod: cashRefunded > 0 && onlineRefunded > 0 ? "split" : cashRefunded > 0 ? "cash" : onlineRefunded > 0 ? "online" : "",
    syncUpdatedAt: now, syncSource: source,
  }).where(and(eq(bookings.id, bookingId), eq(bookings.bookingCycle, bookingCycle))).run();
}

function summarizeTender(
  events: Array<typeof bookingPaymentEvents.$inferSelect>,
  kind: OtaPaymentKind,
  added: { kind: OtaPaymentKind; cashPaise: number; onlinePaise: number },
): string {
  const matching = events.filter((event) => event.eventType === kind);
  const signed = kind === "refund";
  const cash = matching.reduce((sum, event) => sum + (signed ? Math.abs(event.cashPaise) : Math.max(0, event.cashPaise)), 0) + (added.kind === kind ? added.cashPaise : 0);
  const online = matching.reduce((sum, event) => sum + (signed ? Math.abs(event.onlinePaise) : Math.max(0, event.onlinePaise)), 0) + (added.kind === kind ? added.onlinePaise : 0);
  const unknown = matching.reduce((sum, event) => sum + event.unknownPaise, 0);
  if (unknown > 0) return "";
  if (cash && online) return "split";
  if (cash) return "cash";
  if (online) return "online";
  return "";
}

async function insertOnlineReceipt(tx: Database, event: typeof bookingPaymentEvents.$inferInsert) {
  const receiptId = `${event.eventId}:online`;
  await tx.insert(guestReceipts).values({
    receiptId, sourceType: "booking", sourceId: event.bookingId!, kind: event.eventType === "refund" ? "refund" : "stay",
    accountId: event.accountId!, amount: event.eventType === "refund" ? -Math.abs(event.onlinePaise || 0) : Math.abs(event.onlinePaise || 0),
    businessDate: event.businessDate!, notes: event.note || `${event.eventType} · ${event.guestNameSnapshot}`,
    createdBy: event.actor!, createdAt: event.createdAt!, bookingEventId: event.eventId!,
    guestNameSnapshot: event.guestNameSnapshot!, bookingRefSnapshot: event.bookingRefSnapshot!,
    platformSnapshot: event.platformSnapshot!, checkinDateSnapshot: event.checkinDateSnapshot!,
    checkoutDateSnapshot: event.checkoutDateSnapshot!, bookingCycleSnapshot: event.bookingCycle!,
    syncId: receiptId, syncUpdatedAt: event.syncUpdatedAt!, syncSource: event.syncSource!,
  }).onConflictDoNothing();
}

async function repairOnlineReceipt(tx: Database, event: typeof bookingPaymentEvents.$inferSelect) {
  if (event.onlinePaise === 0 || !event.accountId || !event.businessDate) return;
  const existing = await tx.select({ id: guestReceipts.id }).from(guestReceipts).where(eq(guestReceipts.bookingEventId, event.eventId)).limit(1);
  if (existing[0]) return;
  await insertOnlineReceipt(tx, event);
}

async function insertCorrectionReceipt(tx: Database, event: typeof bookingPaymentEvents.$inferInsert) {
  if (!event.accountId || !event.onlinePaise) return;
  const receiptId = `${event.eventId}:online`;
  await tx.insert(guestReceipts).values({
    receiptId, sourceType: "booking", sourceId: event.bookingId!, kind: "reversal",
    accountId: event.accountId, amount: event.onlinePaise,
    businessDate: event.businessDate!, notes: `Correction for ${event.correctsEventId}: ${event.note}`,
    createdBy: event.actor!, createdAt: event.createdAt!, bookingEventId: event.eventId!,
    guestNameSnapshot: event.guestNameSnapshot!, bookingRefSnapshot: event.bookingRefSnapshot!,
    platformSnapshot: event.platformSnapshot!, checkinDateSnapshot: event.checkinDateSnapshot!,
    checkoutDateSnapshot: event.checkoutDateSnapshot!, bookingCycleSnapshot: event.bookingCycle!,
    syncId: receiptId, syncUpdatedAt: event.syncUpdatedAt!, syncSource: event.syncSource!,
  }).onConflictDoNothing();
}

async function repairCorrectionReceipt(tx: Database, event: typeof bookingPaymentEvents.$inferSelect) {
  if (!event.onlinePaise || !event.accountId || !event.businessDate) return;
  const existing = await tx.select({ id: guestReceipts.id }).from(guestReceipts).where(eq(guestReceipts.bookingEventId, event.eventId)).limit(1);
  if (existing[0]) return;
  await insertCorrectionReceipt(tx, event);
}

export async function archiveBookingCycle(booking: OtaPaymentBooking): Promise<void> {
  if (!booking.syncId) throw new BookingPaymentError("Booking sync identity is not ready; cannot archive this cycle", 409);
  const db = getDb();
  const now = new Date().toISOString();
  const snapshotId = `booking-cycle:${booking.syncId}:${booking.bookingCycle}`;
  await db.insert(bookingCycleSnapshots).values({
    snapshotId, syncId: snapshotId, bookingId: booking.id, bookingCycle: booking.bookingCycle,
    guestName: booking.guestName, contact: booking.contact || "", bookingRef: booking.bookingRef || "",
    platform: booking.platform, checkinDate: booking.checkinDate, checkoutDate: booking.checkoutDate || "",
    status: booking.status, bookingCreatedAt: booking.createdAt || "",
    checkedInAt: booking.checkedInAt || "", checkedOutAt: booking.checkedOutAt || "", persons: booking.persons || 1,
    roomType: booking.roomType || "", amountBeforeTaxPaise: rupeesToPaise(booking.amountBeforeTax),
    amountTaxPaise: rupeesToPaise(booking.amountTax), amountTotalPaise: rupeesToPaise(booking.amountTotal),
    amountPaidPaise: rupeesToPaise(booking.amountPaid), amountRefundedPaise: rupeesToPaise(booking.amountRefunded),
    paymentStatus: booking.paymentStatus || "unknown", paymentMethod: booking.paymentMethod || "",
    cashReceivedPaise: rupeesToPaise(booking.cashReceived), refundMethod: booking.refundMethod || "",
    refundCashPaise: rupeesToPaise(booking.refundCash),
    currency: booking.currency || "INR", otaCurrency: booking.otaCurrency, otaPaymentTerms: booking.otaPaymentTerms,
    createdAt: now, syncUpdatedAt: now, syncSource: syncSource(),
  }).onConflictDoNothing();
}

export async function getBookingPaymentEvents(bookingId: number, database: Database = getDb()) {
  const db = database;
  return db.select().from(bookingPaymentEvents).where(eq(bookingPaymentEvents.bookingId, bookingId))
    .orderBy(sql`${bookingPaymentEvents.createdAt} ASC`, sql`${bookingPaymentEvents.id} ASC`);
}

/** Rebuild compatibility fields from the merged append-only journal after Pi/Cloudflare sync. */
export async function rebuildBookingPaymentProjection(
  bookingId: number,
  bookingCycle: number,
  database: Database = getDb(),
): Promise<void> {
  const [bookingRows, events] = await Promise.all([
    database.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1),
    database.select().from(bookingPaymentEvents).where(and(
      eq(bookingPaymentEvents.bookingId, bookingId), eq(bookingPaymentEvents.bookingCycle, bookingCycle),
    )),
  ]);
  const booking = bookingRows[0];
  if (!booking || booking.bookingCycle !== bookingCycle || events.length === 0) return;

  const collectionEvents = events.filter((event) => event.eventType === "collection");
  const refundEvents = events.filter((event) => event.eventType === "refund");
  const corrections = events.filter((event) => event.eventType === "correction");
  const originalById = new Map(events.map((event) => [event.eventId, event]));
  const correctionFor = (eventType: string) => corrections
    .filter((correction) => originalById.get(correction.correctsEventId || "")?.eventType === eventType)
    .reduce((sum, correction) => sum + correction.amountPaise, 0);
  const collectedPaise = collectionEvents.reduce((sum, event) => sum + event.amountPaise, 0) + correctionFor("collection");
  const refundedPaise = refundEvents.reduce((sum, event) => sum + event.amountPaise, 0) + correctionFor("refund");
  const cashCollectedPaise = collectionEvents.reduce((sum, event) => sum + event.cashPaise, 0)
    + corrections.filter((event) => originalById.get(event.correctsEventId || "")?.eventType === "collection").reduce((sum, event) => sum + event.cashPaise, 0);
  const onlineCollectedPaise = collectionEvents.reduce((sum, event) => sum + event.onlinePaise, 0)
    + corrections.filter((event) => originalById.get(event.correctsEventId || "")?.eventType === "collection").reduce((sum, event) => sum + event.onlinePaise, 0);
  const refundCorrections = corrections.filter((event) => originalById.get(event.correctsEventId || "")?.eventType === "refund");
  const cashRefundedPaise = Math.max(0, -refundEvents.reduce((sum, event) => sum + event.cashPaise, 0) - refundCorrections.reduce((sum, event) => sum + event.cashPaise, 0));
  const onlineRefundedPaise = Math.max(0, -refundEvents.reduce((sum, event) => sum + event.onlinePaise, 0) - refundCorrections.reduce((sum, event) => sum + event.onlinePaise, 0));
  const paymentMethod = events.some((event) => event.eventType === "collection" && event.unknownPaise > 0) ? ""
    : cashCollectedPaise > 0 && onlineCollectedPaise > 0 ? "split"
      : cashCollectedPaise > 0 ? "cash" : onlineCollectedPaise > 0 ? "online" : "";
  const refundMethod = cashRefundedPaise > 0 && onlineRefundedPaise > 0 ? "split"
    : cashRefundedPaise > 0 ? "cash" : onlineRefundedPaise > 0 ? "online" : "";
  const paid = paiseToRupees(collectedPaise);
  const refunded = paiseToRupees(refundedPaise);
  const paymentStatus = collectedPaise - refundedPaise >= rupeesToPaise(booking.amountTotal)
    ? "paid" : booking.otaPaymentTerms || booking.paymentStatus || "pay_at_hotel";
  const now = new Date().toISOString();
  await database.update(bookings).set({
    amountPaid: paid,
    amountRefunded: refunded,
    paymentMethod,
    cashReceived: paiseToRupees(cashCollectedPaise),
    refundMethod,
    refundCash: paiseToRupees(cashRefundedPaise),
    paymentStatus,
    paymentOverride: 1,
    syncUpdatedAt: now,
    syncSource: syncSource(),
  }).where(and(eq(bookings.id, bookingId), eq(bookings.bookingCycle, bookingCycle)));
}
