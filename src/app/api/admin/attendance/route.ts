import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { employeeAttendance, employeeAttendanceHistory, employeeLeavePolicy, employees } from "@/db/schema";
import { syncInsert, syncUpdate } from "@/db/syncMeta";
import { authenticateUser } from "@/lib/auth";
import { permissionEnabled } from "@/lib/actionPermissions";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { calculateEmployeePayroll } from "@/lib/employeeAttendance";
import { monthEnd, type AttendanceStatus } from "@/lib/employeeAttendanceUtils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const STATUSES = new Set<AttendanceStatus>(["present", "half_day_leave", "full_day_leave"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action } = body;
    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const canManageAttendance = auth.role === "admin" || (auth.role === "manager" && auth.permissions.canManageAttendance);
    const canViewAudit = auth.role === "admin" || permissionEnabled(auth.permissions, "canViewAudit");
    if (action === "getAuditHistory" && !canViewAudit) {
      return NextResponse.json({ error: "Audit access required" }, { status: 403 });
    }
    if (action !== "getAuditHistory" && !canManageAttendance) {
      return NextResponse.json({ error: "Manager attendance access required" }, { status: 403 });
    }

    const db = getDb();
    const actor = username || "admin";

    if (action === "getAuditHistory") {
      const month = String(body.month || "");
      if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Valid month required" }, { status: 400 });
      const start = `${month}-01`;
      const end = monthEnd(month);
      const [historyRows, employeeRows] = await Promise.all([
        db.select().from(employeeAttendanceHistory).where(and(gte(employeeAttendanceHistory.date, start), lte(employeeAttendanceHistory.date, end))).orderBy(desc(employeeAttendanceHistory.performedAt)).limit(100),
        db.select({ id: employees.id, name: employees.name }).from(employees),
      ]);
      const names = new Map(employeeRows.map((employee) => [employee.id, employee.name]));
      return NextResponse.json({
        history: historyRows.map((row) => ({ ...row, employeeName: names.get(row.employeeId) || `Employee #${row.employeeId}` })),
      });
    }

    if (action === "getMonth") {
      const month = String(body.month || "");
      if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Valid month required" }, { status: 400 });
      const start = `${month}-01`;
      const end = monthEnd(month);
      const [employeeRows, attendanceRows, historyRows, policyRows] = await Promise.all([
        db.select().from(employees).where(and(
          lte(employees.attendanceStartDate, end),
          or(eq(employees.employmentEndDate, ""), gte(employees.employmentEndDate, start)),
          isNull(employees.deletedAt),
        )).orderBy(employees.name),
        db.select().from(employeeAttendance).where(and(gte(employeeAttendance.date, start), lte(employeeAttendance.date, end), isNull(employeeAttendance.deletedAt))),
        db.select().from(employeeAttendanceHistory).where(and(gte(employeeAttendanceHistory.date, start), lte(employeeAttendanceHistory.date, end))).orderBy(desc(employeeAttendanceHistory.performedAt)).limit(100),
        db.select().from(employeeLeavePolicy).where(and(lte(employeeLeavePolicy.effectiveMonth, month), isNull(employeeLeavePolicy.deletedAt))),
      ]);
      const summaries = await Promise.all(employeeRows.map((employee) => calculateEmployeePayroll(employee.id, month)));
      const names = new Map(employeeRows.map((employee) => [employee.id, employee.name]));
      const latestGlobalPolicy = policyRows.filter((row) => row.employeeId == null).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0];
      return NextResponse.json({
        employees: employeeRows,
        attendance: attendanceRows,
        summaries: summaries.filter(Boolean),
        history: historyRows.map((row) => ({ ...row, employeeName: names.get(row.employeeId) || `Employee #${row.employeeId}` })),
        policy: latestGlobalPolicy || { monthlyCreditUnits: 4, carryCapUnits: 24, effectiveMonth: month },
        policies: policyRows,
      });
    }

    if (action === "getPayroll") {
      const employeeId = Number(body.employeeId);
      const month = String(body.month || "");
      if (!Number.isInteger(employeeId) || !MONTH_RE.test(month)) return NextResponse.json({ error: "employeeId and valid month required" }, { status: 400 });
      const summary = await calculateEmployeePayroll(employeeId, month);
      if (!summary) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      return NextResponse.json({ summary });
    }

    if (action === "setAttendance") {
      const employeeId = Number(body.employeeId);
      const startDate = String(body.startDate || "");
      const endDate = String(body.endDate || startDate);
      const status = String(body.status || "") as AttendanceStatus;
      const comment = String(body.comment || "").trim().slice(0, 500);
      if (!Number.isInteger(employeeId) || !DATE_RE.test(startDate) || !DATE_RE.test(endDate) || endDate < startDate || !STATUSES.has(status)) {
        return NextResponse.json({ error: "Valid employee, date range, and status required" }, { status: 400 });
      }
      const dates: string[] = [];
      for (let date = startDate; date <= endDate && dates.length <= 62; date = addCalendarDays(date, 1)) dates.push(date);
      if (dates.length > 62 || dates[dates.length - 1] !== endDate) return NextResponse.json({ error: "Attendance ranges are limited to 62 days" }, { status: 400 });
      const [employee] = await db.select().from(employees).where(and(eq(employees.id, employeeId), isNull(employees.deletedAt))).limit(1);
      if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      if (dates.some((date) => date < employee.attendanceStartDate || (employee.employmentEndDate && date > employee.employmentEndDate))) {
        return NextResponse.json({ error: "Attendance date is outside this employee's employment period" }, { status: 400 });
      }

      let changed = 0;
      for (const date of dates) {
        const [existing] = await db.select().from(employeeAttendance).where(and(
          eq(employeeAttendance.employeeId, employeeId),
          eq(employeeAttendance.date, date),
          isNull(employeeAttendance.deletedAt),
        )).limit(1);
        const oldStatus = existing?.status || "present";
        const oldComment = existing?.comment || "";
        if (oldStatus === status && oldComment === comment) continue;
        const now = new Date().toISOString();
        if (existing) {
          await db.update(employeeAttendance).set(syncUpdate({ status, comment, updatedBy: actor, updatedAt: now, deletedAt: null })).where(eq(employeeAttendance.id, existing.id));
        } else {
          await db.insert(employeeAttendance).values(syncInsert({ employeeId, date, status, comment, createdBy: actor, createdAt: now, updatedBy: actor, updatedAt: now }));
        }
        await db.insert(employeeAttendanceHistory).values(syncInsert({
          employeeId, date, oldStatus, newStatus: status, oldComment, newComment: comment,
          action: status === "present" ? "Restored Present" : existing ? "Attendance Updated" : "Absence Marked",
          performedBy: actor, performedAt: now,
        }));
        changed++;
      }
      return NextResponse.json({ success: true, changed });
    }

    if (action === "savePolicy") {
      const employeeId = body.employeeId == null || body.employeeId === "" ? null : Number(body.employeeId);
      const effectiveMonth = String(body.effectiveMonth || "");
      const monthlyCreditUnits = Number(body.monthlyCreditUnits);
      const carryCapUnits = Number(body.carryCapUnits);
      if ((employeeId != null && !Number.isInteger(employeeId)) || !MONTH_RE.test(effectiveMonth) || !Number.isInteger(monthlyCreditUnits) || monthlyCreditUnits < 0 || !Number.isInteger(carryCapUnits) || carryCapUnits < monthlyCreditUnits) {
        return NextResponse.json({ error: "Valid effective month and leave values required" }, { status: 400 });
      }
      const conditions = employeeId == null
        ? and(isNull(employeeLeavePolicy.employeeId), eq(employeeLeavePolicy.effectiveMonth, effectiveMonth))
        : and(eq(employeeLeavePolicy.employeeId, employeeId), eq(employeeLeavePolicy.effectiveMonth, effectiveMonth));
      const [existing] = await db.select().from(employeeLeavePolicy).where(conditions).limit(1);
      if (existing) {
        await db.update(employeeLeavePolicy).set(syncUpdate({ monthlyCreditUnits, carryCapUnits, createdBy: actor, createdAt: new Date().toISOString(), deletedAt: null })).where(eq(employeeLeavePolicy.id, existing.id));
      } else {
        await db.insert(employeeLeavePolicy).values(syncInsert({ employeeId, effectiveMonth, monthlyCreditUnits, carryCapUnits, createdBy: actor, createdAt: new Date().toISOString() }));
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}
