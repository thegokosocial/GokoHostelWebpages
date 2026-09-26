import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "./index";
import {
  splitExpenseShares,
  splitExpenses,
  splitGroupMembers,
  splitGroups,
  splitMembers,
  splitSettlements,
} from "./schema";
import type { ExpenseEvent, SettlementEvent, ShareInput } from "@/lib/splits";
import { collectInBatches } from "@/lib/dbBatch";

export type SplitMemberRow = typeof splitMembers.$inferSelect;
export type SplitGroupRow = typeof splitGroups.$inferSelect;
export type SplitExpenseRow = typeof splitExpenses.$inferSelect;
export type SplitShareRow = typeof splitExpenseShares.$inferSelect;
export type SplitSettlementRow = typeof splitSettlements.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

export async function getSplitMembers() {
  const db = getDb();
  return db.select().from(splitMembers).orderBy(asc(splitMembers.id));
}

export async function getSplitMemberById(id: number) {
  const db = getDb();
  const rows = await db.select().from(splitMembers).where(eq(splitMembers.id, id)).limit(1);
  return rows[0] || null;
}

export async function getHouseMember() {
  const db = getDb();
  const rows = await db.select().from(splitMembers).where(eq(splitMembers.isHouse, 1)).limit(1);
  return rows[0] || null;
}

export async function addSplitMember(data: {
  name: string;
  phone?: string;
  notes?: string;
  kind?: string;
  userId?: number | null;
  employeeId?: number | null;
}) {
  const db = getDb();
  const result = await db.insert(splitMembers).values({
    name: data.name,
    phone: data.phone || "",
    notes: data.notes || "",
    kind: data.kind || "staff",
    userId: data.userId ?? null,
    employeeId: data.employeeId ?? null,
    isHouse: 0,
    isActive: 1,
    createdAt: nowIso(),
  }).returning({ id: splitMembers.id });
  return result[0]?.id ?? null;
}

export async function updateSplitMember(id: number, data: Partial<{
  name: string;
  phone: string;
  notes: string;
  kind: string;
  userId: number | null;
  employeeId: number | null;
  isActive: number;
}>) {
  const db = getDb();
  return db.update(splitMembers).set(data).where(eq(splitMembers.id, id));
}

export async function getSplitGroups() {
  const db = getDb();
  return db.select().from(splitGroups).orderBy(asc(splitGroups.id));
}

export async function getSplitGroupById(id: number) {
  const db = getDb();
  const rows = await db.select().from(splitGroups).where(eq(splitGroups.id, id)).limit(1);
  return rows[0] || null;
}

export async function addSplitGroup(data: { name: string; createdBy: string }) {
  const db = getDb();
  const result = await db.insert(splitGroups).values({
    name: data.name,
    createdBy: data.createdBy,
    createdAt: nowIso(),
  }).returning({ id: splitGroups.id });
  return result[0]?.id ?? null;
}

export async function updateSplitGroup(id: number, data: { name: string }) {
  const db = getDb();
  return db.update(splitGroups).set({ name: data.name }).where(eq(splitGroups.id, id));
}

export async function deleteSplitGroup(id: number) {
  const db = getDb();
  await db.delete(splitGroupMembers).where(eq(splitGroupMembers.groupId, id));
  return db.delete(splitGroups).where(eq(splitGroups.id, id));
}

export async function getGroupMemberIds(groupId: number): Promise<number[]> {
  const db = getDb();
  const rows = await db.select({ memberId: splitGroupMembers.memberId })
    .from(splitGroupMembers)
    .where(eq(splitGroupMembers.groupId, groupId));
  return rows.map((r) => r.memberId);
}

export async function getAllGroupMemberships() {
  const db = getDb();
  return db.select().from(splitGroupMembers);
}

export async function addMemberToGroup(groupId: number, memberId: number) {
  const db = getDb();
  await db.insert(splitGroupMembers).values({ groupId, memberId }).onConflictDoNothing();
}

export async function setGroupMembers(groupId: number, memberIds: number[]) {
  const db = getDb();
  await db.delete(splitGroupMembers).where(eq(splitGroupMembers.groupId, groupId));
  if (memberIds.length === 0) return;
  await db.insert(splitGroupMembers).values(memberIds.map((memberId) => ({ groupId, memberId })));
}

export async function getSplitExpenses(groupId: number, includeDeleted = false) {
  const db = getDb();
  const rows = includeDeleted
    ? await db.select().from(splitExpenses).where(eq(splitExpenses.groupId, groupId)).orderBy(desc(splitExpenses.createdAt), desc(splitExpenses.id))
    : await db.select().from(splitExpenses).where(and(eq(splitExpenses.groupId, groupId), isNull(splitExpenses.deletedAt))).orderBy(desc(splitExpenses.createdAt), desc(splitExpenses.id));
  return rows;
}

