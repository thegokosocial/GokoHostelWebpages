import { NextResponse } from "next/server";
import { publicBookingConfig } from "@/lib/publicBookingConfig";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await publicBookingConfig();
  // Resolve relative links against our canonical origin, never an untrusted Host.
  return NextResponse.redirect(new URL(config.url, site.url), {
    status: 303,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
