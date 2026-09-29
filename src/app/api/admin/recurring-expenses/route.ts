import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { authenticateUser } from "@/lib/auth";
import { getDb } from "@/db";
import { recurringExpenseOccurrences, recurringExpenseRules, expenses, accounts, vendors } from "@/db/schema";
import { ensureRecurringExpenseOccurrences } from "@/lib/recurringExpenseStore";
import { todayIST } from "@/lib/utils";
import { isPiRuntime } from "@/lib/runtime";

const validFrequency = new Set(["daily", "weekly", "monthly", "yearly"]);
function clean(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function validDate(value: string) { const parsed = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }

export async function POST(req: NextRequest) {
  if (isPiRuntime()) return NextResponse.json({ error: "Recurring expenses are managed in Cloudflare" }, { status: 403 });
  const body = await req.json(); const auth = await authenticateUser(body.password, body.username);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const db = getDb(); const action = body.action; const now = new Date().toISOString();
  if (action === "list") {
    await ensureRecurringExpenseOccurrences(todayIST());
    const [rules, occurrences] = await Promise.all([
      db.select().from(recurringExpenseRules).orderBy(desc(recurringExpenseRules.active), desc(recurringExpenseRules.id)),
      db.select({ occurrence: recurringExpenseOccurrences, expenseBillImageLink: expenses.billImageLink }).from(recurringExpenseOccurrences).leftJoin(expenses, eq(recurringExpenseOccurrences.expenseId, expenses.id)).orderBy(desc(recurringExpenseOccurrences.dueDate), desc(recurringExpenseOccurrences.id)),
    ]);
    return NextResponse.json({ rules, occurrences });
  }
  if (action === "saveRule") {
    const name = clean(body.name, 100), category = clean(body.category, 100), startDate = clean(body.startDate, 10), endDate = clean(body.endDate, 10), frequency = clean(body.frequency, 20), postingMode = clean(body.postingMode, 20);
    const amount = body.amount === "" || body.amount == null ? null : Number(body.amount);
    const paymentMethod = body.paymentMethod === "online" ? "online" : "cash";
    const accountId = paymentMethod === "online" ? Number(body.accountId) : null;
    if (!name || !category || !validDate(startDate) || startDate < todayIST() || (endDate && (!validDate(endDate) || endDate < startDate)) || !validFrequency.has(frequency) || !["review", "automatic"].includes(postingMode)) return NextResponse.json({ error: "Name, category, valid schedule, frequency, and posting mode are required" }, { status: 400 });
    if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)) return NextResponse.json({ error: "Amount must be a positive paise integer" }, { status: 400 });
    if (postingMode === "automatic" && amount === null) return NextResponse.json({ error: "Automatic posting requires a fixed amount" }, { status: 400 });
    if (paymentMethod === "online" && (!Number.isSafeInteger(accountId) || accountId === null || accountId < 1)) return NextResponse.json({ error: "Select a bank account for online payment" }, { status: 400 });
    if (accountId !== null && !(await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).limit(1)).length) return NextResponse.json({ error: "Select an active real bank account" }, { status: 400 });
    const vendorId = body.vendorId ? Number(body.vendorId) : null;
    if (vendorId !== null && !(await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1)).length) return NextResponse.json({ error: "Vendor not found" }, { status: 400 });
    const mainCategory = ["stay_expense", "food_expense", "goko_expense"].includes(body.mainCategory) ? body.mainCategory : "stay_expense";
    const values = { name, amount, category, customCategory: clean(body.customCategory, 100), purpose: clean(body.purpose), vendorId, accountId, paymentMethod, mainCategory, subCategory: clean(body.subCategory, 100), frequency, startDate, endDate: endDate || null, postingMode, updatedAt: now };
    if (body.id) await db.update(recurringExpenseRules).set(values).where(eq(recurringExpenseRules.id, Number(body.id)));
    else await db.insert(recurringExpenseRules).values({ ...values, active: 1, createdBy: auth.username || auth.displayName, createdAt: now });
    return NextResponse.json({ success: true });
  }
  if (action === "setActive") { await db.update(recurringExpenseRules).set({ active: body.active ? 1 : 0, updatedAt: now }).where(eq(recurringExpenseRules.id, Number(body.id))); return NextResponse.json({ success: true }); }
  if (action === "skip") { await db.update(recurringExpenseOccurrences).set({ status: "skipped", skippedReason: clean(body.reason), updatedAt: now }).where(and(eq(recurringExpenseOccurrences.id, Number(body.id)), eq(recurringExpenseOccurrences.status, "pending"))); return NextResponse.json({ success: true }); }
  if (action === "linkExpense") {
    const occurrence = (await db.select().from(recurringExpenseOccurrences).where(and(eq(recurringExpenseOccurrences.id, Number(body.id)), eq(recurringExpenseOccurrences.status, "pending"))).limit(1))[0];
    const expense = (await db.select().from(expenses).where(eq(expenses.id, Number(body.expenseId))).limit(1))[0];
    if (!occurrence || !expense || expense.expenseDate !== occurrence.dueDate) return NextResponse.json({ error: "The posted expense must use this occurrence date" }, { status: 400 });
    await db.update(recurringExpenseOccurrences).set({ status: "posted", expenseId: expense.id, error: "", updatedAt: now }).where(eq(recurringExpenseOccurrences.id, occurrence.id));
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
