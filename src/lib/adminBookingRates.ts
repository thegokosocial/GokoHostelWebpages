import { stayNights } from "@/lib/inventoryAvailability";

export type AdminRateRow = {
  date: string;
  rate: number;
  adult1Rate: number | null;
  adult2Rate: number | null;
};

export type AdminStayRate = {
  nightlyRates: { date: string; rupees: number }[];
  subtotalRupees: number;
  minRupees: number;
  maxRupees: number;
  /** Rounded average for legacy nightlyRate × nights storage only — prefer subtotalRupees for money. */
  averageNightlyRupees: number;
};

/** Per-night calendar pick for admin walk-in suggestions. Ignores guest stop-sell / min-stay / close flags. */
export function adminStayRateForStay(
  rows: AdminRateRow[],
  arrival: string,
  departure: string,
  capacity: number,
): AdminStayRate | null {
  const nights = stayNights(arrival, departure);
  if (!nights.length || nights.length > 30) return null;
  const byDate = new Map<string, AdminRateRow>();
  for (const row of rows) {
    if (byDate.has(row.date)) return null;
    byDate.set(row.date, row);
  }
  const nightlyRates: { date: string; rupees: number }[] = [];
  for (const date of nights) {
    const row = byDate.get(date);
    if (!row) return null;
    const rupees = capacity === 2 ? (row.adult2Rate ?? row.rate) : (row.adult1Rate ?? row.rate);
    if (!Number.isSafeInteger(rupees) || rupees < 0) return null;
    nightlyRates.push({ date, rupees });
  }
  const subtotalRupees = nightlyRates.reduce((sum, row) => sum + row.rupees, 0);
  const amounts = nightlyRates.map((row) => row.rupees);
  return {
    nightlyRates,
    subtotalRupees,
    minRupees: Math.min(...amounts),
    maxRupees: Math.max(...amounts),
    averageNightlyRupees: Math.round(subtotalRupees / nights.length),
  };
}

export function formatAdminDormRateLabel(minRupees: number, maxRupees: number): string {
  if (!Number.isFinite(minRupees) || !Number.isFinite(maxRupees) || maxRupees < 0 || minRupees < 0) return "";
  if (maxRupees <= 0 && minRupees <= 0) return "";
  if (minRupees === maxRupees) return `₹${minRupees}/night`;
  return `₹${minRupees}–${maxRupees}/night`;
}

/** Capacity used for adult1 vs adult2: any Double unit in the dorm → 2. */
export function adminDormCapacity(units: { dormId: number; capacity: number }[], dormId: number): number {
  return units.some((unit) => unit.dormId === dormId && unit.capacity === 2) ? 2 : 1;
}
