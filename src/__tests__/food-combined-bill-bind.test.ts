import { beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";
import * as schema from "@/db/schema";
import { D1_IN_BATCH_SIZE } from "@/lib/dbBatch";
import { getFoodOrdersByCheckinIds, getFoodOrdersByIds } from "@/db/queries";

const dbState = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({ getDb: dbState.getDb }));

function openFoodDb() {
  const sqlite = new SQLite(":memory:");
  sqlite.exec(`
    CREATE TABLE food_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT,
      guest_type TEXT NOT NULL DEFAULT 'walkin',
      checkin_id INTEGER,
      guest_name TEXT NOT NULL,
      guest_phone TEXT NOT NULL DEFAULT '',
      room_info TEXT DEFAULT '',
      table_number TEXT DEFAULT '',
      special_instructions TEXT DEFAULT '',
      subtotal INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'placed',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      amount_paid INTEGER NOT NULL DEFAULT 0,
      amount_refunded INTEGER NOT NULL DEFAULT 0,
      refund_method TEXT NOT NULL DEFAULT '',
      refund_cash INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT NOT NULL DEFAULT '',
      refunded_by TEXT NOT NULL DEFAULT '',
      payment_method TEXT DEFAULT '',
      paid_by TEXT DEFAULT '',
      cash_received INTEGER DEFAULT 0,
      change_given INTEGER DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      discount_reason TEXT DEFAULT '',
      discount_by TEXT DEFAULT '',
      cancelled_reason TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'guest',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT,
      deleted_at TEXT
    );
  `);
  return drizzle(sqlite, { schema });
}

async function insertOrder(
  db: ReturnType<typeof openFoodDb>,
  row: {
    id: number;
    orderNumber: string;
    guestType?: string;
    checkinId?: number | null;
    guestName: string;
    guestPhone?: string;
    subtotal?: number;
    total?: number;
    status?: string;
    paymentStatus?: string;
    amountPaid?: number;
    amountRefunded?: number;
    discount?: number;
    createdAt?: string;
  },
) {
  const total = row.total ?? row.subtotal ?? 1000;
  await db.insert(schema.foodOrders).values({
    id: row.id,
    orderNumber: row.orderNumber,
    guestType: row.guestType ?? (row.checkinId ? "hostel" : "walkin"),
    checkinId: row.checkinId ?? null,
    guestName: row.guestName,
    guestPhone: row.guestPhone ?? "",
    subtotal: row.subtotal ?? total,
    tax: 0,
    total,
    status: row.status ?? "placed",
    paymentStatus: row.paymentStatus ?? "pending",
    amountPaid: row.amountPaid ?? 0,
    amountRefunded: row.amountRefunded ?? 0,
    discount: row.discount ?? 0,
    createdBy: "test",
    createdAt: row.createdAt ?? `2026-09-20T10:${String(row.id).padStart(2, "0")}:00.000Z`,
    updatedAt: row.createdAt ?? `2026-09-20T10:${String(row.id).padStart(2, "0")}:00.000Z`,
  });
}

