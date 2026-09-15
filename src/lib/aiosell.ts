/**
 * Aiosell Channel Manager API Client
 * Handles outbound push (rates, inventory, restrictions, no-show)
 * and inbound webhook parsing (reservations).
 */

import { logPmsCall } from "@/lib/pmsLog";
import { addCalendarDays, inclusiveNights } from "@/lib/inventoryAvailability";

export type AiosellConfig = {
  hotelCode: string;
  pmsId: string;
  apiBaseUrl: string;
  apiUsername: string;
  apiPassword: string;
};

export type AiosellResponse = {
  success: boolean;
  message?: string;
  warnings?: string[];
};

export type AiosellPropertyRoom = {
  room_id: string;
  room_name?: string;
  active?: boolean;
  count?: number;
  rateplans?: Array<{ rateplan_id: string; rateplan_name?: string }>;
};

export type AiosellPropertyDetails = { hotel_id: string; hotel_name?: string; rooms: AiosellPropertyRoom[] };

export type InventoryUpdate = {
  startDate: string;
  endDate: string;
  rooms: Array<{ roomCode: string; available: number }>;
};

export type InventoryRestrictionUpdate = {
  startDate: string;
  endDate: string;
  rooms: Array<{
    roomCode: string;
    restrictions: RestrictionFields;
  }>;
};

export type RateUpdate = {
  startDate: string;
  endDate: string;
  rates: Array<{ roomCode: string; rateplanCode: string; rate: number }>;
};

export type RateRestrictionUpdate = {
  startDate: string;
  endDate: string;
  rates: Array<{
    roomCode: string;
    rateplanCode: string;
    restrictions: RestrictionFields | RestrictionPatch;
  }>;
};

export type RestrictionFields = {
  stopSell: boolean;
  minimumStay: number | null;
  maximumStay: number | null;
  closeOnArrival: boolean;
  closeOnDeparture: boolean;
  minimumAdvanceReservation: number | null;
  maximumAdvanceReservation: number | null;
  minimumStayArrival: number | null;
  maximumStayArrival: number | null;
  exactStayArrival: number | null;
};

/** Aiosell restriction fields are optional (merge). Bulk UI sends only the one staff set. */
export type RestrictionPatch = Partial<RestrictionFields>;

export function restrictionPatch(restrictionType: string, value: unknown): RestrictionPatch | null {
  switch (restrictionType) {
    case "stopSell": return { stopSell: Boolean(value) };
    case "closeOnArrival": return { closeOnArrival: Boolean(value) };
    case "closeOnDeparture": return { closeOnDeparture: Boolean(value) };
    case "minimumStay": return { minimumStay: asStayNumber(value) };
    case "maximumStay": return { maximumStay: asStayNumber(value) };
    case "minimumAdvanceReservation": return { minimumAdvanceReservation: asStayNumber(value) };
    case "maximumAdvanceReservation": return { maximumAdvanceReservation: asStayNumber(value) };
    default: return null;
  }
}

function asStayNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function updatePayloadKey<T extends { startDate: string; endDate: string }>(u: T): string {
  const { startDate: _s, endDate: _e, ...rest } = u;
  return JSON.stringify(rest);
}

/**
 * Aiosell expands startDate–endDate into nights server-side.
 * Merge consecutive calendar days that share the same rooms/rates payload.
 * Gaps (weekday filter) and payload changes (Adjust / mixed leftover) stay split.
 */
export function coalesceAiosellUpdates<T extends { startDate: string; endDate: string }>(updates: T[]): T[] {
  if (updates.length <= 1) return updates.map((u) => ({ ...u }));
  const sorted = [...updates].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
    || a.endDate.localeCompare(b.endDate)
    || updatePayloadKey(a).localeCompare(updatePayloadKey(b)),
  );
  const out: T[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const u = sorted[i];
    const prev = out[out.length - 1];
    if (addCalendarDays(prev.endDate, 1) === u.startDate && updatePayloadKey(prev) === updatePayloadKey(u)) {
      prev.endDate = u.endDate;
      continue;
    }
    out.push({ ...u });
  }
  return out;
}

function coalescedPush<T extends { startDate: string; endDate: string }>(
  updates: T[],
  items: (u: T) => number,
): { updates: T[]; recordsAffected: number } {
  const coalesced = coalesceAiosellUpdates(updates);
  return {
    updates: coalesced,
    recordsAffected: coalesced.reduce(
      (sum, u) => sum + inclusiveNights(u.startDate, u.endDate || u.startDate).length * items(u),
      0,
    ),
  };
}

