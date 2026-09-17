import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { gatewayPreviewAttempts as attempts, gatewayPreviewPayments as payments, gatewayPreviewRefunds as refunds, gatewayPreviewWebhooks as hooks } from "@/db/schema";
import { isPiRuntime } from "@/lib/runtime";
import {
  RazorpayError, testRazorpayCredentials, createRazorpayTestOrder, findRazorpayTestOrders,
  fetchRazorpayTestPayment, fetchRazorpayTestOrderPayments, createRazorpayTestRefund,
  fetchRazorpayTestRefunds, fetchRazorpayTestRefund, verifyCheckoutSignature, verifyRazorpaySignature, razorpayId,
  type RazorpayPayment, type RazorpayRefund,
} from "@/lib/razorpay";

type Attempt = typeof attempts.$inferSelect;
const timestamp = () => new Date().toISOString();
const receiptFor = (id: string) => `goko_${id.replace(/-/g, "")}`;
export class PreviewError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "PreviewError"; }
}
function cloudOnly() {
  if (isPiRuntime()) throw new PreviewError("Gateway operations are Cloudflare-owned and unavailable on Pi", 403);
}
function webhookSecrets(requireCurrent = false) {
  const current = process.env.RAZORPAY_TEST_WEBHOOK_SECRET || "";
  const previous = process.env.RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS || "";
  const liveSecrets = [process.env.RAZORPAY_LIVE_WEBHOOK_SECRET, process.env.RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS].filter(Boolean);
  const secrets = [current, previous].filter((s) => s.trim());
  if (requireCurrent && !current.trim() || !secrets.length || secrets.some((s) => liveSecrets.includes(s))) throw new RazorpayError("CONFIGURATION");
  return secrets;
}
async function allowNewOperation() {
  cloudOnly();
  if (process.env.RAZORPAY_TEST_PREVIEW_ENABLED !== "true") throw new PreviewError("Authenticated Razorpay test preview is disabled", 403);
  testRazorpayCredentials();
  webhookSecrets(true);
  // Validate every required table/column before a provider POST or checkout
  // claim. A partially applied migration must not strand gateway evidence.
  const db = getDb();
  await Promise.all([db.select().from(attempts).limit(0), db.select().from(payments).limit(0),
    db.select().from(refunds).limit(0), db.select().from(hooks).limit(0)]);
}
function sameAccount(attempt: Attempt) {
  cloudOnly();
  if (attempt.environment !== "test" || attempt.amountPaise !== 100 || attempt.keyId !== testRazorpayCredentials().keyId) {
    throw new PreviewError("Restore the original test credentials before reconciling this attempt");
  }
}
async function getAttempt(id: string) {
  cloudOnly(); z.string().uuid().parse(id);
  const [row] = await getDb().select().from(attempts).where(eq(attempts.id, id)).limit(1);
  if (!row) throw new PreviewError("Test attempt not found", 404);
  sameAccount(row); return row;
}
async function attachOrder(attempt: Attempt, order: Awaited<ReturnType<typeof createRazorpayTestOrder>>) {
  const noteId = order.notes && !Array.isArray(order.notes) ? order.notes.goko_preview_attempt : undefined;
  if (order.amount !== attempt.amountPaise || order.receipt !== attempt.receipt || noteId !== attempt.id ||
      attempt.orderId && order.id !== attempt.orderId) throw new RazorpayError("MISMATCH");
  const rows = await getDb().update(attempts).set({ orderId: order.id, state: "created", updatedAt: timestamp() })
    .where(and(eq(attempts.id, attempt.id), sql`(${attempts.orderId} IS NULL OR ${attempts.orderId} = ${order.id})`)).returning();
  if (!rows.length) throw new RazorpayError("MISMATCH");
  return rows[0];
}

