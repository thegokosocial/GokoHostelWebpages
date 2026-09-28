import { and, desc, eq, gte, inArray, like, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  foodQrAttempts as attempts, foodQrOrderClaims as claims,
  foodQrPayments as payments, foodQrWebhooks as hooks, foodOrders,
} from "@/db/schema";
import { getSetting, getFoodOrdersByIds, getFoodOrderItemsBatch, updateFoodOrderPayment } from "@/db/queries";
import { foodDue, foodAmountPaid } from "@/lib/foodPaymentBalance";
import { parseBillQrMode, effectiveMode, environmentFromMode, BILL_QR_MODE_KEY } from "@/lib/foodBillQrMode";
import { foodQrCreatedAtBounds } from "@/lib/foodBillQrUi";
import { isPiRuntime } from "@/lib/runtime";
import {
  RazorpayError, razorpayCredentials, workerEnv,
  createRazorpayFoodQr, fetchRazorpayFoodQr, fetchRazorpayFoodQrPayments,
  closeRazorpayFoodQr, razorpayId, allRazorpayWebhookSecrets,
  verifyRazorpaySignature,
  type RazorpayQrPayment, type RazorpayEnvironment,
} from "@/lib/razorpay";
import { collectInBatches } from "@/lib/dbBatch";

type Attempt = typeof attempts.$inferSelect;
const timestamp = () => new Date().toISOString();

export class FoodQrError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "FoodQrError"; }
}

function cloudOnly() {
  if (isPiRuntime()) throw new FoodQrError("Food QR payments are Cloudflare-owned and unavailable on Pi", 403);
}

// --- Pure helpers (unit-testable without DB) ---

export type OrderSnapshotEntry = { orderId: number; duePaise: number; priorPaidPaise: number; total: number };

type AttemptNotes = {
  orderSnapshot?: OrderSnapshotEntry[];
  fingerprint?: string;
  upiIntent?: string;
  exceptions?: string[];
  lateCapture?: {
    reason: string;
    paymentId: string;
    capturedPaise: number;
    currentDuePaise: number;
    snapshotDuePaise: number;
    at: string;
  };
};

/** Pure gate for late capture after Retire/edit closed the QR (unit-tested). */
export function decideLateFoodQrCapture(opts: {
  captureAmountPaise: number;
  snapshotDuePaise: number;
  currentDuePaise: number;
}): "apply" | "ignore" | "review" {
  const capture = Math.trunc(opts.captureAmountPaise);
  const snapshot = Math.trunc(opts.snapshotDuePaise);
  const current = Math.trunc(opts.currentDuePaise);
  if (!(capture > 0) || !(snapshot > 0)) return "review";
  // Bill already settled (desk pay / prior apply) — do not double-settle.
  if (current <= 0) return "ignore";
  // Safe only when capture matches both the original QR due and today's unpaid due.
  if (capture === snapshot && capture === current) return "apply";
  return "review";
}

function parseAttemptNotes(raw: string | null | undefined): AttemptNotes {
  try {
    return (JSON.parse(String(raw || "{}")) || {}) as AttemptNotes;
  } catch {
    return {};
  }
}

function upiIntentFromNotes(raw: string | null | undefined): string | null {
  const intent = parseAttemptNotes(raw).upiIntent?.trim();
  return intent && intent.length > 0 ? intent : null;
}

export function buildFingerprint(entries: OrderSnapshotEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.orderId - b.orderId);
  return sorted.map((e) => `${e.orderId}:${e.duePaise}`).join("|");
}

/** Order money fields are already integer paise — do not scale by 100. */
export function buildOrderSnapshot(orders: Array<{ id: number; total: number; amountPaid?: number | null; amountRefunded?: number | null; paymentStatus?: string | null }>): OrderSnapshotEntry[] {
  return orders.map((o) => ({
    orderId: o.id,
    duePaise: foodDue(o),
    priorPaidPaise: foodAmountPaid(o),
    total: o.total,
  }));
}

export function snapshotTotalDuePaise(entries: OrderSnapshotEntry[]): number {
  return entries.reduce((s, e) => s + e.duePaise, 0);
}

/** Label for the QR payment method shown in UI. */
export function paymentMethodLabel(env: RazorpayEnvironment): string {
  return env === "live" ? "razorpay" : "razorpay_test";
}

// --- DB operations ---

async function resolveMode() {
  const raw = await getSetting(BILL_QR_MODE_KEY);
  const parsed = parseBillQrMode(raw);
  const env = workerEnv();
  const mode = effectiveMode(parsed, env);
  const rzpEnv = environmentFromMode(mode);
  if (!rzpEnv) throw new FoodQrError("Food QR payments require Razorpay mode (not static)", 400);
  razorpayCredentials(rzpEnv, env);
  return { mode, rzpEnv, env };
}

