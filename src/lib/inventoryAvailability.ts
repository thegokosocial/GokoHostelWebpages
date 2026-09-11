export type InventoryPool = "online" | "offline" | "block";

export type NightAvailability = {
  total: number;
  blocked: number;
  assigned: number;
  onlineAssigned: number;
  unassignedOta: number;
  available: number;
  online: number;
  offline: number;
  overridden: boolean;
};

export type AvailabilitySummary = {
  roomNights: number;
  total: number;
  blocked: number;
  assigned: number;
  unassignedOta: number;
  available: number;
  online: number;
  offline: number;
};

/** Add room/bed-unit counts across the selected room-night cells. */
export function summarizeAvailability(snapshots: NightAvailability[]): AvailabilitySummary {
  return snapshots.reduce((summary, snapshot) => ({
    roomNights: summary.roomNights + 1,
    total: summary.total + snapshot.total,
    blocked: summary.blocked + snapshot.blocked,
    assigned: summary.assigned + snapshot.assigned,
    unassignedOta: summary.unassignedOta + snapshot.unassignedOta,
    available: summary.available + snapshot.available,
    online: summary.online + snapshot.online,
    offline: summary.offline + snapshot.offline,
  }), {
    roomNights: 0,
    total: 0,
    blocked: 0,
    assigned: 0,
    unassignedOta: 0,
    available: 0,
    online: 0,
    offline: 0,
  });
}

/** Beds already counting against the OTA ceiling (assigned online + unassigned channel_manager rooms). */
export function heldOnline(snap: Pick<NightAvailability, "onlineAssigned" | "unassignedOta">): number {
  return Math.max(0, snap.onlineAssigned) + Math.max(0, snap.unassignedOta);
}

/** Override modal input — same remaining the grid cell shows as the OTA side of OTA/walk-in. */
export function overrideRemainingInput(snap: NightAvailability, storedCeiling: number | null | undefined): string {
  if (storedCeiling == null) return "";
  return String(remainingSplit(snap.available, storedCeiling, heldOnline(snap)).online);
}

/** Live preview while typing. Empty/invalid keeps the grid snapshot so inside matches outside. */
export function overridePreview(snap: NightAvailability, typedRemaining: number): { online: number; offline: number } {
  if (!Number.isFinite(typedRemaining)) return { online: snap.online, offline: snap.offline };
  return splitAvailable(snap.available, typedRemaining);
}

/** Persist typed remaining as a ceiling that still subtracts assigned + unassigned OTA. */
export function overrideCeilingToSave(snap: NightAvailability, typedRemaining: number): number {
  return ceilingFromRemaining(Math.min(snap.available, Math.max(0, typedRemaining)), heldOnline(snap));
}

export type InventoryBedRef = { id?: number; dormId: number; bedId?: string; type?: string | null };
type BedRef = InventoryBedRef;
type BlockRef = { bedId: number; dormId: number; startDate: string; endDate: string };
type AssignmentRef = {
  bedId?: number;
  dormId: number;
  checkinDate: string;
  checkoutDate: string;
  status?: string;
  inventoryPool?: string | null;
};

export type SellableUnit<T extends InventoryBedRef = InventoryBedRef> = {
  key: string;
  dormId: number;
  label: string;
  type: "Double" | "Bed";
  capacity: number;
  beds: T[];
};

/** Physical guest slots grouped into the units customers can actually buy. */
export function sellableUnits<T extends InventoryBedRef>(beds: T[]): SellableUnit<T>[] {
  const out: SellableUnit<T>[] = [];
  const byDorm = new Map<number, T[]>();
  for (const bed of beds) {
    const list = byDorm.get(bed.dormId) ?? [];
    list.push(bed);
    byDorm.set(bed.dormId, list);
  }
  for (const [dormId, dormBeds] of byDorm) {
    const doubles = dormBeds
      .filter((b) => b.type === "Double")
      .sort((a, b) => (a.bedId || "").localeCompare(b.bedId || "", undefined, { numeric: true }) || (a.id || 0) - (b.id || 0));
    for (let i = 0; i < doubles.length; i += 2) {
      const pair = doubles.slice(i, i + 2);
      out.push({ key: `${dormId}:double:${i / 2 + 1}`, dormId, label: `DOUBLE ${i / 2 + 1}`, type: "Double", capacity: 2, beds: pair });
    }
    for (const bed of dormBeds.filter((b) => b.type !== "Double")) {
      out.push({ key: `${dormId}:bed:${bed.id ?? bed.bedId}`, dormId, label: bed.bedId || `Bed ${bed.id}`, type: "Bed", capacity: 1, beds: [bed] });
    }
  }
  return out;
}

