import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  accounts,
  bookings,
  guestReceipts,
  platformPaymentProfiles,
  platformReceivableEntries,
  platformSettlementAllocations,
  platformSettlements,
} from "@/db/schema";
import { syncInsert } from "@/db/syncMeta";
import { createGuestReceipt, requireActiveReceiptAccount } from "@/lib/guestReceipts";

export type PlatformAmounts = {
  grossPaise: number;
  taxChargedPaise: number;
  taxWithheldPaise: number;
  commissionPaise: number;
  tdsPaise: number;
  tcsPaise: number;
  otherDeductionsPaise: number;
};

const PLATFORM_AMOUNT_KEYS: (keyof PlatformAmounts)[] = [
  "grossPaise",
  "taxChargedPaise",
  "taxWithheldPaise",
  "commissionPaise",
  "tdsPaise",
  "tcsPaise",
  "otherDeductionsPaise",
];

/** Validate API/user-provided amounts before they reach integer finance columns. */
export function parsePlatformAmounts(input: unknown): PlatformAmounts {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Platform amounts are required");
  const record = input as Record<string, unknown>;
  return Object.fromEntries(PLATFORM_AMOUNT_KEYS.map((key) => {
    const raw = record[key];
    const value = raw === undefined || raw === null || raw === "" ? 0 : Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`Invalid platform amount: ${key}`);
    return [key, value];
  })) as PlatformAmounts;
}

export function subtractPlatformAmounts(next: PlatformAmounts, previous: PlatformAmounts): PlatformAmounts {
  return {
    grossPaise: next.grossPaise - previous.grossPaise,
    taxChargedPaise: next.taxChargedPaise - previous.taxChargedPaise,
    taxWithheldPaise: next.taxWithheldPaise - previous.taxWithheldPaise,
    commissionPaise: next.commissionPaise - previous.commissionPaise,
    tdsPaise: next.tdsPaise - previous.tdsPaise,
    tcsPaise: next.tcsPaise - previous.tcsPaise,
    otherDeductionsPaise: next.otherDeductionsPaise - previous.otherDeductionsPaise,
  };
}

