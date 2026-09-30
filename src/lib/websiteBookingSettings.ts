import { z } from "zod";

export const WEBSITE_BOOKING_SETTINGS_KEY = "website_booking_settings_v1";
export const MAX_WEBSITE_BOOKING_BEDS = 100;
export const MAX_CALENDAR_HOLIDAYS = 100;

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const calendarHolidaySchema = z.object({
  name: z.string().trim().min(1).max(80),
  date: z.string().refine(validCalendarDate, "Holiday date must be a valid calendar date"),
  recurrence: z.enum(["once", "annual"]),
}).strict();
export type CalendarHoliday = z.infer<typeof calendarHolidaySchema>;

export const websiteBookingSettingsSchema = z.object({
  maxSelectedBeds: z.number().int().min(1).max(MAX_WEBSITE_BOOKING_BEDS).default(4),
  directBookingDiscountPercent: z.number().int().min(0).max(80).default(0),
  advancePercent: z.number().int().min(0).max(100).default(50),
  allowFullPayment: z.boolean().default(true),
  allowPayAtProperty: z.boolean().default(true),
  /** When true (default), My booking requires email OTP. When false, reference+email alone returns the booking. */
  requireLookupOtp: z.boolean().default(true),
  holdMinutes: z.number().int().min(5).max(15).default(15),
  unresolvedPaymentMaxMinutes: z.number().int().min(15).max(30).default(30),
  cancellationDeadlineHours: z.number().int().min(0).max(720).default(48),
  cancellationRefundPercent: z.number().int().min(0).max(100).default(100),
  policyText: z.string().trim().max(4000).default(""),
  calendarHolidays: z.array(calendarHolidaySchema).max(MAX_CALENDAR_HOLIDAYS).default([]),
  gatewayEnvironment: z.enum(["test", "live"]).default("test"),
}).strict().refine((s) => s.unresolvedPaymentMaxMinutes >= s.holdMinutes, {
  message: "Payment review window cannot be shorter than the inventory hold",
  path: ["unresolvedPaymentMaxMinutes"],
});

export type WebsiteBookingSettings = z.infer<typeof websiteBookingSettingsSchema>;
export const DEFAULT_WEBSITE_BOOKING_SETTINGS = websiteBookingSettingsSchema.parse({});

/** Opaque revision binds an edit to the exact saved draft, including absence. */
export async function websiteBookingSettingsRevision(raw: string | null) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw === null ? "missing" : `saved:${raw}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class InvalidWebsiteBookingSettingsError extends Error {
  constructor() {
    super("Saved booking settings are invalid. Review the stored draft before replacing it; defaults have not been activated.");
    this.name = "InvalidWebsiteBookingSettingsError";
  }
}

export function readWebsiteBookingSettings(raw: string | null): WebsiteBookingSettings {
  if (raw === null) return { ...DEFAULT_WEBSITE_BOOKING_SETTINGS };
  try { return websiteBookingSettingsSchema.parse(JSON.parse(raw)); }
  catch { throw new InvalidWebsiteBookingSettingsError(); }
}

/** Readiness metadata only; secret values are never serialized or saved to D1. */
export function gatewayConfiguration(environment: "test" | "live", env: Record<string, string | undefined>) {
  const prefix = environment === "live" ? "RAZORPAY_LIVE" : "RAZORPAY_TEST";
  const id = env[`${prefix}_KEY_ID`] || "";
  const validId = new RegExp(`^rzp_${environment}_[A-Za-z0-9_]+$`).test(id);
  const keySecretConfigured = Boolean(env[`${prefix}_KEY_SECRET`]?.trim());
  const webhookSecretConfigured = Boolean(env[`${prefix}_WEBHOOK_SECRET`]?.trim());
  return {
    environment,
    publicKeyId: validId ? id : "",
    keyIdConfigured: validId,
    keySecretConfigured,
    webhookSecretConfigured,
    credentialsConfigured: validId && keySecretConfigured && webhookSecretConfigured,
    nativeCheckoutReady: false as const,
    status: "pending" as const,
  };
}
