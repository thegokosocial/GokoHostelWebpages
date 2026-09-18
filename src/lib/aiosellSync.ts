/**
 * Auto-sync helper: pushes inventory to Aiosell after bed status changes.
 * Called fire-and-forget from bed assign/checkout/booking creation flows.
 *
 * Golden Rule: Only push to Aiosell for Goko-originated changes.
 * Aiosell-originated events (OTA/Website bookings via webhook) must NOT push back.
 */

import { getChannelConfig, getRoomTypeMappings, getRatePlanMappings, getAllDailyRates, updateChannelSyncTime, getActiveAssignmentCountForDorm, getOnlineAssignmentCountForDorm, getBlockedBedIdsForDate, getInventoryOverrideForDormDate, markInventoryDirty, getDirtyInventory, clearDirtyInventory, getUnassignedOtaRoomCountForDorm, getAvailabilitySnapshot, getActiveNativeHoldBedCountForDorm } from "@/db/queries";
import { logPmsCall } from "@/lib/pmsLog";
import { todayIST } from "@/lib/utils";
import { getDb } from "@/db";
import { beds } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { addCalendarDays, computeNightAvailability, countUnassignedOtaRooms, otaCeiling, remainingSplit } from "@/lib/inventoryAvailability";
import { pushInventory, pushRates, pushRateRestrictions, type AiosellConfig, type InventoryUpdate, type RateUpdate, type RateRestrictionUpdate, type RestrictionFields, type RestrictionPatch } from "@/lib/aiosell";

export type InventorySyncResult = {
  attempted: boolean;
  accepted: boolean;
  queued?: boolean;
  message?: string;
};

/** Convert held bed positions to sellable units (same bedsPerUnit as getDateAwareAvailability). */
export function heldBedsToUnits(heldBeds: number, totalBeds: number, totalUnits: number): number {
  if (heldBeds <= 0) return 0;
  const bedsPerUnit = totalUnits > 0 ? Math.max(1, Math.ceil(totalBeds / totalUnits)) : 1;
  return Math.ceil(heldBeds / bedsPerUnit);
}

/** Count held bed positions for one dorm+night from a snapshot hold list. */
export function countNativeHoldBedsForDormDate(
  dormId: number,
  date: string,
  bedRows: Array<{ id: number; dormId: number }>,
  holds: Array<{ bedIds: string; checkinDate: string; checkoutDate: string }>,
): number {
  const dormBedIds = new Set(bedRows.filter((b) => b.dormId === dormId).map((b) => b.id));
  let count = 0;
  for (const hold of holds) {
    if (hold.checkinDate > date || hold.checkoutDate <= date) continue;
    for (const id of JSON.parse(hold.bedIds) as number[]) {
      if (dormBedIds.has(id)) count++;
    }
  }
  return count;
}

export async function getDateAwareAvailability(dormId: number, date: string): Promise<number> {
  const db = getDb();
  const totalRows = await db.select({ count: sql<number>`COUNT(*)` }).from(beds).where(eq(beds.dormId, dormId));
  const totalBeds = totalRows[0]?.count ?? 0;
  const mapping = (await getRoomTypeMappings()).find((m) => m.dormId === dormId && m.isActive);
  const totalUnits = Number(mapping?.totalInventory) > 0 ? Math.min(totalBeds, Number(mapping?.totalInventory)) : totalBeds;
  const bedsPerUnit = totalUnits > 0 ? Math.max(1, Math.ceil(totalBeds / totalUnits)) : 1;
  const blockedBedIds = await getBlockedBedIdsForDate(dormId, date);
  const assignedCount = await getActiveAssignmentCountForDorm(dormId, date);
  const onlineAssigned = await getOnlineAssignmentCountForDorm(dormId, date);
  const heldBeds = await getActiveNativeHoldBedCountForDorm(dormId, date);
  const override = await getInventoryOverrideForDormDate(dormId, date);
  const blocked = Math.ceil(blockedBedIds.length / bedsPerUnit);
  const assigned = Math.ceil(assignedCount / bedsPerUnit);
  const assignedOnline = Math.ceil(onlineAssigned / bedsPerUnit);
  const held = heldBedsToUnits(heldBeds, totalBeds, totalUnits);
  const ceiling = otaCeiling(totalUnits, blocked, override?.onlineAvailable);
  const unassignedOta = await getUnassignedOtaRoomCountForDorm(dormId, date);
  // Native website holds consume physical leftover and online ceiling like online assignments.
  const available = Math.max(0, totalUnits - blocked - assigned - held - unassignedOta);
  return remainingSplit(available, ceiling, assignedOnline + held + unassignedOta).online;
}