/** Create (or recover) a QR attempt for the given food orders. Idempotent on fingerprint and requestKey. */
export async function createFoodQrAttempt(input: { requestKey: string; orderIds: number[]; createdBy: string }) {
  cloudOnly();
  z.string().uuid().parse(input.requestKey);
  if (!input.orderIds.length) throw new FoodQrError("No orders specified", 400);
  const { rzpEnv } = await resolveMode();

  // Load orders — unpaid / non-cancelled only
  const loaded = await getFoodOrdersByIds(input.orderIds);
  const orders = loaded.filter((o) => o.status !== "cancelled" && foodDue(o) > 0);
  if (!orders.length) throw new FoodQrError("No active unpaid orders found", 404);

  // Check pending pricing
  const itemsMap = await getFoodOrderItemsBatch(orders.map((o) => o.id));
  for (const order of orders) {
    const items = itemsMap.get(order.id) || [];
    if (items.some((item) => item.pricingStatus === "pending")) {
      throw new FoodQrError(`Order ${order.orderNumber} has items with pending pricing`, 400);
    }
  }

  const snapshot = buildOrderSnapshot(orders);
  const totalDuePaise = snapshotTotalDuePaise(snapshot);
  if (totalDuePaise < 100) throw new FoodQrError("Total due must be at least ₹1 (100 paise)", 400);

  const fingerprint = buildFingerprint(snapshot);
  const db = getDb();

  // Idempotent: return existing active attempt for same fingerprint
  const activeStates = ["creating", "qr_unknown", "active"];
  const existing = await db.select().from(attempts)
    .where(and(inArray(attempts.state, activeStates)))
    .limit(100);
  for (const row of existing) {
    try {
      const notes = JSON.parse(row.notes) as { fingerprint?: string };
      if (notes.fingerprint === fingerprint) return foodQrSnapshot(row.id);
    } catch { /* skip malformed */ }
  }

  // requestKey uniqueness
  const id = crypto.randomUUID();
  const now = timestamp();
  const creds = razorpayCredentials(rzpEnv);
  const notesJson = JSON.stringify({ orderSnapshot: snapshot, fingerprint });
  const orderIdsJson = JSON.stringify(orders.map((o) => o.id));

  // Gather guest info from first order with checkinId
  const firstOrder = orders[0];
  const checkinId = firstOrder.checkinId ?? null;
  const guestName = firstOrder.guestName || "";
  const guestPhone = firstOrder.guestPhone || "";

  const inserted = await db.insert(attempts).values({
    id,
    requestKey: input.requestKey,
    environment: rzpEnv,
    keyId: creds.keyId,
    paymentAmountPaise: totalDuePaise,
    snapshotDuePaise: totalDuePaise,
    state: "creating",
    foodOrderIds: orderIdsJson,
    checkinId,
    guestName,
    guestPhone,
    notes: notesJson,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: attempts.requestKey }).returning();

  if (!inserted.length) {
    const [old] = await db.select().from(attempts).where(eq(attempts.requestKey, input.requestKey)).limit(1);
    if (!old) throw new FoodQrError("Unable to recover the QR request", 503);
    return foodQrSnapshot(old.id);
  }

  // Insert claims — the unique partial index enforces one active claim per order
  try {
    for (const order of orders) {
      await db.insert(claims).values({
        attemptId: id, orderId: order.id, claimedAt: now,
      });
    }
  } catch {
    // Unique constraint on active claims → another attempt already holds these orders
    await db.update(attempts).set({ state: "closed", updatedAt: timestamp() }).where(eq(attempts.id, id));
    throw new FoodQrError("Orders have an active Razorpay QR attempt", 409);
  }

  // Prefer a long-lived single-use QR (unpaid bills / WhatsApp image). Razorpay
  // may clamp close_by — always persist the echoed value. On clamp/reject, retry without close_by.
  const requestedCloseBy = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  try {
    let qr;
    try {
      qr = await createRazorpayFoodQr({ amountPaise: totalDuePaise, attemptId: id, closeBy: requestedCloseBy, environment: rzpEnv });
    } catch {
      qr = await createRazorpayFoodQr({ amountPaise: totalDuePaise, attemptId: id, environment: rzpEnv });
    }
    const [creating] = await db.select().from(attempts).where(eq(attempts.id, id)).limit(1);
    const notes = parseAttemptNotes(creating?.notes);
    if (qr.image_content?.trim()) notes.upiIntent = qr.image_content.trim();
    await db.update(attempts).set({
      qrCodeId: qr.id,
      qrImageUrl: qr.image_url,
      closeBy: qr.close_by ? new Date(qr.close_by * 1000).toISOString() : null,
      notes: JSON.stringify(notes),
      state: "active",
      updatedAt: timestamp(),
    }).where(and(eq(attempts.id, id), ne(attempts.state, "active")));
  } catch {
    // Unknown result — never retry POST (create_unknown)
    await db.update(attempts).set({ state: "qr_unknown", updatedAt: timestamp() })
      .where(and(eq(attempts.id, id), ne(attempts.state, "active")));
  }

  return foodQrSnapshot(id);
}

