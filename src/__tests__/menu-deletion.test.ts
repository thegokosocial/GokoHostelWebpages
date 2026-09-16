import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
import { deleteMenuItem, deleteMenuCategory, getAllMenuItems, getAllMenuCategories, getMenuItemById, getAvailableMenuItems } from "@/db/queries";

let sqlite: InstanceType<typeof SQLite>;
beforeEach(() => {
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE menu_categories (
      id INTEGER PRIMARY KEY, name TEXT, name_kannada TEXT, icon TEXT, description TEXT,
      display_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, track_inventory_default INTEGER DEFAULT 0,
      discount_exempt INTEGER DEFAULT 0, sync_id TEXT, sync_updated_at TEXT, sync_source TEXT, deleted_at TEXT
    );
    CREATE TABLE menu_items (
      id INTEGER PRIMARY KEY, category_id INTEGER REFERENCES menu_categories(id), name TEXT,
      name_kannada TEXT, description TEXT, price INTEGER, price_text TEXT, tags TEXT, ingredients TEXT,
      image_url TEXT, is_available INTEGER DEFAULT 1, display_order INTEGER DEFAULT 0,
      price_on_request INTEGER DEFAULT 0, indicative_min_price INTEGER DEFAULT 0, indicative_max_price INTEGER DEFAULT 0, price_basis TEXT DEFAULT 'per portion',
      track_inventory INTEGER DEFAULT 0, stock_quantity INTEGER DEFAULT 0, low_stock_threshold INTEGER DEFAULT 5,
      sync_id TEXT, sync_updated_at TEXT, sync_source TEXT, deleted_at TEXT
    );
    CREATE TABLE food_order_items (id INTEGER PRIMARY KEY, menu_item_id INTEGER REFERENCES menu_items(id), item_name TEXT);
    INSERT INTO menu_categories (id,name) VALUES (1,'Meals');
    INSERT INTO menu_items (id,category_id,name,image_url) VALUES (1,1,'Rice','/api/media/menu/rice.jpg'),(2,1,'Dal','');
    INSERT INTO food_order_items VALUES (1,1,'Rice');
  `);
  mocks.db = drizzle(sqlite);
});
afterEach(() => sqlite.close());

describe("menu deletion preserves order history", () => {
  it("archives an ordered item without breaking its foreign key or deleting its photo", async () => {
    await deleteMenuItem(1);
    expect(sqlite.prepare("SELECT item_name FROM food_order_items").get()).toEqual({ item_name: "Rice" });
    expect(sqlite.prepare("SELECT is_available, image_url FROM menu_items WHERE id=1").get()).toEqual({ is_available: 0, image_url: "/api/media/menu/rice.jpg" });
    expect(await getMenuItemById(1)).toBeNull();
    expect((await getAllMenuItems()).map(item => item.id)).toEqual([2]);
    expect((await getAvailableMenuItems()).map(item => item.id)).toEqual([2]);
  });

  it("archives a category and both used and unused children, and permits safe repeat deletion", async () => {
    await deleteMenuCategory(1);
    await deleteMenuCategory(1);
    expect(await getAllMenuCategories()).toEqual([]);
    expect(await getAllMenuItems()).toEqual([]);
    expect(await getAvailableMenuItems()).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM menu_items").get()).toEqual({ count: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM food_order_items").get()).toEqual({ count: 1 });
  });
});