export async function getDateAwareAvailabilityRange(
  mappings: Array<{ dormId: number; channelRoomCode: string; totalInventory: number }>,
  dates: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (dates.length === 0 || mappings.length === 0) return result;
  const [bedRows, assignments, blocks, overrides, unassignedBookings, nativeHolds = []] = await getAvailabilitySnapshot(dates[0], dates[dates.length - 1]);

  for (const mapping of mappings) {
    const dormBeds = bedRows.filter((b) => b.dormId === mapping.dormId).length;
    const totalUnits = Number(mapping.totalInventory) > 0 ? Math.min(dormBeds, Number(mapping.totalInventory)) : dormBeds;
    for (const date of dates) {
      const unassignedOta = countUnassignedOtaRooms([mapping.channelRoomCode], unassignedBookings.filter((b) => {
        const checkout = !b.checkoutDate || b.checkoutDate <= b.checkinDate
          ? addCalendarDays(b.checkinDate, 1)
          : b.checkoutDate;
        return b.checkinDate <= date && checkout > date;
      }));
      const snapshot = computeNightAvailability(mapping.dormId, date, bedRows, blocks, assignments, overrides, unassignedOta);
      const held = heldBedsToUnits(
        countNativeHoldBedsForDormDate(mapping.dormId, date, bedRows, nativeHolds),
        dormBeds,
        totalUnits,
      );
      // Second pass: treat active native holds like online assignments for OTA remaining.
      const online = Math.max(0, snapshot.online - held);
      result.set(`${mapping.dormId}:${date}`, Math.min(online, Number(mapping.totalInventory) || snapshot.total));
    }
  }
  return result;
}

export async function otaFingerprint(dormIds: number[], dates: string[]): Promise<string> {
  const today = todayIST();
  const dorms = [...new Set(dormIds.filter((id) => id > 0))];
  // Past nights are accounting-only for channel inventory — fingerprint live OTA nights only.
  const nights = [...new Set(dates.filter((d) => d && d >= today))];
  const parts: string[] = [];
  for (const dormId of dorms) {
    for (const date of nights) {
      parts.push(`${dormId}:${date}:${await getDateAwareAvailability(dormId, date)}`);
    }
  }
  return parts.sort().join("|");
}

export async function pushIfOtaChanged(before: string, dormIds: number[], dates: string[]): Promise<InventorySyncResult | void> {
  const today = todayIST();
  const futureDates = dates.filter((d) => d >= today);
  if (futureDates.length === 0 || dormIds.length === 0) return { attempted: false, accepted: true };
  const after = await otaFingerprint(dormIds, futureDates);
  if (before !== after) return await triggerInventoryPush(futureDates, dormIds);
  return { attempted: false, accepted: true };
}

