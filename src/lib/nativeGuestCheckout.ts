import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  nativeBookingCheckouts as checkouts, nativeBookingPayments as payments,
  nativeBookingRefunds as refunds, nativeBookingWebhooks as hooks, bookings,
  nativeInventoryHolds as holds, nativeAcceptedQuotes as quotes, bookingBedAssignments,
} from "@/db/schema";
import {
  addBooking, assignBedToBooking, getAllBeds, getAllDailyRates, getAllDorms, getAvailableBedsForRange,
  getRatePlanMappings, getRoomTypeMappings, getSetting, transitionBookingStatus, unassignBookingBeds,
  unassignBookingBedsByBedIds, updateBookingFull, addBookingHistoryEntry, getBookingHistoryEntries,
} from "@/db/queries";
import { BOOKING_TAX_SETTING } from "@/lib/bookingPricing";
import { generateGokoBookingId, generateGuestAccessToken, hashToken } from "@/lib/bookingReference";
import { guestRateForStay, guestTaxPercent, searchGuestRooms } from "@/lib/guestBookingSearch";
import {
  guestActionFlags, maskGuestEmail, maskGuestPhone, roomLinesFromAssignments, roomLinesFromQuote,
} from "@/lib/guestBookingDetails";
import { occupiedNights, sellableUnits, type InventoryPool } from "@/lib/inventoryAvailability";
import { acceptNativeQuote } from "@/lib/nativeAcceptedQuote";
import { calculateNativeCancellationRefund, buildNativeBookingQuote } from "@/lib/nativeBookingQuote";
import {
  createNativeInventoryHold, getNativeSelectionAvailability,
  releaseNativeInventoryHold, renewNativeInventoryHoldLease, clampHoldSeconds,
} from "@/lib/nativeInventoryHold";
import { evaluateNativeCheckoutReadiness } from "@/lib/nativeCheckoutReadiness";
import { afterResponse } from "@/lib/afterResponse";
import { otaFingerprint, pushIfOtaChanged } from "@/lib/aiosellSync";
import { sendBookingAmendedEmail, sendBookingConfirmationEmail } from "@/lib/email";
import { isPiRuntime } from "@/lib/runtime";
import {
  RazorpayError, razorpayCredentials, createRazorpayBookingOrder, findRazorpayBookingOrders,
  fetchRazorpayBookingPayment, fetchRazorpayBookingOrderPayments, createRazorpayBookingRefund,
  fetchRazorpayBookingRefunds, verifyCheckoutSignature, verifyRazorpaySignature, razorpayId,
  allRazorpayWebhookSecrets, type RazorpayEnvironment, type RazorpayPayment, type RazorpayRefund,
} from "@/lib/razorpay";
import {
  readWebsiteBookingSettings, websiteBookingSettingsRevision, WEBSITE_BOOKING_SETTINGS_KEY,
} from "@/lib/websiteBookingSettings";
import { mergeWebsiteCheckoutRaw, parseWebsiteCheckout } from "@/lib/websiteCheckoutSnapshot";
import { todayIST } from "@/lib/utils";

type Checkout = typeof checkouts.$inferSelect;
const timestamp = () => new Date().toISOString();
const receiptFor = (id: string) => `gbk_${id.replace(/-/g, "").slice(0, 32)}`;
const checkoutEnv = (row: Checkout): RazorpayEnvironment =>
  row.environment === "live" ? "live" : "test";

function isNativeHoldConflictError(error: unknown): boolean {
  const parts = [
    error instanceof Error ? error.message : String(error ?? ""),
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "",
  ].join(" ");
  return parts.includes("NATIVE_HOLD_CONFLICT");
}

function unfulfilledDetail(prefix: string, error: unknown): string {
  const hint = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 180) : "unknown";
  return `${prefix} (${hint})`;
}

/** Assign one sellable unit; soft-fail on occupancy miss or NATIVE_HOLD_CONFLICT so alts can run. */
async function tryAssignUnitSoft(opts: {
  bookingId: number;
  ids: number[];
  pool: InventoryPool;
  checkinDate: string;
  checkoutDate: string;
  bedMeta: Map<number, { id: number; dormId: number }>;
}): Promise<boolean> {
  const written: number[] = [];
  for (const bedId of opts.ids) {
    const bed = opts.bedMeta.get(bedId);
    if (!bed) {
      if (written.length) await unassignBookingBedsByBedIds(opts.bookingId, written);
      return false;
    }
    try {
      const ok = await assignBedToBooking({
        bookingId: opts.bookingId, bedId, dormId: bed.dormId,
        checkinDate: opts.checkinDate, checkoutDate: opts.checkoutDate,
        assignedBy: "website", inventoryPool: opts.pool,
      });
      if (!ok) {
        if (written.length) await unassignBookingBedsByBedIds(opts.bookingId, written);
        return false;
      }
      written.push(bedId);
    } catch (error) {
      if (written.length) await unassignBookingBedsByBedIds(opts.bookingId, written);
      if (isNativeHoldConflictError(error)) return false;
      throw error;
    }
  }
  return true;
}

async function snapshotWebsiteOntoBooking(
  bookingId: number,
  row: Checkout,
  opts: { orphanCapture?: boolean; quoteJson?: string | null } = {},
) {
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return;
  const payRows = await getDb().select().from(payments).where(eq(payments.checkoutId, row.id));
  const captured = payRows.filter((p) => p.captured === 1);
  let quoteSummary: { nights: number; beforeTax: number; tax: number; total: number; unitsLabel?: string } | undefined;
  const quoteJson = opts.quoteJson;
  if (quoteJson) {
    try {
      const q = JSON.parse(quoteJson) as {
        beforeTaxRupees?: number; taxRupees?: number; totalRupees?: number;
        checkinDate?: string; checkoutDate?: string;
        units?: Array<{ key: string }>;
      };
      const nights = q.checkinDate && q.checkoutDate
        ? occupiedNights(q.checkinDate, q.checkoutDate).length
        : 0;
      quoteSummary = {
        nights,
        beforeTax: Number(q.beforeTaxRupees || 0),
        tax: Number(q.taxRupees || 0),
        total: Number(q.totalRupees || 0),
        unitsLabel: (q.units || []).map((u) => u.key).join(", ") || undefined,
      };
    } catch { /* ignore */ }
  }
  const dueAtPropertyPaise = Math.max(
    0,
    Math.round(Number(booking.amountTotal || 0) * 100) - Math.round(Number(booking.amountPaid || 0) * 100),
  );
  const rawData = mergeWebsiteCheckoutRaw(booking.rawData, {
    paymentChoice: row.paymentChoice,
    checkoutId: row.id,
    checkoutState: row.state,
    gatewayEnvironment: row.environment,
    razorpayOrderId: row.razorpayOrderId,
    paymentIds: payRows.map((p) => p.id),
    dueNowPaise: row.dueNowPaise,
    dueAtPropertyPaise,
    capturedPaise: captured.reduce((s, p) => s + p.amountPaise, 0),
    orphanCapture: opts.orphanCapture === true,
    receipt: row.receipt,
    holdId: row.holdId,
    acceptedQuoteId: row.acceptedQuoteId,
    quoteSummary,
  });
  await updateBookingFull(bookingId, { rawData });
}

/** After cancel: if money was captured, stamp booking for admin refund / Razorpay lookup. */
async function applyOrphanCaptureIfNeeded(row: Checkout) {
  if (!row.bookingId) return false;
  const captured = await getDb().select().from(payments)
    .where(and(eq(payments.checkoutId, row.id), eq(payments.captured, 1)));
  if (!captured.length) return false;
  const paidRupees = captured.reduce((s, p) => s + p.amountPaise, 0) / 100;
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
  if (!booking) return false;
  let quoteJson: string | null = null;
  if (row.acceptedQuoteId) {
    const [q] = await getDb().select().from(quotes).where(eq(quotes.id, row.acceptedQuoteId)).limit(1);
    quoteJson = q?.quoteJson ?? null;
  }
  await updateBookingFull(row.bookingId, {
    amountPaid: Math.max(Number(booking.amountPaid || 0), paidRupees),
    paymentStatus: "paid",
    paymentMethod: row.environment === "live" ? "razorpay_live" : "razorpay_test",
  });
  const already = parseWebsiteCheckout(booking.rawData)?.orphanCapture
    || (await getBookingHistoryEntries(row.bookingId)).some((h) => h.action === "website_orphan_capture");
  if (!already) {
    await addBookingHistoryEntry({
      bookingId: row.bookingId,
      action: "website_orphan_capture",
      details: `Payment captured after guest saw booking not confirmed; checkout ${row.id}; refund manually`,
      performedBy: "website",
    });
  }
  const fresh = await getCheckoutById(row.id);
  await snapshotWebsiteOntoBooking(row.bookingId, { ...fresh, state: "cancelled" }, {
    orphanCapture: true,
    quoteJson,
  });
  return true;
}

const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/);
const token64 = z.string().regex(/^[a-f0-9]{64}$/);
const roomsSchema = z.array(z.object({
  roomId: z.string().regex(/^\d+-(Double|Bed)$/),
  quantity: z.number().int().min(1).max(4),
  ratePlanId: z.number().int().positive(),
}).strict()).min(1).max(4);
const selectionSchema = z.object({
  requestKey: z.string().uuid(),
  checkinDate: date, checkoutDate: date,
  paymentChoice: z.enum(["advance", "full", "property"]),
  guest: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(1).max(30),
  }).strict(),
  rooms: roomsSchema,
}).strict();
const amendSelectionSchema = z.object({
  requestKey: z.string().uuid(),
  reference: z.string().trim().min(1).max(64),
  guestAccessToken: token64,
  checkinDate: date, checkoutDate: date,
  rooms: roomsSchema,
}).strict();
const amendAuthSchema = z.object({
  reference: z.string().trim().min(1).max(64),
  guestAccessToken: token64,
}).strict();

export class GuestCheckoutError extends Error {
  constructor(message: string, public status = 409) {
    super(message); this.name = "GuestCheckoutError";
  }
}
function cloudOnly() {
  if (isPiRuntime()) throw new GuestCheckoutError("Guest checkout is available on the Goko website only", 403);
}
async function sha(s: string) { return hashToken(s); }

export type AllocatedUnit = {
  key: string; dormId: number; type: "Double" | "Bed"; bedIds: number[];
  ratePlanId: number; nightlyRates: { date: string; rupees: number }[];
};

/** Expand guest room keys (`dormId-type`) into ≤4 physical bed IDs. Never trusts client bed IDs. */
export async function allocateGuestSelection(input: {
  checkinDate: string; checkoutDate: string;
  rooms: { roomId: string; quantity: number; ratePlanId: number }[];
  excludeBookingId?: number;
}): Promise<{ bedIds: number[]; units: AllocatedUnit[] }> {
  const avail = await getNativeSelectionAvailability({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    excludeBookingId: input.excludeBookingId,
  });
  const [mappings, plans, daily] = await Promise.all([
    getRoomTypeMappings(), getRatePlanMappings(), getAllDailyRates(input.checkinDate, input.checkoutDate),
  ]);
  const today = todayIST();
  const units: AllocatedUnit[] = [];
  const used = new Set<number>();
  for (const req of input.rooms) {
    const [dormPart, type] = req.roomId.split("-") as [string, "Double" | "Bed"];
    const dormId = Number(dormPart);
    const pool = avail.units.filter((u) => u.dormId === dormId && u.type === type
      && u.bedIds.every((id) => id != null && !used.has(id)));
    if (pool.length < req.quantity) throw new GuestCheckoutError("Selected rooms are no longer available", 409);
    const activeMappings = mappings.filter((m) => m.dormId === dormId && m.isActive === 1);
    if (activeMappings.length !== 1) throw new GuestCheckoutError("Room rates are not configured for checkout", 503);
    const plan = plans.find((p) => p.id === req.ratePlanId && p.roomMappingId === activeMappings[0].id && p.isActive === 1);
    if (!plan) throw new GuestCheckoutError("Selected rate plan is not available", 400);
    const rows = daily.filter((r) => r.ratePlanId === plan.id);
    const capacity = type === "Double" ? 2 : 1;
    const rate = guestRateForStay(rows, input.checkinDate, input.checkoutDate, capacity, today);
    if (!rate) throw new GuestCheckoutError("Selected rate is no longer eligible for these dates", 409);
    for (let i = 0; i < req.quantity; i++) {
      const unit = pool[i];
      unit.bedIds.forEach((id) => used.add(id));
      units.push({
        key: unit.key, dormId, type, bedIds: unit.bedIds as number[],
        ratePlanId: plan.id, nightlyRates: rate.nightlyRates,
      });
    }
  }
  const bedIds = [...used].sort((a, b) => a - b);
  if (bedIds.length < 1 || bedIds.length > 4) {
    throw new GuestCheckoutError(
      bedIds.length > 4
        ? "This selection needs more than 4 physical beds. Reduce doubles or beds (hold limit is 4 beds)."
        : "Select at least one bed",
      400,
    );
  }
  return { bedIds, units };
}

