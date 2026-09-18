import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  nativeBookingCheckouts as checkouts, nativeBookingPayments as payments,
  nativeBookingRefunds as refunds, nativeBookingWebhooks as hooks, bookings,
  nativeInventoryHolds as holds,
} from "@/db/schema";
import {
  addBooking, assignBedToBooking, getAllBeds, getAllDailyRates, getRatePlanMappings,
  getRoomTypeMappings, getSetting, transitionBookingStatus, unassignBookingBeds,
  updateBookingFull, addBookingHistoryEntry,
} from "@/db/queries";
import { BOOKING_TAX_SETTING } from "@/lib/bookingPricing";
import { generateGokoBookingId, generateGuestAccessToken, hashToken } from "@/lib/bookingReference";
import { guestRateForStay, guestTaxPercent } from "@/lib/guestBookingSearch";
import { occupiedNights } from "@/lib/inventoryAvailability";
import {
  acceptNativeQuote,
} from "@/lib/nativeAcceptedQuote";
import { calculateNativeCancellationRefund } from "@/lib/nativeBookingQuote";
import {
  createNativeInventoryHold, getNativeSelectionAvailability,
  releaseNativeInventoryHold,
} from "@/lib/nativeInventoryHold";
import { evaluateNativeCheckoutReadiness } from "@/lib/nativeCheckoutReadiness";
import { otaFingerprint, pushIfOtaChanged } from "@/lib/aiosellSync";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { isPiRuntime } from "@/lib/runtime";
import {
  RazorpayError, testRazorpayCredentials, createRazorpayBookingOrder, findRazorpayBookingOrders,
  fetchRazorpayBookingPayment, fetchRazorpayBookingOrderPayments, createRazorpayBookingRefund,
  fetchRazorpayBookingRefunds, verifyCheckoutSignature, verifyRazorpaySignature, razorpayId,
  type RazorpayPayment, type RazorpayRefund,
} from "@/lib/razorpay";
import {
  readWebsiteBookingSettings, websiteBookingSettingsRevision, WEBSITE_BOOKING_SETTINGS_KEY,
} from "@/lib/websiteBookingSettings";
import { todayIST } from "@/lib/utils";