export async function getFoodQrAttempt(attemptId: string) {
  cloudOnly();
  z.string().uuid().parse(attemptId);
  return foodQrSnapshot(attemptId);
}

export async function getActiveFoodQrForOrders(orderIds: number[]) {
  cloudOnly();
  if (!orderIds.length) return null;
  const db = getDb();
  // Find an active claim for any of the given orders
  const activeClaims = await collectInBatches(orderIds, (batch) =>
    db.select({ attemptId: claims.attemptId }).from(claims)
      .where(and(inArray(claims.orderId, batch), sql`${claims.releasedAt} IS NULL`))
      .limit(1),
  );
  if (!activeClaims.length) return null;
  const attemptId = activeClaims[0].attemptId;
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt || !["creating", "qr_unknown", "active"].includes(attempt.state)) return null;
  return foodQrSnapshot(attemptId);
}

/**
 * For an unpaid bill: return a scannable QR. If the previous attempt expired/closed
 * unpaid, release it and mint a new single-use QR for the current due. Paid attempts
 * are never regenerated (single-use QR is already closed at Razorpay).
 * Reuses an active attempt only when fingerprint + order-set still match.
 */
export async function ensureActiveFoodQrForOrders(input: {
  requestKey: string;
  orderIds: number[];
  createdBy: string;
}) {
  cloudOnly();
  const loaded = await getFoodOrdersByIds(input.orderIds);
  const unpaid = loaded.filter((o) => o.status !== "cancelled" && foodDue(o) > 0);
  if (!unpaid.length) throw new FoodQrError("No active unpaid orders found", 404);
  const currentFingerprint = buildFingerprint(buildOrderSnapshot(unpaid));
  const currentOrderKey = unpaid.map((o) => o.id).sort((a, b) => a - b).join(",");

  const existing = await getActiveFoodQrForOrders(unpaid.map((o) => o.id));
  if (existing) {
    const [row] = await getDb().select().from(attempts).where(eq(attempts.id, existing.attemptId)).limit(1);
    let existingFp = "";
    let existingOrderKey = "";
    try {
      existingFp = String((JSON.parse(row?.notes || "{}") as { fingerprint?: string }).fingerprint || "");
    } catch { /* ignore */ }
    try {
      const ids = JSON.parse(row?.foodOrderIds || "[]") as number[];
      existingOrderKey = ids.filter((n) => Number.isFinite(n)).sort((a, b) => a - b).join(",");
    } catch { /* ignore */ }
    const fingerprintMatch = existingFp === currentFingerprint && existingOrderKey === currentOrderKey;

    if (fingerprintMatch && existing.state === "active" && existing.imageUrl) {
      if (existing.closeBy && new Date(existing.closeBy).getTime() <= Date.now()) {
        const reconciled = await reconcileFoodQrAttempt(existing.attemptId).catch(() => existing);
        if (reconciled.state === "paid") return reconciled;
        if (["expired", "closed"].includes(reconciled.state) ||
            (reconciled.state === "active" && reconciled.closeBy && new Date(reconciled.closeBy).getTime() <= Date.now())) {
          // Past close_by — retire at Razorpay then remint below.
          await finalizeOpenFoodQrAttempt(existing.attemptId, "expired").catch((error) => {
            if (error instanceof FoodQrError && error.status === 409) throw error;
          });
        } else {
          return reconciled;
        }
      } else {
        return existing;
      }
    } else if (fingerprintMatch && (existing.state === "qr_unknown" || existing.state === "creating")) {
      return reconcileFoodQrAttempt(existing.attemptId).catch(() => existing);
    } else if (!fingerprintMatch) {
      // Due/order-set changed — provider-close + expire so a new QR can be minted.
      const reconciled = await reconcileFoodQrAttempt(existing.attemptId).catch(() => existing);
      if (reconciled.state === "paid") return reconciled;
      await finalizeOpenFoodQrAttempt(existing.attemptId, "expired");
    }
  }
  return createFoodQrAttempt({ ...input, orderIds: unpaid.map((o) => o.id) });
}