export async function triggerInventoryPush(
  affectedDates?: string[],
  affectedDormId?: number | number[],
  affectedCells?: Array<{ dormId: number; date: string }>,
): Promise<InventorySyncResult | void> {
  try {
    if (affectedDates && affectedDates.length === 0) return { attempted: false, accepted: true };
    const dates = affectedDates && affectedDates.length > 0
      ? [...new Set(affectedDates)]
      : [todayIST()];

    const config = await getChannelConfig();
    const mappings = config ? (await getRoomTypeMappings()).filter((m) => m.isActive) : [];

    const affectedDormIds = affectedDormId == null
      ? []
      : [...new Set(Array.isArray(affectedDormId) ? affectedDormId : [affectedDormId])];
    const requestedCells = affectedCells?.length
      ? new Set(affectedCells.map((cell) => `${cell.dormId}:${cell.date}`))
      : null;

    if (affectedDormIds.length > 0) {
      for (const dormId of affectedDormIds) {
        const dormDates = requestedCells ? dates.filter((date) => requestedCells.has(`${dormId}:${date}`)) : dates;
        if (dormDates.length > 0 && mappings.some((m) => m.dormId === dormId)) await markInventoryDirty(dormId, dormDates).catch(() => {});
      }
    } else if (mappings.length > 0) {
      for (const m of mappings) {
        await markInventoryDirty(m.dormId, dates).catch(() => {});
      }
    }

    if (!config || !config.isActive) return { attempted: false, accepted: false, message: "Aiosell inventory sync is not active" };
    if (!config.autoPushInventory) return { attempted: false, accepted: false, message: "Aiosell automatic inventory sync is disabled" };
    if (mappings.length === 0) return { attempted: false, accepted: false, message: "No active Aiosell room mappings" };

    let activeMappings = mappings;
    if (affectedDormIds.length > 0) {
      activeMappings = activeMappings.filter((m) => affectedDormIds.includes(m.dormId));
      if (activeMappings.length === 0) return { attempted: false, accepted: false, message: "No active Aiosell mapping for this dorm" };
    }

    const availability = await getDateAwareAvailabilityRange(activeMappings.map((mapping) => ({
      dormId: mapping.dormId,
      channelRoomCode: mapping.channelRoomCode,
      totalInventory: Number(mapping.totalInventory) || 0,
    })), dates);
    const updates: InventoryUpdate[] = [];
    for (const date of dates) {
      const rooms = activeMappings
        .filter((mapping) => !requestedCells || requestedCells.has(`${mapping.dormId}:${date}`))
        .map((mapping) => ({
          roomCode: mapping.channelRoomCode,
          available: availability.get(`${mapping.dormId}:${date}`) ?? 0,
        }));
      if (rooms.length > 0) updates.push({ startDate: date, endDate: date, rooms });
    }

    const aiosellConfig: AiosellConfig = {
      hotelCode: config.hotelCode,
      pmsId: config.pmsId,
      apiBaseUrl: config.apiBaseUrl,
      apiUsername: config.apiUsername,
      apiPassword: config.apiPassword,
    };

    const result = await pushInventory(aiosellConfig, updates, undefined, "auto");

    const warning = result.warnings?.filter(Boolean).join("; ");
    const accepted = result.success && !warning;
    if (accepted) {
      await updateChannelSyncTime();
      const dirty = await getDirtyInventory();
      const pushedDormIds = new Set(activeMappings.map((m) => m.dormId));
      const pushedDates = new Set(dates);
      const toClear = dirty.filter((d) =>
        pushedDormIds.has(d.dormId)
        && pushedDates.has(d.date)
        && (!requestedCells || requestedCells.has(`${d.dormId}:${d.date}`))
      ).map((d) => d.id);
      if (toClear.length > 0) {
        try {
          await clearDirtyInventory(toClear);
        } catch (error: any) {
          // Aiosell already accepted the payload. Keep dirty rows for retry,
          // but do not misreport the remote success as a failed push.
          console.error("Inventory dirty cleanup failed:", error?.message);
          return {
            attempted: true,
            accepted: true,
            message: "Aiosell accepted inventory; local retry queue cleanup is pending",
          };
        }
      }
    }
    return { attempted: true, accepted, message: accepted ? undefined : (warning || result.message || "Aiosell did not confirm the inventory update") };
  } catch (error: any) {
    console.error("Auto inventory push failed:", error?.message);
    await logPmsCall({
      direction: "push",
      type: "inventory (auto)",
      status: "failed",
      errorMessage: `Auto-push error: ${error?.message || "Unknown"}`,
    });
    return { attempted: true, accepted: false, message: error?.message || "Aiosell inventory push failed" };
  }
}

