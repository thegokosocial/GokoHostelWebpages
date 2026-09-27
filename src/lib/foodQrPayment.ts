import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  foodQrAttempts as attempts, foodQrOrderClaims as claims,
  foodQrPayments as payments, foodQrWebhooks as hooks, foodOrders,
} from "@/db/schema";
import { getSetting, getFoodOrdersByIds, getFoodOrderItemsBatch, updateFoodOrderPayment } from "@/db/queries";
import { foodDue, foodAmountPaid } from "@/lib/foodPaymentBalance";
import { parseBillQrMode, effectiveMode, environmentFromMode, BILL_QR_MODE_KEY } from "@/lib/foodBillQrMode";
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
};

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
        const reconciled = await reconcileFoodQrAttempt(existing.attemptId);
        if (reconciled.state === "paid") return reconciled;
        if (["expired", "closed"].includes(reconciled.state) ||
            (reconciled.state === "active" && reconciled.closeBy && new Date(reconciled.closeBy).getTime() <= Date.now())) {
          await releaseClaims(existing.attemptId);
          await getDb().update(attempts).set({ state: "expired", updatedAt: timestamp() })
            .where(and(eq(attempts.id, existing.attemptId), inArray(attempts.state, ["active", "creating", "qr_unknown"])));
        } else {
          return reconciled;
        }
      } else {
        return existing;
      }
    } else if (fingerprintMatch && (existing.state === "qr_unknown" || existing.state === "creating")) {
      return reconcileFoodQrAttempt(existing.attemptId).catch(() => existing);
    } else if (!fingerprintMatch) {
      // Due/order-set changed — close unpaid claim so a new QR can be minted
      const reconciled = await reconcileFoodQrAttempt(existing.attemptId).catch(() => existing);
      if (reconciled.state === "paid") return reconciled;
      await releaseClaims(existing.attemptId);
      await getDb().update(attempts).set({ state: "expired", updatedAt: timestamp() })
        .where(and(eq(attempts.id, existing.attemptId), inArray(attempts.state, ["active", "creating", "qr_unknown"])));
    }
  }
  return createFoodQrAttempt({ ...input, orderIds: unpaid.map((o) => o.id) });
}

/** Reconcile: fetch QR status + payments from Razorpay; apply captures; release if expired/closed. */
export async function reconcileFoodQrAttempt(attemptId: string) {
  cloudOnly();
  z.string().uuid().parse(attemptId);
  const db = getDb();
  let [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new FoodQrError("Attempt not found", 404);
  if (["paid", "closed", "expired"].includes(attempt.state)) return foodQrSnapshot(attemptId);

  const rzpEnv = attempt.environment as RazorpayEnvironment;

  const qrCodeId = attempt.qrCodeId;
  if (qrCodeId) {
    // Fetch QR status
    const qr = await fetchRazorpayFoodQr(qrCodeId, rzpEnv);

    // Backfill UPI intent when create response lacked image_content
    if (qr.image_content?.trim() && !upiIntentFromNotes(attempt.notes)) {
      const notes = parseAttemptNotes(attempt.notes);
      notes.upiIntent = qr.image_content.trim();
      await db.update(attempts).set({ notes: JSON.stringify(notes), updatedAt: timestamp() })
        .where(eq(attempts.id, attemptId));
      attempt = { ...attempt, notes: JSON.stringify(notes) };
    }

    // Fetch and record payments
    const qrPayments = await fetchRazorpayFoodQrPayments(qrCodeId, rzpEnv);
    for (const payment of qrPayments) {
      await recordFoodQrPayment(attempt, payment);
    }

    // Check if we have a captured payment
    const capturedRows = await db.select().from(payments)
      .where(and(eq(payments.attemptId, attemptId), eq(payments.captured, 1)));

    if (capturedRows.length) {
      // Apply the first captured payment
      await applyRazorpayCapture(attempt, qrPayments.find((p) => p.captured) || qrPayments[0]);
    } else if (qr.status === "closed") {
      if (qr.close_reason === "paid") {
        // Never mark paid without a captured payment row — leave for webhook/retry
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
      // Fetch live payment evidence
      const qrPayments = attempt.qrCodeId
        ? await fetchRazorpayFoodQrPayments(attempt.qrCodeId, rzpEnv)
        : [];
      const captured = qrPayments.find((p) => p.id === hook.paymentId && p.captured);
      if (!captured) throw new FoodQrError("Capture evidence not yet visible; retry required", 503);
      await recordFoodQrPayment(attempt, captured);
      if (!["paid", "closed"].includes(attempt.state)) {
        await applyRazorpayCapture(attempt, captured);
      }
    } else if (hook.eventType === "qr_code.credited" && attempt.qrCodeId) {
      const qrPayments = await fetchRazorpayFoodQrPayments(attempt.qrCodeId, rzpEnv);
      for (const p of qrPayments) await recordFoodQrPayment(attempt, p);
      const cap = qrPayments.find((p) => p.captured);
      if (cap && !["paid", "closed"].includes(attempt.state)) {
        await applyRazorpayCapture(attempt, cap);
      } else if (!cap) {
        throw new FoodQrError("Credit evidence not yet visible; retry required", 503);
      }
    } else if (hook.eventType === "qr_code.closed" && attempt.qrCodeId) {
      const qr = await fetchRazorpayFoodQr(attempt.qrCodeId, rzpEnv);
      if (qr.status === "closed" && !["paid"].includes(attempt.state)) {
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

export async function listFoodQrAttempts(opts: { limit?: number } = {}) {
  cloudOnly();
  const db = getDb();
  const limit = Math.min(opts.limit || 25, 100);
  const rows = await db.select().from(attempts).orderBy(desc(attempts.createdAt)).limit(limit);
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
  return rows.map((row) => ({
    ...row,
    payments: byAttempt.get(row.id) || [],
  }));
}

// --- Public snapshot ---

export async function foodQrSnapshot(attemptId: string) {
  const db = getDb();
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new FoodQrError("Attempt not found", 404);
  const payRows = await db.select().from(payments).where(eq(payments.attemptId, attemptId));
  const rzpEnv = attempt.environment as RazorpayEnvironment;
  return {
    attemptId: attempt.id,
    state: attempt.state,
    amountPaise: attempt.paymentAmountPaise,
    imageUrl: attempt.qrImageUrl,
    upiIntent: upiIntentFromNotes(attempt.notes),
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
