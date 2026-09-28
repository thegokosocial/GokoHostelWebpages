/** Signed magic links for `{MANAGE_URL}` — open booking details without Find my booking OTP. */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, nativeBookingCheckouts } from "@/db/schema";
import { generateGuestAccessToken, hashToken } from "@/lib/bookingReference";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { GuestCheckoutError, getGuestBookingStatus } from "@/lib/nativeGuestCheckout";
import { isPiRuntime } from "@/lib/runtime";
import { site } from "@/lib/site";

const MANAGE_LINK_GRACE_DAYS = 7;
const MAGIC_RE = /^(\d{9,12})\.([a-f0-9]{64})$/i;

export class ManageLinkError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
    this.name = "ManageLinkError";
  }
}

function lookupSecret(): string {
  const secret = process.env.GUEST_BOOKING_LOOKUP_SECRET;
  if (!secret || secret.length < 32) throw new ManageLinkError("Manage link configuration missing", 503);
  return secret;
}

function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase();
}

/** End of (checkoutDate + 7 IST calendar days) as unix seconds. Missing date → 90 days from now. */
export function manageLinkExpiryUnix(checkoutDate: string | null | undefined, nowMs = Date.now()): number {
  const base = checkoutDate && /^\d{4}-\d{2}-\d{2}$/.test(checkoutDate)
    ? addCalendarDays(checkoutDate, MANAGE_LINK_GRACE_DAYS)
    : addCalendarDays(new Date(nowMs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), 90);
  const endMs = Date.parse(`${base}T23:59:59+05:30`);
  if (!Number.isFinite(endMs)) throw new ManageLinkError("Invalid checkout date for manage link", 400);
  return Math.floor(endMs / 1000);
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compact magic: `{expUnix}.{hmacHex}` over `{REF}|{exp}` (reference already in the path). */
export async function signGuestManageMagic(
  reference: string,
  expUnix: number,
  secret = lookupSecret(),
): Promise<string> {
  const ref = normalizeReference(reference);
  if (!ref || !/^[A-Z0-9_-]+$/.test(ref)) throw new ManageLinkError("Invalid booking reference", 400);
  if (!Number.isFinite(expUnix) || expUnix <= 0) throw new ManageLinkError("Invalid manage link expiry", 400);
  const sig = await hmacHex(`${ref}|${expUnix}`, secret);
  return `${expUnix}.${sig}`;
}

export async function verifyGuestManageMagic(
  reference: string,
  magic: string,
  opts: { nowUnix?: number; secret?: string } = {},
): Promise<{ expUnix: number }> {
  const secret = opts.secret ?? lookupSecret();
  const ref = normalizeReference(reference);
  const match = MAGIC_RE.exec(String(magic || "").trim());
  if (!match || !ref) throw new ManageLinkError("This manage link is invalid or expired. Use Find my booking on /book.");
  const expUnix = Number(match[1]);
  const nowUnix = opts.nowUnix ?? Math.floor(Date.now() / 1000);
  if (expUnix < nowUnix) {
    throw new ManageLinkError("This manage link has expired. Use Find my booking on /book with your email.");
  }
  const expected = await hmacHex(`${ref}|${expUnix}`, secret);
  if (!equalHex(expected.toLowerCase(), match[2].toLowerCase())) {
    throw new ManageLinkError("This manage link is invalid or expired. Use Find my booking on /book.");
  }
  return { expUnix };
}

export async function buildGuestManageUrl(
  reference: string,
  checkoutDate: string | null | undefined,
  absolute = true,
): Promise<string> {
  const ref = normalizeReference(reference);
  if (!ref) return absolute ? `${site.url}/book` : "/book";
  const magic = await signGuestManageMagic(ref, manageLinkExpiryUnix(checkoutDate));
  const path = `/booking/${encodeURIComponent(ref)}?m=${magic}`;
  return absolute ? `${site.url}${path}` : path;
}

/** Exchange a signed email magic link for guestAccessToken + public status (one round-trip). */
export async function openGuestManageLink(reference: string, magic: string) {
  if (isPiRuntime()) throw new ManageLinkError("Please use the Goko website.", 403);
  await verifyGuestManageMagic(reference, magic);

  const ref = normalizeReference(reference);
  const db = getDb();
  const matches = await db.select({ id: bookings.id, gokoBookingId: bookings.gokoBookingId, bookingRef: bookings.bookingRef })
    .from(bookings)
    .where(sql`(${sql`upper(${bookings.gokoBookingId}) = ${ref}`} OR ${sql`upper(${bookings.bookingRef}) = ${ref}`}) AND ${bookings.deletedAt} IS NULL`)
    .limit(2);
  if (matches.length !== 1) {
    throw new ManageLinkError("This manage link is invalid or expired. Use Find my booking on /book.");
  }

  const [checkout] = await db.select({ id: nativeBookingCheckouts.id })
    .from(nativeBookingCheckouts)
    .where(eq(nativeBookingCheckouts.bookingId, matches[0].id))
    .limit(1);
  if (!checkout) {
    throw new ManageLinkError("This manage link is invalid or expired. Use Find my booking on /book.");
  }

  const guestAccessToken = generateGuestAccessToken();
  const now = new Date().toISOString();
  await db.update(nativeBookingCheckouts).set({
    guestAccessHash: await hashToken(guestAccessToken),
    updatedAt: now,
  }).where(and(eq(nativeBookingCheckouts.id, checkout.id)));

  const manageRef = matches[0].gokoBookingId || matches[0].bookingRef || ref;
  try {
    const status = await getGuestBookingStatus(manageRef, guestAccessToken);
    return { guestAccessToken, ...status };
  } catch (error) {
    if (error instanceof GuestCheckoutError) {
      throw new ManageLinkError(error.message, error.status === 404 ? 401 : error.status);
    }
    throw error;
  }
}