/** Reconcile: fetch QR status + payments from Razorpay; apply captures; late-settle closed/expired. */
export async function reconcileFoodQrAttempt(attemptId: string) {
  cloudOnly();
  z.string().uuid().parse(attemptId);
  const db = getDb();
  let [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new FoodQrError("Attempt not found", 404);
  if (attempt.state === "paid") return foodQrSnapshot(attemptId);

  const rzpEnv = attempt.environment as RazorpayEnvironment;
  const qrCodeId = attempt.qrCodeId;
  const terminalRetired = attempt.state === "closed" || attempt.state === "expired";

  if (qrCodeId) {
    // Fetch QR status (best-effort on retired attempts — still need payment list)
    let qr: Awaited<ReturnType<typeof fetchRazorpayFoodQr>> | null = null;
    try {
      qr = await fetchRazorpayFoodQr(qrCodeId, rzpEnv);
    } catch (error) {
      if (!terminalRetired) throw error;
    }

    if (qr?.image_content?.trim() && !upiIntentFromNotes(attempt.notes)) {
      const notes = parseAttemptNotes(attempt.notes);
      notes.upiIntent = qr.image_content.trim();
      await db.update(attempts).set({ notes: JSON.stringify(notes), updatedAt: timestamp() })
        .where(eq(attempts.id, attemptId));
      attempt = { ...attempt, notes: JSON.stringify(notes) };
    }

    const qrPayments = await fetchRazorpayFoodQrPayments(qrCodeId, rzpEnv);
    const cap = qrPayments.find((p) => p.captured);
    if (cap) {
      await settleFoodQrCapture(attempt, cap);
    } else if (!terminalRetired && qr?.status === "closed") {
      if (qr.close_reason === "paid") {
        throw new FoodQrError("QR closed as paid but capture evidence is not ready yet", 503);
      }
      await releaseClaims(attemptId);
      await db.update(attempts).set({ state: "expired", updatedAt: timestamp() }).where(eq(attempts.id, attemptId));
    }
  }

  return foodQrSnapshot(attemptId);
}

async function recordFoodQrPayment(attempt: Attempt, evidence: RazorpayQrPayment) {
  const captured = evidence.captured && ["captured", "refunded"].includes(evidence.status) ? 1 : 0;
  await getDb().insert(payments).values({
    id: evidence.id,
    attemptId: attempt.id,
    amountPaise: evidence.amount,
    status: evidence.status,
    captured,
    refundedPaise: evidence.amount_refunded,
    feePaise: evidence.fee ?? null,
    taxPaise: evidence.tax ?? null,
    method: evidence.method ?? null,
    verifiedAt: timestamp(),
  }).onConflictDoUpdate({
    target: payments.id,
    set: {
      captured: sql`MAX(${payments.captured}, ${captured})`,
      refundedPaise: sql`MAX(${payments.refundedPaise}, ${evidence.amount_refunded})`,
      status: sql`CASE WHEN ${payments.status} = 'refunded' THEN 'refunded'
        WHEN ${payments.captured} = 1 AND ${captured} = 0 THEN ${payments.status}
        WHEN ${payments.status} = 'authorized' AND ${evidence.status} = 'created' THEN ${payments.status}
        ELSE ${evidence.status} END`,
      method: evidence.method ?? sql`${payments.method}`,
      feePaise: evidence.fee ?? sql`${payments.feePaise}`,
      taxPaise: evidence.tax ?? sql`${payments.taxPaise}`,
      verifiedAt: timestamp(),
    },
    setWhere: eq(payments.attemptId, attempt.id),
  });
}

async function markLateCaptureReview(
  attempt: Attempt,
  evidence: RazorpayQrPayment,
  reason: string,
  currentDuePaise: number,
  snapshotDuePaise: number,
) {
  const notes = parseAttemptNotes(attempt.notes);
  notes.lateCapture = {
    reason,
    paymentId: evidence.id,
    capturedPaise: evidence.amount,
    currentDuePaise,
    snapshotDuePaise,
    at: timestamp(),
  };
  await getDb().update(attempts).set({
    notes: JSON.stringify(notes),
    updatedAt: timestamp(),
  }).where(eq(attempts.id, attempt.id));
}

/**
 * Apply capture for open attempts, or safely late-apply when Retire/edit already closed the QR.
 * Mismatch / already-settled → record review metadata; never double-settle.
 */
export async function settleFoodQrCapture(attempt: Attempt, evidence: RazorpayQrPayment): Promise<"applied" | "ignored" | "review"> {
  if (!evidence.captured) throw new FoodQrError("Payment not captured", 400);
  await recordFoodQrPayment(attempt, evidence);

  if (attempt.state === "paid") return "ignored";

  const notes = parseAttemptNotes(attempt.notes);
  const snapshot = notes.orderSnapshot || [];
  const snapshotDue = snapshotTotalDuePaise(snapshot);
  let orderIds = snapshot.map((e) => e.orderId).filter((n) => Number.isInteger(n) && n > 0);
  if (!orderIds.length) {
    try {
      orderIds = (JSON.parse(attempt.foodOrderIds || "[]") as unknown[])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
    } catch {
      orderIds = [];
    }
  }
  const loaded = orderIds.length ? await getFoodOrdersByIds(orderIds) : [];
  const currentDue = loaded
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + foodDue(o), 0);

  const open = OPEN_FOOD_QR_STATES.includes(attempt.state as typeof OPEN_FOOD_QR_STATES[number]);
  if (open) {
    await applyRazorpayCapture(attempt, evidence);
    return "applied";
  }

  if (attempt.state !== "closed" && attempt.state !== "expired") {
    return "ignored";
  }

  const decision = decideLateFoodQrCapture({
    captureAmountPaise: evidence.amount,
    snapshotDuePaise: snapshotDue,
    currentDuePaise: currentDue,
  });
  if (decision === "apply") {
    await applyRazorpayCapture(attempt, evidence);
    return "applied";
  }
  if (decision === "ignore") {
    await markLateCaptureReview(attempt, evidence, "already_settled", currentDue, snapshotDue);
    return "ignored";
  }
  await markLateCaptureReview(attempt, evidence, "amount_mismatch", currentDue, snapshotDue);
  return "review";
}

