import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, guestBookingLookupChallenges as challenges, nativeBookingCheckouts } from "@/db/schema";
import { getSetting } from "@/db/queries";
import { sendBookingLookupCode } from "@/lib/email";
import { generateGuestAccessToken, hashToken } from "@/lib/bookingReference";
import { readWebsiteBookingSettings, WEBSITE_BOOKING_SETTINGS_KEY } from "@/lib/websiteBookingSettings";

export const lookupSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), reference: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/), email: z.string().trim().email().max(254) }).strict(),
  z.object({ action: z.literal("verify"), challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict(),
]);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
export function equalLookupHashes(a: string, b: string) {
  if (a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export class LookupCodeError extends Error {}

const LOOKUP_GENERIC = "If these details match a booking, a verification code has been sent to its email address. Codes expire after 10 minutes.";
const LOOKUP_DIRECT_MISS = "If these details match a booking, it will appear here. Check the confirmation number and email, or contact Goko.";

type BookingBlob = {
  reference: string | null; externalReference: string | null; guestName: string;
  checkinDate: string; checkoutDate: string; roomType: string; guests: number;
  status: string; paymentStatus: string | null; total: number | null; paid: number | null; refunded: number | null;
};

async function loadBookingBlob(bookingId: number): Promise<BookingBlob | null> {
  const db = getDb();
  const [row] = await db.select({
    reference: bookings.gokoBookingId, externalReference: bookings.bookingRef, guestName: bookings.guestName,
    checkinDate: bookings.checkinDate, checkoutDate: bookings.checkoutDate, roomType: bookings.roomType, guests: bookings.persons,
    status: bookings.status, paymentStatus: bookings.paymentStatus, total: bookings.amountTotal, paid: bookings.amountPaid, refunded: bookings.amountRefunded,
  }).from(bookings).where(and(eq(bookings.id, bookingId), sql`${bookings.deletedAt} IS NULL`)).limit(1);
  if (!row) return null;
  return {
    ...row,
    checkoutDate: row.checkoutDate || "",
    roomType: row.roomType || "",
    guests: row.guests ?? 0,
    refunded: row.refunded ?? null,
  };
}

async function withManageToken(bookingId: number, booking: BookingBlob) {
  try {
    const db = getDb();
    const [checkout] = await db.select({ id: nativeBookingCheckouts.id })
      .from(nativeBookingCheckouts).where(eq(nativeBookingCheckouts.bookingId, bookingId)).limit(1);
    if (checkout) {
      const guestAccessToken = generateGuestAccessToken();
      const now = new Date().toISOString();
      await db.update(nativeBookingCheckouts).set({
        guestAccessHash: await hashToken(guestAccessToken),
        updatedAt: now,
      }).where(eq(nativeBookingCheckouts.id, checkout.id));
      const manageRef = booking.reference || booking.externalReference || "";
      return {
        booking,
        guestAccessToken,
        currency: "INR" as const,
        manageUrl: manageRef ? `/booking/${encodeURIComponent(manageRef)}` : "/book",
      };
    }
  } catch {
    // Checkout ledger absent (pre-0062) — fall through to booking-only response.
  }
  return { booking, currency: "INR" as const };
}

export async function guestBookingLookup(input: unknown) {
  const data = lookupSchema.parse(input);
  const secret = process.env.GUEST_BOOKING_LOOKUP_SECRET;
  if (!secret || secret.length < 32) throw new Error("Lookup configuration missing");
  const db = getDb();
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  const requireOtp = settings.requireLookupOtp;

  // Challenge table required when OTP is on; still probe when off so misconfig fails closed for verify.
  await db.select().from(challenges).limit(0);
  const live = sql`${challenges.expiresAt} > CAST(strftime('%s','now') AS INTEGER)`;

  if (data.action === "request") {
    const email = data.email.toLowerCase(), reference = data.reference.toUpperCase();
    const matches = await db.select({ id: bookings.id, email: bookings.email }).from(bookings)
      .where(sql`lower(${bookings.email}) = ${email} AND (${sql`upper(${bookings.gokoBookingId}) = ${reference}`} OR ${sql`upper(${bookings.bookingRef}) = ${reference}`}) AND ${bookings.deletedAt} IS NULL`).limit(2);

    if (!requireOtp) {
      if (matches.length !== 1) {
        return { requireLookupOtp: false as const, message: LOOKUP_DIRECT_MISS };
      }
      const booking = await loadBookingBlob(matches[0].id);
      if (!booking) return { requireLookupOtp: false as const, message: LOOKUP_DIRECT_MISS };
      return { requireLookupOtp: false as const, ...(await withManageToken(matches[0].id, booking)) };
    }

    const challengeId = crypto.randomUUID();
    if (matches.length === 1) {
      const requestKey = await hash(`${matches[0].id}:${email}:${secret}`);
      const random = new Uint32Array(1);
      do { crypto.getRandomValues(random); } while (random[0] >= 4294000000);
      const code = String(random[0] % 1000000).padStart(6, "0");
      const claimed = await db.insert(challenges).values({ id: challengeId, requestKey, bookingId: matches[0].id,
        codeHash: await hash(`${challengeId}:${code}:${secret}`), expiresAt: sql`CAST(strftime('%s','now') AS INTEGER) + 600`, attempts: 0, used: 0 })
        .onConflictDoUpdate({ target: challenges.requestKey, set: { id: challengeId, codeHash: await hash(`${challengeId}:${code}:${secret}`), expiresAt: sql`CAST(strftime('%s','now') AS INTEGER) + 600`, attempts: 0, used: 0 }, setWhere: sql`${challenges.expiresAt} <= CAST(strftime('%s','now') AS INTEGER)` }).returning();
      if (claimed.length) {
        try { await sendBookingLookupCode(matches[0].email!, code); } catch { console.warn("Guest booking verification delivery unavailable; request remains throttled"); }
      }
    }
    return { requireLookupOtp: true as const, challengeId, message: LOOKUP_GENERIC };
  }

  if (!requireOtp) {
    throw new LookupCodeError("Email verification is disabled; submit confirmation number and email again");
  }

  const [attempt] = await db.update(challenges).set({ attempts: sql`${challenges.attempts} + 1` })
    .where(and(eq(challenges.id, data.challengeId), eq(challenges.used, 0), sql`${challenges.attempts} < 5`, live)).returning();
  if (!attempt || !equalLookupHashes(attempt.codeHash, await hash(`${data.challengeId}:${data.code}:${secret}`))) throw new LookupCodeError("Invalid or expired code");
  const [consumed] = await db.update(challenges).set({ used: 1 }).where(and(eq(challenges.id, data.challengeId), eq(challenges.used, 0), live)).returning();
  if (!consumed) throw new LookupCodeError("Invalid or expired code");
  const booking = await loadBookingBlob(consumed.bookingId);
  if (!booking) throw new LookupCodeError("Invalid or expired code");
  return { requireLookupOtp: true as const, ...(await withManageToken(consumed.bookingId, booking)) };
}
