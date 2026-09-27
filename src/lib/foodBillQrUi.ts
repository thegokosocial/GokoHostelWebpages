/**
 * Pure UI rules for food-bill pay QR (My Bills + admin Bill drawer).
 * Kept free of React/fetch so Vitest covers every surface decision.
 */

import { parseBillQrMode, type BillQrMode } from "@/lib/foodBillQrMode";

export type FoodBillQrUiState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "active";
      attemptId: string;
      imageUrl: string | null;
      upiIntent: string | null;
      closeBy: string | null;
      amountPaise: number;
      label: string;
    }
  | { status: "paid"; label: string }
  | { status: "error"; message: string }
  | { status: "static" };

export type FoodQrAttemptPayload = {
  attemptId?: string;
  id?: string;
  state?: string;
  imageUrl?: string | null;
  upiIntent?: string | null;
  closeBy?: string | null;
  amountPaise?: number;
  paymentMethodLabel?: string;
};

/** Menu phone lookup never shows/mints a pay QR; share-token + admin do. */
export function myBillsShowsPayQr(viaToken: boolean): boolean {
  return viaToken;
}

export function myBillsHidePayment(viaToken: boolean): boolean {
  return !viaToken;
}

/** Guest My Bills never shows paid/past history or spend summary chrome. */
export function myBillsShowsPaidHistory(): boolean {
  return false;
}

export function myBillsShowsSpendSummary(): boolean {
  return false;
}

export function isRazorpayBillMode(mode?: string | null): boolean {
  const m = parseBillQrMode(mode);
  return m === "razorpay_test" || m === "razorpay_live";
}

/** Whether the client should call ensure/status for a dynamic Razorpay QR. */
export function shouldEnsureDynamicFoodQr(opts: {
  showPayQr: boolean;
  unpaidOrderCount: number;
  qrMode?: string | null;
  ready: boolean;
}): boolean {
  return opts.showPayQr
    && opts.ready
    && opts.unpaidOrderCount > 0
    && isRazorpayBillMode(opts.qrMode);
}

/** Map a server attempt snapshot to guest/admin QR UI state. */
export function mapFoodQrAttemptToUi(attempt: FoodQrAttemptPayload | null | undefined): FoodBillQrUiState {
  if (!attempt) return { status: "error", message: "No payment QR available" };
  const id = attempt.attemptId || attempt.id || "";
  if (attempt.state === "paid") {
    return { status: "paid", label: attempt.paymentMethodLabel || "Razorpay payment received" };
  }
  const upiIntent = attempt.upiIntent?.trim() || null;
  const imageUrl = attempt.imageUrl?.trim() || null;
  if (attempt.state === "active" && (upiIntent || imageUrl)) {
    return {
      status: "active",
      attemptId: id,
      imageUrl,
      upiIntent,
      closeBy: attempt.closeBy || null,
      amountPaise: attempt.amountPaise || 0,
      label: attempt.paymentMethodLabel || "Pay exact amount via UPI",
    };
  }
  if (attempt.state === "creating" || attempt.state === "qr_unknown" || attempt.state === "expired" || attempt.state === "closed") {
    return { status: "loading" };
  }
  return { status: "error", message: "Payment QR is not ready" };
}

/** Interpret ensure HTTP result before applying attempt mapping. */
export function mapFoodQrEnsureResponse(opts: {
  ok: boolean;
  status: number;
  body: { paid?: boolean; mode?: string; error?: string; attempt?: FoodQrAttemptPayload };
}): FoodBillQrUiState {
  if (opts.status === 409 && opts.body.paid) {
    return { status: "paid", label: "Already paid" };
  }
  if (!opts.ok) {
    if (opts.body.mode === "static" || /not enabled/i.test(String(opts.body.error || ""))) {
      return { status: "static" };
    }
    return { status: "error", message: opts.body.error || "Could not prepare payment QR" };
  }
  return mapFoodQrAttemptToUi(opts.body.attempt);
}

export function parseBillQrModeForUi(raw: string | null | undefined): BillQrMode {
  return parseBillQrMode(raw);
}

export type FoodBillQrStaffCaption =
  | { kind: "loading"; text: string }
  | { kind: "razorpay"; text: string }
  | { kind: "phonepe_static"; text: string }
  | { kind: "phonepe_fallback"; text: string }
  | null;

/**
 * Subtle staff-facing channel label under the bill QR.
 * Distinguishes Razorpay square UPI from Bill Settings PhonePe static (incl. silent fallback).
 */
export function foodBillQrStaffCaption(opts: {
  hidePayment?: boolean;
  dynamicStatus?: "loading" | "active" | "paid" | "error" | "static" | null;
  hasUpiIntent?: boolean;
  razorpayMode?: boolean;
}): FoodBillQrStaffCaption {
  if (opts.hidePayment) return null;
  const status = opts.dynamicStatus ?? null;
  if (status === "paid" || status === "error") return null;
  if (status === "loading") return { kind: "loading", text: "Preparing Razorpay QR…" };
  if (status === "active" && opts.hasUpiIntent) {
    return { kind: "razorpay", text: "Razorpay UPI · exact amount" };
  }
  if (status === "active" && !opts.hasUpiIntent) {
    return { kind: "phonepe_fallback", text: "PhonePe static QR (Razorpay square unavailable)" };
  }
  if (status === "static" || status == null) {
    return { kind: "phonepe_static", text: "PhonePe static QR" };
  }
  return null;
}
