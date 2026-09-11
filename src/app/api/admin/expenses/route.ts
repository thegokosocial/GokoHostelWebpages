import { NextRequest, NextResponse } from "next/server";
import {
  addExpense,
  getExpensesByMonth,
  getExpensesByUser,
  updateExpense,
  deleteExpense,
  getExpenseMonths,
  getMonthKey,
  addAuditEntry,
  addSystemLog,
  getSetting,
} from "@/db/queries";
import { getDb } from "@/db";
import { foodOrders, checkins, expenses, accounts, dailyIncome, dailyLedger, vendors, bookings, guestReceipts } from "@/db/schema";
import { eq, and, sql, desc, inArray, isNull, lt } from "drizzle-orm";
import { driveUploadFile, driveGetOrCreateFolder, driveDeleteFile } from "@/lib/googleApiFetch";
import { isOfflineMode } from "@/lib/runtime";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { hostelExpenseIsLinked } from "@/db/splitQueries";
import { stayDueAtHotel, cashCollected, onlineCollected, cashRefunded, onlineRefunded, occupiedForRoomRevenue, isPrepaidStatus } from "@/lib/stayPayment";
import { validateManualIncome } from "@/lib/income";
import { getReconciliationStatus, resolveOpeningBalance } from "@/lib/reconciliation";
import { parseExpenseCategories, parseIncomeCategories } from "@/lib/accountCategories";

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

    const ACTION_PERMISSIONS: Record<string, string | "admin_only"> = {
      listExpenses: "canViewExpenses", getMyExpenses: "canViewExpenses",
      addExpense: "canAddExpense", updateExpense: "canEditExpense", deleteExpense: "canDeleteExpense",
      getFoodRevenue: "canViewFoodBills",
      getRoomRevenue: "canViewFoodBills",
      getDailyLedger: "canViewAccounts", listIncomeRecords: "canViewAccounts", getReconciliation: "canViewAccounts",
      getIncomeAccounts: "canAddIncome", addDailyIncome: "canAddIncome", deleteDailyIncome: "canDeleteExpense",
      getExpenseCategories: "canAddExpense", getIncomeCategories: "canAddIncome",
      saveReconciliation: "canReconcileAccounts", undoReconciliation: "canReconcileAccounts",
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
      case "getIncomeCategories":
        return NextResponse.json({ categories: parseIncomeCategories(await getSetting("income_categories")) });
      case "addExpense": {
        const { amount, category, customCategory, purpose, billImage, billMimeType, billImages, vendorId, accountId, paymentMethod, mainCategory, subCategory } = rest;
        if (!amount || !category) {
          return NextResponse.json({ error: "amount and category are required" }, { status: 400 });
        }
        if (typeof amount !== "number" || amount <= 0) {
          return NextResponse.json({ error: "amount must be a positive integer (in paise)" }, { status: 400 });
        }

        const month = getMonthKey();
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
          createdMonth: month,
          vendorId: vendorId || null,
          accountId: accountId || null,
          paymentMethod: paymentMethod || "cash",
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
        const { month } = rest;
        const targetMonth = month || getMonthKey();
        const expenses = await getExpensesByMonth(targetMonth);
        const months = await getExpenseMonths();
        return NextResponse.json({ role, expenses, months, currentMonth: targetMonth, expenseCategories: parseExpenseCategories(await getSetting("expense_categories")) });
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

        const updateData: any = { updatedBy: actorName };
        if (amount !== undefined) updateData.amount = amount;
        if (category !== undefined) updateData.category = category;
        if (customCategory !== undefined) updateData.customCategory = customCategory;
        if (purpose !== undefined) updateData.purpose = purpose;

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
          const checkinRows = await db.select({ id: checkins.id, contact: checkins.contact })
            .from(checkins)
            .where(inArray(checkins.id, checkinIds));
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
        const rows = await db.select().from(bookings)
          .where(and(
            sql`${bookings.checkinDate} >= ${fromDate}`,
            sql`${bookings.checkinDate} <= ${toDate}`,
          ))
          .orderBy(desc(bookings.checkinDate));

        const stays = rows.filter((b) => occupiedForRoomRevenue(b.status, b.checkedInAt));

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
          billed += b.amountTotal || 0;
          gokoCollected += b.amountPaid || 0;
          refunded += b.amountRefunded || 0;
          const due = stayDueAtHotel(b.paymentStatus, b.amountTotal, b.amountPaid);
          unpaid += due;
          if (isPrepaidStatus((b.paymentStatus || "")) && (b.amountPaid || 0) <= 0) prepaid += b.amountTotal || 0;

          const method = b.paymentMethod || "";
          const cIn = cashCollected(method, b.amountPaid, b.cashReceived);
          const oIn = onlineCollected(method, b.amountPaid, b.cashReceived);
          cashIn += cIn;
          onlineIn += oIn;
          if ((b.amountPaid || 0) > 0 && !method) unspecifiedCollected += b.amountPaid || 0;

          const cOut = cashRefunded(b.refundMethod, b.amountRefunded, b.refundCash);
          const oOut = onlineRefunded(b.refundMethod, b.amountRefunded, b.refundCash);
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
            refundMethod: b.refundMethod || "—",
            cashOut: cOut,
            onlineOut: oOut,
            prepaid: (b.paymentStatus || "").toLowerCase() === "prepaid",
          };
        });

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
        });
      }

      // --- Daily Ledger ---
      case "getDailyLedger": {
        const { date } = rest;
        if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

        const db = getDb();
        const allAccounts = await db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, isDefault: accounts.isDefault }).from(accounts).where(eq(accounts.isActive, 1));

        const incomeEntries = await db.select().from(dailyIncome).where(eq(dailyIncome.date, date)).orderBy(desc(dailyIncome.createdAt));

        const dayExpenses = await db.select().from(expenses).where(
          and(sql`${expenses.createdAt} >= ${date}`, sql`${expenses.createdAt} <= ${date + "T23:59:59"}`)
        ).orderBy(desc(expenses.createdAt));

        // Attach vendor names
        const vendorIds = dayExpenses.filter((e) => e.vendorId).map((e) => e.vendorId!);
        let vendorMap: Record<number, string> = {};
        if (vendorIds.length > 0) {
          const vendorRows = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, vendorIds));
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
          const activeAccount = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, income.accountId!), eq(accounts.isActive, 1))).limit(1);
          if (!activeAccount.length) return NextResponse.json({ error: "The selected online account is not active" }, { status: 400 });
        }
        const reconciled = await db.select({ id: dailyLedger.id }).from(dailyLedger).where(and(
          eq(dailyLedger.date, income.date),
          income.accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, income.accountId),
          eq(dailyLedger.isReconciled, 1),
        )).limit(1);
        if (reconciled.length) return NextResponse.json({ error: "This account is already reconciled for the selected date. Undo reconciliation before adding income." }, { status: 400 });
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
          .from(accounts).where(eq(accounts.isActive, 1)).orderBy(desc(accounts.isDefault), accounts.name);
        return NextResponse.json({ accounts: activeAccounts });
      }

      case "listIncomeRecords": {
        const month = typeof rest.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(rest.month) ? rest.month : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
        const db = getDb();
        const [rows, monthRows, allAccounts] = await Promise.all([
          db.select({
            id: dailyIncome.id, date: dailyIncome.date, accountId: dailyIncome.accountId, type: dailyIncome.type,
            amount: dailyIncome.amount, source: dailyIncome.source, sourceDetail: dailyIncome.sourceDetail,
            description: dailyIncome.description, createdBy: dailyIncome.createdBy, createdAt: dailyIncome.createdAt,
            accountName: sql<string>`COALESCE(NULLIF(${accounts.nickname}, ''), ${accounts.name})`,
          }).from(dailyIncome).leftJoin(accounts, eq(dailyIncome.accountId, accounts.id))
            .where(sql`${dailyIncome.date} >= ${month + "-01"} AND ${dailyIncome.date} < date(${month + "-01"}, '+1 month')`)
            .orderBy(desc(dailyIncome.date), desc(dailyIncome.createdAt)),
          db.selectDistinct({ month: sql<string>`substr(${dailyIncome.date}, 1, 7)` }).from(dailyIncome).orderBy(desc(sql`substr(${dailyIncome.date}, 1, 7)`)),
          db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname }).from(accounts).orderBy(accounts.name),
        ]);
        return NextResponse.json({
          incomeEntries: rows.map((row) => ({ ...row, accountName: row.accountId == null ? "Cash" : row.accountName || "Account" })),
          months: Array.from(new Set([month, ...monthRows.map((row) => row.month).filter(Boolean)])).sort().reverse(),
          currentMonth: month,
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
        const reconciled = await db.select({ ledgerId: dailyLedger.id }).from(dailyLedger).where(and(
          eq(dailyLedger.date, entry[0].date),
          entry[0].accountId === null ? isNull(dailyLedger.accountId) : eq(dailyLedger.accountId, entry[0].accountId),
          eq(dailyLedger.isReconciled, 1),
        )).limit(1);
        if (reconciled.length) return NextResponse.json({ error: "This account is already reconciled for the entry date. Undo reconciliation before deleting income." }, { status: 400 });
        await db.delete(dailyIncome).where(eq(dailyIncome.id, id));
        return NextResponse.json({ success: true });
      }

      // --- Reconciliation ---
      case "getReconciliation": {
        const { date } = rest;
        if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

        const db = getDb();
        const allAccounts = await db.select().from(accounts).where(eq(accounts.isActive, 1));
        const ledgerEntries = await db.select().from(dailyLedger).where(eq(dailyLedger.date, date));

        // Get income/expense totals for the day
        const incomeEntries = await db.select().from(dailyIncome).where(eq(dailyIncome.date, date));
        const automaticReceipts = await db.select().from(guestReceipts).where(eq(guestReceipts.businessDate, date));
        const dayExpenses = await db.select().from(expenses).where(
          and(sql`${expenses.createdAt} >= ${date}`, sql`${expenses.createdAt} <= ${date + "T23:59:59"}`)
        );

        const priorLedgerEntries = await db.select().from(dailyLedger)
          .where(lt(dailyLedger.date, date)).orderBy(desc(dailyLedger.date));

        // Build balance for each account + cash
        const balances = [
          { accountId: null, accountName: "Cash" },
          ...allAccounts.map((a) => ({ accountId: a.id as number, accountName: (a.nickname || a.name) as string })),
        ].map((acc) => {
          const ledgerEntry = ledgerEntries.find((l) => l.accountId === acc.accountId);
          const manualIncome = incomeEntries.filter((i) => i.accountId === acc.accountId).reduce((s, i) => s + i.amount, 0);
          const receiptIncome = automaticReceipts.filter((r) => r.accountId === acc.accountId).reduce((s, r) => s + r.amount, 0);
          const totalIncome = manualIncome + receiptIncome;
          const totalExpense = dayExpenses.filter((e) => e.accountId === acc.accountId).reduce((s, e) => s + e.amount, 0);

          const prevEntry = priorLedgerEntries.find((l) => l.accountId === acc.accountId);
          const account = allAccounts.find((a) => a.id === acc.accountId);
          const openingBalance = resolveOpeningBalance(ledgerEntry, prevEntry, account?.openingBalance ?? 0);

          const expectedClosing = openingBalance + totalIncome - totalExpense;

          return {
            accountId: acc.accountId,
            accountName: acc.accountName,
            openingBalance,
            totalIncome,
            manualIncome,
            automaticGuestReceipts: receiptIncome,
            totalExpense,
            expectedClosing,
            actualClosing: ledgerEntry?.actualClosing ?? null,
            isReconciled: !!ledgerEntry?.isReconciled,
          };
        });

        const { isReconciled } = await getReconciliationStatus(date);
        const notes = ledgerEntries[0]?.notes || "";
        const reconciledBy = ledgerEntries[0]?.reconciledBy || "";
        const reconciledAt = ledgerEntries[0]?.reconciledAt || "";

        return NextResponse.json({ balances, automaticReceipts, isReconciled, notes, reconciledBy, reconciledAt });
      }

      case "saveReconciliation": {
        const { date, entries, notes } = rest;
        if (!date || !entries) return NextResponse.json({ error: "date and entries required" }, { status: 400 });

        const db = getDb();
        const incomeEntries = await db.select().from(dailyIncome).where(eq(dailyIncome.date, date));
        const automaticReceipts = await db.select().from(guestReceipts).where(eq(guestReceipts.businessDate, date));
        const dayExpenses = await db.select().from(expenses).where(
          and(sql`${expenses.createdAt} >= ${date}`, sql`${expenses.createdAt} <= ${date + "T23:59:59"}`)
        );
        const allAccounts = await db.select().from(accounts).where(eq(accounts.isActive, 1));

        const priorLedgerEntries = await db.select().from(dailyLedger)
          .where(lt(dailyLedger.date, date)).orderBy(desc(dailyLedger.date));
        const existingLedger = await db.select().from(dailyLedger).where(eq(dailyLedger.date, date));

        for (const entry of entries as { accountId: number | null; actualClosing: number | null }[]) {
          const totalIncome = incomeEntries.filter((i) => i.accountId === entry.accountId).reduce((s, i) => s + i.amount, 0)
            + automaticReceipts.filter((r) => r.accountId === entry.accountId).reduce((s, r) => s + r.amount, 0);
          const totalExpense = dayExpenses.filter((e) => e.accountId === entry.accountId).reduce((s, e) => s + e.amount, 0);

          const todayEntry = existingLedger.find((l) => l.accountId === entry.accountId);
          const prevEntry = priorLedgerEntries.find((l) => l.accountId === entry.accountId);
          const account = allAccounts.find((a) => a.id === entry.accountId);
          const openingBalance = resolveOpeningBalance(todayEntry, prevEntry, account?.openingBalance ?? 0);
          const expectedClosing = openingBalance + totalIncome - totalExpense;

          const existing = await db.select().from(dailyLedger).where(
            and(eq(dailyLedger.date, date), entry.accountId != null ? eq(dailyLedger.accountId, entry.accountId) : sql`${dailyLedger.accountId} IS NULL`)
          ).limit(1);

          if (existing.length > 0) {
            await db.update(dailyLedger).set({
              openingBalance,
              totalIncome,
              totalExpense,
              expectedClosing,
              actualClosing: entry.actualClosing,
              isReconciled: 1,
              reconciledBy: username || displayName,
              reconciledAt: new Date().toISOString(),
              notes: notes || "",
            }).where(eq(dailyLedger.id, existing[0].id));
          } else {
            await db.insert(dailyLedger).values({
              date,
              accountId: entry.accountId,
              openingBalance,
              totalIncome,
              totalExpense,
              expectedClosing,
              actualClosing: entry.actualClosing,
              isReconciled: 1,
              reconciledBy: username || displayName,
              reconciledAt: new Date().toISOString(),
              notes: notes || "",
            });
          }
        }

        return NextResponse.json({ success: true });
      }

      case "undoReconciliation": {
        const { date } = rest;
        if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

        const db = getDb();
        await db.update(dailyLedger).set({
          isReconciled: 0,
          reconciledBy: null,
          reconciledAt: null,
          actualClosing: null,
        }).where(eq(dailyLedger.date, date));

        return NextResponse.json({ success: true });
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
