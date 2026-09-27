import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { todayIST } from "@/lib/utils";
import { D1_IN_BATCH_SIZE } from "@/lib/dbBatch";

const state = vi.hoisted(() => ({
  db: null as Database | null,
  auth: { role: "admin" as string, displayName: "Admin", permissions: {} as Record<string, boolean> },
}));
const pushInventory = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ authenticateUser: async () => state.auth }));
vi.mock("@/lib/aiosell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aiosell")>();
  return { ...actual, pushInventory };
});
vi.mock("@/lib/pmsLog", () => ({ logPmsCall: vi.fn() }));

import { POST } from "@/app/api/admin/inventory/route";
import { retryDirtyInventory } from "@/lib/aiosellSync";
import { clearDirtyInventory, getDirtyInventory } from "@/db/queries";

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

let sqlite: SQLite.Database;
let night: string;
let exclusiveEnd: string;

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/inventory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test", ...body }),
  });
}

beforeEach(() => {
  state.auth = { role: "admin", displayName: "Admin", permissions: {} };
  night = addCalendarDays(todayIST(), 7);
  exclusiveEnd = addCalendarDays(night, 1);

  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (!skippedMigrations.has(file)) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  state.db = drizzle(sqlite, { schema }) as unknown as Database;

  sqlite.exec(`
    INSERT INTO dorms (id, name, created_at) VALUES (1, 'Dorm A', '2026-09-01T00:00:00Z');
    INSERT INTO beds (id, dorm_id, dorm_name, bed_id, position, type, status)
      VALUES (1, 1, 'Dorm A', 'A1', 'Lower', 'Bunk', 'available'),
             (2, 1, 'Dorm A', 'A2', 'Upper', 'Bunk', 'available');
    INSERT INTO channel_config (
      provider, hotel_code, pms_id, api_base_url, api_username, api_password,
      is_active, auto_push_inventory, created_at
    ) VALUES (
      'aiosell', 'GOKO', 'pms', 'https://live.aiosell.com', 'u', 'p',
      1, 1, '2026-09-01T00:00:00Z'
    );
    INSERT INTO room_type_mapping (id, dorm_id, dorm_name, channel_room_code, total_inventory, is_active)
      VALUES (1, 1, 'Dorm A', 'DORM', 2, 1);
  `);

  pushInventory.mockReset();
  pushInventory.mockResolvedValue({ success: true });
});

afterEach(() => {
  state.db = null;
  sqlite.close();
});

describe("inventory mutations (disposable SQLite)", () => {
  it("updateInventoryOverride writes override and retains dirty when PMS rejects", async () => {
    pushInventory.mockResolvedValue({ success: false, message: "HTTP 502: upstream unavailable" });
    const res = await POST(req({
      action: "updateInventoryOverride",
      dormId: 1,
      channelId: null,
      date: night,
      onlineAvailable: 1,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sync).toMatchObject({ attempted: true, accepted: false });
    expect(
      sqlite.prepare("SELECT online_available FROM inventory_overrides WHERE dorm_id = 1 AND date = ?").get(night),
    ).toEqual({ online_available: 1 });
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_dirty WHERE dorm_id = 1 AND date = ?").get(night) as { n: number }).n,
    ).toBe(1);
  });

  it("bulkSetAvailability writes overrides and marks dirty", async () => {
    pushInventory.mockResolvedValue({ success: true });
    const res = await POST(req({
      action: "bulkSetAvailability",
      dormIds: [1],
      startDate: night,
      endDate: night,
      mode: "set",
      onlineRemaining: 0,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(
      sqlite.prepare("SELECT online_available FROM inventory_overrides WHERE dorm_id = 1 AND date = ?").get(night),
    ).toEqual({ online_available: 0 });
  });

  it("blockBeds / unblockBeds toggles is_active", async () => {
    const blocked = await POST(req({
      action: "blockBeds",
      bedIds: [1],
      dormId: 1,
      startDate: night,
      endDate: exclusiveEnd,
      reason: "maintenance",
    }));
    expect(blocked.status).toBe(200);
    const row = sqlite.prepare(
      "SELECT id, is_active, reason FROM bed_blocks WHERE bed_id = 1 AND is_active = 1",
    ).get() as { id: number; is_active: number; reason: string };
    expect(row.is_active).toBe(1);
    expect(row.reason).toBe("maintenance");

    const unblocked = await POST(req({ action: "unblockBeds", blockIds: [row.id] }));
    expect(unblocked.status).toBe(200);
    expect(
      (sqlite.prepare("SELECT is_active FROM bed_blocks WHERE id = ?").get(row.id) as { is_active: number }).is_active,
    ).toBe(0);
  });

  it("retryDirtyInventory clears dirty after PMS accepts", async () => {
    pushInventory.mockResolvedValueOnce({ success: false, message: "HTTP 502" });
    await POST(req({
      action: "updateInventoryOverride",
      dormId: 1,
      date: night,
      onlineAvailable: 1,
    }));
    expect((await getDirtyInventory()).length).toBeGreaterThan(0);

    pushInventory.mockResolvedValue({ success: true });
    const retry = await retryDirtyInventory();
    expect(retry).toMatchObject({ attempted: true, accepted: true });
    expect(await getDirtyInventory()).toHaveLength(0);

    const viaRoute = await POST(req({
      action: "updateInventoryOverride",
      dormId: 1,
      date: addCalendarDays(night, 1),
      onlineAvailable: 0,
    }));
    expect(viaRoute.status).toBe(200);
    pushInventory.mockResolvedValueOnce({ success: false, message: "down" });
    await POST(req({
      action: "updateInventoryOverride",
      dormId: 1,
      date: addCalendarDays(night, 2),
      onlineAvailable: 0,
    }));
    expect((await getDirtyInventory()).length).toBeGreaterThan(0);
    pushInventory.mockResolvedValue({ success: true });
    const routeRetry = await POST(req({
      action: "retryPmsSync",
      syncType: "inventory",
      dates: [addCalendarDays(night, 2)],
      dormIds: [1],
    }));
    expect(routeRetry.status).toBe(200);
    const retryBody = await routeRetry.json();
    expect(retryBody.sync?.accepted).toBe(true);
  });

  it("clearDirtyInventory batches 25 / 26 / 51 ids", async () => {
    expect(D1_IN_BATCH_SIZE).toBe(25);
    const insert = sqlite.prepare(
      "INSERT INTO inventory_dirty (dorm_id, date, created_at) VALUES (1, ?, '2026-09-01T00:00:00Z')",
    );
    for (let i = 0; i < 51; i++) {
      insert.run(`2099-01-${String(i + 1).padStart(2, "0")}`);
    }
    const ids25 = (sqlite.prepare("SELECT id FROM inventory_dirty ORDER BY id LIMIT 25").all() as Array<{ id: number }>).map((r) => r.id);
    await clearDirtyInventory(ids25);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_dirty").get() as { n: number }).n,
    ).toBe(26);

    const ids26 = (sqlite.prepare("SELECT id FROM inventory_dirty ORDER BY id LIMIT 26").all() as Array<{ id: number }>).map((r) => r.id);
    await clearDirtyInventory(ids26);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_dirty").get() as { n: number }).n,
    ).toBe(0);

    for (let i = 0; i < 51; i++) {
      insert.run(`2099-02-${String(i + 1).padStart(2, "0")}`);
    }
    const all = (sqlite.prepare("SELECT id FROM inventory_dirty").all() as Array<{ id: number }>).map((r) => r.id);
    expect(all).toHaveLength(51);
    await clearDirtyInventory(all);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_dirty").get() as { n: number }).n,
    ).toBe(0);
  });
});
