import { and, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, dailyLedger, recurringExpenseOccurrences, recurringExpenseRules } from "@/db/schema";
import { addExpense, addAuditEntry, getExpenseByIdempotencyKey } from "@/db/queries";
import { isUniqueConstraintError } from "@/lib/createIdempotency";
import { recurrenceDatesThrough, type RecurrenceFrequency } from "@/lib/recurringExpenses";

export async function ensureRecurringExpenseOccurrences(through: string) {
  const db = getDb();
  const rules = await db.select().from(recurringExpenseRules).where(eq(recurringExpenseRules.active, 1));
  let created = 0; let posted = 0; let failed = 0;
  for (const rule of rules) for (const dueDate of recurrenceDatesThrough(rule.startDate, rule.frequency as RecurrenceFrequency, rule.endDate && rule.endDate < through ? rule.endDate : through)) {
    const now = new Date().toISOString();
    try {
      await db.insert(recurringExpenseOccurrences).values({ ruleId: rule.id, dueDate, idempotencyKey: crypto.randomUUID(), amount: rule.amount, category: rule.category, customCategory: rule.customCategory, purpose: rule.purpose, vendorId: rule.vendorId, accountId: rule.accountId, paymentMethod: rule.paymentMethod, mainCategory: rule.mainCategory, subCategory: rule.subCategory, createdAt: now, updatedAt: now });
      created++;
    } catch { /* existing occurrence: safely resume a prior automatic-post attempt */ }
    if (rule.postingMode !== "automatic" || !rule.amount) continue;
    const occurrence = (await db.select().from(recurringExpenseOccurrences).where(and(eq(recurringExpenseOccurrences.ruleId, rule.id), eq(recurringExpenseOccurrences.dueDate, dueDate))).limit(1))[0];
    if (!occurrence) continue;
    const locked = await db.select({ id: dailyLedger.id }).from(dailyLedger).where(and(gte(dailyLedger.date, dueDate), rule.accountId == null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, rule.accountId), eq(dailyLedger.isReconciled, 1))).limit(1);
    const activeAccount = rule.paymentMethod === "online" && rule.accountId != null ? await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, rule.accountId), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).limit(1) : [{}];
    if (locked.length || !activeAccount.length) {
      await db.update(recurringExpenseOccurrences).set({ error: locked.length ? "Reconciliation must be undone before this automatic expense can post" : "Selected bank account is inactive", updatedAt: now }).where(eq(recurringExpenseOccurrences.id, occurrence.id));
      failed++; continue;
    }
    if (occurrence.status !== "pending") continue;
    let expenseId = (await getExpenseByIdempotencyKey(occurrence.idempotencyKey))?.id;
    if (!expenseId) try {
      expenseId = await addExpense({ amount: rule.amount, category: rule.category, customCategory: rule.customCategory, purpose: rule.purpose || rule.category, vendorId: rule.vendorId, accountId: rule.accountId, paymentMethod: rule.paymentMethod, mainCategory: rule.mainCategory, subCategory: rule.subCategory, createdBy: rule.createdBy, expenseDate: dueDate, createdMonth: dueDate.slice(0, 7), idempotencyKey: occurrence.idempotencyKey });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      expenseId = (await getExpenseByIdempotencyKey(occurrence.idempotencyKey))?.id;
      if (!expenseId) throw error;
    }
    await db.update(recurringExpenseOccurrences).set({ status: "posted", expenseId, updatedAt: now }).where(eq(recurringExpenseOccurrences.id, occurrence.id));
    await addAuditEntry({ username: rule.createdBy, action: "expense_added", target: rule.category, details: `Recurring expense for ${dueDate}` });
    posted++;
  }
  return { created, posted, failed };
}
