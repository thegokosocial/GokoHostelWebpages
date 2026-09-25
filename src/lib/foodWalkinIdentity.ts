import { normalizePhone } from "@/lib/phoneUtils";

export type WalkinIdentityOrder = {
  id: number;
  guestName?: string | null;
  guestPhone?: string | null;
  roomInfo?: string | null;
};

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

export function walkinOrderGroupKey(order: WalkinIdentityOrder): string {
  if (order.roomInfo && /^Table \d+$/i.test(order.roomInfo)) return `table_${order.roomInfo}`;
  const identity = walkinIdentityKey(order.guestPhone, order.guestName);
  return identity || `_no_identity_${order.id}`;
}

export function latestWalkinOrder<T extends WalkinIdentityOrder & { createdAt: string }>(orders: T[]): T {
  return orders.reduce((latest, order) => order.createdAt > latest.createdAt ? order : latest);
}
