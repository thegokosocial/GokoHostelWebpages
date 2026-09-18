import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { isPiRuntime } from "@/lib/runtime";
import {
  GuestCheckoutError, quoteGuestAmend, prepareGuestAmend, confirmGuestAmend,
  searchGuestAmendAvailability, claimGuestCheckout,
} from "@/lib/nativeGuestCheckout";
import { RazorpayError } from "@/lib/razorpay";
import { NativeHoldError } from "@/lib/nativeInventoryHold";
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
    if (!guestBookingRateLimit(ip, 12)) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    }
    const body = await readGuestJsonBody(req) as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "availability") {
      return NextResponse.json(await searchGuestAmendAvailability(
        String(body.reference || ""), String(body.guestAccessToken || ""),
        String(body.checkinDate || ""), String(body.checkoutDate || ""),
      ), { headers });
    }
    if (action === "quote") {
      return NextResponse.json(await quoteGuestAmend(body as Parameters<typeof quoteGuestAmend>[0]), { headers });
    }
    if (action === "prepare") {
      return NextResponse.json(await prepareGuestAmend(body as Parameters<typeof prepareGuestAmend>[0]), { headers });
    }
    if (action === "claim") {
      return NextResponse.json(await claimGuestCheckout(String(body.checkoutId || ""), String(body.ownerToken || "")), { headers });
    }
    if (action === "confirm") {
      return NextResponse.json(await confirmGuestAmend({
        reference: String(body.reference || ""),
        guestAccessToken: String(body.guestAccessToken || ""),
        checkoutId: String(body.checkoutId || ""),
        ownerToken: body.ownerToken ? String(body.ownerToken) : undefined,
      }), { headers });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers });
  } catch (error) {
    return jsonError(error, headers);
  }
}

function jsonError(error: unknown, headers: Record<string, string>) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "Invalid request" }, { status: 400, headers });
  }
  if (error instanceof GuestCheckoutError || error instanceof NativeHoldError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers });
  }
  if (error instanceof RazorpayError) {
    return NextResponse.json({ error: error.message }, { status: error.httpStatus, headers });
  }
  return NextResponse.json({ error: "Unable to change this booking right now." }, { status: 503, headers });
}