/**
 * Apply a captured Razorpay QR payment to the food orders in the snapshot.
 * Sets paymentMethod=razorpay (or razorpay_test), paidBy=razorpay.
 * Does NOT create guest_receipts.
 */
export async function applyRazorpayCapture(attempt: Attempt, evidence: RazorpayQrPayment) {
  const db = getDb();
  if (!evidence.captured) throw new FoodQrError("Payment not captured", 400);

  let snapshot: OrderSnapshotEntry[];
  try {
    const notes = JSON.parse(attempt.notes) as { orderSnapshot?: OrderSnapshotEntry[] };
    snapshot = notes.orderSnapshot || [];
  } catch { throw new FoodQrError("Corrupt attempt snapshot", 500); }

  if (!snapshot.length) throw new FoodQrError("Empty snapshot", 500);
  const snapshotTotal = snapshotTotalDuePaise(snapshot);
  if (evidence.amount < snapshotTotal) {
    throw new FoodQrError("Captured amount is less than snapshot due", 400);
  }

  const rzpEnv = attempt.environment as RazorpayEnvironment;
  const method = paymentMethodLabel(rzpEnv);
  const exceptions: string[] = [];

  for (const entry of snapshot) {
    // Re-read order to check current state
    const [order] = await db.select().from(foodOrders).where(eq(foodOrders.id, entry.orderId)).limit(1);
    if (!order) { exceptions.push(`order ${entry.orderId} not found`); continue; }
    if (order.status === "cancelled") {
      exceptions.push(`order ${entry.orderId} cancelled before capture`);
      continue;
    }
    if (order.paymentStatus === "paid" && order.paymentMethod !== method) {
      // Already paid by another method — don't double-apply
      exceptions.push(`order ${entry.orderId} already paid via ${order.paymentMethod}`);
      continue;
    }

    const newPaidPaise = entry.priorPaidPaise + entry.duePaise;
    await updateFoodOrderPayment(entry.orderId, {
      paymentStatus: "paid",
      paymentMethod: method,
      paidBy: "razorpay",
    });
    await db.update(foodOrders).set({
      amountPaid: newPaidPaise,
      updatedAt: new Date().toISOString(),
    }).where(eq(foodOrders.id, entry.orderId));
  }

  // Release claims
  await releaseClaims(attempt.id);

  // Update attempt state
  const stateNotes = exceptions.length
    ? JSON.stringify({ ...JSON.parse(attempt.notes), exceptions })
    : attempt.notes;
  await db.update(attempts).set({
    state: "paid",
    notes: stateNotes,
    updatedAt: timestamp(),
  }).where(eq(attempts.id, attempt.id));
}

async function releaseClaims(attemptId: string) {
  await getDb().update(claims).set({ releasedAt: timestamp() })
    .where(and(eq(claims.attemptId, attemptId), sql`${claims.releasedAt} IS NULL`));
}

/** Check if any of the given orders have an active (unreleased) food QR claim. */
export async function hasActiveFoodQrClaim(orderIds: number[]): Promise<boolean> {
  if (!orderIds.length) return false;
  // Pi has no food_qr_* tables (0083 skipped) — treat as no claims.
  if (isPiRuntime()) return false;
  try {
    const rows = await collectInBatches(orderIds, (batch) =>
      getDb().select({ id: claims.id }).from(claims)
        .where(and(inArray(claims.orderId, batch), sql`${claims.releasedAt} IS NULL`))
        .limit(1),
    );
    return rows.length > 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Pre-0083 disposable/local DBs: missing table ⇒ no active QR race.
    if (/no such table|food_qr_order_claims/i.test(msg)) return false;
    throw error;
  }
}

/** Pure gate: desk Mark Paid must not proceed once Razorpay capture is known. */
export function foodQrBlocksDeskPayment(state: string, hasCapturedPayment: boolean): boolean {
  return state === "paid" || hasCapturedPayment;
}

const DESK_RELEASE_ABORT =
  "A Razorpay payment was already captured for this bill. Refresh before recording desk payment.";

const OPEN_FOOD_QR_STATES = ["active", "creating", "qr_unknown"] as const;

/**
 * Reconcile best-effort, then abort only if paid/capture is known.
 * Gateway/parse failures (RazorpayError) do not block Retire when unpaid locally —
 * otherwise staff cannot clear locks when Reconcile itself is broken.
 */
