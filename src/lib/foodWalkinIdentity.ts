import { normalizePhone } from "@/lib/phoneUtils";

export type WalkinIdentityOrder = {
  id: number;
  guestName?: string | null;
  guestPhone?: string | null;
  roomInfo?: string | null;
  createdAt?: string | null;
};

const CAFE_TABLE_ROOM = /^Table\s+(\d+)$/i;
/** Stored on food_orders.guest_phone when staff releases a paid table session. */
const CAFE_TABLE_RELEASED_PREFIX = "r:";

export function isCafeTableRoomInfo(roomInfo: string | null | undefined): boolean {
  return !!roomInfo && CAFE_TABLE_ROOM.test(String(roomInfo).trim());
}

/** Canonical `Table N` spelling for stable group keys. */
export function canonicalCafeTableRoomInfo(roomInfo: string | null | undefined): string | null {
  const match = String(roomInfo || "").trim().match(CAFE_TABLE_ROOM);
  if (!match) return null;
  return `Table ${parseInt(match[1], 10)}`;
}

export function cafeTableNumber(roomInfo: string | null | undefined): number | null {
  const match = String(roomInfo || "").trim().match(CAFE_TABLE_ROOM);
  if (!match) return null;
  return parseInt(match[1], 10);
}

export function isCafeTableSessionReleased(phone: string | null | undefined): boolean {
  return String(phone || "").trim().startsWith(CAFE_TABLE_RELEASED_PREFIX);
}

/** Digits-only session id for cafe tables (do not 10-digit-slice like real phones). */
export function cafeTableSessionKey(phone: string | null | undefined): string {
  const raw = String(phone || "").trim();
  const body = raw.startsWith(CAFE_TABLE_RELEASED_PREFIX)
    ? raw.slice(CAFE_TABLE_RELEASED_PREFIX.length)
    : raw;
  return body.replace(/\D/g, "");
}

/** Persist release on the order row (syncs with food_orders; no settings blob). */
export function releasedCafeTableSessionPhone(phone: string | null | undefined): string {
  const session = cafeTableSessionKey(phone);
  return session ? `${CAFE_TABLE_RELEASED_PREFIX}${session}` : "";
}

export function cafeTableDisplayLabel(roomInfo: string | null | undefined, guestName: string | null | undefined): string {
  const table = canonicalCafeTableRoomInfo(roomInfo) || "Table";
  const name = String(guestName || "").trim();
  if (!name || name.toLowerCase() === table.toLowerCase()) return table;
  return `${table} · ${name}`;
}

export function normalizeWalkinGuestName(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeWalkinPhoneKey(value: string | null | undefined): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  // Staff deliberately use 1–9 as reusable walk-in placeholders. The public
  // phone validator rejects those, but grouping must retain them.
  return normalizePhone(digits) || digits;
}

export function walkinIdentityKey(phone: string | null | undefined, name: string | null | undefined): string {
  const normalizedPhone = normalizeWalkinPhoneKey(phone);
  const normalizedName = normalizeWalkinGuestName(name);
  return normalizedPhone && normalizedName ? `${normalizedPhone}|${normalizedName}` : "";
}

/**
 * Walk-in: phone|name. Cafe table: table + session id in guestPhone so each
 * visit is isolated; fully paid sessions do not merge with the next occupant.
 */
export function walkinOrderGroupKey(order: WalkinIdentityOrder): string {
  const table = canonicalCafeTableRoomInfo(order.roomInfo);
  if (table) {
    const session = cafeTableSessionKey(order.guestPhone);
    return session ? `table_${table}|${session}` : `_no_identity_${order.id}`;
  }
  const identity = walkinIdentityKey(order.guestPhone, order.guestName);
  return identity || `_no_identity_${order.id}`;
}

export function latestWalkinOrder<T extends WalkinIdentityOrder & { createdAt: string }>(orders: T[]): T {
  return orders.reduce((latest, order) => order.createdAt > latest.createdAt ? order : latest);
}

export type OpenCafeTableOccupancy = {
  tableNumber: number;
  guestName: string;
  sessionPhone: string;
  roomInfo: string;
};

/**
 * Newest unreleased session per table (paid or unpaid). Released sessions are
 * skipped so the table returns to the free pool. Orders should be newest-first.
 */
export function buildOpenCafeTableOccupancy<T extends WalkinIdentityOrder>(
  orders: T[],
): Map<number, OpenCafeTableOccupancy> {
  const map = new Map<number, OpenCafeTableOccupancy>();
  for (const order of orders) {
    if (isCafeTableSessionReleased(order.guestPhone)) continue;
    const tableNumber = cafeTableNumber(order.roomInfo);
    const sessionPhone = cafeTableSessionKey(order.guestPhone);
    const roomInfo = canonicalCafeTableRoomInfo(order.roomInfo);
    if (tableNumber == null || !sessionPhone || !roomInfo || map.has(tableNumber)) continue;
    map.set(tableNumber, {
      tableNumber,
      guestName: String(order.guestName || roomInfo).trim() || roomInfo,
      sessionPhone,
      roomInfo,
    });
  }
  return map;
}
