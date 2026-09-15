import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { triggerInventoryPush, triggerRatePush, triggerRestrictionPush, type InventorySyncResult } from "@/lib/aiosellSync";
import { restrictionPatch } from "@/lib/aiosell";
import { addCalendarDays, computeNightAvailability, civilWeekday, inclusiveNights, overrideCeilingToSave, overridePreview, sellableUnits, summarizeAvailability, unassignedOtaOnNight, stayNights } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";
import {
  getInventoryGridData, getChannels, upsertChannel, deleteChannel,
  getBedTypeConfigs, upsertBedTypeConfig,
  getActiveBedBlocks, createBedBlock, deactivateBedBlock, deactivateBedBlocksByBedIds,
  upsertInventoryOverride, deleteInventoryOverride, bulkReplaceInventoryOverrides, markInventoryDirty, getBedsFreeToBlock, getAllDorms, getAvailabilitySnapshot, getUnassignedOtaHoldsForRange, getRoomTypeMappings, addAuditEntry,
  getChannelRatesForRange, upsertChannelRate,
  getDailyRates, upsertDailyRate,
  getAllBeds,
} from "@/db/queries";

const ACTION_PERMISSIONS: Record<string, string> = {
  getInventoryGrid: "canManageInventory",
  getChannels: "canManageInventory",
  upsertChannel: "canManageInventory",
  deleteChannel: "canManageInventory",
  getBedTypeConfigs: "canManageInventory",
  upsertBedTypeConfig: "canManageInventory",
  getActiveBlocks: "canManageInventory",
  getBedsFreeToBlock: "canManageInventory",
  blockBeds: "canManageInventory",
  unblockBeds: "canManageInventory",
  updateInventoryOverride: "canManageInventory",
  bulkSetAvailability: "canManageInventory",
  getChannelRates: "canManageInventory",
  updateChannelRate: "canManageInventory",
  updateRate: "canManageInventory",
  bulkSetRates: "canManageInventory",
  bulkAdjustRates: "canManageInventory",
  bulkSetRestrictions: "canManageInventory",
  retryPmsSync: "canManageInventory",
};

