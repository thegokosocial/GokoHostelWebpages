import { NextRequest, NextResponse } from "next/server";
import { isPiRuntime } from "@/lib/runtime";
import { GuestCheckoutError, reconcileGuestCheckout } from "@/lib/nativeGuestCheckout";
import { RazorpayError } from "@/lib/razorpay";
import {
  assertGuestOrigin, guestApiHeaders, guestBookingRateLimit, readGuestJsonBody,
} from "@/lib/guestBookingRateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headers = guestApiHeaders();
  if (isPiRuntime()) return NextResponse.json({ error: "Please use the Goko website." }, { status: 403, headers });
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(ip, 20)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    const body = await readGuestJsonBody(req) as { checkoutId?: string; ownerToken?: string };
    return NextResponse.json(await reconcileGuestCheckout(String(body.checkoutId || ""), String(body.ownerToken || "")), { headers });
  } catch (error) {
    if (error instanceof GuestCheckoutError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof RazorpayError) return NextResponse.json({ error: error.message }, { status: error.httpStatus, headers });
    return NextResponse.json({ error: "Unable to reconcile this checkout right now." }, { status: 503, headers });
  }
}
