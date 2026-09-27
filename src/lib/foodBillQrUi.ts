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

/** What GuestFoodBillCard should render in the pay-QR slot. */
export type FoodBillPayQrSource =
  | { kind: "none" }
  | { kind: "intent"; upiIntent: string }
  | { kind: "poster"; imageUrl: string }
  | { kind: "static"; qrUrl: string };

/**
 * Display priority for bill pay QR:
 * 1) Razorpay `upiIntent` (square AutoQrCode)
 * 2) CSS-cropped Razorpay `imageUrl` poster
 * 3) Bill Settings PhonePe/static upload
 */
export function resolveFoodBillPayQrSource(opts: {
  hidePayment?: boolean;
  dynamicStatus?: "loading" | "active" | "paid" | "error" | "static" | null;
  upiIntent?: string | null;
  imageUrl?: string | null;
  staticQrUrl?: string | null;
}): FoodBillPayQrSource {
  if (opts.hidePayment) return { kind: "none" };
  const status = opts.dynamicStatus ?? null;
  if (status === "paid" || status === "loading" || status === "error") {
    return { kind: "none" };
  }
  if (status === "active") {
    const intent = opts.upiIntent?.trim() || "";
    if (intent) return { kind: "intent", upiIntent: intent };
    const poster = opts.imageUrl?.trim() || "";
    if (poster) return { kind: "poster", imageUrl: poster };
  }
  const staticUrl = opts.staticQrUrl?.trim() || "";
  if (staticUrl) return { kind: "static", qrUrl: staticUrl };
  return { kind: "none" };
}

/**
 * Subtle staff-facing channel label under the bill QR.
 * Distinguishes Razorpay UPI (intent or CSS-cropped poster) from Bill Settings PhonePe static.
 */
export function foodBillQrStaffCaption(opts: {
  hidePayment?: boolean;
  dynamicStatus?: "loading" | "active" | "paid" | "error" | "static" | null;
  hasUpiIntent?: boolean;
  /** Active attempt has imageUrl and UI will CSS-crop the poster QR module. */
  hasPosterImage?: boolean;
  razorpayMode?: boolean;
}): FoodBillQrStaffCaption {
  if (opts.hidePayment) return null;
  const status = opts.dynamicStatus ?? null;
  if (status === "paid" || status === "error") return null;
  if (status === "loading") return { kind: "loading", text: "Preparing Razorpay QR…" };
  if (status === "active" && (opts.hasUpiIntent || opts.hasPosterImage)) {
    return { kind: "razorpay", text: "Razorpay UPI · exact amount" };
  }
  if (status === "active") {
    return { kind: "phonepe_fallback", text: "PhonePe static QR (Razorpay square unavailable)" };
  }
  if (status === "static" || status == null) {
    return { kind: "phonepe_static", text: "PhonePe static QR" };
  }
  return null;
}
