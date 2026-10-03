/**
 * Pure UI rules for food-bill pay QR (My Bills + admin Bill drawer).
 * Kept free of React/fetch so Vitest covers every surface decision.
 */

import { parseBillQrMode, type BillQrMode } from "@/lib/foodBillQrMode";

/**
 * Food Received-in dropdown nickname for the Razorpay Website virtual.
 * Applied as an API overlay in getFoodReceiptAccounts — DB nickname stays long.
 */
export const FOOD_RAZORPAY_RECEIPT_NICKNAME = "Razorpay a/c";

/** Shared 409 copy when totals change while a food QR claim is open. */
export const ACTIVE_FOOD_QR_EDIT_BLOCKED =
  "These orders have an active Razorpay QR payment. Wait for it to complete or expire before changing totals or payment.";

export type FoodQrAttemptOutcome =
  | "Paid"
  | "Active"
  | "Expired"
  | "Closed"
  | "Creating"
  | "Needs review"
  | "Unknown";

/** Staff-facing outcome for Management → Razorpay payments → Food (Room-like). */
export function foodQrAttemptOutcome(opts: {
  state: string;
  payments?: Array<{ captured?: number | boolean | null }>;
}): FoodQrAttemptOutcome {
  const hasCapture = (opts.payments || []).some((p) => Number(p.captured) === 1);
  if (opts.state === "paid") return "Paid";
  // Retired/expired QR with a capture that did not settle orders (or needs staff eyes).
  if ((opts.state === "closed" || opts.state === "expired") && hasCapture) return "Needs review";
  if (hasCapture) return "Paid";
  if (opts.state === "expired") return "Expired";
  if (opts.state === "closed") return "Closed";
  if (opts.state === "active") return "Active";
  if (opts.state === "creating" || opts.state === "qr_unknown") return "Creating";
  return "Unknown";
}

export function foodQrAttemptIsCloseable(state: string): boolean {
  return state === "active" || state === "creating" || state === "qr_unknown";
}

/** Ledger Reconcile: open attempts, or closed/expired with a capture (late-settle / review). */
export function foodQrAttemptCanReconcile(opts: {
  state: string;
  qrCodeId?: string | null;
  payments?: Array<{ captured?: number | boolean | null }>;
}): boolean {
  if (!opts.qrCodeId) return false;
  if (opts.state === "active" || opts.state === "creating" || opts.state === "qr_unknown") return true;
  const hasCapture = (opts.payments || []).some((p) => Number(p.captured) === 1);
  return (opts.state === "closed" || opts.state === "expired") && hasCapture;
}

/** Collapse long order-id lists: first `limit` ids + hiddenCount. */
export function formatFoodQrOrderIdsPreview(
  ids: number[],
  opts?: { limit?: number },
): { visible: number[]; hiddenCount: number } {
  const limit = Math.max(1, opts?.limit ?? 3);
  if (ids.length <= limit) return { visible: ids, hiddenCount: 0 };
  return { visible: ids.slice(0, limit), hiddenCount: ids.length - limit };
}

export function parseFoodQrOrderIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseFoodQrOrderIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

