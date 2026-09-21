"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDaysIcon, CheckIcon, DownloadIcon, HistoryIcon, Loader2Icon, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLoading } from "./AdminLoading";
import { useAdminToast } from "./AdminToast";
import type { Role } from "./types";
import { calendarMonthDates } from "@/lib/employeeAttendanceUtils";
import { todayIST } from "@/lib/utils";
import { DateRangePicker } from "@/components/dates/DateRangePicker";

type Employee = { id: number; name: string; role: string; isActive: number; attendanceStartDate: string; employmentEndDate: string };
type Attendance = { id: number; employeeId: number; date: string; status: string; comment: string; updatedBy: string };
type Summary = {
  employeeId: number; openingLeaveUnits: number; creditedLeaveUnits: number; paidLeaveUnits: number; unpaidLeaveUnits: number;
  closingLeaveUnits: number; fullDayLeave: number; halfDayLeave: number; grossAmount: number; attendanceDeduction: number;
  netPayable: number; salaryPaid: number; adjustmentDue: number; isProjected: boolean;
};
type History = { id: number; employeeName: string; date: string; oldStatus: string; newStatus: string; newComment: string; action: string; performedBy: string; performedAt: string };

const statusLabel = (value: string) => value === "full_day_leave" ? "Full Day" : value === "half_day_leave" ? "Half Day" : "Present";
const days = (units: number) => (units / 2).toFixed(units % 2 ? 1 : 0);
const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ManagementAttendance({ password, username, role, canManageAttendance }: { password: string; username?: string; role: Role; canManageAttendance: boolean }) {
  const { showError, showSuccess } = useAdminToast();
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [policy, setPolicy] = useState({ monthlyCreditUnits: 4, carryCapUnits: 24, effectiveMonth: todayIST().slice(0, 7) });
  const [policies, setPolicies] = useState<Array<{ employeeId: number | null; effectiveMonth: string; monthlyCreditUnits: number; carryCapUnits: number }>>([]);
  const [policyEmployeeId, setPolicyEmployeeId] = useState("");
  const [calendarEmployeeId, setCalendarEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ employeeId: number; startDate: string; endDate: string; status: string; comment: string } | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => fetch("/api/admin/attendance", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, username, ...body }),
  }), [password, username]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call({ action: "getMonth", month });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Could not load attendance");
      setEmployees(data.employees || []); setAttendance(data.attendance || []); setSummaries(data.summaries || []); setHistory(data.history || []);
      setPolicy(data.policy || { monthlyCreditUnits: 4, carryCapUnits: 24, effectiveMonth: month });
      setPolicies(data.policies || []);
    } catch { showError("Network error loading attendance"); } finally { setLoading(false); }
  }, [call, month, showError]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!employees.some((employee) => String(employee.id) === calendarEmployeeId)) {
      setCalendarEmployeeId(String(employees.find((employee) => employee.isActive)?.id || employees[0]?.id || ""));
    }
  }, [calendarEmployeeId, employees]);

  const todayRows = useMemo(() => new Map(attendance.filter((row) => row.date === todayIST()).map((row) => [row.employeeId, row])), [attendance]);
  const calendarEmployee = employees.find((employee) => String(employee.id) === calendarEmployeeId);
  const calendarRows = useMemo(() => new Map(attendance.filter((row) => String(row.employeeId) === calendarEmployeeId).map((row) => [row.date, row])), [attendance, calendarEmployeeId]);
  const calendarDates = useMemo(() => calendarMonthDates(month), [month]);
  const calendarMonthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const [calendarYear, calendarMonth] = month.split("-");
  const calendarYears = useMemo(() => {
    const currentYear = Number(todayIST().slice(0, 4));
    const selectedYear = Number(calendarYear);
    const employmentYears = employees.map((employee) => Number(employee.attendanceStartDate.slice(0, 4))).filter(Number.isFinite);
    const firstYear = Math.min(currentYear, selectedYear, ...employmentYears);
    const lastYear = Math.max(currentYear, selectedYear);
    return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => String(lastYear - index));
  }, [calendarYear, employees]);

  const openForm = (employeeId: number, date = todayIST()) => {
    const existing = attendance.find((row) => row.employeeId === employeeId && row.date === date);
    setForm({ employeeId, startDate: date, endDate: date, status: existing?.status || "full_day_leave", comment: existing?.comment || "" });
  };

  const saveAttendance = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await call({ action: "setAttendance", ...form });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Could not save attendance");
      showSuccess(data.changed ? `Updated ${data.changed} day${data.changed === 1 ? "" : "s"}` : "No changes needed");
      setForm(null); await load();
    } catch { showError("Network error saving attendance"); } finally { setSaving(false); }
  };

  const savePolicy = async () => {
    setSaving(true);
    try {
      const res = await call({ action: "savePolicy", employeeId: policyEmployeeId || null, effectiveMonth: policy.effectiveMonth, monthlyCreditUnits: policy.monthlyCreditUnits, carryCapUnits: policy.carryCapUnits });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Could not save leave policy");
      showSuccess("Leave policy saved"); await load();
    } finally { setSaving(false); }
  };

  const exportCsv = () => {
    const header = ["Employee", "Role", "Full days", "Half days", "Paid leave", "Unpaid leave", "Closing balance", "Gross", "Deduction", "Net payable", "Paid", "Adjustment"];
    const rows = employees.map((employee) => {
      const summary = summaries.find((item) => item.employeeId === employee.id);
      return [employee.name, employee.role, summary?.fullDayLeave || 0, summary?.halfDayLeave || 0, days(summary?.paidLeaveUnits || 0), days(summary?.unpaidLeaveUnits || 0), days(summary?.closingLeaveUnits || 0), (summary?.grossAmount || 0) / 100, (summary?.attendanceDeduction || 0) / 100, (summary?.netPayable || 0) / 100, (summary?.salaryPaid || 0) / 100, (summary?.adjustmentDue || 0) / 100];
    });
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `attendance-${month}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  if (loading) return <AdminLoading message="Loading attendance..." />;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-display text-lg font-bold text-brand-green-dark">Staff Attendance</h3><p className="text-xs text-brand-green-dark/50">Every calendar day is a working day. Staff are present unless marked otherwise.</p></div>
      <div className="flex gap-2"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-40" /><Button variant="outline" size="sm" onClick={exportCsv}><DownloadIcon className="h-4 w-4" /> CSV</Button></div>
    </div>

    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <div className="flex items-center gap-2"><SettingsIcon className="h-4 w-4 text-brand-green" /><h4 className="text-sm font-semibold">Paid leave policy</h4></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-xs">Applies to<select value={policyEmployeeId} onChange={(e) => { const value = e.target.value; setPolicyEmployeeId(value); const selected = policies.filter((item) => String(item.employeeId ?? "") === value && item.effectiveMonth <= month).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0]; if (selected) setPolicy({ monthlyCreditUnits: selected.monthlyCreditUnits, carryCapUnits: selected.carryCapUnits, effectiveMonth: selected.effectiveMonth }); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">All employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
        <label className="text-xs">Effective month<Input type="month" value={policy.effectiveMonth} onChange={(e) => setPolicy({ ...policy, effectiveMonth: e.target.value })} className="mt-1 h-8" /></label>
        <label className="text-xs">Monthly paid leave<Input type="number" min="0" step="0.5" value={policy.monthlyCreditUnits / 2} onChange={(e) => setPolicy({ ...policy, monthlyCreditUnits: Math.round(Number(e.target.value) * 2) })} className="mt-1 h-8" /></label>
        <label className="text-xs">Carry-forward cap<Input type="number" min="0" step="0.5" value={policy.carryCapUnits / 2} onChange={(e) => setPolicy({ ...policy, carryCapUnits: Math.round(Number(e.target.value) * 2) })} className="mt-1 h-8" /></label>
        <Button size="sm" className="mt-auto" disabled={saving} onClick={savePolicy}>Save policy</Button>
      </div>
    </div>

    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <div className="flex items-center gap-2"><CalendarDaysIcon className="h-4 w-4 text-brand-green" /><h4 className="text-sm font-semibold">Today · {todayIST()}</h4></div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {employees.filter((employee) => employee.isActive).map((employee) => {
          const row = todayRows.get(employee.id); const label = statusLabel(row?.status || "present");
          return <button key={employee.id} type="button" onClick={() => openForm(employee.id)} className="flex items-center justify-between rounded-lg border border-brand-mist p-3 text-left hover:bg-brand-sand/50">
            <span><span className="block text-sm font-medium">{employee.name}</span><span className="text-[11px] text-muted-foreground">{employee.role || "Staff"}{row?.comment ? ` · ${row.comment}` : ""}</span></span>
            <span className={`rounded px-2 py-1 text-xs font-medium ${row && row.status !== "present" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{label}</span>
          </button>;
        })}
      </div>
    </div>

    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><CalendarDaysIcon className="h-4 w-4 text-brand-green" /><h4 className="text-sm font-semibold">Monthly attendance · {calendarMonthLabel}</h4></div>
          {calendarEmployee && <p className="mt-1 text-xs text-muted-foreground">{calendarEmployee.name} · {calendarEmployee.role || "Staff"}</p>}
          {!canManageAttendance && <p className="mt-1 text-[11px] text-muted-foreground">Calendar editing requires the Manage staff attendance permission.</p>}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-[9rem_7rem_16rem]">
          <label className="text-xs">Month
            <select value={calendarMonth} onChange={(e) => setMonth(`${calendarYear}-${e.target.value}`)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">
              {MONTHS.map((label, index) => <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs">Year
            <select value={calendarYear} onChange={(e) => setMonth(`${e.target.value}-${calendarMonth}`)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">
              {calendarYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="col-span-2 text-xs sm:col-auto">Employee
            <select value={calendarEmployeeId} onChange={(e) => setCalendarEmployeeId(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{!employee.isActive ? " (Inactive)" : ""}</option>)}
            </select>
          </label>
        </div>
      </div>

      {calendarEmployee ? <div className="mt-4 overflow-hidden sm:overflow-x-auto">
        <div className="min-w-0 sm:min-w-[700px]">
          <div className="mb-1.5 grid grid-cols-7 gap-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-muted-foreground sm:mb-2 sm:gap-1 sm:text-[10px]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDates.map((date, index) => {
              if (!date) return <div key={`empty-${index}`} className="min-h-16 rounded-md bg-brand-sand/20 sm:min-h-24 sm:rounded-lg" />;
              const row = calendarRows.get(date);
              const outsideEmployment = date < calendarEmployee.attendanceStartDate || (!!calendarEmployee.employmentEndDate && date > calendarEmployee.employmentEndDate);
              const upcoming = date > todayIST();
              const label = outsideEmployment ? "Not employed" : row ? statusLabel(row.status) : upcoming ? "Upcoming" : "Present";
              const mobileLabel = outsideEmployment ? "N/A" : row?.status === "full_day_leave" ? "Full" : row?.status === "half_day_leave" ? "Half" : upcoming ? "Upcoming" : "Present";
              const color = outsideEmployment
                ? "border-brand-mist bg-brand-sand/30 text-muted-foreground"
                : row?.status === "full_day_leave"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  : row?.status === "half_day_leave"
                    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                    : upcoming
                      ? "border-brand-mist bg-brand-sand/30 text-muted-foreground"
                      : "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300";
              const editable = canManageAttendance && !outsideEmployment;
              return <button key={date} type="button" disabled={!editable} onClick={() => openForm(calendarEmployee.id, date)} className={`min-h-16 min-w-0 rounded-md border p-1 text-left sm:min-h-24 sm:rounded-lg sm:p-2 ${color} ${editable ? "transition-colors hover:ring-2 hover:ring-brand-green/30" : "cursor-default"}`}>
                <span className="block text-[10px] font-semibold sm:text-xs">{Number(date.slice(-2))}</span>
                <span className="mt-1 block truncate text-[8px] font-medium sm:hidden">{mobileLabel}</span>
                <span className="mt-2 hidden text-[11px] font-medium sm:block">{label}</span>
                {row?.comment && !outsideEmployment ? <span className="mt-1 hidden truncate text-[10px] opacity-75 sm:block" title={row.comment}>{row.comment}</span> : null}
              </button>;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:text-[11px]">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-green-200" />Present</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-200" />Half<span className="hidden sm:inline"> Day</span></span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-200" />Full<span className="hidden sm:inline"> Day</span></span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand-mist" /><span className="sm:hidden">Upcoming</span><span className="hidden sm:inline">Upcoming / Not employed</span></span>
          </div>
        </div>
      </div> : <p className="mt-4 text-sm text-muted-foreground">No employees found for this month.</p>}
    </div>

    <div className="overflow-x-auto rounded-xl border border-brand-mist bg-white dark:bg-card">
      <table className="w-full min-w-[950px] text-left text-xs"><thead className="bg-brand-sand/60"><tr>{["Employee", "Leave", "Paid", "Unpaid", "Balance", "Gross", "Deduction", "Net payable", "Paid / Adjustment", ""].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
        <tbody>{employees.map((employee) => { const summary = summaries.find((item) => item.employeeId === employee.id); return <tr key={employee.id} className="border-t border-brand-mist">
          <td className="px-3 py-3"><span className="font-medium">{employee.name}</span><span className="block text-[10px] text-muted-foreground">{employee.role || "Staff"}{!employee.isActive ? " · Inactive" : ""}</span></td>
          <td className="px-3 py-3">{summary?.fullDayLeave || 0} full · {summary?.halfDayLeave || 0} half</td><td className="px-3 py-3">{days(summary?.paidLeaveUnits || 0)}d</td><td className="px-3 py-3 text-red-600">{days(summary?.unpaidLeaveUnits || 0)}d</td><td className="px-3 py-3">{days(summary?.closingLeaveUnits || 0)}d</td>
          <td className="px-3 py-3">{money(summary?.grossAmount || 0)}</td><td className="px-3 py-3 text-red-600">-{money(summary?.attendanceDeduction || 0)}</td><td className="px-3 py-3 font-semibold">{money(summary?.netPayable || 0)}{summary?.isProjected ? <span className="block text-[9px] font-normal text-amber-600">Projected</span> : null}</td>
          <td className="px-3 py-3">{money(summary?.salaryPaid || 0)}<span className={`block text-[10px] ${(summary?.adjustmentDue || 0) < 0 ? "text-red-600" : "text-green-700"}`}>{(summary?.adjustmentDue || 0) < 0 ? `${money(Math.abs(summary?.adjustmentDue || 0))} recoverable` : `${money(summary?.adjustmentDue || 0)} due`}</span></td>
          <td className="px-3 py-3"><Button size="sm" variant="outline" onClick={() => openForm(employee.id, `${month}-01`)}>Mark leave</Button></td>
        </tr>; })}</tbody></table>
    </div>

    {role !== "admin" && <details className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card"><summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><HistoryIcon className="h-4 w-4" /> Attendance audit ({history.length})</summary><div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{history.map((item) => <div key={item.id} className="rounded-lg bg-brand-sand/50 p-2 text-xs"><span className="font-medium">{item.employeeName}</span> · {item.date}: {statusLabel(item.oldStatus)} → {statusLabel(item.newStatus)}<span className="block text-[10px] text-muted-foreground">{item.performedBy} · {new Date(item.performedAt).toLocaleString("en-IN")}{item.newComment ? ` · ${item.newComment}` : ""}</span></div>)}</div></details>}

    {form && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:items-center"><div className="max-h-[min(90dvh,100%)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl dark:bg-card"><h4 className="font-display text-lg font-bold">Mark attendance</h4><div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="text-xs">Date range</label><DateRangePicker presentation="inline" variant="admin" minNights={0} startDate={form.startDate} endDate={form.endDate} onChange={({ startDate, endDate }) => setForm({ ...form, startDate, endDate })} /></div>
      <label className="text-xs sm:col-span-2">Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="full_day_leave">Full-day leave</option><option value="half_day_leave">Half-day leave</option><option value="present">Present / correct attendance</option></select></label>
      <label className="text-xs sm:col-span-2">Comment (optional)<Input value={form.comment} maxLength={500} onChange={(e) => setForm({ ...form, comment: e.target.value })} className="mt-1" placeholder="Reason or note" /></label>
    </div><div className="mt-5 flex gap-2"><Button onClick={saveAttendance} disabled={saving}>{saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />} Save</Button><Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</Button></div></div></div>}
  </div>;
}
