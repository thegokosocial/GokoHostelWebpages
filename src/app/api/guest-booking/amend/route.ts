import { NextRequest, NextResponse } from "next/server";
import { isPiRuntime } from "@/lib/runtime";
import { guestApiHeaders, assertGuestOrigin, guestBookingRateLimit, readGuestJsonBody } from "@/lib/guestBookingRateLimit";

export const dynamic = "force-dynamic";

/** Guest self-serve amend is retired — changes go through WhatsApp / front desk. */
export async function POST(req: NextRequest) {
  const headers = guestApiHeaders();
  if (isPiRuntime()) return NextResponse.json({ error: "Please use the Goko website." }, { status: 403, headers });
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(ip, 12)) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    }
    await readGuestJsonBody(req); // consume body for consistent client errors
  } catch {
    /* ignore parse errors — still return the product message */
  }
  return NextResponse.json(
    { error: "Stay changes are handled by Goko on WhatsApp. Copy your booking details from the confirmation page and message us." },
    { status: 403, headers },
  );
}
