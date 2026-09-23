import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

const dbState = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/db", () => ({ getDb: dbState.getDb }));

import { decrementStockIfAvailable } from "@/db/queries";

function d1Client(sqlite: SQLite.Database) {
  const result = (value: unknown) => ({ results: value, success: true, meta: {} });
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async raw() {
              return sqlite.prepare(sql).raw(true).all(...params);
            },
            async all() {
              return result(sqlite.prepare(sql).raw(true).all(...params));
            },
            async run() {
              const execution = sqlite.prepare(sql).run(...params);
              return result({ changes: execution.changes, last_row_id: execution.lastInsertRowid });
            },
          };
        },
      };
    },
  };
}

describe("food inventory D1 integration", () => {
  let sqlite: SQLite.Database;

  beforeEach(() => {
    sqlite = new SQLite(":memory:");
    sqlite.exec(`
      CREATE TABLE menu_items (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        track_inventory INTEGER NOT NULL DEFAULT 0,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        is_available INTEGER NOT NULL DEFAULT 1
      );
    `);
    sqlite.prepare("INSERT INTO menu_items (id, name, track_inventory, stock_quantity, is_available) VALUES (?, ?, ?, ?, ?)")
      .run(1, "Shampoo", 1, 3, 1);
    sqlite.prepare("INSERT INTO menu_items (id, name, track_inventory, stock_quantity, is_available) VALUES (?, ?, ?, ?, ?)")
      .run(2, "Unlimited Tea", 0, 0, 1);
    dbState.getDb.mockReturnValue(drizzle(d1Client(sqlite) as never, { schema }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    sqlite.close();
  });

  it("atomically reserves available tracked stock and marks the item unavailable at zero", async () => {
    await expect(decrementStockIfAvailable(1, 2)).resolves.toBe(true);
    expect(sqlite.prepare("SELECT stock_quantity, is_available FROM menu_items WHERE id = 1").get())
      .toEqual({ stock_quantity: 1, is_available: 1 });

    await expect(decrementStockIfAvailable(1, 1)).resolves.toBe(true);
    expect(sqlite.prepare("SELECT stock_quantity, is_available FROM menu_items WHERE id = 1").get())
      .toEqual({ stock_quantity: 0, is_available: 0 });
  });

  it("rejects an exhausted reservation without changing the database", async () => {
    await expect(decrementStockIfAvailable(1, 4)).resolves.toBe(false);
    expect(sqlite.prepare("SELECT stock_quantity, is_available FROM menu_items WHERE id = 1").get())
      .toEqual({ stock_quantity: 3, is_available: 1 });
  });

  it("does not reserve untracked items and treats invalid deltas as no-ops", async () => {
    await expect(decrementStockIfAvailable(2, 1)).resolves.toBe(false);
    await expect(decrementStockIfAvailable(1, 0)).resolves.toBe(true);
    expect(sqlite.prepare("SELECT stock_quantity FROM menu_items WHERE id = 2").get())
      .toEqual({ stock_quantity: 0 });
  });
});