/** Retry durable dirty rows without expanding them into a full room/date matrix. */
export async function retryDirtyInventory(): Promise<InventorySyncResult | void> {
  const dirty = await getDirtyInventory();
  if (dirty.length === 0) return { attempted: false, accepted: true, message: "Nothing to retry" };
  return triggerInventoryPush(
    [...new Set(dirty.map((row) => row.date))],
    [...new Set(dirty.map((row) => row.dormId))],
    dirty.map((row) => ({ dormId: row.dormId, date: row.date })),
  );
}

function buildAiosellConfig(config: any): AiosellConfig {
  return { hotelCode: config.hotelCode, pmsId: config.pmsId, apiBaseUrl: config.apiBaseUrl, apiUsername: config.apiUsername, apiPassword: config.apiPassword };
}

export async function triggerRatePush(affectedDates: string[], affectedRatePlanIds?: number[]): Promise<InventorySyncResult | void> {
  try {
    const config = await getChannelConfig();
    if (!config || !config.isActive || !config.autoPushRates) {
      return { attempted: false, accepted: false, message: "Aiosell automatic rate sync is not active" };
    }

    const dates = [...new Set(affectedDates)];
    if (dates.length === 0) return { attempted: false, accepted: true, message: "No rate dates to push" };
    const start = dates.sort()[0];
    const end = dates[dates.length - 1];

    const mappings = (await getRoomTypeMappings()).filter((m) => m.isActive);
    let ratePlans = (await getRatePlanMappings()).filter((rp) => rp.isActive);
    if (affectedRatePlanIds?.length) {
      ratePlans = ratePlans.filter((rp) => affectedRatePlanIds.includes(rp.id));
    }
    const dailyRatesData = await getAllDailyRates(start, end);

    const ratesByPlan = new Map<number, typeof dailyRatesData>();
    for (const dr of dailyRatesData) {
      const arr = ratesByPlan.get(dr.ratePlanId) || [];
      arr.push(dr);
      ratesByPlan.set(dr.ratePlanId, arr);
    }

    const updates: RateUpdate[] = [];
    for (const date of dates) {
      const rates: Array<{ roomCode: string; rateplanCode: string; rate: number }> = [];
      for (const rp of ratePlans) {
        const mapping = mappings.find((m) => m.id === rp.roomMappingId);
        if (!mapping) continue;
        const dr = (ratesByPlan.get(rp.id) || []).find((r) => r.date === date);
        if (!dr) continue;
        rates.push({ roomCode: mapping.channelRoomCode, rateplanCode: rp.ratePlanCode, rate: dr.adult1Rate ?? dr.rate });
      }
      if (rates.length > 0) updates.push({ startDate: date, endDate: date, rates });
    }

    if (updates.length === 0) return { attempted: false, accepted: true, message: "No mapped rate data to push" };
    const aiosellConfig = buildAiosellConfig(config);
    const result = await pushRates(aiosellConfig, updates, "auto");
    if (result.success) await updateChannelSyncTime();
    return { attempted: true, accepted: result.success, message: result.success ? undefined : (result.message || "Aiosell did not confirm the rate update") };
  } catch (error: any) {
    console.error("Auto rate push failed:", error?.message);
    await logPmsCall({ direction: "push", type: "rate (auto)", status: "failed", errorMessage: `Auto-push error: ${error?.message || "Unknown"}` });
    return { attempted: true, accepted: false, message: error?.message || "Aiosell rate push failed" };
  }
}

