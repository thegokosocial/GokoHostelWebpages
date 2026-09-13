import { addCalendarDays } from "@/lib/inventoryAvailability";

export type ResolutionCheckin = {
  bookingPlatform?: string | null; status?: string | null; bookingResolution?: string | null;
  bookingId?: string | null; arrivalDate: string; stayingDays?: string | null; contact?: string | null; name?: string | null;
};

export type ResolutionBooking = {
  id: number; bookingRef?: string | null; gokoBookingId?: string | null; cmBookingId?: string | null;
  status: string; checkinDate: string; checkoutDate?: string | null; contact?: string | null; guestName: string;
  platform?: string | null;
};

export function isWalkinBookingCheckin(checkin: ResolutionCheckin) {
  return checkin.status === "active" && (checkin.bookingPlatform === "Walk-in" || checkin.bookingPlatform === "Offline booking");
}

export function bookingReference(booking: Pick<ResolutionBooking, "bookingRef" | "gokoBookingId" | "cmBookingId">) {
  return [booking.bookingRef, booking.gokoBookingId, booking.cmBookingId].find((value) => String(value || "").trim())?.trim() || "";
}

function normalizedPhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizedName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function datesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return Boolean(startA && endA && startB && endB && startA < endB && endA > startB);
}

export function getCheckinBookingMatch(checkin: ResolutionCheckin, allBookings: ResolutionBooking[]) {
  const checkout = addCalendarDays(checkin.arrivalDate, Math.max(1, Number(checkin.stayingDays) || 1));
  const candidates = allBookings.filter((booking) =>
    !["cancelled", "no_show"].includes(booking.status) &&
    datesOverlap(booking.checkinDate, booking.checkoutDate || addCalendarDays(booking.checkinDate, 1), checkin.arrivalDate, checkout)
  );
  const reference = String(checkin.bookingId || "").trim();
  const direct = reference ? candidates.find((booking) => bookingReference(booking) === reference) : undefined;
  if (direct) return { booking: direct, method: "reference" as const };
  const phone = normalizedPhone(checkin.contact);
  const phoneMatches = phone ? candidates.filter((booking) => normalizedPhone(booking.contact) === phone) : [];
  if (phoneMatches.length === 1) return { booking: phoneMatches[0], method: "phone" as const };
  const name = normalizedName(checkin.name);
  const nameMatches = name ? candidates.filter((booking) => normalizedName(booking.guestName) === name) : [];
  if (nameMatches.length === 1) return { booking: nameMatches[0], method: "name" as const };
  return null;
}