async function requireReady() {
  cloudOnly();
  const readiness = await evaluateNativeCheckoutReadiness();
  if (!readiness.nativeCheckoutReady) {
    throw new GuestCheckoutError(readiness.blockerMessages[0] || "Guest checkout is not ready", 403);
  }
  return readiness;
}

async function attachOrder(row: Checkout, order: Awaited<ReturnType<typeof createRazorpayBookingOrder>>) {
  const noteId = order.notes && !Array.isArray(order.notes) ? order.notes.goko_checkout_id : undefined;
  if (order.amount !== row.dueNowPaise || order.receipt !== row.receipt || noteId !== row.id ||
      row.razorpayOrderId && order.id !== row.razorpayOrderId) throw new RazorpayError("MISMATCH");
  const updated = await getDb().update(checkouts).set({
    razorpayOrderId: order.id, state: "ready", updatedAt: timestamp(),
  }).where(and(eq(checkouts.id, row.id),
    sql`(${checkouts.razorpayOrderId} IS NULL OR ${checkouts.razorpayOrderId} = ${order.id})`)).returning();
  if (!updated.length) throw new RazorpayError("MISMATCH");
  const ready = updated[0];
  // Stamp Order ID on the booking before pay so staff can look up by GOKO id immediately.
  if (ready.bookingId) {
    let quoteJson: string | null = null;
    if (ready.acceptedQuoteId) {
      const [q] = await getDb().select().from(quotes).where(eq(quotes.id, ready.acceptedQuoteId)).limit(1);
      quoteJson = q?.quoteJson ?? null;
    }
    await snapshotWebsiteOntoBooking(ready.bookingId, ready, { quoteJson });
  }
  return ready;
}

async function getCheckoutById(id: string) {
  z.string().uuid().parse(id);
  const [row] = await getDb().select().from(checkouts).where(eq(checkouts.id, id)).limit(1);
  if (!row) throw new GuestCheckoutError("Checkout not found", 404);
  return row;
}

async function requireOwner(checkoutId: string, ownerToken: string) {
  const row = await getCheckoutById(checkoutId);
  if (row.ownerHash !== await sha(token64.parse(ownerToken))) throw new GuestCheckoutError("Checkout not found", 404);
  return row;
}

function pickCheckoutForSnapshot(rows: Checkout[]): Checkout {
  const byNewest = (a: Checkout, b: Checkout) => b.createdAt.localeCompare(a.createdAt);
  const fulfilled = rows.filter((r) => r.state === "fulfilled").sort(byNewest);
  if (fulfilled[0]) return fulfilled[0];
  const open = rows.filter((r) => ["ready", "claimed", "captured", "preparing", "order_unknown", "captured_unfulfilled"].includes(r.state))
    .sort(byNewest);
  if (open[0]) return open[0];
  return [...rows].sort(byNewest)[0];
}

async function requireGuestAccess(reference: string, guestAccessToken: string) {
  token64.parse(guestAccessToken);
  const accessHash = await sha(guestAccessToken);
  const db = getDb();
  const rows = await db.select().from(checkouts).where(eq(checkouts.guestAccessHash, accessHash));
  if (!rows.length) throw new GuestCheckoutError("Booking not found", 404);
  const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((id): id is number => id != null))];
  if (!bookingIds.length) throw new GuestCheckoutError("Booking not found", 404);
  const bookingRows = await db.select().from(bookings).where(inArray(bookings.id, bookingIds));
  const booking = bookingRows.find((b) => b.gokoBookingId === reference || b.bookingRef === reference);
  if (!booking) throw new GuestCheckoutError("Booking not found", 404);
  const forBooking = rows.filter((r) => r.bookingId === booking.id);
  if (!forBooking.length) throw new GuestCheckoutError("Booking not found", 404);
  return { checkout: pickCheckoutForSnapshot(forBooking), booking, checkouts: forBooking };
}

/** newTotalPaise − alreadyPaidPaise (may be negative for refund). */
export function computeAmendDeltaPaise(newTotalPaise: number, alreadyPaidPaise: number) {
  return Math.trunc(newTotalPaise) - Math.trunc(alreadyPaidPaise);
}

async function publicSnapshot(row: Checkout, booking: typeof bookings.$inferSelect | undefined, extras: Record<string, unknown> = {}) {
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  const flags = guestActionFlags({
    checkoutState: row.state,
    bookingStatus: booking?.status,
    checkinDate: booking?.checkinDate,
    policy: settings,
  });
  let quoteJson: string | null = null;
  if (row.acceptedQuoteId) {
    const [q] = await getDb().select().from(quotes).where(eq(quotes.id, row.acceptedQuoteId)).limit(1);
    quoteJson = q?.quoteJson ?? null;
  }
  const dorms = await getAllDorms();
  const dormNames = new Map(dorms.map((d) => [d.id, d.name]));
  const quoteLines = roomLinesFromQuote(quoteJson, dormNames);
  const amountTotal = booking?.amountTotal ?? null;
  const amountPaid = booking?.amountPaid ?? null;
  const amountBeforeTax = booking?.amountBeforeTax ?? quoteLines.beforeTaxRupees ?? null;
  const amountTax = booking?.amountTax ?? quoteLines.taxRupees ?? null;
  const nights = booking?.checkinDate && booking?.checkoutDate
    ? occupiedNights(booking.checkinDate, booking.checkoutDate).length
    : quoteLines.nights;
  let rooms = quoteLines.rooms;
  let stayUpdatedAt: string | null = null;
  if (booking?.id) {
    const assigned = await getDb().select().from(bookingBedAssignments)
      .where(and(eq(bookingBedAssignments.bookingId, booking.id), eq(bookingBedAssignments.status, "assigned")));
    const allBeds = await getAllBeds();
    const units = sellableUnits(allBeds || []);
    // One row per sellable unit so a double (2 bed assignments) is not counted twice.
    const seenUnitKeys = new Set<string>();
    const enriched: Array<{ dormId: number; dormName: string | null; status: string; bedLabel: string }> = [];
    for (const a of assigned) {
      const unit = units.find((u) => u.beds.some((b) => b.id === a.bedId));
      const unitKey = unit?.key || `bed:${a.bedId}`;
      if (seenUnitKeys.has(unitKey)) continue;
      seenUnitKeys.add(unitKey);
      enriched.push({
        dormId: a.dormId,
        dormName: dormNames.get(a.dormId) || null,
        status: a.status,
        bedLabel: unit?.type === "Double" ? "double" : "bed",
      });
    }
    const liveRooms = roomLinesFromAssignments(enriched, dormNames, amountBeforeTax);
    if (liveRooms.length > 0) rooms = liveRooms;
    const history = await getBookingHistoryEntries(booking.id);
    // Only stay-shape edits (not guest-name-only) surface the guest "Updated" cue.
    const updated = history.find((h) => {
      if (h.action === "website_amend") return true;
      if (h.action !== "Reservation Edited") return false;
      return /\b(Dates|Persons|Nightly|Total|Bed|Added|Removed|rooms?)\b/i.test(h.details || "");
    });
    stayUpdatedAt = updated?.performedAt ?? null;
  }
  return {
    checkoutId: row.id,
    state: row.state,
    paymentChoice: row.paymentChoice,
    dueNowPaise: row.dueNowPaise,
    reference: booking?.gokoBookingId || booking?.bookingRef || null,
    bookingStatus: booking?.status ?? null,
    checkinDate: booking?.checkinDate ?? null,
    checkoutDate: booking?.checkoutDate ?? null,
    guestName: row.guestName,
    email: maskGuestEmail(row.guestEmail),
    phone: maskGuestPhone(row.guestPhone),
    amountTotal,
    amountPaid,
    amountRefunded: booking?.amountRefunded ?? null,
    dueAtPropertyPaise: amountTotal != null && amountPaid != null
      ? Math.max(0, Math.round(amountTotal * 100) - Math.round(amountPaid * 100))
      : null,
    rooms,
    nights,
    persons: booking?.persons ?? null,
    roomType: booking?.roomType ?? null,
    beforeTaxRupees: amountBeforeTax,
    taxRupees: amountTax,
    taxPercent: quoteLines.taxPercent,
    gatewayEnvironment: row.environment,
    canCancel: flags.canCancel,
    canModify: false, // Guest stay changes → WhatsApp / admin Edit Booking; self-serve amend retired.
    cancellationDeadlineAt: flags.cancellationDeadlineAt,
    stayUpdatedAt,
    ...extras,
  };
}