export function unitForBed<T extends InventoryBedRef>(beds: T[], bedId: number): SellableUnit<T> | undefined {
  return sellableUnits(beds).find((u) => u.beds.some((b) => b.id === bedId));
}
type OverrideRef = { dormId: number; date: string; onlineAvailable: number | null; channelId?: number | null };

/** Occupied nights for a stay: [checkin, checkout). IST calendar dates. */
export function stayNights(checkinDate: string, checkoutDate: string): string[] {
  const dates: string[] = [];
  let current = checkinDate;
  while (current < checkoutDate) {
    dates.push(current);
    current = addCalendarDays(current, 1);
  }
  return dates;
}

/** Occupied nights, treating missing/equal checkout as a single night. */
export function occupiedNights(checkinDate: string, checkoutDate?: string | null): string[] {
  if (!checkinDate) return [];
  if (checkoutDate && checkoutDate > checkinDate) return stayNights(checkinDate, checkoutDate);
  return stayNights(checkinDate, addCalendarDays(checkinDate, 1));
}

/** Night count for a stay. Timezone-independent. */
export function stayNightCount(checkinDate: string, checkoutDate?: string | null): number {
  return occupiedNights(checkinDate, checkoutDate).length;
}

/** Exclusive end date for a stay/block. Missing or equal end → one night (start + 1). */
export function exclusiveEndDate(startDate: string, endDate?: string | null): string | null {
  if (!startDate) return null;
  if (endDate && endDate < startDate) return null;
  if (endDate && endDate > startDate) return endDate;
  return addCalendarDays(startDate, 1);
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && endA > startB;
}

export function addCalendarDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/** Inclusive bulk nights (Set Rates / Restrictions). 1 Sep–2 Sep → both nights. */
export function inclusiveNights(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || endDate < startDate) return [];
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addCalendarDays(current, 1);
  }
  return dates;
}

