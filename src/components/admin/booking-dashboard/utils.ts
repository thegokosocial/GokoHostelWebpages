import { addCalendarDays, exclusiveEndDate, stayNightCount } from "@/lib/inventoryAvailability";
import { bookingTotals, DEFAULT_BOOKING_TAX_PERCENT } from "@/lib/bookingPricing";
import type { DateRange } from "./types";

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  received: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700" },
  checked_in: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", border: "border-green-300 dark:border-green-700" },
  checked_out: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", border: "border-purple-300 dark:border-purple-700" },
  hold: { bg: "bg-pink-100 dark:bg-pink-900/30", text: "text-pink-700 dark:text-pink-300", border: "border-pink-300 dark:border-pink-700" },
  guest_declined: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-300 dark:border-amber-700" },
  no_show: { bg: "bg-gray-100 dark:bg-gray-800/50", text: "text-gray-600 dark:text-gray-400", border: "border-gray-300 dark:border-gray-600" },
  cancelled: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", border: "border-red-300 dark:border-red-700" },
  modified: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-300", border: "border-yellow-300 dark:border-yellow-700" },
};

export const PLATFORM_LOGOS: Record<string, { label: string; abbr: string; color: string }> = {
  booking_com: { label: "Booking.com", abbr: "B", color: "bg-blue-600" },
  makemytrip: { label: "MakeMyTrip", abbr: "M", color: "bg-red-500" },
  goibibo: { label: "Goibibo", abbr: "G", color: "bg-orange-500" },
  hostelworld: { label: "Hostelworld", abbr: "H", color: "bg-orange-600" },
  booking_engine: { label: "Website", abbr: "W", color: "bg-green-600" },
  walkin: { label: "Walk-in", abbr: "WI", color: "bg-gray-500" },
  direct: { label: "Direct", abbr: "D", color: "bg-teal-500" },
  channel_manager: { label: "Channel Manager", abbr: "CM", color: "bg-indigo-500" },
  aiosell: { label: "Aiosell", abbr: "A", color: "bg-indigo-500" },
};

export function platformLogo(platform?: string | null) {
  const raw = (platform || "").trim();
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/[.\s-]+/g, "_");
  return PLATFORM_LOGOS[key];
}

export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  checked_in: "Checked In",
  checked_out: "Checked Out",
  hold: "On Hold",
  guest_declined: "Guest Declined",
  no_show: "No Show",
  cancelled: "Cancelled",
  modified: "Modified",
};

/** Channel pah true → collect at hotel; pah false → prepaid. Desk collect becomes paid. Prepaid is not due even when ledger balance > 0. Remaining due after a price-up still shows Collect remaining. */
export function collectionCopy(status?: string | null, balance = 0): { label: string; value: string; due: boolean } | null {
  const s = (status || "").toLowerCase();
  const collect = s === "pay_at_hotel" || s === "pay_at_property";
  const prepaid = s === "prepaid";
  const paid = s === "paid";
  if (prepaid) {
    return { label: "Payment done", value: "Prepaid", due: false };
  }
  if (paid && balance > 0) {
    return { label: "Collect remaining", value: formatCurrency(balance), due: true };
  }
  if (collect && balance > 0) {
    return { label: "Collect payment", value: formatCurrency(balance), due: true };
  }
  if (paid || (collect && balance <= 0)) {
    return { label: "Payment done", value: "Collected", due: false };
  }
  return null;
}

/**
 * Display-only Paid/Balance for the booking-detail Payment card.
 * The card lies in Sunny’s favor; the ledger does not.
 *
 * Prepaid: Paid = amountTotal, Balance = 0. Aiosell webhook `pah: false` sets
 * paymentStatus prepaid and totals from `amount`, with no paid-amount field.
 * addBooking still stores amountPaid = 0. Calendar check-in of prepaid copies
 * amountPaid = amountTotal as online (paymentStatus stays prepaid) so Room Revenue
 * and cancel-refund see it. Do not copy OTA total onto amountPaid at ingest.
 * Calendar JSON `balance` stays amountTotal − amountPaid.
 *
 * Hotel-collect / paid / unknown: Paid = amountPaid, Balance = amountTotal − amountPaid.
 *
 * collectionCopy still drives the green Payment done / Prepaid line and whether
 * Balance is painted red (“due at hotel”). Check-in skips Collected for prepaid
 * and records the OTA total as online stay revenue. Desk collect sets amountPaid = total and status paid.
 *
 * Edge: editReservation can put a real amountPaid on a stay that is still prepaid;
 * this helper would still show Paid = total / Balance = 0 and hide the ledger.
 * prepaidCheckInWrite no-ops when amountPaid > 0.
 */