/** Idempotent prepare: hold → quote → provisional booking → optional Razorpay order. */
export async function prepareGuestCheckout(raw: z.input<typeof selectionSchema>) {
  await requireReady();
  try {
    const { cancelAbandonedWebsiteHolds } = await import("@/lib/websiteAbandonedHolds");
    await cancelAbandonedWebsiteHolds();
  } catch { /* best-effort */ }
  const input = selectionSchema.parse(raw);
  const requestHash = await sha(JSON.stringify({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    paymentChoice: input.paymentChoice, rooms: input.rooms, guest: input.guest,
  }));
  const db = getDb();
  const [existing] = await db.select().from(checkouts).where(eq(checkouts.requestKey, input.requestKey)).limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new GuestCheckoutError("Request key already belongs to a different checkout");
    const [booking] = existing.bookingId
      ? await db.select().from(bookings).where(eq(bookings.id, existing.bookingId)).limit(1) : [];
    return {
      ...(await publicSnapshot(existing, booking)),
      recovered: true,
      ownerToken: null as string | null,
      guestAccessToken: null as string | null,
      razorpay: existing.state === "ready" && existing.razorpayOrderId && !existing.checkoutStartedAt
        ? { key: existing.razorpayKeyId, order_id: existing.razorpayOrderId, amount: existing.dueNowPaise, currency: "INR" as const }
        : null,
      requiresPayment: existing.dueNowPaise >= 100,
    };
  }

  const settingsRaw = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
  const policy = readWebsiteBookingSettings(settingsRaw);
  const policyVersion = await websiteBookingSettingsRevision(settingsRaw);
  const selectedUnits = input.rooms.reduce((sum, room) => sum + room.quantity, 0);
  if (selectedUnits > policy.maxSelectedBeds) {
    throw new GuestCheckoutError(`You can select at most ${policy.maxSelectedBeds} beds for a website booking`, 400);
  }
  const { bedIds, units } = await allocateGuestSelection(input);
  const ownerToken = generateGuestAccessToken();
  const guestAccessToken = generateGuestAccessToken();
  const hold = await createNativeInventoryHold({
    requestKey: input.requestKey, ownerToken, bedIds,
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    holdSeconds: policy.holdMinutes * 60,
  });
  const taxBasisPoints = Math.round(guestTaxPercent(await getSetting(BOOKING_TAX_SETTING)) * 100);
  const accepted = await acceptNativeQuote({ requestKey: input.requestKey, ownerToken }, {
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    policyVersion, policy, taxBasisPoints, paymentChoice: input.paymentChoice,
    units: units.map((u) => ({ key: u.key, nightlyRates: u.nightlyRates })),
  });
  const quote = accepted.quote;
  if (quote.dueNowPaise > 0 && quote.dueNowPaise < 100) {
    throw new GuestCheckoutError("Advance due is below Razorpay’s ₹1 minimum. Choose full pay or pay at property, or adjust advance %.", 400);
  }
  const gokoId = generateGokoBookingId();
  const roomLabel = units.map((u) => `${u.type}`).join(", ");
  const stayNightsCount = Math.max(1, occupiedNights(input.checkinDate, input.checkoutDate).length);
  const bedSlots = Math.max(1, bedIds.length);
  const nightlyRate = quote.beforeTaxRupees > 0
    ? Math.max(0, Math.round(quote.beforeTaxRupees / (stayNightsCount * bedSlots)))
    : 0;
  const bookingId = await addBooking({
    guestName: input.guest.name, contact: input.guest.phone, email: input.guest.email,
    platform: "Website", bookingRef: gokoId, gokoBookingId: gokoId,
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    roomType: roomLabel, persons: units.reduce((n, u) => n + (u.type === "Double" ? 2 : 1), 0),
    status: "hold", source: "website", paymentStatus: quote.dueNowPaise >= 100 ? "pending" : "pay_at_property",
    amountBeforeTax: quote.beforeTaxRupees, amountTax: quote.taxRupees, amountTotal: quote.totalRupees,
    amountPaid: 0, currency: "INR", nightlyRate,
    ratePlan: [...new Set(units.map((u) => String(u.ratePlanId)))].join(","),
    rawData: JSON.stringify({ nativeCheckout: true, paymentChoice: input.paymentChoice, holdId: hold.id }),
  });
  if (!bookingId) throw new GuestCheckoutError("Could not create provisional booking", 503);
  await updateBookingFull(bookingId, {
    holdExpiresAt: new Date(hold.expiresAt * 1000).toISOString(),
  });
  const id = crypto.randomUUID();
  const now = timestamp();
  const gatewayEnvironment = policy.gatewayEnvironment as RazorpayEnvironment;
  const keyId = quote.dueNowPaise >= 100 ? razorpayCredentials(gatewayEnvironment).keyId : null;
  const inserted = await db.insert(checkouts).values({
    id, requestKey: input.requestKey, requestHash,
    ownerHash: await sha(ownerToken), guestAccessHash: await sha(guestAccessToken),
    bookingId, holdId: hold.id, acceptedQuoteId: accepted.id,
    paymentChoice: input.paymentChoice, environment: gatewayEnvironment,
    state: quote.dueNowPaise >= 100 ? "preparing" : "ready",
    razorpayKeyId: keyId, receipt: quote.dueNowPaise >= 100 ? receiptFor(id) : null,
    dueNowPaise: quote.dueNowPaise, guestName: input.guest.name, guestEmail: input.guest.email,
    guestPhone: input.guest.phone, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: checkouts.requestKey }).returning();
  if (!inserted.length) {
    const [race] = await db.select().from(checkouts).where(eq(checkouts.requestKey, input.requestKey)).limit(1);
    if (!race) throw new GuestCheckoutError("Unable to recover checkout request", 503);
    if (race.requestHash !== requestHash) throw new GuestCheckoutError("Request key already belongs to a different checkout");
    const [bookingRace] = race.bookingId
      ? await db.select().from(bookings).where(eq(bookings.id, race.bookingId)).limit(1) : [];
    return {
      ...(await publicSnapshot(race, bookingRace)),
      recovered: true,
      ownerToken: null as string | null,
      guestAccessToken: null as string | null,
      razorpay: race.state === "ready" && race.razorpayOrderId && !race.checkoutStartedAt
        ? { key: race.razorpayKeyId, order_id: race.razorpayOrderId, amount: race.dueNowPaise, currency: "INR" as const }
        : null,
      requiresPayment: race.dueNowPaise >= 100,
    };
  }
  let row = inserted[0];
  if (quote.dueNowPaise >= 100) {
    try {
      row = await attachOrder(row, await createRazorpayBookingOrder({
        amountPaise: quote.dueNowPaise, receipt: row.receipt!, checkoutId: id, gokoBookingId: gokoId, environment: gatewayEnvironment,
      }));
    } catch {
      await db.update(checkouts).set({ state: "order_unknown", updatedAt: timestamp() })
        .where(and(eq(checkouts.id, id), ne(checkouts.state, "ready")));
      row = (await getCheckoutById(id));
      if (row.bookingId) {
        await snapshotWebsiteOntoBooking(row.bookingId, row, { quoteJson: JSON.stringify(accepted.quote) });
      }
    }
  } else {
    await fulfilGuestCheckout(id, ownerToken);
    row = await getCheckoutById(id);
  }
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return {
    ...(await publicSnapshot(row, booking)),
    recovered: false,
    ownerToken,
    guestAccessToken,
    holdExpiresAt: hold.expiresAt,
    quote: {
      totalRupees: quote.totalRupees, taxRupees: quote.taxRupees, beforeTaxRupees: quote.beforeTaxRupees,
      dueNowPaise: quote.dueNowPaise, dueAtPropertyPaise: quote.dueAtPropertyPaise,
    },
    razorpay: row.state === "ready" && row.razorpayOrderId
      ? { key: row.razorpayKeyId, order_id: row.razorpayOrderId, amount: row.dueNowPaise, currency: "INR" as const }
      : null,
    requiresPayment: row.dueNowPaise >= 100 && row.state !== "fulfilled",
  };
}

/** One Razorpay open per order — mirrors claimPreviewCheckout. */
export async function claimGuestCheckout(checkoutId: string, ownerToken: string) {
  await requireReady();
  const row = await requireOwner(checkoutId, ownerToken);
  if (row.dueNowPaise < 100) throw new GuestCheckoutError("No online payment is required for this booking");
  if (!row.razorpayOrderId || row.state === "order_unknown" || row.state === "preparing") {
    throw new GuestCheckoutError("Order is unresolved; reconcile before checkout");
  }
  if (!["ready", "claimed"].includes(row.state)) {
    throw new GuestCheckoutError("Checkout is no longer available to open");
  }
  const updated = await getDb().update(checkouts).set({
    checkoutStartedAt: timestamp(), state: "claimed", updatedAt: timestamp(),
  }).where(and(
    eq(checkouts.id, checkoutId),
    sql`${checkouts.checkoutStartedAt} IS NULL`,
    sql`NOT EXISTS (SELECT 1 FROM ${payments} WHERE ${payments.checkoutId} = ${checkoutId} AND ${payments.captured} = 1)`,
  )).returning();
  if (!updated.length) {
    throw new GuestCheckoutError("Checkout was already started or payment evidence exists. Reconcile rather than opening it again.");
  }
  // Renew inventory lease for the payment window (max 900s). No-op if already expired.
  if (row.holdId) {
    try {
      const settingsRaw = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
      const policy = readWebsiteBookingSettings(settingsRaw);
      await renewNativeInventoryHoldLease(row.holdId, ownerToken, clampHoldSeconds(policy.holdMinutes * 60));
    } catch { /* best-effort; fulfil soft-fail + alts still apply */ }
  }
  return {
    checkout: {
      key: row.razorpayKeyId!, order_id: row.razorpayOrderId, amount: row.dueNowPaise, currency: "INR" as const,
    },
    checkoutId,
  };
}

async function recordPayment(row: Checkout, evidence: RazorpayPayment) {
  if (!row.razorpayOrderId || evidence.order_id !== row.razorpayOrderId || evidence.amount !== row.dueNowPaise) {
    throw new RazorpayError("MISMATCH");
  }
  const captured = evidence.captured && ["captured", "refunded"].includes(evidence.status) ? 1 : 0;
  const rows = await getDb().insert(payments).values({
    id: evidence.id, checkoutId: row.id, amountPaise: evidence.amount,
    status: evidence.status, captured, refundedPaise: evidence.amount_refunded, verifiedAt: timestamp(),
  }).onConflictDoUpdate({
    target: payments.id,
    set: {
      captured: sql`MAX(${payments.captured}, ${captured})`,
      refundedPaise: sql`MAX(${payments.refundedPaise}, ${evidence.amount_refunded})`,
      status: sql`CASE WHEN ${payments.status} = 'refunded' THEN 'refunded'
        WHEN ${payments.captured} = 1 AND ${captured} = 0 THEN ${payments.status}
        WHEN ${payments.status} = 'authorized' AND ${evidence.status} = 'created' THEN ${payments.status}
        ELSE ${evidence.status} END`,
      verifiedAt: timestamp(),
    },
    setWhere: and(eq(payments.checkoutId, row.id), eq(payments.amountPaise, evidence.amount)),
  }).returning();
  if (!rows.length) throw new RazorpayError("MISMATCH");
  if (captured) {
    await getDb().update(checkouts).set({
      state: sql`CASE WHEN ${checkouts.state} IN ('fulfilled','captured_unfulfilled','cancelled') THEN ${checkouts.state} ELSE 'captured' END`,
      updatedAt: timestamp(),
    }).where(eq(checkouts.id, row.id));
  }
  return rows[0];
}

async function recoverOrder(row: Checkout) {
  if (row.razorpayOrderId) return row;
  if (!row.receipt) throw new GuestCheckoutError("Order creation is still unresolved", 503);
  const env = checkoutEnv(row);
  const candidates = (await findRazorpayBookingOrders(row.receipt, env)).filter((o) => o.receipt === row.receipt);
  if (candidates.length !== 1) {
    throw new GuestCheckoutError("Order creation is still unresolved. Do not start another payment; reconcile this checkout.");
  }
  return attachOrder(row, candidates[0]);
}

export async function reconcileGuestCheckout(checkoutId: string, ownerToken: string) {
  cloudOnly();
  let row = await recoverOrder(await requireOwner(checkoutId, ownerToken));
  const env = checkoutEnv(row);
  if (row.dueNowPaise >= 100 && row.razorpayOrderId) {
    const evidence = await fetchRazorpayBookingOrderPayments(row.razorpayOrderId, env);
    const seen = new Set<string>();
    for (const payment of evidence) {
      if (seen.has(payment.id)) throw new RazorpayError("INVALID_RESPONSE");
      seen.add(payment.id);
      await recordPayment(row, payment);
    }
    const known = await getDb().select().from(payments).where(eq(payments.checkoutId, checkoutId));
    for (const payment of known) {
      if (!seen.has(payment.id)) {
        const fetched = await fetchRazorpayBookingPayment(payment.id, env);
        if (fetched.id !== payment.id) throw new RazorpayError("MISMATCH");
        await recordPayment(row, fetched);
      }
    }
    row = await getCheckoutById(checkoutId);
    if (known.some((p) => p.captured) || (await getDb().select().from(payments).where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1)))).length) {
      if (!["fulfilled", "captured_unfulfilled"].includes(row.state)) {
        await fulfilGuestCheckout(checkoutId, ownerToken);
        row = await getCheckoutById(checkoutId);
      }
    }
  }
  const [booking] = row.bookingId
    ? await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1) : [];
  return await publicSnapshot(row, booking);
}

/**
 * Guest closed Checkout / refreshed before capture: release inventory hold and cancel
 * the unpaid provisional (or unpaid amend) checkout. If Razorpay already captured,
 * fulfil instead of abandoning — unless `uncertain` (guest already told booking not confirmed).
 */