/** One durable owner performs the POST. Unknown results are never POSTed again. */
export async function createPreviewAttempt(requestKey: string, createdBy: string) {
  await allowNewOperation(); z.string().uuid().parse(requestKey);
  const now = timestamp(), id = crypto.randomUUID();
  const rows = await getDb().insert(attempts).values({ id, requestKey, keyId: testRazorpayCredentials().keyId,
    receipt: receiptFor(id), createdBy, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: attempts.requestKey }).returning();
  if (!rows.length) {
    const [old] = await getDb().select().from(attempts).where(eq(attempts.requestKey, requestKey)).limit(1);
    if (!old) throw new PreviewError("Unable to recover the test request", 503);
    return previewSnapshot(old.id);
  }
  try { await attachOrder(rows[0], await createRazorpayTestOrder(rows[0].receipt, id)); }
  catch {
    // Includes timeout, malformed response, provider refusal and save-after-POST
    // failure. None prove the remote order does not exist.
    await getDb().update(attempts).set({ state: "order_unknown", updatedAt: timestamp() })
      .where(and(eq(attempts.id, id), ne(attempts.state, "created")));
  }
  return previewSnapshot(id);
}

async function recoverOrder(attempt: Attempt) {
  if (attempt.orderId) return attempt;
  const candidates = (await findRazorpayTestOrders(attempt.receipt)).filter((o) => o.receipt === attempt.receipt);
  if (candidates.length !== 1) throw new PreviewError("Order creation is still unresolved. Do not start another payment; reconcile this attempt.");
  return attachOrder(attempt, candidates[0]);
}

async function recordPayment(attempt: Attempt, evidence: RazorpayPayment) {
  if (!attempt.orderId || evidence.order_id !== attempt.orderId || evidence.amount !== attempt.amountPaise) throw new RazorpayError("MISMATCH");
  const captured = evidence.captured && ["captured", "refunded"].includes(evidence.status) ? 1 : 0;
  const rows = await getDb().insert(payments).values({ id: evidence.id, attemptId: attempt.id, amountPaise: evidence.amount,
    status: evidence.status, captured, refundedPaise: evidence.amount_refunded, verifiedAt: timestamp(),
  }).onConflictDoUpdate({ target: payments.id, set: {
    captured: sql`MAX(${payments.captured}, ${captured})`,
    refundedPaise: sql`MAX(${payments.refundedPaise}, ${evidence.amount_refunded})`,
    status: sql`CASE WHEN ${payments.status} = 'refunded' THEN 'refunded'
      WHEN ${payments.captured} = 1 AND ${captured} = 0 THEN ${payments.status}
      WHEN ${payments.status} = 'authorized' AND ${evidence.status} = 'created' THEN ${payments.status}
      ELSE ${evidence.status} END`,
    verifiedAt: timestamp(),
  }, setWhere: and(eq(payments.attemptId, attempt.id), eq(payments.amountPaise, evidence.amount)) }).returning();
  if (!rows.length) throw new RazorpayError("MISMATCH");
  return rows[0];
}

