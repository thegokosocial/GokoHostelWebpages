import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
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
import { collectInBatches } from "@/lib/dbBatch";

/** ~12 binds/row with syncInsert; keep under D1's ~100 bind/statement cap with headroom. */
export const PLATFORM_ALLOC_INSERT_CHUNK = 7;
/** ~7 binds/row (no sync cols); same headroom policy as OTA allocations. */
export const GATEWAY_ALLOC_INSERT_CHUNK = 12;

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
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid monetary amount");
    const paise = Math.round(value * 100);
    if (!Number.isSafeInteger(paise)) throw new Error("Monetary amount is too large");
    return paise;
  }
  const raw = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Invalid monetary amount: ${raw}`);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const paise = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise)) throw new Error("Monetary amount is too large");
  return negative ? -paise : paise;
}

export function gatewayExpectedNetPaise(amountPaise: number, refundedPaise: number, feePaise: number | null, taxPaise: number | null): number | null {
  if (feePaise == null || taxPaise == null) return null;
  return amountPaise - refundedPaise - feePaise - taxPaise;
}

/** Hard backfill floor for missing OTA recognition (inclusive stay check-in date). */
export const PLATFORM_RECEIVABLE_BACKFILL_FROM = "2026-09-20";

type GatewayFeePair = { feePaise: number | null; taxPaise: number | null };

/** Provider non-null fee/tax overwrite stored values; omitted/null provider fields keep prior (including manual). */
export function mergeProviderGatewayFees(
  existing: GatewayFeePair,
  provider: { fee?: number | null; tax?: number | null },
): GatewayFeePair & { changed: boolean } {
  const feePaise = provider.fee != null ? provider.fee : existing.feePaise;
  const taxPaise = provider.tax != null ? provider.tax : existing.taxPaise;
  return {
    feePaise,
    taxPaise,
    changed: feePaise !== existing.feePaise || taxPaise !== existing.taxPaise,
  };
}

/** Manual entry only fills still-null fields; never overwrites verified provider/manual values. */
export function applyManualGatewayFees(
  existing: GatewayFeePair,
  manual: { feePaise?: number | null; taxPaise?: number | null },
): GatewayFeePair {
  let feePaise = existing.feePaise;
  let taxPaise = existing.taxPaise;
  if (manual.feePaise !== undefined && manual.feePaise !== null) {
    if (existing.feePaise != null) throw new Error("Gateway fee is already verified and cannot be overwritten manually");
    if (!Number.isSafeInteger(manual.feePaise) || manual.feePaise < 0) throw new Error("Invalid gateway fee");
    feePaise = manual.feePaise;
  }
  if (manual.taxPaise !== undefined && manual.taxPaise !== null) {
    if (existing.taxPaise != null) throw new Error("Gateway tax is already verified and cannot be overwritten manually");
    if (!Number.isSafeInteger(manual.taxPaise) || manual.taxPaise < 0) throw new Error("Invalid gateway tax");
    taxPaise = manual.taxPaise;
  }
  if (feePaise === existing.feePaise && taxPaise === existing.taxPaise) {
    throw new Error("Enter a pending gateway fee or tax value");
  }
  return { feePaise, taxPaise };
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

export async function ensurePlatformProfile(platform: string, paymentMode = "prepaid") {
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
      current.taxChargedPaise += entry.taxChargedPaise;
      current.taxWithheldPaise += entry.taxWithheldPaise;
      current.commissionPaise += entry.commissionPaise;
      current.tdsPaise += entry.tdsPaise;
      current.tcsPaise += entry.tcsPaise;
      current.otherDeductionsPaise += entry.otherDeductionsPaise;
      continue;
    }
    const allocatedPaise = allocatedByBookingCycle.get(key) || 0;
    byKey.set(key, { ...entry, allocatedPaise, outstandingPaise: 0 });
  }
  const bookingIds = [...new Set([...byKey.values()].map((row) => row.bookingId))];
  const bookingRows = bookingIds.length ? await collectInBatches(bookingIds, (batch) => db.select({
    id: bookings.id, guestName: bookings.guestName, bookingRef: bookings.bookingRef, gokoBookingId: bookings.gokoBookingId,
    checkinDate: bookings.checkinDate, checkoutDate: bookings.checkoutDate, platform: bookings.platform,
  }).from(bookings).where(inArray(bookings.id, batch))) : [];
  const bookingMap = new Map(bookingRows.map((row) => [row.id, row]));
  return [...byKey.values()].map((row) => ({
    ...row,
    booking: bookingMap.get(row.bookingId) || null,
    outstandingPaise: row.expectedNetPaise - row.allocatedPaise,
  }));
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
  const result = await allocatePlatformSettlementBatch({
    settlementId: data.settlementId,
    allocations: [{ bookingId: data.bookingId, bookingCycle: data.bookingCycle, allocatedPaise: data.allocatedPaise, varianceType: data.varianceType, notes: data.notes }],
    actor: data.actor,
  });
  return { id: result.ids[0], unallocatedPaise: result.unallocatedPaise };
}

export async function allocatePlatformSettlementBatch(data: {
  settlementId: number;
  allocations: Array<{ bookingId: number; bookingCycle: number; allocatedPaise: number; varianceType?: string; notes?: string }>;
  actor: string;
}) {
  if (!Number.isSafeInteger(data.settlementId) || data.settlementId <= 0 || !Array.isArray(data.allocations) || data.allocations.length === 0 || data.allocations.length > 100) {
    throw new Error("Choose a payout and between 1 and 100 receivables");
  }
  const deduped = new Set<string>();
  let requested = 0;
  for (const item of data.allocations) {
    const key = `${item.bookingId}:${item.bookingCycle}`;
    if (!Number.isSafeInteger(item.bookingId) || item.bookingId <= 0 || !Number.isSafeInteger(item.bookingCycle) || item.bookingCycle <= 0 || deduped.has(key)) {
      throw new Error("Each selected booking cycle must be valid and unique");
    }
    deduped.add(key);
    if (!Number.isSafeInteger(item.allocatedPaise) || item.allocatedPaise <= 0) throw new Error("Allocation must be positive paise");
    requested += item.allocatedPaise;
    if (!Number.isSafeInteger(requested)) throw new Error("Allocation total is too large");
  }
  const db = getDb();
  const settlement = await db.select().from(platformSettlements).where(eq(platformSettlements.id, data.settlementId)).limit(1);
  if (!settlement[0]) throw new Error("Settlement not found");
  const existing = await db.select({ allocatedPaise: platformSettlementAllocations.allocatedPaise })
    .from(platformSettlementAllocations).where(eq(platformSettlementAllocations.settlementId, data.settlementId));
  const used = existing.reduce((sum, row) => sum + row.allocatedPaise, 0);
  if (used + requested > settlement[0].actualAmountPaise) throw new Error("Allocation exceeds payout amount");
  const bookingIds = [...new Set(data.allocations.map((item) => item.bookingId))];
  const [bookingRows, receivableRows, allocationRows] = await Promise.all([
    collectInBatches(bookingIds, (batch) => db.select().from(bookings).where(inArray(bookings.id, batch))),
    collectInBatches(bookingIds, (batch) => db.select().from(platformReceivableEntries).where(inArray(platformReceivableEntries.bookingId, batch))),
    collectInBatches(bookingIds, (batch) => db.select().from(platformSettlementAllocations).where(inArray(platformSettlementAllocations.bookingId, batch))),
  ]);
  const bookingsById = new Map(bookingRows.map((row) => [row.id, row]));
  const insertionRows = data.allocations.map((item) => {
    if (!bookingsById.has(item.bookingId)) throw new Error(`Booking #${item.bookingId} not found`);
    const receivables = receivableRows.filter((row) => row.bookingId === item.bookingId && row.bookingCycle === item.bookingCycle);
    if (!receivables.length) throw new Error(`Booking #${item.bookingId} has not been recognized as a platform receivable yet`);
    if (!receivables.some((row) => row.platformKey === settlement[0].platformKey)) throw new Error("Settlement platform does not match selected receivables");
    const expected = receivables.reduce((sum, row) => sum + row.expectedNetPaise, 0);
    const allocated = allocationRows.filter((row) => row.bookingId === item.bookingId && row.bookingCycle === item.bookingCycle).reduce((sum, row) => sum + row.allocatedPaise, 0);
    const varianceType = item.varianceType?.trim() || "none";
    if (varianceType === "none" && allocated + item.allocatedPaise > expected) throw new Error(`Allocation exceeds booking #${item.bookingId}'s expected net; select a variance reason`);
    return syncInsert({
      settlementId: data.settlementId, bookingId: item.bookingId, bookingCycle: item.bookingCycle,
      allocationKey: `allocation:${data.settlementId}:${item.bookingId}:${item.bookingCycle}:${crypto.randomUUID()}`,
      allocatedPaise: item.allocatedPaise, varianceType, notes: item.notes || "", createdBy: data.actor, createdAt: new Date().toISOString(),
    });
  });
  // D1 ~100 binds/statement: syncInsert rows are ~12 binds each → chunk ≤7.
  // db.batch keeps multi-chunk allocate all-or-nothing (UUID allocationKey is not idempotent).
  const batch = (db as unknown as { batch?: (statements: unknown[]) => Promise<Array<Array<{ id: number }>>> }).batch;
  if (typeof batch !== "function") {
    throw new Error("D1 batch API unavailable for platform settlement allocation");
  }
  const chunks: typeof insertionRows[] = [];
  for (let start = 0; start < insertionRows.length; start += PLATFORM_ALLOC_INSERT_CHUNK) {
    chunks.push(insertionRows.slice(start, start + PLATFORM_ALLOC_INSERT_CHUNK));
  }
  const results = await batch.call(
    db,
    chunks.map((chunk) => db.insert(platformSettlementAllocations).values(chunk).returning({ id: platformSettlementAllocations.id })),
  );
  const ids = results.flatMap((rows) => rows.map((row) => row.id));
  return { ids, unallocatedPaise: settlement[0].actualAmountPaise - used - requested };
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