export type ReservationPayload = {
  action: "book" | "modify" | "cancel";
  hotelCode: string;
  channel: string;
  bookingId: string;
  cmBookingId?: string;
  bookedOn?: string;
  checkin?: string;
  checkout?: string;
  segment?: string;
  specialRequests?: string;
  pah?: boolean;
  amount?: {
    amountAfterTax: number;
    amountBeforeTax: number;
    tax: number;
    currency: string;
  };
  guest?: {
    firstName: string;
    lastName: string | null;
    email: string;
    phone: string;
    address?: {
      line1?: string;
      city?: string;
      state?: string;
      country?: string;
      zipCode?: string;
    };
  };
  rooms?: Array<{
    roomCode: string;
    rateplanCode: string;
    guestName: string;
    occupancy: { adults: number; children: number };
    prices: Array<{ date: string; sellRate: number }>;
  }>;
};

function buildAuthHeader(config: AiosellConfig): string {
  const encoded = btoa(`${config.apiUsername}:${config.apiPassword}`);
  return `Basic ${encoded}`;
}

type AiosellCallType = "inventory" | "rate" | "restriction" | "noshow" | "reservation" | "fetch";

export function countFetchedRecords(data: unknown): number | undefined {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.updates)) return o.updates.length;
    if (Array.isArray(o.data)) return o.data.length;
    if (Array.isArray(o.reservations)) return o.reservations.length;
  }
  return undefined;
}

async function aiosellFetch(
  url: string,
  config: AiosellConfig,
  body: Record<string, unknown>,
  meta: { type: AiosellCallType; recordsAffected?: number; source?: string; direction?: "push" | "pull" }
): Promise<AiosellResponse> {
  const started = Date.now();
  const log = (entry: {
    status: "success" | "failed";
    httpStatus: number;
    response?: unknown;
    errorMessage?: string;
  }) =>
    logPmsCall({
      direction: meta.direction ?? "push",
      type: meta.source ? `${meta.type} (${meta.source})` : meta.type,
      status: entry.status,
      request: body,
      response: entry.response,
      errorMessage: entry.errorMessage,
      recordsAffected: meta.recordsAffected,
      httpMethod: "POST",
      url,
      httpStatus: entry.httpStatus,
      durationMs: Date.now() - started,
    }).catch(() => {});

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(config),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const result: AiosellResponse = {
        success: false,
        message: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
      await log({ status: "failed", httpStatus: response.status, response: result, errorMessage: result.message });
      return result;
    }

    let data: AiosellResponse;
    try {
      data = await response.json() as AiosellResponse;
    } catch {
      const message = `HTTP ${response.status}: invalid JSON response`;
      await log({ status: "failed", httpStatus: response.status, errorMessage: message });
      return { success: false, message };
    }

    const recordsAffected = meta.recordsAffected ?? countFetchedRecords(data);
    const warningMessage = data.warnings?.filter(Boolean).join("; ") || "";
    const accepted = data.success !== false && !(meta.type === "inventory" && warningMessage);
    await logPmsCall({
      direction: meta.direction ?? "push",
      type: meta.source ? `${meta.type} (${meta.source})` : meta.type,
      status: accepted ? "success" : "failed",
      request: body,
      response: data,
      errorMessage: accepted ? "" : (warningMessage || data.message),
      recordsAffected,
      httpMethod: "POST",
      url,
      httpStatus: response.status,
      durationMs: Date.now() - started,
    }).catch(() => {});
    return data;
  } catch (error: any) {
    const message = error?.message || "Network error";
    await log({ status: "failed", httpStatus: 0, errorMessage: message });
    return { success: false, message };
  }
}

export async function getAiosellPropertyDetails(config: AiosellConfig, source?: "daily" | "manual"): Promise<
  { success: true; details: AiosellPropertyDetails } | { success: false; message: string }
> {
  const url = `${config.apiBaseUrl}/api/v2/cm/property_details/${encodeURIComponent(config.hotelCode)}?partnerId=${encodeURIComponent(config.pmsId)}`;
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { Authorization: buildAuthHeader(config) }, signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null) as AiosellPropertyDetails | null;
    const valid = response.ok && data && Array.isArray(data.rooms)
      && (!source || (data.hotel_id === config.hotelCode && data.rooms.every((room) =>
        typeof room.room_id === "string" && room.room_id.length > 0
        && (room.rateplans == null || (Array.isArray(room.rateplans) && room.rateplans.every((plan) => typeof plan.rateplan_id === "string" && plan.rateplan_id.length > 0))))));
    const message = valid ? "" : !response.ok ? `Property Details failed (HTTP ${response.status})`
      : source && data?.hotel_id !== config.hotelCode ? "Property Details returned a different hotel; review Configuration"
      : "Property Details returned an invalid room/rate-plan list";
    await logPmsCall({ direction: "pull", type: source ? `fetch (mapping ${source})` : "fetch (mapping)", status: valid ? "success" : "failed", request: {}, response: data, errorMessage: message, recordsAffected: data?.rooms?.length, httpMethod: "GET", url, httpStatus: response.status, durationMs: Date.now() - started }).catch(() => {});
    return valid ? { success: true, details: data } : { success: false, message };
  } catch (error: any) {
    const message = error?.message || "Network error";
    await logPmsCall({ direction: "pull", type: source ? `fetch (mapping ${source})` : "fetch (mapping)", status: "failed", request: {}, errorMessage: message, httpMethod: "GET", url, httpStatus: 0, durationMs: Date.now() - started }).catch(() => {});
    return { success: false, message };
  }
}

