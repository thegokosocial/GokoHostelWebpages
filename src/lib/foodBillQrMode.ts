/**
 * Food bill QR payment mode: static QR image, Razorpay test, or Razorpay live.
 * The setting `food_bill_qr_mode` is stored in the settings table and controls
 * which payment flow the guest-facing bill uses.
 */

import type { RazorpayEnvironment } from "./razorpay";

export const BILL_QR_MODE_KEY = "food_bill_qr_mode" as const;

export type BillQrMode = "static" | "razorpay_test" | "razorpay_live";

const VALID_MODES: readonly BillQrMode[] = ["static", "razorpay_test", "razorpay_live"] as const;

/** Parse a raw setting value into a valid mode; unknown/missing falls back to "static". */
export function parseBillQrMode(raw: string | null | undefined): BillQrMode {
  const s = String(raw || "").trim().toLowerCase();
  return (VALID_MODES as readonly string[]).includes(s) ? (s as BillQrMode) : "static";
}

/** Razorpay environment implied by a mode, or null for static. */
export function environmentFromMode(mode: BillQrMode): RazorpayEnvironment | null {
  if (mode === "razorpay_test") return "test";
  if (mode === "razorpay_live") return "live";
  return null;
}

/**
 * Effective mode after checking whether Razorpay credentials are plausible.
 * If the requested mode is razorpay_* but credentials are missing/malformed,
 * falls back to "static" so the bill still renders with the static QR.
 */
export function effectiveMode(
  mode: BillQrMode,
  env: Record<string, string | undefined>,
): BillQrMode {
  const rzpEnv = environmentFromMode(mode);
  if (!rzpEnv) return "static";
  const prefix = rzpEnv === "live" ? "RAZORPAY_LIVE" : "RAZORPAY_TEST";
  const keyId = env[`${prefix}_KEY_ID`] || "";
  const keySecret = env[`${prefix}_KEY_SECRET`] || "";
  const idOk = new RegExp(`^rzp_${rzpEnv}_[A-Za-z0-9_]+$`).test(keyId);
  if (!idOk || !keySecret.trim()) return "static";
  return mode;
}

/** Quick readiness check without throwing — returns which modes have plausible credentials. */
export function qrModeReadiness(env: Record<string, string | undefined>): Record<BillQrMode, boolean> {
  return {
    static: true,
    razorpay_test: effectiveMode("razorpay_test", env) === "razorpay_test",
    razorpay_live: effectiveMode("razorpay_live", env) === "razorpay_live",
  };
}