export function displayedStayPayment(
  status?: string | null,
  amountTotal = 0,
  amountPaid = 0,
): { paid: number; balance: number } {
  if ((status || "").toLowerCase() === "prepaid") {
    return { paid: amountTotal, balance: 0 };
  }
  return { paid: amountPaid, balance: amountTotal - amountPaid };
}

export function getHostelToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function getDateRange(mode: "week" | "10days" | "30days"): { start: string; end: string } {
  const today = new Date(getHostelToday() + "T12:00:00Z");
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const start = yesterday.toISOString().split("T")[0];

  let days = 7;
  if (mode === "10days") days = 10;
  if (mode === "30days") days = 30;

  const endDate = new Date(yesterday);
  endDate.setUTCDate(endDate.getUTCDate() + days - 1);

  return { start, end: endDate.toISOString().split("T")[0] };
}

export function getDatesArray(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function getNights(checkin: string, checkout?: string | null): number {
  if (!checkin) return 1;
  return Math.max(1, stayNightCount(checkin, checkout));
}

export function calculateTax(amount: number, taxPercent: number = DEFAULT_BOOKING_TAX_PERCENT): { beforeTax: number; tax: number; total: number } {
  const t = bookingTotals(amount, { taxPercent });
  return { beforeTax: t.beforeTax, tax: t.tax, total: t.total };
}

export function formatCurrency(amount: number): string {
  return `\u20B9${amount.toLocaleString("en-IN")}`;
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDate();
  const mon = d.toLocaleDateString("en", { month: "short", timeZone: "UTC" });
  const wd = d.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${day} ${mon}`;
}

export function formatDateCompact(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCDate()} ${d.toLocaleDateString("en", { month: "short", timeZone: "UTC" })}`;
}

export function isToday(dateStr: string): boolean {
  return dateStr === getHostelToday();
}

export function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

/** Stay nights [checkin, checkout) overlap the inclusive calendar window [start, end]. */
export function stayOverlapsVisible(
  checkin: string,
  checkout: string | null | undefined,
  start: string,
  end: string,
): boolean {
  if (!checkin || !start || !end) return false;
  const co = exclusiveEndDate(checkin, checkout);
  if (!co) return false;
  return checkin <= end && co > start;
}

/**
 * Keep the current window if the stay already paints on it.
 * Otherwise shift to the same length, starting at check-in (custom mode).
 */
export function rangeCoveringStay(
  checkin: string,
  checkout: string | null | undefined,
  current: DateRange,
): DateRange {
  if (stayOverlapsVisible(checkin, checkout, current.startDate, current.endDate)) return current;
  const span = Math.max(getDatesArray(current.startDate, current.endDate).length, 10);
  return {
    startDate: checkin,
    endDate: addCalendarDays(checkin, span - 1),
    mode: "custom",
  };
}

export type CalendarTile = {
  bookingId: number;
  startCol: number;
  spanCols: number;
  isMultiBed: boolean;
};

/** Place an assigned stay on the inclusive date columns. Exclusive checkout. */
export function computeTilePlacements(
  bedId: number,
  assignments: { bedId: number; bookingId: number; checkinDate: string; checkoutDate: string; status: string }[],
  dates: string[],
  bookingIds: Set<number>,
  multiBedBookings: Set<number>,
): CalendarTile[] {
  if (dates.length === 0) return [];
  const placements: CalendarTile[] = [];
  const bedAssigns = assignments.filter((a) => a.bedId === bedId && a.status === "assigned");

  for (const assign of bedAssigns) {
    if (!bookingIds.has(assign.bookingId)) continue;

    let startIdx = dates.indexOf(assign.checkinDate);
    if (startIdx < 0) {
      if (assign.checkinDate < dates[0]) startIdx = 0;
      else continue;
    }

    let endIdx = dates.indexOf(assign.checkoutDate);
    if (endIdx < 0) {
      if (assign.checkoutDate > dates[dates.length - 1]) endIdx = dates.length;
      else continue;
    }
    if (endIdx <= startIdx) continue;

    placements.push({
      bookingId: assign.bookingId,
      startCol: startIdx,
      spanCols: endIdx - startIdx,
      isMultiBed: multiBedBookings.has(assign.bookingId),
    });
  }

  return placements;
}
