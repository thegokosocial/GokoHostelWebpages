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

export type BillPaymentStatusLabel = "Open tab" | "Paid" | "Pending";

export function billPaymentStatusLabel(paymentStatus: string | null | undefined): BillPaymentStatusLabel {
  if (paymentStatus === "paid") return "Paid";
  if (paymentStatus === "on_tab") return "Open tab";
  return "Pending";
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