function requireSyncResult(sync: InventorySyncResult | void): InventorySyncResult {
  return sync ?? { attempted: true, accepted: false, message: "PMS sync did not return a result" };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...params } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, permissions } = auth;

    const requiredPerm = ACTION_PERMISSIONS[action];
    if (!requiredPerm) return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    if (role !== "admin" && !permissions[requiredPerm]) {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    const actingUser = username || role;

    if (action === "retryPmsSync") {
      const { syncType, dates, dormIds, ratePlanIds, patch } = params;
      if (!Array.isArray(dates) || dates.length > 366 || dates.some((date: unknown) => typeof date !== "string" || !date)) {
        return NextResponse.json({ error: "dates required" }, { status: 400 });
      }
      const validIds = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0);
      let sync: InventorySyncResult | void;
      if (syncType === "inventory") {
        if (!validIds(dormIds)) return NextResponse.json({ error: "dormIds required" }, { status: 400 });
        sync = requireSyncResult(await triggerInventoryPush(dates, dormIds));
      } else if (syncType === "rates") {
        if (!validIds(ratePlanIds)) return NextResponse.json({ error: "ratePlanIds required" }, { status: 400 });
        sync = requireSyncResult(await triggerRatePush(dates, ratePlanIds));
      } else if (syncType === "restrictions") {
        if (!validIds(ratePlanIds)) return NextResponse.json({ error: "ratePlanIds required" }, { status: 400 });
        sync = requireSyncResult(await triggerRestrictionPush(dates, ratePlanIds, patch));
      } else {
        return NextResponse.json({ error: "syncType must be inventory, rates, or restrictions" }, { status: 400 });
      }
      return NextResponse.json({ success: Boolean(sync?.accepted), sync });
    }

    if (action === "getInventoryGrid") {
      const { startDate, endDate } = params;
      if (!startDate || !endDate) return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
      const data = await getInventoryGridData(startDate, endDate);
      const bedConfigs = await getBedTypeConfigs();
      return NextResponse.json({ ...data, bedConfigs });
    }

    if (action === "getChannels") {
      const data = await getChannels();
      return NextResponse.json({ channels: data });
    }

    if (action === "upsertChannel") {
      const { id, name, code, isActive } = params;
      if (!name || !code) return NextResponse.json({ error: "name and code required" }, { status: 400 });
      await upsertChannel({ id, name, code, isActive });
      await recordInventoryAudit(actingUser, id ? "CHANNEL_UPDATED" : "CHANNEL_CREATED", `${name} (${code})`, { id: id ?? null, isActive: isActive ?? 1 });
      const data = await getChannels();
      return NextResponse.json({ success: true, channels: data });
    }

    if (action === "deleteChannel") {
      const { id } = params;
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      await deleteChannel(id);
      await recordInventoryAudit(actingUser, "CHANNEL_DELETED", `channel:${id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "getBedTypeConfigs") {
      const { dormId } = params;
      const data = await getBedTypeConfigs(dormId);
      return NextResponse.json({ configs: data });
    }

    if (action === "upsertBedTypeConfig") {
      const { id, dormId, bedType, maxOccupancy, extraPersonAllowed } = params;
      if (!dormId || !bedType) return NextResponse.json({ error: "dormId and bedType required" }, { status: 400 });
      await upsertBedTypeConfig({ id, dormId, bedType, maxOccupancy: maxOccupancy ?? 1, extraPersonAllowed: extraPersonAllowed ?? 0 });
      await recordInventoryAudit(actingUser, id ? "BED_TYPE_CONFIG_UPDATED" : "BED_TYPE_CONFIG_CREATED", `dorm:${dormId}`, { id: id ?? null, bedType, maxOccupancy: maxOccupancy ?? 1, extraPersonAllowed: extraPersonAllowed ?? 0 });
      const data = await getBedTypeConfigs();
      return NextResponse.json({ success: true, configs: data });
    }

    if (action === "getActiveBlocks") {
      const { dormId, startDate, endDate } = params;
      const data = await getActiveBedBlocks(dormId, startDate, endDate);
      return NextResponse.json({ blocks: data });
    }

    if (action === "getBedsFreeToBlock") {
      const { dormId, startDate, endDate } = params;
      if (!dormId || !startDate || !endDate) return NextResponse.json({ error: "dormId, startDate, endDate required" }, { status: 400 });
      if (startDate >= endDate) return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 });
      const free = await getBedsFreeToBlock(startDate, endDate, dormId);
      return NextResponse.json({ beds: free.map((b) => ({ id: b.id, bedId: b.bedId, dormId: b.dormId })) });
    }

    if (action === "blockBeds") {
      const { bedIds: requestedBedIds, dormId, startDate, endDate, reason } = params;
      const requested = new Set<number>(requestedBedIds || []);
      const bedIds = sellableUnits(await getAllBeds())
        .filter((u) => u.beds.some((b) => requested.has(b.id)))
        .flatMap((u) => u.beds.map((b) => b.id));
      if (!bedIds?.length || !dormId || !startDate || !endDate) return NextResponse.json({ error: "bedIds, dormId, startDate, endDate required" }, { status: 400 });
      if (startDate >= endDate) return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 });
      const free = await getBedsFreeToBlock(startDate, endDate, dormId);
      const freeIds = new Set(free.map((b) => b.id));
      if (bedIds.some((id: number) => !freeIds.has(id))) {
        return NextResponse.json({ error: "One or more beds are booked or already blocked for these dates" }, { status: 400 });
      }
      for (const bedId of bedIds) {
        await createBedBlock({ bedId, dormId, startDate, endDate, reason: reason || "", blockedBy: actingUser });
      }
      const dates = stayNights(startDate, endDate);
      const sync = dates.length > 0 ? requireSyncResult(await triggerInventoryPush(dates, dormId)) : { attempted: false, accepted: true, message: "No nights to push" };
      await recordInventoryAudit(actingUser, "BEDS_BLOCKED", `dorm:${dormId}`, { bedIds, startDate, endDate, reason: reason || "", count: bedIds.length, sync: { attempted: sync.attempted, accepted: sync.accepted, message: sync.message } });
      return NextResponse.json({ success: true, blocked: bedIds.length, sync, syncScope: { dates, dormIds: [dormId] } });
    }

    if (action === "unblockBeds") {
      const { blockIds, bedIds, startDate, endDate } = params;
      let pushDates: string[] | undefined;
      let pushDormId: number | undefined;
      let syncDormIds: number[] = [];
      if (blockIds?.length) {
        const blocks = await getActiveBedBlocks();
        const targeted = blocks.filter((b: any) => blockIds.includes(b.id));
        if (targeted.length > 0) {
          const allDates = new Set<string>();
          const dormIds = new Set<number>();
          for (const b of targeted) {
            stayNights(b.startDate, b.endDate).forEach((d) => allDates.add(d));
            dormIds.add(b.dormId);
          }
          pushDates = [...allDates];
          if (dormIds.size === 1) pushDormId = [...dormIds][0];
          syncDormIds = [...dormIds];
        }
        for (const blockId of blockIds) {
          await deactivateBedBlock(blockId, actingUser);
        }
      } else if (bedIds?.length && startDate && endDate) {
        const requested = new Set<number>(bedIds);
        const selectedUnits = sellableUnits(await getAllBeds()).filter((u) => u.beds.some((b) => requested.has(b.id)));
        const completeUnitIds = selectedUnits.flatMap((u) => u.beds.map((b) => b.id));
        syncDormIds = [...new Set(selectedUnits.map((u) => u.dormId))];
        await deactivateBedBlocksByBedIds(completeUnitIds, startDate, endDate, actingUser);
        pushDates = stayNights(startDate, endDate);
      } else {
        return NextResponse.json({ error: "blockIds or (bedIds + dates) required" }, { status: 400 });
      }
      const sync = pushDates && pushDates.length > 0
        ? requireSyncResult(await triggerInventoryPush(pushDates, syncDormIds.length > 0 ? syncDormIds : pushDormId))
        : { attempted: false, accepted: true, message: "No nights to push" };
      if (pushDormId && syncDormIds.length === 0) syncDormIds = [pushDormId];
      await recordInventoryAudit(actingUser, "BEDS_UNBLOCKED", blockIds?.length ? `blocks:${blockIds.join(",")}` : `dorm:${pushDormId ?? "multiple"}`, { blockIds: blockIds || [], bedIds: bedIds || [], startDate: startDate || null, endDate: endDate || null, sync: { attempted: sync.attempted, accepted: sync.accepted, message: sync.message } });
      return NextResponse.json({ success: true, sync, syncScope: { dates: pushDates || [], dormIds: syncDormIds } });
    }

    if (action === "updateInventoryOverride") {
      const { dormId, channelId, date, onlineAvailable, offlineAvailable } = params;
      if (!dormId || !date) return NextResponse.json({ error: "dormId and date required" }, { status: 400 });
      await upsertInventoryOverride({ dormId, channelId: channelId || null, date, onlineAvailable, offlineAvailable, overriddenBy: actingUser });
      const sync = requireSyncResult(await triggerInventoryPush([date], dormId));
      await recordInventoryAudit(actingUser, "INVENTORY_OVERRIDE_UPDATED", `dorm:${dormId} ${date}`, { channelId: channelId || null, onlineAvailable: onlineAvailable ?? null, offlineAvailable: offlineAvailable ?? null, sync: { attempted: sync.attempted, accepted: sync.accepted, message: sync.message } });
      return NextResponse.json({ success: true, sync, syncScope: { dates: [date], dormIds: [dormId] } });
    }

    if (action === "bulkSetAvailability") {
      const { dormIds: requestedDormIds, startDate, endDate, dayFilter, mode, onlineRemaining, preview } = params;
      if (!Array.isArray(requestedDormIds) || requestedDormIds.length === 0 || !startDate || !endDate) {
        return NextResponse.json({ error: "dormIds, startDate and endDate required" }, { status: 400 });
      }
      if (!validInventoryDateRange(startDate, endDate)) {
        return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
      }
      if (dayFilter !== undefined && (!Array.isArray(dayFilter) || dayFilter.some((day: unknown) => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6))) {
        return NextResponse.json({ error: "dayFilter must contain weekday numbers from 0 to 6" }, { status: 400 });
      }
      const normalizedDayFilter = Array.isArray(dayFilter) ? dayFilter : undefined;
      const allDates = inclusiveNights(startDate, endDate);
      if (allDates.length > 366) {
        return NextResponse.json({ error: "Availability updates are limited to 366 nights" }, { status: 400 });
      }
      const filteredDates = filterByDays(allDates, normalizedDayFilter);
      if (filteredDates.length === 0) {
        return NextResponse.json({ success: true, updated: 0, cleared: 0, capped: 0, unmappedDormIds: [], sync: { attempted: false, accepted: true }, message: "No nights match the selected days" });
      }
      if (mode !== "set" && mode !== "clear") {
        return NextResponse.json({ error: "mode must be set or clear" }, { status: 400 });
      }
      const requestedValue = Number(onlineRemaining);
      const hasValidRequestedValue = Number.isFinite(requestedValue) && Number.isInteger(requestedValue) && requestedValue >= 0;
      if (mode === "set" && !hasValidRequestedValue && preview !== true) {
        return NextResponse.json({ error: "onlineRemaining must be a non-negative whole number" }, { status: 400 });
      }

      const dormIds = [...new Set(requestedDormIds)];
      if (dormIds.some((id: unknown) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) {
        return NextResponse.json({ error: "dormIds must contain positive integers" }, { status: 400 });
      }
      if (dormIds.length * filteredDates.length > 10000) {
        return NextResponse.json({ error: "Availability updates are limited to 10,000 room-night cells" }, { status: 400 });
      }
      const allDorms = await getAllDorms();
      const knownDormIds = new Set(allDorms.map((d) => d.id));
      if (dormIds.some((id) => !knownDormIds.has(id))) {
        return NextResponse.json({ error: "One or more dorms do not exist" }, { status: 400 });
      }
      const dormNameById = new Map(allDorms.map((d) => [d.id, d.name]));

      const mappings = (await getRoomTypeMappings()).filter((mapping) => mapping.isActive);
      const mappedDormIds = new Set(mappings.map((mapping) => mapping.dormId));
      const unmappedDormIds = dormIds.filter((id) => !mappedDormIds.has(id));
      const [bedRows, assignments, blocks, overrides] = await getAvailabilitySnapshot(startDate, endDate);
      const holds = await getUnassignedOtaHoldsForRange(startDate, addCalendarDays(endDate, 1));
      const applied: Array<{ dormId: number; date: string; capped: boolean }> = [];
      const cellStats = dormIds.flatMap((dormId) => filteredDates.map((date) => ({
        dormId,
        date,
        stats: computeNightAvailability(
          dormId,
          date,
          bedRows,
          blocks,
          assignments,
          overrides,
          unassignedOtaOnNight(holds, dormId, date),
        ),
      })));
      const statsByCell = new Map(cellStats.map((cell) => [`${cell.dormId}:${cell.date}`, cell.stats]));
      const selectedCellKeys = new Set(cellStats.map((cell) => `${cell.dormId}:${cell.date}`));
      const overridesAfterClear = overrides.filter((override) => !(override.channelId == null && selectedCellKeys.has(`${override.dormId}:${override.date}`)));

      if (preview === true) {
        const current = summarizeAvailability(cellStats.map((cell) => cell.stats));
        const afterStats = mode === "clear"
          ? cellStats.map(({ dormId, date }) => computeNightAvailability(
            dormId,
            date,
            bedRows,
            blocks,
            assignments,
            overridesAfterClear,
            unassignedOtaOnNight(holds, dormId, date),
          ))
          : hasValidRequestedValue
            ? cellStats.map((cell) => ({ ...cell.stats, ...overridePreview(cell.stats, requestedValue) }))
            : cellStats.map((cell) => cell.stats);
        const currentByDorm = new Map<number, typeof cellStats[number]["stats"][]>();
        const afterByDorm = new Map<number, typeof afterStats[number][]>();
        cellStats.forEach((cell, index) => {
          const currentCells = currentByDorm.get(cell.dormId) ?? [];
          currentCells.push(cell.stats);
          currentByDorm.set(cell.dormId, currentCells);
          const afterCells = afterByDorm.get(cell.dormId) ?? [];
          afterCells.push(afterStats[index]);
          afterByDorm.set(cell.dormId, afterCells);
        });
        const byRoom = dormIds.map((dormId) => ({
          dormId,
          name: dormNameById.get(dormId) ?? `Room ${dormId}`,
          current: summarizeAvailability(currentByDorm.get(dormId) ?? []),
          after: summarizeAvailability(afterByDorm.get(dormId) ?? []),
        }));
        return NextResponse.json({
          success: true,
          preview: true,
          selected: { rooms: dormIds.length, nights: filteredDates.length, roomNights: cellStats.length },
          current,
          after: summarizeAvailability(afterStats),
          byRoom,
          capped: mode === "set" && hasValidRequestedValue
            ? cellStats.filter((cell) => requestedValue > cell.stats.available).length
            : 0,
          requestedOnline: mode === "set" && hasValidRequestedValue ? requestedValue : null,
        });
      }

      try {
        const overrideRows = dormIds.flatMap((dormId) => filteredDates.map((date) => {
          const stats = statsByCell.get(`${dormId}:${date}`);
          if (!stats) throw new Error("Availability snapshot mismatch");
          return {
            dormId,
            date,
            onlineAvailable: mode === "set" ? overrideCeilingToSave(stats, requestedValue) : null,
            overriddenBy: actingUser,
          };
        }));
        const committedRows = await bulkReplaceInventoryOverrides(overrideRows, mode);
        for (const row of overrideRows.slice(0, committedRows)) {
          const stats = statsByCell.get(`${row.dormId}:${row.date}`);
          applied.push({ dormId: row.dormId, date: row.date, capped: mode === "set" && requestedValue > (stats?.available ?? 0) });
        }
      } catch (error: any) {
        const committedRows = Number(error?.committedRows) || 0;
        if (committedRows > applied.length) {
          for (const row of dormIds.flatMap((dormId) => filteredDates.map((date) => ({ dormId, date }))).slice(applied.length, committedRows)) {
            const stats = statsByCell.get(`${row.dormId}:${row.date}`);
            applied.push({ dormId: row.dormId, date: row.date, capped: mode === "set" && requestedValue > (stats?.available ?? 0) });
          }
        }
        const partialDates = [...new Set(applied.map((item) => item.date))];
        const partialDormIds = [...new Set(applied.map((item) => item.dormId))];
        const sync = partialDates.length > 0
          ? await triggerInventoryPush(partialDates, partialDormIds).catch(() => undefined)
          : undefined;
        await recordBulkAvailabilityAudit(actingUser, mode, dormIds, filteredDates, normalizedDayFilter, requestedValue, applied, sync, true, dormNameById);
        return NextResponse.json({
          success: false,
          partial: applied.length > 0,
          updated: mode === "set" ? applied.length : 0,
          cleared: mode === "clear" ? applied.length : 0,
          capped: applied.filter((item) => item.capped).length,
          error: error?.message || "Bulk availability update failed",
          sync,
        }, { status: 500 });
      }

      const affectedDates = [...new Set(applied.map((item) => item.date))];
      const affectedDormIds = [...new Set(applied.map((item) => item.dormId))];
      for (const dormId of affectedDormIds.filter((id) => mappedDormIds.has(id))) {
        await markInventoryDirty(dormId, affectedDates).catch(() => {});
      }
      const sync = requireSyncResult(await triggerInventoryPush(affectedDates, affectedDormIds));
      await recordBulkAvailabilityAudit(actingUser, mode, dormIds, filteredDates, normalizedDayFilter, requestedValue, applied, sync, false, dormNameById);

      return NextResponse.json({
        success: true,
        updated: mode === "set" ? applied.length : 0,
        cleared: mode === "clear" ? applied.length : 0,
        capped: applied.filter((item) => item.capped).length,
        unmappedDormIds,
        sync,
        syncScope: { dates: affectedDates, dormIds: affectedDormIds },
      });
    }

    if (action === "getChannelRates") {
      const { ratePlanId, channelId, startDate, endDate } = params;
      if (!ratePlanId || !channelId || !startDate || !endDate) return NextResponse.json({ error: "ratePlanId, channelId, startDate, endDate required" }, { status: 400 });
      const data = await getChannelRatesForRange(ratePlanId, channelId, startDate, endDate);
      return NextResponse.json({ rates: data });
    }

    if (action === "updateChannelRate") {
      const { ratePlanId, channelId, date, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate } = params;
      if (!ratePlanId || !channelId || !date) return NextResponse.json({ error: "ratePlanId, channelId, date required" }, { status: 400 });
      await upsertChannelRate({ ratePlanId, channelId, date, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate, updatedBy: actingUser });
      await recordInventoryAudit(actingUser, "CHANNEL_RATE_UPDATED", `ratePlan:${ratePlanId} ${date}`, { channelId, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate });
      return NextResponse.json({ success: true });
    }

    if (action === "updateRate") {
      const { ratePlanId, date, rate, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate, stopSell, minimumStay, maximumStay, closeOnArrival, closeOnDeparture } = params;
      if (!ratePlanId || !date) return NextResponse.json({ error: "ratePlanId and date required" }, { status: 400 });
      const existing = (await getDailyRates(ratePlanId, date, date))[0];
      await upsertDailyRate({
        ratePlanId, date,
        rate: rate ?? existing?.rate ?? 0,
        adult1Rate: adult1Rate !== undefined ? adult1Rate : (existing?.adult1Rate ?? null),
        adult2Rate: adult2Rate !== undefined ? adult2Rate : (existing?.adult2Rate ?? null),
        childRate: childRate !== undefined ? childRate : (existing?.childRate ?? null),
        infantRate: infantRate !== undefined ? infantRate : (existing?.infantRate ?? null),
        extraPersonRate: extraPersonRate !== undefined ? extraPersonRate : (existing?.extraPersonRate ?? null),
        stopSell: stopSell !== undefined ? stopSell : (existing?.stopSell ?? 0),
        minimumStay: minimumStay !== undefined ? minimumStay : (existing?.minimumStay ?? 1),
        maximumStay: maximumStay !== undefined ? maximumStay : (existing?.maximumStay ?? null),
        closeOnArrival: closeOnArrival !== undefined ? closeOnArrival : (existing?.closeOnArrival ?? 0),
        closeOnDeparture: closeOnDeparture !== undefined ? closeOnDeparture : (existing?.closeOnDeparture ?? 0),
        updatedBy: actingUser,
      });
      await triggerRatePush([date], [ratePlanId]).catch(() => {});
      await recordInventoryAudit(actingUser, "RATE_UPDATED", `ratePlan:${ratePlanId} ${date}`, { rate: rate ?? existing?.rate ?? 0, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate, stopSell, minimumStay, maximumStay, closeOnArrival, closeOnDeparture });
      return NextResponse.json({ success: true });
    }

    if (action === "bulkSetRates") {
      const { ratePlanId, ratePlanIds, dates, dayFilter, channelId, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate, rate } = params;
      const ids: number[] = ratePlanIds?.length ? ratePlanIds : (ratePlanId ? [ratePlanId] : []);
      if (!ids.length || !dates?.length) return NextResponse.json({ error: "ratePlanIds and dates required" }, { status: 400 });
      const filteredDates = filterByDays(dates, dayFilter);
      let count = 0;
      for (const rpId of ids) {
        const existingRates = !channelId && filteredDates.length > 0 ? await getDailyRates(rpId, filteredDates[0], filteredDates[filteredDates.length - 1]) : [];
        const existingByDate = new Map(existingRates.map((r: any) => [r.date, r]));
        for (const date of filteredDates) {
          if (channelId) {
            await upsertChannelRate({ ratePlanId: rpId, channelId, date, adult1Rate, adult2Rate, childRate, infantRate, extraPersonRate, updatedBy: actingUser });
          } else {
            const existing = existingByDate.get(date);
            await upsertDailyRate({
              ratePlanId: rpId, date,
              rate: rate ?? adult1Rate ?? 0,
              adult1Rate: adult1Rate ?? existing?.adult1Rate ?? null,
              adult2Rate: adult2Rate ?? existing?.adult2Rate ?? null,
              childRate: childRate ?? existing?.childRate ?? null,
              infantRate: infantRate ?? existing?.infantRate ?? null,
              extraPersonRate: extraPersonRate ?? existing?.extraPersonRate ?? null,
              stopSell: existing?.stopSell ?? 0,
              minimumStay: existing?.minimumStay ?? 1,
              maximumStay: existing?.maximumStay ?? null,
              closeOnArrival: existing?.closeOnArrival ?? 0,
              closeOnDeparture: existing?.closeOnDeparture ?? 0,
              minimumAdvanceReservation: existing?.minimumAdvanceReservation ?? null,
              maximumAdvanceReservation: existing?.maximumAdvanceReservation ?? null,
              updatedBy: actingUser,
            });
          }
          count++;
        }
      }
      // Channel-only rates live in channel_rates; triggerRatePush reads daily_rates.
      const sync = channelId
        ? { attempted: false, accepted: true, message: "Channel-only rate saved locally; no PMS push required" }
        : requireSyncResult(await triggerRatePush(filteredDates, ids));
      await recordInventoryAudit(actingUser, "RATES_BULK_UPDATED", `ratePlans:${ids.join(",")}`, {
        channelId: channelId || null,
        dates: filteredDates,
        updated: count,
        dayFilter: dayFilter || null,
        values: { rate: rate ?? null, adult1Rate: adult1Rate ?? null, adult2Rate: adult2Rate ?? null, childRate: childRate ?? null, infantRate: infantRate ?? null, extraPersonRate: extraPersonRate ?? null },
        sync: sync ? { attempted: sync.attempted, accepted: sync.accepted, message: sync.message } : null,
      });
      return NextResponse.json({ success: true, updated: count, sync, syncScope: { dates: filteredDates, ratePlanIds: ids } });
    }

    if (action === "bulkAdjustRates") {
      const { ratePlanIds, startDate, endDate, dayFilter, channelId, direction, value, type } = params;
      if (!ratePlanIds?.length || !startDate || !endDate || value == null) return NextResponse.json({ error: "ratePlanIds, dates, value required" }, { status: 400 });
      const allDates = generateDateRange(startDate, endDate);
      const filteredDates = filterByDays(allDates, dayFilter);
      let count = 0;
      for (const rpId of ratePlanIds) {
        const existingRates = await getDailyRates(rpId, startDate, endDate);
        for (const date of filteredDates) {
          const existing = existingRates.find((r) => r.date === date);
          if (!existing) continue;
          const currentRate = existing.rate;
          let newRate: number;
          if (type === "percentage") {
            const delta = Math.round(currentRate * (value / 100));
            newRate = direction === "increase" ? currentRate + delta : currentRate - delta;
          } else {
            newRate = direction === "increase" ? currentRate + value : currentRate - value;
          }
          newRate = Math.max(0, newRate);
          const adjustAmount = (val: number | null): number | null => {
            if (val == null) return null;
            if (type === "percentage") {
              const delta = Math.round(val * (value / 100));
              return Math.max(0, direction === "increase" ? val + delta : val - delta);
            }
            return Math.max(0, direction === "increase" ? val + value : val - value);
          };
          await upsertDailyRate({
            ratePlanId: rpId, date, rate: newRate, updatedBy: actingUser,
            stopSell: existing.stopSell,
            minimumStay: existing.minimumStay,
            maximumStay: existing.maximumStay,
            closeOnArrival: existing.closeOnArrival,
            closeOnDeparture: existing.closeOnDeparture,
            minimumAdvanceReservation: existing.minimumAdvanceReservation,
            maximumAdvanceReservation: existing.maximumAdvanceReservation,
            adult1Rate: adjustAmount(existing.adult1Rate),
            adult2Rate: adjustAmount(existing.adult2Rate),
            childRate: existing.childRate,
            infantRate: existing.infantRate,
            extraPersonRate: existing.extraPersonRate,
          });
          count++;
        }
      }
      const sync = requireSyncResult(await triggerRatePush(filteredDates, ratePlanIds));
      await recordInventoryAudit(actingUser, "RATES_BULK_ADJUSTED", `ratePlans:${ratePlanIds.join(",")}`, {
        startDate, endDate, dates: filteredDates, dayFilter: dayFilter || null, direction, value, type, updated: count,
        sync: sync ? { attempted: sync.attempted, accepted: sync.accepted, message: sync.message } : null,
      });
      return NextResponse.json({ success: true, updated: count, sync, syncScope: { dates: filteredDates, ratePlanIds } });
    }

    if (action === "bulkSetRestrictions") {
      const { ratePlanIds, startDate, endDate, dayFilter, restrictionType, value } = params;
      if (!ratePlanIds?.length || !startDate || !endDate || !restrictionType) return NextResponse.json({ error: "ratePlanIds, dates, restrictionType required" }, { status: 400 });
      const patch = restrictionPatch(restrictionType, value);
      if (!patch) return NextResponse.json({ error: `Unknown restrictionType: ${restrictionType}` }, { status: 400 });
      if (restrictionType === "minimumStay" && (patch.minimumStay == null || patch.minimumStay < 1)) {
        return NextResponse.json({ error: "minimumStay must be a number ≥ 1" }, { status: 400 });
      }
      const allDates = generateDateRange(startDate, endDate);
      const filteredDates = filterByDays(allDates, dayFilter);
      let count = 0;
      for (const rpId of ratePlanIds) {
        const existingRates = await getDailyRates(rpId, startDate, endDate);
        const ratesByDate = new Map(existingRates.map((r: any) => [r.date, r]));
        for (const date of filteredDates) {
          const existing = ratesByDate.get(date);
          const updateData: any = {
            ratePlanId: rpId, date, updatedBy: actingUser,
            rate: existing?.rate ?? 0,
            stopSell: existing?.stopSell ?? 0,
            minimumStay: existing?.minimumStay ?? 1,
            maximumStay: existing?.maximumStay ?? null,
            closeOnArrival: existing?.closeOnArrival ?? 0,
            closeOnDeparture: existing?.closeOnDeparture ?? 0,
            minimumAdvanceReservation: existing?.minimumAdvanceReservation ?? null,
            maximumAdvanceReservation: existing?.maximumAdvanceReservation ?? null,
            adult1Rate: existing?.adult1Rate ?? null,
            adult2Rate: existing?.adult2Rate ?? null,
            childRate: existing?.childRate ?? null,
            infantRate: existing?.infantRate ?? null,
            extraPersonRate: existing?.extraPersonRate ?? null,
          };
          if (patch.stopSell !== undefined) updateData.stopSell = patch.stopSell ? 1 : 0;
          if (patch.closeOnArrival !== undefined) updateData.closeOnArrival = patch.closeOnArrival ? 1 : 0;
          if (patch.closeOnDeparture !== undefined) updateData.closeOnDeparture = patch.closeOnDeparture ? 1 : 0;
          if (patch.minimumStay !== undefined) updateData.minimumStay = patch.minimumStay;
          if (patch.maximumStay !== undefined) updateData.maximumStay = patch.maximumStay;
          if (patch.minimumAdvanceReservation !== undefined) updateData.minimumAdvanceReservation = patch.minimumAdvanceReservation;
          if (patch.maximumAdvanceReservation !== undefined) updateData.maximumAdvanceReservation = patch.maximumAdvanceReservation;
          await upsertDailyRate(updateData);
          count++;
        }
      }
      const sync = requireSyncResult(await triggerRestrictionPush(filteredDates, ratePlanIds, patch));
      await recordInventoryAudit(actingUser, "RESTRICTIONS_BULK_UPDATED", `ratePlans:${ratePlanIds.join(",")}`, {
        startDate, endDate, dates: filteredDates, dayFilter: dayFilter || null, restrictionType, value, updated: count, patch,
        sync: sync ? { attempted: sync.attempted, accepted: sync.accepted, message: sync.message } : null,
      });
      return NextResponse.json({ success: true, updated: count, sync, syncScope: { dates: filteredDates, ratePlanIds, patch } });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error("Inventory API error:", error?.message);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}

function generateDateRange(startDate: string, endDate: string): string[] {
  return inclusiveNights(startDate, endDate);
}

function filterByDays(dates: string[], dayFilter?: number[]): string[] {
  if (!dayFilter || dayFilter.length === 0 || dayFilter.length === 7) return dates;
  return dates.filter((d) => dayFilter.includes(civilWeekday(d)));
}

function validInventoryDateRange(startDate: string, endDate: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(startDate) || !iso.test(endDate) || startDate > endDate || startDate < todayIST()) return false;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf())
    && start.toISOString().slice(0, 10) === startDate
    && end.toISOString().slice(0, 10) === endDate;
}

async function recordBulkAvailabilityAudit(
  username: string,
  mode: "set" | "clear",
  dormIds: number[],
  dates: string[],
  dayFilter: number[] | undefined,
  requestedValue: number,
  applied: Array<{ dormId: number; date: string; capped: boolean }>,
  sync: { attempted: boolean; accepted: boolean; queued?: boolean; message?: string } | void,
  partial: boolean,
  dormNameById: Map<number, string>,
) {
  await Promise.resolve(addAuditEntry({
    username,
    action: "INVENTORY_AVAILABILITY_BULK_UPDATED",
    target: dormIds.join(","),
    details: JSON.stringify({
      mode,
      dormIds,
      dormNames: dormIds.map((id) => dormNameById.get(id) || `Dorm ${id}`),
      startDate: dates[0] || null,
      endDate: dates[dates.length - 1] || null,
      dateCount: dates.length,
      dayFilter,
      cellCount: dormIds.length * dates.length,
      applied: applied.length,
      capped: applied.filter((item) => item.capped).length,
      requestedValue: mode === "set" ? requestedValue : undefined,
      partial,
      sync: sync ? { attempted: sync.attempted, accepted: sync.accepted, queued: sync.queued ?? false, message: sync.message } : null,
    }),
  })).catch(() => {});
}

async function recordInventoryAudit(username: string, action: string, target: string, details?: Record<string, unknown>) {
  await Promise.resolve(addAuditEntry({
    username,
    action,
    target,
    details: details ? JSON.stringify(details) : "",
  })).catch(() => {});
}
