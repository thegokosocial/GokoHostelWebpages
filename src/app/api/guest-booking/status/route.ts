import { NextRequest, NextResponse } from "next/server";
import { isPiRuntime } from "@/lib/runtime";
import { GuestCheckoutError, getGuestBookingStatus } from "@/lib/nativeGuestCheckout";
import {
  assertGuestOrigin, guestApiHeaders, guestBookingRateLimit, readGuestJsonBody,
} from "@/lib/guestBookingRateLimit";

export const dynamic = "force-dynamic";

/** POST with token in body — avoids leaking guestAccessToken in query strings / Referer. */
export async function POST(req: NextRequest) {
  const headers = guestApiHeaders();
  if (isPiRuntime()) return NextResponse.json({ error: "Please use the Goko website." }, { status: 403, headers });
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(ip, 30)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    const body = await readGuestJsonBody(req) as { reference?: string; guestAccessToken?: string };
    return NextResponse.json(await getGuestBookingStatus(String(body.reference || ""), String(body.guestAccessToken || "")), { headers });
  } catch (error) {
    if (error instanceof GuestCheckoutError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "Unable to load booking status." }, { status: 503, headers });
  }
}