export async function triggerRestrictionPush(affectedDates: string[], affectedRatePlanIds?: number[], patch?: RestrictionPatch): Promise<InventorySyncResult | void> {
  try {
    const config = await getChannelConfig();
    if (!config || !config.isActive || !config.autoPushRateRestrictions) {
      return { attempted: false, accepted: false, message: "Aiosell automatic restriction sync is not active" };
    }

    const dates = [...new Set(affectedDates)].sort();
    if (dates.length === 0) return { attempted: false, accepted: true, message: "No restriction dates to push" };
    const start = dates[0];
    const end = dates[dates.length - 1];

    const mappings = (await getRoomTypeMappings()).filter((m) => m.isActive);
    let ratePlans = (await getRatePlanMappings()).filter((rp) => rp.isActive);
    if (affectedRatePlanIds?.length) {
      ratePlans = ratePlans.filter((rp) => affectedRatePlanIds.includes(rp.id));
    }

    const mappedPlans = ratePlans.flatMap((rp) => {
      const mapping = mappings.find((m) => m.id === rp.roomMappingId);
      return mapping ? [{ rp, mapping }] : [];
    });
    if (mappedPlans.length === 0) return { attempted: false, accepted: false, message: "No active Aiosell rate-plan mappings" };

    const updates: RateRestrictionUpdate[] = [];
    const usePatch = patch && Object.keys(patch).length > 0;

    if (usePatch) {
      for (const date of dates) {
        updates.push({
          startDate: date,
          endDate: date,
          rates: mappedPlans.map(({ rp, mapping }) => ({
            roomCode: mapping.channelRoomCode,
            rateplanCode: rp.ratePlanCode,
            restrictions: patch,
          })),
        });
      }
    } else {
      const dailyRatesData = await getAllDailyRates(start, end);
      const ratesByPlan = new Map<number, typeof dailyRatesData>();
      for (const dr of dailyRatesData) {
        const arr = ratesByPlan.get(dr.ratePlanId) || [];
        arr.push(dr);
        ratesByPlan.set(dr.ratePlanId, arr);
      }
      for (const date of dates) {
        const rates: Array<{ roomCode: string; rateplanCode: string; restrictions: RestrictionFields }> = [];
        for (const { rp, mapping } of mappedPlans) {
          const dr = (ratesByPlan.get(rp.id) || []).find((r) => r.date === date);
          if (!dr) continue;
          rates.push({
            roomCode: mapping.channelRoomCode, rateplanCode: rp.ratePlanCode,
            restrictions: { stopSell: dr.stopSell === 1, minimumStay: dr.minimumStay ?? null, maximumStay: dr.maximumStay ?? null, closeOnArrival: dr.closeOnArrival === 1, closeOnDeparture: dr.closeOnDeparture === 1, minimumAdvanceReservation: dr.minimumAdvanceReservation ?? null, maximumAdvanceReservation: dr.maximumAdvanceReservation ?? null, minimumStayArrival: null, maximumStayArrival: null, exactStayArrival: null },
          });
        }
        if (rates.length > 0) updates.push({ startDate: date, endDate: date, rates });
      }
    }

    if (updates.length === 0) return { attempted: false, accepted: true, message: "No mapped restriction data to push" };
    const aiosellConfig = buildAiosellConfig(config);
    const result = await pushRateRestrictions(aiosellConfig, updates, undefined, "auto");
    if (result.success) await updateChannelSyncTime();
    return { attempted: true, accepted: result.success, message: result.success ? undefined : (result.message || "Aiosell did not confirm the restriction update") };
  } catch (error: any) {
    console.error("Auto restriction push failed:", error?.message);
    await logPmsCall({ direction: "push", type: "restriction (auto)", status: "failed", errorMessage: `Auto-push error: ${error?.message || "Unknown"}` });
    return { attempted: true, accepted: false, message: error?.message || "Aiosell restriction push failed" };
  }
}
