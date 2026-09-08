import { NextRequest, NextResponse } from "next/server";
import { getChannelConfig, addBooking, updateBookingFull, getBookingByRef, unassignBookingBeds, addBookingHistoryEntry, getBookingDetail, checkBedAvailability, assignBedToBooking, getRoomTypeMappings, getAvailableBedsForRange } from "@/db/queries";
import { triggerInventoryPush } from "@/lib/aiosellSync";
import { parseReservationPayload, type ReservationPayload } from "@/lib/aiosell";
import { occupiedNights, exclusiveEndDate } from "@/lib/inventoryAvailability";
import { autoAssignOnlineChannelBeds, channelAssignmentNeedsReseat, channelBedNeeds, channelPersonCount } from "@/lib/channelAutoAssign";
import { logPmsCall } from "@/lib/pmsLog";
import { dispatchPush, notificationFirstName, notificationDate, notificationStayDates } from "@/lib/pushNotify";

const WEBHOOK_URL = "/api/aiosell/reservations";

type HandlerResult = { success: boolean; message: string };

function respondSuccess(message: string): HandlerResult {
  return { success: true, message };
}

function respondError(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  let body: unknown;

  const logPull = (opts: {
    status: "success" | "failed";
    httpStatus: number;
    errorMessage?: string;
    response?: unknown;
    /** Only pass after webhook auth succeeds — unauthenticated POSTs must not store bodies. */
    request?: unknown;
  }) =>
    logPmsCall({
      direction: "pull",
      type: "reservation",
      status: opts.status,
      request: opts.request,
      response: opts.response,
      errorMessage: opts.errorMessage,
      recordsAffected: opts.status === "success" ? 1 : 0,
      httpMethod: "POST",
      url: WEBHOOK_URL,
      httpStatus: opts.httpStatus,
      durationMs: Date.now() - started,
    }).catch(() => {});

  try {
    body = await req.json();
  } catch {
    await logPull({ status: "failed", httpStatus: 400, errorMessage: "Invalid JSON body" });
    return respondError("Invalid JSON body");
  }

  try {
    const config = await getChannelConfig();
    if (!config || !config.isActive) {
      await logPull({ status: "failed", httpStatus: 503, errorMessage: "Channel manager not active", response: { success: false, message: "Channel manager not active" } });
      return respondError("Channel manager not active", 503);
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("x-api-key") || "";
    if (!config.webhookSecret) {
      await logPull({ status: "failed", httpStatus: 503, errorMessage: "Webhook not configured", response: { success: false, message: "Webhook not configured" } });
      return respondError("Webhook not configured", 503);
    }
    let authValid = authHeader === config.webhookSecret || authHeader === `Bearer ${config.webhookSecret}`;
    if (!authValid && authHeader.startsWith("Basic ")) {
      try {
        const decoded = atob(authHeader.slice(6));
        authValid = decoded === config.webhookSecret || decoded.split(":").slice(1).join(":") === config.webhookSecret;
      } catch {}
    }
    if (!authValid) {
      await logPull({ status: "failed", httpStatus: 401, errorMessage: "Unauthorized", response: { success: false, message: "Unauthorized" } });
      return respondError("Unauthorized", 401);
    }

    const payload = parseReservationPayload(body);
    if (!payload) {
      await logPull({ status: "failed", httpStatus: 400, errorMessage: "Invalid reservation payload", response: { success: false, message: "Invalid reservation payload: missing action, hotelCode, or bookingId" }, request: body });
      return respondError("Invalid reservation payload: missing action, hotelCode, or bookingId");
    }

    if (payload.hotelCode !== config.hotelCode) {
      await logPull({ status: "failed", httpStatus: 400, errorMessage: "Invalid hotel code", response: { success: false, message: "Invalid hotel code" }, request: body });
      return respondError("Invalid hotel code");
    }

    try {
      let result: HandlerResult;
      switch (payload.action) {
        case "book":
          result = await handleNewBooking(payload);
          break;
        case "modify":
          result = await handleModifyBooking(payload);
          break;
        case "cancel":
          result = await handleCancelBooking(payload);
          break;
        default:
          await logPull({ status: "failed", httpStatus: 400, errorMessage: `Unknown action: ${payload.action}`, response: { success: false, message: `Unknown action: ${payload.action}` }, request: body });
          return respondError(`Unknown action: ${payload.action}`);
      }

      await logPull({ status: "success", httpStatus: 200, response: result, request: body });
      return NextResponse.json(result);
    } catch (processingError: any) {
      const message = processingError?.message || "Processing failed";
      console.error("Reservation webhook error:", message);
      await logPull({ status: "failed", httpStatus: 500, errorMessage: message, response: { success: false, message: "Internal error processing reservation" }, request: body });
      await dispatchPush({
        title: "Channel Booking Sync Failed",
        body: `${payload.action} · ${payload.bookingId} · Open Management logs`,
        url: "/admin?section=management",
        eventId: `channel-reservation-failure-${payload.action}-${payload.bookingId}`,
        tag: "channel-reservation-failure",
        category: "operations",
      });
      return respondError("Internal error processing reservation", 500);
    }
  } catch (error: any) {
    const message = error?.message || "Unknown";
    console.error("Reservation webhook error:", message);
    await logPull({ status: "failed", httpStatus: 500, errorMessage: message, response: { success: false, message: "Internal error processing reservation" } });
    return respondError("Internal error processing reservation", 500);
  }
}

function channelGuestName(
  guest: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback = "Unknown Guest",
): string {
  if (!guest) return fallback;
  const parts = [guest.firstName, guest.lastName]
    .filter((p): p is string => p != null && String(p).trim() !== "" && String(p).toLowerCase() !== "null")
    .map((p) => String(p).trim());
  return parts.join(" ") || fallback;
}

function channelNightlyRate(
  rooms: ReservationPayload["rooms"] | undefined,
  fallback = 0,
  amount?: ReservationPayload["amount"],
  checkin?: string,
  checkout?: string,
): number {
  const fromPrices = rooms?.reduce((sum, r) => sum + (r.prices?.[0]?.sellRate || 0), 0) ?? 0;
  if (fromPrices) return fromPrices;
  const nights = occupiedNights(checkin || "", checkout).length || 1;
  const total = amount?.amountAfterTax || 0;
  if (total) return Math.round(total / nights);
  return fallback;
}

function fetchedReservationRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.reservations)) return o.reservations;
  }
  return [];
}

