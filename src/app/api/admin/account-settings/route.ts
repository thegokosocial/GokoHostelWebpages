import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { accounts, vendors, employees, salaryPayments, expenses, guestReceipts, employeeCompensationHistory } from "@/db/schema";
import { getSetting, setSetting } from "@/db/queries";
import { eq, desc, and } from "drizzle-orm";
import { authenticateUser } from "@/lib/auth";
import { syncInsert, syncUpdate } from "@/db/syncMeta";
import { calculateEmployeePayroll } from "@/lib/employeeAttendance";
import { todayIST } from "@/lib/utils";
import { parseExpenseCategories, parseIncomeCategories } from "@/lib/accountCategories";
import { permissionEnabled } from "@/lib/actionPermissions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...rest } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, permissions } = auth;
    const actionPermissions: Record<string, string> = {
      listCategories: "canManageAccountSettings", saveCategories: "canManageAccountSettings",
      listAccounts: "canManageAccountSettings", saveReceiptDefaults: "canManageAccountSettings",
      addAccount: "canManageAccountSettings", updateAccount: "canManageAccountSettings", deleteAccount: "canManageAccountSettings",
      listVendors: "canManageVendors", addVendor: "canManageVendors", updateVendor: "canManageVendors", deleteVendor: "canManageVendors",
      listEmployees: "canManageEmployees", addEmployee: "canManageEmployees", updateEmployee: "canManageEmployees", deleteEmployee: "canManageEmployees",
      paySalary: "canManagePayroll",
    };
    const requiredPermission = actionPermissions[String(action)] || "canManageAccountSettings";
    const canUseSettings = role === "admin" || permissionEnabled(permissions, requiredPermission) || permissionEnabled(permissions, "canManageAccountSettings");
    if (!canUseSettings) {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    const db = getDb();

    switch (action) {
      case "listCategories": {
        const [expenseValue, incomeValue] = await Promise.all([getSetting("expense_categories"), getSetting("income_categories")]);
        return NextResponse.json({ expenseCategories: parseExpenseCategories(expenseValue), incomeCategories: parseIncomeCategories(incomeValue) });
      }
      case "saveCategories": {
        const expenseCategories = rest.expenseCategories;
        const incomeCategories = rest.incomeCategories;
        const validNames = (items: unknown) => Array.isArray(items) && items.length > 0 && items.length <= 50 && items.every((item) => typeof item === "string" && item.trim().length > 0 && item.trim().length <= 60);
        const validIncome = Array.isArray(incomeCategories) && incomeCategories.length > 0 && incomeCategories.length <= 50 && incomeCategories.every((item) => item && typeof item.id === "string" && item.id.length <= 80 && typeof item.name === "string" && item.name.trim().length > 0 && item.name.trim().length <= 60);
        if (!validNames(expenseCategories) || !validIncome) return NextResponse.json({ error: "Categories must have unique names between 1 and 60 characters" }, { status: 400 });
        const cleanExpenses = expenseCategories.map((item: string) => item.trim());
        const cleanIncome = incomeCategories.map((item: { id: string; name: string }) => ({ id: item.id, name: item.name.trim() }));
        if (new Set(cleanExpenses.map((item: string) => item.toLowerCase())).size !== cleanExpenses.length || new Set(cleanIncome.map((item: { name: string }) => item.name.toLowerCase())).size !== cleanIncome.length || new Set(cleanIncome.map((item: { id: string }) => item.id)).size !== cleanIncome.length) {
          return NextResponse.json({ error: "Category names must be unique" }, { status: 400 });
        }
        await Promise.all([setSetting("expense_categories", JSON.stringify(cleanExpenses)), setSetting("income_categories", JSON.stringify(cleanIncome))]);
        return NextResponse.json({ success: true, expenseCategories: cleanExpenses, incomeCategories: cleanIncome });
      }
      // --- Accounts ---
      case "listAccounts": {
        const items = await db.select().from(accounts).orderBy(desc(accounts.createdAt));
        const [foodOnlineReceiptAccountId, roomOnlineReceiptAccountId] = await Promise.all([
          getSetting("food_online_receipt_account_id"), getSetting("room_online_receipt_account_id"),
        ]);
        return NextResponse.json({ accounts: items, foodOnlineReceiptAccountId, roomOnlineReceiptAccountId });
      }
      case "saveReceiptDefaults": {
        const validate = async (raw: unknown) => {
          const id = Number(raw);
          if (!Number.isInteger(id) || id <= 0) throw new Error("Select an active account for each online receipt default");
          const found = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.isActive, 1))).limit(1);
          if (!found[0]) throw new Error("Selected receipt account no longer exists");
          return id;
        };
        const [foodId, roomId] = await Promise.all([validate(rest.foodOnlineReceiptAccountId), validate(rest.roomOnlineReceiptAccountId)]);
        await Promise.all([
          setSetting("food_online_receipt_account_id", String(foodId)),
          setSetting("room_online_receipt_account_id", String(roomId)),
        ]);
        return NextResponse.json({ success: true });
      }
      case "addAccount": {
        const { name, nickname, bankName, accountType, accountNumber, ifscCode, openingBalance, isDefault } = rest;
        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
        if (isDefault === "1" || isDefault === 1) {
          await db.update(accounts).set({ isDefault: 0 });
        }
        await db.insert(accounts).values({
          name,
          nickname: nickname || "",
          bankName: bankName || "",
          accountType: accountType || "savings",
          accountNumber: accountNumber || "",
          ifscCode: ifscCode || "",
          isDefault: isDefault === "1" || isDefault === 1 ? 1 : 0,
          openingBalance: openingBalance || 0,
          createdAt: new Date().toISOString(),
        });
        return NextResponse.json({ success: true });
      }
      case "updateAccount": {
        const { id, name, nickname, bankName, accountType, accountNumber, ifscCode, openingBalance, isDefault } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        if (isDefault === "1" || isDefault === 1) {
          await db.update(accounts).set({ isDefault: 0 });
        }
        await db.update(accounts).set({
          ...(name && { name }),
          nickname: nickname ?? undefined,
          bankName: bankName ?? undefined,
          accountType: accountType ?? undefined,
          accountNumber: accountNumber ?? undefined,
          ifscCode: ifscCode ?? undefined,
          isDefault: isDefault === "1" || isDefault === 1 ? 1 : 0,
          openingBalance: openingBalance ?? undefined,
        }).where(eq(accounts.id, id));
        return NextResponse.json({ success: true });
      }
      case "deleteAccount": {
        const { id } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        const usedByReceipt = await db.select({ id: guestReceipts.id }).from(guestReceipts).where(eq(guestReceipts.accountId, id)).limit(1);
        if (usedByReceipt[0]) return NextResponse.json({ error: "This account is used by guest receipts and cannot be deleted" }, { status: 400 });
        const [foodDefault, roomDefault] = await Promise.all([getSetting("food_online_receipt_account_id"), getSetting("room_online_receipt_account_id")]);
        if (String(id) === foodDefault || String(id) === roomDefault) return NextResponse.json({ error: "Choose another guest receipt default before deleting this account" }, { status: 400 });
        await db.delete(accounts).where(eq(accounts.id, id));
        return NextResponse.json({ success: true });
      }

      // --- Vendors ---
      case "listVendors": {
        const items = await db.select().from(vendors).orderBy(vendors.name);
        return NextResponse.json({ vendors: items });
      }
      case "addVendor": {
        const { name, category, contactPhone, notes } = rest;
        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
        await db.insert(vendors).values({
          name,
          category: category || "",
          contactPhone: contactPhone || "",
          notes: notes || "",
          createdAt: new Date().toISOString(),
        });
        return NextResponse.json({ success: true });
      }
      case "updateVendor": {
        const { id, name, category, contactPhone, notes } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        await db.update(vendors).set({
          ...(name && { name }),
          category: category ?? undefined,
          contactPhone: contactPhone ?? undefined,
          notes: notes ?? undefined,
        }).where(eq(vendors.id, id));
        return NextResponse.json({ success: true });
      }
      case "deleteVendor": {
        const { id } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        await db.delete(vendors).where(eq(vendors.id, id));
        return NextResponse.json({ success: true });
      }

      // --- Employees ---
      case "listEmployees": {
        const items = await db.select().from(employees).orderBy(employees.name);
        return NextResponse.json({ employees: items });
      }
      case "addEmployee": {
        const { name, role: empRole, phone, salary, salaryFrequency, bankAccount, attendanceStartDate } = rest;
        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
        const now = new Date().toISOString();
        const [created] = await db.insert(employees).values(syncInsert({
          name,
          role: empRole || "",
          phone: phone || "",
          salary: salary || 0,
          salaryFrequency: salaryFrequency || "monthly",
          bankAccount: bankAccount || "",
          attendanceStartDate: attendanceStartDate || todayIST(),
          createdAt: now,
        })).returning({ id: employees.id });
        await db.insert(employeeCompensationHistory).values(syncInsert({ employeeId: created.id, effectiveMonth: (attendanceStartDate || todayIST()).slice(0, 7), salary: salary || 0, salaryFrequency: salaryFrequency || "monthly", createdBy: username || "admin", createdAt: now }));
        return NextResponse.json({ success: true });
      }
      case "updateEmployee": {
        const { id, name, role: empRole, phone, salary, salaryFrequency, bankAccount, attendanceStartDate, employmentEndDate, compensationEffectiveMonth } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        await db.update(employees).set(syncUpdate({
          ...(name && { name }),
          role: empRole ?? undefined,
          phone: phone ?? undefined,
          salary: salary ?? undefined,
          salaryFrequency: salaryFrequency ?? undefined,
          bankAccount: bankAccount ?? undefined,
          attendanceStartDate: attendanceStartDate ?? undefined,
          employmentEndDate: employmentEndDate ?? undefined,
        })).where(eq(employees.id, id));
        if (salary != null || salaryFrequency != null) {
          const month = compensationEffectiveMonth || todayIST().slice(0, 7);
          const [existing] = await db.select().from(employeeCompensationHistory).where(and(eq(employeeCompensationHistory.employeeId, id), eq(employeeCompensationHistory.effectiveMonth, month))).limit(1);
          const values = { salary: salary ?? 0, salaryFrequency: salaryFrequency || "monthly", createdBy: username || "admin", createdAt: new Date().toISOString(), deletedAt: null };
          if (existing) await db.update(employeeCompensationHistory).set(syncUpdate(values)).where(eq(employeeCompensationHistory.id, existing.id));
          else await db.insert(employeeCompensationHistory).values(syncInsert({ employeeId: id, effectiveMonth: month, ...values }));
        }
        return NextResponse.json({ success: true });
      }
      case "deleteEmployee": {
        const { id } = rest;
        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
        await db.update(employees).set(syncUpdate({ isActive: 0, employmentEndDate: todayIST() })).where(eq(employees.id, id));
        return NextResponse.json({ success: true });
      }

      // --- Salary Payments ---
      case "paySalary": {
        const { employeeId, amount, month, accountId, paymentMethod, payType, notes, requestId } = rest;
        if (!employeeId || !amount || !month) {
          return NextResponse.json({ error: "employeeId, amount, and month required" }, { status: 400 });
        }

        const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
        if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

        const now = new Date().toISOString();
        const actorName = username || "admin";
        const type = payType || "salary";
        if (requestId) {
          const [existing] = await db.select({ id: salaryPayments.id }).from(salaryPayments).where(eq(salaryPayments.requestId, requestId)).limit(1);
          if (existing) return NextResponse.json({ success: true, duplicate: true });
        }
        const payroll = await calculateEmployeePayroll(employeeId, month);
        const typeLabel = type === "salary" ? "Salary" : type === "bonus" ? "Bonus" : type === "advance" ? "Advance" : type === "loan" ? "Loan" : type === "reimbursement" ? "Reimbursement" : "Payment";

        await db.insert(salaryPayments).values(syncInsert({
          employeeId,
          amount,
          month,
          accountId: accountId || null,
          paymentMethod: paymentMethod || "cash",
          paidAt: now,
          notes: `[${typeLabel}] ${notes || ""}`.trim(),
          payType: type,
          requestId: requestId || crypto.randomUUID(),
          grossAmount: payroll?.grossAmount || 0,
          attendanceDeduction: payroll?.attendanceDeduction || 0,
          netPayable: payroll?.netPayable || 0,
          paidLeaveUnits: payroll?.paidLeaveUnits || 0,
          unpaidLeaveUnits: payroll?.unpaidLeaveUnits || 0,
          calculationSnapshot: payroll ? JSON.stringify(payroll) : "",
          createdBy: actorName,
        }));

        // Use selected month for expense record (e.g. "2026-06" -> "JUNE-2026")
        const [yr, mo] = month.split("-");
        const monthNames = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
        const monthKey = `${monthNames[parseInt(mo, 10) - 1]}-${yr}`;
        await db.insert(expenses).values({
          amount,
          category: "Salary",
          customCategory: "",
          purpose: `${typeLabel} for ${emp.name} (${month})${notes ? " - " + notes : ""}`,
          billImageLink: "",
          vendorId: null,
          accountId: accountId || null,
          paymentMethod: paymentMethod || "cash",
          mainCategory: "stay_expense",
          subCategory: "Salary",
          createdBy: actorName,
          createdAt: now,
          updatedAt: now,
          createdMonth: monthKey,
        });

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
