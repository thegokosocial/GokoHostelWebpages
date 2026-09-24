import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, cashPaymentEvents, dailyLedger, foodOrders, guestReceipts } from "@/db/schema";
import { syncInsert, syncUpdate } from "@/db/syncMeta";
import { receiptBusinessDate, type createGuestReceipt } from "@/lib/guestReceipts";

type CashMutation = {
  values: Record<string, unknown>;
  receipts?: Array<Parameters<typeof createGuestReceipt>[0]>;
  allowedStatuses?: string[];
  expectedPaid?: number;
};

/** Commit the source balance and both tender journals together on D1 and Pi. */
async function persistCashEvents(entries: Array<typeof cashPaymentEvents.$inferInsert>, mutation?: CashMutation) {
  const db = getDb() as any;
  const build = (client: any) => {
    const writes: any[] = [];
    if (mutation) {
      const table = entries[0].sourceType === "booking" ? bookings : foodOrders;
      const values = syncUpdate(mutation.values);
      if (mutation.allowedStatuses || mutation.expectedPaid !== undefined) {
        // A concurrent lifecycle transition must abort the entire batch, including its journals.
        values.status = sql`CASE WHEN ${and(
          mutation.allowedStatuses ? inArray(table.status, mutation.allowedStatuses) : undefined,
          mutation.expectedPaid !== undefined ? eq(table.amountPaid, mutation.expectedPaid) : undefined,
        )} THEN ${mutation.values.status ?? table.status} ELSE NULL END`;
      }
      writes.push(client.update(table).set(values).where(eq(table.id, entries[0].sourceId)));
      for (const receipt of mutation.receipts || []) writes.push(client.insert(guestReceipts).values(syncInsert({
        ...receipt, businessDate: receipt.businessDate || receiptBusinessDate(), notes: receipt.notes || "",
        createdAt: new Date().toISOString(),
      })));
    }
    for (const entry of entries) writes.push(client.insert(cashPaymentEvents).values(entry));
    return writes;
  };
  if (typeof db.batch === "function") await db.batch(build(db));
  else db.transaction((tx: any) => { for (const write of build(tx)) write.run(); });
}

export async function assertCashDateOpen(businessDate: string): Promise<void> {
  const rows = await getDb().select({ id: dailyLedger.id }).from(dailyLedger).where(and(
    isNull(dailyLedger.accountId), gte(dailyLedger.date, businessDate), eq(dailyLedger.isReconciled, 1),
  )).limit(1);
  if (rows[0]) throw Object.assign(new Error("Undo the Cash reconciliation covering this date before changing the payment"), { status: 409 });
}

export async function recordCashPaymentEvent(data: {
  eventId: string; operationId: string; sourceType: "food_order" | "booking"; sourceId: number;
  eventType: "collection" | "refund" | "correction"; amountPaise: number; actor: string;
  guestNameSnapshot: string; referenceSnapshot: string; note?: string; businessDate?: string;
  correctsEventId?: string | null;
}, mutation?: CashMutation) {
  if (!data.eventId || !data.operationId || !Number.isSafeInteger(data.sourceId) || data.sourceId < 1
    || !Number.isSafeInteger(data.amountPaise) || data.amountPaise === 0
    || (data.eventType === "collection" && data.amountPaise < 0) || (data.eventType === "refund" && data.amountPaise > 0)) {
    throw Object.assign(new Error("A valid cash payment event is required"), { status: 400 });
  }
  const db = getDb();
  const duplicate = await db.select().from(cashPaymentEvents).where(eq(cashPaymentEvents.eventId, data.eventId)).limit(1);
  if (duplicate[0]) {
    const existing = duplicate[0];
    if (existing.operationId !== data.operationId || existing.sourceType !== data.sourceType
      || existing.sourceId !== data.sourceId || existing.amountPaise !== data.amountPaise || existing.eventType !== data.eventType) {
      throw Object.assign(new Error("This operation ID was already used for a different cash payment"), { status: 409 });
    }
    return { duplicate: true, event: existing };
  }
  const businessDate = data.businessDate || receiptBusinessDate();
  await assertCashDateOpen(businessDate);
  const now = new Date().toISOString();
  await persistCashEvents([syncInsert({
    ...data, businessDate, note: data.note || "", createdAt: now,
  })], mutation);
  return { duplicate: false };
}

export async function recordCashPaymentCorrection(data: {
  eventId: string; sourceType: "food_order" | "booking"; sourceId: number; amountPaise: number;
  actor: string; guestNameSnapshot: string; referenceSnapshot: string; note?: string;
}, mutation?: CashMutation) {
  if (!Number.isSafeInteger(data.amountPaise) || data.amountPaise === 0) {
    throw Object.assign(new Error("A valid cash correction is required"), { status: 400 });
  }
  const events = await getDb().select().from(cashPaymentEvents).where(and(
    eq(cashPaymentEvents.sourceType, data.sourceType), eq(cashPaymentEvents.sourceId, data.sourceId),
  )).orderBy(desc(cashPaymentEvents.id));
  const retry = events.filter((event) => event.eventId === data.eventId || event.eventId.startsWith(`${data.eventId}:part:`));
  if (retry.length) {
    if (retry.reduce((sum, event) => sum + event.amountPaise, 0) !== data.amountPaise) {
      throw Object.assign(new Error("This operation ID was already used for a different cash correction"), { status: 409 });
    }
    return { duplicate: true };
  }
  const collections = events.filter((event) => event.eventType === "collection");
  if (!collections.length) return { duplicate: false, skippedLegacy: true };
  let remaining = data.amountPaise;
  const corrections: Array<typeof cashPaymentEvents.$inferInsert> = [];
  for (const original of collections) {
    const available = events.filter((event) => event.operationId === original.operationId && event.eventType !== "refund")
      .reduce((sum, event) => sum + event.amountPaise, 0);
    const delta = remaining > 0 ? remaining : -Math.min(-remaining, Math.max(0, available));
    if (!delta) continue;
    await assertCashDateOpen(original.businessDate);
    corrections.push(syncInsert({
      ...data, eventId: corrections.length ? `${data.eventId}:part:${corrections.length}` : data.eventId,
      amountPaise: delta, operationId: original.operationId, eventType: "correction",
      businessDate: original.businessDate, correctsEventId: original.eventId,
      guestNameSnapshot: original.guestNameSnapshot, referenceSnapshot: original.referenceSnapshot,
      createdAt: new Date().toISOString(),
    }));
    remaining -= delta;
    if (!remaining) break;
  }
  if (remaining) throw Object.assign(new Error("Cash correction exceeds the recorded collections; review the legacy payment first"), { status: 409 });
  if (corrections.length) await persistCashEvents(corrections, mutation);
  return { duplicate: false };
}

/** Preflight a correction before its source row is mutated. Legacy payments have no journal to lock or infer. */
export async function assertCashPaymentCorrectionOpen(sourceType: "food_order" | "booking", sourceId: number): Promise<void> {
  const previous = await getDb().select({ businessDate: cashPaymentEvents.businessDate }).from(cashPaymentEvents).where(and(
    eq(cashPaymentEvents.sourceType, sourceType), eq(cashPaymentEvents.sourceId, sourceId),
    eq(cashPaymentEvents.eventType, "collection"),
  ));
  for (const date of new Set(previous.map((event) => event.businessDate))) await assertCashDateOpen(date);
}
