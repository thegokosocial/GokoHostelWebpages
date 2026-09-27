import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, guestReceipts } from "@/db/schema";
import { syncInsert } from "@/db/syncMeta";
import { getSetting } from "@/db/queries";

/** Same key as `ensurePlatformProfile("Razorpay Website")` / Platform Receivables. */
export const RAZORPAY_WEBSITE_PLATFORM_KEY = "razorpay-website";

export function receiptBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** Pure eligibility for Received-in banks (unit-tested). Room never accepts virtuals. */
export function isEligibleReceiptAccount(
  account: { isActive?: number | boolean | null; isVirtual?: number | boolean | null; platformKey?: string | null },
  kind: "food" | "room",
): boolean {
  if (Number(account.isActive) !== 1) return false;
  if (Number(account.isVirtual) !== 1) return true;
  return kind === "food" && account.platformKey === RAZORPAY_WEBSITE_PLATFORM_KEY;
}

export async function requireActiveReceiptAccount(
  accountId: unknown,
  kind: "food" | "room" = "room",
): Promise<number> {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Receiving bank is required for online payment");
  const db = getDb();
  const row = await db.select({
    id: accounts.id,
    isActive: accounts.isActive,
    isVirtual: accounts.isVirtual,
    platformKey: accounts.platformKey,
  }).from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!row[0] || !isEligibleReceiptAccount(row[0], kind)) {
    throw new Error("Selected receiving bank is not active");
  }
  return id;
}

export async function resolveReceiptAccount(kind: "food" | "room", supplied: unknown): Promise<number> {
  const configured = supplied ?? await getSetting(kind === "food" ? "food_online_receipt_account_id" : "room_online_receipt_account_id");
  return requireActiveReceiptAccount(configured, kind);
}

export async function createGuestReceipt(data: {
  receiptId: string; sourceType: "food_order" | "booking" | "platform_settlement"; sourceId: number;
  kind: "food" | "stay" | "ota_prepaid" | "refund" | "reversal" | "platform_settlement";
  accountId: number; amount: number; createdBy: string; notes?: string; businessDate?: string;
  operationId?: string;
}) {
  if (!data.receiptId) throw new Error("receiptId required");
  const db = getDb();
  const existing = await db.select({ id: guestReceipts.id }).from(guestReceipts)
    .where(eq(guestReceipts.receiptId, data.receiptId)).limit(1);
  if (existing[0]) return { id: existing[0].id, duplicate: true };
  const now = new Date().toISOString();
  const rows = await db.insert(guestReceipts).values(syncInsert({
    ...data, businessDate: data.businessDate || receiptBusinessDate(), notes: data.notes || "", createdAt: now,
  })).returning({ id: guestReceipts.id });
  return { id: rows[0]?.id, duplicate: false };
}

export async function latestReceiptAccount(sourceType: "food_order" | "booking" | "platform_settlement", sourceId: number): Promise<number | null> {
  const db = getDb();
  const rows = await db.select({ accountId: guestReceipts.accountId }).from(guestReceipts)
    .where(and(eq(guestReceipts.sourceType, sourceType), eq(guestReceipts.sourceId, sourceId)))
    .orderBy(desc(guestReceipts.id)).limit(1);
  return rows[0]?.accountId ?? null;
}
