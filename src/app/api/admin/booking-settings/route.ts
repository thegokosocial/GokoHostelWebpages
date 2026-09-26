import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import { getAllDorms, getSetting, setSetting } from "@/db/queries";
import { compareAndSetWebsiteSettings } from "@/lib/websiteBookingSettingsStore";
import { site } from "@/lib/site";
import {
  WEBSITE_BOOKING_SETTINGS_KEY, websiteBookingSettingsSchema,
  readWebsiteBookingSettings,
  InvalidWebsiteBookingSettingsError,
  websiteBookingSettingsRevision,
} from "@/lib/websiteBookingSettings";
import { evaluateNativeCheckoutReadiness } from "@/lib/nativeCheckoutReadiness";
import {
  BOOKING_EMAIL_TEMPLATES_KEY,
  parseBookingEmailTemplates,
  validateBookingEmailTemplates,
} from "@/lib/bookingEmailTemplates";
import {
  BOOKING_SMS_TEMPLATES_KEY,
  parseBookingSmsTemplates,
  validateBookingSmsTemplates,
} from "@/lib/bookingSmsTemplates";
import { loadAccommodationContent, propertyContentInputSchema, roomContentInputSchema, sanitizePhotoList } from "@/lib/accommodationContent";
import { countMediaUrlRefs, saveSitePropertyContent, saveSiteRoomContent } from "@/db/siteQueries";
import { keyToMediaUrl, releasedMediaKeys } from "@/lib/mediaKeys";
import { deleteMediaKeys } from "@/lib/mediaR2";

async function cleanupReleased(keys: string[]) {
  try {
    const unused: string[] = [];
    for (const key of keys) if (await countMediaUrlRefs(keyToMediaUrl(key)) === 0) unused.push(key);
    if (unused.length) await deleteMediaKeys(unused);
  } catch (error) { console.error("Accommodation media cleanup failed:", error); }
}

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
      case "getAccommodationContent": {
        return NextResponse.json(await loadAccommodationContent(), { headers: { "Cache-Control": "no-store" } });
      }
      case "saveRoomContent": {
        const parsed = roomContentInputSchema.safeParse(body.content);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid room content" }, { status: 400 });
        const dorm = (await getAllDorms()).find((row) => row.id === parsed.data.dormId && !row.deletedAt);
        if (!dorm) return NextResponse.json({ error: "Room not found" }, { status: 404 });
        const current = await loadAccommodationContent();
        const before = current.rooms.find((room) => room.dormId === parsed.data.dormId);
        const roomPhotos = sanitizePhotoList(parsed.data.roomPhotos);
        const washroomPhotos = sanitizePhotoList(parsed.data.washroomPhotos);
        const saved = await saveSiteRoomContent({ dormId: parsed.data.dormId, publicName: parsed.data.publicName,
          description: parsed.data.description, amenities: JSON.stringify(parsed.data.amenities),
          roomPhotos: JSON.stringify(roomPhotos), washroomPhotos: JSON.stringify(washroomPhotos) }, parsed.data.revision);
        if (!saved.length) return NextResponse.json({ error: "Room content changed in another session. Reload before saving.", code: "ACCOMMODATION_CONTENT_CONFLICT" }, { status: 409 });
        await cleanupReleased(releasedMediaKeys([...(before?.roomPhotos || []), ...(before?.washroomPhotos || [])], [...roomPhotos, ...washroomPhotos]));
        return NextResponse.json({ success: true, content: (await loadAccommodationContent()).rooms.find((room) => room.dormId === parsed.data.dormId) });
      }
      case "savePropertyGallery": {
        const parsed = propertyContentInputSchema.safeParse(body.content);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid property gallery" }, { status: 400 });
        const current = await loadAccommodationContent();
        const exteriorPhotos = sanitizePhotoList(parsed.data.exteriorPhotos);
        const commonPhotos = sanitizePhotoList(parsed.data.commonPhotos);
        const washroomPhotos = sanitizePhotoList(parsed.data.washroomPhotos);
        const saved = await saveSitePropertyContent({ exteriorPhotos: JSON.stringify(exteriorPhotos), commonPhotos: JSON.stringify(commonPhotos), washroomPhotos: JSON.stringify(washroomPhotos) }, parsed.data.revision);
        if (!saved.length) return NextResponse.json({ error: "Property gallery changed in another session. Reload before saving.", code: "ACCOMMODATION_CONTENT_CONFLICT" }, { status: 409 });
        await cleanupReleased(releasedMediaKeys([...current.property.exteriorPhotos, ...current.property.commonPhotos, ...current.property.washroomPhotos], [...exteriorPhotos, ...commonPhotos, ...washroomPhotos]));
        return NextResponse.json({ success: true, content: (await loadAccommodationContent()).property });
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
      case "getEmailTemplates": {
        const templates = parseBookingEmailTemplates(await getSetting(BOOKING_EMAIL_TEMPLATES_KEY));
        return NextResponse.json({ templates }, { headers: { "Cache-Control": "no-store" } });
      }
      case "saveEmailTemplates": {
        const templates = validateBookingEmailTemplates(body.templates);
        if (!templates) {
          return NextResponse.json({
            error: "Email templates need subject and body for confirmation, updated, and cancelled (subject ≤200, body ≤8000).",
          }, { status: 400 });
        }
        await setSetting(BOOKING_EMAIL_TEMPLATES_KEY, JSON.stringify(templates));
        return NextResponse.json({ success: true, templates }, { headers: { "Cache-Control": "no-store" } });
      }
      case "getSmsTemplates": {
        const templates = parseBookingSmsTemplates(await getSetting(BOOKING_SMS_TEMPLATES_KEY));
        return NextResponse.json({ templates }, { headers: { "Cache-Control": "no-store" } });
      }
      case "saveSmsTemplates": {
        const templates = validateBookingSmsTemplates(body.templates);
        if (!templates) {
          return NextResponse.json({
            error: "Text templates need a body for confirmation, updated, and cancelled (≤500 characters each).",
          }, { status: 400 });
        }
        await setSetting(BOOKING_SMS_TEMPLATES_KEY, JSON.stringify(templates));
        return NextResponse.json({ success: true, templates }, { headers: { "Cache-Control": "no-store" } });
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
