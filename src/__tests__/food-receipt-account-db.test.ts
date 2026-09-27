import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { accounts } from "@/db/schema";

const getDb = vi.hoisted(() => vi.fn());
const getSetting = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({ getDb }));
vi.mock("@/db/queries", () => ({ getSetting }));

import {
  requireActiveReceiptAccount,
  resolveReceiptAccount,
  RAZORPAY_WEBSITE_PLATFORM_KEY,
} from "@/lib/guestReceipts";

describe("requireActiveReceiptAccount / resolveReceiptAccount (disposable SQLite)", () => {
  let sqlite: SQLite.Database;

  beforeEach(() => {
    sqlite = new SQLite(":memory:");
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
    `);
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO accounts (id, name, nickname, is_active, is_virtual, platform_key, created_at)
      VALUES
        (1, 'Sunny HDFC', 'HDFC', 1, 0, '', ?),
        (2, 'Razorpay Website Receivable', 'pending payout', 1, 1, ?, ?),
        (3, 'Booking.com Receivable', 'OTA', 1, 1, 'booking-com', ?),
        (4, 'Old Bank', 'old', 0, 0, '', ?)
    `).run(now, RAZORPAY_WEBSITE_PLATFORM_KEY, now, now, now);
    getDb.mockReturnValue(drizzle(sqlite, { schema: { accounts } }));
    getSetting.mockReset();
  });

  afterEach(() => {
    sqlite.close();
  });

  it("accepts ordinary food/room banks", async () => {
    await expect(requireActiveReceiptAccount(1, "food")).resolves.toBe(1);
    await expect(requireActiveReceiptAccount(1, "room")).resolves.toBe(1);
  });

  it("accepts Razorpay Website virtual for food only", async () => {
    await expect(requireActiveReceiptAccount(2, "food")).resolves.toBe(2);
    await expect(requireActiveReceiptAccount(2, "room")).rejects.toThrow(/not active/);
  });

  it("rejects other virtuals and inactive banks for food", async () => {
    await expect(requireActiveReceiptAccount(3, "food")).rejects.toThrow(/not active/);
    await expect(requireActiveReceiptAccount(4, "food")).rejects.toThrow(/not active/);
    await expect(requireActiveReceiptAccount(0, "food")).rejects.toThrow(/required/);
    await expect(requireActiveReceiptAccount("x", "food")).rejects.toThrow(/required/);
  });

  it("resolveReceiptAccount uses supplied id before settings default", async () => {
    getSetting.mockResolvedValue("1");
    await expect(resolveReceiptAccount("food", 2)).resolves.toBe(2);
    expect(getSetting).not.toHaveBeenCalled();
  });

  it("resolveReceiptAccount falls back to food setting for ordinary banks", async () => {
    getSetting.mockResolvedValue("1");
    await expect(resolveReceiptAccount("food", undefined)).resolves.toBe(1);
    expect(getSetting).toHaveBeenCalledWith("food_online_receipt_account_id");
  });

  it("resolveReceiptAccount food setting pointing at Razorpay virtual is accepted", async () => {
    getSetting.mockResolvedValue("2");
    await expect(resolveReceiptAccount("food", undefined)).resolves.toBe(2);
  });

  it("resolveReceiptAccount room setting pointing at Razorpay virtual is rejected", async () => {
    getSetting.mockResolvedValue("2");
    await expect(resolveReceiptAccount("room", undefined)).rejects.toThrow(/not active/);
  });
});
