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
import { foodDue } from "@/lib/foodPaymentBalance";

export type PendingFoodTabBalance = {
  pendingTab: number;
  pendingOrders: number;
  orderIds: number[];
};

export async function activeCheckinIdsForContact(contact: string): Promise<number[]> {
  const n = normalizePhone(contact);
  if (!n) return [];
  const db = getDb();
  const active = await db.select({ id: checkins.id, contact: checkins.contact })
    .from(checkins)
    .where(eq(checkins.status, "active"));
  return checkinIdsMatchingContact(active, contact);
}

/** Canonical collectible food balance by check-in for checkout and tab summaries. */
export async function pendingFoodTabsForCheckinIds(checkinIds: Iterable<number>): Promise<Map<number, PendingFoodTabBalance>> {
  const idList = [...new Set([...checkinIds].filter((id) => Number.isInteger(id) && id > 0))];
  if (idList.length === 0) return new Map();

  const db = getDb();
  const rows = await collectInBatches(idList, (batch) => db.select({
    id: foodOrders.id,
    checkinId: foodOrders.checkinId,
    total: foodOrders.total,
    amountPaid: foodOrders.amountPaid,
    amountRefunded: foodOrders.amountRefunded,
    writeOffAmount: foodOrders.writeOffAmount,
    paymentStatus: foodOrders.paymentStatus,
  }).from(foodOrders)
    .where(and(
      inArray(foodOrders.checkinId, batch),
      sql`${foodOrders.status} != 'cancelled'`,
    )));

  const balances = new Map<number, PendingFoodTabBalance>();
  for (const row of rows) {
    if (row.checkinId == null) continue;
    const due = foodDue(row);
    if (due <= 0) continue;
    const current = balances.get(row.checkinId) || { pendingTab: 0, pendingOrders: 0, orderIds: [] };
    current.pendingTab += due;
    current.pendingOrders += 1;
    current.orderIds.push(row.id);
    balances.set(row.checkinId, current);
  }
  return balances;
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
  let pendingTab = 0;
  const orderIds: number[] = [];
  let checkinId: number | null = idList[0];
  const balances = await pendingFoodTabsForCheckinIds(idList);
  for (const id of idList) {
    const balance = balances.get(id);
    if (!balance) continue;
    pendingTab += balance.pendingTab;
    orderIds.push(...balance.orderIds);
    checkinId = id;
  }
  return { checkinId, pendingTab, pendingOrders: orderIds.length, orderIds };
}
