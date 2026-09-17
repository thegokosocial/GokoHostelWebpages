import { NextResponse } from "next/server";
import { publicBookingConfig } from "@/lib/publicBookingConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await publicBookingConfig();
  return NextResponse.json(config, {
    status: config.configurationAvailable ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