/** Pull-ingest: create missing live refs only. Never rebook an existing Goko row. Never insert a cancel snapshot. */
export async function ingestFetchedReservations(raw: unknown): Promise<{ imported: number; skipped: number; refs: string[] }> {
  let imported = 0;
  let skipped = 0;
  const refs: string[] = [];
  const rows = fetchedReservationRows(raw);
  const hotelCode = rows.length ? (await getChannelConfig())?.hotelCode : undefined;
  for (const row of rows) {
    const payload = parseReservationPayload(row);
    if (!payload) {
      skipped++;
      continue;
    }
    if (hotelCode && payload.hotelCode !== hotelCode) {
      skipped++;
      continue;
    }
    const existing = await getBookingByRef(payload.bookingId);
    if (existing || payload.action === "cancel") {
      skipped++;
      continue;
    }
    await handleNewBooking(payload);
    imported++;
    refs.push(payload.bookingId);
  }
  return { imported, skipped, refs };
}

/** pah false → prepaid. Webhook has no paid-amount; amountPaid stays 0 until calendar check-in. */
function channelPaymentStatus(pah?: boolean): "pay_at_hotel" | "prepaid" | "unknown" {
  if (pah === true) return "pay_at_hotel";
  if (pah === false) return "prepaid";
  return "unknown";
}

function extractBookingFields(payload: ReservationPayload) {
  const guest = payload.guest;
  const guestName = channelGuestName(guest);
  const contact = guest?.phone || guest?.email || "";
  const roomInfo = payload.rooms?.map((r) => r.roomCode).join(", ") || "";

  return {
    guestName,
    contact,
    platform: payload.channel || "aiosell",
    bookingRef: payload.bookingId,
    checkinDate: payload.checkin || "",
    checkoutDate: payload.checkout || "",
    roomType: roomInfo,
    persons: channelPersonCount({ rooms: payload.rooms }),
    paymentStatus: channelPaymentStatus(payload.pah),
    specialRequests: payload.specialRequests || "",
    status: "received" as const,
    source: "channel_manager" as const,
    rawData: JSON.stringify(payload),
    amountBeforeTax: payload.amount?.amountBeforeTax || 0,
    amountTax: payload.amount?.tax || 0,
    amountTotal: payload.amount?.amountAfterTax || 0,
    // amountPaid omitted → addBooking defaults 0. Calendar checkIn copies prepaid total as online stay revenue.
    currency: payload.amount?.currency || "INR",
    email: guest?.email || "",
    cmBookingId: payload.cmBookingId || "",
    ratePlan: payload.rooms?.[0]?.rateplanCode || "",
    nightlyRate: channelNightlyRate(payload.rooms, 0, payload.amount, payload.checkin, payload.checkout),
  };
}

