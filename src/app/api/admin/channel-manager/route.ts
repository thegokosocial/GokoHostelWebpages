import { checkMappings, getMappingHealth } from "@/lib/aiosellMappingCheck";
import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import {
  getChannelConfig, upsertChannelConfig,
  getRoomTypeMappings, upsertRoomTypeMapping, deleteRoomTypeMapping,
  getRatePlanMappings, upsertRatePlanMapping, deleteRatePlanMapping,
  getDailyRates, bulkUpsertDailyRates, getChannelSyncLogs,
  getAllDorms, getAllBeds, getSetting, setSetting,
} from "@/db/queries";
import { BOOKING_TAX_SETTING, BOOKING_TAX_APPLY_WEBSITE_SETTING, BOOKING_TAX_APPLY_ADMIN_SETTING, bookingTaxPercent, bookingTaxApplyEnabled } from "@/lib/bookingPricing";
import { logListQuery, logSafePage } from "@/lib/logRetention";
import { getAiosellPropertyDetails, type AiosellConfig } from "@/lib/aiosell";
import { sellableUnits } from "@/lib/inventoryAvailability";
import { bookingDestination } from "@/lib/bookingDestination";

function clientConfig(config: NonNullable<Awaited<ReturnType<typeof getChannelConfig>>>): AiosellConfig {
  return { hotelCode: config.hotelCode, pmsId: config.pmsId, apiBaseUrl: config.apiBaseUrl, apiUsername: config.apiUsername, apiPassword: config.apiPassword };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (action === "getSyncLogs") {
      const gate = actionAllowed(auth.role, auth.permissions || {}, "canViewLogs");
      if (gate !== "allowed") {
        return NextResponse.json({ error: "You don't have permission to view system logs" }, { status: 403 });
      }
    } else if (auth.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    switch (action) {
      case "getMappingHealth": return NextResponse.json({ health: await getMappingHealth() });
      case "checkMappings": return NextResponse.json(await checkMappings("manual"));
      case "getConfig": {
        const cfg = await getChannelConfig();
        const bookingTaxRate = bookingTaxPercent(await getSetting(BOOKING_TAX_SETTING));
        const bookingTaxApplyWebsite = bookingTaxApplyEnabled(await getSetting(BOOKING_TAX_APPLY_WEBSITE_SETTING));
        const bookingTaxApplyAdmin = bookingTaxApplyEnabled(await getSetting(BOOKING_TAX_APPLY_ADMIN_SETTING));
        return NextResponse.json({ config: cfg ?? null, bookingTaxRate, bookingTaxApplyWebsite, bookingTaxApplyAdmin });
      }

      case "saveConfig": {
        const configData = { ...body.config };
        try {
          const destination = bookingDestination(configData.bookingEngineUrl, configData.apiBaseUrl);
          configData.bookingEngineUrl = destination.mode === "enquiry" ? "" : destination.url;
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Booking Engine URL" }, { status: 400 });
        }
        if (configData.isActive && !configData.webhookSecret) {
          return NextResponse.json({ error: "Webhook secret is required to enable the channel manager" }, { status: 400 });
        }
        await upsertChannelConfig(configData);
        if (body.bookingTaxRate != null && body.bookingTaxRate !== "") {
          await setSetting(BOOKING_TAX_SETTING, String(bookingTaxPercent(body.bookingTaxRate)));
        }
        if (body.bookingTaxApplyWebsite !== undefined) {
          await setSetting(BOOKING_TAX_APPLY_WEBSITE_SETTING, bookingTaxApplyEnabled(body.bookingTaxApplyWebsite) ? "1" : "0");
        }
        if (body.bookingTaxApplyAdmin !== undefined) {
          await setSetting(BOOKING_TAX_APPLY_ADMIN_SETTING, bookingTaxApplyEnabled(body.bookingTaxApplyAdmin) ? "1" : "0");
        }
        return NextResponse.json({ success: true });
      }

      case "getRoomMappings": {
        const mappings = await getRoomTypeMappings();
        const allDorms = await getAllDorms();
        const allBeds = await getAllBeds();
        const nameById = new Map(allDorms.map((d) => [d.id, d.name]));
        const unitCounts = new Map<number, number>();
        for (const unit of sellableUnits(allBeds)) {
          unitCounts.set(unit.dormId, (unitCounts.get(unit.dormId) || 0) + 1);
        }
        const dormsWithCounts = [...allDorms]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => ({
            id: d.id,
            name: d.name,
            bedCount: unitCounts.get(d.id) || 0,
          }));
        const config = await getChannelConfig();
        const property = config ? await getAiosellPropertyDetails(clientConfig(config)) : null;
        return NextResponse.json({
          mappings: mappings.map((m) => ({ ...m, dormName: nameById.get(m.dormId) ?? m.dormName })),
          dorms: dormsWithCounts,
          remoteRooms: property?.success ? property.details.rooms : [],
          propertyError: property && !property.success ? property.message : null,
        });
      }

      case "saveRoomMapping": {
        const mapping = body.mapping;
        const code = String(mapping?.channelRoomCode || "").trim();
        const dormId = Number(mapping?.dormId);
        if (!Number.isInteger(dormId) || dormId < 1 || !code) {
          return NextResponse.json({ error: "Dorm and Aiosell room code are required" }, { status: 400 });
        }
        const mappingId = Number(mapping?.id);
        const isActive = mapping?.isActive !== 0 && mapping?.isActive !== false;
        const dormUnits = sellableUnits((await getAllBeds()).filter((bed) => bed.dormId === dormId)).length;
        if (dormUnits < 1) {
          return NextResponse.json({ error: "This dorm has no sellable room/bed units" }, { status: 400 });
        }
        if (isActive) {
          const config = await getChannelConfig();
          if (!config) return NextResponse.json({ error: "Channel manager is not configured" }, { status: 400 });
          const property = await getAiosellPropertyDetails(clientConfig(config));
          if (!property.success) return NextResponse.json({ error: property.message }, { status: 502 });
          const remote = property.details.rooms.find((r) => r.room_id === code && r.active !== false);
          if (!remote) return NextResponse.json({ error: `Aiosell room code is invalid or inactive: ${code}` }, { status: 409 });
        }
        await upsertRoomTypeMapping({
          id: Number.isInteger(mappingId) && mappingId > 0 ? mappingId : undefined,
          dormId,
          channelRoomCode: code,
          totalInventory: dormUnits,
          isActive: isActive ? 1 : 0,
        });
        return NextResponse.json({ success: true });
      }

      case "deleteRoomMapping": {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id < 1) {
          return NextResponse.json({ error: "Mapping id is required" }, { status: 400 });
        }
        await deleteRoomTypeMapping(id);
        return NextResponse.json({ success: true });
      }

      case "getRatePlans": {
        const plans = await getRatePlanMappings(body.roomMappingId);
        return NextResponse.json({ plans });
      }

      case "saveRatePlan": {
        const plan = body.plan;
        const ratePlanCode = String(plan?.ratePlanCode || "").trim();
        const ratePlanName = String(plan?.ratePlanName || "").trim();
        const roomMappingId = Number(plan?.roomMappingId);
        if (!Number.isInteger(roomMappingId) || roomMappingId < 1 || !ratePlanCode || !ratePlanName) {
          return NextResponse.json({ error: "Room, rate plan code, and name are required" }, { status: 400 });
        }
        const planId = Number(plan?.id);
        await upsertRatePlanMapping({
          id: Number.isInteger(planId) && planId > 0 ? planId : undefined,
          roomMappingId,
          ratePlanCode,
          ratePlanName,
          isActive: plan?.isActive,
        });
        return NextResponse.json({ success: true });
      }

      case "deleteRatePlan": {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id < 1) {
          return NextResponse.json({ error: "Rate plan id is required" }, { status: 400 });
        }
        await deleteRatePlanMapping(id);
        return NextResponse.json({ success: true });
      }

      case "getDailyRates": {
        const rates = await getDailyRates(body.ratePlanId, body.startDate, body.endDate);
        return NextResponse.json({ rates });
      }

      case "saveDailyRates": {
        const count = await bulkUpsertDailyRates(body.rates);
        return NextResponse.json({ success: true, count });
      }

      case "getSyncLogs": {
        const { page, pageSize, offset } = logListQuery(body);
        const { logs, total } = await getChannelSyncLogs(pageSize, {
          direction: body.direction || undefined,
          type: body.type || undefined,
          status: body.status || undefined,
          since: body.since || undefined,
          offset,
        });
        return NextResponse.json({ logs, total, page: logSafePage(total, pageSize, page), pageSize });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Channel manager admin error:", error?.message);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}
