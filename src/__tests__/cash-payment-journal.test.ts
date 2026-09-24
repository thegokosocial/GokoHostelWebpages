import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { cashPaymentEvents, syncIdMap } from "@/db/schema";
import { recordCashPaymentCorrection, recordCashPaymentEvent } from "@/lib/cashPaymentJournal";
import { applyPullRecords } from "@/lib/syncEngine";

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock("@/db", () => ({ getDb: () => state.db }));

const skippedPiMigrations = new Set([
  "0035_site_cms.sql", "0041_splits.sql", "0064_food_bill_share_tokens.sql",
  "0066_gateway_receivables.sql", "0068_gateway_settlement_allocations.sql",
]);

let sqlite: SQLite.Database;
let db: Database;

beforeEach(() => {
  vi.stubEnv("GOKO_RUNTIME", "pi");
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (!skippedPiMigrations.has(file)) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  db = drizzle(sqlite, { schema }) as unknown as Database;
  state.db = db;
});

afterEach(() => {
  state.db = null;
  sqlite.close();
  vi.unstubAllEnvs();
});

const collection = {
  eventId: "cash-collection-1", operationId: "payment-1", sourceType: "food_order" as const,
  sourceId: 11, eventType: "collection" as const, amountPaise: 192000,
  actor: "admin", guestNameSnapshot: "Viswambar Chowdary", referenceSnapshot: "D262-11",
  businessDate: "2026-09-23",
};