/** Weekday of a YYYY-MM-DD civil date (0=Sun). Timezone-independent. */
export function civilWeekday(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/**
 * Bulk inventory start/end are inclusive nights (same as Set Rates).
 * Convert last included night → exclusive end used by blocks and stayNights.
 * 1 Sep–2 Sep → exclusive end 3 Sep → nights [1 Sep, 2 Sep].
 */
export function exclusiveEndFromInclusive(startDate: string, inclusiveEnd?: string | null): string | null {
  if (!startDate || !inclusiveEnd || inclusiveEnd < startDate) return null;
  return addCalendarDays(inclusiveEnd, 1);
}

/**
 * Beds that can take a new calendar block for [startDate, endDate).
 * Occupied (assigned) and already-blocked beds are excluded — unlike New Booking,
 * which also offers blocked beds so a guest can take one.
 */
export function bedsFreeToBlock<T extends { id: number }>(
  beds: T[],
  startDate: string,
  endDate: string,
  assignments: { bedId: number; checkinDate: string; checkoutDate: string; status?: string }[],
  blocks: { bedId: number; startDate: string; endDate: string }[],
): T[] {
  if (!startDate || !endDate || startDate >= endDate) return [];
  const occupied = new Set(
    assignments
      .filter((a) => (a.status ?? "assigned") === "assigned" && rangesOverlap(a.checkinDate, a.checkoutDate, startDate, endDate))
      .map((a) => a.bedId),
  );
  const blocked = new Set(
    blocks.filter((b) => rangesOverlap(b.startDate, b.endDate, startDate, endDate)).map((b) => b.bedId),
  );
  return beds.filter((b) => !occupied.has(b.id) && !blocked.has(b.id));
}

/** Staff override, or the unblocked dorm — blocked beds are not for sale on OTA. */
export function otaCeiling(total: number, blocked: number, stored?: number | null): number {
  if (stored != null) return stored;
  return Math.max(0, total - blocked);
}

/** Remaining OTA vs walk-in given physical leftover, OTA ceiling, and beds already counted as online. */
export function remainingSplit(available: number, ceiling: number, onlineAssigned: number): { online: number; offline: number } {
  const online = Math.min(available, Math.max(0, ceiling - onlineAssigned));
  return { online, offline: Math.max(0, available - online) };
}

/** Rooms an unassigned channel_manager booking holds on the given Aiosell codes (not persons). */
export function countUnassignedOtaRooms(
  channelRoomCodes: string[],
  bookings: Array<{ roomType?: string | null; rawData?: string | null }>,
): number {
  const codes = new Set(
    channelRoomCodes.map((c) => (c || "").trim().toLowerCase()).filter(Boolean),
  );
  if (codes.size === 0) return 0;
  let n = 0;
  for (const b of bookings) {
    try {
      const raw = JSON.parse(b.rawData || "null") as { rooms?: Array<{ roomCode?: string }> } | null;
      const rooms = raw?.rooms;
      if (Array.isArray(rooms) && rooms.length > 0) {
        n += rooms.filter((r) => r?.roomCode && codes.has(r.roomCode.trim().toLowerCase())).length;
        continue;
      }
    } catch { /* roomType fallback */ }
    for (const part of (b.roomType || "").split(",")) {
      if (codes.has(part.trim().toLowerCase())) n += 1;
    }
  }
  return n;
}

export type UnassignedOtaHold = { dormId: number; date: string; rooms: number };

export function unassignedOtaOnNight(holds: UnassignedOtaHold[] | undefined, dormId: number, date: string): number {
  if (!holds?.length) return 0;
  let n = 0;
  for (const h of holds) {
    if (h.dormId === dormId && h.date === date) n += h.rooms;
  }
  return n;
}

/** Spread unassigned CM bookings onto mapped dorms for nights in [startDate, endExclusive). */
export function explodeUnassignedOtaHolds(
  rows: Array<{
    id?: number;
    checkinDate: string;
    checkoutDate?: string | null;
    roomType?: string | null;
    rawData?: string | null;
  }>,
  mappings: Array<{ dormId: number; channelRoomCode: string }>,
  startDate: string,
  endExclusive: string,
  excludeBookingId?: number,
): UnassignedOtaHold[] {
  if (!startDate || !endExclusive || startDate >= endExclusive || mappings.length === 0) return [];
  const byKey = new Map<string, number>();
  for (const row of rows) {
    if (excludeBookingId && row.id === excludeBookingId) continue;
    for (const date of occupiedNights(row.checkinDate, row.checkoutDate)) {
      if (date < startDate || date >= endExclusive) continue;
      for (const m of mappings) {
        const rooms = countUnassignedOtaRooms([m.channelRoomCode], [row]);
        if (!rooms) continue;
        const key = `${m.dormId}:${date}`;
        byKey.set(key, (byKey.get(key) || 0) + rooms);
      }
    }
  }
  return [...byKey.entries()].map(([key, rooms]) => {
    const colon = key.indexOf(":");
    return { dormId: Number(key.slice(0, colon)), date: key.slice(colon + 1), rooms };
  });
}

/**
 * Split currently available beds (booked + blocked already excluded).
 * `onlineRemaining` is what staff type: how many of the leftover beds go to OTA.
 */
export function splitAvailable(available: number, onlineRemaining: number): { online: number; offline: number } {
  const online = Math.min(available, Math.max(0, onlineRemaining));
  return { online, offline: Math.max(0, available - online) };
}

/** Persist remaining-among-available as a ceiling so PMS still subtracts later OTA assignments. */
export function ceilingFromRemaining(onlineRemaining: number, onlineAssigned: number): number {
  return Math.max(0, onlineRemaining) + Math.max(0, onlineAssigned);
}

export function pickInventoryOverride<T extends { dormId: number; date: string; channelId?: number | null }>(
  overrides: T[],
  dormId: number,
  date: string,
): T | null {
  const matches = overrides.filter((o) => o.dormId === dormId && o.date === date);
  return matches.find((o) => o.channelId == null) ?? matches[0] ?? null;
}

export function assignmentPool(pool?: string | null): InventoryPool {
  if (pool === "offline" || pool === "block") return pool;
  return "online";
}

export function computeNightAvailability(
  dormId: number,
  date: string,
  beds: BedRef[],
  blocks: BlockRef[],
  assignments: AssignmentRef[],
  overrides: OverrideRef[],
  unassignedOta = 0,
): NightAvailability {
  const units = sellableUnits(beds.filter((b) => b.dormId === dormId));
  const total = units.length;
  const blockedIds = new Set(blocks.filter((bl) => bl.dormId === dormId && bl.startDate <= date && bl.endDate > date).map((bl) => bl.bedId));
  const blocked = units.filter((u) => u.beds.some((b) => b.id != null && blockedIds.has(b.id))).length;
  const nightAssigns = assignments.filter(
    (a) => a.dormId === dormId && (a.status ?? "assigned") === "assigned" && a.checkinDate <= date && a.checkoutDate > date,
  );
  const assignedUnits = new Set(nightAssigns.map((a) => a.bedId == null ? `row:${nightAssigns.indexOf(a)}` : unitForBed(beds, a.bedId)?.key || `bed:${a.bedId}`));
  const onlineUnits = new Set(nightAssigns.filter((a) => assignmentPool(a.inventoryPool) === "online").map((a) => a.bedId == null ? `row:${nightAssigns.indexOf(a)}` : unitForBed(beds, a.bedId)?.key || `bed:${a.bedId}`));
  const assigned = assignedUnits.size;
  const onlineAssigned = onlineUnits.size;
  const available = Math.max(0, total - blocked - assigned - Math.max(0, unassignedOta));
  const override = pickInventoryOverride(overrides, dormId, date);
  const ceiling = otaCeiling(total, blocked, override?.onlineAvailable);
  const { online, offline } = remainingSplit(available, ceiling, onlineAssigned + unassignedOta);
  return {
    total,
    blocked,
    assigned,
    onlineAssigned,
    unassignedOta,
    available,
    online,
    offline,
    overridden: override?.onlineAvailable != null,
  };
}

/** Remaining OTA/PMS slots for a night (what we push to Aiosell). */
export function inventoryAvailableForNight(
  dormId: number,
  date: string,
  beds: BedRef[],
  blocks: BlockRef[],
  assignments: AssignmentRef[],
  overrides: OverrideRef[],
  unassignedOta = 0,
): number {
  return computeNightAvailability(dormId, date, beds, blocks, assignments, overrides, unassignedOta).online;
}

export function minPoolForStay(
  dormId: number,
  nights: string[],
  beds: BedRef[],
  blocks: BlockRef[],
  assignments: AssignmentRef[],
  overrides: OverrideRef[],
  unassignedHolds?: UnassignedOtaHold[],
): { online: number; offline: number } {
  if (nights.length === 0) {
    const n = computeNightAvailability(dormId, "", beds, [], [], []);
    return { online: n.online, offline: n.offline };
  }
  let online = Infinity;
  let offline = Infinity;
  for (const night of nights) {
    const s = computeNightAvailability(
      dormId, night, beds, blocks, assignments, overrides,
      unassignedOtaOnNight(unassignedHolds, dormId, night),
    );
    online = Math.min(online, s.online);
    offline = Math.min(offline, s.offline);
  }
  return { online: online === Infinity ? 0 : online, offline: offline === Infinity ? 0 : offline };
}

export function tagBedsForPicker<T extends { id: number; dormId: number; bedId: string }>(
  physicalBeds: T[],
  blockedBeds: T[],
  allBeds: BedRef[],
  nights: string[],
  blocks: BlockRef[],
  assignments: AssignmentRef[],
  overrides: OverrideRef[],
  unassignedHolds?: UnassignedOtaHold[],
): Array<T & { pool: InventoryPool }> {
  const freeByDorm = new Map<number, T[]>();
  for (const bed of physicalBeds) {
    const list = freeByDorm.get(bed.dormId) ?? [];
    list.push(bed);
    freeByDorm.set(bed.dormId, list);
  }
  const blockedByDorm = new Map<number, T[]>();
  for (const bed of blockedBeds) {
    const list = blockedByDorm.get(bed.dormId) ?? [];
    list.push(bed);
    blockedByDorm.set(bed.dormId, list);
  }
  const dormIds = new Set([...freeByDorm.keys(), ...blockedByDorm.keys()]);
  const out: Array<T & { pool: InventoryPool }> = [];
  for (const dormId of dormIds) {
    const slots = minPoolForStay(dormId, nights, allBeds, blocks, assignments, overrides, unassignedHolds);
    const freeIds = new Set((freeByDorm.get(dormId) ?? []).map((b) => b.id));
    const blockedIds = new Set((blockedByDorm.get(dormId) ?? []).map((b) => b.id));
    const units = sellableUnits((allBeds as T[]).filter((b) => b.dormId === dormId));
    const freeUnits = units.filter((u) => u.beds.every((b) => freeIds.has(b.id)));
    const blockedUnits = units.filter((u) => u.beds.some((b) => blockedIds.has(b.id)));
    // Pools are counted in sellable rooms. Every internal slot inherits its unit's pool.
    freeUnits.forEach((unit, i) => {
      const pool = i < slots.online ? "online" : i < slots.online + slots.offline ? "offline" : null;
      if (pool) unit.beds.forEach((bed) => out.push({ ...bed, pool }));
    });
    blockedUnits.forEach((unit) => unit.beds.forEach((bed) => out.push({ ...bed, pool: "block" })));
  }
  return out;
}

export function bedsFitInventoryCap(
  requested: { id: number }[],
  taggedIds: Set<number>,
): string | null {
  if (requested.some((b) => !taggedIds.has(b.id))) {
    return "One or more beds are not available for these dates";
  }
  return null;
}

export function shouldPushPms(
  pools: InventoryPool[],
  before?: Pick<NightAvailability, "online">,
  after?: Pick<NightAvailability, "online">,
): boolean {
  if (pools.some((p) => p === "online")) return true;
  if (before && after && before.online !== after.online) return true;
  return false;
}

/** Simulate booking N beds from a pool and return the next night snapshot. */
export function applyBookingToNight(
  snap: NightAvailability,
  pool: InventoryPool,
  count = 1,
): NightAvailability {
  if (pool === "block") {
    return {
      ...snap,
      blocked: Math.max(0, snap.blocked - count),
      assigned: snap.assigned + count,
    };
  }
  const assigned = snap.assigned + count;
  const available = Math.max(0, snap.available - count);
  const onlineAssigned = snap.onlineAssigned + (pool === "online" ? count : 0);
  const online = Math.min(available, pool === "online" ? Math.max(0, snap.online - count) : snap.online);
  const offline = Math.max(0, available - online);
  return { ...snap, assigned, onlineAssigned, available, online, offline };
}

export type CalendarNightStatus = InventoryPool | "occupied" | "held";
export type CalendarAvailability = {
  beds: Record<number, Record<string, CalendarNightStatus>>;
  dorms: Record<number, Record<string, NightAvailability>>;
};

/** Nightly view of the same sellable units and pools used by the booking picker. */
export function calendarAvailability(
  beds: (BedRef & { id: number; bedId: string })[],
  nights: string[], blocks: BlockRef[], assignments: AssignmentRef[],
  overrides: OverrideRef[], holds: UnassignedOtaHold[],
): CalendarAvailability {
  const result: CalendarAvailability = { beds: {}, dorms: {} };
  const units = sellableUnits(beds);
  for (const unit of units) result.beds[unit.beds[0].id] = {};
  for (const night of nights) {
    const occupiedIds = new Set(assignments.filter((a) => (a.status ?? "assigned") === "assigned" && a.checkinDate <= night && a.checkoutDate > night).map((a) => a.bedId));
    const blockedIds = new Set(blocks.filter((b) => b.startDate <= night && b.endDate > night).map((b) => b.bedId));
    const free = units.filter((u) => !u.beds.some((b) => occupiedIds.has(b.id) || blockedIds.has(b.id))).flatMap((u) => u.beds);
    const blocked = units.filter((u) => !u.beds.some((b) => occupiedIds.has(b.id)) && u.beds.some((b) => blockedIds.has(b.id))).flatMap((u) => u.beds);
    const tagged = new Map(tagBedsForPicker(free, blocked, beds, [night], blocks, assignments, overrides, holds).map((b) => [b.id, b.pool]));
    for (const unit of units) {
      result.beds[unit.beds[0].id][night] = unit.beds.some((b) => occupiedIds.has(b.id)) ? "occupied" : tagged.get(unit.beds[0].id) ?? "held";
    }
    for (const dormId of new Set(beds.map((b) => b.dormId))) {
      result.dorms[dormId] ??= {};
      result.dorms[dormId][night] = computeNightAvailability(dormId, night, beds, blocks, assignments, overrides, unassignedOtaOnNight(holds, dormId, night));
    }
  }
  return result;
}