async function recordRefund(claim: typeof refunds.$inferSelect, evidence: RazorpayRefund) {
  const noteId = evidence.notes && !Array.isArray(evidence.notes) ? evidence.notes.goko_preview_refund : undefined;
  if (evidence.payment_id !== claim.paymentId || evidence.amount !== 100 || evidence.receipt !== claim.receipt || noteId !== claim.id ||
      claim.providerId && evidence.id !== claim.providerId) throw new RazorpayError("MISMATCH");
  // Processed is terminal, even if a stale API response/webhook arrives later.
  const rows = await getDb().update(refunds).set({ providerId: evidence.id, state: evidence.status, updatedAt: timestamp() })
    .where(and(eq(refunds.paymentId, claim.paymentId), ne(refunds.state, "processed"),
      sql`(${refunds.providerId} IS NULL OR ${refunds.providerId} = ${evidence.id})`)).returning();
  if (!rows.length) {
    const [current] = await getDb().select().from(refunds).where(eq(refunds.paymentId, claim.paymentId)).limit(1);
    if (!current || current.state !== "processed" || current.providerId !== evidence.id) throw new RazorpayError("MISMATCH");
  }
}
async function reconcileRefund(paymentId: string) {
  const [claim] = await getDb().select().from(refunds).where(eq(refunds.paymentId, paymentId)).limit(1);
  if (!claim || claim.state === "processed") return;
  const found = (await fetchRazorpayTestRefunds(paymentId)).filter((r) => r.receipt === claim.receipt);
  if (found.length !== 1) throw new PreviewError("Refund result is unresolved. Do not refund again; check the original request.");
  await recordRefund(claim, found[0]);
}
export async function reconcilePreviewAttempt(id: string) {
  const attempt = await recoverOrder(await getAttempt(id));
  const evidence = await fetchRazorpayTestOrderPayments(attempt.orderId!);
  const seen = new Set<string>();
  for (const payment of evidence) {
    if (seen.has(payment.id)) throw new RazorpayError("INVALID_RESPONSE");
    seen.add(payment.id);
    await recordPayment(attempt, payment);
  }
  // A stale/empty collection cannot discard known payment/refund evidence.
  const known = await getDb().select().from(payments).where(eq(payments.attemptId, id));
  for (const payment of known) {
    if (!seen.has(payment.id)) {
      const fetched = await fetchRazorpayTestPayment(payment.id);
      if (fetched.id !== payment.id) throw new RazorpayError("MISMATCH");
      await recordPayment(attempt, fetched);
    }
    await reconcileRefund(payment.id);
  }
  return previewSnapshot(id);
}
export async function verifyPreviewCallback(id: string, paymentId: string, orderId: string, signature: string) {
  const attempt = await getAttempt(id);
  if (!attempt.orderId || orderId !== attempt.orderId) throw new RazorpayError("MISMATCH", 400);
  if (!await verifyCheckoutSignature(attempt.orderId, paymentId, signature)) throw new RazorpayError("SIGNATURE", 400);
  const evidence = await fetchRazorpayTestPayment(paymentId);
  if (evidence.id !== paymentId) throw new RazorpayError("MISMATCH");
  await recordPayment(attempt, evidence);
  return previewSnapshot(id);
}
/** Claim before returning Checkout options. A lost response cannot reopen the same order. */
export async function claimPreviewCheckout(id: string) {
  await allowNewOperation();
  const attempt = await getAttempt(id);
  if (!attempt.orderId || attempt.state !== "created") throw new PreviewError("Order is unresolved; reconcile before checkout");
  const rows = await getDb().update(attempts).set({ checkoutStartedAt: timestamp(), updatedAt: timestamp() })
    .where(and(eq(attempts.id, id), sql`${attempts.checkoutStartedAt} IS NULL`,
      sql`NOT EXISTS (SELECT 1 FROM ${payments} WHERE ${payments.attemptId} = ${id})`)).returning();
  if (!rows.length) throw new PreviewError("Checkout was already started or payment evidence exists. Reconcile rather than opening it again.");
  return { ...await previewSnapshot(id), checkout: { key: attempt.keyId, order_id: attempt.orderId, amount: attempt.amountPaise, currency: "INR" as const } };
}
export async function refundPreviewPayment(attemptId: string, paymentId: string, createdBy: string) {
  await allowNewOperation();
  const attempt = await getAttempt(attemptId);
  const evidence = await fetchRazorpayTestPayment(paymentId);
  if (evidence.id !== paymentId) throw new RazorpayError("MISMATCH");
  await recordPayment(attempt, evidence);
  const [old] = await getDb().select().from(refunds).where(eq(refunds.paymentId, paymentId)).limit(1);
  if (old) return previewSnapshot(attemptId); // Replay cannot perform a second POST.
  if (evidence.status !== "captured" || !evidence.captured || evidence.amount_refunded !== 0) {
    throw new PreviewError("Only a verified, captured and not already refunded test payment can be refunded");
  }
  const id = crypto.randomUUID();
  const inserted = await getDb().insert(refunds).values({ id, paymentId, receipt: receiptFor(id), createdBy, updatedAt: timestamp() })
    .onConflictDoNothing({ target: refunds.paymentId }).returning();
  if (inserted.length) {
    try { await recordRefund(inserted[0], await createRazorpayTestRefund(paymentId, inserted[0].receipt, id)); }
    catch {
      await getDb().update(refunds).set({ state: "unknown", updatedAt: timestamp() })
        .where(and(eq(refunds.paymentId, paymentId), eq(refunds.state, "submitting")));
    }
  }
  return previewSnapshot(attemptId);
}
async function enrichFailedPayments(rows: (typeof payments.$inferSelect)[]) {
  return Promise.all(rows.map(async (row) => {
    if (row.status !== "failed") return row;
    try {
      const evidence = await fetchRazorpayTestPayment(row.id);
      return { ...row, errorCode: evidence.error_code ?? null, errorDescription: evidence.error_description ?? null,
        errorReason: evidence.error_reason ?? null };
    } catch { return { ...row, errorCode: null, errorDescription: null, errorReason: null }; }
  }));
}
export async function previewSnapshot(id: string) {
  const attempt = await getAttempt(id);
  const paymentRows = await enrichFailedPayments(await getDb().select().from(payments).where(eq(payments.attemptId, id)));
  const refundRows = paymentRows.length ? await getDb().select().from(refunds).where(inArray(refunds.paymentId, paymentRows.map((p) => p.id))) : [];
  return { attempt, payments: paymentRows, refunds: refundRows, environment: "test" as const,
    nativeCheckoutReady: false as const,
    checkout: attempt.state === "created" && attempt.orderId && !attempt.checkoutStartedAt && paymentRows.length === 0 && process.env.RAZORPAY_TEST_PREVIEW_ENABLED === "true"
      ? { key: attempt.keyId, order_id: attempt.orderId, amount: attempt.amountPaise, currency: "INR" as const } : null,
  };
}
export async function listPreviewAttempts() {
  cloudOnly();
  return getDb().select().from(attempts).orderBy(desc(attempts.createdAt)).limit(25);
}
export async function recoverPreviewRequest(requestKey: string) {
  cloudOnly(); z.string().uuid().parse(requestKey);
  const [attempt] = await getDb().select().from(attempts).where(eq(attempts.requestKey, requestKey)).limit(1);
  if (!attempt) throw new PreviewError("Saved test request is not present in this deployment's ledger", 404);
  return previewSnapshot(attempt.id);
}