async function assertFoodQrUnpaidForRelease(attemptId: string) {
  let state = "";
  try {
    const snap = await reconcileFoodQrAttempt(attemptId);
    state = snap.state;
  } catch (error) {
    const [row] = await getDb().select({ state: attempts.state }).from(attempts).where(eq(attempts.id, attemptId)).limit(1);
    state = row?.state || "";
    const captured = await getDb().select({ id: payments.id }).from(payments)
      .where(and(eq(payments.attemptId, attemptId), eq(payments.captured, 1))).limit(1);
    if (foodQrBlocksDeskPayment(state, captured.length > 0)) {
      throw new FoodQrError(DESK_RELEASE_ABORT, 409);
    }
    if (error instanceof FoodQrError && /capture evidence is not ready/i.test(error.message)) {
      throw error;
    }
    // RazorpayError / transient reconcile failures: continue if no local capture.
    return;
  }
  const captured = await getDb().select({ id: payments.id }).from(payments)
    .where(and(eq(payments.attemptId, attemptId), eq(payments.captured, 1))).limit(1);
  if (foodQrBlocksDeskPayment(state, captured.length > 0)) {
    throw new FoodQrError(DESK_RELEASE_ABORT, 409);
  }
}

/**
 * Provider-close (best-effort) + release claims + set terminal state.
 * Staff Retire → `closed`; bill-change remint → `expired`.
 */
async function finalizeOpenFoodQrAttempt(
  attemptId: string,
  terminal: "closed" | "expired",
): Promise<boolean> {
  await assertFoodQrUnpaidForRelease(attemptId);

  const [attempt] = await getDb().select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt || !OPEN_FOOD_QR_STATES.includes(attempt.state as typeof OPEN_FOOD_QR_STATES[number])) {
    // Already terminal — still heal stuck claims.
    await releaseClaims(attemptId);
    return false;
  }

  if (attempt.qrCodeId) {
    try {
      await closeRazorpayFoodQr(attempt.qrCodeId, attempt.environment as RazorpayEnvironment);
    } catch {
      // Best-effort; second unpaid assert still blocks if a capture landed.
    }
  }

  await assertFoodQrUnpaidForRelease(attemptId);
  await releaseClaims(attemptId);
  await getDb().update(attempts).set({ state: terminal, updatedAt: timestamp() })
    .where(and(eq(attempts.id, attemptId), inArray(attempts.state, [...OPEN_FOOD_QR_STATES])));
  return true;
}

/**
 * Retire every open unpaid food QR (Bill Settings → Static).
 * Capture races on individual attempts are skipped so mode switch is never blocked.
 */
export async function retireAllOpenFoodQrAttempts(): Promise<{
  retiredAttemptIds: string[];
  skippedCapturedIds: string[];
}> {
  if (isPiRuntime()) return { retiredAttemptIds: [], skippedCapturedIds: [] };
  try {
    const open = await getDb().select({ id: attempts.id }).from(attempts)
      .where(inArray(attempts.state, [...OPEN_FOOD_QR_STATES]));
    const retiredAttemptIds: string[] = [];
    const skippedCapturedIds: string[] = [];
    for (const row of open) {
      try {
        await finalizeOpenFoodQrAttempt(row.id, "closed");
        retiredAttemptIds.push(row.id);
      } catch (error) {
        if (error instanceof FoodQrError && error.status === 409) {
          skippedCapturedIds.push(row.id);
          continue;
        }
        throw error;
      }
    }
    return { retiredAttemptIds, skippedCapturedIds };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/no such table|food_qr_/i.test(msg)) return { retiredAttemptIds: [], skippedCapturedIds: [] };
    throw error;
  }
}

/**
 * Retire one open food QR by attempt id (ledger / Bill drawer Retire QR).
 * Reuses desk release: reconcile → abort if captured → close provider QR → release claims.
 */
export async function closeActiveFoodQrAttempt(attemptId: string): Promise<{ releasedAttemptIds: string[] }> {
  cloudOnly();
  const db = getDb();
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new FoodQrError("Payment attempt not found", 404);
  let orderIds: number[] = [];
  try {
    orderIds = (JSON.parse(attempt.foodOrderIds || "[]") as unknown[])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    orderIds = [];
  }
  if (!orderIds.length) throw new FoodQrError("No orders on this payment attempt", 400);
  return releaseFoodQrForDeskPayment(orderIds);
}

/**
 * Close open food Razorpay QRs and release claims so Mark Paid can record cash/online/split.
 * Aborts if a capture is already applied or visible — never double-settle.
 */