describe("ordinary cash payment journal", () => {
  it("records exact paise once and makes retries idempotent", async () => {
    expect(await recordCashPaymentEvent(collection)).toMatchObject({ duplicate: false });
    expect(await recordCashPaymentEvent(collection)).toMatchObject({ duplicate: true });
    expect(await db.select().from(cashPaymentEvents)).toMatchObject([{
      eventId: "cash-collection-1", operationId: "payment-1", amountPaise: 192000,
      eventType: "collection", businessDate: "2026-09-23",
    }]);
  });

  it("appends a signed correction to the same operation and leaves legacy cash unchanged", async () => {
    await recordCashPaymentEvent(collection);
    expect(await recordCashPaymentCorrection({
      eventId: "cash-correction-1", sourceType: "food_order", sourceId: 11, amountPaise: -2000,
      actor: "admin", guestNameSnapshot: "Viswambar Chowdary", referenceSnapshot: "D262-11",
      note: "Correct entered amount",
    })).toMatchObject({ duplicate: false });
    expect(await recordCashPaymentCorrection({
      eventId: "legacy-correction", sourceType: "booking", sourceId: 99, amountPaise: -1000,
      actor: "admin", guestNameSnapshot: "Legacy Guest", referenceSnapshot: "GOKO-99",
    })).toMatchObject({ skippedLegacy: true });

    const events = await db.select().from(cashPaymentEvents);
    expect(events.map((event) => event.amountPaise)).toEqual([192000, -2000]);
    expect(events[1]).toMatchObject({
      operationId: "payment-1", eventType: "correction", correctsEventId: "cash-collection-1",
      businessDate: "2026-09-23",
    });
  });

  it("rejects new or corrected cash movements after a covering Cash reconciliation", async () => {
    await recordCashPaymentEvent(collection);
    sqlite.prepare(`INSERT INTO daily_ledger
      (date, account_id, opening_balance, total_income, total_expense, expected_closing, actual_closing, is_reconciled)
      VALUES ('2026-09-24', NULL, 0, 0, 0, 0, 0, 1)`).run();

    await expect(recordCashPaymentEvent({ ...collection, eventId: "late-cash", operationId: "payment-2", sourceId: 12 }))
      .rejects.toMatchObject({ status: 409 });
    await expect(recordCashPaymentCorrection({
      eventId: "late-correction", sourceType: "food_order", sourceId: 11, amountPaise: -1000,
      actor: "admin", guestNameSnapshot: "Viswambar Chowdary", referenceSnapshot: "D262-11",
    })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(cashPaymentEvents)).toHaveLength(1);
  });

  it("rejects zero and fractional paise amounts", async () => {
    await expect(recordCashPaymentEvent({ ...collection, amountPaise: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(recordCashPaymentEvent({ ...collection, amountPaise: 10.5 })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects reuse of a payment identity with different money", async () => {
    await recordCashPaymentEvent(collection);
    await expect(recordCashPaymentEvent({ ...collection, amountPaise: 1 })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(cashPaymentEvents)).toHaveLength(1);
  });

  it("spreads a correction across collections and never attaches it to a later refund", async () => {
    await recordCashPaymentEvent({ ...collection, amountPaise: 10000 });
    await recordCashPaymentEvent({ ...collection, eventId: "second", operationId: "second", amountPaise: 5000 });
    await recordCashPaymentEvent({ ...collection, eventId: "refund", operationId: "refund", eventType: "refund", amountPaise: -1000 });
    const correction = { ...collection, eventId: "fix", amountPaise: -12000 };
    await recordCashPaymentCorrection(correction);
    expect(await recordCashPaymentCorrection(correction)).toMatchObject({ duplicate: true });
    const events = await db.select().from(cashPaymentEvents);
    expect(events.filter((event) => event.eventType === "correction").map((event) => [event.operationId, event.amountPaise, event.correctsEventId]))
      .toEqual([["second", -5000, "second"], ["payment-1", -7000, collection.eventId]]);
    expect(events.find((event) => event.eventId === "refund")?.amountPaise).toBe(-1000);
  });

  it("rejects an excessive correction without modifying the source balance", async () => {
    await recordCashPaymentEvent({ ...collection, amountPaise: 10000 });
    await expect(recordCashPaymentCorrection({ ...collection, eventId: "too-much", amountPaise: -10001 }, { values: { amountPaid: 0 } }))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(cashPaymentEvents)).toHaveLength(1);
  });

  it("rolls back the source update and online receipt when a cash insert fails", async () => {
    sqlite.exec(`INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, created_at, updated_at)
      VALUES (11, 'F11', 'Test', 192000, 0, '2026-09-23', '2026-09-23');
      CREATE TRIGGER reject_test_cash BEFORE INSERT ON cash_payment_events BEGIN SELECT RAISE(ABORT, 'test journal failure'); END;`);
    await expect(recordCashPaymentEvent(collection, { values: { amountPaid: 192000 } })).rejects.toThrow();
    expect(sqlite.prepare("SELECT amount_paid FROM food_orders WHERE id = 11").get()).toEqual({ amount_paid: 0 });
    expect(await db.select().from(cashPaymentEvents)).toHaveLength(0);
  });

  it("commits a cash collection with its source balance", async () => {
    sqlite.exec(`INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, created_at, updated_at)
      VALUES (11, 'F11', 'Test', 192000, 0, '2026-09-23', '2026-09-23');`);
    await recordCashPaymentEvent(collection, { values: { amountPaid: 192000 } });
    expect(sqlite.prepare("SELECT amount_paid FROM food_orders WHERE id = 11").get()).toEqual({ amount_paid: 192000 });
    expect(await db.select().from(cashPaymentEvents)).toHaveLength(1);
  });

  it("rejects a stale source balance without posting a second collection", async () => {
    sqlite.exec(`INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, created_at, updated_at)
      VALUES (11, 'F11', 'Test', 192000, 192000, '2026-09-23', '2026-09-23');`);
    await expect(recordCashPaymentEvent(collection, { values: { amountPaid: 192000 }, expectedPaid: 0 })).rejects.toThrow();
    expect(await db.select().from(cashPaymentEvents)).toHaveLength(0);
    expect(sqlite.prepare("SELECT amount_paid FROM food_orders WHERE id = 11").get()).toEqual({ amount_paid: 192000 });
  });

  it("uses an atomic D1 batch for mixed tender and rolls everything back on a journal failure", async () => {
    const client = {
      prepare(query: string) {
        return { bind: (...params: unknown[]) => ({
          raw: async () => sqlite.prepare(query).raw(true).all(...params),
          run: async () => ({ results: [], success: true, meta: { changes: sqlite.prepare(query).run(...params).changes } }),
          all: async () => {
            const statement = sqlite.prepare(query);
            return statement.reader ? { results: statement.all(...params), success: true, meta: {} }
              : { results: [], success: true, meta: { changes: statement.run(...params).changes } };
          },
        }) };
      },
      async batch(statements: Array<{ all: () => Promise<unknown> }>) {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    };
    state.db = drizzleD1(client as any, { schema }) as unknown as Database;
    sqlite.exec(`INSERT INTO accounts (id, name, created_at) VALUES (1, 'Test', '2026-09-23');
      INSERT INTO food_orders (id, order_number, guest_name, total, amount_paid, created_at, updated_at)
      VALUES (11, 'F11', 'Test', 192000, 0, '2026-09-23', '2026-09-23');
      CREATE TRIGGER reject_test_cash BEFORE INSERT ON cash_payment_events BEGIN SELECT RAISE(ABORT, 'test journal failure'); END;`);
    const mutation = { values: { amountPaid: 192000 }, receipts: [{
      receiptId: "split-online", sourceType: "food_order" as const, sourceId: 11, kind: "food" as const,
      accountId: 1, amount: 92000, createdBy: "admin",
    }] };
    await expect(recordCashPaymentEvent({ ...collection, amountPaise: 100000 }, mutation)).rejects.toThrow();
    expect(sqlite.prepare("SELECT amount_paid FROM food_orders WHERE id = 11").get()).toEqual({ amount_paid: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM guest_receipts").get()).toEqual({ n: 0 });
    sqlite.exec("DROP TRIGGER reject_test_cash");
    await recordCashPaymentEvent({ ...collection, amountPaise: 100000 }, mutation);
    expect(sqlite.prepare("SELECT amount_paid FROM food_orders WHERE id = 11").get()).toEqual({ amount_paid: 192000 });
    expect(sqlite.prepare("SELECT amount FROM guest_receipts").get()).toEqual({ amount: 92000 });
    expect(sqlite.prepare("SELECT amount_paise FROM cash_payment_events").get()).toEqual({ amount_paise: 100000 });
  });

  it("remaps a synced cash event to the local food-order id", async () => {
    await db.insert(syncIdMap).values({
      tableName: "food_orders", syncId: "food-order-sync", localId: 11, remoteId: 55,
    });
    const result = await applyPullRecords(db, [{
      table: "cash_payment_events",
      records: [{
        syncId: "cash-sync-1", syncUpdatedAt: "2026-09-23T12:00:00Z", syncSource: "cloudflare",
        data: {
          id: 9, eventId: "remote-cash", operationId: "remote-operation", sourceType: "food_order", sourceId: 55,
          eventType: "collection", amountPaise: 5000, businessDate: "2026-09-23", correctsEventId: null,
          guestNameSnapshot: "Remote Guest", referenceSnapshot: "D262-55", note: "", actor: "admin",
          createdAt: "2026-09-23T12:00:00Z", syncId: "cash-sync-1",
          syncUpdatedAt: "2026-09-23T12:00:00Z", syncSource: "cloudflare",
        },
      }],
    }], "cloudflare");

    expect(result.applied).toBe(1);
    expect(await db.select().from(cashPaymentEvents)).toMatchObject([{ eventId: "remote-cash", sourceId: 11 }]);
  });
});
