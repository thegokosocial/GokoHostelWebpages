import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { checkins, foodOrders } from "@/db/schema";
import { normalizePhone } from "@/lib/phoneUtils";
import {
  checkinIdsMatchingContact,
  EMPTY_FOOD_TAB,
  type PendingFoodTab,
} from "@/lib/foodTab";
import { collectInBatches } from "@/lib/dbBatch";

export async function activeCheckinIdsForContact(contact: string): Promise<number[]> {
  const n = normalizePhone(contact);
  if (!n) return [];
  const db = getDb();
  const active = await db.select({ id: checkins.id, contact: checkins.contact })
    .from(checkins)
    .where(eq(checkins.status, "active"));
  return checkinIdsMatchingContact(active, contact);
}

/** Hostel food tabs live on self-check-in rows (`food_orders.checkin_id`), matched by phone. */
export async function getPendingFoodTab(opts: {
  checkinId?: number | null;
  contact?: string | null;
}): Promise<PendingFoodTab> {
  const ids = new Set<number>();
  if (typeof opts.checkinId === "number" && opts.checkinId > 0) ids.add(opts.checkinId);

  const contact = opts.contact || "";
  if (contact) {
    for (const id of await activeCheckinIdsForContact(contact)) ids.add(id);
  }

  if (ids.size === 0) return { ...EMPTY_FOOD_TAB };

  const idList = [...ids];
  const db = getDb();
  const rows = await collectInBatches(idList, (batch) => db.select({
    id: foodOrders.id,
    checkinId: foodOrders.checkinId,
    total: foodOrders.total,
  }).from(foodOrders)
    .where(and(
      inArray(foodOrders.checkinId, batch),
      inArray(foodOrders.paymentStatus, ["on_tab", "pending"]),
      sql`${foodOrders.status} != 'cancelled'`,
    )));

  let pendingTab = 0;
  const orderIds: number[] = [];
  let checkinId: number | null = idList[0];
  for (const row of rows) {
    pendingTab += Number(row.total) || 0;
    if (row.id) orderIds.push(row.id);
    if (row.checkinId) checkinId = row.checkinId;
  }
  return { checkinId, pendingTab, pendingOrders: orderIds.length, orderIds };
}
