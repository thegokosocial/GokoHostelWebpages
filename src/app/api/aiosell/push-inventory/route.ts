import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { getChannelConfig, getRoomTypeMappings, updateChannelSyncTime, getDirtyInventory, clearDirtyInventory, clearAllDirtyInventory } from "@/db/queries";
import { getDateAwareAvailability, getDateAwareAvailabilityRange } from "@/lib/aiosellSync";
import { pushInventory, type AiosellConfig, type InventoryUpdate } from "@/lib/aiosell";
import { thirtyDayRange, validDateRange, warningRoomCodes } from "@/lib/aiosellValidation";
import { todayIST } from "@/lib/utils";
import { inclusiveNights } from "@/lib/inventoryAvailability";

export async function POST(req: NextRequest) {
  try {
    const { password, username, startDate, endDate, fullSync } = await req.json();
    const auth = await authenticateUser(password, username);
    if (!auth || auth.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await getChannelConfig();
    if (!config || !config.isActive) {
      return NextResponse.json({ error: "Channel manager not configured or inactive" }, { status: 400 });
    }

    const roomMappings = await getRoomTypeMappings();
    const activeMappings = roomMappings.filter((m) => m.isActive);
    if (activeMappings.length === 0) {
      return NextResponse.json({ error: "No room type mappings configured" }, { status: 400 });
    }

    const aiosellConfig: AiosellConfig = {
      hotelCode: config.hotelCode,
      pmsId: config.pmsId,
      apiBaseUrl: config.apiBaseUrl,
      apiUsername: config.apiUsername,
      apiPassword: config.apiPassword,
    };

    const dirtyEntries = await getDirtyInventory();
    const mappedDormIds = new Set(activeMappings.map((m) => m.dormId));
    let useDirty = !fullSync && !startDate && !endDate && dirtyEntries.length > 0;

    let updates: InventoryUpdate[] = [];
    let mode: "incremental" | "full" = "full";

    if (useDirty) {
      const unmappedIds = dirtyEntries.filter((d) => !mappedDormIds.has(d.dormId)).map((d) => d.id);
      if (unmappedIds.length > 0) await clearDirtyInventory(unmappedIds);
      const mappedDirty = dirtyEntries.filter((d) => mappedDormIds.has(d.dormId));
      if (mappedDirty.length === 0) {
        useDirty = false;
      } else {
        mode = "incremental";
        const dormDatePairs = new Map<string, { dormId: number; date: string }>();
        for (const d of mappedDirty) {
          dormDatePairs.set(`${d.dormId}:${d.date}`, { dormId: d.dormId, date: d.date });
        }

        updates = [];
        for (const { dormId, date } of dormDatePairs.values()) {
          const mapping = activeMappings.find((m) => m.dormId === dormId);
          if (!mapping) continue;
          const available = await getDateAwareAvailability(dormId, date);
          updates.push({ startDate: date, endDate: date, rooms: [{ roomCode: mapping.channelRoomCode, available }] });
        }
        if (updates.length === 0) useDirty = false;
      }
    }

    if (!useDirty) {
      mode = "full";
      const defaults = thirtyDayRange(todayIST());
      const start = startDate || defaults.start;
      const end = endDate || defaults.end;
      if (!validDateRange(start, end)) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

      const dates = inclusiveNights(start, end);
      const availability = await getDateAwareAvailabilityRange(activeMappings, dates);

      updates = [];
      for (const date of dates) {
        const rooms: Array<{ roomCode: string; available: number }> = [];
        for (const mapping of activeMappings) {
          const available = availability.get(`${mapping.dormId}:${date}`) ?? 0;
          rooms.push({ roomCode: mapping.channelRoomCode, available });
        }
        updates.push({ startDate: date, endDate: date, rooms });
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true, message: "Nothing to push", inventoryPushed: 0, mode });
    }


    const result = await pushInventory(aiosellConfig, updates);

    // Aiosell can return HTTP success while rejecting one or more room codes.
    // Keep the dirty entries so staff can correct the mapping and retry.
    const accepted = result.success && !(result.warnings?.length);
    let cleanupPending = false;
    if (accepted) {
      await updateChannelSyncTime();
      try {
        if (useDirty) {
          const toClear = dirtyEntries.filter((d) => mappedDormIds.has(d.dormId)).map((d) => d.id);
          if (toClear.length > 0) await clearDirtyInventory(toClear);
        } else if (fullSync) {
          await clearAllDirtyInventory();
        } else {
          const dirty = await getDirtyInventory();
          const pushedDormIds = new Set(activeMappings.map((m) => m.dormId));
          const pushedDates = new Set(updates.map((u) => u.startDate));
          const toClear = dirty.filter((d) => pushedDormIds.has(d.dormId) && pushedDates.has(d.date)).map((d) => d.id);
          if (toClear.length > 0) await clearDirtyInventory(toClear);
        }
      } catch (error: any) {
        cleanupPending = true;
        console.error("Inventory dirty cleanup failed:", error?.message);
      }
    }

    if (!accepted) {
      return NextResponse.json({
        success: false,
        message: result.warnings?.join("; ") || result.message || "Aiosell did not confirm the inventory update",
        warnings: result.warnings,
        invalidRoomCodes: warningRoomCodes(result.warnings),
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      warnings: result.warnings,
      inventoryPushed: updates.reduce((sum, u) => sum + u.rooms.length, 0),
      mode,
      ...(cleanupPending ? { cleanupPending: true, cleanupMessage: "Aiosell accepted inventory; local retry queue cleanup is pending" } : {}),
    });
  } catch (error: any) {
    console.error("Push inventory error:", error?.message);
    return NextResponse.json({ error: "Push failed: " + (error?.message || "Unknown") }, { status: 500 });
  }
}