type Checkout = typeof checkouts.$inferSelect;
const timestamp = () => new Date().toISOString();
const receiptFor = (id: string) => `gbk_${id.replace(/-/g, "").slice(0, 32)}`;
const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/);
const token64 = z.string().regex(/^[a-f0-9]{64}$/);
const selectionSchema = z.object({
  requestKey: z.string().uuid(),
  checkinDate: date, checkoutDate: date,
  paymentChoice: z.enum(["advance", "full", "property"]),
  guest: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(30).default(""),
  }).strict(),
  rooms: z.array(z.object({
    roomId: z.string().regex(/^\d+-(Double|Bed)$/),
    quantity: z.number().int().min(1).max(4),
    ratePlanId: z.number().int().positive(),
  }).strict()).min(1).max(4),
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
}): Promise<{ bedIds: number[]; units: AllocatedUnit[] }> {
  const avail = await getNativeSelectionAvailability({
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
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
  return updated[0];
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

async function requireGuestAccess(reference: string, guestAccessToken: string) {
  token64.parse(guestAccessToken);
  const accessHash = await sha(guestAccessToken);
  const [row] = await getDb().select().from(checkouts)
    .where(and(eq(checkouts.guestAccessHash, accessHash))).limit(1);
  if (!row) throw new GuestCheckoutError("Booking not found", 404);
  const [booking] = row.bookingId
    ? await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1) : [];
  if (!booking || (booking.gokoBookingId !== reference && booking.bookingRef !== reference)) {
    throw new GuestCheckoutError("Booking not found", 404);
  }
  return { checkout: row, booking };
}

function publicSnapshot(row: Checkout, booking: typeof bookings.$inferSelect | undefined, extras: Record<string, unknown> = {}) {
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
    amountTotal: booking?.amountTotal ?? null,
    amountPaid: booking?.amountPaid ?? null,
    dueAtPropertyPaise: booking && row.dueNowPaise >= 0
      ? Math.max(0, Math.round((booking.amountTotal || 0) * 100) - (booking.amountPaid || 0) * 100) : null,
    ...extras,
  };
}

/** Idempotent prepare: hold → quote → provisional booking → optional Razorpay order. */
export async function prepareGuestCheckout(raw: z.input<typeof selectionSchema>) {
  await requireReady();
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
      ...publicSnapshot(existing, booking),
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
  const bookingId = await addBooking({
    guestName: input.guest.name, contact: input.guest.phone, email: input.guest.email,
    platform: "Website", bookingRef: gokoId, gokoBookingId: gokoId,
    checkinDate: input.checkinDate, checkoutDate: input.checkoutDate,
    roomType: roomLabel, persons: units.reduce((n, u) => n + (u.type === "Double" ? 2 : 1), 0),
    status: "hold", source: "website", paymentStatus: quote.dueNowPaise >= 100 ? "pending" : "pay_at_property",
    amountBeforeTax: quote.beforeTaxRupees, amountTax: quote.taxRupees, amountTotal: quote.totalRupees,
    amountPaid: 0, currency: "INR",
    ratePlan: [...new Set(units.map((u) => String(u.ratePlanId)))].join(","),
    rawData: JSON.stringify({ nativeCheckout: true, paymentChoice: input.paymentChoice, holdId: hold.id }),
  });
  if (!bookingId) throw new GuestCheckoutError("Could not create provisional booking", 503);
  await updateBookingFull(bookingId, {
    holdExpiresAt: new Date(hold.expiresAt * 1000).toISOString(),
  });
  const id = crypto.randomUUID();
  const now = timestamp();
  const keyId = quote.dueNowPaise >= 100 ? testRazorpayCredentials().keyId : null;
  const inserted = await db.insert(checkouts).values({
    id, requestKey: input.requestKey, requestHash,
    ownerHash: await sha(ownerToken), guestAccessHash: await sha(guestAccessToken),
    bookingId, holdId: hold.id, acceptedQuoteId: accepted.id,
    paymentChoice: input.paymentChoice, environment: "test",
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
      ...publicSnapshot(race, bookingRace),
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
        amountPaise: quote.dueNowPaise, receipt: row.receipt!, checkoutId: id, environment: "test",
      }));
    } catch {
      await db.update(checkouts).set({ state: "order_unknown", updatedAt: timestamp() })
        .where(and(eq(checkouts.id, id), ne(checkouts.state, "ready")));
      row = (await getCheckoutById(id));
    }
  } else {
    await fulfilGuestCheckout(id, ownerToken);
    row = await getCheckoutById(id);
  }
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return {
    ...publicSnapshot(row, booking),
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
  const candidates = (await findRazorpayBookingOrders(row.receipt)).filter((o) => o.receipt === row.receipt);
  if (candidates.length !== 1) {
    throw new GuestCheckoutError("Order creation is still unresolved. Do not start another payment; reconcile this checkout.");
  }
  return attachOrder(row, candidates[0]);
}