/** Convert decimal rupees without binary floating-point rounding. */
export function rupeesToPaise(value: unknown): number {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid monetary amount");
  const raw = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Invalid monetary amount: ${raw}`);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const paise = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise)) throw new Error("Monetary amount is too large");
  return negative ? -paise : paise;
}

export function expectedNetPaise(amounts: PlatformAmounts, policy: Record<string, unknown> = {}): number {
  const subtract = (key: string, amount: number) => policy[key] === false ? 0 : amount;
  return amounts.grossPaise
    - subtract("taxCharged", amounts.taxChargedPaise)
    - subtract("taxWithheld", amounts.taxWithheldPaise)
    - subtract("commission", amounts.commissionPaise)
    - subtract("tds", amounts.tdsPaise)
    - subtract("tcs", amounts.tcsPaise)
    - subtract("otherDeductions", amounts.otherDeductionsPaise);
}

const DEFAULT_DEDUCTION_POLICY = {
  taxCharged: false,
  taxWithheld: true,
  commission: true,
  tds: true,
  tcs: true,
  otherDeductions: true,
};

function cleanPlatformKey(platform: string): string {
  return platform.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function platformBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

function amountsFromBooking(booking: {
  amountTotal?: number | null;
  amountTax?: number | null;
  amountBeforeTax?: number | null;
} & Partial<Record<string, unknown>>): PlatformAmounts {
  return {
    grossPaise: rupeesToPaise(booking.amountTotal || 0),
    taxChargedPaise: rupeesToPaise(booking.amountTax || 0),
    taxWithheldPaise: rupeesToPaise(booking.taxWithheld ?? 0),
    commissionPaise: rupeesToPaise(booking.commission ?? 0),
    tdsPaise: rupeesToPaise(booking.tds ?? 0),
    tcsPaise: rupeesToPaise(booking.tcs ?? 0),
    otherDeductionsPaise: rupeesToPaise(booking.otherDeductions ?? 0),
  };
}

async function ensurePlatformProfile(platform: string, paymentMode = "prepaid") {
  const db = getDb();
  const platformKey = cleanPlatformKey(platform);
  const existing = await db.select().from(platformPaymentProfiles)
    .where(eq(platformPaymentProfiles.platformKey, platformKey)).limit(1);
  if (existing[0]) return existing[0];

  const accountName = `${platform.trim() || "OTA"} Receivable`;
  const account = await db.select().from(accounts)
    .where(and(eq(accounts.platformKey, platformKey), eq(accounts.isVirtual, 1))).limit(1);
  let accountId = account[0]?.id;
  if (!accountId) {
    const created = await db.insert(accounts).values(syncInsert({
      name: accountName,
      nickname: `${platform.trim() || "OTA"} pending payout`,
      bankName: "",
      accountType: "virtual",
      accountNumber: "",
      ifscCode: "",
      isDefault: 0,
      isActive: 1,
      openingBalance: 0,
      isVirtual: 1,
      platformKey,
      createdAt: new Date().toISOString(),
    })).returning({ id: accounts.id });
    accountId = created[0]?.id;
  }
  if (!accountId) throw new Error("Could not create platform virtual account");
  const created = await db.insert(platformPaymentProfiles).values(syncInsert({
    platformKey,
    displayName: platform.trim() || "OTA",
    defaultPaymentMode: paymentMode,
    virtualAccountId: accountId,
    currency: "INR",
    taxTreatment: "tax_charged_not_withheld",
    deductionPolicy: JSON.stringify({ taxCharged: false, taxWithheld: true, commission: true, tds: true, tcs: true, otherDeductions: true }),
    isActive: 1,
    createdAt: new Date().toISOString(),
  })).returning();
  return created[0];
}

function profilePolicy(profile: { deductionPolicy?: string | null }): Record<string, unknown> {
  try {
    const parsed = JSON.parse(profile.deductionPolicy || "{}");
    return parsed && typeof parsed === "object" ? { ...DEFAULT_DEDUCTION_POLICY, ...parsed } : DEFAULT_DEDUCTION_POLICY;
  } catch { return DEFAULT_DEDUCTION_POLICY; }
}

export async function recognizePlatformBooking(booking: {
  id: number;
  bookingCycle?: number | null;
  platform: string;
  paymentStatus?: string | null;
  amountTotal?: number | null;
  amountTax?: number | null;
  amountBeforeTax?: number | null;
  currency?: string | null;
  rawData?: string | null;
}, actor = "system", recognitionDate = platformBusinessDate()) {
  if ((booking.paymentStatus || "").toLowerCase() !== "prepaid") return { created: false, reason: "not-prepaid" as const };
  let payloadCurrency = "";
  try {
    payloadCurrency = String((JSON.parse(booking.rawData || "{}").amount || {}).currency || "");
  } catch { /* fallback to the normalized booking column */ }
  const currency = (payloadCurrency || booking.currency || "INR").trim().toUpperCase();
  if (currency !== "INR") return { created: false, reason: "unsupported-currency" as const };
  const profile = await ensurePlatformProfile(booking.platform, "prepaid");
  if (!profile || profile.currency !== "INR") return { created: false, reason: "unsupported-currency" as const };
  const cycle = booking.bookingCycle || 1;
  const eventKey = `recognition:${booking.id}:${cycle}`;
  const db = getDb();
  const prior = await db.select({ id: platformReceivableEntries.id }).from(platformReceivableEntries)
    .where(eq(platformReceivableEntries.eventKey, eventKey)).limit(1);
  if (prior[0]) return { created: false, reason: "duplicate" as const, id: prior[0].id };
  const amounts = bookingAmountsFromRaw(booking.rawData, booking);
  const expected = expectedNetPaise(amounts, profilePolicy(profile));
  const rows = await db.insert(platformReceivableEntries).values(syncInsert({
    bookingId: booking.id,
    bookingCycle: cycle,
    platformKey: profile.platformKey,
    eventKey,
    entryType: "recognition",
    ...amounts,
    expectedNetPaise: expected,
    recognitionDate,
    reason: "OTA prepaid booking recognized at check-in",
    sourcePayload: booking.rawData || "",
    createdBy: actor,
    createdAt: new Date().toISOString(),
  })).returning({ id: platformReceivableEntries.id });
  return { created: true, id: rows[0]?.id, expectedNetPaise: expected };
}

export async function recordPlatformAdjustment(data: {
  bookingId: number;
  bookingCycle: number;
  platform: string;
  amounts: PlatformAmounts;
  entryType: "adjustment" | "reversal";
  eventKey: string;
  reason: string;
  actor?: string;
  date?: string;
}) {
  const db = getDb();
  const prior = await db.select({ id: platformReceivableEntries.id }).from(platformReceivableEntries)
    .where(eq(platformReceivableEntries.eventKey, data.eventKey)).limit(1);
  if (prior[0]) return { created: false, duplicate: true, id: prior[0].id };
  if (data.entryType === "reversal") {
    const recognition = await db.select({ id: platformReceivableEntries.id }).from(platformReceivableEntries)
      .where(and(
        eq(platformReceivableEntries.bookingId, data.bookingId),
        eq(platformReceivableEntries.bookingCycle, data.bookingCycle),
        eq(platformReceivableEntries.entryType, "recognition"),
      )).limit(1);
    if (!recognition[0]) return { created: false, reason: "no-recognition" as const };
  }
  const profile = await ensurePlatformProfile(data.platform);
  const multiplier = data.entryType === "reversal" ? -1 : 1;
  const sourceAmounts = parsePlatformAmounts(data.amounts);
  const amounts = Object.fromEntries(Object.entries(sourceAmounts).map(([key, value]) => [key, value * multiplier])) as PlatformAmounts;
  const expected = expectedNetPaise(amounts, profilePolicy(profile));
  const rows = await db.insert(platformReceivableEntries).values(syncInsert({
    bookingId: data.bookingId,
    bookingCycle: data.bookingCycle,
    platformKey: profile.platformKey,
    eventKey: data.eventKey,
    entryType: data.entryType,
    ...amounts,
    expectedNetPaise: expected,
    recognitionDate: data.date || platformBusinessDate(),
    reason: data.reason,
    sourcePayload: "",
    createdBy: data.actor || "system",
    createdAt: new Date().toISOString(),
  })).returning({ id: platformReceivableEntries.id });
  return { created: true, id: rows[0]?.id, expectedNetPaise: expected };
}

export async function createPlatformSettlement(data: {
  platform: string;
  bankAccountId: unknown;
  payoutDate: string;
  actualAmountPaise: number;
  reference?: string;
  notes?: string;
  actor: string;
  receiptId?: string;
}) {
  if (!data.platform.trim()) throw new Error("Platform is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.payoutDate)) throw new Error("Valid payout date is required");
  if (!Number.isSafeInteger(data.actualAmountPaise) || data.actualAmountPaise <= 0) throw new Error("Payout amount must be positive paise");
  const db = getDb();
  const receiptId = data.receiptId || crypto.randomUUID();
  const duplicate = await db.select().from(platformSettlements)
    .where(eq(platformSettlements.receiptId, receiptId)).limit(1);
  if (duplicate[0]) {
    const existingReceipt = await db.select({ id: guestReceipts.id }).from(guestReceipts)
      .where(eq(guestReceipts.receiptId, receiptId)).limit(1);
    if (!existingReceipt[0]) {
      const profile = await ensurePlatformProfile(duplicate[0].platformKey);
      const accountId = await requireActiveReceiptAccount(duplicate[0].bankAccountId);
      await createGuestReceipt({
        receiptId,
        sourceType: "platform_settlement",
        sourceId: duplicate[0].id,
        kind: "platform_settlement",
        accountId,
        amount: duplicate[0].actualAmountPaise,
        businessDate: duplicate[0].payoutDate,
        createdBy: data.actor,
        notes: `Payout received from ${profile.displayName}${duplicate[0].reference ? ` (${duplicate[0].reference})` : ""}`,
      });
    }
    return { id: duplicate[0].id, duplicate: true };
  }
  const bankAccountId = await requireActiveReceiptAccount(data.bankAccountId);
  const profile = await ensurePlatformProfile(data.platform);
  const settlement = await db.insert(platformSettlements).values(syncInsert({
    platformKey: profile.platformKey,
    bankAccountId,
    receiptId,
    payoutDate: data.payoutDate,
    actualAmountPaise: data.actualAmountPaise,
    reference: data.reference || "",
    notes: data.notes || "",
    createdBy: data.actor,
    createdAt: new Date().toISOString(),
  })).returning({ id: platformSettlements.id });
  await createGuestReceipt({
    receiptId,
    sourceType: "platform_settlement",
    sourceId: settlement[0].id,
    kind: "platform_settlement",
    accountId: bankAccountId,
    amount: data.actualAmountPaise,
    businessDate: data.payoutDate,
    createdBy: data.actor,
    notes: `Payout received from ${profile.displayName}${data.reference ? ` (${data.reference})` : ""}`,
  });
  return { id: settlement[0].id, duplicate: false };
}

export async function getPlatformReceivableSummary() {
  const db = getDb();
  const entries = await db.select().from(platformReceivableEntries).orderBy(desc(platformReceivableEntries.id));
  const allocations = await db.select().from(platformSettlementAllocations);
  const allocatedByBookingCycle = new Map<string, number>();
  for (const row of allocations) {
    const key = `${row.bookingId}:${row.bookingCycle}`;
    allocatedByBookingCycle.set(key, (allocatedByBookingCycle.get(key) || 0) + row.allocatedPaise);
  }
  const byKey = new Map<string, typeof entries[number] & { allocatedPaise: number; outstandingPaise: number }>();
  for (const entry of entries) {
    const key = `${entry.bookingId}:${entry.bookingCycle}`;
    const current = byKey.get(key);
    if (current) {
      current.expectedNetPaise += entry.expectedNetPaise;
      current.grossPaise += entry.grossPaise;
      continue;
    }
    const allocatedPaise = allocatedByBookingCycle.get(key) || 0;
    byKey.set(key, { ...entry, allocatedPaise, outstandingPaise: 0 });
  }
  return [...byKey.values()].map((row) => ({ ...row, outstandingPaise: row.expectedNetPaise - row.allocatedPaise }));
}

export async function allocatePlatformSettlement(data: {
  settlementId: number;
  bookingId: number;
  bookingCycle: number;
  allocatedPaise: number;
  varianceType?: string;
  notes?: string;
  actor: string;
}) {
  if (!Number.isSafeInteger(data.allocatedPaise) || data.allocatedPaise <= 0) throw new Error("Allocation must be positive paise");
  const db = getDb();
  const settlement = await db.select().from(platformSettlements).where(eq(platformSettlements.id, data.settlementId)).limit(1);
  if (!settlement[0]) throw new Error("Settlement not found");
  const booking = await db.select().from(bookings).where(eq(bookings.id, data.bookingId)).limit(1);
  if (!booking[0]) throw new Error("Booking not found");
  const profile = await db.select({ platformKey: platformPaymentProfiles.platformKey })
    .from(platformPaymentProfiles).where(eq(platformPaymentProfiles.platformKey, settlement[0].platformKey)).limit(1);
  if (!profile[0] || profile[0].platformKey !== cleanPlatformKey(booking[0].platform)) throw new Error("Settlement platform does not match booking");
  const existing = await db.select({ allocatedPaise: platformSettlementAllocations.allocatedPaise })
    .from(platformSettlementAllocations).where(eq(platformSettlementAllocations.settlementId, data.settlementId));
  const used = existing.reduce((sum, row) => sum + row.allocatedPaise, 0);
  if (used + data.allocatedPaise > settlement[0].actualAmountPaise) throw new Error("Allocation exceeds payout amount");
  const bookingEntries = await db.select({ expectedNetPaise: platformReceivableEntries.expectedNetPaise })
    .from(platformReceivableEntries)
    .where(and(
      eq(platformReceivableEntries.bookingId, data.bookingId),
      eq(platformReceivableEntries.bookingCycle, data.bookingCycle),
    ));
  if (bookingEntries.length === 0) throw new Error("Booking has not been recognized as a platform receivable yet");
  const expectedNetPaiseForBooking = bookingEntries.reduce((sum, row) => sum + row.expectedNetPaise, 0);
  const bookingAllocations = await db.select({ allocatedPaise: platformSettlementAllocations.allocatedPaise })
    .from(platformSettlementAllocations)
    .where(and(
      eq(platformSettlementAllocations.bookingId, data.bookingId),
      eq(platformSettlementAllocations.bookingCycle, data.bookingCycle),
    ));
  const bookingAllocatedPaise = bookingAllocations.reduce((sum, row) => sum + row.allocatedPaise, 0);
  const varianceType = data.varianceType?.trim() || "none";
  if (varianceType === "none" && bookingAllocatedPaise + data.allocatedPaise > expectedNetPaiseForBooking) {
    throw new Error("Allocation exceeds the booking's expected net receivable; record an explicit variance for a mismatch");
  }
  const allocationKey = `allocation:${data.settlementId}:${data.bookingId}:${data.bookingCycle}:${crypto.randomUUID()}`;
  const rows = await db.insert(platformSettlementAllocations).values(syncInsert({
    settlementId: data.settlementId,
    bookingId: data.bookingId,
    bookingCycle: data.bookingCycle,
    allocationKey,
    allocatedPaise: data.allocatedPaise,
    varianceType,
    notes: data.notes || "",
    createdBy: data.actor,
    createdAt: new Date().toISOString(),
  })).returning({ id: platformSettlementAllocations.id });
  return { id: rows[0]?.id, unallocatedPaise: settlement[0].actualAmountPaise - used - data.allocatedPaise };
}

export function bookingAmountsFromRaw(rawData: string | null | undefined, fallback: { amountTotal?: number | null; amountTax?: number | null } = {}): PlatformAmounts {
  let amount: Record<string, unknown> = {};
  try { amount = ((JSON.parse(rawData || "{}").amount || {}) as Record<string, unknown>); } catch { /* fallback */ }
  return amountsFromBooking({
    amountTotal: Number(amount.amountAfterTax ?? fallback.amountTotal ?? 0),
    amountTax: Number(amount.tax ?? fallback.amountTax ?? 0),
    amountBeforeTax: Number(amount.amountBeforeTax ?? 0),
    taxWithheld: Number(amount.taxWithheld ?? 0),
    commission: Number(amount.commission ?? 0),
    tds: Number(amount.tds ?? 0),
    tcs: Number(amount.tcs ?? 0),
    otherDeductions: Number(amount.otherDeductions ?? 0),
  });
}
