import { NextRequest, NextResponse } from "next/server";
import {
  addExpense,
  getExpensesByUser,
  getExpenseById,
  updateExpense,
  deleteExpense,
  addAuditEntry,
  addSystemLog,
  getSetting,
  getMonthKey,
} from "@/db/queries";
import { getDb } from "@/db";
import { foodOrders, checkins, expenses, accounts, dailyIncome, dailyLedger, vendors, bookings, guestReceipts, cashPaymentEvents, bookingPaymentEvents, bookingCycleSnapshots, platformPaymentProfiles, platformReceivableEntries, platformSettlementAllocations, platformSettlements, nativeBookingPayments, nativeBookingCheckouts, gatewaySettlementAllocations } from "@/db/schema";
import { eq, and, sql, desc, inArray, isNull, lt, gte, lte } from "drizzle-orm";
import { driveUploadFile, driveGetOrCreateFolder, driveDeleteFile } from "@/lib/googleApiFetch";
import { isOfflineMode, isPiRuntime } from "@/lib/runtime";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, actionAllowedAll, type ActionPerm } from "@/lib/actionPermissions";
import { hostelExpenseIsLinked } from "@/db/splitQueries";
import { stayDueAtHotel, cashCollected, onlineCollected, cashRefunded, onlineRefunded, occupiedForRoomRevenue, isPrepaidStatus } from "@/lib/stayPayment";
import { validateManualIncome } from "@/lib/income";
import { getReconciliationStatus, isValidReconciliationDate, parseReconciliationTarget, reconciliationPermission } from "@/lib/reconciliation";
import { parseExpenseCategories, parseIncomeCategories } from "@/lib/accountCategories";
import { todayIST } from "@/lib/utils";
import { defaultAccountingDateRange, isValidAccountingDateRange, resolveActivityAnchor } from "@/lib/accountingDates";
import { gatewayExpectedNetPaise } from "@/lib/platformReceivables";
import { sqliteWriteCount } from "@/lib/sqliteWriteCount";
import { bookingEventMethod, paiseToRupees } from "@/lib/bookingPaymentJournal";
import { collectInBatches } from "@/lib/dbBatch";

