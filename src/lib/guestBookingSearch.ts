import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getAllDorms, getAvailableBedsForRange, getRoomTypeMappings, getRatePlanMappings, getAllDailyRates, getSetting } from "@/db/queries";
import { beds as bedsTable } from "@/db/schema";
import { sellableUnits, stayNights, type InventoryBedRef } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";
import { BOOKING_TAX_SETTING, DEFAULT_BOOKING_TAX_PERCENT } from "@/lib/bookingPricing";
import { WEBSITE_BOOKING_SETTINGS_KEY, readWebsiteBookingSettings, MAX_WEBSITE_BOOKING_BEDS } from "@/lib/websiteBookingSettings";
import { evaluateNativeCheckoutReadiness } from "@/lib/nativeCheckoutReadiness";

const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid date");
export const guestSearchSchema = z.object({
  checkinDate: date, checkoutDate: date,
}).strict()
  .refine(s => s.checkoutDate > s.checkinDate && Date.parse(s.checkoutDate) - Date.parse(s.checkinDate) <= 30 * 86400000, "Choose a stay of 1–30 nights")
  .refine(s => s.checkinDate >= todayIST() && Date.parse(s.checkinDate) - Date.parse(todayIST()) <= 365 * 86400000, "Choose an arrival within the next year");

export type GuestRate = { id: number; name: string; nightlyRates: { date: string; rupees: number }[]; subtotalRupees: number };
export type GuestRoom = { id: string; name: string; type: "Double" | "Bed"; capacity: number; availableUnits: number; rates?: GuestRate[] };
export function guestTaxPercent(raw: string | null) {
  if (raw === null) return DEFAULT_BOOKING_TAX_PERCENT;
  if (!raw.trim() || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 100) throw new Error("Invalid booking tax configuration");
  return Number(raw);
}
type RateRow = { date: string; rate: number; adult1Rate: number | null; adult2Rate: number | null; stopSell: number; minimumStay: number; maximumStay: number | null; closeOnArrival: number; closeOnDeparture: number; minimumAdvanceReservation: number | null; maximumAdvanceReservation: number | null };
/** Only complete, unrestricted, positive integer server rates are displayable. Checkout is not an occupied night. */
export function guestRateForStay(rows: RateRow[], arrival: string, departure: string, capacity: number, today: string): Omit<GuestRate, "id" | "name"> | null {
  const nights = stayNights(arrival, departure), advance = (Date.parse(arrival) - Date.parse(today)) / 86400000;
  const byDate = new Map(rows.map(row => [row.date, row]));
  if (byDate.size !== rows.length || !nights.length || nights.length > 30 || !byDate.has(departure)) return null;
  const nightlyRates: { date: string; rupees: number }[] = [];
  for (const date of nights) {
    const row = byDate.get(date);
    if (!row || row.stopSell || nights.length < row.minimumStay || (row.maximumStay != null && nights.length > row.maximumStay)
      || (row.minimumAdvanceReservation != null && advance < row.minimumAdvanceReservation)
      || (row.maximumAdvanceReservation != null && advance > row.maximumAdvanceReservation)
      || (date === arrival && row.closeOnArrival)) return null;
    const rupees = capacity === 2 ? (row.adult2Rate ?? row.rate) : (row.adult1Rate ?? row.rate);
    // Maximum supported beds × 30 nights × 2 (100% tax) remains a safe integer.
    if (!Number.isSafeInteger(rupees) || rupees <= 0 || rupees > Number.MAX_SAFE_INTEGER / (MAX_WEBSITE_BOOKING_BEDS * 30 * 2)) return null;
    nightlyRates.push({ date, rupees });
  }
  if (byDate.get(departure)?.closeOnDeparture) return null;
  return { nightlyRates, subtotalRupees: nightlyRates.reduce((sum, row) => sum + row.rupees, 0) };
}
export function aggregateGuestRooms(beds: InventoryBedRef[], onlineIds: Set<number>, dorms: { id: number; name: string }[], heldIds: Set<number>): GuestRoom[] {
  const groups = new Map<string, GuestRoom>();
  for (const unit of sellableUnits(beds)) {
    const dorm = dorms.find(d => d.id === unit.dormId);
    if (!dorm || unit.beds.length !== unit.capacity || !unit.beds.every(b => b.id != null && onlineIds.has(b.id) && !heldIds.has(b.id))) continue;
    const id = `${unit.dormId}-${unit.type}`;
    const room = groups.get(id) ?? { id, name: dorm.name, type: unit.type, capacity: unit.capacity, availableUnits: 0 };
    room.availableUnits++;
    groups.set(id, room);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

/** Advisory online inventory only. Never creates a hold, quote or reservation. */
export async function searchGuestRooms(input: unknown, opts?: { excludeBookingId?: number }) {
  const stay = guestSearchSchema.parse(input);
  try {
    const { cancelAbandonedWebsiteHolds } = await import("@/lib/websiteAbandonedHolds");
    await cancelAbandonedWebsiteHolds();
  } catch { /* best-effort; search must not fail closed on cleanup */ }
  const db = getDb();
  const tables = await db.select({ name: sql<string>`name` }).from(sql`sqlite_master`).where(sql`type = 'table' AND name = 'native_inventory_holds'`);
  const heldIds = new Set<number>();
  if (tables.length) {
    const holds = await db.select({ bedIds: sql<string>`bed_ids` }).from(sql`native_inventory_holds`)
      .where(sql`state = 'held' AND expires_at > CAST(strftime('%s','now') AS INTEGER) AND checkin_date < ${stay.checkoutDate} AND checkout_date > ${stay.checkinDate}`);
    for (const hold of holds) {
      const ids: unknown = JSON.parse(hold.bedIds);
      if (!Array.isArray(ids) || !ids.every(id => Number.isInteger(id) && id > 0)) throw new Error("Invalid inventory hold");
      ids.forEach(id => heldIds.add(id));
    }
  }
  const [beds, available, dorms, mappings, plans, daily] = await Promise.all([
    db.select({ id: bedsTable.id, dormId: bedsTable.dormId, bedId: bedsTable.bedId, type: bedsTable.type }).from(bedsTable).where(sql`${bedsTable.deletedAt} IS NULL`),
    getAvailableBedsForRange(stay.checkinDate, stay.checkoutDate, undefined, opts?.excludeBookingId),
    getAllDorms(), getRoomTypeMappings(), getRatePlanMappings(), getAllDailyRates(stay.checkinDate, stay.checkoutDate),
  ]);
  const rooms = aggregateGuestRooms(beds, new Set(available.filter(b => b.pool === "online").map(b => b.id)), dorms.filter(d => !d.deletedAt), heldIds);
  for (const room of rooms) {
    const dormId = Number(room.id.split("-")[0]);
    const activeMappings = mappings.filter(mapping => mapping.dormId === dormId && mapping.isActive === 1);
    room.rates = [];
    // An ambiguous mapping must not guess which room tariff to publish.
    if (activeMappings.length !== 1) continue;
    for (const plan of plans.filter(plan => plan.roomMappingId === activeMappings[0].id && plan.isActive === 1)) {
      const rows = daily.filter(row => row.ratePlanId === plan.id);
      // A mixed bunk/double dorm cannot infer a double tariff from its single-bed base rate.
      if (room.type === "Double" && beds.some(bed => bed.dormId === dormId && bed.type !== "Double") && rows.some(row => row.date < stay.checkoutDate && row.adult2Rate == null)) continue;
      const rate = guestRateForStay(rows, stay.checkinDate, stay.checkoutDate, room.capacity, todayIST());
      if (rate) room.rates.push({ id: plan.id, name: plan.ratePlanName, ...rate });
    }
  }
  const settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  let nativeCheckoutReady = false;
  let paymentOptions = {
    advancePercent: settings.advancePercent,
    allowFullPayment: settings.allowFullPayment,
    allowPayAtProperty: settings.allowPayAtProperty,
    gatewayEnvironment: settings.gatewayEnvironment as "test" | "live",
    requireLookupOtp: settings.requireLookupOtp,
  };
  try {
    const readiness = await evaluateNativeCheckoutReadiness();
    nativeCheckoutReady = readiness.nativeCheckoutReady;
    if (readiness.paymentOptions) paymentOptions = readiness.paymentOptions;
  } catch { /* advisory search must not fail closed on readiness checks */ }
  return {
    rooms, maxSelectedBeds: settings.maxSelectedBeds,
    taxPercent: guestTaxPercent(await getSetting(BOOKING_TAX_SETTING)),
    nights: stayNights(stay.checkinDate, stay.checkoutDate).length,
    currency: "INR", priceBasis: "tax-inclusive-estimate",
    nativeCheckoutReady, paymentOptions,
  };
}
