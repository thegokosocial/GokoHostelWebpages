import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { isPiRuntime } from "@/lib/runtime";
import { GuestCheckoutError, prepareGuestCheckout, claimGuestCheckout } from "@/lib/nativeGuestCheckout";
import { RazorpayError } from "@/lib/razorpay";
import { NativeHoldError } from "@/lib/nativeInventoryHold";
import {
  assertGuestOrigin, guestApiHeaders, guestBookingRateLimit, readGuestJsonBody,
} from "@/lib/guestBookingRateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headers = guestApiHeaders();
  if (isPiRuntime()) return NextResponse.json({ error: "Please use the Goko website to book." }, { status: 403, headers });
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(ip, 12)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    const body = await readGuestJsonBody(req) as Record<string, unknown>;
    if (body.action === "claim") {
      const result = await claimGuestCheckout(String(body.checkoutId || ""), String(body.ownerToken || ""));
      return NextResponse.json(result, { headers });
    }
    const result = await prepareGuestCheckout(body as Parameters<typeof prepareGuestCheckout>[0]);
    return NextResponse.json(result, { headers });
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
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 0;
  if (status === 403 || status === 413 || status === 400) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status, headers });
  }
  return NextResponse.json({ error: "Checkout is temporarily unavailable. Please try again or contact Goko." }, { status: 503, headers });
}
