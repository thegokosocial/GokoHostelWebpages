import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { isPiRuntime } from "@/lib/runtime";
import { GuestCheckoutError, verifyGuestPayment } from "@/lib/nativeGuestCheckout";
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
    if (!guestBookingRateLimit(ip, 30)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    const body = await readGuestJsonBody(req) as {
      checkoutId?: string; ownerToken?: string; paymentId?: string; orderId?: string; signature?: string;
    };
    const result = await verifyGuestPayment(
      String(body.checkoutId || ""), String(body.ownerToken || ""),
      String(body.paymentId || ""), String(body.orderId || ""), String(body.signature || ""),
    );
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid payment details" }, { status: 400, headers });
    if (error instanceof GuestCheckoutError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof RazorpayError) return NextResponse.json({ error: error.message }, { status: error.httpStatus, headers });
    return NextResponse.json({ error: "Unable to verify payment. Reconcile before trying again." }, { status: 503, headers });
  }
}
