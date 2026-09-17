import { z } from "zod";

export const WEBSITE_BOOKING_SETTINGS_KEY = "website_booking_settings_v1";
export const websiteBookingSettingsSchema = z.object({
  advancePercent: z.number().int().min(0).max(100).default(50),
  allowFullPayment: z.boolean().default(true),
  allowPayAtProperty: z.boolean().default(true),
  holdMinutes: z.number().int().min(5).max(15).default(15),
  unresolvedPaymentMaxMinutes: z.number().int().min(15).max(30).default(30),
  cancellationDeadlineHours: z.number().int().min(0).max(720).default(48),
  cancellationRefundPercent: z.number().int().min(0).max(100).default(100),
  policyText: z.string().trim().max(4000).default(""),
  gatewayEnvironment: z.enum(["test", "live"]).default("test"),
}).strict().refine((s) => s.unresolvedPaymentMaxMinutes >= s.holdMinutes, {
  message: "Payment review window cannot be shorter than the inventory hold",
  path: ["unresolvedPaymentMaxMinutes"],
});

export type WebsiteBookingSettings = z.infer<typeof websiteBookingSettingsSchema>;
export const DEFAULT_WEBSITE_BOOKING_SETTINGS = websiteBookingSettingsSchema.parse({});

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
    status: "implementation_pending" as const,
  };
}