export async function releaseFoodQrForDeskPayment(orderIds: number[]): Promise<{ releasedAttemptIds: string[] }> {
  if (!orderIds.length || isPiRuntime()) return { releasedAttemptIds: [] };
  try {
    const claimRows = await collectInBatches(orderIds, (batch) =>
      getDb().select({ attemptId: claims.attemptId }).from(claims)
        .where(and(inArray(claims.orderId, batch), sql`${claims.releasedAt} IS NULL`)),
    );
    const attemptIds = [...new Set(claimRows.map((row) => row.attemptId))];
    if (!attemptIds.length) return { releasedAttemptIds: [] };

    const releasedAttemptIds: string[] = [];
    for (const attemptId of attemptIds) {
      const finalized = await finalizeOpenFoodQrAttempt(attemptId, "closed");
      if (finalized) releasedAttemptIds.push(attemptId);
      else {
        // Terminal heal still counts as released for desk Mark Paid callers.
        releasedAttemptIds.push(attemptId);
      }
    }
    return { releasedAttemptIds };
  } catch (error) {
    if (error instanceof FoodQrError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    if (/no such table|food_qr_/i.test(msg)) return { releasedAttemptIds: [] };
    throw error;
  }
}

// --- Webhook handling ---

const supportedQrEvents = new Set(["qr_code.credited", "qr_code.closed", "payment.captured"]);

export async function receiveFoodQrWebhook(raw: Uint8Array, signature: string, eventId: string) {
  cloudOnly();
  z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).parse(eventId);
  const secrets = allRazorpayWebhookSecrets();
  if (!secrets.length) throw new RazorpayError("CONFIGURATION");
  let verified = false;
  for (const secret of secrets) if (await verifyRazorpaySignature(raw, signature, secret)) verified = true;
  if (!verified) throw new RazorpayError("SIGNATURE", 400);

  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new FoodQrError("Invalid webhook JSON", 400); }

  const parsed = z.object({
    event: z.string().regex(/^[a-z_.]+$/).max(100),
    account_id: z.string().regex(/^acc_[A-Za-z0-9]+$/),
    payload: z.record(z.object({
      entity: z.object({
        id: z.string().max(80),
        notes: z.record(z.string()).or(z.array(z.unknown()).length(0)).optional(),
      }).passthrough(),
    })),
  }).parse(value);

  const allowedAccounts = [
    process.env.RAZORPAY_TEST_ACCOUNT_ID, process.env.RAZORPAY_LIVE_ACCOUNT_ID,
  ].filter((s): s is string => Boolean(s?.trim()));
  if (allowedAccounts.length && !allowedAccounts.includes(parsed.account_id)) {
    throw new RazorpayError("MISMATCH", 400);
  }

  const qrEntity = parsed.payload.qr_code?.entity;
  const payEntity = parsed.payload.payment?.entity;
  const supported = supportedQrEvents.has(parsed.event);
  const qrCodeId = qrEntity?.id || null;
  const paymentId = payEntity?.id || null;

  // Resolve attemptId from notes
  const qrNotes = qrEntity?.notes;
  const payNotes = payEntity?.notes;
  const noteValue = (qrNotes && !Array.isArray(qrNotes) ? qrNotes.goko_food_attempt : undefined)
    || (payNotes && !Array.isArray(payNotes) ? payNotes.goko_food_attempt : undefined);
  const attemptId = noteValue && z.string().uuid().safeParse(noteValue).success ? noteValue : null;

  if (supported && qrCodeId) razorpayId("qr").parse(qrCodeId);
  if (supported && paymentId) razorpayId("pay").parse(paymentId);

  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const now = timestamp();

  await getDb().insert(hooks).values({
    eventId, payloadHash: hash, eventType: parsed.event,
    qrCodeId: supported ? qrCodeId : null,
    paymentId: supported ? paymentId : null,
    attemptId,
    state: supported ? "received" : "ignored",
    receivedAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: hooks.eventId });

  const [stored] = await getDb().select().from(hooks).where(eq(hooks.eventId, eventId)).limit(1);
  if (!stored || stored.payloadHash !== hash) throw new FoodQrError("Conflicting webhook replay", 409);

  return processFoodQrWebhook(eventId);
}

