import { beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

const dbState = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({ getDb: dbState.getDb }));

import { addFoodOrderItems } from "@/db/queries";

describe("addFoodOrderItems chunking", () => {
  beforeEach(() => {
    const sqlite = new SQLite(":memory:");
    sqlite.exec(`
      CREATE TABLE food_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        item_price INTEGER NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL DEFAULT 1,
        line_total INTEGER NOT NULL DEFAULT 0,
        pricing_status TEXT NOT NULL DEFAULT 'fixed',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        sync_id TEXT,
        sync_updated_at TEXT,
        sync_source TEXT DEFAULT 'cloudflare'
      );
    `);
    dbState.getDb.mockReturnValue(drizzle(sqlite, { schema }));
  });

  it.each([9, 10, 12])("inserts %i distinct line items across bind-safe chunks", async (lineCount) => {
    const items = Array.from({ length: lineCount }, (_, i) => ({
      orderId: 99,
      menuItemId: i + 1,
      itemName: `Dish ${i + 1}`,
      itemPrice: 1000,
      quantity: 1,
      lineTotal: 1000,
      pricingStatus: "fixed",
      notes: "",
    }));
    await addFoodOrderItems(items);
    const db = dbState.getDb();
    const rows = await db.select().from(schema.foodOrderItems).where(eq(schema.foodOrderItems.orderId, 99));
    expect(rows).toHaveLength(lineCount);
    expect(rows.map((r: { itemName: string }) => r.itemName)).toEqual(
      Array.from({ length: lineCount }, (_, i) => `Dish ${i + 1}`),
    );
  });
});