export async function reconcileGuestCheckout(checkoutId: string, ownerToken: string) {
  cloudOnly();
  let row = await recoverOrder(await requireOwner(checkoutId, ownerToken));
  if (row.dueNowPaise >= 100 && row.razorpayOrderId) {
    const evidence = await fetchRazorpayBookingOrderPayments(row.razorpayOrderId);
    const seen = new Set<string>();
    for (const payment of evidence) {
      if (seen.has(payment.id)) throw new RazorpayError("INVALID_RESPONSE");
      seen.add(payment.id);
      await recordPayment(row, payment);
    }
    const known = await getDb().select().from(payments).where(eq(payments.checkoutId, checkoutId));
    for (const payment of known) {
      if (!seen.has(payment.id)) {
        const fetched = await fetchRazorpayBookingPayment(payment.id);
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
  return publicSnapshot(row, booking);
}

export async function verifyGuestPayment(checkoutId: string, ownerToken: string, paymentId: string, orderId: string, signature: string) {
  cloudOnly();
  const row = await requireOwner(checkoutId, ownerToken);
  if (!row.razorpayOrderId || orderId !== row.razorpayOrderId) throw new RazorpayError("MISMATCH", 400);
  if (!await verifyCheckoutSignature(row.razorpayOrderId, paymentId, signature)) throw new RazorpayError("SIGNATURE", 400);
  const evidence = await fetchRazorpayBookingPayment(paymentId);
  if (evidence.id !== paymentId) throw new RazorpayError("MISMATCH");
  await recordPayment(row, evidence);
  if (evidence.captured && ["captured", "refunded"].includes(evidence.status)) {
    if (["cancelled", "expired"].includes(row.state)) {
      // Capture retained; do not resurrect a cancelled/expired checkout via browser verify.
    } else {
      await fulfilGuestCheckout(checkoutId, ownerToken);
    }
  }
  const fresh = await getCheckoutById(checkoutId);
  const [booking] = fresh.bookingId
    ? await getDb().select().from(bookings).where(eq(bookings.id, fresh.bookingId)).limit(1) : [];
  return publicSnapshot(fresh, booking);
}

/**
 * Release hold then assign beds. Assign-while-held is rejected by DB triggers (0059).
 * On assign failure after capture → captured_unfulfilled (no double-charge).
 * `trustedServer` skips owner token (webhook / pay-at-property after verify).
 */
export async function fulfilGuestCheckout(checkoutId: string, ownerToken?: string, trustedServer = false) {
  cloudOnly();
  const row = trustedServer ? await getCheckoutById(checkoutId) : await requireOwner(checkoutId, ownerToken!);
  if (row.state === "fulfilled") {
    const [b] = row.bookingId ? await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1) : [];
    return publicSnapshot(row, b);
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
  try {
    for (const bedId of bedIds) {
      const bed = bedMeta.get(bedId);
      if (!bed) throw new GuestCheckoutError("Held bed is missing from inventory", 503);
      const ok = await assignBedToBooking({
        bookingId: row.bookingId, bedId, dormId: bed.dormId,
        checkinDate: holdRow.checkinDate, checkoutDate: holdRow.checkoutDate,
        assignedBy: "website", inventoryPool: "online",
      });
      if (!ok) throw new GuestCheckoutError("Could not assign a held bed", 503);
      assigned.push(bedId);
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
      details: `Native guest checkout ${checkoutId}`, performedBy: "website",
    });
    try { await pushIfOtaChanged(before, dormIds, nights); } catch { /* best-effort */ }
    const [confirmed] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
    if (confirmed) {
      await sendBookingConfirmationEmail({
        guestName: row.guestName, guestEmail: row.guestEmail,
        reference: confirmed.gokoBookingId || confirmed.bookingRef || String(confirmed.id),
        checkinDate: confirmed.checkinDate, checkoutDate: confirmed.checkoutDate || "",
        totalRupees: confirmed.amountTotal || 0, paidRupees: confirmed.amountPaid || 0,
      });
    }
  } catch (error) {
    if (assigned.length) await unassignBookingBeds(row.bookingId);
    const hasCapture = row.dueNowPaise >= 100 && (await getDb().select().from(payments)
      .where(and(eq(payments.checkoutId, checkoutId), eq(payments.captured, 1))).limit(1)).length > 0;
    if (hasCapture) {
      await getDb().update(checkouts).set({
        state: "captured_unfulfilled", closureReason: "cannot_fulfil", updatedAt: timestamp(),
      }).where(eq(checkouts.id, checkoutId));
      throw new GuestCheckoutError(
        "Payment was captured but beds could not be assigned. Goko will complete this booking manually — do not pay again.",
        503,
      );
    }
    throw error;
  }
  const fresh = await getCheckoutById(checkoutId);
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
  return publicSnapshot(fresh, booking);
}

export async function getGuestBookingStatus(reference: string, guestAccessToken: string) {
  cloudOnly();
  const { checkout, booking } = await requireGuestAccess(reference, guestAccessToken);
  return publicSnapshot(checkout, booking, {
    email: checkout.guestEmail.replace(/(^.).*(@.*$)/, "$1***$2"),
    canCancel: ["ready", "claimed", "fulfilled", "captured"].includes(checkout.state)
      && ["hold", "received"].includes(booking.status),
  });
}

export async function cancelGuestBooking(reference: string, guestAccessToken: string) {
  cloudOnly();
  const { checkout, booking } = await requireGuestAccess(reference, guestAccessToken);
  if (!["hold", "received"].includes(booking.status)) {
    throw new GuestCheckoutError("This booking can no longer be cancelled online");
  }
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  const capturedRows = await getDb().select().from(payments)
    .where(and(eq(payments.checkoutId, checkout.id), eq(payments.captured, 1)));
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

  if (checkout.holdId && booking.status === "hold") {
    await getDb().update(holds).set({ state: "released" })
      .where(and(eq(holds.id, checkout.holdId), eq(holds.state, "held")));
  } else if (booking.status === "received") {
    await unassignBookingBeds(booking.id);
  }
  await getDb().update(checkouts).set({
    state: "cancelled", closureReason: "guest_cancelled", updatedAt: timestamp(),
  }).where(eq(checkouts.id, checkout.id));
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
        const evidence = await createRazorpayBookingRefund(payment.id, calc.refundPaise, inserted[0].receipt, refundId);
        await recordBookingRefund(inserted[0], evidence);
      } catch {
        await getDb().update(refunds).set({ state: "unknown", updatedAt: timestamp() })
          .where(and(eq(refunds.paymentId, payment.id), eq(refunds.state, "submitting")));
      }
    }
  }
  const fresh = await getCheckoutById(checkout.id);
  const [b] = await getDb().select().from(bookings).where(eq(bookings.id, booking.id)).limit(1);
  return publicSnapshot(fresh, b, { refundPaise: calc.refundPaise });
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

