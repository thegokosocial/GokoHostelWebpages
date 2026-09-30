import { sellableUnits, type InventoryPool } from "@/lib/inventoryAvailability";

export type ChannelRoomMapping = {
  dormId: number;
  channelRoomCode: string;
  dormName?: string | null;
  isActive?: number | boolean | null;
};

export type TaggedChannelBed = {
  id: number;
  dormId: number;
  pool: InventoryPool | string;
  bedId?: string;
  dormName?: string;
  type?: string;
};

export function normalizeChannelRoomCode(code: string): string {
  return code.trim().toLowerCase();
}

export function isActiveRoomMapping(row: ChannelRoomMapping): boolean {
  return row.isActive !== 0 && row.isActive !== false;
}

export type ChannelRoomOccupancy = { adults?: number | null; children?: number | null };

/** One physical bed per person. Empty occupancy still needs one bed. */
export function occupancyBedCount(occupancy?: ChannelRoomOccupancy | null): number {
  const n = (Number(occupancy?.adults) || 0) + (Number(occupancy?.children) || 0);
  return n > 0 ? n : 1;
}

function occupancySpecified(occupancy?: ChannelRoomOccupancy | null): boolean {
  if (occupancy == null) return false;
  return (Number(occupancy.adults) || 0) + (Number(occupancy.children) || 0) > 0;
}

function distributePersonBeds(
  roomCodes: string[],
  persons: number,
): Array<{ roomCode: string; count: number }> {
  if (roomCodes.length === 0 || persons <= 0) return [];
  if (roomCodes.length === 1) return [{ roomCode: roomCodes[0], count: persons }];
  if (persons < roomCodes.length) {
    return roomCodes.slice(0, persons).map((roomCode) => ({ roomCode, count: 1 }));
  }
  const needs = roomCodes.map((roomCode) => ({ roomCode, count: 1 }));
  needs[0].count += persons - roomCodes.length;
  return needs;
}

type ChannelRoomRow = { roomCode?: string | null; occupancy?: ChannelRoomOccupancy | null };
export type ChannelBedNeed = { roomCode: string; count: number; units?: number };

function groupRoomsByCode(rooms: ChannelRoomRow[]): Array<{ roomCode: string; rows: ChannelRoomRow[] }> {
  const groups: Array<{ roomCode: string; rows: ChannelRoomRow[] }> = [];
  const idx = new Map<string, number>();
  for (const r of rooms) {
    const roomCode = (r.roomCode || "").trim();
    const i = idx.get(roomCode);
    if (i == null) {
      idx.set(roomCode, groups.length);
      groups.push({ roomCode, rows: [r] });
    } else {
      groups[i].rows.push(r);
    }
  }
  return groups;
}

function roomsFromRawData(rawData?: string | null): ChannelRoomRow[] {
  if (!rawData) return [];
  try {
    const raw = JSON.parse(rawData) as { rooms?: ChannelRoomRow[] } | null;
    return Array.isArray(raw?.rooms) ? raw.rooms : [];
  } catch {
    return [];
  }
}

