/** Shared food-bill branding + CGST/SGST display helpers (display-only; order tax math unchanged). */

export const BILL_SETTINGS_KEYS = [
  "food_bill_hostel_name",
  "food_bill_location",
  "food_bill_accent",
  "food_bill_upi_id",
  "food_bill_payment_qr_url",
  "food_bill_footer",
] as const;

export type BillSettingsKey = (typeof BILL_SETTINGS_KEYS)[number];

export type BillBranding = {
  hostelName: string;
  location: string;
  accent: string;
  upiId: string;
  paymentQrUrl: string;
  footer: string;
};

export const DEFAULT_BILL_BRANDING: BillBranding = {
  hostelName: "Goko Hostel",
  location: "Gokarna, Karnataka",
  accent: "#E67E22",
  upiId: "",
  paymentQrUrl: "",
  footer: "Thanks for dining with us! Visit again",
};

const ACCENT_RE = /^#([0-9A-Fa-f]{6})$/;

export function parseAccentHex(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  return ACCENT_RE.test(s) ? s.toUpperCase() : DEFAULT_BILL_BRANDING.accent;
}

/** Parse #RRGGBB into 0–255 RGB for jsPDF. */
export function accentRgb(hex: string): { r: number; g: number; b: number } {
  const h = parseAccentHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function brandingFromSettings(settings: Record<string, string>): BillBranding {
  return {
    hostelName: (settings.food_bill_hostel_name || "").trim() || DEFAULT_BILL_BRANDING.hostelName,
    location: (settings.food_bill_location || "").trim() || DEFAULT_BILL_BRANDING.location,
    accent: parseAccentHex(settings.food_bill_accent),
    upiId: (settings.food_bill_upi_id || "").trim(),
    paymentQrUrl: (settings.food_bill_payment_qr_url || "").trim(),
    footer: (settings.food_bill_footer || "").trim() || DEFAULT_BILL_BRANDING.footer,
  };
}

/** Split tax paise into CGST + SGST; odd paise goes to CGST. */
export function splitGstPaise(taxPaise: number): { cgst: number; sgst: number } {
  const t = Math.max(0, Math.round(taxPaise || 0));
  const sgst = Math.floor(t / 2);
  return { cgst: t - sgst, sgst };
}

/** Half of food_tax_rate percent for display labels. */
export function splitGstRate(taxPercent: number): { cgstRate: number; sgstRate: number } {
  const rate = Math.max(0, Number(taxPercent) || 0);
  const half = rate / 2;
  return { cgstRate: half, sgstRate: half };
}

export function formatGstRateLabel(rate: number): string {
  if (Number.isInteger(rate)) return String(rate);
  return rate.toFixed(1).replace(/\.0$/, "");
}

export type BillPaymentStatusLabel = "Open tab" | "Paid" | "Partially paid" | "Pending";

export function billPaymentStatusLabel(paymentStatus: string | null | undefined): BillPaymentStatusLabel {
  if (paymentStatus === "paid") return "Paid";
  if (paymentStatus === "partial") return "Partially paid";
  if (paymentStatus === "on_tab") return "Open tab";
  return "Pending";
}

/** Return only the currently payable quantity of an order. */
export function payableBillItems<
  T extends { quantity: number; lineTotal: number; itemPrice?: number; price?: number; status?: string },
>(items: T[], amountPaid: number, total: number, amountRefunded = 0): T[] {
  const netPaid = Math.max(0, (amountPaid || 0) - (amountRefunded || 0));
  let paidRemaining = Math.min(netPaid, Math.max(0, total || 0));
  const result: T[] = [];
  for (const item of items) {
    if (item.status === "voided" || item.quantity <= 0 || item.lineTotal <= 0) continue;
    const payableLine = Math.max(0, item.lineTotal - Math.min(item.lineTotal, paidRemaining));
    paidRemaining = Math.max(0, paidRemaining - item.lineTotal);
    if (payableLine <= 0) continue;
    const unitPrice = item.itemPrice ?? item.price ?? 0;
    const payableQuantity = unitPrice > 0
      ? Math.min(item.quantity, Math.max(1, Math.ceil(payableLine / unitPrice)))
      : item.quantity;
    result.push({ ...item, quantity: payableQuantity, lineTotal: payableLine });
  }
  return result;
}

/** Flatten and coalesce line items by name + unit price (guest tab bill). */
export function mergeBillLineItems<
  T extends { itemName?: string; name?: string; quantity: number; itemPrice?: number; price?: number; lineTotal: number; status?: string },
>(items: T[]): Array<{ itemName: string; quantity: number; itemPrice: number; lineTotal: number; status: string }> {
  const map = new Map<string, { itemName: string; quantity: number; itemPrice: number; lineTotal: number; status: string }>();
  for (const item of items) {
    if (item.status === "voided") continue;
    const itemName = String(item.itemName || item.name || "").trim() || "Item";
    const itemPrice = item.itemPrice ?? item.price ?? 0;
    const key = `${itemName.toLowerCase()}|${itemPrice}`;
    const prev = map.get(key);
    if (prev) {
      prev.quantity += item.quantity;
      prev.lineTotal += item.lineTotal;
    } else {
      map.set(key, {
        itemName,
        quantity: item.quantity,
        itemPrice,
        lineTotal: item.lineTotal,
        status: item.status || "active",
      });
    }
  }
  return [...map.values()];
}

/** Public-safe branding payload for guest APIs. */
export function publicBillBranding(branding: BillBranding) {
  return {
    hostelName: branding.hostelName,
    location: branding.location,
    accent: branding.accent,
    upiId: branding.upiId,
    qrUrl: branding.paymentQrUrl,
    footer: branding.footer,
  };
}