export async function countLiveExpenses(groupId: number) {
  const db = getDb();
  const rows = await db.select({ id: splitExpenses.id })
    .from(splitExpenses)
    .where(and(eq(splitExpenses.groupId, groupId), isNull(splitExpenses.deletedAt)))
    .limit(1);
  return rows.length;
}

export async function getSplitExpenseById(id: number) {
  const db = getDb();
  const rows = await db.select().from(splitExpenses).where(eq(splitExpenses.id, id)).limit(1);
  return rows[0] || null;
}

export async function insertSplitExpense(data: {
  groupId: number;
  description: string;
  totalAmount: number;
  expenseDate: string;
  splitMethod: string;
  notes: string;
  createdBy: string;
  hostelExpenseId?: number | null;
  idempotencyKey?: string | null;
}) {
  const db = getDb();
  const result = await db.insert(splitExpenses).values({
    ...data,
    hostelExpenseId: data.hostelExpenseId ?? null,
    idempotencyKey: data.idempotencyKey ?? null,
    createdAt: nowIso(),
  }).returning({ id: splitExpenses.id });
  return result[0]?.id ?? null;
}

export async function getSplitExpenseByIdempotencyKey(key: string) {
  if (!key) return null;
  const db = getDb();
  const rows = await db.select().from(splitExpenses).where(eq(splitExpenses.idempotencyKey, key)).limit(1);
  return rows[0] || null;
}

export async function updateSplitExpense(id: number, data: Partial<{
  description: string;
  totalAmount: number;
  expenseDate: string;
  splitMethod: string;
  notes: string;
  hostelExpenseId: number | null;
}>) {
  const db = getDb();
  return db.update(splitExpenses).set(data).where(eq(splitExpenses.id, id));
}

export async function softDeleteSplitExpense(id: number) {
  const db = getDb();
  return db.update(splitExpenses).set({ deletedAt: nowIso() }).where(eq(splitExpenses.id, id));
}

export async function hardDeleteSplitExpense(id: number) {
  const db = getDb();
  await db.delete(splitExpenseShares).where(eq(splitExpenseShares.expenseId, id));
  return db.delete(splitExpenses).where(eq(splitExpenses.id, id));
}

export async function getSharesForExpenses(expenseIds: number[]) {
  if (expenseIds.length === 0) return [];
  const db = getDb();
  return collectInBatches(expenseIds, (batch) => db.select().from(splitExpenseShares).where(inArray(splitExpenseShares.expenseId, batch)));
}

export async function insertShares(expenseId: number, shares: ShareInput[]) {
  const db = getDb();
  if (shares.length === 0) return;
  await db.insert(splitExpenseShares).values(
    shares.map((s) => ({
      expenseId,
      memberId: s.memberId,
      paidAmount: s.paidAmount,
      owedAmount: s.owedAmount,
    })),
  );
}

export async function replaceShares(expenseId: number, shares: ShareInput[]) {
  const previous = (await getSharesForExpenses([expenseId])).map((s) => ({
    memberId: s.memberId,
    paidAmount: s.paidAmount,
    owedAmount: s.owedAmount,
  }));
  const db = getDb();
  await db.delete(splitExpenseShares).where(eq(splitExpenseShares.expenseId, expenseId));
  try {
    await insertShares(expenseId, shares);
  } catch (err) {
    try {
      await insertShares(expenseId, previous);
    } catch (restoreErr) {
      console.error("split shares restore failed", restoreErr);
    }
    throw err;
  }
}

export async function getSplitSettlements(groupId: number, includeDeleted = false) {
  const db = getDb();
  return includeDeleted
    ? db.select().from(splitSettlements).where(eq(splitSettlements.groupId, groupId)).orderBy(desc(splitSettlements.createdAt), desc(splitSettlements.id))
    : db.select().from(splitSettlements).where(and(eq(splitSettlements.groupId, groupId), isNull(splitSettlements.deletedAt))).orderBy(desc(splitSettlements.createdAt), desc(splitSettlements.id));
}

export async function getAllLiveSettlements() {
  const db = getDb();
  return db.select().from(splitSettlements).where(isNull(splitSettlements.deletedAt));
}

export async function getAllLiveExpenses() {
  const db = getDb();
  return db.select().from(splitExpenses).where(isNull(splitExpenses.deletedAt));
}