describe("Combined Bill / food order IN bind safety", () => {
  beforeEach(() => {
    dbState.getDb.mockReset();
  });

  it("getCombinedBill uses batched loaders and dedupes by order id", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/admin/food-orders/route.ts"), "utf8");
    const section = route.match(/case "getCombinedBill":[\s\S]*?case "createBillShareLink":/)?.[0];
    expect(section).toBeTruthy();
    expect(section!).toContain("getFoodOrdersByCheckinIds");
    expect(section!).toContain("getFoodOrdersByIds");
    expect(section!).toContain("byId.set(order.id, order)");
    expect(section!).not.toMatch(/or\(\s*inArray\(foodOrders\.checkinId/);
    expect(section!).not.toMatch(/inArray\(foodOrders\.checkinId,\s*selectedCheckinIds\)/);
  });

  it("UI Combined Bill request keeps hostel checkinIds and walk-in orderIds partitioned", () => {
    const ui = readFileSync(join(process.cwd(), "src/components/admin/AdminFoodOrders.tsx"), "utf8");
    expect(ui).toContain("checkinIds: selected.filter((guest) => guest.checkinId).map((guest) => guest.checkinId)");
    expect(ui).toContain("orderIds: selected.flatMap((guest) => guest.checkinId ? [] : (guest.orderIds || []))");
  });

  it("getFoodOrdersByIds skips cancelled and zero-due orders", async () => {
    const db = openFoodDb();
    dbState.getDb.mockReturnValue(db);
    await insertOrder(db, { id: 1, orderNumber: "W-1", guestName: "A", total: 1000 });
    await insertOrder(db, { id: 2, orderNumber: "W-2", guestName: "B", total: 1000, status: "cancelled" });
    await insertOrder(db, { id: 3, orderNumber: "W-3", guestName: "C", total: 1000, amountPaid: 1000, paymentStatus: "paid" });
    await insertOrder(db, {
      id: 4,
      orderNumber: "W-4",
      guestName: "D",
      total: 1000,
      amountPaid: 400,
      paymentStatus: "paid",
    });

    const rows = await getFoodOrdersByIds([1, 2, 3, 4, 999]);
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it("getFoodOrdersByCheckinIds returns all due orders for selected stays", async () => {
    const db = openFoodDb();
    dbState.getDb.mockReturnValue(db);
    await insertOrder(db, { id: 10, orderNumber: "H-1", guestName: "Stay", checkinId: 5, total: 500 });
    await insertOrder(db, { id: 11, orderNumber: "H-2", guestName: "Stay", checkinId: 5, total: 700 });
    await insertOrder(db, { id: 12, orderNumber: "H-3", guestName: "Other", checkinId: 6, total: 300 });
    await insertOrder(db, { id: 13, orderNumber: "H-4", guestName: "Stay", checkinId: 5, total: 200, status: "cancelled" });

    const rows = await getFoodOrdersByCheckinIds([5]);
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it("batched loaders stay under D1_IN_BATCH_SIZE for 26 and 51 ids", async () => {
    const db = openFoodDb();
    dbState.getDb.mockReturnValue(db);
    for (let id = 1; id <= 51; id++) {
      await insertOrder(db, {
        id,
        orderNumber: `W-${id}`,
        guestName: `G${id}`,
        checkinId: id <= 26 ? id : null,
        total: 100,
      });
    }

    const byId = await getFoodOrdersByIds(Array.from({ length: 51 }, (_, i) => i + 1));
    expect(byId).toHaveLength(51);

    const byCheckin = await getFoodOrdersByCheckinIds(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(byCheckin).toHaveLength(26);

    const source = readFileSync(join(process.cwd(), "src/db/queries.ts"), "utf8");
    const byIdsFn = source.match(/export async function getFoodOrdersByIds[\s\S]*?^export /m)?.[0];
    expect(byIdsFn).toContain("collectInBatches");
    expect(byIdsFn).toContain("inArray(foodOrders.id, batch)");
    expect(D1_IN_BATCH_SIZE).toBe(25);
  });

  it("overlap merge semantics: same order via checkin + id counts once", async () => {
    const db = openFoodDb();
    dbState.getDb.mockReturnValue(db);
    await insertOrder(db, { id: 42, orderNumber: "H-42", guestName: "Overlap", checkinId: 7, total: 1500 });
    await insertOrder(db, { id: 43, orderNumber: "W-43", guestName: "Walk", total: 500 });

    const fromCheckins = await getFoodOrdersByCheckinIds([7]);
    const fromOrders = await getFoodOrdersByIds([42, 43]);
    const byId = new Map<number, (typeof fromCheckins)[number]>();
    for (const order of fromCheckins) byId.set(order.id, order);
    for (const order of fromOrders) byId.set(order.id, order);
    const merged = [...byId.values()];
    expect(merged.map((o) => o.id).sort((a, b) => a - b)).toEqual([42, 43]);
    const grandTotal = merged.reduce((sum, o) => sum + (o.total - o.amountPaid - (o.amountRefunded || 0) - (o.discount || 0)), 0);
    // foodDue-equivalent for these unpaid rows
    expect(grandTotal).toBe(2000);
  });
});
