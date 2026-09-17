import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import { getSetting, setSetting } from "@/db/queries";
import { site } from "@/lib/site";
import {
  WEBSITE_BOOKING_SETTINGS_KEY, websiteBookingSettingsSchema,
  readWebsiteBookingSettings, gatewayConfiguration,
  InvalidWebsiteBookingSettingsError,
} from "@/lib/websiteBookingSettings";

export async function POST(req: NextRequest) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (body.username != null && typeof body.username !== "string") return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  let auth;
  try { auth = await authenticateUser(body.password, body.username); }
  catch { return NextResponse.json({ error: "Unable to authenticate. Please retry." }, { status: 503 }); }
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "Booking Settings requires an administrator" }, { status: 403 });
  if (isPiRuntime()) return NextResponse.json({ error: "Manage native booking configuration on the Cloudflare server" }, { status: 403 });
  try {
    switch (body.action) {
      case "getSettings": {
        const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
        return NextResponse.json({
          settings,
          gateway: gatewayConfiguration(settings.gatewayEnvironment, process.env),
          webhookUrl: `${site.url}/api/webhooks/razorpay`,
          policyStatus: "draft",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      case "saveSettings": {
        if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
          return NextResponse.json({ error: "Booking settings must be an object" }, { status: 400 });
        }
        const current = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
        const parsed = websiteBookingSettingsSchema.safeParse({ ...current, ...body.settings });
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid booking settings" }, { status: 400 });
        await setSetting(WEBSITE_BOOKING_SETTINGS_KEY, JSON.stringify(parsed.data));
        return NextResponse.json({ success: true, settings: parsed.data, gateway: gatewayConfiguration(parsed.data.gatewayEnvironment, process.env), policyStatus: "draft" });
      }
      case "checkGatewayReadiness": {
        const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
        return NextResponse.json({
          gateway: gatewayConfiguration(settings.gatewayEnvironment, process.env),
          message: "Configuration presence checked only. Provider connectivity, capture verification, webhook processing and checkout are not implemented yet; no payment or provider request was made.",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      default: return NextResponse.json({ error: "Unknown booking settings action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof InvalidWebsiteBookingSettingsError) {
      return NextResponse.json({ error: error.message, code: "BOOKING_SETTINGS_INVALID" }, {
        status: 409, headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ error: "Unable to access booking settings. Please retry." }, { status: 500 });
  }
}
