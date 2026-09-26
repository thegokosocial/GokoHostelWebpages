/** Pure analytics date/money helpers shared by the admin analytics route and tests. */

export function daysInRangeInclusive(fromDate: string, toDate: string): number {
  return Math.max(1, Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000) + 1);
}

export function nextCalendarDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

/** Nights of [checkin, checkout) that fall inside [from, toExclusive). */
export function overlapNightCount(checkin: string, checkout: string, from: string, toExclusive: string): number {
  const overlapStart = Math.max(Date.parse(`${checkin}T00:00:00Z`), Date.parse(`${from}T00:00:00Z`));
  const overlapEnd = Math.min(Date.parse(`${checkout}T00:00:00Z`), Date.parse(`${toExclusive}T00:00:00Z`));
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 86400000));
}

/** Prorate a stay total by overlapping nights in [from, toExclusive). */
export function prorateByOverlapNights(
  amountTotal: number,
  checkin: string,
  checkout: string,
  from: string,
  toExclusive: string,
): number {
  const stayNights = Math.max(1, overlapNightCount(checkin, checkout, checkin, checkout));
  const nights = overlapNightCount(checkin, checkout, from, toExclusive);
  if (!nights || !Number.isFinite(amountTotal)) return 0;
  return amountTotal * (nights / stayNights);
}

export function computeAdr(bookedStayValue: number, nights: number): number {
  return nights > 0 ? bookedStayValue / nights : 0;
}

export function computeRevpar(bookedStayValue: number, availableBedNights: number): number {
  return availableBedNights > 0 ? bookedStayValue / availableBedNights : 0;
}

/** Previous equal-length inclusive window ending the day before `fromDate`. */
export function priorDateRange(fromDate: string, toDate: string): { fromDate: string; toDate: string } {
  const days = daysInRangeInclusive(fromDate, toDate);
  const priorTo = new Date(`${fromDate}T00:00:00Z`);
  priorTo.setUTCDate(priorTo.getUTCDate() - 1);
  const priorToDate = priorTo.toISOString().slice(0, 10);
  const priorFrom = new Date(`${priorToDate}T00:00:00Z`);
  priorFrom.setUTCDate(priorFrom.getUTCDate() - (days - 1));
  return { fromDate: priorFrom.toISOString().slice(0, 10), toDate: priorToDate };
}

export function cancellationRate(cancellations: number, bookingsReceived: number): number | null {
  if (bookingsReceived <= 0) return null;
  return (cancellations / bookingsReceived) * 100;
}

export function collectionRate(obtained: number, expected: number): number | null {
  if (expected <= 0) return null;
  return (obtained / expected) * 100;
}

export function outstandingBalance(expected: number, obtained: number): number {
  return Math.max(0, expected - obtained);
}

/** Percent change vs prior; null when prior is zero (undefined direction). */
export function percentDelta(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function formatPercentDelta(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function showPickupZeroHint(pickup: number, onBooks: number): boolean {
  return pickup === 0 && onBooks > 0;
}