async function tryAutoAssignChannelBeds(
  bookingId: number,
  payload: ReservationPayload,
  checkin: string,
  checkout?: string | null,
  personsFallback?: number,
) {
  const co = exclusiveEndDate(checkin, checkout);
  if (!checkin || !co) {
    await addBookingHistoryEntry({
      bookingId,
      action: "Unassigned",
      details: "Invalid stay dates — staff must assign beds",
      performedBy: "channel_manager",
    });
    await dispatchPush({
      title: "Booking Needs Attention",
      body: `${notificationFirstName(channelGuestName(payload.guest))} · Invalid stay dates from channel`,
      url: "/admin?section=bookings",
      eventId: `booking-invalid-dates-${bookingId}`,
      category: "operations",
    });
    return;
  }
  const mappings = (await getRoomTypeMappings()) || [];
  const loadTagged = () => getAvailableBedsForRange(checkin, co, undefined, bookingId);
  const tagged = await loadTagged();
  const needs = channelBedNeeds({
    rooms: payload.rooms,
    roomType: payload.rooms?.map((r) => r.roomCode).join(", ") || "",
    persons: channelPersonCount({ rooms: payload.rooms, persons: personsFallback }),
  });
  const result = await autoAssignOnlineChannelBeds({
    bookingId,
    needs,
    mappings,
    tagged,
    assignBed: ({ bedId, dormId }) => assignBedToBooking({
      bookingId,
      bedId,
      dormId,
      checkinDate: checkin,
      checkoutDate: co,
      assignedBy: "channel_manager",
      inventoryPool: "online",
    }),
    unassignAll: async () => { await unassignBookingBeds(bookingId); },
    refreshTagged: loadTagged,
  });
  if (result.assigned > 0) {
    await addBookingHistoryEntry({
      bookingId,
      action: "Beds Auto-Assigned",
      details: `Online: ${result.labels.join(", ")}`,
      performedBy: "channel_manager",
    });
    return;
  }
  await addBookingHistoryEntry({
    bookingId,
    action: "Unassigned",
    details: `${result.reason || "No online beds in requested room type"}. Assign offline beds or reject.`,
    performedBy: "channel_manager",
  });
  await dispatchPush({
    title: "Booking Needs Bed Assignment",
    body: `${notificationFirstName(channelGuestName(payload.guest))} · ${payload.checkin || checkin} · ${result.reason || "No matching online bed"}`,
    url: "/admin?section=bookings",
    eventId: `booking-unassigned-${bookingId}`,
    category: "operations",
  });
}

async function handleNewBooking(payload: ReservationPayload) {
  const existing = await getBookingByRef(payload.bookingId);
  if (existing) {
    if (existing.status === "cancelled" || existing.status === "no_show") {
      await updateBookingFull(existing.id, {
        ...extractBookingFields(payload),
        status: "received",
        cancelledAt: "",
        cancelledBy: "",
      });
      await unassignBookingBeds(existing.id);
      await addBookingHistoryEntry({
        bookingId: existing.id,
        action: "Rebooked from Channel",
        details: `Cancelled/no-show ref reused via ${payload.channel || "aiosell"}`,
        performedBy: "channel_manager",
      });
      await tryAutoAssignChannelBeds(
        existing.id, payload, payload.checkin || existing.checkinDate, payload.checkout || existing.checkoutDate,
      );
      await dispatchPush({
        title: "Booking Rebooked",
        body: `${notificationFirstName(channelGuestName(payload.guest))} · ${payload.channel || "Channel"} · Check-in ${notificationDate(payload.checkin || existing.checkinDate)}`,
        url: "/admin?section=bookings",
        eventId: `booking-rebooked-${existing.id}-${payload.bookingId}`,
        category: "booking",
      });
      return respondSuccess("Reservation Created Successfully");
    }
    return respondSuccess("Reservation already exists (duplicate)");
  }

  const fields = extractBookingFields(payload);
  const bookingId = await addBooking(fields);

  if (bookingId) {
    await addBookingHistoryEntry({
      bookingId,
      action: "Received from Channel",
      details: `New booking via ${payload.channel || "aiosell"} (ref: ${payload.bookingId})`,
      performedBy: "channel_manager",
    });
    await tryAutoAssignChannelBeds(bookingId, payload, fields.checkinDate, fields.checkoutDate);
    await dispatchPush({
      title: "New Booking",
      body: `${notificationFirstName(fields.guestName)} · ${fields.platform} · ${notificationStayDates(fields.checkinDate, fields.checkoutDate)}`,
      url: "/admin?section=bookings",
      eventId: `booking-created-${bookingId}-${payload.bookingId}`,
      category: "booking",
    });
  }

  return respondSuccess("Reservation Created Successfully");
}

