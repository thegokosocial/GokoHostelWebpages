import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { guestBookingLookup } from "@/lib/guestBookingLookup";
import { isPiRuntime } from "@/lib/runtime";
import { assertGuestOrigin, guestApiHeaders, guestBookingRateLimit, readGuestJsonBody } from "@/lib/guestBookingRateLimit";
export async function POST(req: NextRequest) {
  const headers = guestApiHeaders();
  if (isPiRuntime()) return NextResponse.json({ error: "Booking lookup is available on the Goko website only." }, { status: 403, headers });
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(`booking-lookup:${ip}`, 10, 10 * 60_000)) {
      return NextResponse.json({ error: "Too many lookup attempts. Please wait a few minutes and try again." }, { status: 429, headers });
    }
    return NextResponse.json(await guestBookingLookup(await readGuestJsonBody(req, 4096)), { headers });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check your confirmation number and last name." }, { status: 400, headers });
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 0;
    if (status === 403 || status === 413 || status === 400) return NextResponse.json({ error: status === 413 ? "Request too large" : status === 403 ? "Invalid request origin" : "Missing request" }, { status, headers });
    return NextResponse.json({ error: "Booking lookup is temporarily unavailable. Contact Goko for assistance." }, { status: 503, headers });
  }
}
