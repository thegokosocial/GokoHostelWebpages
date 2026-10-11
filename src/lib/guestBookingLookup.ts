import { z } from "zod";
import { and, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings } from "@/db/schema";

export const lookupSchema = z.object({
  reference: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  lastName: z.string().trim().min(1).max(120),
}).strict();

const LOOKUP_MISS = "We couldn't find a matching booking. Check your confirmation number and last name, or contact Goko for help.";

function normalizeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function hasMatchingLastName(guestName: string, lastName: string) {
  const stored = normalizeName(guestName);
  if (!stored || stored === "unknown guest") return false;
  return stored.split(" ").at(-1) === normalizeName(lastName);
}

/** Low-trust, read-only booking confirmation lookup. */
export async function guestBookingLookup(input: unknown) {
  const data = lookupSchema.parse(input);
  const reference = data.reference.toUpperCase();
  const rows = await getDb().select({
    gokoBookingId: bookings.gokoBookingId,
    bookingRef: bookings.bookingRef,
    cmBookingId: bookings.cmBookingId,
    guestName: bookings.guestName,
    checkinDate: bookings.checkinDate,
    checkoutDate: bookings.checkoutDate,
    roomType: bookings.roomType,
  }).from(bookings).where(and(
    sql`${bookings.deletedAt} IS NULL`,
    or(
      sql`upper(${bookings.gokoBookingId}) = ${reference}`,
      sql`upper(${bookings.bookingRef}) = ${reference}`,
      sql`upper(${bookings.cmBookingId}) = ${reference}`,
    ),
  )).limit(2);

  if (rows.length !== 1 || !hasMatchingLastName(rows[0].guestName, data.lastName)) return { message: LOOKUP_MISS };
  const booking = rows[0];
  return { booking: {
    reference: booking.gokoBookingId || booking.bookingRef || booking.cmBookingId || data.reference,
    checkinDate: booking.checkinDate,
    checkoutDate: booking.checkoutDate || "",
    roomType: booking.roomType || "",
  } };
}