/** Inclusive IST calendar days → UTC ISO bounds for `created_at` filters (matches Room ledger). */
export function foodQrCreatedAtBounds(fromDate?: string, toDate?: string): {
  fromIso: string | null;
  toExclusiveIso: string | null;
} {
  const dayStart = (date: string, endExclusive = false): string | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T00:00:00.000+05:30`);
    if (Number.isNaN(parsed.getTime())) return null;
    if (endExclusive) parsed.setTime(parsed.getTime() + 24 * 60 * 60 * 1000);
    return parsed.toISOString();
  };
  return {
    fromIso: fromDate ? dayStart(fromDate) : null,
    toExclusiveIso: toDate ? dayStart(toDate, true) : null,
  };
}

/** Food ledger text search (guest / phone / qr_ / pay_ / order id / attempt id). */
export function foodQrAttemptMatchesQuery(
  row: {
    guestName?: string | null;
    guestPhone?: string | null;
    qrCodeId?: string | null;
    foodOrderIds?: unknown;
    payments?: Array<{ id?: string | null }>;
    id?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const orderIds = parseFoodQrOrderIds(row.foodOrderIds).map(String);
  const hay = [
    row.guestName,
    row.guestPhone,
    row.qrCodeId,
    row.id,
    ...orderIds,
    ...(row.payments || []).map((p) => p.id),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Food order paymentMethod set by Razorpay QR capture (live or test). */
export function isRazorpayFoodPaymentMethod(method?: string | null): boolean {
  return method === "razorpay" || method === "razorpay_test";
}

/** Staff-facing method chips / Settled line (razorpay → Razorpay). */
export function formatFoodPaymentMethodLabel(method: string): string {
  if (isRazorpayFoodPaymentMethod(method)) return "Razorpay";
  return method;
}

/** Unique labels for bill Settled footer, e.g. " · Razorpay, online". */
export function formatFoodBillSettledMethods(
  methods: Array<string | null | undefined>,
): string {
  const labels = [...new Set(
    methods
      .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      .map((m) => formatFoodPaymentMethodLabel(m.trim())),
  )];
  return labels.length ? ` · ${labels.join(", ")}` : "";
}

/** Whether paid-notify should fire (once per attempt lifecycle). */
export function shouldNotifyFoodQrPaid(prevNotified: boolean, status: string): boolean {
  return !prevNotified && status === "paid";
}

/** markOrderPaid 409 when Razorpay (or prior desk pay) already zeroed the due. */
export function isFoodOrderAlreadySettledError(message: string | null | undefined): boolean {
  return /every selected order must have an outstanding balance/i.test(String(message || ""));
}

/** Pick Received-in id for food Record Payment (empty while QR active). */
export function pickFoodOnlineAccountId(opts: {
  accounts: { id: number; nickname?: string | null }[];
  requireAccountPick?: boolean;
  preferRazorpay?: boolean;
  foodOnlineReceiptAccountId?: string | number | null;
}): string {
  if (opts.requireAccountPick) return "";
  if (opts.preferRazorpay) {
    const rzp = opts.accounts.find(
      (a) => (a.nickname || "").trim() === FOOD_RAZORPAY_RECEIPT_NICKNAME,
    );
    if (rzp) return String(rzp.id);
  }
  const def = opts.foodOnlineReceiptAccountId;
  if (def != null && String(def).trim() !== "") return String(def);
  return "";
}

export type FoodBillQrUiState =
  | { status: "idle" }
  | { status: "loading"; attemptId?: string }
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

/** Bill drawer / Save: open Razorpay QR (active or still preparing). */
export function foodBillQrUiLocksEdits(status: FoodBillQrUiState["status"]): boolean {
  return status === "active" || status === "loading";
}

/** Attempt id for Retire when UI is active or creating/qr_unknown loading. */
export function foodBillQrRetireAttemptId(state: FoodBillQrUiState): string | null {
  if (state.status === "active" && state.attemptId) return state.attemptId;
  if (state.status === "loading" && state.attemptId) return state.attemptId;
  return null;
}

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
  if (attempt.state === "creating" || attempt.state === "qr_unknown") {
    return id ? { status: "loading", attemptId: id } : { status: "loading" };
  }
  if (attempt.state === "expired" || attempt.state === "closed") {
    return { status: "loading" };
  }
  return { status: "error", message: "Payment QR is not ready" };
}

/** Interpret ensure HTTP result before applying attempt mapping. */
export function mapFoodQrEnsureResponse(opts: {
  ok: boolean;
  status: number;
  admin?: boolean;
  body: { paid?: boolean; mode?: string; error?: string; attempt?: FoodQrAttemptPayload };
}): FoodBillQrUiState {
  if (opts.status === 409 && opts.body.paid) {
    return { status: "paid", label: "Already paid" };
  }
  if (!opts.ok) {
    if (opts.body.mode === "static" || /not enabled/i.test(String(opts.body.error || ""))) {
      return { status: "static" };
    }
    if (opts.status === 401) {
      return { status: "error", message: "Your admin session expired. Sign in again to create a Razorpay QR." };
    }
    if (opts.status === 403) {
      return { status: "error", message: opts.admin
        ? "You do not have permission to create a Razorpay QR."
        : opts.body.error || "This bill link cannot create a payment QR." };
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
  /** Combined bills may intentionally fall back to their configured static QR after Razorpay fails. */
  fallbackToStaticOnDynamicError?: boolean;
}): FoodBillPayQrSource {
  if (opts.hidePayment) return { kind: "none" };
  const status = opts.dynamicStatus ?? null;
  if (status === "paid" || status === "loading" || (status === "error" && !opts.fallbackToStaticOnDynamicError)) {
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
  fallbackToStaticOnDynamicError?: boolean;
}): FoodBillQrStaffCaption {
  if (opts.hidePayment) return null;
  const status = opts.dynamicStatus ?? null;
  if (status === "paid") return null;
  if (status === "error") {
    if (!opts.fallbackToStaticOnDynamicError) return null;
    return opts.hasUpiIntent || opts.hasPosterImage
      ? null
      : { kind: "phonepe_fallback", text: "Razorpay unavailable · PhonePe static QR" };
  }
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
