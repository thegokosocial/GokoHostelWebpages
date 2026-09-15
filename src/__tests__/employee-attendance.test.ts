import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { attendanceUnits, daysInMonth, monthEnd, addMonth, calendarMonthDates, grossForEmploymentPeriod } from "@/lib/employeeAttendanceUtils";

describe("employee attendance calendar rules", () => {
  it("treats every calendar day as a working day and uses half-day units", () => {
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(monthEnd("2026-09")).toBe("2026-09-30");
    expect(attendanceUnits("present")).toBe(0);
    expect(attendanceUnits("half_day_leave")).toBe(1);
    expect(attendanceUnits("full_day_leave")).toBe(2);
  });

  it("rolls leave-accrual months across year boundaries", () => {
    expect(addMonth("2026-12")).toBe("2027-01");
    expect(addMonth("2027-01", -1)).toBe("2026-12");
  });

  it("builds complete Sunday-first month grids", () => {
    const september = calendarMonthDates("2026-09");
    expect(september).toHaveLength(35);
    expect(september.slice(0, 2)).toEqual([null, null]);
    expect(september[2]).toBe("2026-09-01");
    expect(september[31]).toBe("2026-09-30");

    const leapFebruary = calendarMonthDates("2024-02");
    expect(leapFebruary).toHaveLength(35);
    expect(leapFebruary).toContain("2024-02-29");
  });

  it("prorates salary for employees who join or leave during a month", () => {
    expect(grossForEmploymentPeriod(30_000, "monthly", 30, 15)).toBe(15_000);
    expect(grossForEmploymentPeriod(1_000, "daily", 30, 15)).toBe(15_000);
    expect(grossForEmploymentPeriod(7_000, "weekly", 30, 30)).toBe(30_333);
    expect(grossForEmploymentPeriod(30_000, "monthly", 30, 0)).toBe(0);
  });

  it("keeps corrections explicit and audits only real changes", () => {
    const route = readFileSync("src/app/api/admin/attendance/route.ts", "utf8");
    expect(route).toContain('new Set<AttendanceStatus>(["present", "half_day_leave", "full_day_leave"])');
    expect(route).toContain('action === "getAuditHistory"');
    expect(route).toContain('error: "Audit access required"');
    expect(route).toContain("if (oldStatus === status && oldComment === comment) continue");
    expect(route).toContain('status === "present" ? "Restored Present"');
    expect(route).toContain("Attendance ranges are limited to 62 days");
  });

  it("wires the employee calendar to existing monthly data and edit flow", () => {
    const ui = readFileSync("src/components/admin/ManagementAttendance.tsx", "utf8");
    expect(ui).toContain("calendarMonthDates(month)");
    expect(ui).toContain('statusLabel(row?.status || "present")');
    expect(ui).toContain("date > todayIST()");
    expect(ui).toContain("openForm(calendarEmployee.id, date)");
    expect(ui).toContain("calendarEmployee.attendanceStartDate");
    expect(ui).toContain("calendarEmployee.employmentEndDate");
    expect(ui).toContain('row ? statusLabel(row.status) : upcoming ? "Upcoming" : "Present"');
    expect(ui).toContain('role === "admin" && !outsideEmployment');
    expect(ui).toContain('!employee.isActive ? " (Inactive)"');
    expect(ui).toContain('setMonth(`${calendarYear}-${e.target.value}`)');
    expect(ui).toContain('setMonth(`${e.target.value}-${calendarMonth}`)');
    expect(ui).toContain('min-w-0 sm:min-w-[700px]');
    expect(ui).toContain('min-h-16 min-w-0');
    expect(ui).toContain('role !== "admin"');
    expect(ui).toContain("Attendance audit");
    const management = readFileSync("src/components/admin/AdminManagement.tsx", "utf8");
    expect(management).toContain("<ManagementAttendance password={password} username={username} role={role} />");
    const audit = readFileSync("src/components/admin/ManagementAudit.tsx", "utf8");
    expect(audit).toContain('{ id: "attendance" as AuditSubTab, label: "Attendance" }');
    expect(audit).toContain('action: "getAuditHistory"');
    expect(audit).toContain("attendanceHistoryToAuditEntry");
    expect(audit).toContain('filePrefix="attendance-audit-log"');
  });

  it("keeps attendance management restricted while allowing audit history separately", () => {
    const route = readFileSync("src/app/api/admin/attendance/route.ts", "utf8");
    const dashboard = readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
    expect(route).toContain('auth.role === "manager" && auth.permissions.canManageAttendance');
    expect(dashboard).toContain('role === "manager" && !!permissions?.canManageAttendance');
    expect(dashboard).toContain('managementTab: "attendance"');
    expect(route).toContain('permissionEnabled(auth.permissions, "canViewAudit")');
  });
});