const supportedEvents = new Set(["payment.authorized", "payment.captured", "payment.failed", "order.paid", "refund.created", "refund.processed", "refund.failed"]);

/** Authenticate exact bytes first; store a digest and minimal recovery IDs, not card/guest PII. */
export async function receivePreviewWebhook(raw: Uint8Array, signature: string, eventId: string) {
  cloudOnly();
  z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).parse(eventId);
  const secrets = webhookSecrets();
  let verified = false;
  for (const secret of secrets) if (await verifyRazorpaySignature(raw, signature, secret)) verified = true;
  if (!verified) throw new RazorpayError("SIGNATURE", 400);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new PreviewError("Invalid webhook JSON", 400); }
  const parsed = z.object({ event: z.string().regex(/^[a-z_.]+$/).max(100), account_id: z.string().regex(/^acc_[A-Za-z0-9]+$/),
    payload: z.record(z.object({ entity: z.object({ id: z.string().max(80), order_id: z.string().nullable().optional(),
      payment_id: z.string().optional(), notes: z.record(z.string()).or(z.array(z.unknown()).length(0)).optional(),
    }).passthrough() })),
  }).parse(value);
  if (process.env.RAZORPAY_TEST_ACCOUNT_ID && parsed.account_id !== process.env.RAZORPAY_TEST_ACCOUNT_ID) throw new RazorpayError("MISMATCH", 400);
  const p = parsed.payload.payment?.entity, r = parsed.payload.refund?.entity, o = parsed.payload.order?.entity;
  const supported = supportedEvents.has(parsed.event);
  const refundEvent = parsed.event.startsWith("refund.") && supported;
  const refundId = refundEvent ? razorpayId("rfnd").parse(r?.id) : null;
  const paymentId = p?.id || r?.payment_id || null;
  const orderId = p?.order_id || o?.id || null;
  const orderNotes = o?.notes || p?.notes;
  const noteId = orderNotes && !Array.isArray(orderNotes) ? orderNotes.goko_preview_attempt : undefined;
  const attemptId = noteId && z.string().uuid().safeParse(noteId).success ? noteId : null;
  if (supported) {
    if (refundEvent && (!r?.payment_id || paymentId !== r.payment_id)) throw new PreviewError("Missing or conflicting refund payment identifier", 400);
    if (paymentId) razorpayId("pay").parse(paymentId);
    if (orderId) razorpayId("order").parse(orderId);
    if (!paymentId && !orderId) throw new PreviewError("Missing webhook recovery identifiers", 400);
  }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw))), (b) => b.toString(16).padStart(2, "0")).join("");
  const now = timestamp();
  await getDb().insert(hooks).values({ eventId, payloadHash: hash, eventType: parsed.event, orderId: supported ? orderId : null,
    paymentId: supported ? paymentId : null, refundId, attemptId, state: supported ? "received" : "ignored", receivedAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: hooks.eventId });
  const [stored] = await getDb().select().from(hooks).where(eq(hooks.eventId, eventId)).limit(1);
  if (!stored || stored.payloadHash !== hash) throw new PreviewError("Conflicting webhook replay", 409);
  // Upgrade old retained events only from authenticated identical redelivery.
  if (refundId && !stored.refundId) await getDb().update(hooks).set({ refundId })
    .where(and(eq(hooks.eventId, eventId), eq(hooks.payloadHash, hash), sql`${hooks.refundId} IS NULL`));
  return processPreviewWebhook(eventId);
}
export async function processPreviewWebhook(eventId: string) {
  cloudOnly();
  const [hook] = await getDb().select().from(hooks).where(eq(hooks.eventId, eventId)).limit(1);
  if (!hook) throw new PreviewError("Webhook not found", 404);
  if (["processed", "ignored"].includes(hook.state)) return { state: hook.state };
  try {
    let orderId = hook.orderId;
    if (!orderId && hook.paymentId) {
      const p = await fetchRazorpayTestPayment(hook.paymentId);
      if (p.id !== hook.paymentId) throw new RazorpayError("MISMATCH");
      orderId = p.order_id;
    }
    let [attempt] = orderId ? await getDb().select().from(attempts).where(eq(attempts.orderId, orderId)).limit(1) : [];
    if (!attempt && hook.attemptId) attempt = await recoverOrder(await getAttempt(hook.attemptId));
    if (!attempt || attempt.orderId !== orderId) throw new PreviewError("Unmatched test webhook retained for reconciliation", 503);
    sameAccount(attempt);
    if (hook.eventType.startsWith("refund.")) {
      // Persist and fetch the exact refund, including externally initiated test
      // refunds. A payment lookup alone cannot corroborate refund completion.
      if (!hook.refundId || !hook.paymentId) throw new PreviewError("Refund identity unavailable; manual review required", 503);
      const evidence = await fetchRazorpayTestRefund(hook.refundId);
      if (evidence.id !== hook.refundId || evidence.payment_id !== hook.paymentId || evidence.amount !== attempt.amountPaise) throw new RazorpayError("MISMATCH");
      if (hook.eventType === "refund.processed" && evidence.status !== "processed" ||
          hook.eventType === "refund.failed" && evidence.status === "pending") {
        throw new PreviewError("Refund outcome is not yet visible; webhook retry required", 503);
      }
      const [claim] = await getDb().select().from(refunds).where(eq(refunds.paymentId, hook.paymentId)).limit(1);
      if (claim && (claim.providerId === evidence.id || claim.receipt === evidence.receipt)) await recordRefund(claim, evidence);
    }
    // Fetch the current provider state: never apply stale payload status.
    if (hook.paymentId) {
      const evidence = await fetchRazorpayTestPayment(hook.paymentId);
      if (evidence.id !== hook.paymentId) throw new RazorpayError("MISMATCH");
      await recordPayment(attempt, evidence);
    }
    const snapshot = await reconcilePreviewAttempt(attempt.id);
    // A signed event can arrive before its API evidence becomes visible. Keep
    // it retryable rather than permanently acknowledging an unseen capture.
    if (hook.eventType === "payment.captured" && !snapshot.payments.some((p) => p.id === hook.paymentId && p.captured) ||
        hook.eventType === "order.paid" && !snapshot.payments.some((p) => p.captured)) {
      throw new PreviewError("Capture evidence is not yet visible; webhook retry required", 503);
    }
    await getDb().update(hooks).set({ state: "processed", updatedAt: timestamp() }).where(eq(hooks.eventId, eventId));
    return { state: "processed" };
  } catch (error) {
    await getDb().update(hooks).set({ state: "retry", updatedAt: timestamp() })
      .where(and(eq(hooks.eventId, eventId), ne(hooks.state, "processed")));
    throw error;
  }
}
export async function listPreviewWebhooks() {
  cloudOnly(); return getDb().select().from(hooks).orderBy(desc(hooks.receivedAt)).limit(25);
}