export async function abandonUnpaidGuestCheckout(
  checkoutId: string,
  ownerToken: string,
  opts: { uncertain?: boolean } = {},
) {
  cloudOnly();
  const uncertain = opts.uncertain === true;
  let row = await requireOwner(checkoutId, ownerToken);
  if (["fulfilled", "captured_unfulfilled", "cancelled", "expired"].includes(row.state)) {
    if (uncertain && row.state === "cancelled") {
      const orphanCapture = await applyOrphanCaptureIfNeeded(row);
      return { abandoned: false as const, state: row.state, orphanCapture };
    }
    return { abandoned: false as const, state: row.state, orphanCapture: false };
  }

  if (row.dueNowPaise >= 100 && row.razorpayOrderId) {
    try {
      row = await recoverOrder(row);
      const env = checkoutEnv(row);
      const evidence = await fetchRazorpayBookingOrderPayments(row.razorpayOrderId!, env);
      for (const payment of evidence) await recordPayment(row, payment);
      const captured = await getDb().select().from(payments)
        .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1);
      if (captured.length) {
        row = await getCheckoutById(checkoutId);
        if (!uncertain && !["fulfilled", "captured_unfulfilled", "cancelled"].includes(row.state)) {
          await fulfilGuestCheckout(checkoutId, ownerToken);
          return { abandoned: false as const, state: "paid" as const, orphanCapture: false };
        }
        // uncertain: fall through to cancel without fulfil
      }
    } catch {
      if (!uncertain) {
        // Do not release inventory when capture status is unknown (normal abandon).
        return { abandoned: false as const, state: "reconcile_unavailable" as const, orphanCapture: false };
      }
      // uncertain: still release — guest was told booking is not confirmed.
    }
  }

  const localCaptured = await getDb().select().from(payments)
    .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1);
  if (localCaptured.length && !uncertain) {
    row = await getCheckoutById(checkoutId);
    if (!["fulfilled", "captured_unfulfilled", "cancelled"].includes(row.state)) {
      await fulfilGuestCheckout(checkoutId, ownerToken);
    }
    return { abandoned: false as const, state: "paid" as const, orphanCapture: false };
  }

  if (row.holdId) {
    try { await releaseNativeInventoryHold(row.holdId, ownerToken); }
    catch {
      await getDb().update(holds).set({ state: "released" })
        .where(and(eq(holds.id, row.holdId), eq(holds.state, "held")));
    }
  }

  const now = timestamp();
  await getDb().update(checkouts).set({
    state: "cancelled", closureReason: "guest_cancelled", updatedAt: now,
  }).where(and(
    eq(checkouts.id, checkoutId),
    sql`${checkouts.state} NOT IN ('fulfilled','captured_unfulfilled','cancelled','expired')`,
  ));

  row = await getCheckoutById(checkoutId);
  let orphanCapture = false;

  if (!row.amendsCheckoutId && row.bookingId) {
    const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
    if (localCaptured.length || (await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1)).length) {
      orphanCapture = await applyOrphanCaptureIfNeeded(row);
      if (booking?.status === "hold") {
        await transitionBookingStatus(row.bookingId, ["hold"], {
          status: "cancelled", cancelledAt: now, holdExpiresAt: "",
        });
      }
    } else if (booking?.status === "hold" && (booking.amountPaid || 0) === 0) {
      const moved = await transitionBookingStatus(row.bookingId, ["hold"], {
        status: "cancelled", cancelledAt: now, holdExpiresAt: "",
      });
      if (moved) {
        await addBookingHistoryEntry({
          bookingId: row.bookingId,
          action: uncertain ? "guest_uncertain_payment" : "guest_abandoned",
          details: uncertain
            ? "Guest payment outcome unclear; hold released — do not pay again until support confirms"
            : "Guest left unpaid checkout; temporary hold released",
          performedBy: "guest",
        });
        let quoteJson: string | null = null;
        if (row.acceptedQuoteId) {
          const [q] = await getDb().select().from(quotes).where(eq(quotes.id, row.acceptedQuoteId)).limit(1);
          quoteJson = q?.quoteJson ?? null;
        }
        await snapshotWebsiteOntoBooking(row.bookingId, row, { quoteJson });
      }
    }
  } else if (row.amendsCheckoutId && row.bookingId) {
    await addBookingHistoryEntry({
      bookingId: row.bookingId,
      action: "guest_abandoned_amend",
      details: `Unpaid amend checkout ${checkoutId} abandoned; hold released`,
      performedBy: "guest",
    });
  }

  return { abandoned: true as const, state: "cancelled" as const, orphanCapture };
}

export async function verifyGuestPayment(checkoutId: string, ownerToken: string, paymentId: string, orderId: string, signature: string) {
  cloudOnly();
  const row = await requireOwner(checkoutId, ownerToken);
  const env = checkoutEnv(row);
  if (!row.razorpayOrderId || orderId !== row.razorpayOrderId) throw new RazorpayError("MISMATCH", 400);
  if (!await verifyCheckoutSignature(row.razorpayOrderId, paymentId, signature, env)) throw new RazorpayError("SIGNATURE", 400);
  const evidence = await fetchRazorpayBookingPayment(paymentId, env);
  if (evidence.id !== paymentId) throw new RazorpayError("MISMATCH");
  await recordPayment(row, evidence);
  if (evidence.captured && ["captured", "refunded"].includes(evidence.status)) {
    if (["cancelled", "expired"].includes(row.state)) {
      await applyOrphanCaptureIfNeeded(await getCheckoutById(checkoutId));
    } else {
      await fulfilGuestCheckout(checkoutId, ownerToken);
    }
  }
  const fresh = await getCheckoutById(checkoutId);
  const [booking] = fresh.bookingId
    ? await getDb().select().from(bookings).where(eq(bookings.id, fresh.bookingId)).limit(1) : [];
  return await publicSnapshot(fresh, booking);
}

/**
 * Release hold then assign beds. Assign-while-held is rejected by DB triggers (0059).
 * Assign tries held beds as online, then offline, then same-dorm/type alternatives
 * (online then offline). Only when all fail after capture → captured_unfulfilled.
 * `trustedServer` skips owner token (webhook / pay-at-property after verify).
 */
export async function fulfilGuestCheckout(checkoutId: string, ownerToken?: string, trustedServer = false) {
  cloudOnly();
  const row = trustedServer ? await getCheckoutById(checkoutId) : await requireOwner(checkoutId, ownerToken!);
  if (row.amendsCheckoutId) {
    return fulfilGuestAmend(checkoutId, ownerToken, trustedServer);
  }
  if (row.state === "fulfilled") {
    const [b] = row.bookingId ? await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1) : [];
    return await publicSnapshot(row, b);
  }
  if (["cancelled", "expired"].includes(row.state)) {
    throw new GuestCheckoutError("This checkout was cancelled or expired and cannot be fulfilled", 409);
  }
  if (!row.bookingId || !row.holdId) throw new GuestCheckoutError("Checkout is missing booking or hold", 503);
  if (row.dueNowPaise >= 100) {
    const captured = await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1);
    if (!captured.length && row.paymentChoice !== "property") {
      throw new GuestCheckoutError("Payment has not been captured yet");
    }
  }
  const [holdRow] = await getDb().select().from(holds).where(eq(holds.id, row.holdId)).limit(1);
  if (!holdRow) throw new GuestCheckoutError("Hold not found", 404);
  const bedIds = JSON.parse(holdRow.bedIds) as number[];
  const allBeds = await getAllBeds();
  const bedMeta = new Map(allBeds.map((b) => [b.id, b]));
  const dormIds = [...new Set(bedIds.map((id) => bedMeta.get(id)?.dormId).filter(Boolean) as number[])];
  const nights = occupiedNights(holdRow.checkinDate, holdRow.checkoutDate);
  const before = await otaFingerprint(dormIds, nights);

  // Release first — assignment_native_hold_* guards abort assign while held.
  if (holdRow.state === "held") {
    if (ownerToken && !trustedServer) {
      await releaseNativeInventoryHold(row.holdId, ownerToken);
    } else {
      await getDb().update(holds).set({ state: "released" }).where(and(eq(holds.id, row.holdId), eq(holds.state, "held")));
    }
  }

  const assigned: number[] = [];
  let usedOfflineFallback = false;
  try {
    const heldBeds = bedIds.map((id) => {
      const bed = bedMeta.get(id);
      if (!bed) throw new GuestCheckoutError("Held bed is missing from inventory", 503);
      return bed;
    });
    // Group held beds into sellable units (Double = complete pair).
    const heldUnits = sellableUnits(heldBeds).filter((u) =>
      u.beds.every((b) => b.id != null && bedIds.includes(b.id)),
    );
    if (heldUnits.length === 0 || heldUnits.reduce((n, u) => n + u.beds.length, 0) !== bedIds.length) {
      throw new GuestCheckoutError("Held beds do not form complete sellable units", 503);
    }

    const tryAssignUnit = async (ids: number[], pool: InventoryPool): Promise<boolean> =>
      tryAssignUnitSoft({
        bookingId: row.bookingId!, ids, pool,
        checkinDate: holdRow.checkinDate, checkoutDate: holdRow.checkoutDate, bedMeta,
      });

    const claimed = new Set<number>();
    for (const unit of heldUnits) {
      const unitIds = unit.beds.map((b) => b.id!).filter((id) => id != null);
      // 1) Prefer held beds as online.
      if (await tryAssignUnit(unitIds, "online")) {
        unitIds.forEach((id) => { assigned.push(id); claimed.add(id); });
        continue;
      }
      // 2) Same beds as offline (pool tag may already be offline after race).
      if (await tryAssignUnit(unitIds, "offline")) {
        usedOfflineFallback = true;
        unitIds.forEach((id) => { assigned.push(id); claimed.add(id); });
        continue;
      }
      // 3) Same dorm + type alternatives: online units first, then offline.
      const tagged = await getAvailableBedsForRange(
        holdRow.checkinDate, holdRow.checkoutDate, unit.dormId, row.bookingId,
      );
      const matchType = (t: string | null | undefined) =>
        unit.type === "Double" ? t === "Double" : t !== "Double";
      const candidates = (pool: "online" | "offline") =>
        sellableUnits(
          tagged.filter((b) =>
            b.pool === pool && matchType(b.type) && !claimed.has(b.id) && !assigned.includes(b.id),
          ),
        ).filter((u) =>
          u.type === unit.type
          && (unit.type !== "Double" || u.beds.length === 2)
          && u.beds.every((b) => b.id != null && !claimed.has(b.id)),
        );

      let placed = false;
      for (const pool of ["online", "offline"] as const) {
        for (const alt of candidates(pool)) {
          const altIds = alt.beds.map((b) => b.id!);
          if (await tryAssignUnit(altIds, pool)) {
            if (pool === "offline") usedOfflineFallback = true;
            altIds.forEach((id) => { assigned.push(id); claimed.add(id); });
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) throw new GuestCheckoutError("Could not assign a held bed", 503);
    }
    const paidRupees = row.dueNowPaise / 100;
    const moved = await transitionBookingStatus(row.bookingId, ["hold"], {
      status: "received",
      amountPaid: paidRupees,
      paymentStatus: row.dueNowPaise >= 100 ? "partial_or_paid" : "pay_at_property",
      paymentMethod: row.dueNowPaise >= 100 ? "razorpay_test" : "pay_at_property",
      holdExpiresAt: "",
    });
    if (!moved) {
      const [current] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
      if (current?.status !== "received") throw new GuestCheckoutError("Booking could not be confirmed", 503);
    }
    await getDb().update(checkouts).set({ state: "fulfilled", updatedAt: timestamp() }).where(eq(checkouts.id, checkoutId));
    await addBookingHistoryEntry({
      bookingId: row.bookingId, action: "website_fulfil",
      details: usedOfflineFallback
        ? `Native guest checkout ${checkoutId} (offline pool fallback)`
        : `Native guest checkout ${checkoutId}`,
      performedBy: "website",
    });
    const [confirmed] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
    let quoteJson: string | null = null;
    if (row.acceptedQuoteId) {
      const [q] = await getDb().select().from(quotes).where(eq(quotes.id, row.acceptedQuoteId)).limit(1);
      quoteJson = q?.quoteJson ?? null;
    }
    const fulfilledRow = await getCheckoutById(checkoutId);
    await snapshotWebsiteOntoBooking(row.bookingId, fulfilledRow, { quoteJson });
    // Aiosell + email after beds are confirmed — do not block the guest wait overlay.
    await afterResponse((async () => {
      try { await pushIfOtaChanged(before, dormIds, nights); } catch { /* best-effort */ }
      if (confirmed) {
        const snap = await publicSnapshot(row, confirmed);
        await sendBookingConfirmationEmail({
          guestName: row.guestName, guestEmail: row.guestEmail,
          reference: confirmed.gokoBookingId || confirmed.bookingRef || String(confirmed.id),
          checkinDate: confirmed.checkinDate, checkoutDate: confirmed.checkoutDate || "",
          totalRupees: confirmed.amountTotal || 0, paidRupees: confirmed.amountPaid || 0,
          nights: snap.nights, rooms: snap.rooms, persons: snap.persons,
          beforeTaxRupees: snap.beforeTaxRupees, taxRupees: snap.taxRupees, taxPercent: snap.taxPercent,
          paymentChoice: snap.paymentChoice, cancellationDeadlineAt: snap.cancellationDeadlineAt,
        });
      }
    })());
  } catch (error) {
    if (assigned.length) await unassignBookingBeds(row.bookingId);
    const hasCapture = row.dueNowPaise >= 100 && (await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1)).length > 0;
    if (hasCapture) {
      await getDb().update(checkouts).set({
        state: "captured_unfulfilled", closureReason: "cannot_fulfil", updatedAt: timestamp(),
      }).where(eq(checkouts.id, checkoutId));
      await addBookingHistoryEntry({
        bookingId: row.bookingId, action: "website_unfulfilled",
        details: unfulfilledDetail(
          "Payment captured; online and offline bed assign failed — assign manually from Unassigned",
          error,
        ),
        performedBy: "website",
      });
      throw new GuestCheckoutError(
        "Payment was captured but beds could not be assigned. Goko will complete this booking manually — do not pay again.",
        503,
      );
    }
    throw error;
  }
  const fresh = await getCheckoutById(checkoutId);
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
  return await publicSnapshot(fresh, booking);
}

