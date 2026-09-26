import { beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import * as schema from "@/db/schema";
import {
  allocatePlatformSettlementBatch,
  GATEWAY_ALLOC_INSERT_CHUNK,
  PLATFORM_ALLOC_INSERT_CHUNK,
} from "@/lib/platformReceivables";

const dbState = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({ getDb: dbState.getDb }));

/** better-sqlite3 Drizzle has no D1 batch; polyfill executes statements in order. */
function attachBatch(db: ReturnType<typeof drizzle>) {
  (db as unknown as { batch: (queries: Promise<unknown>[]) => Promise<unknown[]> }).batch = async (queries) =>
    Promise.all(queries);
  return db;
}

function openDb() {
  const sqlite = new SQLite(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      account_type TEXT NOT NULL DEFAULT 'savings',
      account_number TEXT DEFAULT '',
      ifsc_code TEXT DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      opening_balance INTEGER NOT NULL DEFAULT 0,
      is_virtual INTEGER NOT NULL DEFAULT 0,
      platform_key TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT,
      deleted_at TEXT
    );
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_name TEXT NOT NULL,
      contact TEXT DEFAULT '',
      platform TEXT NOT NULL,
      booking_ref TEXT DEFAULT '',
      checkin_date TEXT NOT NULL,
      checkout_date TEXT DEFAULT '',
      room_type TEXT DEFAULT '',
      persons INTEGER NOT NULL DEFAULT 1,
      payment_status TEXT DEFAULT 'unknown',
      ota_payment_terms TEXT,
      ota_currency TEXT,
      payment_override INTEGER NOT NULL DEFAULT 0,
      special_requests TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'received',
      source TEXT DEFAULT 'manual',
      property TEXT DEFAULT 'goko_hostel',
      raw_data TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      synced_at TEXT DEFAULT '',
      amount_before_tax INTEGER DEFAULT 0,
      amount_tax INTEGER DEFAULT 0,
      amount_total INTEGER DEFAULT 0,
      amount_paid INTEGER DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT '',
      cash_received INTEGER NOT NULL DEFAULT 0,
      change_given INTEGER NOT NULL DEFAULT 0,
      amount_refunded INTEGER NOT NULL DEFAULT 0,
      refund_method TEXT NOT NULL DEFAULT '',
      refund_cash INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT NOT NULL DEFAULT '',
      refunded_by TEXT NOT NULL DEFAULT '',
      booking_cycle INTEGER NOT NULL DEFAULT 1,
      nightly_rate INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'INR',
      email TEXT DEFAULT '',
      cm_booking_id TEXT DEFAULT '',
      goko_booking_id TEXT DEFAULT '',
      rate_plan TEXT DEFAULT '',
      hold_expires_at TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      cancelled_by TEXT DEFAULT '',
      checked_in_at TEXT DEFAULT '',
      checked_in_by TEXT DEFAULT '',
      checked_out_at TEXT DEFAULT '',
      checked_out_by TEXT DEFAULT '',
      no_show_pms_status TEXT NOT NULL DEFAULT 'not_required',
      no_show_pms_error TEXT NOT NULL DEFAULT '',
      no_show_pms_attempted_at TEXT NOT NULL DEFAULT '',
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT,
      deleted_at TEXT
    );
    CREATE TABLE platform_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_key TEXT NOT NULL,
      bank_account_id INTEGER NOT NULL,
      receipt_id TEXT NOT NULL UNIQUE,
      payout_date TEXT NOT NULL,
      actual_amount_paise INTEGER NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT
    );
    CREATE TABLE platform_receivable_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      booking_cycle INTEGER NOT NULL DEFAULT 1,
      platform_key TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      entry_type TEXT NOT NULL,
      gross_paise INTEGER NOT NULL DEFAULT 0,
      tax_charged_paise INTEGER NOT NULL DEFAULT 0,
      tax_withheld_paise INTEGER NOT NULL DEFAULT 0,
      commission_paise INTEGER NOT NULL DEFAULT 0,
      tds_paise INTEGER NOT NULL DEFAULT 0,
      tcs_paise INTEGER NOT NULL DEFAULT 0,
      other_deductions_paise INTEGER NOT NULL DEFAULT 0,
      expected_net_paise INTEGER NOT NULL DEFAULT 0,
      recognition_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      source_payload TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT
    );
    CREATE TABLE platform_settlement_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL,
      booking_cycle INTEGER NOT NULL DEFAULT 1,
      allocation_key TEXT NOT NULL UNIQUE,
      allocated_paise INTEGER NOT NULL,
      variance_type TEXT NOT NULL DEFAULT 'none',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_id TEXT,
      sync_updated_at TEXT,
      sync_source TEXT
    );
  `);
  return attachBatch(drizzle(sqlite, { schema }));
}

async function seedSettlement(db: ReturnType<typeof openDb>, bookingCount: number, perBookingPaise = 1000) {
  await db.insert(schema.accounts).values({
    id: 1,
    name: "Bank",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const [settlement] = await db.insert(schema.platformSettlements).values({
    platformKey: "makemytrip",
    bankAccountId: 1,
    receiptId: `rcpt-${bookingCount}-${perBookingPaise}`,
    payoutDate: "2026-09-20",
    actualAmountPaise: bookingCount * perBookingPaise,
    createdBy: "admin",
    createdAt: "2026-09-20T10:00:00.000Z",
  }).returning();
  const allocations: Array<{ bookingId: number; bookingCycle: number; allocatedPaise: number }> = [];
  for (let i = 1; i <= bookingCount; i++) {
    await db.insert(schema.bookings).values({
      id: i,
      guestName: `Guest ${i}`,
      platform: "MakeMyTrip",
      checkinDate: "2026-09-15",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await db.insert(schema.platformReceivableEntries).values({
      bookingId: i,
      bookingCycle: 1,
      platformKey: "makemytrip",
      eventKey: `recognition:${bookingCount}:${i}:1`,
      entryType: "recognition",
      expectedNetPaise: perBookingPaise,
      recognitionDate: "2026-09-15",
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    allocations.push({ bookingId: i, bookingCycle: 1, allocatedPaise: perBookingPaise });
  }
  return { settlementId: settlement.id, allocations, totalPaise: bookingCount * perBookingPaise };
}

describe("platform settlement allocateBatch D1 bind safety", () => {
  beforeEach(() => {
    dbState.getDb.mockReset();
  });

  it("keeps OTA chunk size under the ~100 bind/statement cliff (12 binds/row × 9 = 108)", () => {
    expect(PLATFORM_ALLOC_INSERT_CHUNK).toBe(7);
    expect(PLATFORM_ALLOC_INSERT_CHUNK * 12).toBeLessThanOrEqual(100);
    expect(9 * 12).toBeGreaterThan(100);
    expect(GATEWAY_ALLOC_INSERT_CHUNK).toBe(12);
    expect(GATEWAY_ALLOC_INSERT_CHUNK * 7).toBeLessThanOrEqual(100);
    expect(15 * 7).toBeGreaterThan(100);
  });

  it("requires db.batch and never sequential-commits allocation chunks", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/platformReceivables.ts"), "utf8");
    const allocate = source.match(/export async function allocatePlatformSettlementBatch[\s\S]*?^export /m)?.[0]
      ?? source.match(/export async function allocatePlatformSettlementBatch[\s\S]*/)?.[0];
    expect(allocate).toBeTruthy();
    expect(allocate!).toContain("PLATFORM_ALLOC_INSERT_CHUNK");
    expect(allocate!).toContain('typeof batch !== "function"');
    expect(allocate!).toContain("batch.call(");
    expect(allocate!).toContain("results.flatMap");
    expect(allocate!).not.toContain("for (const chunk of chunks) {\n    await db.insert");
  });

  it("website allocateBatch chunks via db.batch and caps at 100 selections", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/admin/platform-settlements/route.ts"), "utf8");
    expect(route).toContain("GATEWAY_ALLOC_INSERT_CHUNK");
    expect(route).toContain("website.length > 100");
    expect(route).toContain('typeof batch !== "function"');
    expect(route).toContain("batch.call(");
    expect(route).toContain("results.flatMap");
  });

  it.each([1, 7, 8, 9, 15])("allocates %i OTA booking cycles under bind-safe chunks", async (count) => {
    const db = openDb();
    dbState.getDb.mockReturnValue(db);
    const { settlementId, allocations, totalPaise } = await seedSettlement(db, count);

    const result = await allocatePlatformSettlementBatch({
      settlementId,
      allocations,
      actor: "admin",
    });

    expect(result.ids).toHaveLength(count);
    expect(result.unallocatedPaise).toBe(0);
    const rows = await db.select().from(schema.platformSettlementAllocations)
      .where(eq(schema.platformSettlementAllocations.settlementId, settlementId));
    expect(rows).toHaveLength(count);
    expect(rows.reduce((sum, row) => sum + row.allocatedPaise, 0)).toBe(totalPaise);
  });

  it("rejects more than 100 OTA allocations before any write", async () => {
    const db = openDb();
    dbState.getDb.mockReturnValue(db);
    await expect(allocatePlatformSettlementBatch({
      settlementId: 1,
      allocations: Array.from({ length: 101 }, (_, i) => ({
        bookingId: i + 1,
        bookingCycle: 1,
        allocatedPaise: 100,
      })),
      actor: "admin",
    })).rejects.toThrow(/between 1 and 100/);
  });

  it("rejects payout over-allocate before insert", async () => {
    const db = openDb();
    dbState.getDb.mockReturnValue(db);
    const { settlementId, allocations } = await seedSettlement(db, 2, 1000);
    await db.update(schema.platformSettlements)
      .set({ actualAmountPaise: 1500 })
      .where(eq(schema.platformSettlements.id, settlementId));
    await expect(allocatePlatformSettlementBatch({
      settlementId,
      allocations,
      actor: "admin",
    })).rejects.toThrow(/exceeds payout/);
    const rows = await db.select().from(schema.platformSettlementAllocations);
    expect(rows).toHaveLength(0);
  });

  it("rejects expected-net overflow without variance before insert", async () => {
    const db = openDb();
    dbState.getDb.mockReturnValue(db);
    const { settlementId } = await seedSettlement(db, 1, 1000);
    // Enlarge payout so payout-cap is not the failure mode.
    await db.update(schema.platformSettlements)
      .set({ actualAmountPaise: 5000 })
      .where(eq(schema.platformSettlements.id, settlementId));
    await expect(allocatePlatformSettlementBatch({
      settlementId,
      allocations: [{ bookingId: 1, bookingCycle: 1, allocatedPaise: 1001 }],
      actor: "admin",
    })).rejects.toThrow(/expected net/);
    const rows = await db.select().from(schema.platformSettlementAllocations);
    expect(rows).toHaveLength(0);
  });

  it("fails closed when db.batch is missing (no sequential partial commit)", async () => {
    const db = openDb();
    delete (db as { batch?: unknown }).batch;
    dbState.getDb.mockReturnValue(db);
    const { settlementId, allocations } = await seedSettlement(db, 9);
    await expect(allocatePlatformSettlementBatch({
      settlementId,
      allocations,
      actor: "admin",
    })).rejects.toThrow(/D1 batch API unavailable/);
    const rows = await db.select().from(schema.platformSettlementAllocations);
    expect(rows).toHaveLength(0);
  });

  it("issues multiple batch statements when allocation count exceeds chunk size", async () => {
    const db = openDb();
    const batchSpy = vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));
    (db as unknown as { batch: typeof batchSpy }).batch = batchSpy;
    dbState.getDb.mockReturnValue(db);
    const { settlementId, allocations } = await seedSettlement(db, 15);

    const result = await allocatePlatformSettlementBatch({
      settlementId,
      allocations,
      actor: "admin",
    });

    expect(result.ids).toHaveLength(15);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statements = batchSpy.mock.calls[0][0];
    expect(statements).toHaveLength(Math.ceil(15 / PLATFORM_ALLOC_INSERT_CHUNK));
  });
});
