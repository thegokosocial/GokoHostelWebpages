import { getDb } from "@/db";
import {
  nativeAcceptedQuotes, nativeBookingCheckouts, nativeBookingPayments,
  nativeBookingRefunds, nativeBookingWebhooks, nativeInventoryHolds,
} from "@/db/schema";
import { requireNativeHoldGuards } from "@/lib/nativeInventoryHold";
import { isPiRuntime } from "@/lib/runtime";
import {
  razorpayCredentials, razorpayWebhookSecrets, workerEnv, type RazorpayEnvironment,
} from "@/lib/razorpay";
import {
  gatewayConfiguration, readWebsiteBookingSettings, WEBSITE_BOOKING_SETTINGS_KEY,
} from "@/lib/websiteBookingSettings";
import { getSetting, getGuestBookingConfig } from "@/db/queries";
import { bookingDestination } from "@/lib/bookingDestination";

export type CheckoutBlocker =
  | "pi_runtime"
  | "guest_checkout_disabled"
  | "hold_internal_disabled"
  | "hold_guards_missing"
  | "checkout_schema_missing"
  | "destination_not_native"
  | "gateway_credentials_incomplete"
  | "webhook_secret_missing_or_shared"
  | "settings_invalid";

const LABELS: Record<CheckoutBlocker, string> = {
  pi_runtime: "Native guest checkout is Cloudflare-only",
  guest_checkout_disabled: "Set GOKO_NATIVE_GUEST_CHECKOUT_ENABLED=true on the Worker",
  hold_internal_disabled: "Set GOKO_NATIVE_HOLD_INTERNAL_ENABLED=true on the Worker",
  hold_guards_missing: "Apply migration 0059 (hold triggers) on D1",
  checkout_schema_missing: "Apply migrations 0060–0062 (quotes + guest checkout ledger) on D1",
  destination_not_native: "Channel Manager booking URL must be /book",
  gateway_credentials_incomplete: "Configure Razorpay key ID and key secret for the selected gateway environment",
  webhook_secret_missing_or_shared: "Configure a webhook secret for the selected environment; test and live secrets must differ",
  settings_invalid: "Saved website booking settings are invalid",
};

function webhookOk(environment: RazorpayEnvironment, env: Record<string, string | undefined>) {
  const current = razorpayWebhookSecrets(environment, env);
  if (!current.length) return false;
  const other = razorpayWebhookSecrets(environment === "live" ? "test" : "live", env);
  const primary = env[environment === "live" ? "RAZORPAY_LIVE_WEBHOOK_SECRET" : "RAZORPAY_TEST_WEBHOOK_SECRET"] || "";
  if (!primary.trim()) return false;
  return !other.includes(primary);
}

/** Single source for public nativeCheckoutReady + admin blocker list. */
export async function evaluateNativeCheckoutReadiness(env: Record<string, string | undefined> = workerEnv()) {
  const blockers: CheckoutBlocker[] = [];
  if (isPiRuntime()) blockers.push("pi_runtime");
  if (env.GOKO_NATIVE_GUEST_CHECKOUT_ENABLED !== "true") blockers.push("guest_checkout_disabled");
  if (env.GOKO_NATIVE_HOLD_INTERNAL_ENABLED !== "true") blockers.push("hold_internal_disabled");

  let settings;
  try {
    settings = readWebsiteBookingSettings(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY));
  } catch {
    blockers.push("settings_invalid");
    settings = null;
  }
  const environment: RazorpayEnvironment = settings?.gatewayEnvironment ?? "test";

  try {
    const config = await getGuestBookingConfig();
    if (bookingDestination(config?.bookingEngineUrl, config?.apiBaseUrl).mode !== "native") {
      blockers.push("destination_not_native");
    }
  } catch {
    blockers.push("destination_not_native");
  }

  try { razorpayCredentials(environment, env); }
  catch { blockers.push("gateway_credentials_incomplete"); }
  if (!webhookOk(environment, env)) blockers.push("webhook_secret_missing_or_shared");

  try { await requireNativeHoldGuards(); }
  catch { blockers.push("hold_guards_missing"); }

  try {
    const db = getDb();
    await Promise.all([
      db.select().from(nativeAcceptedQuotes).limit(0),
      db.select().from(nativeBookingCheckouts).limit(0),
      db.select().from(nativeBookingPayments).limit(0),
      db.select().from(nativeBookingRefunds).limit(0),
      db.select().from(nativeBookingWebhooks).limit(0),
      db.select().from(nativeInventoryHolds).limit(0),
    ]);
  } catch {
    blockers.push("checkout_schema_missing");
  }

  const gateway = gatewayConfiguration(environment, env);
  const nativeCheckoutReady = blockers.length === 0;
  return {
    nativeCheckoutReady,
    blockers,
    blockerMessages: blockers.map((b) => LABELS[b]),
    paymentOptions: settings ? {
      advancePercent: settings.advancePercent,
      allowFullPayment: settings.allowFullPayment,
      allowPayAtProperty: settings.allowPayAtProperty,
      gatewayEnvironment: environment,
    } : null,
    gateway: { ...gateway, nativeCheckoutReady, status: nativeCheckoutReady ? "ready" as const : "blocked" as const },
  };
}