export async function pushInventory(
  config: AiosellConfig,
  updates: InventoryUpdate[],
  toChannels?: string[],
  source?: string
): Promise<AiosellResponse> {
  const url = `${config.apiBaseUrl}/api/v2/cm/update/${config.pmsId}`;
  const { updates: coalesced, recordsAffected } = coalescedPush(updates, (u) => u.rooms.length);
  const body: Record<string, unknown> = {
    hotelCode: config.hotelCode,
    updates: coalesced,
  };
  if (toChannels?.length) body.toChannels = toChannels;
  return aiosellFetch(url, config, body, { type: "inventory", recordsAffected, source });
}

export async function pushInventoryRestrictions(
  config: AiosellConfig,
  updates: InventoryRestrictionUpdate[],
  toChannels?: string[]
): Promise<AiosellResponse> {
  const url = `${config.apiBaseUrl}/api/v2/cm/update/${config.pmsId}`;
  const { updates: coalesced, recordsAffected } = coalescedPush(updates, (u) => u.rooms.length);
  const body: Record<string, unknown> = {
    hotelCode: config.hotelCode,
    updates: coalesced,
  };
  if (toChannels?.length) body.toChannels = toChannels;
  return aiosellFetch(url, config, body, { type: "restriction", recordsAffected });
}

export async function pushRates(
  config: AiosellConfig,
  updates: RateUpdate[],
  source?: string
): Promise<AiosellResponse> {
  const url = `${config.apiBaseUrl}/api/v2/cm/update-rates/${config.pmsId}`;
  const { updates: coalesced, recordsAffected } = coalescedPush(updates, (u) => u.rates.length);
  return aiosellFetch(url, config, {
    hotelCode: config.hotelCode,
    updates: coalesced,
  }, { type: "rate", recordsAffected, source });
}

export async function pushRateRestrictions(
  config: AiosellConfig,
  updates: RateRestrictionUpdate[],
  toChannels?: string[],
  source?: string
): Promise<AiosellResponse> {
  const url = `${config.apiBaseUrl}/api/v2/cm/update-rates/${config.pmsId}`;
  const { updates: coalesced, recordsAffected } = coalescedPush(updates, (u) => u.rates.length);
  const body: Record<string, unknown> = {
    hotelCode: config.hotelCode,
    updates: coalesced,
  };
  if (toChannels?.length) body.toChannels = toChannels;
  return aiosellFetch(url, config, body, { type: "restriction", recordsAffected, source });
}

export async function pushNoShow(
  config: AiosellConfig,
  bookingId: string,
  partner = "booking.com",
): Promise<AiosellResponse> {
  const url = `${config.apiBaseUrl}/api/v2/cm/marknoshow/${encodeURIComponent(config.pmsId)}`;
  return aiosellFetch(url, config, {
    hotelCode: config.hotelCode,
    bookingId,
    channel: partner === "booking_com" ? "booking.com" : partner,
  }, { type: "noshow", recordsAffected: 1 });
}

export async function fetchFromAiosell(
  config: AiosellConfig,
  type: "inventory" | "rates" | "reservation",
  startDate: string,
  endDate: string
): Promise<AiosellResponse & { data?: unknown }> {
  const url = `${config.apiBaseUrl}/api/v2/cm/data/${config.pmsId}`;
  const result = await aiosellFetch(url, config, {
    type,
    hotelCode: config.hotelCode,
    startDate,
    endDate,
  }, { type: "fetch", source: type, direction: "pull" });
  return result as AiosellResponse & { data?: unknown };
}

export function parseReservationPayload(body: unknown): ReservationPayload | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;

  const action = data.action as string;
  if (!["book", "modify", "cancel"].includes(action)) return null;
  if (!data.hotelCode || !data.bookingId) return null;

  return data as unknown as ReservationPayload;
}