async function handleModifyBooking(payload: ReservationPayload) {
  const existing = await getBookingByRef(payload.bookingId);

  if (!existing) {
    return await handleNewBooking(payload);
  }

  const guest = payload.guest;
  const guestName = guest ? channelGuestName(guest, existing.guestName) : existing.guestName;
  const contact = guest?.phone || guest?.email || existing.contact;
  const roomInfo = payload.rooms?.map((r) => r.roomCode).join(", ") || existing.roomType;
  const persons = channelPersonCount({ rooms: payload.rooms, persons: existing.persons });
  const ratePlan = payload.rooms?.[0]?.rateplanCode || existing.ratePlan || "";
  const nightlyRate = channelNightlyRate(
    payload.rooms,
    existing.nightlyRate || 0,
    payload.amount,
    payload.checkin || existing.checkinDate || undefined,
    payload.checkout || existing.checkoutDate || undefined,
  );

  const closed = existing.status === "checked_out" || existing.status === "no_show" || existing.status === "cancelled";
  const newCheckin = payload.checkin || existing.checkinDate;
  const newCheckout = exclusiveEndDate(newCheckin, payload.checkout || existing.checkoutDate);
  let moveDates = !closed && !!newCheckin && !!newCheckout;
  if (moveDates && newCheckin && newCheckout) {
    const aligned = await realignAssignments(existing.id, newCheckin, newCheckout);
    if (!aligned) moveDates = false;
  }

  await updateBookingFull(existing.id, {
    guestName,
    contact: contact || "",
    platform: payload.channel || existing.platform,
    ...(moveDates ? {
      checkinDate: newCheckin,
      checkoutDate: payload.checkout || existing.checkoutDate || "",
    } : {}),
    roomType: roomInfo || "",
    persons,
    paymentStatus: payload.pah !== undefined ? channelPaymentStatus(payload.pah) : (existing.paymentStatus || "unknown"),
    specialRequests: payload.specialRequests || existing.specialRequests || "",
    status: existing.status,
    rawData: JSON.stringify(payload),
    amountBeforeTax: payload.amount?.amountBeforeTax ?? existing.amountBeforeTax ?? 0,
    amountTax: payload.amount?.tax ?? existing.amountTax ?? 0,
    amountTotal: payload.amount?.amountAfterTax ?? existing.amountTotal ?? 0,
    currency: payload.amount?.currency || existing.currency || "INR",
    email: guest?.email || existing.email || "",
    cmBookingId: payload.cmBookingId || existing.cmBookingId || "",
    ratePlan,
    nightlyRate,
  });

  await addBookingHistoryEntry({
    bookingId: existing.id,
    action: "Modified from Channel",
    details: `Booking modified via ${payload.channel || "aiosell"}`,
    performedBy: "channel_manager",
  });

  if (!closed) {
    const after = await getBookingDetail(existing.id);
    const assignedNow = (after?.assignments || []).filter((a) => a.status === "assigned");
    const needs = channelBedNeeds({
      rooms: payload.rooms,
      roomType: roomInfo,
      persons,
      rawData: JSON.stringify(payload),
    });
    const previousNeedCount = channelBedNeeds({
      roomType: existing.roomType,
      persons: existing.persons,
      rawData: existing.rawData,
    }).reduce((sum, n) => sum + n.count, 0);
    if (channelAssignmentNeedsReseat({
      assignedCount: assignedNow.length,
      needs,
      previousNeedCount,
      previousRoomType: existing.roomType,
      nextRoomType: roomInfo,
    })) {
      if (assignedNow.length > 0) await unassignBookingBeds(existing.id);
      const assignCheckin = moveDates ? newCheckin : existing.checkinDate;
      const assignCheckout = moveDates
        ? (payload.checkout || existing.checkoutDate)
        : existing.checkoutDate;
      await tryAutoAssignChannelBeds(existing.id, payload, assignCheckin, assignCheckout, persons);
    }
  }

  await dispatchPush({
    title: "Booking Modified",
    body: `${notificationFirstName(guestName)} · ${payload.channel || "Channel"} · ${notificationStayDates(newCheckin, newCheckout || existing.checkoutDate)}`,
    url: "/admin?section=bookings",
    eventId: `booking-modified-${existing.id}-${Date.now()}`,
    category: "booking",
  });

  return respondSuccess("Reservation Modified Successfully");
}

