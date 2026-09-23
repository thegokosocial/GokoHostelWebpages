import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookings, nativeBookingCheckouts as checkouts, nativeInventoryHolds as holds,
} from "@/db/schema";
import { addBookingHistoryEntry, getAllBeds, transitionBookingStatus } from "@/db/queries";
import { otaFingerprint, pushIfOtaChanged } from "@/lib/aiosellSync";
import { occupiedNights } from "@/lib/inventoryAvailability";
import { collectInBatches } from "@/lib/dbBatch";

const PAID_OR_TERMINAL = new Set([
  "captured", "fulfilled", "captured_unfulfilled", "cancelled",
]);

/**
 * Cancel unpaid website provisional bookings whose inventory hold has expired.
 * Bound work per call. Skips rows with captured/fulfilled checkout state.
 * Pushes Aiosell for dorms/nights whose native holds were released.
 */
export async function cancelAbandonedWebsiteHolds(limit = 20): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const candidates = await db.select({
    id: bookings.id,
  }).from(bookings).where(and(
    eq(bookings.status, "hold"),
    eq(bookings.source, "website"),
    sql`${bookings.holdExpiresAt} != ''`,
    sql`${bookings.holdExpiresAt} < ${now}`,
    sql`COALESCE(${bookings.amountPaid}, 0) = 0`,
  )).limit(Math.min(50, Math.max(1, limit)));

  const holdIdsToRelease: string[] = [];
  for (const row of candidates) {
    const [checkout] = await db.select().from(checkouts)
      .where(eq(checkouts.bookingId, row.id)).limit(1);
    if (checkout && PAID_OR_TERMINAL.has(checkout.state)) continue;
    if (checkout?.holdId) holdIdsToRelease.push(checkout.holdId);
  }

  const dormIds = new Set<number>();
  const nights = new Set<string>();
  let before = "";
  if (holdIdsToRelease.length > 0) {
    const activeHolds = await collectInBatches(holdIdsToRelease, (batch) => db.select().from(holds).where(and(
      eq(holds.state, "held"),
      inArray(holds.id, batch),
    )));
    if (activeHolds.length > 0) {
      try {
        const allBeds = await getAllBeds();
        const bedMeta = new Map(allBeds.map((b) => [b.id, b]));
        for (const hold of activeHolds) {
          for (const bedId of JSON.parse(hold.bedIds) as number[]) {
            const dormId = bedMeta.get(bedId)?.dormId;
            if (dormId != null) dormIds.add(dormId);
          }
          for (const night of occupiedNights(hold.checkinDate, hold.checkoutDate)) {
            nights.add(night);
          }
        }
        if (dormIds.size > 0 && nights.size > 0) {
          before = await otaFingerprint([...dormIds], [...nights]);
        }
      } catch { /* best-effort fingerprint */ }
    }
  }

  let cancelled = 0;
  for (const row of candidates) {
    const [checkout] = await db.select().from(checkouts)
      .where(eq(checkouts.bookingId, row.id)).limit(1);
    if (checkout && PAID_OR_TERMINAL.has(checkout.state)) continue;

    if (checkout?.holdId) {
      await db.update(holds).set({ state: "released" })
        .where(and(eq(holds.id, checkout.holdId), eq(holds.state, "held")));
    }
    if (checkout) {
      await db.update(checkouts).set({
        state: "cancelled",
        closureReason: "hold_expired",
        updatedAt: now,
      }).where(and(
        eq(checkouts.id, checkout.id),
        sql`${checkouts.state} NOT IN ('captured','fulfilled','captured_unfulfilled','cancelled')`,
      ));
    }
    const moved = await transitionBookingStatus(row.id, ["hold"], {
      status: "cancelled",
      cancelledAt: now,
      holdExpiresAt: "",
    });
    if (!moved) continue;
    await addBookingHistoryEntry({
      bookingId: row.id,
      action: "hold_expired",
      details: "Unpaid website hold expired; provisional booking cancelled",
      performedBy: "system",
    });
    cancelled++;
  }

  if (before && dormIds.size > 0 && nights.size > 0) {
    try { await pushIfOtaChanged(before, [...dormIds], [...nights]); } catch { /* best-effort */ }
  }
  return cancelled;
}