export async function getGuestBookingStatus(reference: string, guestAccessToken: string) {
  cloudOnly();
  const { checkout, booking } = await requireGuestAccess(reference, guestAccessToken);
  return await publicSnapshot(checkout, booking);
}

async function requireAmendableBooking(reference: string, guestAccessToken: string) {
  const { checkout, booking, checkouts: all } = await requireGuestAccess(reference, guestAccessToken);
  if (booking.source !== "website") {
    throw new GuestCheckoutError("Only website bookings can be changed online", 403);
  }
  if (!["received"].includes(booking.status)) {
    throw new GuestCheckoutError("This booking can no longer be changed online");
  }
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  const flags = guestActionFlags({
    checkoutState: checkout.state,
    bookingStatus: booking.status,
    checkinDate: booking.checkinDate,
    policy: settings,
  });
  if (!flags.canModify) {
    throw new GuestCheckoutError("Modification deadline has passed for online self-service");
  }
  const original = all.find((c) => !c.amendsCheckoutId) || checkout;
  if (!original.bookingId) throw new GuestCheckoutError("Booking not found", 404);
  return { checkout, booking, original, all, settings, flags };
}

async function buildAmendQuoteTotals(input: {
  checkinDate: string; checkoutDate: string;
  rooms: { roomId: string; quantity: number; ratePlanId: number }[];
  excludeBookingId: number;
  policy: ReturnType<typeof readWebsiteBookingSettings>;
  policyVersion: string;
}) {
  const selectedUnits = input.rooms.reduce((sum, room) => sum + room.quantity, 0);
  if (selectedUnits > input.policy.maxSelectedBeds) {
    throw new GuestCheckoutError(`You can select at most ${input.policy.maxSelectedBeds} beds for a website booking`, 400);
  }
  const { bedIds, units } = await allocateGuestSelection({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    rooms: input.rooms, excludeBookingId: input.excludeBookingId,
  });
  const taxBasisPoints = Math.round(guestTaxPercent(await getSetting(BOOKING_TAX_SETTING)) * 100);
  const quote = buildNativeBookingQuote({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    policyVersion: input.policyVersion, policy: input.policy, taxBasisPoints,
    paymentChoice: "full",
    units: units.map((u) => ({ key: u.key, nightlyRates: u.nightlyRates })),
  });
  return { bedIds, units, quote, taxBasisPoints };
}

/** Auth + availability for amend UI (excludes this booking's assigned beds from conflicts). */
export async function searchGuestAmendAvailability(reference: string, guestAccessToken: string, checkinDate: string, checkoutDate: string) {
  cloudOnly();
  const { booking } = await requireAmendableBooking(reference, guestAccessToken);
  return searchGuestRooms({ checkinDate, checkoutDate }, { excludeBookingId: booking.id });
}

/** Quote amend totals + delta without holding inventory. */
export async function quoteGuestAmend(raw: z.input<typeof amendSelectionSchema>) {
  cloudOnly();
  const input = amendSelectionSchema.parse(raw);
  const { booking, settings } = await requireAmendableBooking(input.reference, input.guestAccessToken);
  const settingsRaw = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
  const policyVersion = await websiteBookingSettingsRevision(settingsRaw);
  const { quote, units } = await buildAmendQuoteTotals({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate, rooms: input.rooms,
    excludeBookingId: booking.id, policy: settings, policyVersion,
  });
  const alreadyPaidPaise = Math.round((booking.amountPaid || 0) * 100);
  const deltaPaise = computeAmendDeltaPaise(quote.totalPaise, alreadyPaidPaise);
  return {
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    beforeTaxRupees: quote.beforeTaxRupees, taxRupees: quote.taxRupees, totalRupees: quote.totalRupees,
    totalPaise: quote.totalPaise, alreadyPaidPaise, deltaPaise,
    dueNowPaise: Math.max(0, deltaPaise),
    refundPaise: Math.max(0, -deltaPaise),
    rooms: units.map((u) => ({ key: u.key, dormId: u.dormId, type: u.type })),
    requiresPayment: deltaPaise >= 100,
  };
}

/** Hold + accepted quote + amend checkout. Charges max(0, delta); refunds happen on confirm. */
export async function prepareGuestAmend(raw: z.input<typeof amendSelectionSchema>) {
  await requireReady();
  try {
    const { cancelAbandonedWebsiteHolds } = await import("@/lib/websiteAbandonedHolds");
    await cancelAbandonedWebsiteHolds();
  } catch { /* best-effort */ }
  const input = amendSelectionSchema.parse(raw);
  const { booking, original, all, settings } = await requireAmendableBooking(input.reference, input.guestAccessToken);
  const requestHash = await sha(JSON.stringify({
    amend: true, bookingId: booking.id, checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    rooms: input.rooms,
  }));
  const db = getDb();
  const [existing] = await db.select().from(checkouts).where(eq(checkouts.requestKey, input.requestKey)).limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash || existing.amendsCheckoutId !== original.id) {
      throw new GuestCheckoutError("Request key already belongs to a different checkout");
    }
    const alreadyPaidPaise = Math.round((booking.amountPaid || 0) * 100);
    return {
      ...(await publicSnapshot(existing, booking)),
      recovered: true,
      ownerToken: null as string | null,
      guestAccessToken: null as string | null,
      deltaPaise: existing.dueNowPaise > 0
        ? existing.dueNowPaise
        : computeAmendDeltaPaise(Math.round((booking.amountTotal || 0) * 100), alreadyPaidPaise),
      razorpay: existing.state === "ready" && existing.razorpayOrderId && !existing.checkoutStartedAt
        ? { key: existing.razorpayKeyId, order_id: existing.razorpayOrderId, amount: existing.dueNowPaise, currency: "INR" as const }
        : null,
      requiresPayment: existing.dueNowPaise >= 100,
    };
  }

  // Supersede incomplete prior amend checkouts for this booking.
  for (const prior of all.filter((c) => c.amendsCheckoutId && !["fulfilled", "cancelled", "expired"].includes(c.state))) {
    if (prior.holdId) {
      await db.update(holds).set({ state: "released" })
        .where(and(eq(holds.id, prior.holdId), eq(holds.state, "held")));
    }
    await db.update(checkouts).set({
      state: "cancelled", closureReason: "guest_cancelled", updatedAt: timestamp(),
    }).where(eq(checkouts.id, prior.id));
  }

  const settingsRaw = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
  const policyVersion = await websiteBookingSettingsRevision(settingsRaw);
  const { bedIds, units, quote, taxBasisPoints } = await buildAmendQuoteTotals({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate, rooms: input.rooms,
    excludeBookingId: booking.id, policy: settings, policyVersion,
  });
  const alreadyPaidPaise = Math.round((booking.amountPaid || 0) * 100);
  const deltaPaise = computeAmendDeltaPaise(quote.totalPaise, alreadyPaidPaise);
  const dueNowPaise = Math.max(0, deltaPaise);
  if (dueNowPaise > 0 && dueNowPaise < 100) {
    throw new GuestCheckoutError("Change amount is below Razorpay’s ₹1 minimum. Adjust dates or rooms, or contact Goko.", 400);
  }

  const ownerToken = generateGuestAccessToken();
  const hold = await createNativeInventoryHold({
    requestKey: input.requestKey, ownerToken, bedIds,
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    holdSeconds: settings.holdMinutes * 60,
    excludeBookingId: booking.id,
  });
  const accepted = await acceptNativeQuote({ requestKey: input.requestKey, ownerToken }, {
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    policyVersion, policy: settings, taxBasisPoints, paymentChoice: "full",
    units: units.map((u) => ({ key: u.key, nightlyRates: u.nightlyRates })),
  });
  const id = crypto.randomUUID();
  const now = timestamp();
  const gatewayEnvironment = settings.gatewayEnvironment as RazorpayEnvironment;
  const keyId = dueNowPaise >= 100 ? razorpayCredentials(gatewayEnvironment).keyId : null;
  const paymentChoice = dueNowPaise >= 100 ? "full" : "property";
  const inserted = await db.insert(checkouts).values({
    id, requestKey: input.requestKey, requestHash,
    ownerHash: await sha(ownerToken), guestAccessHash: original.guestAccessHash,
    bookingId: booking.id, holdId: hold.id, acceptedQuoteId: accepted.id,
    amendsCheckoutId: original.id,
    paymentChoice, environment: gatewayEnvironment,
    state: dueNowPaise >= 100 ? "preparing" : "ready",
    razorpayKeyId: keyId, receipt: dueNowPaise >= 100 ? receiptFor(id) : null,
    dueNowPaise, guestName: original.guestName, guestEmail: original.guestEmail,
    guestPhone: original.guestPhone, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: checkouts.requestKey }).returning();
  if (!inserted.length) {
    const [race] = await db.select().from(checkouts).where(eq(checkouts.requestKey, input.requestKey)).limit(1);
    if (!race || race.requestHash !== requestHash) throw new GuestCheckoutError("Unable to recover amend request", 503);
    return {
      ...(await publicSnapshot(race, booking)),
      recovered: true, ownerToken: null as string | null, guestAccessToken: null as string | null,
      deltaPaise, razorpay: null, requiresPayment: race.dueNowPaise >= 100,
    };
  }
  let row = inserted[0];
  // Override quote dueNow — acceptNativeQuote stores full stay; ledger charges delta only.
  if (dueNowPaise >= 100) {
    try {
      row = await attachOrder(row, await createRazorpayBookingOrder({
        amountPaise: dueNowPaise,
        receipt: row.receipt!,
        checkoutId: id,
        gokoBookingId: booking.gokoBookingId || booking.bookingRef || `booking-${booking.id}`,
        environment: gatewayEnvironment,
      }));
    } catch {
      await db.update(checkouts).set({ state: "order_unknown", updatedAt: timestamp() })
        .where(and(eq(checkouts.id, id), ne(checkouts.state, "ready")));
      row = await getCheckoutById(id);
      if (row.bookingId) {
        await snapshotWebsiteOntoBooking(row.bookingId, row, { quoteJson: JSON.stringify(accepted.quote) });
      }
    }
  }
  return {
    ...(await publicSnapshot(row, booking)),
    recovered: false,
    ownerToken,
    guestAccessToken: null as string | null,
    holdExpiresAt: hold.expiresAt,
    deltaPaise,
    quote: {
      totalRupees: quote.totalRupees, taxRupees: quote.taxRupees, beforeTaxRupees: quote.beforeTaxRupees,
      dueNowPaise, alreadyPaidPaise,
    },
    razorpay: row.state === "ready" && row.razorpayOrderId
      ? { key: row.razorpayKeyId, order_id: row.razorpayOrderId, amount: row.dueNowPaise, currency: "INR" as const }
      : null,
    requiresPayment: dueNowPaise >= 100,
  };
}