/** Room codes from webhook rooms[], rawData.rooms, or comma-separated roomType. */
export function roomCodesFromChannelBooking(
  rooms?: ChannelRoomRow[] | null,
  roomTypeFallback?: string | null,
  rawData?: string | null,
): string[] {
  const fromRooms = (rooms && rooms.length > 0 ? rooms : roomsFromRawData(rawData))
    .map((r) => (r.roomCode || "").trim())
    .filter(Boolean);
  if (fromRooms.length > 0) return fromRooms;
  return (roomTypeFallback || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Beds to auto-assign for the whole stay (nights do not multiply beds).
 * One rooms[] row with occupancy 2 → 2 beds (persons in that sold unit).
 * The same roomCode repeated with occupancy on every row → 1 bed per row:
 * occupancy is that unit's capacity (6 suite × adults 3 → 6 beds, not 18).
 */
export function channelBedNeeds(args: {
  rooms?: ChannelRoomRow[] | null;
  roomType?: string | null;
  rawData?: string | null;
  persons?: number | null;
}): ChannelBedNeed[] {
  const rooms = (args.rooms && args.rooms.length > 0 ? args.rooms : roomsFromRawData(args.rawData))
    .filter((r) => (r.roomCode || "").trim());
  if (rooms.length > 0) {
    const specified: ChannelBedNeed[] = [];
    for (const g of groupRoomsByCode(rooms)) {
      if (g.rows.length > 1 && g.rows.every((r) => occupancySpecified(r.occupancy))) {
        specified.push({ roomCode: g.roomCode, count: g.rows.length, units: g.rows.length });
        continue;
      }
      for (const r of g.rows) {
        specified.push({
          roomCode: g.roomCode,
          count: occupancySpecified(r.occupancy) ? occupancyBedCount(r.occupancy) : 0,
          units: 1,
        });
      }
    }
    if (specified.every((n) => n.count > 0)) return specified;
    const persons = Math.max(1, Number(args.persons) || specified.reduce((s, n) => s + n.count, 0) || rooms.length);
    if (specified.every((n) => n.count === 0)) {
      return distributePersonBeds(specified.map((n) => n.roomCode), persons);
    }
    const known = specified.filter((n) => n.count > 0);
    const unknown = specified.filter((n) => n.count === 0).map((n) => n.roomCode);
    const leftover = Math.max(0, persons - known.reduce((s, n) => s + n.count, 0));
    return [...known, ...distributePersonBeds(unknown, leftover)];
  }
  const codes = roomCodesFromChannelBooking(null, args.roomType, args.rawData);
  const persons = Math.max(1, Number(args.persons) || codes.length || 1);
  return distributePersonBeds(codes, persons);
}

/**
 * Guest headcount is independent of the sellable-unit count used for assignment.
 * A repeated double room is one sellable unit per row, but its occupancy still
 * represents two guests per row.
 */
export function channelPersonCount(args: {
  rooms?: ChannelRoomRow[] | null;
  roomType?: string | null;
  rawData?: string | null;
  persons?: number | null;
}): number {
  const rooms = args.rooms && args.rooms.length > 0 ? args.rooms : roomsFromRawData(args.rawData);
  if (rooms.length > 0 && rooms.every((room) => occupancySpecified(room.occupancy))) {
    return rooms.reduce((sum, room) => sum + occupancyBedCount(room.occupancy), 0);
  }
  return Math.max(1, Number(args.persons) || channelBedNeeds(args).reduce((s, x) => s + x.count, 0) || 1);
}

export function activeMappingsByCode(mappings: ChannelRoomMapping[]): Map<string, ChannelRoomMapping> {
  const byCode = new Map<string, ChannelRoomMapping>();
  for (const row of mappings) {
    if (!isActiveRoomMapping(row) || !row.dormId) continue;
    const key = normalizeChannelRoomCode(row.channelRoomCode);
    if (!key) continue;
    byCode.set(key, row);
  }
  return byCode;
}

export function requestedDormsForCodes(
  roomCodes: string[],
  mappings: ChannelRoomMapping[],
): { dormIds: number[]; dormNames: string[] } {
  const byCode = activeMappingsByCode(mappings);
  const dormIds: number[] = [];
  const names: string[] = [];
  const seen = new Set<number>();
  for (const code of roomCodes) {
    const mapped = byCode.get(normalizeChannelRoomCode(code));
    if (!mapped || seen.has(mapped.dormId)) continue;
    seen.add(mapped.dormId);
    dormIds.push(mapped.dormId);
    if (mapped.dormName) names.push(mapped.dormName);
  }
  return { dormIds, dormNames: names };
}

export function enrichUnassignedBooking<T extends {
  roomType?: string | null;
  rawData?: string | null;
  persons?: number | null;
}>(
  booking: T,
  mappings: ChannelRoomMapping[],
  doubleDormIds: ReadonlySet<number> = new Set(),
): T & {
  requestedRoomCodes: string[];
  requestedDormIds: number[];
  requestedDormNames: string[];
  requestedBedCount: number;
  requestedUnitCount: number;
  requestedNeedLabels: string;
  requestedNeeds: Array<{ dormId: number; count: number; units?: number; name: string }>;
} {
  const needs = channelBedNeeds({
    roomType: booking.roomType,
    rawData: booking.rawData,
    persons: booking.persons,
  });
  const requestedBedCount = needs.reduce((sum, n) => sum + n.count, 0);
  const requestedRoomCodes = needs.map((n) => n.roomCode);
  const { dormIds, dormNames } = requestedDormsForCodes(requestedRoomCodes, mappings);
  const requestedNeeds = requestedNeedsByDorm(needs, mappings).map((need) => ({
    ...need,
    units: doubleDormIds.has(need.dormId) ? need.units : need.count,
  }));
  const requestedUnitCount = requestedNeeds.reduce((sum, n) => sum + n.units, 0);
  return {
    ...booking,
    requestedRoomCodes: [...new Set(requestedRoomCodes)],
    requestedDormIds: dormIds,
    requestedDormNames: dormNames,
    requestedBedCount,
    requestedUnitCount,
    requestedNeedLabels: formatChannelNeedLabels(needs, mappings),
    requestedNeeds,
  };
}

export function requestedNeedsByDorm(
  needs: ChannelBedNeed[],
  mappings: ChannelRoomMapping[],
): Array<{ dormId: number; count: number; units: number; name: string }> {
  const byCode = activeMappingsByCode(mappings);
  const byDorm = new Map<number, { dormId: number; count: number; units: number; name: string }>();
  for (const n of needs) {
    const mapped = byCode.get(normalizeChannelRoomCode(n.roomCode));
    if (!mapped) continue;
    const cur = byDorm.get(mapped.dormId) ?? {
      dormId: mapped.dormId,
      count: 0,
      units: 0,
      name: mapped.dormName || n.roomCode,
    };
    cur.count += Math.max(1, n.count);
    cur.units += Math.max(1, n.units || n.count);
    byDorm.set(mapped.dormId, cur);
  }
  return [...byDorm.values()];
}

export function formatChannelNeedLabels(
  needs: Array<{ roomCode: string; count: number }>,
  mappings: ChannelRoomMapping[],
): string {
  const byCode = activeMappingsByCode(mappings);
  return needs
    .map((n) => {
      const mapped = byCode.get(normalizeChannelRoomCode(n.roomCode));
      return `${Math.max(1, n.count)} ${mapped?.dormName || n.roomCode}`;
    })
    .join(", ");
}

export function channelNeedsAreMapped(
  needs: Array<{ roomCode: string; count: number }>,
  mappings: ChannelRoomMapping[],
): boolean {
  if (needs.length === 0) return false;
  const byCode = activeMappingsByCode(mappings);
  return needs.every((n) => byCode.has(normalizeChannelRoomCode(n.roomCode)));
}

export type ChannelBedPick =
  | { ok: true; picks: Array<{ bedId: number; dormId: number; label: string }> }
  | { ok: false; reason: string };

/**
 * One online-pool bed per person in the mapped dorm, for the whole stay.
 * All-or-nothing: unmapped type or not enough online beds → Unassigned.
 * Offline / blocked chips are ignored — staff assign those from Unassigned.
 */
export function pickOnlineBedsForChannelRooms(
  needs: ChannelBedNeed[],
  mappings: ChannelRoomMapping[],
  tagged: TaggedChannelBed[],
): ChannelBedPick {
  if (needs.length === 0) {
    return { ok: false, reason: "no room type on booking" };
  }
  const byCode = activeMappingsByCode(mappings);
  const used = new Set<number>();
  const picks: Array<{ bedId: number; dormId: number; label: string }> = [];

  const onlineByDorm = new Map<number, TaggedChannelBed[]>();
  for (const bed of tagged) {
    if (bed.pool !== "online") continue;
    const list = onlineByDorm.get(bed.dormId) ?? [];
    list.push(bed);
    onlineByDorm.set(bed.dormId, list);
  }
  for (const list of onlineByDorm.values()) {
    list.sort((a, b) => (a.bedId || "").localeCompare(b.bedId || "", undefined, { numeric: true }) || a.id - b.id);
  }

  for (const need of needs) {
    const mapped = byCode.get(normalizeChannelRoomCode(need.roomCode));
    if (!mapped) {
      return { ok: false, reason: `unmapped room type: ${need.roomCode}` };
    }
    const candidates = onlineByDorm.get(mapped.dormId) ?? [];
    const units = sellableUnits(candidates);
    const isDouble = units.some((u) => u.type === "Double");
    const count = isDouble ? Math.max(1, need.units || 1) : Math.max(1, need.count);
    for (let i = 0; i < count; i++) {
      const unit = units.find((u) => u.beds.every((b) => !used.has(b.id)));
      if (!unit) {
        const where = mapped.dormName ? `${mapped.dormName} (${need.roomCode})` : need.roomCode;
        return { ok: false, reason: `no online beds left in ${where}` };
      }
      for (const bed of unit.beds) {
        used.add(bed.id);
        picks.push({ bedId: bed.id, dormId: mapped.dormId, label: `${bed.dormName || mapped.dormName || mapped.dormId}/${unit.label}` });
      }
    }
  }
  return { ok: true, picks };
}

export function assignedBedsMatchNeeds(
  assigned: Array<{ dormId: number; status?: string }>,
  needs: Array<{ roomCode: string; count: number }>,
  mappings: ChannelRoomMapping[],
): boolean {
  // getBedById uses beds.status (`available`); assignment rows use `unassigned`.
  const active = assigned.filter((a) => a.status !== "unassigned");
  const byCode = activeMappingsByCode(mappings);
  const needByDorm = new Map<number, number>();
  for (const n of needs) {
    const mapped = byCode.get(normalizeChannelRoomCode(n.roomCode));
    if (!mapped) return false;
    needByDorm.set(Number(mapped.dormId), (needByDorm.get(Number(mapped.dormId)) || 0) + Math.max(1, n.count));
  }
  const haveByDorm = new Map<number, number>();
  for (const a of active) {
    const dormId = Number(a.dormId);
    haveByDorm.set(dormId, (haveByDorm.get(dormId) || 0) + 1);
  }
  if (needByDorm.size !== haveByDorm.size) return false;
  for (const [dormId, count] of needByDorm) {
    if (haveByDorm.get(dormId) !== count) return false;
  }
  return true;
}

function normalizeRoomTypeKey(roomType?: string | null): string {
  return (roomType || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

/** Re-seat when occupancy grows/shrinks or room type changes. Extra overflow beds are not occupancy growth. */
export function channelAssignmentNeedsReseat(args: {
  assignedCount: number;
  needs: Array<{ roomCode: string; count: number }>;
  previousNeedCount?: number;
  previousRoomType?: string | null;
  nextRoomType?: string | null;
}): boolean {
  const needCount = args.needs.reduce((sum, n) => sum + Math.max(1, n.count), 0);
  if (args.assignedCount < needCount) return true;
  if (args.previousNeedCount != null && needCount < args.previousNeedCount) return true;
  const prev = normalizeRoomTypeKey(args.previousRoomType);
  const next = normalizeRoomTypeKey(args.nextRoomType);
  if (!prev || !next) return false;
  return prev !== next;
}

export async function autoAssignOnlineChannelBeds(args: {
  bookingId: number;
  needs: ChannelBedNeed[];
  mappings: ChannelRoomMapping[];
  tagged: TaggedChannelBed[];
  assignBed: (pick: { bedId: number; dormId: number }) => Promise<boolean>;
  unassignAll: () => Promise<void>;
  refreshTagged?: () => Promise<TaggedChannelBed[]>;
}): Promise<{ assigned: number; labels: string[]; reason?: string }> {
  let tagged = args.tagged;
  const failedIds = new Set<number>();
  let lastReason = "bed conflict while auto-assigning";
  for (let attempt = 0; attempt < 3; attempt++) {
    const picked = pickOnlineBedsForChannelRooms(
      args.needs,
      args.mappings,
      tagged.filter((b) => !failedIds.has(b.id)),
    );
    if (!picked.ok) return { assigned: 0, labels: [], reason: picked.reason };

    const labels: string[] = [];
    let conflict = false;
    for (const pick of picked.picks) {
      const ok = await args.assignBed({ bedId: pick.bedId, dormId: pick.dormId });
      if (!ok) {
        await args.unassignAll();
        failedIds.add(pick.bedId);
        conflict = true;
        lastReason = "bed conflict while auto-assigning";
        break;
      }
      labels.push(pick.label);
    }
    if (!conflict) return { assigned: labels.length, labels };
    if (!args.refreshTagged || attempt === 2) break;
    tagged = await args.refreshTagged();
  }
  return { assigned: 0, labels: [], reason: lastReason };
}
