import { getBookingDetail, getChannelConfig, getReleasedBookingsEligibleForAutoNoShow, getRoomTypeMappings, transitionBookingStatus, unassignBookingBeds, updateBookingFull, addBookingHistoryEntry } from "@/db/queries";
import { pushNoShow } from "@/lib/aiosell";
import { otaFingerprint, pushIfOtaChanged } from "@/lib/aiosellSync";
import { roomCodesFromChannelBooking, requestedDormsForCodes } from "@/lib/channelAutoAssign";
import { occupiedNights } from "@/lib/inventoryAvailability";
import { dispatchPush, notificationDate, notificationFirstName } from "@/lib/pushNotify";
import { todayIST } from "@/lib/utils";

function isBookingDotCom(platform?: string | null) {
  return (platform || "").toLowerCase().replace(/[._\s-]/g, "") === "bookingcom";
}

async function syncNoShow(bookingId: number, booking: { platform?: string | null; bookingRef?: string | null; cmBookingId?: string | null }) {
  const attemptedAt = new Date().toISOString();
  const ids = [booking.bookingRef, booking.cmBookingId].filter((id, index, values): id is string => Boolean(id) && values.indexOf(id) === index);
  if (!isBookingDotCom(booking.platform) || !ids.length) {
    await updateBookingFull(bookingId, { noShowPmsStatus: "not_required", noShowPmsError: "", noShowPmsAttemptedAt: attemptedAt });
    return;
  }
  try {
    const config = await getChannelConfig();
    if (!config?.isActive) throw new Error("Aiosell channel manager is not active");
    let result: { success: boolean; message?: string } | undefined;
    for (const [index, id] of ids.entries()) {
      result = await pushNoShow({ hotelCode: config.hotelCode, pmsId: config.pmsId, apiBaseUrl: config.apiBaseUrl, apiUsername: config.apiUsername, apiPassword: config.apiPassword }, id);
      if (result.success || index === ids.length - 1) break;
    }
    if (!result?.success) throw new Error(result?.message || "Aiosell rejected the no-show update");
    await updateBookingFull(bookingId, { noShowPmsStatus: "sent", noShowPmsError: "", noShowPmsAttemptedAt: attemptedAt });
  } catch (error: any) {
    await updateBookingFull(bookingId, { noShowPmsStatus: "failed", noShowPmsError: error?.message || "Aiosell no-show update failed", noShowPmsAttemptedAt: attemptedAt });
  }
}

export async function runAutomaticNoShows(today = todayIST()) {
  const candidates = await getReleasedBookingsEligibleForAutoNoShow(today);
  let marked = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if (!isBookingDotCom(candidate.platform)) { skipped++; continue; }
    const detail = await getBookingDetail(candidate.id);
    if (!detail || detail.booking.status !== "guest_declined" || detail.booking.checkinDate >= today) { skipped++; continue; }

    const dates = occupiedNights(detail.booking.checkinDate, detail.booking.checkoutDate);
    let dormIds = detail.assignments.filter((assignment) => assignment.status === "assigned").map((assignment) => assignment.dormId);
    if (!dormIds.length) {
      const mappings = await getRoomTypeMappings();
      dormIds = requestedDormsForCodes(roomCodesFromChannelBooking(null, detail.booking.roomType, detail.booking.rawData), mappings || []).dormIds;
    }
    const before = await otaFingerprint(dormIds, dates);
    const claimed = await transitionBookingStatus(candidate.id, ["guest_declined"], { status: "no_show" });
    if (!claimed) { skipped++; continue; }

    await unassignBookingBeds(candidate.id);
    await syncNoShow(candidate.id, detail.booking);
    await addBookingHistoryEntry({
      bookingId: candidate.id,
      action: "Auto-marked No-Show",
      details: `Automatically marked no-show on ${today} after the released check-in date`,
      performedBy: "system",
    });
    await dispatchPush({
      notificationType: "booking.no_show",
      title: "Booking Auto-marked No-show",
      body: `${notificationFirstName(detail.booking.guestName)} · Check-in ${notificationDate(detail.booking.checkinDate)}`,
      url: "/admin?section=bookings",
      eventId: `booking-auto-no-show-${candidate.id}`,
    });
    const inventory = await pushIfOtaChanged(before, dormIds, dates).catch((error) => ({ accepted: false, message: error?.message || "Aiosell inventory push failed" }));
    if (inventory && !inventory.accepted) await dispatchPush({
      notificationType: "operations.inventory_sync_failed",
      title: "Inventory Sync Failed",
      body: "Auto-marked no-show saved, but channel availability needs attention",
      url: "/admin?section=management",
      eventId: `inventory-auto-no-show-${candidate.id}`,
      tag: "inventory-sync-failure",
    });
    marked++;
  }
  return { scanned: candidates.length, marked, skipped };
}
