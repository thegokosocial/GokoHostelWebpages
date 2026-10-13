import { NextRequest, NextResponse } from "next/server";
import { runAutomaticNoShows } from "@/lib/autoNoShow";
import { getSetting } from "@/db/queries";
import { WEBSITE_BOOKING_SETTINGS_KEY, readWebsiteBookingSettings } from "@/lib/websiteBookingSettings";

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  if (!settings.autoMarkReleasedNoShows) return NextResponse.json({ success: true, enabled: false, scanned: 0, marked: 0, skipped: 0 });
  const result = await runAutomaticNoShows();
  return NextResponse.json({ success: true, enabled: true, ...result });
}
