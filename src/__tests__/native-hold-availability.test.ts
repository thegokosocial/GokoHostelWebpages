import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { getAvailableBedsForRange } from "@/db/queries";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db", () => ({ getDb: () => state.db }));

let sqlite: SQLite.Database;

beforeEach(() => {
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE dorms (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
    INSERT INTO dorms VALUES (1, 'Mixed', NULL);
    CREATE TABLE beds (
      id INTEGER PRIMARY KEY, dorm_id INTEGER, dorm_name TEXT, bed_id TEXT, position TEXT,
      type TEXT, status TEXT, guest_name TEXT, guest_contact TEXT, checkin_date TEXT,
      expected_checkout TEXT, staying_days TEXT, checkin_id INTEGER, is_blocked INTEGER DEFAULT 0,
      sync_updated_at TEXT, sync_source TEXT, sync_id TEXT, deleted_at TEXT
    );
    INSERT INTO beds (id, dorm_id, dorm_name, bed_id, position, type, status, is_blocked) VALUES
      (1,1,'Mixed','A1','Lower','Bunk','available',0),
      (2,1,'Mixed','A2','Lower','Bunk','available',0);
    CREATE TABLE booking_bed_assignments (
      id INTEGER PRIMARY KEY, booking_id INTEGER, bed_id INTEGER, dorm_id INTEGER,
      checkin_date TEXT, checkout_date TEXT, status TEXT, assigned_by TEXT, assigned_at TEXT, inventory_pool TEXT
    );
    CREATE TABLE bed_blocks (
      id INTEGER PRIMARY KEY, bed_id INTEGER, dorm_id INTEGER, start_date TEXT, end_date TEXT,
      reason TEXT, blocked_by TEXT, blocked_at TEXT, unblocked_by TEXT, unblocked_at TEXT, is_active INTEGER
    );
    CREATE TABLE inventory_overrides (
      id INTEGER PRIMARY KEY, dorm_id INTEGER, channel_id INTEGER, date TEXT,
      online_available INTEGER, offline_available INTEGER, overridden_by TEXT, overridden_at TEXT
    );
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY, guest_name TEXT, platform TEXT, checkin_date TEXT, checkout_date TEXT,
      status TEXT, source TEXT, persons INTEGER DEFAULT 1, room_type TEXT DEFAULT '', raw_data TEXT DEFAULT ''
    );
    CREATE TABLE room_type_mapping (
      id INTEGER PRIMARY KEY, dorm_id INTEGER, dorm_name TEXT, channel_room_code TEXT, total_inventory INTEGER, is_active INTEGER
    );
  `);
  sqlite.exec(readFileSync("migrations/0059_native_inventory_hold_primitive.sql", "utf8"));
  sqlite.exec("ALTER TABLE native_inventory_holds ADD COLUMN exclude_booking_id INTEGER;");
  sqlite.exec(readFileSync("migrations/0065_native_hold_lease_renew.sql", "utf8"));
  state.db = drizzle(sqlite, { schema });
});

describe("getAvailableBedsForRange native hold exclusion", () => {
  it("omits beds under an active overlapping native hold", async () => {
    const checkin = addCalendarDays(todayIST(), 2);
    const checkout = addCalendarDays(checkin, 1);
    const now = Math.floor(Date.now() / 1000);
    sqlite.prepare(`
      INSERT INTO native_inventory_holds
      (id, request_key, request_hash, owner_hash, bed_ids, checkin_date, checkout_date, expires_at, state, created_at, exclude_booking_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      crypto.randomUUID(), crypto.randomUUID(), "h", "o", JSON.stringify([1]),
      checkin, checkout, now + 600, "held", now, null,
    );
    const free = await getAvailableBedsForRange(checkin, checkout);
    expect(free.map((b) => b.id).sort()).toEqual([2]);
  });

  it("includes beds after the hold expires", async () => {
    const checkin = addCalendarDays(todayIST(), 2);
    const checkout = addCalendarDays(checkin, 1);
    const now = Math.floor(Date.now() / 1000);
    sqlite.prepare(`
      INSERT INTO native_inventory_holds
      (id, request_key, request_hash, owner_hash, bed_ids, checkin_date, checkout_date, expires_at, state, created_at, exclude_booking_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      crypto.randomUUID(), crypto.randomUUID(), "h", "o", JSON.stringify([1]),
      checkin, checkout, now - 1, "held", now - 901, null,
    );
    const free = await getAvailableBedsForRange(checkin, checkout);
    expect(free.map((b) => b.id).sort()).toEqual([1, 2]);
  });
});
