import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { FOOD_ORDER_ITEM_INSERT_CHUNK } from "@/db/queries";

const state = vi.hoisted(() => ({ db: null as Database | null }));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: vi.fn(async () => undefined),
  notificationFoodBody: () => "body",
}));

import { POST } from "@/app/api/food/order/route";

const skippedMigrations = new Set([
  "0035_site_cms.sql",
  "0041_splits.sql",
  "0081_split_expense_idempotency.sql",
  "0064_food_bill_share_tokens.sql",
  "0077_food_bill_walkin_identity.sql",
  "0066_gateway_receivables.sql",
  "0068_gateway_settlement_allocations.sql",
  "0079_site_hero_videos.sql",
]);

const KEY = "550e8400-e29b-41d4-a716-446655440000";
const KEY2 = "550e8400-e29b-41d4-a716-446655440001";

let sqlite: SQLite.Database;

function place(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/food/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (!skippedMigrations.has(file)) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  state.db = drizzle(sqlite, { schema }) as unknown as Database;

  sqlite.exec(`
    INSERT INTO settings (key, value) VALUES
      ('food_kitchen_hours', '00:00-23:59'),
      ('food_kitchen_busy', 'false'),
      ('food_tax_rate', '0'),
      ('food_confirm_with_guest', 'false'),
      ('food_tab_limit', '0')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    UPDATE menu_items SET stock_quantity = 5, is_available = 1 WHERE id = 143;
    UPDATE menu_items SET is_available = 1 WHERE id BETWEEN 1 AND 8;
  `);
});

afterEach(() => {
  state.db = null;
  sqlite.close();
});

describe("guest food place (disposable SQLite)", () => {
  it("places order + items and decrements tracked stock", async () => {
    const res = await place({
      idempotencyKey: KEY,
      guestName: "Ada",
      guestType: "walkin",
      items: [{ menuItemId: 143, quantity: 2 }],
      createdBy: "guest",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM food_orders").get() as { n: number }).n).toBe(1);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM food_order_items").get() as { n: number }).n).toBe(1);
    expect(
      sqlite.prepare("SELECT stock_quantity FROM menu_items WHERE id = 143").get(),
    ).toEqual({ stock_quantity: 3 });
  });

  it("duplicate idempotencyKey returns success once with one order", async () => {
    const body = {
      idempotencyKey: KEY2,
      guestName: "Ada",
      guestType: "walkin",
      items: [{ menuItemId: 1, quantity: 1 }],
      createdBy: "guest",
    };
    expect((await place(body)).status).toBe(200);
    const second = await place(body);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, duplicate: true });
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM food_orders").get() as { n: number }).n).toBe(1);
  });

  it("allows only one simultaneous guest order to reserve the final unit", async () => {
    sqlite.prepare("UPDATE menu_items SET stock_quantity = 1 WHERE id = 143").run();
    const base = { guestName: "Race Guest", guestType: "walkin", items: [{ menuItemId: 143, quantity: 1 }], createdBy: "guest" };
    const [first, second] = await Promise.all([
      place({ ...base, idempotencyKey: "550e8400-e29b-41d4-a716-446655440011" }),
      place({ ...base, idempotencyKey: "550e8400-e29b-41d4-a716-446655440012" }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(sqlite.prepare("SELECT stock_quantity FROM menu_items WHERE id = 143").get()).toEqual({ stock_quantity: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM food_orders WHERE status != 'cancelled'").get()).toEqual({ n: 1 });
  });

  it("mid-chunk fail leaves partial lines; retry is duplicate not a second order", async () => {
    expect(FOOD_ORDER_ITEM_INSERT_CHUNK).toBe(5);
    const db = state.db!;
    const realInsert = db.insert.bind(db);
    let calls = 0;
    vi.spyOn(db, "insert").mockImplementation((...args: Parameters<typeof db.insert>) => {
      // Count only food_order_items inserts: first createFoodOrder, then item chunks
      const table = args[0] as { [Symbol.toStringTag]?: string } | undefined;
      const result = realInsert(...args);
      // Drizzle insert returns a builder; intercept values() for food_order_items
      const originalValues = result.values.bind(result);
      result.values = (...vArgs: Parameters<typeof result.values>) => {
        const rows = vArgs[0] as unknown;
        const isItemChunk = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" && "orderId" in (rows[0] as object) && "menuItemId" in (rows[0] as object);
        if (isItemChunk) {
          calls += 1;
          if (calls === 2) throw new Error("D1_BIND_LIMIT");
        }
        return originalValues(...vArgs);
      };
      void table;
      return result;
    });

    const items = Array.from({ length: 6 }, (_, i) => ({ menuItemId: i + 1, quantity: 1 }));
    const fail = await place({
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440099",
      guestName: "Chunk Guest",
      guestType: "walkin",
      items,
      createdBy: "guest",
    });
    expect(fail.status).toBe(500);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM food_order_items").get() as { n: number }).n,
    ).toBe(FOOD_ORDER_ITEM_INSERT_CHUNK);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM food_orders").get() as { n: number }).n,
    ).toBe(1);

    vi.restoreAllMocks();
    const retry = await place({
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440099",
      guestName: "Chunk Guest",
      guestType: "walkin",
      items,
      createdBy: "guest",
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ duplicate: true });
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM food_orders").get() as { n: number }).n).toBe(1);
  });
});