/** Route native booking webhooks (notes.goko_checkout_id). */
export async function receiveNativeBookingWebhook(raw: Uint8Array, signature: string, eventId: string) {
  cloudOnly();
  z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).parse(eventId);
  const secrets = [process.env.RAZORPAY_TEST_WEBHOOK_SECRET, process.env.RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS]
    .filter((s): s is string => Boolean(s?.trim()));
  const live = [process.env.RAZORPAY_LIVE_WEBHOOK_SECRET, process.env.RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS].filter(Boolean);
  if (!secrets.length || secrets.some((s) => live.includes(s))) throw new RazorpayError("CONFIGURATION");
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
  if (process.env.RAZORPAY_TEST_ACCOUNT_ID && parsed.account_id !== process.env.RAZORPAY_TEST_ACCOUNT_ID) {
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
    if (!orderId && hook.paymentId) {
      const p = await fetchRazorpayBookingPayment(hook.paymentId);
      if (p.id !== hook.paymentId) throw new RazorpayError("MISMATCH");
      orderId = p.order_id;
    }
    let [row] = orderId
      ? await getDb().select().from(checkouts).where(eq(checkouts.razorpayOrderId, orderId)).limit(1) : [];
    if (!row && hook.checkoutId) row = await recoverOrder(await getCheckoutById(hook.checkoutId));
    if (!row || row.razorpayOrderId !== orderId) {
      throw new GuestCheckoutError("Unmatched booking webhook retained for reconciliation", 503);
    }
    if (hook.paymentId) {
      const evidence = await fetchRazorpayBookingPayment(hook.paymentId);
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
    }
    await getDb().update(hooks).set({ state: "processed", updatedAt: timestamp() }).where(eq(hooks.eventId, eventId));
    return { state: "processed" };
  } catch (error) {
    await getDb().update(hooks).set({ state: "retry", updatedAt: timestamp() })
      .where(and(eq(hooks.eventId, eventId), ne(hooks.state, "processed")));
    throw error;
  }
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