/** Confirm amend when no payment due (delta ≤ 0). Payment path uses verify → fulfilGuestAmend. */
export async function confirmGuestAmend(raw: {
  reference: string; guestAccessToken: string; checkoutId: string; ownerToken?: string;
}) {
  cloudOnly();
  const auth = amendAuthSchema.parse({
    reference: raw.reference,
    guestAccessToken: raw.guestAccessToken,
  });
  await requireAmendableBooking(auth.reference, auth.guestAccessToken);
  const checkoutId = z.string().uuid().parse(raw.checkoutId);
  const row = await getCheckoutById(checkoutId);
  if (!row.amendsCheckoutId) throw new GuestCheckoutError("Not an amend checkout", 400);
  if (row.bookingId == null) throw new GuestCheckoutError("Booking not found", 404);
  const { booking } = await requireGuestAccess(auth.reference, auth.guestAccessToken);
  if (row.bookingId !== booking.id) throw new GuestCheckoutError("Checkout does not match this booking", 404);
  if (row.dueNowPaise >= 100) {
    throw new GuestCheckoutError("Payment is required for this change; complete checkout first");
  }
  if (raw.ownerToken) return fulfilGuestAmend(checkoutId, String(raw.ownerToken), false);
  return fulfilGuestAmend(checkoutId, undefined, true);
}

async function refundAmendDelta(row: Checkout, bookingId: number, refundPaise: number) {
  if (refundPaise < 100) return 0;
  const db = getDb();
  const cos = await db.select().from(checkouts).where(eq(checkouts.bookingId, bookingId));
  const capturedRows = cos.length
    ? await db.select().from(payments).where(and(
      inArray(payments.checkoutId, cos.map((c) => c.id)),
      eq(payments.captured, 1),
    ))
    : [];
  if (!capturedRows.length) return 0;
  const refundRows = await db.select().from(refunds).where(inArray(refunds.paymentId, capturedRows.map((p) => p.id)));
  const processed = refundRows.filter((r) => r.state === "processed").reduce((s, r) => s + r.amountPaise, 0);
  const reserved = refundRows.filter((r) => ["submitting", "unknown", "pending"].includes(r.state))
    .reduce((s, r) => s + r.amountPaise, 0);
  const capturedPaise = capturedRows.reduce((s, p) => s + p.amountPaise, 0);
  const refundable = Math.max(0, capturedPaise - processed - reserved);
  const target = Math.min(refundPaise, refundable);
  if (target < 100) return 0;
  const payment = capturedRows.find((p) => {
    const claimed = refundRows.filter((r) => r.paymentId === p.id).reduce((s, r) => s + r.amountPaise, 0);
    return p.amountPaise - claimed >= target;
  }) || capturedRows[0];
  const refundId = crypto.randomUUID();
  const inserted = await db.insert(refunds).values({
    id: refundId, paymentId: payment.id, receipt: receiptFor(refundId),
    amountPaise: target, createdAt: timestamp(), updatedAt: timestamp(),
  }).onConflictDoNothing({ target: refunds.paymentId }).returning();
  if (!inserted.length) return 0;
  try {
    const evidence = await createRazorpayBookingRefund(
      payment.id, target, inserted[0].receipt, refundId, checkoutEnv(row),
    );
    await recordBookingRefund(inserted[0], evidence);
  } catch {
    await db.update(refunds).set({ state: "unknown", updatedAt: timestamp() })
      .where(and(eq(refunds.paymentId, payment.id), eq(refunds.state, "submitting")));
  }
  return target;
}

/**
 * Amend fulfilment: release hold → unassign old beds → assign new → update booking → optional refund.
 * Called from payment verify when amendsCheckoutId is set, or from confirm when dueNow=0.
 */
export async function fulfilGuestAmend(checkoutId: string, ownerToken?: string, trustedServer = false) {
  cloudOnly();
  const row = trustedServer ? await getCheckoutById(checkoutId) : await requireOwner(checkoutId, ownerToken!);
  if (!row.amendsCheckoutId) throw new GuestCheckoutError("Not an amend checkout", 400);
  if (row.state === "fulfilled") {
    const [b] = row.bookingId ? await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1) : [];
    return await publicSnapshot(row, b);
  }
  if (["cancelled", "expired"].includes(row.state)) {
    throw new GuestCheckoutError("This change was cancelled or expired and cannot be completed", 409);
  }
  if (!row.bookingId || !row.holdId) throw new GuestCheckoutError("Amend checkout is missing booking or hold", 503);
  if (row.dueNowPaise >= 100) {
    const captured = await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1);
    if (!captured.length) throw new GuestCheckoutError("Payment has not been captured yet");
  }
  const [holdRow] = await getDb().select().from(holds).where(eq(holds.id, row.holdId)).limit(1);
  if (!holdRow) throw new GuestCheckoutError("Hold not found", 404);
  const [quoteRow] = row.acceptedQuoteId
    ? await getDb().select().from(quotes).where(eq(quotes.id, row.acceptedQuoteId)).limit(1) : [];
  if (!quoteRow) throw new GuestCheckoutError("Accepted quote not found", 503);
  const storedQuote = JSON.parse(quoteRow.quoteJson) as Record<string, unknown>;
  const {
    currency: _c, nativeCheckoutReady: _n, beforeTaxRupees: _b, taxRupees: _t,
    totalRupees: _tr, dueNowPaise: _d, dueAtPropertyPaise: _dap, totalPaise: _tp, ...quoteInput
  } = storedQuote;
  const quote = buildNativeBookingQuote(quoteInput as Parameters<typeof buildNativeBookingQuote>[0]);
  const bedIds = JSON.parse(holdRow.bedIds) as number[];
  const allBeds = await getAllBeds();
  const bedMeta = new Map(allBeds.map((b) => [b.id, b]));
  const dormIds = [...new Set(bedIds.map((id) => bedMeta.get(id)?.dormId).filter(Boolean) as number[])];
  const nights = occupiedNights(holdRow.checkinDate, holdRow.checkoutDate);
  const [bookingBefore] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
  if (!bookingBefore) throw new GuestCheckoutError("Booking not found", 404);
  const oldNights = bookingBefore.checkoutDate
    ? occupiedNights(bookingBefore.checkinDate, bookingBefore.checkoutDate)
    : [];
  const before = await otaFingerprint(dormIds, [...new Set([...nights, ...oldNights])]);

  if (holdRow.state === "held") {
    if (ownerToken && !trustedServer) {
      await releaseNativeInventoryHold(row.holdId, ownerToken);
    } else {
      await getDb().update(holds).set({ state: "released" }).where(and(eq(holds.id, row.holdId), eq(holds.state, "held")));
    }
  }

  const priorAssignments = await getDb().select({
    bedId: bookingBedAssignments.bedId,
    dormId: bookingBedAssignments.dormId,
    checkinDate: bookingBedAssignments.checkinDate,
    checkoutDate: bookingBedAssignments.checkoutDate,
    inventoryPool: bookingBedAssignments.inventoryPool,
  }).from(bookingBedAssignments).where(and(
    eq(bookingBedAssignments.bookingId, row.bookingId),
    eq(bookingBedAssignments.status, "assigned"),
  ));

  await unassignBookingBeds(row.bookingId);

  const assigned: number[] = [];
  let usedOfflineFallback = false;
  try {
    const heldBeds = bedIds.map((id) => {
      const bed = bedMeta.get(id);
      if (!bed) throw new GuestCheckoutError("Held bed is missing from inventory", 503);
      return bed;
    });
    const heldUnits = sellableUnits(heldBeds).filter((u) =>
      u.beds.every((b) => b.id != null && bedIds.includes(b.id)),
    );
    if (heldUnits.length === 0 || heldUnits.reduce((n, u) => n + u.beds.length, 0) !== bedIds.length) {
      throw new GuestCheckoutError("Held beds do not form complete sellable units", 503);
    }

    const tryAssignUnit = async (ids: number[], pool: InventoryPool): Promise<boolean> =>
      tryAssignUnitSoft({
        bookingId: row.bookingId!, ids, pool,
        checkinDate: holdRow.checkinDate, checkoutDate: holdRow.checkoutDate, bedMeta,
      });

    const claimed = new Set<number>();
    for (const unit of heldUnits) {
      const unitIds = unit.beds.map((b) => b.id!).filter((id) => id != null);
      if (await tryAssignUnit(unitIds, "online")) {
        unitIds.forEach((id) => { assigned.push(id); claimed.add(id); });
        continue;
      }
      if (await tryAssignUnit(unitIds, "offline")) {
        usedOfflineFallback = true;
        unitIds.forEach((id) => { assigned.push(id); claimed.add(id); });
        continue;
      }
      const tagged = await getAvailableBedsForRange(
        holdRow.checkinDate, holdRow.checkoutDate, unit.dormId, row.bookingId,
      );
      const matchType = (t: string | null | undefined) =>
        unit.type === "Double" ? t === "Double" : t !== "Double";
      const candidates = (pool: "online" | "offline") =>
        sellableUnits(
          tagged.filter((b) =>
            b.pool === pool && matchType(b.type) && !claimed.has(b.id) && !assigned.includes(b.id),
          ),
        ).filter((u) =>
          u.type === unit.type
          && (unit.type !== "Double" || u.beds.length === 2)
          && u.beds.every((b) => b.id != null && !claimed.has(b.id)),
        );

      let placed = false;
      for (const pool of ["online", "offline"] as const) {
        for (const alt of candidates(pool)) {
          const altIds = alt.beds.map((b) => b.id!);
          if (await tryAssignUnit(altIds, pool)) {
            if (pool === "offline") usedOfflineFallback = true;
            altIds.forEach((id) => { assigned.push(id); claimed.add(id); });
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) throw new GuestCheckoutError("Could not assign a held bed", 503);
    }

    const alreadyPaidPaise = Math.round((bookingBefore.amountPaid || 0) * 100);
    const deltaPaise = computeAmendDeltaPaise(quote.totalPaise, alreadyPaidPaise);
    let refundedPaise = 0;
    if (deltaPaise < 0) {
      refundedPaise = await refundAmendDelta(row, row.bookingId, -deltaPaise);
    }
    const roomLabel = heldUnits.map((u) => `${u.type}`).join(", ");
    const paidBoost = row.dueNowPaise >= 100 ? row.dueNowPaise / 100 : 0;
    await updateBookingFull(row.bookingId, {
      checkinDate: holdRow.checkinDate,
      checkoutDate: holdRow.checkoutDate,
      roomType: roomLabel,
      persons: heldUnits.reduce((n, u) => n + (u.type === "Double" ? 2 : 1), 0),
      amountBeforeTax: quote.beforeTaxRupees,
      amountTax: quote.taxRupees,
      amountTotal: quote.totalRupees,
      amountPaid: (bookingBefore.amountPaid || 0) + paidBoost,
      amountRefunded: (bookingBefore.amountRefunded || 0) + refundedPaise / 100,
      ratePlan: [...new Set(quote.units.map((u) => u.key.split(":")[0]))].join(",") || bookingBefore.ratePlan,
      holdExpiresAt: "",
      status: bookingBefore.status === "hold" ? "received" : bookingBefore.status,
      paymentStatus: ((bookingBefore.amountPaid || 0) + paidBoost) > 0 ? "partial_or_paid" : bookingBefore.paymentStatus,
      rawData: JSON.stringify({
        ...((): Record<string, unknown> => {
          try { return JSON.parse(bookingBefore.rawData || "{}") as Record<string, unknown>; }
          catch { return {}; }
        })(),
        lastAmendCheckoutId: checkoutId,
        amendsCheckoutId: row.amendsCheckoutId,
      }),
    });

    await getDb().update(checkouts).set({ state: "fulfilled", updatedAt: timestamp() }).where(eq(checkouts.id, checkoutId));
    await addBookingHistoryEntry({
      bookingId: row.bookingId, action: "website_amend",
      details: usedOfflineFallback
        ? `Guest amend ${checkoutId} delta=${deltaPaise} (offline pool fallback)`
        : `Guest amend ${checkoutId} delta=${deltaPaise}`,
      performedBy: "website",
    });
    await afterResponse((async () => {
      try { await pushIfOtaChanged(before, dormIds, [...new Set([...nights, ...oldNights])]); }
      catch { /* best-effort */ }
      const bookingId = row.bookingId!;
      const [confirmed] = await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      if (confirmed) {
        const snap = await publicSnapshot(row, confirmed);
        await sendBookingAmendedEmail({
          guestName: row.guestName, guestEmail: row.guestEmail,
          reference: confirmed.gokoBookingId || confirmed.bookingRef || String(confirmed.id),
          checkinDate: confirmed.checkinDate, checkoutDate: confirmed.checkoutDate || "",
          totalRupees: confirmed.amountTotal || 0, paidRupees: confirmed.amountPaid || 0,
          nights: snap.nights, rooms: snap.rooms, persons: snap.persons,
          beforeTaxRupees: snap.beforeTaxRupees, taxRupees: snap.taxRupees, taxPercent: snap.taxPercent,
          paymentChoice: snap.paymentChoice, cancellationDeadlineAt: snap.cancellationDeadlineAt,
        });
      }
    })());
  } catch (error) {
    if (assigned.length) await unassignBookingBeds(row.bookingId);
    const hasCapture = row.dueNowPaise >= 100 && (await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1)).length > 0;
    if (hasCapture) {
      await getDb().update(checkouts).set({
        state: "captured_unfulfilled", closureReason: "cannot_fulfil", updatedAt: timestamp(),
      }).where(eq(checkouts.id, checkoutId));
      await addBookingHistoryEntry({
        bookingId: row.bookingId, action: "website_unfulfilled",
        details: unfulfilledDetail(
          "Amend payment captured; bed assign failed — assign manually from Unassigned",
          error,
        ),
        performedBy: "website",
      });
      throw new GuestCheckoutError(
        "Payment was captured but beds could not be reassigned. Goko will complete this change manually — do not pay again.",
        503,
      );
    }
    // Restore previous beds so an unpaid amend failure never leaves a confirmed booking bedless.
    for (const prior of priorAssignments) {
      await assignBedToBooking({
        bookingId: row.bookingId!,
        bedId: prior.bedId,
        dormId: prior.dormId,
        checkinDate: prior.checkinDate,
        checkoutDate: prior.checkoutDate,
        assignedBy: "website_amend_restore",
        inventoryPool: prior.inventoryPool === "offline" ? "offline" : "online",
      });
    }
    throw error;
  }
  const fresh = await getCheckoutById(checkoutId);
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
  return await publicSnapshot(fresh, booking);
}