export async function processFoodQrWebhook(eventId: string) {
  cloudOnly();
  const db = getDb();
  const [hook] = await db.select().from(hooks).where(eq(hooks.eventId, eventId)).limit(1);
  if (!hook) throw new FoodQrError("Webhook not found", 404);
  if (["processed", "ignored"].includes(hook.state)) return { state: hook.state };

  try {
    // Resolve attempt
    let attempt: Attempt | undefined;
    if (hook.attemptId) {
      [attempt] = await db.select().from(attempts).where(eq(attempts.id, hook.attemptId)).limit(1);
    }
    if (!attempt && hook.qrCodeId) {
      [attempt] = await db.select().from(attempts).where(eq(attempts.qrCodeId, hook.qrCodeId)).limit(1);
    }
    if (!attempt) throw new FoodQrError("Unmatched food QR webhook retained for reconciliation", 503);

    const rzpEnv = attempt.environment as RazorpayEnvironment;

    if (hook.eventType === "payment.captured" && hook.paymentId) {
      const qrPayments = attempt.qrCodeId
        ? await fetchRazorpayFoodQrPayments(attempt.qrCodeId, rzpEnv)
        : [];
      const captured = qrPayments.find((p) => p.id === hook.paymentId && p.captured);
      if (!captured) throw new FoodQrError("Capture evidence not yet visible; retry required", 503);
      await settleFoodQrCapture(attempt, captured);
    } else if (hook.eventType === "qr_code.credited" && attempt.qrCodeId) {
      const qrPayments = await fetchRazorpayFoodQrPayments(attempt.qrCodeId, rzpEnv);
      const cap = qrPayments.find((p) => p.captured);
      if (!cap) throw new FoodQrError("Credit evidence not yet visible; retry required", 503);
      await settleFoodQrCapture(attempt, cap);
    } else if (hook.eventType === "qr_code.closed" && attempt.qrCodeId) {
      const qr = await fetchRazorpayFoodQr(attempt.qrCodeId, rzpEnv);
      const qrPayments = await fetchRazorpayFoodQrPayments(attempt.qrCodeId, rzpEnv);
      const cap = qrPayments.find((p) => p.captured);
      if (cap) {
        await settleFoodQrCapture(attempt, cap);
      } else if (qr.status === "closed" && attempt.state !== "paid" && attempt.state !== "closed") {
        await releaseClaims(attempt.id);
        await db.update(attempts).set({ state: "expired", updatedAt: timestamp() }).where(eq(attempts.id, attempt.id));
      }
    }

    await db.update(hooks).set({ state: "processed", updatedAt: timestamp() }).where(eq(hooks.eventId, eventId));
    return { state: "processed" };
  } catch (error) {
    await db.update(hooks).set({ state: "retry", updatedAt: timestamp() })
      .where(and(eq(hooks.eventId, eventId), ne(hooks.state, "processed")));
    throw error;
  }
}

// --- Admin ---

const FOOD_QR_LIST_PAGE_SIZE = 25;

export type ListFoodQrAttemptsFilters = {
  page?: number;
  query?: string;
  fromDate?: string;
  toDate?: string;
};

/** Paginated Food QR attempts for admin ledger (text + IST date range, Room-parity). */
export async function listFoodQrAttempts(opts: ListFoodQrAttemptsFilters = {}) {
  cloudOnly();
  const db = getDb();
  const page = Math.max(1, Math.floor(opts.page || 1));
  const conditions = [];
  const query = opts.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    const payHits = await db.select({ attemptId: payments.attemptId }).from(payments).where(like(payments.id, pattern));
    const payAttemptIds = [...new Set(payHits.map((row) => row.attemptId))];
    conditions.push(or(
      like(attempts.guestName, pattern),
      like(attempts.guestPhone, pattern),
      like(attempts.qrCodeId, pattern),
      like(attempts.id, pattern),
      like(attempts.foodOrderIds, pattern),
      ...(payAttemptIds.length ? [inArray(attempts.id, payAttemptIds)] : []),
    ));
  }
  const { fromIso, toExclusiveIso } = foodQrCreatedAtBounds(opts.fromDate, opts.toDate);
  if (fromIso) conditions.push(gte(attempts.createdAt, fromIso));
  if (toExclusiveIso) conditions.push(lt(attempts.createdAt, toExclusiveIso));
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(attempts).where(where);
  const rows = await db.select().from(attempts)
    .where(where)
    .orderBy(desc(attempts.createdAt))
    .limit(FOOD_QR_LIST_PAGE_SIZE)
    .offset((page - 1) * FOOD_QR_LIST_PAGE_SIZE);
  const ids = rows.map((r) => r.id);
  const payRows = ids.length
    ? await collectInBatches(ids, (batch) => db.select().from(payments).where(inArray(payments.attemptId, batch)))
    : [];
  const byAttempt = new Map<string, (typeof payRows)>();
  for (const p of payRows) {
    const list = byAttempt.get(p.attemptId) || [];
    list.push(p);
    byAttempt.set(p.attemptId, list);
  }
  const total = Number(count || 0);
  return {
    attempts: rows.map((row) => ({
      ...row,
      payments: byAttempt.get(row.id) || [],
    })),
    page,
    pageSize: FOOD_QR_LIST_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / FOOD_QR_LIST_PAGE_SIZE)),
  };
}

// --- Public snapshot ---

export async function foodQrSnapshot(attemptId: string) {
  const db = getDb();
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new FoodQrError("Attempt not found", 404);
  const payRows = await db.select().from(payments).where(eq(payments.attemptId, attemptId));
  const rzpEnv = attempt.environment as RazorpayEnvironment;
  const upiIntent = upiIntentFromNotes(attempt.notes);
  return {
    attemptId: attempt.id,
    state: attempt.state,
    amountPaise: attempt.paymentAmountPaise,
    imageUrl: attempt.qrImageUrl,
    upiIntent,
    hasUpiIntent: Boolean(upiIntent),
    closeBy: attempt.closeBy,
    environment: rzpEnv,
    paymentMethodLabel: paymentMethodLabel(rzpEnv),
    payments: payRows,
    qrCodeId: attempt.qrCodeId,
    foodOrderIds: attempt.foodOrderIds,
    guestName: attempt.guestName,
    guestPhone: attempt.guestPhone,
  };
}
