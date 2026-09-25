export const BOOKING_TAX_SETTING = "booking_tax_rate";
export const BOOKING_TAX_APPLY_WEBSITE_SETTING = "booking_tax_apply_website";
export const BOOKING_TAX_APPLY_ADMIN_SETTING = "booking_tax_apply_admin";
export const DEFAULT_BOOKING_TAX_PERCENT = 5;

export function directBookingRate(standardRupees: number, percent: number): number {
  const standard = Math.max(1, Math.round(Number(standardRupees) || 0));
  const discount = Math.min(80, Math.max(0, Math.round(Number(percent) || 0)));
  return Math.max(1, Math.round((standard * (100 - discount)) / 100));
}

export type GokoWalkinPricing = {
  discount: number;
  discountPercent?: number;
  discountAmount?: number;
  discountReason?: string;
  taxPercent: number;
  unitPricing?: boolean;
  units?: Array<{ key: string; dormId: number; rate: number }>;
};

export function bookingTaxPercent(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_BOOKING_TAX_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_BOOKING_TAX_PERCENT;
  return Math.min(100, n);
}

/** Absent/empty defaults on so existing installs keep applying tax until unchecked. */
export function bookingTaxApplyEnabled(raw: unknown, defaultOn = true): boolean {
  if (raw == null || raw === "") return defaultOn;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  if (s === "1" || s === "true" || s === "on" || s === "yes") return true;
  return defaultOn;
}

/** Rate when apply is on; 0 when apply is off (even if X% is set). */
export function effectiveBookingTaxPercent(rateRaw: unknown, applyRaw: unknown): number {
  if (!bookingTaxApplyEnabled(applyRaw)) return 0;
  return bookingTaxPercent(rateRaw);
}

export function bookingDiscountRupees(
  gross: number,
  opts: { percent?: unknown; amount?: unknown } = {},
): number {
  const g = Math.max(0, Math.round(Number(gross) || 0));
  const pct = Number(opts.percent);
  if (Number.isFinite(pct) && pct > 0) {
    return Math.min(g, Math.round((g * Math.min(100, Math.max(0, pct))) / 100));
  }
  const amt = Number(opts.amount);
  if (Number.isFinite(amt) && amt > 0) {
    return Math.min(g, Math.round(amt));
  }
  return 0;
}

export function bookingTotals(
  gross: number,
  opts: {
    discount?: number;
    discountPercent?: unknown;
    discountAmount?: unknown;
    taxPercent?: unknown;
  } = {},
): { gross: number; discount: number; beforeTax: number; tax: number; total: number } {
  const g = Math.max(0, Math.round(Number(gross) || 0));
  const discount = opts.discount != null && Number.isFinite(Number(opts.discount))
    ? Math.min(g, Math.max(0, Math.round(Number(opts.discount))))
    : bookingDiscountRupees(g, { percent: opts.discountPercent, amount: opts.discountAmount });
  const beforeTax = g - discount;
  const tax = Math.round((beforeTax * bookingTaxPercent(opts.taxPercent)) / 100);
  return { gross: g, discount, beforeTax, tax, total: beforeTax + tax };
}

export function parseGokoWalkin(raw?: string | null): GokoWalkinPricing | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const w = o?.gokoWalkin;
    if (!w || typeof w !== "object") return null;
    const discountPercent = Number(w.discountPercent);
    const discountAmount = Number(w.discountAmount);
    return {
      discount: Math.max(0, Math.round(Number(w.discount) || 0)),
      discountPercent: Number.isFinite(discountPercent) ? discountPercent : undefined,
      discountAmount: Number.isFinite(discountAmount) ? discountAmount : undefined,
      discountReason: typeof w.discountReason === "string" ? w.discountReason : "",
      taxPercent: bookingTaxPercent(w.taxPercent),
      unitPricing: w.unitPricing === true,
      units: Array.isArray(w.units) ? w.units : undefined,
    };
  } catch {
    return null;
  }
}

export function stringifyGokoWalkin(p: GokoWalkinPricing): string {
  return JSON.stringify({ gokoWalkin: p });
}

/** Merge walk-in pricing into rawData. Returns null when rawData is an Aiosell payload. */
export function patchGokoWalkin(
  raw: string | null | undefined,
  next: GokoWalkinPricing,
): string | null {
  if (!raw) return stringifyGokoWalkin(next);
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return stringifyGokoWalkin(next);
    if (o.gokoWalkin) return JSON.stringify({ ...o, gokoWalkin: next });
    return null;
  } catch {
    return stringifyGokoWalkin(next);
  }
}

export function walkinDiscountOnGross(gross: number, walkin: GokoWalkinPricing | null): number {
  if (!walkin) return 0;
  if (walkin.discountPercent && walkin.discountPercent > 0) {
    return bookingDiscountRupees(gross, { percent: walkin.discountPercent });
  }
  return Math.min(gross, Math.max(0, walkin.discount));
}

export function nextGokoWalkinRaw(
  raw: string | null | undefined,
  source: string | null | undefined,
  pricedDiscount: number,
  taxPercent: number,
  clearDiscount = false,
): string | undefined {
  const walkin = parseGokoWalkin(raw);
  if (!walkin && source !== "manual") return undefined;
  const keepPercent = !clearDiscount && walkin?.discountPercent && walkin.discountPercent > 0;
  const next: GokoWalkinPricing = {
    discount: clearDiscount ? 0 : pricedDiscount,
    discountPercent: keepPercent ? walkin!.discountPercent : undefined,
    discountAmount: !clearDiscount && !keepPercent && walkin?.discountAmount && walkin.discountAmount > 0
      ? walkin.discountAmount
      : undefined,
    discountReason: walkin?.discountReason || undefined,
    taxPercent,
    unitPricing: walkin?.unitPricing,
    units: walkin?.units,
  };
  return patchGokoWalkin(raw, next) ?? undefined;
}
