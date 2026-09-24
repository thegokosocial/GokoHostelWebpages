import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  nativeBookingCheckouts as checkouts,
  nativeBookingPayments as payments,
} from "@/db/schema";
import { isPiRuntime } from "@/lib/runtime";
import {
  RazorpayError,
  fetchRazorpayBookingPayment,
  razorpayId,
} from "@/lib/razorpay";
import { applyManualGatewayFees, mergeProviderGatewayFees } from "@/lib/platformReceivables";

export class WebsiteGatewayFeeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "WebsiteGatewayFeeError";
  }
}

function cloudOnly() {
  if (isPiRuntime()) throw new WebsiteGatewayFeeError("Website gateway fees are available on the Goko website only", 403);
}

const timestamp = () => new Date().toISOString();

async function loadLiveCapturedWebsitePayment(paymentId: string) {
  cloudOnly();
  const id = razorpayId("pay").parse(paymentId);
  const rows = await getDb().select({
    payment: payments,
    checkout: checkouts,
  }).from(payments)
    .innerJoin(checkouts, eq(payments.checkoutId, checkouts.id))
    .where(eq(payments.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new WebsiteGatewayFeeError("Website payment not found", 404);
  if (!row.payment.captured || row.checkout.environment !== "live") {
    throw new WebsiteGatewayFeeError("Only captured live website payments can update gateway fees", 400);
  }
  return row;
}

/** Fetch Razorpay payment evidence and write fee/tax only (provider non-null wins). */
export async function refreshWebsitePaymentGatewayFees(paymentId: string) {
  const row = await loadLiveCapturedWebsitePayment(paymentId);
  const evidence = await fetchRazorpayBookingPayment(row.payment.id, "live");
  if (evidence.id !== row.payment.id || !row.checkout.razorpayOrderId || evidence.order_id !== row.checkout.razorpayOrderId) {
    throw new RazorpayError("MISMATCH");
  }
  const merged = mergeProviderGatewayFees(
    { feePaise: row.payment.feePaise, taxPaise: row.payment.taxPaise },
    { fee: evidence.fee, tax: evidence.tax },
  );
  if (merged.changed) {
    await getDb().update(payments).set({
      feePaise: merged.feePaise, taxPaise: merged.taxPaise, verifiedAt: timestamp(),
    }).where(eq(payments.id, row.payment.id));
  }
  return {
    paymentId: row.payment.id,
    feePaise: merged.feePaise,
    taxPaise: merged.taxPaise,
    changed: merged.changed,
    stillPending: merged.feePaise == null || merged.taxPaise == null,
  };
}

/** Manual fee/tax only for still-null fields on a captured live website payment. */
export async function setWebsitePaymentGatewayFees(
  paymentId: string,
  manual: { feePaise?: number | null; taxPaise?: number | null },
) {
  const row = await loadLiveCapturedWebsitePayment(paymentId);
  const next = applyManualGatewayFees(
    { feePaise: row.payment.feePaise, taxPaise: row.payment.taxPaise },
    manual,
  );
  await getDb().update(payments).set({
    feePaise: next.feePaise, taxPaise: next.taxPaise, verifiedAt: timestamp(),
  }).where(eq(payments.id, row.payment.id));
  return {
    paymentId: row.payment.id,
    feePaise: next.feePaise,
    taxPaise: next.taxPaise,
    stillPending: next.feePaise == null || next.taxPaise == null,
  };
}

/** Refresh all live captured payments that still miss fee and/or tax. */
export async function refreshPendingWebsitePaymentGatewayFees() {
  cloudOnly();
  const pending = await getDb().select({ paymentId: payments.id }).from(payments)
    .innerJoin(checkouts, eq(payments.checkoutId, checkouts.id))
    .where(and(
      eq(payments.captured, 1),
      sql`${checkouts.environment} = 'live'`,
      sql`(${payments.feePaise} IS NULL OR ${payments.taxPaise} IS NULL)`,
    ));
  const results: Array<Awaited<ReturnType<typeof refreshWebsitePaymentGatewayFees>> & { error?: string }> = [];
  for (const row of pending) {
    try {
      results.push(await refreshWebsitePaymentGatewayFees(row.paymentId));
    } catch (error) {
      results.push({
        paymentId: row.paymentId, feePaise: null, taxPaise: null, changed: false, stillPending: true,
        error: error instanceof Error ? error.message : "Refresh failed",
      });
    }
  }
  return {
    attempted: pending.length,
    updated: results.filter((row) => row.changed).length,
    stillPending: results.filter((row) => row.stillPending).length,
    results,
  };
}