function extractDriveFileId(link: string): string | null {
  const match = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function rejectIfSplitLinked(id: number) {
  try {
    if (await hostelExpenseIsLinked(id)) {
      return NextResponse.json({ error: "This Accounts row is linked to Splits. Leave the books amount; undo from Splits if needed." }, { status: 400 });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table/i.test(msg)) return null;
    throw err;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, action, username, ...rest } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, displayName, permissions } = auth;
    const actorName = username || displayName;

    const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
      listExpenses: "canViewExpenses", getMyExpenses: "canViewExpenses",
      addExpense: "canAddExpense", updateExpense: "canEditExpense", deleteExpense: "canDeleteExpense",
      getExpenseEditOptions: "canEditExpense",
      getFoodRevenue: "canViewFoodBills",
      getRoomRevenue: "canViewFoodBills",
      getDailyLedger: "canViewAccounts", listIncomeRecords: "canViewAccounts", getReconciliation: "canViewAccounts",
      getIncomeAccounts: "canAddIncome", addDailyIncome: "canAddIncome", deleteDailyIncome: "canDeleteExpense",
      getExpenseCategories: "canAddExpense", getIncomeCategories: "canAddIncome",
      saveReconciliation: ["canReconcileCash", "canReconcileOnline"], undoReconciliation: "admin_only",
      adjustOpeningBalance: "canManageAccountSettings",
    };

    const requiredPerm = ACTION_PERMISSIONS[action];
    const gate = actionAllowed(role, permissions, requiredPerm);
    if (gate === "admin_required") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (gate === "forbidden") {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    switch (action) {
      case "getExpenseCategories":
        return NextResponse.json({ categories: parseExpenseCategories(await getSetting("expense_categories")) });
      case "getExpenseEditOptions": {
        const db = getDb();
        const [expenseAccounts, expenseVendors] = await Promise.all([
          db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname }).from(accounts)
            .where(eq(accounts.isVirtual, 0)).orderBy(accounts.name),
          db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.isActive, 1)).orderBy(vendors.name),
        ]);
        return NextResponse.json({ accounts: expenseAccounts, vendors: expenseVendors });
      }
      case "getAccountActivity": {
        if (actionAllowedAll(role, permissions, ["canViewAccounts", "canViewExpenses"]) !== "allowed") return NextResponse.json({ error: "You need account and expense record access to view account activity" }, { status: 403 });
        const accountKey = rest.accountId === "cash" ? "cash" : Number(rest.accountId);
        if (accountKey !== "cash" && (!Number.isInteger(accountKey) || accountKey < 1)) return NextResponse.json({ error: "Select a valid account" }, { status: 400 });
        const today = todayIST();
        const toDate = typeof rest.toDate === "string" ? rest.toDate : today;
        const fromDate = typeof rest.fromDate === "string" && rest.fromDate ? rest.fromDate : "0001-01-01";
        if (!isValidAccountingDateRange(fromDate, toDate, today)) return NextResponse.json({ error: "A valid date range is required" }, { status: 400 });
        const page = Math.max(1, Math.min(100000, Number(rest.page) || 1));
        const pageSize = Math.max(10, Math.min(100, Number(rest.pageSize) || 50));
        const accountId = accountKey === "cash" ? null : accountKey;
        const db = getDb();
        const accountCondition = accountId === null ? sql`account_id IS NULL` : sql`account_id = ${accountId}`;
        const receiptCondition = accountId === null ? sql`0 = 1` : sql`gr.account_id = ${accountId}`;
        const [allAccounts, accountRows, reconciliations, openingAdjustments] = await Promise.all([
          db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, bankName: accounts.bankName, accountType: accounts.accountType, accountNumber: accounts.accountNumber, openingBalance: accounts.openingBalance, isVirtual: accounts.isVirtual, isActive: accounts.isActive }).from(accounts).orderBy(accounts.name),
          accountId === null ? Promise.resolve([]) : db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1),
          db.select().from(dailyLedger).where(and(accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, accountId), sql`${dailyLedger.date} <= ${toDate}`, eq(dailyLedger.isReconciled, 1))).orderBy(desc(dailyLedger.date)),
          db.select().from(dailyLedger).where(and(accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, accountId), sql`${dailyLedger.date} <= ${toDate}`, eq(dailyLedger.openingAdjusted, 1))).orderBy(desc(dailyLedger.date)).limit(1),
        ]);
        if (accountId !== null && !accountRows[0]) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        const cashActivityCondition = accountId === null ? sql`1 = 1` : sql`0 = 1`;
        const activity = await db.all(sql`
          WITH receipt_lines AS (
            SELECT gr.*,
              CASE WHEN gr.source_type = 'food_order' THEN COALESCE(NULLIF(gr.operation_id, ''),
                CASE WHEN gr.receipt_id LIKE '%:food:' || gr.source_id
                  THEN substr(gr.receipt_id, 1, length(gr.receipt_id) - length(':food:' || gr.source_id)) END,
                gr.receipt_id) ELSE gr.receipt_id END AS payment_key,
              fo.guest_name AS food_guest_name, fo.order_number AS food_order_number,
              b.guest_name AS booking_guest_name, b.goko_booking_id, b.booking_ref
            FROM guest_receipts gr
            LEFT JOIN food_orders fo ON gr.source_type = 'food_order' AND gr.source_id = fo.id
            LEFT JOIN bookings b ON gr.source_type = 'booking' AND gr.source_id = b.id
            WHERE ${receiptCondition} AND gr.business_date >= ${fromDate} AND gr.business_date <= ${toDate}
          ), receipt_activity AS (
            SELECT 'receipt-' || payment_key AS id, MIN(business_date) AS date, MIN(kind) AS kind,
              CASE WHEN MIN(source_type) = 'food_order' THEN
                'Food payment · ' || CASE WHEN COUNT(DISTINCT COALESCE(NULLIF(food_guest_name, ''), 'guest')) = 1
                  THEN MIN(COALESCE(NULLIF(food_guest_name, ''), 'guest')) ELSE 'Combined bill' END
                WHEN MIN(source_type) = 'booking' THEN
                  CASE WHEN MIN(kind) = 'refund' THEN 'Stay refund · ' ELSE 'Stay payment · ' END ||
                    MIN(COALESCE(NULLIF(guest_name_snapshot, ''), NULLIF(booking_guest_name, ''), notes))
                ELSE MIN(notes) END AS description,
              SUM(amount) AS amount,
              CASE WHEN MIN(source_type) = 'food_order' THEN MIN(COALESCE(NULLIF(food_order_number, ''), CAST(source_id AS TEXT))) ||
                CASE WHEN COUNT(*) > 1 THEN ' + ' || (COUNT(*) - 1) || ' more' ELSE '' END
                WHEN MIN(source_type) = 'booking' THEN MIN(COALESCE(NULLIF(booking_ref_snapshot, ''), NULLIF(goko_booking_id, ''), NULLIF(booking_ref, ''), receipt_id))
                ELSE MIN(receipt_id) END AS reference,
              MIN(COALESCE(created_by, '')) AS addedBy
            FROM receipt_lines GROUP BY payment_key
          ), cash_activity AS (
            SELECT 'cash-' || operation_id AS id, MIN(business_date) AS date,
              CASE WHEN SUM(CASE WHEN event_type = 'refund' THEN 1 ELSE 0 END) > 0 THEN 'refund'
                WHEN MIN(source_type) = 'food_order' THEN 'food' ELSE 'stay' END AS kind,
              CASE WHEN SUM(CASE WHEN event_type = 'refund' THEN 1 ELSE 0 END) > 0
                THEN CASE WHEN MIN(source_type) = 'food_order' THEN 'Food refund · ' ELSE 'Stay refund · ' END
                ELSE CASE WHEN MIN(source_type) = 'food_order' THEN 'Food payment · ' ELSE 'Stay payment · ' END END || MIN(guest_name_snapshot) AS description,
              SUM(amount_paise) AS amount, MIN(reference_snapshot) AS reference, MIN(actor) AS addedBy
            FROM cash_payment_events
            WHERE ${cashActivityCondition} AND business_date >= ${fromDate} AND business_date <= ${toDate}
            GROUP BY operation_id HAVING SUM(amount_paise) != 0
          ), ota_cash_activity AS (
            SELECT 'ota-cash-' || COALESCE(corrects_event_id, event_id) AS id, MIN(business_date) AS date,
              CASE WHEN SUM(CASE WHEN event_type = 'refund' THEN 1 ELSE 0 END) > 0 THEN 'refund' ELSE 'stay' END AS kind,
              CASE WHEN SUM(CASE WHEN event_type = 'refund' THEN 1 ELSE 0 END) > 0
                THEN 'Stay refund · ' ELSE 'Stay payment · ' END || MIN(guest_name_snapshot) AS description, SUM(cash_paise) AS amount,
              MIN(COALESCE(NULLIF(booking_ref_snapshot, ''), 'Booking #' || booking_id)) AS reference,
              MIN(actor) AS addedBy
            FROM booking_payment_events
            WHERE ${cashActivityCondition} AND business_date IS NOT NULL AND cash_paise != 0
              AND business_date >= ${fromDate} AND business_date <= ${toDate}
            GROUP BY COALESCE(corrects_event_id, event_id) HAVING SUM(cash_paise) != 0
          )
          SELECT * FROM (
            SELECT 'income-' || id AS id, date, 'income' AS kind, COALESCE(description, source, '') AS description, amount, COALESCE(source_detail, '') AS reference, COALESCE(created_by, '') AS addedBy
            FROM daily_income WHERE ${accountCondition} AND date >= ${fromDate} AND date <= ${toDate}
            UNION ALL
            SELECT * FROM receipt_activity
            UNION ALL SELECT * FROM cash_activity
            UNION ALL SELECT * FROM ota_cash_activity
            UNION ALL
            SELECT 'expense-' || id AS id, expense_date AS date, 'expense' AS kind, COALESCE(purpose, category, '') AS description, -amount AS amount, category AS reference, COALESCE(created_by, '') AS addedBy
            FROM expenses WHERE ${accountCondition} AND expense_date >= ${fromDate} AND expense_date <= ${toDate} AND deleted_at IS NULL
          ) ORDER BY date DESC, id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `) as Array<{ id: string; date: string; kind: string; description: string; amount: number; reference: string; addedBy: string }>;
        const [incomeCount, receiptCountRows, cashCountRows, otaCashCountRows, expenseCount] = await Promise.all([
          db.select({ count: sql<number>`COUNT(*)` }).from(dailyIncome).where(and(accountId === null ? isNull(dailyIncome.accountId) : eq(dailyIncome.accountId, accountId), sql`${dailyIncome.date} >= ${fromDate} AND ${dailyIncome.date} <= ${toDate}`)),
          accountId === null ? Promise.resolve([{ count: 0 }]) : db.all(sql`SELECT COUNT(*) AS count FROM (SELECT CASE WHEN source_type = 'food_order' THEN COALESCE(NULLIF(operation_id, ''), CASE WHEN receipt_id LIKE '%:food:' || source_id THEN substr(receipt_id, 1, length(receipt_id) - length(':food:' || source_id)) END, receipt_id) ELSE receipt_id END payment_key FROM guest_receipts WHERE account_id = ${accountId} AND business_date >= ${fromDate} AND business_date <= ${toDate} GROUP BY payment_key)`),
          accountId === null ? db.all(sql`SELECT COUNT(*) AS count FROM (SELECT operation_id FROM cash_payment_events WHERE business_date >= ${fromDate} AND business_date <= ${toDate} GROUP BY operation_id HAVING SUM(amount_paise) != 0)`) : Promise.resolve([{ count: 0 }]),
          accountId === null ? db.all(sql`SELECT COUNT(*) AS count FROM (SELECT COALESCE(corrects_event_id, event_id) k FROM booking_payment_events WHERE business_date IS NOT NULL AND cash_paise != 0 AND business_date >= ${fromDate} AND business_date <= ${toDate} GROUP BY k HAVING SUM(cash_paise) != 0)`) : Promise.resolve([{ count: 0 }]),
          db.select({ count: sql<number>`COUNT(*)` }).from(expenses).where(and(accountId === null ? isNull(expenses.accountId) : eq(expenses.accountId, accountId), sql`${expenses.expenseDate} >= ${fromDate} AND ${expenses.expenseDate} <= ${toDate}`, isNull(expenses.deletedAt))),
        ]);
        const activityCount = Number(incomeCount[0].count) + Number((receiptCountRows as any)[0]?.count || 0) + Number((cashCountRows as any)[0]?.count || 0) + Number((otaCashCountRows as any)[0]?.count || 0) + Number(expenseCount[0].count);
        const actualClose = reconciliations[0];
        const openingAdjustment = openingAdjustments[0];
        const seed = accountId === null ? 0 : accountRows[0]?.openingBalance || 0;
        const anchor = resolveActivityAnchor(seed, actualClose, openingAdjustment);
        const anchorDate = anchor.date;
        const [throughIncome, throughReceipts, throughCashPayments, throughOtaCash, throughExpenses] = await Promise.all([
          db.select({ total: sql<number>`COALESCE(SUM(${dailyIncome.amount}), 0)` }).from(dailyIncome).where(and(accountId === null ? isNull(dailyIncome.accountId) : eq(dailyIncome.accountId, accountId), anchorDate ? (anchor.includeAnchorDay ? sql`${dailyIncome.date} >= ${anchorDate} AND ${dailyIncome.date} <= ${toDate}` : sql`${dailyIncome.date} > ${anchorDate} AND ${dailyIncome.date} <= ${toDate}`) : sql`${dailyIncome.date} <= ${toDate}`)),
          accountId === null ? Promise.resolve([{ total: 0 }]) : db.select({ total: sql<number>`COALESCE(SUM(${guestReceipts.amount}), 0)` }).from(guestReceipts).where(and(eq(guestReceipts.accountId, accountId), anchorDate ? (anchor.includeAnchorDay ? sql`${guestReceipts.businessDate} >= ${anchorDate} AND ${guestReceipts.businessDate} <= ${toDate}` : sql`${guestReceipts.businessDate} > ${anchorDate} AND ${guestReceipts.businessDate} <= ${toDate}`) : sql`${guestReceipts.businessDate} <= ${toDate}`)),
          accountId === null ? db.select({ total: sql<number>`COALESCE(SUM(${cashPaymentEvents.amountPaise}), 0)` }).from(cashPaymentEvents).where(anchorDate ? (anchor.includeAnchorDay ? sql`${cashPaymentEvents.businessDate} >= ${anchorDate} AND ${cashPaymentEvents.businessDate} <= ${toDate}` : sql`${cashPaymentEvents.businessDate} > ${anchorDate} AND ${cashPaymentEvents.businessDate} <= ${toDate}`) : sql`${cashPaymentEvents.businessDate} <= ${toDate}`) : Promise.resolve([{ total: 0 }]),
          accountId === null ? db.select({ total: sql<number>`COALESCE(SUM(${bookingPaymentEvents.cashPaise}), 0)` }).from(bookingPaymentEvents).where(and(sql`${bookingPaymentEvents.businessDate} IS NOT NULL`, anchorDate ? (anchor.includeAnchorDay ? sql`${bookingPaymentEvents.businessDate} >= ${anchorDate} AND ${bookingPaymentEvents.businessDate} <= ${toDate}` : sql`${bookingPaymentEvents.businessDate} > ${anchorDate} AND ${bookingPaymentEvents.businessDate} <= ${toDate}`) : sql`${bookingPaymentEvents.businessDate} <= ${toDate}`)) : Promise.resolve([{ total: 0 }]),
          db.select({ total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` }).from(expenses).where(and(accountId === null ? isNull(expenses.accountId) : eq(expenses.accountId, accountId), anchorDate ? (anchor.includeAnchorDay ? sql`${expenses.expenseDate} >= ${anchorDate} AND ${expenses.expenseDate} <= ${toDate}` : sql`${expenses.expenseDate} > ${anchorDate} AND ${expenses.expenseDate} <= ${toDate}`) : sql`${expenses.expenseDate} <= ${toDate}`, isNull(expenses.deletedAt))),
        ]);
        let balanceAsOf = anchor.balance
          + throughIncome[0].total + throughReceipts[0].total + throughCashPayments[0].total + throughOtaCash[0].total - throughExpenses[0].total;
        const selectedAccount = accountId === null ? null : accountRows[0];
        const virtualActivity = selectedAccount?.isVirtual ? await (async () => {
          const [profiles, receivables] = await Promise.all([
            db.select().from(platformPaymentProfiles).where(eq(platformPaymentProfiles.virtualAccountId, accountId!)),
            db.select().from(platformReceivableEntries).where(sql`${platformReceivableEntries.recognitionDate} <= ${toDate}`),
          ]);
          const keys = new Set(profiles.map((profile) => profile.platformKey));
          const platformRows = receivables.filter((row) => keys.has(row.platformKey));
          const matchingSettlements = keys.size ? await collectInBatches([...keys], (batch) => db.select().from(platformSettlements).where(and(inArray(platformSettlements.platformKey, batch), sql`${platformSettlements.payoutDate} <= ${toDate}`))) : [];
          const settlementIds = matchingSettlements.map((row) => row.id);
          const allocations = settlementIds.length ? await collectInBatches(settlementIds, (batch) => db.select().from(platformSettlementAllocations).where(inArray(platformSettlementAllocations.settlementId, batch))) : [];
          const settlementDates = new Map(matchingSettlements.map((row) => [row.id, row.payoutDate]));
          const events = platformRows.filter((row) => row.recognitionDate >= fromDate).map((row) => ({ id: `receivable-${row.id}`, date: row.recognitionDate, kind: "receivable", description: `Booking #${row.bookingId} · cycle ${row.bookingCycle}`, amount: row.expectedNetPaise, reference: row.eventKey, addedBy: row.createdBy || "System" }))
            .concat(allocations.map((row) => ({ id: `allocation-${row.id}`, date: settlementDates.get(row.settlementId) || row.createdAt.slice(0, 10), kind: "payout allocation", description: `Booking #${row.bookingId} · cycle ${row.bookingCycle}`, amount: -row.allocatedPaise, reference: String(row.settlementId), addedBy: row.createdBy || "System" })));
          let websiteBalance = 0;
          if (!isPiRuntime() && keys.has("razorpay-website")) {
            const paymentRows = await db.select({
              id: nativeBookingPayments.id, amountPaise: nativeBookingPayments.amountPaise, refundedPaise: nativeBookingPayments.refundedPaise,
              feePaise: nativeBookingPayments.feePaise, taxPaise: nativeBookingPayments.taxPaise, verifiedAt: nativeBookingPayments.verifiedAt,
              bookingId: nativeBookingCheckouts.bookingId, guestName: nativeBookingCheckouts.guestName,
              gokoBookingId: bookings.gokoBookingId, bookingRef: bookings.bookingRef,
            }).from(nativeBookingPayments).innerJoin(nativeBookingCheckouts, eq(nativeBookingPayments.checkoutId, nativeBookingCheckouts.id))
              .leftJoin(bookings, eq(nativeBookingCheckouts.bookingId, bookings.id))
              .where(and(eq(nativeBookingPayments.captured, 1), eq(nativeBookingCheckouts.environment, "live"), sql`${nativeBookingPayments.verifiedAt} <= ${toDate + "T23:59:59"}`));
            const paymentIds = paymentRows.map((payment) => payment.id);
            const webAllocations = paymentIds.length ? await collectInBatches(paymentIds, (batch) => db.select().from(gatewaySettlementAllocations).where(inArray(gatewaySettlementAllocations.paymentId, batch))) : [];
            const webSettlementIds = [...new Set(webAllocations.map((row) => row.settlementId))];
            const webSettlements = webSettlementIds.length ? await collectInBatches(webSettlementIds, (batch) => db.select().from(platformSettlements).where(inArray(platformSettlements.id, batch))) : [];
            const webSettlementDates = new Map(webSettlements.map((row) => [row.id, row.payoutDate]));
            const effectiveWebAllocations = webAllocations.filter((row) => (webSettlementDates.get(row.settlementId) || "") <= toDate);
            for (const payment of paymentRows) {
              const net = gatewayExpectedNetPaise(payment.amountPaise, payment.refundedPaise, payment.feePaise, payment.taxPaise) ?? payment.amountPaise - payment.refundedPaise;
              if (payment.feePaise == null || payment.taxPaise == null) {
                if (payment.verifiedAt.slice(0, 10) >= fromDate) events.push({
                  id: `website-payment-${payment.id}`, date: payment.verifiedAt.slice(0, 10), kind: "website payment · fee pending",
                  description: `${payment.guestName} · ${payment.gokoBookingId || payment.bookingRef || `Booking #${payment.bookingId || "pending"}`}`,
                  amount: 0, reference: payment.id, addedBy: "Razorpay webhook",
                });
                continue;
              }
              const paidOut = effectiveWebAllocations.filter((row) => row.paymentId === payment.id).reduce((sum, row) => sum + row.allocatedPaise, 0);
              websiteBalance += net - paidOut;
              if (payment.verifiedAt.slice(0, 10) >= fromDate) events.push({
                id: `website-payment-${payment.id}`, date: payment.verifiedAt.slice(0, 10), kind: "website payment receivable",
                description: `${payment.guestName} · ${payment.gokoBookingId || payment.bookingRef || `Booking #${payment.bookingId || "pending"}`}`,
                amount: net, reference: payment.id, addedBy: "Razorpay webhook",
              });
            }
            events.push(...effectiveWebAllocations.filter((row) => (webSettlementDates.get(row.settlementId) || "") >= fromDate).map((row) => ({ id: `gateway-payout-${row.id}`, date: webSettlementDates.get(row.settlementId) || row.createdAt.slice(0, 10), kind: "website payout allocation", description: `Razorpay settlement #${row.settlementId}`, amount: -row.allocatedPaise, reference: row.paymentId, addedBy: row.createdBy || "System" })));
          }
          balanceAsOf = platformRows.reduce((sum, row) => sum + row.expectedNetPaise, 0) - allocations.reduce((sum, row) => sum + row.allocatedPaise, 0) + websiteBalance;
          return events;
        })() : [];
        const fullActivity = virtualActivity.length ? [...activity, ...virtualActivity].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice((page - 1) * pageSize, page * pageSize) : activity;
        const totalActivity = virtualActivity.length ? activityCount + virtualActivity.length : activityCount;
        const maskedNumber = selectedAccount?.accountNumber ? `•••• ${selectedAccount.accountNumber.slice(-4)}` : "";
        return NextResponse.json({ accounts: allAccounts.map((row) => ({ ...row, accountNumber: row.accountNumber ? `•••• ${row.accountNumber.slice(-4)}` : "" })), account: accountId === null ? { name: "Cash", openingBalance: 0, isVirtual: 0 } : { ...selectedAccount, accountNumber: maskedNumber }, activity: fullActivity, total: totalActivity, page, pageSize, balanceAsOf, checkpointDate: anchor.date, checkpointType: anchor.type });
      }
      case "getIncomeCategories":
        return NextResponse.json({ categories: parseIncomeCategories(await getSetting("income_categories")) });
      case "addExpense": {
        const { amount, category, customCategory, purpose, billImage, billMimeType, billImages, vendorId, accountId, paymentMethod, mainCategory, subCategory } = rest;
        if (!amount || !category) {
          return NextResponse.json({ error: "amount and category are required" }, { status: 400 });
        }
        if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
          return NextResponse.json({ error: "amount must be a positive integer (in paise)" }, { status: 400 });
        }

        const expenseDate = rest.expenseDate || todayIST();
        if (!isValidReconciliationDate(expenseDate, todayIST())) {
          return NextResponse.json({ error: "expenseDate must be a valid non-future date (YYYY-MM-DD)" }, { status: 400 });
        }
        const month = expenseDate.slice(0, 7);
        const effectiveMethod = paymentMethod || "cash";
        const effectiveAccountId = accountId == null || accountId === "" ? null : Number(accountId);
        if (effectiveMethod !== "cash" && effectiveMethod !== "online") return NextResponse.json({ error: "Payment method must be cash or online" }, { status: 400 });
        if ((effectiveMethod === "cash") !== (effectiveAccountId === null)) return NextResponse.json({ error: "Cash expenses must use Cash; online expenses must use an account" }, { status: 400 });
        if (effectiveAccountId !== null && (!Number.isSafeInteger(effectiveAccountId) || effectiveAccountId < 1)) return NextResponse.json({ error: "Select a valid bank account" }, { status: 400 });
        const db = getDb();
        if (effectiveAccountId !== null) {
          const activeAccount = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, effectiveAccountId), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).limit(1);
          if (!activeAccount.length) return NextResponse.json({ error: "Select an active real bank account" }, { status: 400 });
        }
        const reconciled = await db.select({ date: dailyLedger.date }).from(dailyLedger).where(and(
          sql`${dailyLedger.date} >= ${expenseDate}`, effectiveAccountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, effectiveAccountId), eq(dailyLedger.isReconciled, 1),
        )).orderBy(dailyLedger.date).limit(1);
        if (reconciled.length) return NextResponse.json({ error: `Undo the ${reconciled[0].date} reconciliation before adding an expense to this account` }, { status: 409 });
        let billImageLink = "";

        const uploadOneImage = async (base64Data: string, mimeType: string, folderId: string): Promise<string> => {
          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const ext = mimeType.includes("png") ? "png" : "jpg";
          const fileName = `bill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
          return driveUploadFile(fileName, mimeType, bytes.buffer, folderId);
        };

        if (isOfflineMode()) {
          if (billImage || (billImages && billImages.length > 0)) {
            billImageLink = "offline-pending";
          }
        } else {
          try {
            const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
            if (rootFolderId && (billImage || (billImages && billImages.length > 0))) {
              const billsFolderId = await driveGetOrCreateFolder(rootFolderId, "Goko Bills");
              const monthFolderId = await driveGetOrCreateFolder(billsFolderId, month);

              if (billImages && Array.isArray(billImages) && billImages.length > 0) {
                const links: string[] = [];
                for (const img of billImages as { data: string; mime: string }[]) {
                  const link = await uploadOneImage(img.data, img.mime || "image/jpeg", monthFolderId);
                  if (link) links.push(link);
                }
                billImageLink = links.join(",");
              } else if (billImage) {
                billImageLink = await uploadOneImage(billImage, billMimeType || "image/jpeg", monthFolderId);
              }
            }
          } catch (err: any) {
            await addSystemLog({ level: "error", source: "expenses", message: "Bill upload failed", details: err?.message || String(err) });
          }
        }

        await addExpense({
          amount,
          category,
          customCategory: customCategory || "",
          purpose: purpose || category,
          billImageLink,
          createdBy: actorName,
          expenseDate,
          createdMonth: month,
          vendorId: vendorId || null,
          accountId: effectiveAccountId,
          paymentMethod: effectiveMethod,
          mainCategory: mainCategory || "stay_expense",
          subCategory: subCategory || "",
        });

        await addAuditEntry({
          username: actorName,
          action: "expense_added",
          target: category,
          details: `₹${(amount / 100).toFixed(0)} for ${purpose}`,
        });

        return NextResponse.json({ success: true, role });
      }

      case "listExpenses": {
        const today = todayIST();
        const defaultRange = defaultAccountingDateRange(today);
        const fromDate = typeof rest.fromDate === "string" ? rest.fromDate : defaultRange.fromDate;
        const toDate = typeof rest.toDate === "string" ? rest.toDate : defaultRange.toDate;
        if (!isValidAccountingDateRange(fromDate, toDate, today)) {
          return NextResponse.json({ error: "A valid date range is required" }, { status: 400 });
        }
        const db = getDb();
        const rows = await db.select({
          id: expenses.id, amount: expenses.amount, category: expenses.category, customCategory: expenses.customCategory,
          purpose: expenses.purpose, billImageLink: expenses.billImageLink, vendorId: expenses.vendorId, accountId: expenses.accountId,
          paymentMethod: expenses.paymentMethod, mainCategory: expenses.mainCategory, subCategory: expenses.subCategory,
          taskId: expenses.taskId, createdBy: expenses.createdBy, updatedBy: expenses.updatedBy, createdAt: expenses.createdAt,
          updatedAt: expenses.updatedAt, expenseDate: expenses.expenseDate, createdMonth: expenses.createdMonth,
          accountName: sql<string>`CASE WHEN ${expenses.accountId} IS NULL THEN 'Cash' ELSE COALESCE(NULLIF(${accounts.nickname}, ''), ${accounts.name}, 'Account') END`,
          vendorName: sql<string>`COALESCE(${vendors.name}, '')`,
        }).from(expenses)
          .leftJoin(accounts, eq(expenses.accountId, accounts.id))
          .leftJoin(vendors, eq(expenses.vendorId, vendors.id))
          .where(and(sql`${expenses.expenseDate} >= ${fromDate} AND ${expenses.expenseDate} <= ${toDate}`, isNull(expenses.deletedAt)))
          .orderBy(desc(expenses.expenseDate), desc(expenses.id));
        return NextResponse.json({ role, expenses: rows, fromDate, toDate, expenseCategories: parseExpenseCategories(await getSetting("expense_categories")) });
      }

      case "getMyExpenses": {
        const expenses = await getExpensesByUser(actorName, 7);
        return NextResponse.json({ role, expenses });
      }

      case "updateExpense": {
        const { id, amount, category, customCategory, purpose, billImage: updateBillImage, billMimeType: updateBillMime } = rest;
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const blocked = await rejectIfSplitLinked(Number(id));
        if (blocked) return blocked;

        const existingExpense = await getExpenseById(Number(id));
        if (!existingExpense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

        const nextDate = rest.expenseDate === undefined ? existingExpense.expenseDate : rest.expenseDate;
        const nextAmount = amount === undefined ? existingExpense.amount : amount;
        const nextMethod = rest.paymentMethod === undefined ? (existingExpense.paymentMethod || "cash") : rest.paymentMethod;
        const nextAccountId = rest.accountId === undefined ? existingExpense.accountId : (rest.accountId === null || rest.accountId === "" ? null : Number(rest.accountId));
        if (!isValidReconciliationDate(nextDate, todayIST())) return NextResponse.json({ error: "A valid non-future expense date is required" }, { status: 400 });
        if (!Number.isSafeInteger(nextAmount) || nextAmount <= 0) return NextResponse.json({ error: "Amount must be a positive integer amount in paise" }, { status: 400 });
        if (nextMethod !== "cash" && nextMethod !== "online") return NextResponse.json({ error: "Payment method must be cash or online" }, { status: 400 });
        if ((nextMethod === "cash") !== (nextAccountId === null)) return NextResponse.json({ error: "Cash expenses must use Cash; online expenses must use an account" }, { status: 400 });
        if (nextAccountId !== null && nextAccountId !== existingExpense.accountId) {
          const activeAccount = await getDb().select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, nextAccountId), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).limit(1);
          if (!activeAccount.length) return NextResponse.json({ error: "Select an active real bank account" }, { status: 400 });
        }
        if (rest.vendorId !== undefined && rest.vendorId !== null && rest.vendorId !== "") {
          const vendor = await getDb().select({ id: vendors.id }).from(vendors).where(eq(vendors.id, Number(rest.vendorId))).limit(1);
          if (!vendor.length) return NextResponse.json({ error: "Vendor not found" }, { status: 400 });
        }
        const financialChange = nextDate !== existingExpense.expenseDate || nextAmount !== existingExpense.amount || nextAccountId !== existingExpense.accountId;
        if (financialChange) {
          const affected = new Map<string, { date: string; accountId: number | null }>();
          affected.set(`${existingExpense.expenseDate}:${existingExpense.accountId ?? "cash"}`, { date: existingExpense.expenseDate, accountId: existingExpense.accountId });
          affected.set(`${nextDate}:${nextAccountId ?? "cash"}`, { date: nextDate, accountId: nextAccountId });
          for (const target of affected.values()) {
            const ledger = await getDb().select({ date: dailyLedger.date }).from(dailyLedger).where(and(
              sql`${dailyLedger.date} >= ${target.date}`,
              target.accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, target.accountId),
              eq(dailyLedger.isReconciled, 1),
            )).orderBy(dailyLedger.date).limit(1);
            if (ledger.length) return NextResponse.json({ error: `Undo the ${ledger[0].date} reconciliation for this account before changing this expense` }, { status: 409 });
          }
        }

        const updateData: any = { updatedBy: actorName };
        if (amount !== undefined) updateData.amount = nextAmount;
        if (category !== undefined) updateData.category = category;
        if (customCategory !== undefined) updateData.customCategory = customCategory;
        if (purpose !== undefined) updateData.purpose = purpose;
        if (rest.expenseDate !== undefined) { updateData.expenseDate = nextDate; updateData.createdMonth = nextDate.slice(0, 7); }
        if (rest.mainCategory !== undefined) updateData.mainCategory = String(rest.mainCategory).trim();
        if (rest.subCategory !== undefined) updateData.subCategory = String(rest.subCategory).trim();
        if (rest.vendorId !== undefined) updateData.vendorId = rest.vendorId === null || rest.vendorId === "" ? null : Number(rest.vendorId);
        if (rest.paymentMethod !== undefined) updateData.paymentMethod = nextMethod;
        if (rest.accountId !== undefined) updateData.accountId = nextAccountId;
        if (rest.billImageLink !== undefined) updateData.billImageLink = String(rest.billImageLink || "").slice(0, 4000);

        if (updateBillImage) {
          if (isOfflineMode()) {
            updateData.billImageLink = "offline-pending";
          } else {
            try {
              const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
              if (!rootFolderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID not set");

              const month = getMonthKey();
              const billsFolderId = await driveGetOrCreateFolder(rootFolderId, "Goko Bills");
              const monthFolderId = await driveGetOrCreateFolder(billsFolderId, month);

              const binaryStr = atob(updateBillImage);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }

              const mime = updateBillMime || "image/jpeg";
              const fileName = `bill_${Date.now()}.jpg`;
              updateData.billImageLink = await driveUploadFile(fileName, mime, bytes.buffer, monthFolderId);
            } catch (err: any) {
              await addSystemLog({ level: "error", source: "expenses", message: "Bill upload failed on update", details: err?.message || String(err) });
            }
          }
        }

        await updateExpense(id, updateData);

        await addAuditEntry({
          username: actorName,
          action: "expense_updated",
          target: `expense:${id}`,
          details: `Updated expense #${id}`,
        });

        return NextResponse.json({ success: true, role });
      }

      case "deleteExpense": {
        const { id, billImageLink } = rest;
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const blocked = await rejectIfSplitLinked(Number(id));
        if (blocked) return blocked;

        const expense = await getExpenseById(Number(id));
        if (!expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
        const reconciled = await getDb().select({ id: dailyLedger.id }).from(dailyLedger).where(and(
          sql`${dailyLedger.date} >= ${expense.expenseDate}`, expense.accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, expense.accountId), eq(dailyLedger.isReconciled, 1),
        )).limit(1);
        if (reconciled.length) return NextResponse.json({ error: `Undo the ${expense.expenseDate} reconciliation before deleting this expense` }, { status: 409 });

        if (billImageLink) {
          const fileId = extractDriveFileId(billImageLink);
          if (fileId) {
            try {
              await driveDeleteFile(fileId);
            } catch (err: any) {
              await addSystemLog({ level: "warn", source: "expenses", message: "Bill image delete failed", details: err?.message || String(err) });
            }
          }
        }

        await deleteExpense(id);

        await addAuditEntry({
          username: actorName,
          action: "expense_deleted",
          target: `expense:${id}`,
          details: `Deleted expense #${id}`,
        });

        return NextResponse.json({ success: true, role });
      }

      case "getFoodRevenue": {
        const { fromDate, toDate } = rest;
        if (!fromDate || !toDate) {
          return NextResponse.json({ error: "fromDate and toDate required" }, { status: 400 });
        }

        const db = getDb();
        const orders = await db.select().from(foodOrders)
          .where(and(
            sql`${foodOrders.status} != 'cancelled'`,
            sql`${foodOrders.createdAt} >= ${fromDate}`,
            sql`${foodOrders.createdAt} <= ${toDate + "T23:59:59"}`,
          ))
          .orderBy(desc(foodOrders.createdAt));

        let totalRevenue = 0;
        let cashPayments = 0;
        let onlinePayments = 0;
        let unpaidTabs = 0;
        let orderCount = orders.length;
        let cashOrders = 0;
        let onlineOrders = 0;
        let unpaidOrders = 0;
        let totalDiscount = 0;

        const guestMap = new Map<string, {
          guestName: string; guestPhone: string; roomInfo: string; checkinId: number | null;
          totalSpent: number; totalDiscount: number; cashPaid: number; onlinePaid: number; unpaid: number; orderCount: number;
        }>();

        for (const order of orders) {
          totalRevenue += order.total;
          totalDiscount += order.discount || 0;

          if (order.paymentStatus === "paid") {
            if (order.paymentMethod === "cash") {
              cashPayments += order.total;
              cashOrders += 1;
            } else {
              onlinePayments += order.total;
              onlineOrders += 1;
            }
          } else if (order.paymentStatus === "on_tab" || order.paymentStatus === "pending") {
            unpaidTabs += order.total;
            unpaidOrders += 1;
          }

          // Group hostel guests by checkinId, walk-ins by name+phone
          const key = order.checkinId
            ? `checkin:${order.checkinId}`
            : `walkin:${(order.guestName || "").toLowerCase().trim()}:${(order.guestPhone || "").trim()}`;

          const existing = guestMap.get(key);
          if (existing) {
            existing.totalSpent += order.total;
            existing.totalDiscount += order.discount || 0;
            existing.orderCount += 1;
            if (order.paymentStatus === "paid" && order.paymentMethod === "cash") existing.cashPaid += order.total;
            else if (order.paymentStatus === "paid") existing.onlinePaid += order.total;
            else existing.unpaid += order.total;
            if (!existing.guestPhone && order.guestPhone) existing.guestPhone = order.guestPhone;
            if (!existing.roomInfo && order.roomInfo) existing.roomInfo = order.roomInfo;
          } else {
            guestMap.set(key, {
              guestName: order.guestName,
              guestPhone: order.guestPhone,
              roomInfo: order.roomInfo || "",
              checkinId: order.checkinId,
              totalSpent: order.total,
              totalDiscount: order.discount || 0,
              cashPaid: order.paymentStatus === "paid" && order.paymentMethod === "cash" ? order.total : 0,
              onlinePaid: order.paymentStatus === "paid" && order.paymentMethod !== "cash" ? order.total : 0,
              unpaid: order.paymentStatus !== "paid" ? order.total : 0,
              orderCount: 1,
            });
          }
        }

        // Fetch phone numbers from checkins for hostel guests missing contact
        const checkinIds = Array.from(guestMap.entries())
          .filter(([k, v]) => k.startsWith("checkin:") && !v.guestPhone)
          .map(([k]) => parseInt(k.replace("checkin:", ""), 10))
          .filter((id) => !isNaN(id));

        if (checkinIds.length > 0) {
          const checkinRows = await collectInBatches(checkinIds, (batch) => db.select({ id: checkins.id, contact: checkins.contact })
            .from(checkins)
            .where(inArray(checkins.id, batch)));
          for (const row of checkinRows) {
            const entry = guestMap.get(`checkin:${row.id}`);
            if (entry && !entry.guestPhone && row.contact) {
              entry.guestPhone = row.contact;
            }
          }
        }

        const guestBreakdown = Array.from(guestMap.values())
          .sort((a, b) => b.totalSpent - a.totalSpent);

        return NextResponse.json({
          role,
          summary: { totalRevenue, totalDiscount, cashPayments, onlinePayments, unpaidTabs, orderCount, cashOrders, onlineOrders, unpaidOrders },
          guestBreakdown,
        });
      }

      case "getRoomRevenue": {
        const { fromDate, toDate } = rest;
        if (!fromDate || !toDate) {
          return NextResponse.json({ error: "fromDate and toDate required" }, { status: 400 });
        }

        const db = getDb();
        const [rows, archivedCycles, movementEvents] = await Promise.all([
          db.select().from(bookings).where(and(
            sql`${bookings.checkinDate} >= ${fromDate}`,
            sql`${bookings.checkinDate} <= ${toDate}`,
          )).orderBy(desc(bookings.checkinDate)),
          db.select().from(bookingCycleSnapshots).where(and(
            gte(bookingCycleSnapshots.checkinDate, fromDate), lte(bookingCycleSnapshots.checkinDate, toDate),
          )),
          db.select().from(bookingPaymentEvents).where(and(
            gte(bookingPaymentEvents.businessDate, fromDate),
            lte(bookingPaymentEvents.businessDate, toDate),
            eq(bookingPaymentEvents.otaPaymentTerms, "pay_at_hotel"),
            eq(bookingPaymentEvents.currency, "INR"),
            eq(bookingPaymentEvents.isOpening, 0),
            inArray(bookingPaymentEvents.eventType, ["collection", "refund", "correction"]),
          )).orderBy(desc(bookingPaymentEvents.businessDate), desc(bookingPaymentEvents.id)),
        ]);

        // Load every correction for an in-range source event so sync or a later
        // audit correction cannot leave the original movement overstated.
        const movementBookingIds = [...new Set(movementEvents.map((event) => event.bookingId))];
        const bookingIds = [...new Set([...rows.map((b) => b.id), ...archivedCycles.map((b) => b.bookingId), ...movementBookingIds])];
        const allPaymentEvents = bookingIds.length
          ? await collectInBatches(bookingIds, (batch) => db.select().from(bookingPaymentEvents).where(and(
            inArray(bookingPaymentEvents.bookingId, batch),
            eq(bookingPaymentEvents.otaPaymentTerms, "pay_at_hotel"),
            eq(bookingPaymentEvents.currency, "INR"),
          )))
          : [];
        const cycleEvents = new Map<string, typeof allPaymentEvents>();
        for (const event of allPaymentEvents) {
          const key = `${event.bookingId}:${event.bookingCycle}`;
          cycleEvents.set(key, [...(cycleEvents.get(key) || []), event]);
        }

        const stays = [
          ...rows.filter((b) => occupiedForRoomRevenue(b.status, b.checkedInAt)).map((b) => ({
            id: b.id, bookingCycle: b.bookingCycle, guestName: b.guestName, contact: b.contact || "",
            checkinDate: b.checkinDate, checkoutDate: b.checkoutDate || "", status: b.status,
            amountTotal: b.amountTotal || 0, amountPaid: b.amountPaid || 0, amountRefunded: b.amountRefunded || 0,
            paymentStatus: b.paymentStatus || "", paymentMethod: b.paymentMethod || "", cashReceived: b.cashReceived || 0,
            refundMethod: b.refundMethod || "", refundCash: b.refundCash || 0,
          })),
          ...archivedCycles.filter((b) => occupiedForRoomRevenue(b.status, b.checkedInAt)).map((b) => ({
            id: b.bookingId, bookingCycle: b.bookingCycle, guestName: b.guestName, contact: b.contact || "",
            checkinDate: b.checkinDate, checkoutDate: b.checkoutDate || "", status: b.status,
            amountTotal: paiseToRupees(b.amountTotalPaise), amountPaid: paiseToRupees(b.amountPaidPaise), amountRefunded: paiseToRupees(b.amountRefundedPaise),
            paymentStatus: b.paymentStatus,
            paymentMethod: b.paymentMethod, cashReceived: paiseToRupees(b.cashReceivedPaise),
            refundMethod: b.refundMethod, refundCash: paiseToRupees(b.refundCashPaise),
          })),
        ].sort((a, b) => b.checkinDate.localeCompare(a.checkinDate));

        let billed = 0;
        let gokoCollected = 0;
        let cashIn = 0;
        let onlineIn = 0;
        let unspecifiedCollected = 0;
        let unpaid = 0;
        let prepaid = 0;
        let cashOut = 0;
        let onlineOut = 0;
        let refunded = 0;

        const guestBreakdown = stays.map((b) => {
          const events = cycleEvents.get(`${b.id}:${b.bookingCycle}`) || [];
          const hasJournal = events.length > 0;
          const collections = events.filter((event) => event.eventType === "collection");
          const refundsForStay = events.filter((event) => event.eventType === "refund");
          const corrections = events.filter((event) => event.eventType === "correction");
          const eventById = new Map(events.map((event) => [event.eventId, event]));
          const correctionFor = (type: string) => corrections.filter((event) => eventById.get(event.correctsEventId || "")?.eventType === type);
          const correctedCollections = correctionFor("collection");
          const correctedRefunds = correctionFor("refund");
          const paidPaise = collections.reduce((sum, event) => sum + event.amountPaise, 0)
            + correctedCollections.reduce((sum, event) => sum + event.amountPaise, 0);
          const refundedPaise = refundsForStay.reduce((sum, event) => sum + event.amountPaise, 0)
            + correctedRefunds.reduce((sum, event) => sum + event.amountPaise, 0);
          const paid = hasJournal ? paiseToRupees(Math.max(0, paidPaise)) : b.amountPaid;
          const refundedAmount = hasJournal ? paiseToRupees(Math.max(0, refundedPaise)) : b.amountRefunded;
          const collectionCashPaise = collections.reduce((sum, event) => sum + event.cashPaise, 0)
            + correctedCollections.reduce((sum, event) => sum + event.cashPaise, 0);
          const collectionOnlinePaise = collections.reduce((sum, event) => sum + event.onlinePaise, 0)
            + correctedCollections.reduce((sum, event) => sum + event.onlinePaise, 0);
          const refundCashPaise = refundsForStay.reduce((sum, event) => sum + event.cashPaise, 0)
            + correctedRefunds.reduce((sum, event) => sum + event.cashPaise, 0);
          const refundOnlinePaise = refundsForStay.reduce((sum, event) => sum + event.onlinePaise, 0)
            + correctedRefunds.reduce((sum, event) => sum + event.onlinePaise, 0);
          const method = hasJournal
            ? (collections.some((event) => event.unknownPaise > 0) ? "" : bookingEventMethod({
              cashPaise: Math.max(0, collectionCashPaise),
              onlinePaise: Math.max(0, collectionOnlinePaise),
              unknownPaise: collections.reduce((sum, event) => sum + event.unknownPaise, 0),
            }))
            : b.paymentMethod;
          const cIn = hasJournal ? paiseToRupees(Math.max(0, collectionCashPaise)) : cashCollected(method, paid, b.cashReceived);
          const oIn = hasJournal ? paiseToRupees(Math.max(0, collectionOnlinePaise)) : onlineCollected(method, paid, b.cashReceived);
          const cOut = hasJournal ? paiseToRupees(Math.max(0, -refundCashPaise)) : cashRefunded(b.refundMethod, refundedAmount, b.refundCash);
          const oOut = hasJournal ? paiseToRupees(Math.max(0, -refundOnlinePaise)) : onlineRefunded(b.refundMethod, refundedAmount, b.refundCash);
          billed += b.amountTotal || 0;
          gokoCollected += paid;
          refunded += refundedAmount;
          const due = stayDueAtHotel(b.paymentStatus, b.amountTotal, paid, refundedAmount);
          unpaid += due;
          if (isPrepaidStatus(b.paymentStatus) && paid <= 0) prepaid += b.amountTotal || 0;
          cashIn += cIn;
          onlineIn += oIn;
          if (paid > 0 && !method) unspecifiedCollected += paid;
          cashOut += cOut;
          onlineOut += oOut;

          return {
            id: b.id,
            guestName: b.guestName,
            contact: b.contact,
            checkinDate: b.checkinDate,
            checkoutDate: b.checkoutDate,
            status: b.status,
            paymentMethod: method || "—",
            billed: b.amountTotal || 0,
            cashIn: cIn,
            onlineIn: oIn,
            unpaid: due,
            refundMethod: hasJournal ? (cOut > 0 && oOut > 0 ? "split" : cOut > 0 ? "cash" : oOut > 0 ? "online" : "—") : b.refundMethod || "—",
            cashOut: cOut,
            onlineOut: oOut,
            prepaid: (b.paymentStatus || "").toLowerCase() === "prepaid",
          };
        });

        const [liveMovementBookings, movementSnapshots] = await Promise.all([
          movementBookingIds.length ? collectInBatches(movementBookingIds, (batch) => db.select({ id: bookings.id, bookingCycle: bookings.bookingCycle, status: bookings.status })
            .from(bookings).where(inArray(bookings.id, batch))) : Promise.resolve([]),
          movementBookingIds.length ? collectInBatches(movementBookingIds, (batch) => db.select({ bookingId: bookingCycleSnapshots.bookingId, bookingCycle: bookingCycleSnapshots.bookingCycle, status: bookingCycleSnapshots.status })
            .from(bookingCycleSnapshots).where(inArray(bookingCycleSnapshots.bookingId, batch))) : Promise.resolve([]),
        ]);
        const movementStatuses = new Map<string, string>();
        for (const booking of liveMovementBookings) movementStatuses.set(`${booking.id}:${booking.bookingCycle}`, booking.status);
        for (const snapshot of movementSnapshots) movementStatuses.set(`${snapshot.bookingId}:${snapshot.bookingCycle}`, snapshot.status);
        const movementSums = { gross: 0, refunds: 0, cashIn: 0, onlineIn: 0, cashOut: 0, onlineOut: 0, unresolved: 0, overRefunded: 0 };
        const correctionsByEvent = new Map<string, typeof movementEvents>();
        for (const correction of allPaymentEvents.filter((event) => event.eventType === "correction")) {
          if (!correction.correctsEventId) continue;
          correctionsByEvent.set(correction.correctsEventId, [...(correctionsByEvent.get(correction.correctsEventId) || []), correction]);
        }
        const movementRows = movementEvents.filter((event) => event.eventType === "collection" || event.eventType === "refund").map((event) => {
          const corrections = correctionsByEvent.get(event.eventId) || [];
          const amountPaise = Math.max(0, event.amountPaise - corrections.reduce((sum, correction) => sum + Math.abs(correction.amountPaise), 0));
          const cashPaise = event.cashPaise + corrections.reduce((sum, correction) => sum + correction.cashPaise, 0);
          const onlinePaise = event.onlinePaise + corrections.reduce((sum, correction) => sum + correction.onlinePaise, 0);
          const status = movementStatuses.get(`${event.bookingId}:${event.bookingCycle}`) || "unknown";
          const amount = amountPaise;
          if (amount === 0) return null;
          if (event.eventType === "collection") {
            movementSums.gross += amount;
            movementSums.cashIn += Math.max(0, cashPaise);
            movementSums.onlineIn += Math.max(0, onlinePaise);
          } else {
            movementSums.refunds += amount;
            movementSums.cashOut += Math.abs(Math.min(0, cashPaise));
            movementSums.onlineOut += Math.abs(Math.min(0, onlinePaise));
          }
          return {
            eventId: event.eventId,
            businessDate: event.businessDate,
            guestName: event.guestNameSnapshot,
            bookingRef: event.bookingRefSnapshot,
            checkinDate: event.checkinDateSnapshot,
            checkoutDate: event.checkoutDateSnapshot,
            bookingCycle: event.bookingCycle,
            status,
            eventType: event.eventType,
            isAdvance: event.eventType === "collection" && Boolean(event.checkinDateSnapshot && event.businessDate && event.businessDate < event.checkinDateSnapshot),
            cash: paiseToRupees(Math.abs(cashPaise)),
            online: paiseToRupees(Math.abs(onlinePaise)),
            amount: paiseToRupees(amount),
            note: event.note,
          };
        }).filter(Boolean);
        const selectedMovementCycles = new Set(movementEvents
          .filter((event) => event.eventType === "collection" || event.eventType === "refund")
          .map((event) => `${event.bookingId}:${event.bookingCycle}`));
        for (const key of selectedMovementCycles) {
          const status = movementStatuses.get(key) || "unknown";
          if (status !== "cancelled" && status !== "no_show") continue;
          const events = (cycleEvents.get(key) || []).filter((event) => event.isOpening === 0);
          const correctedAmount = (type: "collection" | "refund") => events
            .filter((event) => event.eventType === type)
            .reduce((sum, event) => sum + event.amountPaise + events
              .filter((correction) => correction.eventType === "correction" && correction.correctsEventId === event.eventId)
              .reduce((correctionSum, correction) => correctionSum + correction.amountPaise, 0), 0);
          const collected = correctedAmount("collection");
          const refunded = correctedAmount("refund");
          movementSums.unresolved += Math.max(0, collected - refunded);
          movementSums.overRefunded += Math.max(0, refunded - collected);
        }

        return NextResponse.json({
          role,
          summary: {
            billed,
            stayCount: stays.length,
            cashCollected: cashIn,
            onlineCollected: onlineIn,
            unspecifiedCollected,
            unpaid,
            prepaid,
            cashRefunded: cashOut,
            onlineRefunded: onlineOut,
            refunded,
            netCash: cashIn - cashOut,
            netOnline: onlineIn - onlineOut,
            netGoko: gokoCollected - refunded,
          },
          guestBreakdown,
          paymentMovementSummary: {
            grossCollected: paiseToRupees(movementSums.gross),
            refunded: paiseToRupees(movementSums.refunds),
            net: paiseToRupees(movementSums.gross - movementSums.refunds),
            cashCollected: paiseToRupees(movementSums.cashIn),
            onlineCollected: paiseToRupees(movementSums.onlineIn),
            cashRefunded: paiseToRupees(movementSums.cashOut),
            onlineRefunded: paiseToRupees(movementSums.onlineOut),
            unresolvedTerminal: paiseToRupees(movementSums.unresolved),
            overRefundedTerminal: paiseToRupees(movementSums.overRefunded),
          },
          paymentMovementRows: movementRows,
        });
      }

      // --- Daily Ledger ---
      case "getDailyLedger": {
        const { date } = rest;
        if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

        const db = getDb();
        const allAccounts = await db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, isDefault: accounts.isDefault }).from(accounts).where(and(eq(accounts.isActive, 1), eq(accounts.isVirtual, 0)));

        const incomeEntries = await db.select().from(dailyIncome).where(eq(dailyIncome.date, date)).orderBy(desc(dailyIncome.createdAt));

        const dayExpenses = await db.select().from(expenses).where(eq(expenses.expenseDate, date)).orderBy(desc(expenses.id));

        // Attach vendor names
        const vendorIds = dayExpenses.filter((e) => e.vendorId).map((e) => e.vendorId!);
        let vendorMap: Record<number, string> = {};
        if (vendorIds.length > 0) {
          const vendorRows = await collectInBatches(vendorIds, (batch) => db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, batch)));
          for (const v of vendorRows) vendorMap[v.id] = v.name;
        }

        const expenseEntries = dayExpenses.map((e) => ({
          ...e,
          vendorName: e.vendorId ? vendorMap[e.vendorId] || "" : "",
        }));

        // Food revenue for the day (paid food orders)
        const foodOrdersDay = await db.select({ total: foodOrders.total }).from(foodOrders).where(
          and(
            sql`${foodOrders.status} != 'cancelled'`,
            sql`${foodOrders.paymentStatus} = 'paid'`,
            sql`${foodOrders.createdAt} >= ${date}`,
            sql`${foodOrders.createdAt} <= ${date + "T23:59:59"}`,
          )
        );
        const foodRevenue = foodOrdersDay.reduce((s, o) => s + o.total, 0);

        // Account-wise summaries
        const accountSummaries = [
          { accountId: null, accountName: "Cash", income: 0, expense: 0 },
          ...allAccounts.map((a) => ({ accountId: a.id as number, accountName: a.nickname || a.name, income: 0, expense: 0 })),
        ];
        for (const inc of incomeEntries) {
          const summary = accountSummaries.find((s) => s.accountId === inc.accountId) || accountSummaries[0];
          summary.income += inc.amount;
        }
        for (const exp of dayExpenses) {
          const summary = accountSummaries.find((s) => s.accountId === exp.accountId) || accountSummaries[0];
          summary.expense += exp.amount;
        }

        return NextResponse.json({
          incomeEntries,
          expenseEntries,
          accounts: allAccounts,
          incomeCategories: parseIncomeCategories(await getSetting("income_categories")),
          foodRevenue,
          accountSummaries: accountSummaries.filter((s) => s.income > 0 || s.expense > 0),
        });
      }

      case "addDailyIncome": {
        const incomeCategories = parseIncomeCategories(await getSetting("income_categories"));
        const validation = validateManualIncome(rest, incomeCategories.map((item) => item.id));
        if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: 400 });
        const income = validation.value;
        const db = getDb();
        if (income.type === "online") {
          const activeAccount = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, income.accountId!), eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).limit(1);
          if (!activeAccount.length) return NextResponse.json({ error: "The selected online account is not active" }, { status: 400 });
        }
        const reconciled = await db.select({ date: dailyLedger.date }).from(dailyLedger).where(and(
          sql`${dailyLedger.date} >= ${income.date}`,
          income.accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, income.accountId),
          eq(dailyLedger.isReconciled, 1),
        )).orderBy(dailyLedger.date).limit(1);
        if (reconciled.length) return NextResponse.json({ error: `Undo the ${reconciled[0].date} reconciliation before adding income to this account` }, { status: 409 });
        await db.insert(dailyIncome).values({
          ...income,
          createdBy: username || displayName,
          createdAt: new Date().toISOString(),
        });
        return NextResponse.json({ success: true });
      }

      case "getIncomeAccounts": {
        const db = getDb();
        const activeAccounts = await db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, isDefault: accounts.isDefault })
          .from(accounts).where(and(eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).orderBy(desc(accounts.isDefault), accounts.name);
        return NextResponse.json({ accounts: activeAccounts });
      }

      case "listIncomeRecords": {
        const today = todayIST();
        const defaultRange = defaultAccountingDateRange(today);
        const fromDate = typeof rest.fromDate === "string" ? rest.fromDate : defaultRange.fromDate;
        const toDate = typeof rest.toDate === "string" ? rest.toDate : defaultRange.toDate;
        if (!isValidAccountingDateRange(fromDate, toDate, today)) {
          return NextResponse.json({ error: "A valid date range is required" }, { status: 400 });
        }
        const db = getDb();
        const [rows, allAccounts] = await Promise.all([
          db.select({
            id: dailyIncome.id, date: dailyIncome.date, accountId: dailyIncome.accountId, type: dailyIncome.type,
            amount: dailyIncome.amount, source: dailyIncome.source, sourceDetail: dailyIncome.sourceDetail,
            description: dailyIncome.description, createdBy: dailyIncome.createdBy, createdAt: dailyIncome.createdAt,
            accountName: sql<string>`COALESCE(NULLIF(${accounts.nickname}, ''), ${accounts.name})`,
          }).from(dailyIncome).leftJoin(accounts, eq(dailyIncome.accountId, accounts.id))
            .where(sql`${dailyIncome.date} >= ${fromDate} AND ${dailyIncome.date} <= ${toDate}`)
            .orderBy(desc(dailyIncome.date), desc(dailyIncome.createdAt)),
          db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname }).from(accounts).orderBy(accounts.name),
        ]);
        return NextResponse.json({
          incomeEntries: rows.map((row) => ({ ...row, accountName: row.accountId == null ? "Cash" : row.accountName || "Account" })),
          fromDate,
          toDate,
          accounts: allAccounts,
          incomeCategories: parseIncomeCategories(await getSetting("income_categories")),
        });
      }

      case "deleteDailyIncome": {
        const { id } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        const db = getDb();
        const entry = await db.select({ date: dailyIncome.date, accountId: dailyIncome.accountId }).from(dailyIncome).where(eq(dailyIncome.id, id)).limit(1);
        if (!entry.length) return NextResponse.json({ error: "Income entry not found" }, { status: 404 });
        const reconciled = await db.select({ date: dailyLedger.date }).from(dailyLedger).where(and(
          sql`${dailyLedger.date} >= ${entry[0].date}`,
          entry[0].accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, entry[0].accountId),
          eq(dailyLedger.isReconciled, 1),
        )).orderBy(dailyLedger.date).limit(1);
        if (reconciled.length) return NextResponse.json({ error: `Undo the ${reconciled[0].date} reconciliation before deleting income` }, { status: 409 });
        await db.delete(dailyIncome).where(eq(dailyIncome.id, id));
        return NextResponse.json({ success: true });
      }

      // --- Reconciliation ---
      case "getReconciliation": {
        const { date } = rest;
        if (!isValidReconciliationDate(date, todayIST())) {
          return NextResponse.json({ error: "A valid non-future date is required" }, { status: 400 });
        }

        const db = getDb();
        const allAccounts = await db.select().from(accounts).where(and(eq(accounts.isActive, 1), eq(accounts.isVirtual, 0)));
        const ledgerEntries = await db.select().from(dailyLedger).where(eq(dailyLedger.date, date));

        // Get income/expense totals for the day
        const priorLedgerEntries = await db.select().from(dailyLedger)
          .where(lt(dailyLedger.date, date)).orderBy(desc(dailyLedger.date));
        const openingAdjustments = await db.select().from(dailyLedger)
          .where(and(lt(dailyLedger.date, date), eq(dailyLedger.openingAdjusted, 1))).orderBy(desc(dailyLedger.date));
        const accountBases: Array<{ accountId: number | null }> = [{ accountId: null }, ...allAccounts.map((account) => ({ accountId: account.id }))];
        let minStart = date;
        const unanchored = accountBases.some((acc) => !priorLedgerEntries.some((entry) => entry.accountId === acc.accountId && entry.isReconciled === 1 && entry.actualClosing !== null)
          && !openingAdjustments.some((entry) => entry.accountId === acc.accountId));
        if (unanchored) minStart = "0001-01-01";
        for (const acc of accountBases) {
          const prior = priorLedgerEntries.find((entry) => entry.accountId === acc.accountId && entry.isReconciled === 1 && entry.actualClosing !== null);
          const adjustment = openingAdjustments.find((entry) => entry.accountId === acc.accountId);
          const anchorDate = prior?.date && adjustment?.date ? (prior.date >= adjustment.date ? prior.date : adjustment.date) : prior?.date || adjustment?.date;
          if (anchorDate && anchorDate < minStart) minStart = anchorDate;
        }
        const [incomeEntries, automaticReceipts, dayExpenses] = await Promise.all([
          db.select().from(dailyIncome).where(sql`${dailyIncome.date} >= ${minStart} AND ${dailyIncome.date} <= ${date}`),
          db.select().from(guestReceipts).where(sql`${guestReceipts.businessDate} >= ${minStart} AND ${guestReceipts.businessDate} <= ${date}`),
          db.select().from(expenses).where(and(sql`${expenses.expenseDate} >= ${minStart} AND ${expenses.expenseDate} <= ${date}`, isNull(expenses.deletedAt))),
        ]);
        const bookingCashEvents = await db.select().from(bookingPaymentEvents).where(and(
          gte(bookingPaymentEvents.businessDate, minStart),
          lte(bookingPaymentEvents.businessDate, date),
          sql`${bookingPaymentEvents.cashPaise} != 0`,
        ));
        const ordinaryCashEvents = await db.select().from(cashPaymentEvents).where(and(
          gte(cashPaymentEvents.businessDate, minStart),
          lte(cashPaymentEvents.businessDate, date),
        ));

        // Build balance for each account + cash
        const balances = [
          { accountId: null, accountName: "Cash" },
          ...allAccounts.map((a) => ({ accountId: a.id as number, accountName: (a.nickname || a.name) as string })),
        ].map((acc) => {
          const ledgerEntry = ledgerEntries.find((l) => l.accountId === acc.accountId);
          const priorActualClose = priorLedgerEntries.find((l) => l.accountId === acc.accountId && l.isReconciled === 1 && l.actualClosing !== null);
          const priorAdjustment = openingAdjustments.find((l) => l.accountId === acc.accountId);
          const account = allAccounts.find((a) => a.id === acc.accountId);
          const currentAdjustment = ledgerEntry?.openingAdjusted === 1 ? ledgerEntry : undefined;
          const priorAnchorIsClose = !!priorActualClose && (!priorAdjustment || priorActualClose.date >= priorAdjustment.date);
          const openingBalance = currentAdjustment?.openingBalance ?? (priorAnchorIsClose ? priorActualClose?.actualClosing : priorAdjustment?.openingBalance) ?? account?.openingBalance ?? 0;
          const baseDate = currentAdjustment ? date : priorAnchorIsClose ? priorActualClose?.date : priorAdjustment?.date;
          const afterBase = <T extends { date?: string; businessDate?: string }>(row: T) => {
            const rowDate = row.date || row.businessDate || "";
            return baseDate ? (currentAdjustment ? rowDate >= baseDate : rowDate > baseDate) : true;
          };
          const manualIncome = incomeEntries.filter((i) => i.accountId === acc.accountId && afterBase({ date: i.date })).reduce((s, i) => s + i.amount, 0);
          const receiptIncome = automaticReceipts.filter((r) => r.accountId === acc.accountId && afterBase({ businessDate: r.businessDate })).reduce((s, r) => s + r.amount, 0);
          const bookingPaymentCash = acc.accountId === null
            ? bookingCashEvents.filter((event) => afterBase({ businessDate: event.businessDate || "" })).reduce((sum, event) => sum + event.cashPaise, 0)
            : 0;
          const guestPaymentCash = acc.accountId === null
            ? ordinaryCashEvents.filter((event) => afterBase({ businessDate: event.businessDate })).reduce((sum, event) => sum + event.amountPaise, 0)
            : 0;
          const totalIncome = manualIncome + receiptIncome + bookingPaymentCash + guestPaymentCash;
          const totalExpense = dayExpenses.filter((e) => e.accountId === acc.accountId && afterBase({ date: e.expenseDate })).reduce((s, e) => s + e.amount, 0);
          const dayIncome = incomeEntries.filter((i) => i.accountId === acc.accountId && i.date === date).reduce((s, i) => s + i.amount, 0);
          const dayReceiptIncome = automaticReceipts.filter((r) => r.accountId === acc.accountId && r.businessDate === date).reduce((s, r) => s + r.amount, 0);
          const dayBookingPaymentCash = acc.accountId === null
            ? bookingCashEvents.filter((event) => event.businessDate === date).reduce((sum, event) => sum + event.cashPaise, 0)
            : 0;
          const dayGuestPaymentCash = acc.accountId === null
            ? ordinaryCashEvents.filter((event) => event.businessDate === date).reduce((sum, event) => sum + event.amountPaise, 0)
            : 0;
          const dayExpenseTotal = dayExpenses.filter((e) => e.accountId === acc.accountId && e.expenseDate === date).reduce((s, e) => s + e.amount, 0);

          const expectedClosing = openingBalance + totalIncome - totalExpense;

          return {
            accountId: acc.accountId,
            accountName: acc.accountName,
            openingBalance,
            totalIncome,
            manualIncome,
            automaticGuestReceipts: receiptIncome,
            bookingPaymentCash,
            guestPaymentCash,
            totalExpense,
            dayIncome: dayIncome + dayReceiptIncome + dayBookingPaymentCash + dayGuestPaymentCash,
            dayExpense: dayExpenseTotal,
            asOfDate: date,
            expectedClosing,
            actualClosing: ledgerEntry?.actualClosing ?? null,
            isReconciled: !!ledgerEntry?.isReconciled,
            notes: ledgerEntry?.notes || "",
            reconciledBy: ledgerEntry?.reconciledBy || "",
            reconciledAt: ledgerEntry?.reconciledAt || "",
          };
        });

        const { isReconciled } = await getReconciliationStatus(date);
        const notes = ledgerEntries[0]?.notes || "";
        const reconciledBy = ledgerEntries[0]?.reconciledBy || "";
        const reconciledAt = ledgerEntries[0]?.reconciledAt || "";

        return NextResponse.json({
          balances,
          automaticReceipts: automaticReceipts.filter((receipt) => receipt.businessDate === date),
          bookingPaymentEvents: bookingCashEvents.filter((event) => event.businessDate === date),
          cashPaymentEvents: ordinaryCashEvents.filter((event) => event.businessDate === date),
          isReconciled, notes, reconciledBy, reconciledAt,
        });
      }

      case "saveReconciliation": {
        const { date, target: rawTarget, actualClosing, notes } = rest;
        const target = parseReconciliationTarget(rawTarget);
        if (!isValidReconciliationDate(date, todayIST())) {
          return NextResponse.json({ error: "A valid non-future date is required" }, { status: 400 });
        }
        if (!target) return NextResponse.json({ error: "A valid reconciliation target is required" }, { status: 400 });
        if (!Number.isSafeInteger(actualClosing)) {
          return NextResponse.json({ error: "Actual closing must be an integer amount in paise" }, { status: 400 });
        }
        const targetGate = actionAllowed(role, permissions, reconciliationPermission(target));
        if (targetGate !== "allowed") {
          return NextResponse.json({ error: "You don't have permission to reconcile this account" }, { status: 403 });
        }

        const db = getDb();
        const allAccounts = await db.select().from(accounts).where(and(eq(accounts.isActive, 1), eq(accounts.isVirtual, 0)));
        const account = target.accountId === null ? null : allAccounts.find((item) => item.id === target.accountId);
        if (target.type === "online" && !account) {
          return NextResponse.json({ error: "The selected online account is not active" }, { status: 400 });
        }

        const priorLedgerEntries = await db.select().from(dailyLedger)
          .where(lt(dailyLedger.date, date)).orderBy(desc(dailyLedger.date));
        const existingLedger = await db.select().from(dailyLedger).where(eq(dailyLedger.date, date));
        const openingAdjustments = await db.select().from(dailyLedger).where(and(lt(dailyLedger.date, date), eq(dailyLedger.openingAdjusted, 1))).orderBy(desc(dailyLedger.date));
        const existing = existingLedger.find((item) => item.accountId === target.accountId);
        if (existing?.isReconciled) {
          return NextResponse.json({ error: "This account has already been reconciled. Undo it before trying again." }, { status: 409 });
        }
        const previous = priorLedgerEntries.find((item) => item.accountId === target.accountId);
        const previousActual = priorLedgerEntries.find((item) => item.accountId === target.accountId && item.isReconciled === 1 && item.actualClosing !== null);
        const previousAdjustment = openingAdjustments.find((item) => item.accountId === target.accountId);
        const currentAdjustment = existing?.openingAdjusted === 1 ? existing : undefined;
        const previousAnchorIsClose = !!previousActual && (!previousAdjustment || previousActual.date >= previousAdjustment.date);
        const openingBalance = currentAdjustment?.openingBalance ?? (previousAnchorIsClose ? previousActual?.actualClosing : previousAdjustment?.openingBalance) ?? account?.openingBalance ?? 0;
        const anchorDate = currentAdjustment ? date : previousAnchorIsClose ? previousActual?.date : previousAdjustment?.date;
        const lowerBound = anchorDate || "0000-01-01";
        const include = (d: string) => anchorDate ? (currentAdjustment ? d >= lowerBound : d > lowerBound) : true;
        const [incomeEntries, automaticReceipts, saveBookingCashEvents, saveOrdinaryCashEvents, dayExpenses] = await Promise.all([
          db.select().from(dailyIncome).where(sql`${dailyIncome.date} >= ${lowerBound} AND ${dailyIncome.date} <= ${date}`),
          db.select().from(guestReceipts).where(sql`${guestReceipts.businessDate} >= ${lowerBound} AND ${guestReceipts.businessDate} <= ${date}`),
          target.accountId === null ? db.select().from(bookingPaymentEvents).where(and(gte(bookingPaymentEvents.businessDate, lowerBound), lte(bookingPaymentEvents.businessDate, date))) : Promise.resolve([]),
          target.accountId === null ? db.select().from(cashPaymentEvents).where(and(gte(cashPaymentEvents.businessDate, lowerBound), lte(cashPaymentEvents.businessDate, date))) : Promise.resolve([]),
          db.select().from(expenses).where(and(sql`${expenses.expenseDate} >= ${lowerBound} AND ${expenses.expenseDate} <= ${date}`, isNull(expenses.deletedAt))),
        ]);
        const totalIncome = incomeEntries.filter((item) => item.accountId === target.accountId && include(item.date)).reduce((sum, item) => sum + item.amount, 0)
          + automaticReceipts.filter((item) => item.accountId === target.accountId && include(item.businessDate)).reduce((sum, item) => sum + item.amount, 0)
          + saveBookingCashEvents.filter((item) => item.businessDate && include(item.businessDate)).reduce((sum, item) => sum + item.cashPaise, 0)
          + saveOrdinaryCashEvents.filter((item) => include(item.businessDate)).reduce((sum, item) => sum + item.amountPaise, 0);
        const totalExpense = dayExpenses.filter((item) => item.accountId === target.accountId && include(item.expenseDate)).reduce((sum, item) => sum + item.amount, 0);
        const expectedClosing = openingBalance + totalIncome - totalExpense;
        const reconciledAt = new Date().toISOString();
        const cleanNotes = typeof notes === "string" ? notes.trim().slice(0, 1000) : "";
        const values = {
          openingBalance,
          totalIncome,
          totalExpense,
          expectedClosing,
          actualClosing,
          isReconciled: 1,
          reconciledBy: actorName,
          reconciledAt,
          notes: cleanNotes,
        };
        if (existing) {
          const updated = await db.update(dailyLedger).set(values).where(and(
            eq(dailyLedger.id, existing.id),
            eq(dailyLedger.isReconciled, 0),
          )).returning({ id: dailyLedger.id });
          if (updated.length === 0) {
            return NextResponse.json({ error: "This account was reconciled by another user. Refresh to see the latest values." }, { status: 409 });
          }
        } else {
          const targetCondition = target.accountId === null
            ? sql`${dailyLedger.accountId} IS NULL`
            : sql`${dailyLedger.accountId} = ${target.accountId}`;
          const inserted = await db.run(sql`
            INSERT INTO daily_ledger (
              date, account_id, opening_balance, total_income, total_expense,
              expected_closing, actual_closing, is_reconciled, reconciled_by, reconciled_at, notes
            )
            SELECT ${date}, ${target.accountId}, ${openingBalance}, ${totalIncome}, ${totalExpense},
              ${expectedClosing}, ${actualClosing}, 1, ${actorName}, ${reconciledAt}, ${cleanNotes}
            WHERE NOT EXISTS (
              SELECT 1 FROM ${dailyLedger} WHERE ${dailyLedger.date} = ${date} AND ${targetCondition}
            )
          `);
          if (sqliteWriteCount(inserted) === 0) {
            return NextResponse.json({ error: "This account was reconciled by another user. Refresh to see the latest values." }, { status: 409 });
          }
        }

        const accountName = target.type === "cash" ? "Cash" : account!.nickname || account!.name;
        await addAuditEntry({
          username: actorName,
          action: "account_reconciliation_completed",
          target: accountName,
          details: `${accountName} reconciled for ${date} · Expected ₹${(expectedClosing / 100).toFixed(2)} · Actual ₹${(actualClosing / 100).toFixed(2)} · Difference ₹${((actualClosing - expectedClosing) / 100).toFixed(2)}${cleanNotes ? ` · Notes: ${cleanNotes}` : ""}`,
        });

        return NextResponse.json({ success: true, target, reconciledAt });
      }

      case "undoReconciliation": {
        const { date, target: rawTarget } = rest;
        const target = parseReconciliationTarget(rawTarget);
        if (!isValidReconciliationDate(date, todayIST())) {
          return NextResponse.json({ error: "A valid non-future date is required" }, { status: 400 });
        }
        if (!target) return NextResponse.json({ error: "A valid reconciliation target is required" }, { status: 400 });

        const db = getDb();
        const existing = await db.select().from(dailyLedger).where(
          and(eq(dailyLedger.date, date), target.accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, target.accountId))
        ).limit(1);
        if (!existing[0]?.isReconciled) {
          return NextResponse.json({ error: "This account is not reconciled" }, { status: 409 });
        }
        const undone = await db.update(dailyLedger).set({
          isReconciled: 0,
          reconciledBy: null,
          reconciledAt: null,
          actualClosing: null,
          notes: "",
        }).where(and(eq(dailyLedger.id, existing[0].id), eq(dailyLedger.isReconciled, 1)))
          .returning({ id: dailyLedger.id });
        if (undone.length === 0) {
          return NextResponse.json({ error: "This reconciliation was already undone by another administrator." }, { status: 409 });
        }

        let accountName = "Cash";
        if (target.accountId !== null) {
          const account = await db.select({ name: accounts.name, nickname: accounts.nickname }).from(accounts)
            .where(eq(accounts.id, target.accountId)).limit(1);
          accountName = account[0]?.nickname || account[0]?.name || `Account #${target.accountId}`;
        }
        await addAuditEntry({
          username: actorName,
          action: "account_reconciliation_undone",
          target: accountName,
          details: `${accountName} reconciliation undone for ${date}`,
        });

        return NextResponse.json({ success: true, target });
      }

      case "adjustOpeningBalance": {
        const { date, accountId, openingBalance } = rest;
        if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

        const db = getDb();
        const existing = await db.select().from(dailyLedger).where(
          and(eq(dailyLedger.date, date), accountId != null ? eq(dailyLedger.accountId, accountId) : sql`${dailyLedger.accountId} IS NULL`)
        ).limit(1);

        if (existing.length > 0) {
          await db.update(dailyLedger).set({ openingBalance, openingAdjusted: 1 }).where(eq(dailyLedger.id, existing[0].id));
        } else {
          await db.insert(dailyLedger).values({
            date,
            accountId: accountId ?? null,
            openingBalance,
            openingAdjusted: 1,
            totalIncome: 0,
            totalExpense: 0,
            expectedClosing: openingBalance,
          });
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Admin expenses API error:", error?.message || error);
    const raw = error?.message || "Internal server error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : raw;
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