async function handleCancelBooking(payload: ReservationPayload) {
  const existing = await getBookingByRef(payload.bookingId);

  if (!existing) {
    return respondSuccess("Reservation not found (may already be cancelled)");
  }

  if (existing.status === "cancelled") {
    return respondSuccess("Reservation already cancelled");
  }
  if (existing.status === "checked_out" || existing.status === "no_show") {
    return respondSuccess("Reservation already closed");
  }

  const now = new Date().toISOString();

  const detail = await getBookingDetail(existing.id);
  const assigned = (detail?.assignments || []).filter((a) => a.status === "assigned");
  const fromAssignments = assigned.flatMap((a) => occupiedNights(a.checkinDate, a.checkoutDate));
  const fromBooking = occupiedNights(existing.checkinDate, existing.checkoutDate);
  const affectedDates = [...new Set(fromAssignments.length ? fromAssignments : fromBooking)];

  await updateBookingFull(existing.id, {
    status: "cancelled",
    cancelledAt: now,
    cancelledBy: "channel_manager",
  });
  await unassignBookingBeds(existing.id);
  await addBookingHistoryEntry({
    bookingId: existing.id,
    action: "Cancelled from Channel",
    details: `Cancelled via ${payload.channel || "aiosell"}`,
    performedBy: "channel_manager",
  });
  if (affectedDates.length > 0) {
    await triggerInventoryPush(affectedDates).catch(async () => {
      await dispatchPush({
        title: "Inventory Sync Failed",
        body: "Channel cancellation saved, but availability push failed",
        url: "/admin?section=management",
        eventId: `inventory-channel-cancel-${existing.id}`,
        tag: "inventory-sync-failure",
        category: "operations",
      });
    });
  }
  await dispatchPush({
    title: "Booking Cancelled",
    body: `${notificationFirstName(existing.guestName)} · ${payload.channel || existing.platform || "Channel"} · ${notificationStayDates(existing.checkinDate, existing.checkoutDate)}`,
    url: "/admin?section=bookings",
    eventId: `booking-cancelled-${existing.id}-${payload.bookingId}`,
    category: "booking",
  });

  return respondSuccess("Reservation Cancelled Successfully");
}

async function realignAssignments(bookingId: number, newCheckin: string, newCheckout: string): Promise<boolean> {
  const detail = await getBookingDetail(bookingId);
  const status = detail?.booking?.status;
  if (status === "checked_out" || status === "no_show" || status === "cancelled") return false;
  const assigned = (detail?.assignments || []).filter((a) => a.status === "assigned");
  if (assigned.length === 0) return true;
  const same = assigned.every((a) => a.checkinDate === newCheckin && a.checkoutDate === newCheckout);
  if (same) return true;

  for (const a of assigned) {
    if (!(await checkBedAvailability(a.bedId, newCheckin, newCheckout, bookingId))) {
      await unassignBookingBeds(bookingId);
      return true;
    }
  }
  await unassignBookingBeds(bookingId);
  for (const a of assigned) {
    const ok = await assignBedToBooking({
      bookingId,
      bedId: a.bedId,
      dormId: a.dormId,
      checkinDate: newCheckin,
      checkoutDate: newCheckout,
      assignedBy: "channel_manager",
      inventoryPool: a.inventoryPool === "offline" || a.inventoryPool === "block" ? a.inventoryPool : "online",
    });
    if (!ok) {
      await unassignBookingBeds(bookingId);
      return true;
    }
  }
  return true;
}