export async function cancelGuestBooking(reference: string, guestAccessToken: string) {
  cloudOnly();
  const { checkout, booking, checkouts: all } = await requireGuestAccess(reference, guestAccessToken);
  if (!["hold", "received"].includes(booking.status)) {
    throw new GuestCheckoutError("This booking can no longer be cancelled online");
  }
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  const checkoutIds = all.map((c) => c.id);
  const capturedRows = checkoutIds.length
    ? await getDb().select().from(payments)
      .where(and(inArray(payments.checkoutId, checkoutIds), eq(payments.captured, 1)))
    : [];
  const capturedPaise = capturedRows.reduce((s, p) => s + p.amountPaise, 0);
  const refundRows = capturedRows.length
    ? await getDb().select().from(refunds).where(inArray(refunds.paymentId, capturedRows.map((p) => p.id)))
    : [];
  const processedRefundPaise = refundRows.filter((r) => r.state === "processed").reduce((s, r) => s + r.amountPaise, 0);
  const reservedRefundPaise = refundRows.filter((r) => ["submitting", "unknown", "pending"].includes(r.state))
    .reduce((s, r) => s + r.amountPaise, 0);
  const calc = calculateNativeCancellationRefund({
    checkinDate: booking.checkinDate, policy: settings, nowEpochMs: Date.now(),
    lifecycle: booking.status === "hold" ? "provisional" : "received",
    reason: "guest_cancelled", capturedPaise, processedRefundPaise, reservedRefundPaise,
  });
  if (!calc.eligible) throw new GuestCheckoutError("Cancellation deadline has passed for online self-service");

  for (const c of all) {
    if (c.holdId && booking.status === "hold") {
      await getDb().update(holds).set({ state: "released" })
        .where(and(eq(holds.id, c.holdId), eq(holds.state, "held")));
    }
  }
  if (booking.status === "received") {
    await unassignBookingBeds(booking.id);
  }
  for (const c of all) {
    if (!["cancelled", "expired"].includes(c.state)) {
      await getDb().update(checkouts).set({
        state: "cancelled", closureReason: "guest_cancelled", updatedAt: timestamp(),
      }).where(eq(checkouts.id, c.id));
    }
  }
  await transitionBookingStatus(booking.id, ["hold", "received"], {
    status: "cancelled", cancelledAt: timestamp(), holdExpiresAt: "",
  });
  await addBookingHistoryEntry({
    bookingId: booking.id, action: "guest_cancel", details: `Refund target ${calc.refundPaise} paise`, performedBy: "guest",
  });

  if (calc.refundPaise >= 100 && capturedRows[0]) {
    const payment = capturedRows[0];
    const refundId = crypto.randomUUID();
    const inserted = await getDb().insert(refunds).values({
      id: refundId, paymentId: payment.id, receipt: receiptFor(refundId),
      amountPaise: calc.refundPaise, createdAt: timestamp(), updatedAt: timestamp(),
    }).onConflictDoNothing({ target: refunds.paymentId }).returning();
    if (inserted.length) {
      try {
        const evidence = await createRazorpayBookingRefund(
          payment.id, calc.refundPaise, inserted[0].receipt, refundId, checkoutEnv(checkout),
        );
        await recordBookingRefund(inserted[0], evidence);
      } catch {
        await getDb().update(refunds).set({ state: "unknown", updatedAt: timestamp() })
          .where(and(eq(refunds.paymentId, payment.id), eq(refunds.state, "submitting")));
      }
    }
  }
  const fresh = await getCheckoutById(checkout.id);
  const [b] = await getDb().select().from(bookings).where(eq(bookings.id, booking.id)).limit(1);
  return await publicSnapshot(fresh, b, { refundPaise: calc.refundPaise });
}

async function recordBookingRefund(claim: typeof refunds.$inferSelect, evidence: RazorpayRefund) {
  const noteId = evidence.notes && !Array.isArray(evidence.notes) ? evidence.notes.goko_booking_refund : undefined;
  if (evidence.payment_id !== claim.paymentId || evidence.amount !== claim.amountPaise
      || evidence.receipt !== claim.receipt || noteId !== claim.id
      || claim.providerId && evidence.id !== claim.providerId) throw new RazorpayError("MISMATCH");
  const rows = await getDb().update(refunds).set({
    providerId: evidence.id, state: evidence.status, updatedAt: timestamp(),
  }).where(and(eq(refunds.paymentId, claim.paymentId), ne(refunds.state, "processed"),
    sql`(${refunds.providerId} IS NULL OR ${refunds.providerId} = ${evidence.id})`)).returning();
  if (!rows.length) {
    const [current] = await getDb().select().from(refunds).where(eq(refunds.paymentId, claim.paymentId)).limit(1);
    if (!current || current.state !== "processed" || current.providerId !== evidence.id) throw new RazorpayError("MISMATCH");
  }
}

const supportedEvents = new Set([
  "payment.authorized", "payment.captured", "payment.failed", "order.paid",
  "refund.created", "refund.processed", "refund.failed",
]);

/** Route native booking webhooks (notes.goko_checkout_id). Accepts test or live webhook HMAC. */
export async function receiveNativeBookingWebhook(raw: Uint8Array, signature: string, eventId: string) {
  cloudOnly();
  z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).parse(eventId);
  const secrets = allRazorpayWebhookSecrets();
  if (!secrets.length) throw new RazorpayError("CONFIGURATION");
  let verified = false;
  for (const secret of secrets) if (await verifyRazorpaySignature(raw, signature, secret)) verified = true;
  if (!verified) throw new RazorpayError("SIGNATURE", 400);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new GuestCheckoutError("Invalid webhook JSON", 400); }
  const parsed = z.object({
    event: z.string().regex(/^[a-z_.]+$/).max(100),
    account_id: z.string().regex(/^acc_[A-Za-z0-9]+$/),
    payload: z.record(z.object({
      entity: z.object({
        id: z.string().max(80), order_id: z.string().nullable().optional(),
        payment_id: z.string().optional(),
        notes: z.record(z.string()).or(z.array(z.unknown()).length(0)).optional(),
      }).passthrough(),
    })),
  }).parse(value);
  const allowedAccounts = [
    process.env.RAZORPAY_TEST_ACCOUNT_ID, process.env.RAZORPAY_LIVE_ACCOUNT_ID,
  ].filter((s): s is string => Boolean(s?.trim()));
  if (allowedAccounts.length && !allowedAccounts.includes(parsed.account_id)) {
    throw new RazorpayError("MISMATCH", 400);
  }
  const p = parsed.payload.payment?.entity, r = parsed.payload.refund?.entity, o = parsed.payload.order?.entity;
  const supported = supportedEvents.has(parsed.event);
  const refundEvent = parsed.event.startsWith("refund.") && supported;
  const refundId = refundEvent ? razorpayId("rfnd").parse(r?.id) : null;
  const paymentId = p?.id || r?.payment_id || null;
  const orderId = p?.order_id || o?.id || null;
  const orderNotes = o?.notes || p?.notes;
  const noteId = orderNotes && !Array.isArray(orderNotes) ? orderNotes.goko_checkout_id : undefined;
  const checkoutId = noteId && z.string().uuid().safeParse(noteId).success ? noteId : null;
  if (supported) {
    if (refundEvent && (!r?.payment_id || paymentId !== r.payment_id)) {
      throw new GuestCheckoutError("Missing or conflicting refund payment identifier", 400);
    }
    if (paymentId) razorpayId("pay").parse(paymentId);
    if (orderId) razorpayId("order").parse(orderId);
    if (!paymentId && !orderId) throw new GuestCheckoutError("Missing webhook recovery identifiers", 400);
  }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw))),
    (b) => b.toString(16).padStart(2, "0")).join("");
  const now = timestamp();
  await getDb().insert(hooks).values({
    eventId, payloadHash: hash, eventType: parsed.event,
    orderId: supported ? orderId : null, paymentId: supported ? paymentId : null,
    refundId, checkoutId, state: supported ? "received" : "ignored", receivedAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: hooks.eventId });
  const [stored] = await getDb().select().from(hooks).where(eq(hooks.eventId, eventId)).limit(1);
  if (!stored || stored.payloadHash !== hash) throw new GuestCheckoutError("Conflicting webhook replay", 409);
  return processNativeBookingWebhook(eventId);
}