export async function countLiveHumanSettlements(groupId: number) {
  const db = getDb();
  const rows = await db.select({ id: splitSettlements.id })
    .from(splitSettlements)
    .where(and(
      eq(splitSettlements.groupId, groupId),
      isNull(splitSettlements.deletedAt),
      isNull(splitSettlements.hostelExpenseId),
    ))
    .limit(1);
  return rows.length;
}

export async function countLiveSettlements(groupId: number) {
  const db = getDb();
  const rows = await db.select({ id: splitSettlements.id })
    .from(splitSettlements)
    .where(and(eq(splitSettlements.groupId, groupId), isNull(splitSettlements.deletedAt)))
    .limit(1);
  return rows.length;
}

export async function getSplitExpenseByHostelExpenseId(hostelExpenseId: number) {
  const db = getDb();
  const rows = await db.select().from(splitExpenses)
    .where(eq(splitExpenses.hostelExpenseId, hostelExpenseId))
    .limit(1);
  return rows[0] || null;
}

export async function getSettlementByHostelExpenseId(hostelExpenseId: number) {
  const db = getDb();
  const rows = await db.select().from(splitSettlements)
    .where(eq(splitSettlements.hostelExpenseId, hostelExpenseId))
    .limit(1);
  return rows[0] || null;
}

export async function hostelExpenseIsLinked(hostelExpenseId: number) {
  return Boolean(
    (await getSplitExpenseByHostelExpenseId(hostelExpenseId))
    || (await getSettlementByHostelExpenseId(hostelExpenseId)),
  );
}

export async function insertSplitSettlement(data: {
  groupId: number;
  fromMemberId: number;
  toMemberId: number;
  amount: number;
  method: string;
  notes: string;
  createdBy: string;
  hostelExpenseId?: number | null;
  splitExpenseId?: number | null;
}) {
  const db = getDb();
  const result = await db.insert(splitSettlements).values({
    ...data,
    hostelExpenseId: data.hostelExpenseId ?? null,
    splitExpenseId: data.splitExpenseId ?? null,
    createdAt: nowIso(),
  }).returning({ id: splitSettlements.id });
  return result[0]?.id ?? null;
}

export async function softDeleteSplitSettlement(id: number) {
  const db = getDb();
  return db.update(splitSettlements).set({ deletedAt: nowIso() }).where(eq(splitSettlements.id, id));
}

export async function hardDeleteSplitSettlement(id: number) {
  const db = getDb();
  return db.delete(splitSettlements).where(eq(splitSettlements.id, id));
}

export async function getSettlementById(id: number) {
  const db = getDb();
  const rows = await db.select().from(splitSettlements).where(eq(splitSettlements.id, id)).limit(1);
  return rows[0] || null;
}

export async function getReimbursementsForExpense(expenseId: number) {
  const db = getDb();
  return db.select().from(splitSettlements).where(and(
    eq(splitSettlements.splitExpenseId, expenseId),
    isNotNull(splitSettlements.hostelExpenseId),
    isNull(splitSettlements.deletedAt),
  ));
}

export function toExpenseEvents(
  expenses: SplitExpenseRow[],
  shares: SplitShareRow[],
): ExpenseEvent[] {
  const byExpense = new Map<number, ShareInput[]>();
  for (const s of shares) {
    const list = byExpense.get(s.expenseId) ?? [];
    list.push({ memberId: s.memberId, paidAmount: s.paidAmount, owedAmount: s.owedAmount });
    byExpense.set(s.expenseId, list);
  }
  return expenses.map((e) => ({
    id: e.id,
    deleted: Boolean(e.deletedAt),
    shares: byExpense.get(e.id) ?? [],
  }));
}

export function toSettlementEvents(rows: SplitSettlementRow[]): SettlementEvent[] {
  return rows.map((s) => ({
    id: s.id,
    fromMemberId: s.fromMemberId,
    toMemberId: s.toMemberId,
    amount: s.amount,
    deleted: Boolean(s.deletedAt),
    hostelExpenseId: s.hostelExpenseId,
    splitExpenseId: s.splitExpenseId,
  }));
}

export async function loadGroupLedger(groupId: number) {
  const [expenses, settlements] = await Promise.all([
    getSplitExpenses(groupId, true),
    getSplitSettlements(groupId, true),
  ]);
  const shares = await getSharesForExpenses(expenses.map((e) => e.id));
  return {
    expenses,
    shares,
    settlements,
    expenseEvents: toExpenseEvents(expenses, shares),
    settlementEvents: toSettlementEvents(settlements),
  };
}