/**
 * Recognize prepaid checked-in stays from `fromDate` (inclusive check-in date) that lack a
 * recognition journal row for their current booking cycle. Default floor: 2026-09-20.
 */
export async function recognizeMissingPlatformBookings(
  actor = "system",
  fromDate = PLATFORM_RECEIVABLE_BACKFILL_FROM,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || fromDate < PLATFORM_RECEIVABLE_BACKFILL_FROM) {
    throw new Error(`Backfill start date must be on or after ${PLATFORM_RECEIVABLE_BACKFILL_FROM}`);
  }
  const db = getDb();
  const candidates = await db.select({
    id: bookings.id,
    bookingCycle: bookings.bookingCycle,
    platform: bookings.platform,
    paymentStatus: bookings.paymentStatus,
    amountTotal: bookings.amountTotal,
    amountTax: bookings.amountTax,
    amountBeforeTax: bookings.amountBeforeTax,
    currency: bookings.currency,
    rawData: bookings.rawData,
  }).from(bookings).where(and(
    eq(bookings.paymentStatus, "prepaid"),
    gte(bookings.checkinDate, fromDate),
    sql`COALESCE(${bookings.checkedInAt}, '') != ''`,
  ));
  if (!candidates.length) return { created: 0, skipped: 0, reasons: {} as Record<string, number> };

  const recognized = new Set<string>();
  const existing = await collectInBatches(candidates.map((row) => row.id), (batch) =>
    db.select({
      bookingId: platformReceivableEntries.bookingId,
      bookingCycle: platformReceivableEntries.bookingCycle,
    }).from(platformReceivableEntries).where(and(
      inArray(platformReceivableEntries.bookingId, batch),
      eq(platformReceivableEntries.entryType, "recognition"),
    )));
  for (const row of existing) recognized.add(`${row.bookingId}:${row.bookingCycle || 1}`);

  let created = 0;
  let skipped = 0;
  const reasons: Record<string, number> = {};
  const bump = (reason: string) => { reasons[reason] = (reasons[reason] || 0) + 1; skipped += 1; };

  for (const booking of candidates) {
    const cycle = booking.bookingCycle || 1;
    if (recognized.has(`${booking.id}:${cycle}`)) { bump("already-recognized"); continue; }
    try {
      const result = await recognizePlatformBooking(booking, actor);
      if (result.created) {
        created += 1;
        recognized.add(`${booking.id}:${cycle}`);
      } else {
        bump(result.reason || "skipped");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bump(message.slice(0, 120) || "error");
    }
  }
  return { created, skipped, reasons, fromDate };
}
