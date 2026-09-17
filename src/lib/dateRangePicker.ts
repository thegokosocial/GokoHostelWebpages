import { addCalendarDays } from "@/lib/inventoryAvailability";

/** Parse YYYY-MM-DD at UTC noon — avoids IST/local off-by-one in Date math. */
export function parseCalendarDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/** Format a DayPicker Date using local calendar parts (avoids UTC midnight off-by-one). */
export function toCalendarDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function stayNightCount(checkinDate: string, checkoutDate: string): number {
  if (!checkinDate || !checkoutDate || checkoutDate <= checkinDate) return 0;
  const diff = parseCalendarDate(checkoutDate).getTime() - parseCalendarDate(checkinDate).getTime();
  return Math.round(diff / 86400000);
}

export type NormalizeRangeOptions = {
  minNights?: number;
  maxNights?: number;
  minDate?: string;
};

export type NormalizedRange = {
  startDate: string;
  endDate: string;
  valid: boolean;
  error?: string;
};

/** Normalize a stay range: enforce min checkout, optional max nights and minDate. */
export function normalizeStayRange(
  startDate: string,
  endDate: string,
  opts: NormalizeRangeOptions = {},
): NormalizedRange {
  const minNights = opts.minNights ?? 1;
  let start = startDate;
  let end = endDate;

  if (!start) {
    return { startDate: "", endDate: end, valid: false };
  }

  if (opts.minDate && start < opts.minDate) {
    start = opts.minDate;
  }

  if (!end || end <= start) {
    end = addCalendarDays(start, minNights);
  } else if (stayNightCount(start, end) < minNights) {
    end = addCalendarDays(start, minNights);
  }

  if (opts.maxNights != null) {
    const maxCheckout = addCalendarDays(start, opts.maxNights);
    if (end > maxCheckout) {
      end = maxCheckout;
    }
  }

  const nights = stayNightCount(start, end);
  if (nights < minNights) {
    return { startDate: start, endDate: end, valid: false, error: "Choose a valid date range." };
  }

  if (opts.maxNights != null && nights > opts.maxNights) {
    return {
      startDate: start,
      endDate: addCalendarDays(start, opts.maxNights),
      valid: false,
      error: `Maximum stay is ${opts.maxNights} nights.`,
    };
  }

  return { startDate: start, endDate: end, valid: true };
}

export function isoRangeToDateRange(
  startDate: string,
  endDate: string,
): { from?: Date; to?: Date } {
  return {
    from: startDate ? parseCalendarDate(startDate) : undefined,
    to: endDate ? parseCalendarDate(endDate) : undefined,
  };
}

export function dateRangeToIso(range: { from?: Date; to?: Date } | undefined): {
  startDate: string;
  endDate: string;
} {
  return {
    startDate: range?.from ? toCalendarDateString(range.from) : "",
    endDate: range?.to ? toCalendarDateString(range.to) : "",
  };
}

/** Map a DayPicker range to wire dates. Partial selection updates start only. */
export function applyRangeSelection(
  range: { from?: Date; to?: Date } | undefined,
  opts: NormalizeRangeOptions = {},
): { startDate: string; endDate: string; complete: boolean; valid: boolean } {
  if (!range?.from) {
    return { startDate: "", endDate: "", complete: false, valid: false };
  }
  const startDate = toCalendarDateString(range.from);
  const minNights = opts.minNights ?? 1;
  if (!range.to) {
    return { startDate, endDate: "", complete: false, valid: false };
  }
  const endIso = toCalendarDateString(range.to);
  // DayPicker with min=0 sets from=to on first click; never auto-complete checkout.
  if (endIso <= startDate && minNights > 0) {
    return { startDate, endDate: "", complete: false, valid: false };
  }
  const normalized = normalizeStayRange(startDate, endIso, opts);
  return { ...normalized, complete: true };
}
