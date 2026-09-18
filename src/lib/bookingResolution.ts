import { addCalendarDays } from "@/lib/inventoryAvailability";

export type ResolutionCheckin = {
  bookingPlatform?: string | null; status?: string | null; bookingResolution?: string | null;
  bookingId?: string | null; bookingLinkedRef?: string | null; arrivalDate: string; stayingDays?: string | null; contact?: string | null; name?: string | null;
};

export type ResolutionBooking = {
  id: number; bookingRef?: string | null; gokoBookingId?: string | null; cmBookingId?: string | null;
  status: string; checkinDate: string; checkoutDate?: string | null; contact?: string | null; guestName: string;
  platform?: string | null; source?: string | null;
};

export function isWalkinBookingCheckin(checkin: ResolutionCheckin) {
  return checkin.status === "active" && (checkin.bookingPlatform === "Walk-in" || checkin.bookingPlatform === "Offline booking");
}

/** Manual desk walk-in/offline booking (Records or calendar New Booking). Never OTA/channel/website. */
export function isManualWalkinBooking(booking: Pick<ResolutionBooking, "source" | "platform">) {
  const source = String(booking.source || "").toLowerCase();
  const platform = String(booking.platform || "").toLowerCase().replace(/[._\s-]/g, "");
  return source === "manual" && (platform === "walkin" || platform === "offline" || platform === "offlinebooking");
}

export function bookingReference(booking: Pick<ResolutionBooking, "bookingRef" | "gokoBookingId" | "cmBookingId">) {
  return [booking.bookingRef, booking.gokoBookingId, booking.cmBookingId].find((value) => String(value || "").trim())?.trim() || "";
}

/** Check-in created from Records walk-in flow stores a generated GOKO id in bookingId; createBooking copies it to bookingRef. */
export function checkinLinksBooking(
  checkin: Pick<ResolutionCheckin, "bookingId" | "bookingLinkedRef">,
  booking: Pick<ResolutionBooking, "bookingRef" | "gokoBookingId" | "cmBookingId">,
) {
  const refs = new Set(
    [booking.bookingRef, booking.gokoBookingId, booking.cmBookingId]
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  );
  if (refs.size === 0) return false;
  const checkinRef = String(checkin.bookingId || "").trim();
  const linked = String(checkin.bookingLinkedRef || "").trim();
  return (checkinRef !== "" && refs.has(checkinRef)) || (linked !== "" && refs.has(linked));
}

/** Eligible for hard-delete: manual walk-in/offline AND tied to a Records walk-in/offline check-in. */
export function isRecordsLinkedWalkinBooking(
  booking: Pick<ResolutionBooking, "source" | "platform" | "bookingRef" | "gokoBookingId" | "cmBookingId">,
  checkins: Array<Pick<ResolutionCheckin, "bookingPlatform" | "status" | "bookingId" | "bookingLinkedRef" | "arrivalDate">>,
) {
  if (!isManualWalkinBooking(booking)) return false;
  return checkins.some((c) =>
    (c.bookingPlatform === "Walk-in" || c.bookingPlatform === "Offline booking")
    && checkinLinksBooking(c, booking),
  );
}

export function resolutionNeedsReopen(resolution?: string | null) {
  return resolution === "created" || resolution === "linked";
}

/** Live booking still satisfies this check-in's created/linked resolution. */
export function liveBookingCoversResolution(
  checkin: Pick<ResolutionCheckin, "bookingId" | "bookingLinkedRef" | "bookingResolution">,
  bookings: ResolutionBooking[],
) {
  if (!resolutionNeedsReopen(checkin.bookingResolution)) return false;
  return bookings.some(
    (b) => !["cancelled", "no_show"].includes(b.status) && checkinLinksBooking(checkin, b),
  );
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
