import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import { getSetting } from "@/db/queries";
import { compareAndSetWebsiteSettings } from "@/lib/websiteBookingSettingsStore";
import { site } from "@/lib/site";
import {
  WEBSITE_BOOKING_SETTINGS_KEY, websiteBookingSettingsSchema,
  readWebsiteBookingSettings,
  InvalidWebsiteBookingSettingsError,
  websiteBookingSettingsRevision,
} from "@/lib/websiteBookingSettings";
import { evaluateNativeCheckoutReadiness } from "@/lib/nativeCheckoutReadiness";

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
        const raw = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
        const settings = readWebsiteBookingSettings(raw);
        const readiness = await evaluateNativeCheckoutReadiness();
        return NextResponse.json({
          settings,
          revision: await websiteBookingSettingsRevision(raw),
          gateway: readiness.gateway,
          readiness: { nativeCheckoutReady: readiness.nativeCheckoutReady, blockers: readiness.blockerMessages },
          webhookUrl: `${site.url}/api/webhooks/razorpay`,
          policyStatus: readiness.nativeCheckoutReady ? "active_test" : "draft",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      case "saveSettings": {
        if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
          return NextResponse.json({ error: "Booking settings must be an object" }, { status: 400 });
        }
        const raw = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
        const current = readWebsiteBookingSettings(raw);
        const conflict = () => NextResponse.json({ error: "Booking settings changed or no edit revision was supplied. Reload the saved draft and review your changes before saving.", code: "BOOKING_SETTINGS_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
        if (typeof body.revision !== "string" || body.revision !== await websiteBookingSettingsRevision(raw)) return conflict();
        const parsed = websiteBookingSettingsSchema.safeParse({ ...current, ...body.settings });
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid booking settings" }, { status: 400 });
        const nextRaw = JSON.stringify(parsed.data);
        if (!await compareAndSetWebsiteSettings(raw, nextRaw)) return conflict();
        const readiness = await evaluateNativeCheckoutReadiness();
        return NextResponse.json({
          success: true, settings: parsed.data,
          revision: await websiteBookingSettingsRevision(nextRaw),
          gateway: readiness.gateway,
          readiness: { nativeCheckoutReady: readiness.nativeCheckoutReady, blockers: readiness.blockerMessages },
          policyStatus: readiness.nativeCheckoutReady ? "active_test" : "draft",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      case "checkGatewayReadiness": {
        // Fail closed on corrupt drafts before reporting readiness blockers.
        readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
        const readiness = await evaluateNativeCheckoutReadiness();
        return NextResponse.json({
          gateway: readiness.gateway,
          readiness: { nativeCheckoutReady: readiness.nativeCheckoutReady, blockers: readiness.blockerMessages },
          message: readiness.nativeCheckoutReady
            ? "Native guest checkout is ready in test mode. Live payments remain blocked until a separate cutover. No live charge was made."
            : `Checkout blocked: ${readiness.blockerMessages.join("; ") || "incomplete configuration"}. No payment or provider request was made.`,
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