export async function processNativeBookingWebhook(eventId: string) {
  cloudOnly();
  const [hook] = await getDb().select().from(hooks).where(eq(hooks.eventId, eventId)).limit(1);
  if (!hook) throw new GuestCheckoutError("Webhook not found", 404);
  if (["processed", "ignored"].includes(hook.state)) return { state: hook.state };
  try {
    let orderId = hook.orderId;
    let row: Checkout | undefined;
    if (hook.checkoutId) {
      try { row = await getCheckoutById(hook.checkoutId); } catch { /* unmatched until order recovery */ }
    }
    const env: RazorpayEnvironment = row ? checkoutEnv(row) : "test";
    if (!orderId && hook.paymentId) {
      const p = await fetchRazorpayBookingPayment(hook.paymentId, env);
      if (p.id !== hook.paymentId) throw new RazorpayError("MISMATCH");
      orderId = p.order_id;
    }
    if (!row && orderId) {
      [row] = await getDb().select().from(checkouts).where(eq(checkouts.razorpayOrderId, orderId)).limit(1);
    }
    if (!row && hook.checkoutId) row = await recoverOrder(await getCheckoutById(hook.checkoutId));
    if (!row || row.razorpayOrderId !== orderId) {
      throw new GuestCheckoutError("Unmatched booking webhook retained for reconciliation", 503);
    }
    const rowEnv = checkoutEnv(row);
    if (hook.paymentId) {
      const evidence = await fetchRazorpayBookingPayment(hook.paymentId, rowEnv);
      if (evidence.id !== hook.paymentId) throw new RazorpayError("MISMATCH");
      await recordPayment(row, evidence);
    }
    const captured = await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, row.id), eq(payments.captured, 1)));
    if (hook.eventType === "payment.captured" && !captured.some((p) => p.id === hook.paymentId) ||
        hook.eventType === "order.paid" && !captured.length) {
      throw new GuestCheckoutError("Capture evidence is not yet visible; webhook retry required", 503);
    }
    if (captured.length && !["fulfilled", "captured_unfulfilled", "cancelled"].includes(row.state)) {
      try {
        await fulfilGuestCheckout(row.id, undefined, true);
      } catch {
        // Capture retained; captured_unfulfilled or retry on next webhook/reconcile.
      }
    } else if (captured.length && row.state === "cancelled") {
      await applyOrphanCaptureIfNeeded(row);
    }
    await getDb().update(hooks).set({ state: "processed", updatedAt: timestamp() }).where(eq(hooks.eventId, eventId));
    return { state: "processed" };
  } catch (error) {
    await getDb().update(hooks).set({ state: "retry", updatedAt: timestamp() })
      .where(and(eq(hooks.eventId, eventId), ne(hooks.state, "processed")));
    throw error;
  }
}

/**
 * Admin: refund Razorpay capture on a cancelled website booking (orphan / uncertain path).
 * Uses native payment rows; updates bookings.amountRefunded. No inventory change.
 */
export async function refundWebsiteOrphanCapture(bookingId: number, performedBy: string) {
  cloudOnly();
  if (!Number.isInteger(bookingId) || bookingId < 1) {
    throw new GuestCheckoutError("Invalid booking", 400);
  }
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw new GuestCheckoutError("Booking not found", 404);
  if (booking.source !== "website") {
    throw new GuestCheckoutError("Only Goko Website bookings can use orphan refund", 400);
  }
  if (booking.status !== "cancelled") {
    throw new GuestCheckoutError("Orphan refund is only for cancelled website bookings", 400);
  }
  const alreadyRefunded = Number(booking.amountRefunded || 0);
  const paid = Number(booking.amountPaid || 0);
  const remainingRupees = Math.max(0, paid - alreadyRefunded);
  if (remainingRupees < 1) {
    throw new GuestCheckoutError("Nothing left to refund on this booking", 400);
  }
  const targetPaise = Math.round(remainingRupees * 100);
  if (targetPaise < 100) {
    throw new GuestCheckoutError("Refund amount is below Razorpay minimum", 400);
  }

  const cos = await getDb().select().from(checkouts).where(eq(checkouts.bookingId, bookingId));
  if (!cos.length) throw new GuestCheckoutError("No website checkout found for this booking", 404);
  const capturedRows = await getDb().select().from(payments).where(and(
    inArray(payments.checkoutId, cos.map((c) => c.id)),
    eq(payments.captured, 1),
  ));
  if (!capturedRows.length) {
    throw new GuestCheckoutError("No captured Razorpay payment found — check dashboard with Order ID on this booking", 400);
  }
  const refundRows = await getDb().select().from(refunds)
    .where(inArray(refunds.paymentId, capturedRows.map((p) => p.id)));
  const processed = refundRows.filter((r) => r.state === "processed").reduce((s, r) => s + r.amountPaise, 0);
  const reserved = refundRows.filter((r) => ["submitting", "unknown", "pending"].includes(r.state))
    .reduce((s, r) => s + r.amountPaise, 0);
  const capturedPaise = capturedRows.reduce((s, p) => s + p.amountPaise, 0);
  const refundable = Math.max(0, capturedPaise - processed - reserved);
  const amount = Math.min(targetPaise, refundable);
  if (amount < 100) {
    throw new GuestCheckoutError("No refundable Razorpay balance left (check pending refunds)", 400);
  }
  const payment = capturedRows.find((p) => {
    const claimed = refundRows.filter((r) => r.paymentId === p.id).reduce((s, r) => s + r.amountPaise, 0);
    return p.amountPaise - claimed >= amount;
  }) || capturedRows[0];
  const checkout = cos.find((c) => c.id === payment.checkoutId) || cos[0];
  const refundId = crypto.randomUUID();
  const inserted = await getDb().insert(refunds).values({
    id: refundId, paymentId: payment.id, receipt: receiptFor(refundId),
    amountPaise: amount, createdAt: timestamp(), updatedAt: timestamp(),
  }).onConflictDoNothing({ target: refunds.paymentId }).returning();
  if (!inserted.length) {
    throw new GuestCheckoutError("A refund is already in progress for this payment", 409);
  }
  try {
    const evidence = await createRazorpayBookingRefund(
      payment.id, amount, inserted[0].receipt, refundId, checkoutEnv(checkout),
    );
    await recordBookingRefund(inserted[0], evidence);
  } catch (error) {
    await getDb().update(refunds).set({ state: "unknown", updatedAt: timestamp() })
      .where(and(eq(refunds.paymentId, payment.id), eq(refunds.state, "submitting")));
    throw error instanceof GuestCheckoutError || error instanceof RazorpayError
      ? error
      : new GuestCheckoutError("Razorpay refund failed — check dashboard and retry", 503);
  }
  const refundedRupees = amount / 100;
  await updateBookingFull(bookingId, {
    amountRefunded: alreadyRefunded + refundedRupees,
    refundMethod: checkout.environment === "live" ? "razorpay_live" : "razorpay_test",
  });
  await addBookingHistoryEntry({
    bookingId,
    action: "website_orphan_refund",
    details: `Refunded ₹${refundedRupees.toFixed(2)} via Razorpay payment ${payment.id}`,
    performedBy: performedBy || "admin",
  });
  const fresh = await getCheckoutById(checkout.id);
  let quoteJson: string | null = null;
  if (fresh.acceptedQuoteId) {
    const [q] = await getDb().select().from(quotes).where(eq(quotes.id, fresh.acceptedQuoteId)).limit(1);
    quoteJson = q?.quoteJson ?? null;
  }
  await snapshotWebsiteOntoBooking(bookingId, fresh, {
    orphanCapture: parseWebsiteCheckout((await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0]?.rawData)?.orphanCapture === true,
    quoteJson,
  });
  return {
    refundedRupees,
    paymentId: payment.id,
    amountRefunded: alreadyRefunded + refundedRupees,
  };
}

/** Staff-facing outcome for Management → Booking Settings → Website payments. */
export function websiteCheckoutOutcome(
  state: string,
  hasCapturedPayment: boolean,
  bookingStatus?: string | null,
): "Passed" | "Failed" | "Unknown" | "Orphan" | "In progress" | "Pay at property" {
  // Open checkout left behind after the booking was cancelled (abandon / staff cancel).
  if (
    bookingStatus === "cancelled" &&
    (state === "ready" || state === "claimed" || state === "captured" || state === "preparing")
  ) {
    return hasCapturedPayment ? "Orphan" : "Failed";
  }
  if (state === "fulfilled") return "Passed";
  if (state === "captured_unfulfilled") return "Passed";
  if (state === "order_unknown") return "Unknown";
  if (state === "cancelled" || state === "expired") {
    return hasCapturedPayment ? "Orphan" : "Failed";
  }
  if (state === "ready" || state === "claimed" || state === "captured" || state === "preparing") {
    return "In progress";
  }
  return "Unknown";
}

/** Recent native website checkout attempts for admin audit (test + live). */
export async function listWebsiteCheckoutAttempts(limit = 50) {
  cloudOnly();
  const db = getDb();
  const capped = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = await db.select({
    id: checkouts.id,
    state: checkouts.state,
    environment: checkouts.environment,
    paymentChoice: checkouts.paymentChoice,
    dueNowPaise: checkouts.dueNowPaise,
    razorpayOrderId: checkouts.razorpayOrderId,
    receipt: checkouts.receipt,
    guestName: checkouts.guestName,
    guestEmail: checkouts.guestEmail,
    guestPhone: checkouts.guestPhone,
    bookingId: checkouts.bookingId,
    closureReason: checkouts.closureReason,
    createdAt: checkouts.createdAt,
    updatedAt: checkouts.updatedAt,
    gokoBookingId: bookings.gokoBookingId,
    bookingRef: bookings.bookingRef,
    bookingStatus: bookings.status,
  }).from(checkouts)
    .leftJoin(bookings, eq(checkouts.bookingId, bookings.id))
    .orderBy(desc(checkouts.createdAt))
    .limit(capped);

  const ids = rows.map((r) => r.id);
  const payRows = ids.length
    ? await db.select({
      checkoutId: payments.checkoutId,
      id: payments.id,
      captured: payments.captured,
      status: payments.status,
      amountPaise: payments.amountPaise,
    }).from(payments).where(inArray(payments.checkoutId, ids))
    : [];
  const byCheckout = new Map<string, typeof payRows>();
  for (const p of payRows) {
    const list = byCheckout.get(p.checkoutId) || [];
    list.push(p);
    byCheckout.set(p.checkoutId, list);
  }

  return rows.map((row) => {
    const pays = byCheckout.get(row.id) || [];
    const hasCaptured = pays.some((p) => p.captured === 1);
    const outcome = row.dueNowPaise === 0 && row.state === "fulfilled"
      ? "Pay at property" as const
      : websiteCheckoutOutcome(row.state, hasCaptured, row.bookingStatus);
    return {
      ...row,
      gokoBookingId: row.gokoBookingId || row.bookingRef || null,
      outcome,
      paymentIds: pays.map((p) => p.id),
      capturedPaise: pays.filter((p) => p.captured === 1).reduce((s, p) => s + p.amountPaise, 0),
    };
  });
}

/** Peek notes without full processing — used by webhook router. */
export function peekRazorpayNotes(raw: Uint8Array): { checkoutId?: string; previewAttemptId?: string } {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as {
      payload?: Record<string, { entity?: { notes?: Record<string, string> | unknown[] } }>;
    };
    const entities = [value.payload?.payment?.entity, value.payload?.order?.entity, value.payload?.refund?.entity];
    for (const entity of entities) {
      const notes = entity?.notes;
      if (notes && !Array.isArray(notes)) {
        if (typeof notes.goko_checkout_id === "string") return { checkoutId: notes.goko_checkout_id };
        if (typeof notes.goko_preview_attempt === "string") return { previewAttemptId: notes.goko_preview_attempt };
      }
    }
  } catch { /* fall through */ }
  return {};
}
