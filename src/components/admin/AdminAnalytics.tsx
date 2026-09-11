"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3Icon, BedDoubleIcon, CalendarDaysIcon, DownloadIcon, IndianRupeeIcon, RefreshCwIcon, UtensilsIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLoading } from "./AdminLoading";
import type { Role } from "./types";
import { todayIST } from "@/lib/utils";

type TrendRow = {
  date: string; bookings: number; arrivals: number; guests: number; stayRevenue: number; foodOrders: number; foodRevenue: number; expenses: number;
  occupiedBedNights: number; availableBedNights: number; occupancy: number | null;
};
type AnalyticsData = {
  range: { fromDate: string; toDate: string; days: number; timezone: string };
  summary: {
    bookings: number; plannedStays: number; actualCheckIns: number; actualCheckOuts: number; guests: number; cancellations: number; noShows: number;
    bookedStayValue: number; foodRevenue: number; totalRevenue: number; expenses: number; activityBalance: number; foodOrders: number; foodPaid: number; foodPending: number;
    occupiedBedNights: number | null; availableBedNights: number | null; occupancy: number | null; adr: number; revpar: number; averageStayLength: number; averageLeadDays: number;
  };
  trend: TrendRow[];
  bookings: {
    byHour: { hour: number; count: number }[]; byWeekday: { weekday: number; count: number }[]; byWeekdayHour: { weekday: number; hour: number; count: number }[]; stayByWeekday: { weekday: number; count: number }[];
    byChannel: { channel: string; count: number; revenue: number; guests: number }[]; byPayment: { payment: string; count: number; value: number }[];
    byBookingWindow: { bucket: string; count: number }[]; checkInsByHour: { hour: number; count: number }[]; checkOutsByHour: { hour: number; count: number }[];
  };
  stays: { byRoomType: { roomType: string; stays: number; guests: number; revenue: number }[] };
  occupancy: { totalBeds: number; blockedBedNights: number; byDate: { date: string; occupiedBeds: number; availableBeds: number; occupancy: number | null }[] };
  food: {
    byHour: { hour: number; orders: number; revenue: number }[]; topItems: { item: string; quantity: number; revenue: number }[];
    byCategory: { category: string; quantity: number; revenue: number }[]; byGuestType: { guestType: string; orders: number; revenue: number }[];
    byPaymentMethod: { paymentMethod: string; orders: number; revenue: number }[];
  };
  finance: { byCategory: { category: string; count: number; total: number }[]; byMonth: { month: string; count: number; total: number }[] };
  dataQuality: { occupancy: boolean; actualFoodPrepTimes: boolean; otaCommission: boolean; expenseBusinessDate: boolean };
  definitions: Record<string, string>;
};

type TrendMetric = "bookings" | "arrivals" | "stayRevenue" | "foodRevenue" | "expenses" | "occupancy";
const money = (value: number | null | undefined) => `₹${Math.round((value || 0) / 100).toLocaleString("en-IN")}`;
const stayMoney = (value: number | null | undefined) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const percent = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
const formatHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const formatMonth = (value: string) => new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const share = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Panel({ title, subtitle, icon, children, className = "" }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none sm:p-5 ${className}`}>
    <div className="mb-4 flex items-start gap-2.5">{icon && <span className="mt-0.5 text-brand-green">{icon}</span>}<div><h3 className="font-display font-bold text-brand-green-dark dark:text-zinc-100">{title}</h3>{subtitle && <p className="mt-1 text-[11px] leading-4 text-brand-green-dark/50 dark:text-zinc-400">{subtitle}</p>}</div></div>
    {children}
  </section>;
}

function MetricCard({ label, value, note, tone = "green" }: { label: string; value: string; note?: string; tone?: "green" | "blue" | "amber" | "rose" }) {
  const tones = { green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300", amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" };
  return <div className="rounded-2xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><div className="text-[11px] font-medium uppercase tracking-wide text-brand-green-dark/50">{label}</div><div className="mt-2 text-2xl font-bold text-brand-green-dark dark:text-zinc-100">{value}</div>{note && <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>{note}</div>}</div>;
}

function UnifiedTrendChart({ rows, metric }: { rows: TrendRow[]; metric: TrendMetric }) {
  const config: Record<TrendMetric, { label: string; color: string; currency?: "paise" | "rupees"; get: (row: TrendRow) => number }> = {
    bookings: { label: "Bookings received", color: "#2f6b4f", get: (row) => row.bookings },
    arrivals: { label: "Arrivals", color: "#4f83cc", get: (row) => row.arrivals },
    stayRevenue: { label: "Booked stay value", color: "#287c63", currency: "rupees", get: (row) => row.stayRevenue },
    foodRevenue: { label: "Food sales", color: "#d88919", currency: "paise", get: (row) => row.foodRevenue },
    expenses: { label: "Expenses", color: "#c65353", currency: "paise", get: (row) => row.expenses },
    occupancy: { label: "Bed occupancy", color: "#7659a8", get: (row) => row.occupancy || 0 },
  };
  const selected = config[metric];
  const width = 760;
  const height = 250;
  const padding = { top: 18, right: 16, bottom: 30, left: 42 };
  const points = rows.map((row, index) => ({ row, index, value: selected.get(row) }));
  const max = Math.max(1, ...points.map((point) => point.value));
  const x = (index: number) => padding.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (width - padding.left - padding.right));
  const y = (value: number) => height - padding.bottom - (value / max) * (height - padding.top - padding.bottom);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const formatValue = (value: number) => selected.currency === "rupees" ? stayMoney(value) : selected.currency === "paise" ? money(value) : metric === "occupancy" ? `${value.toFixed(1)}%` : value.toLocaleString("en-IN");
  return <div>
    <div className="mb-3 flex items-center justify-between text-xs"><span className="font-medium text-brand-green-dark/70">{selected.label}</span><span className="text-brand-green-dark/45">{selected.currency ? "₹" : metric === "occupancy" ? "%" : "count"}</span></div>
    <div className="max-w-full overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="h-64 min-w-[620px] w-full" role="img" aria-label={`${selected.label} trend`}>
      {ticks.map((tick) => <g key={tick}><line x1={padding.left} x2={width - padding.right} y1={y(max * tick)} y2={y(max * tick)} stroke="currentColor" className="text-brand-mist" strokeDasharray="3 4" /><text x={padding.left - 8} y={y(max * tick) + 4} textAnchor="end" className="fill-brand-green-dark/45 text-[10px]">{formatValue(max * tick)}</text></g>)}
      <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="currentColor" className="text-brand-mist" />
      {path && <path d={path} fill="none" stroke={selected.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {points.map((point) => <g key={point.row.date}><circle cx={x(point.index)} cy={y(point.value)} r="4" fill="white" stroke={selected.color} strokeWidth="2"><title>{`${point.row.date}: ${formatValue(point.value)}`}</title></circle></g>)}
      {points.filter((_, index) => index === 0 || index === Math.floor((points.length - 1) / 2) || index === points.length - 1).map((point) => <text key={`label-${point.row.date}`} x={x(point.index)} y={height - 8} textAnchor="middle" className="fill-brand-green-dark/50 text-[10px]">{formatDate(point.row.date)}</text>)}
    </svg></div>
  </div>;
}

function Heatmap({ bookingWeekdays, bookingWeekdayHours }: { bookingWeekdays: { weekday: number; count: number }[]; bookingWeekdayHours: { weekday: number; hour: number; count: number }[] }) {
  const max = Math.max(1, ...bookingWeekdayHours.map((row) => row.count));
  const weekdayTotal = new Map(bookingWeekdays.map((row) => [row.weekday, row.count]));
  const counts = new Map(bookingWeekdayHours.map((row) => [`${row.weekday}-${row.hour}`, row.count]));
  return <div className="max-w-full overflow-x-auto"><div className="min-w-[700px]">
    <div className="mb-1 grid grid-cols-[50px_repeat(12,minmax(0,1fr))] gap-1 pl-0 text-[9px] text-brand-green-dark/45"><span />{[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((hour) => <span key={hour} className="text-center">{formatHour(hour)}</span>)}</div>
    {weekdayLabels.map((label, weekday) => <div key={label} className="mb-1 grid grid-cols-[50px_repeat(12,minmax(0,1fr))] items-center gap-1"><span className="text-xs font-medium text-brand-green-dark/65">{label}</span>{Array.from({ length: 12 }, (_, slot) => { const hour = slot * 2; const count = counts.get(`${weekday}-${hour}`) || 0; const intensity = count / max; return <span key={hour} title={`${label} ${formatHour(hour)}: ${count} bookings`} className="h-6 rounded-md border border-brand-mist/60" style={{ backgroundColor: `color-mix(in srgb, #2f6b4f ${Math.round(intensity * 85)}%, white)` }} />; })}</div>)}
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-brand-green-dark/50">{weekdayLabels.map((label, weekday) => <span key={label}><b className="text-brand-green-dark">{label}</b> {weekdayTotal.get(weekday) || 0}</span>)}</div>
  </div></div>;
}

function HourBars({ rows, color }: { rows: { hour: number; count: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div className="max-w-full overflow-x-auto"><div className="grid min-w-[360px] grid-cols-[repeat(24,minmax(0,1fr))] gap-x-1.5">{Array.from({ length: 24 }, (_, hour) => { const count = rows.find((row) => row.hour === hour)?.count || 0; return <div key={hour} className="group min-w-0 text-center" title={`${formatHour(hour)}: ${count}`}><div className="flex h-28 items-end"><div className="w-full rounded-t" style={{ height: `${Math.max(count ? 4 : 1, (count / max) * 100)}%`, backgroundColor: color }} /></div><span className="mt-1 block text-[9px] text-brand-green-dark/50">{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span></div>; })}</div></div>;
}

function RankedRows({ rows, total, moneyValue = false, secondaryCurrency = "paise" }: { rows: { label: string; value: number; secondary?: number }[]; total: number; moneyValue?: boolean; secondaryCurrency?: "paise" | "rupees" }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <div className="space-y-3">{rows.length === 0 ? <p className="text-sm text-brand-green-dark/45">No data for this range.</p> : rows.map((row, index) => <div key={`${row.label}-${index}`}><div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-brand-green-dark/75">{row.label}</span><span className="shrink-0 font-semibold text-brand-green-dark">{row.secondary !== undefined && <span className="mr-2 font-normal text-brand-green-dark/55">{secondaryCurrency === "rupees" ? stayMoney(row.secondary) : money(row.secondary)}</span>}{moneyValue ? money(row.value) : row.value.toLocaleString("en-IN")} <span className="ml-1 font-normal text-brand-green-dark/45">{share(row.value, total)}</span></span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-sand"><div className="h-full rounded-full bg-brand-green" style={{ width: `${(row.value / max) * 100}%` }} /></div></div>)}</div>;
}

export function AdminAnalytics({ password, username }: { password: string; username?: string; role: Role; permissions: Record<string, boolean> }) {
  const today = todayIST();
  const initialFromDate = `${today.slice(0, 8)}01`;
  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(today);
  const [draftFromDate, setDraftFromDate] = useState(initialFromDate);
  const [draftToDate, setDraftToDate] = useState(today);
  const [metric, setMetric] = useState<TrendMetric>("bookings");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, fromDate, toDate }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to load analytics");
      setData(body);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load analytics"); }
    finally { setLoading(false); }
  }, [fromDate, password, toDate, username]);
  useEffect(() => { void load(); }, [load]);

  const setPreset = (days: number) => {
    const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - days + 1);
    const value = start.toISOString().slice(0, 10); setDraftFromDate(value); setDraftToDate(today); setFromDate(value); setToDate(today);
  };
  const exportData = () => {
    if (!data) return;
    const rows: string[][] = [["Section", "Metric", "Value", "Secondary value"]];
    const add = (section: string, values: (string | number | null | undefined)[]) => rows.push([section, ...values.map((value) => String(value ?? ""))]);
    Object.entries(data.summary).forEach(([key, value]) => add("Summary", [key, value]));
    data.trend.forEach((row) => add("Unified daily trend", [row.date, row.bookings, row.arrivals, row.stayRevenue, row.foodRevenue, row.expenses, row.occupancy]));
    data.bookings.byChannel.forEach((row) => add("Booking channel", [row.channel, row.count, row.revenue, row.guests]));
    data.bookings.byPayment.forEach((row) => add("Booking payment", [row.payment, row.count, row.value]));
    data.bookings.byBookingWindow.forEach((row) => add("Booking window", [row.bucket, row.count]));
    data.food.topItems.forEach((row) => add("Food item", [row.item, row.quantity, row.revenue]));
    data.food.byCategory.forEach((row) => add("Food category", [row.category, row.quantity, row.revenue]));
    data.finance.byCategory.forEach((row) => add("Expense category", [row.category, row.total, row.count]));
    data.finance.byMonth.forEach((row) => add("Expense month", [row.month, row.total, row.count]));
    const blob = new Blob([rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `goko-analytics-${fromDate}-${toDate}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  if (loading && !data) return <AdminLoading message="Loading management analytics..." />;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error || "Unable to load analytics"}<Button className="ml-3" size="sm" onClick={load}>Retry</Button></div>;
  const s = data.summary;
  const nonCancelledBookings = data.bookings.byChannel.reduce((sum, row) => sum + row.count, 0);
  const nonCancelledFoodOrders = data.food.byGuestType.reduce((sum, row) => sum + row.orders, 0);
  const peakBookingHour = data.bookings.byHour.reduce((peak, row) => row.count > peak.count ? row : peak, { hour: 0, count: 0 });
  const peakCheckIn = data.bookings.checkInsByHour.reduce((peak, row) => row.count > peak.count ? row : peak, { hour: 0, count: 0 });
  const peakCheckOut = data.bookings.checkOutsByHour.reduce((peak, row) => row.count > peak.count ? row : peak, { hour: 0, count: 0 });
  const trendMetrics: { id: TrendMetric; label: string }[] = [{ id: "bookings", label: "Bookings" }, { id: "arrivals", label: "Arrivals" }, { id: "stayRevenue", label: "Stay value" }, { id: "foodRevenue", label: "Food sales" }, { id: "expenses", label: "Expenses" }, { id: "occupancy", label: "Occupancy" }];
  const paymentRows = data.bookings.byPayment.map((row) => ({ label: titleCase(row.payment), value: row.count, secondary: row.value }));
  const channelRows = data.bookings.byChannel.map((row) => ({ label: titleCase(row.channel), value: row.count, secondary: row.revenue }));
  const topItems = data.food.topItems.map((row) => ({ label: row.item, value: row.quantity, secondary: row.revenue }));
  const expenseRows = data.finance.byCategory.map((row) => ({ label: titleCase(row.category), value: row.total }));

  return <div className="min-w-0 space-y-6">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-green/70">Management</p><h2 className="mt-1 font-display text-2xl font-bold text-brand-green md:text-3xl">Business analytics</h2><p className="mt-1 max-w-2xl text-sm text-brand-green-dark/55">One operating view for demand, bed utilisation, guest movement, food sales, channels, payments, and expenses.</p></div>
      <div className="flex w-full max-w-full flex-wrap items-end gap-2 xl:w-auto"><div className="flex shrink-0 rounded-lg border border-brand-mist bg-white p-1 dark:bg-card">{[[7, "7D"], [30, "30D"], [90, "90D"]].map(([days, label]) => <button key={label} type="button" onClick={() => setPreset(Number(days))} className="rounded-md px-2.5 py-1.5 text-[11px] font-medium text-brand-green-dark/60 hover:bg-brand-green/10 hover:text-brand-green">{label}</button>)}</div><label className="min-w-[130px] flex-1 text-[11px] text-brand-green-dark/60 sm:flex-none">From<Input type="date" value={draftFromDate} onChange={(event) => setDraftFromDate(event.target.value)} className="mt-1 w-full text-xs sm:w-36" /></label><label className="min-w-[130px] flex-1 text-[11px] text-brand-green-dark/60 sm:flex-none">To<Input type="date" value={draftToDate} onChange={(event) => setDraftToDate(event.target.value)} className="mt-1 w-full text-xs sm:w-36" /></label><Button className="flex-1 sm:flex-none" size="sm" onClick={() => { setFromDate(draftFromDate); setToDate(draftToDate); }} disabled={loading}><RefreshCwIcon className="mr-1 h-3.5 w-3.5" />{loading ? "Loading" : "Apply"}</Button><Button className="flex-1 sm:flex-none" size="sm" variant="outline" onClick={exportData}><DownloadIcon className="mr-1 h-3.5 w-3.5" />Export</Button></div>
    </div>
    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>}
    <div className="rounded-xl border border-brand-green/15 bg-brand-green/[0.04] px-4 py-3 text-xs leading-5 text-brand-green-dark/65"><b className="text-brand-green-dark">Two date lenses:</b> bookings, food orders, and expenses use their recorded time in {data.range.timezone}; stay/occupancy metrics use check-in dates. Selected range: <b>{data.range.fromDate}</b> to <b>{data.range.toDate}</b> ({data.range.days} days).</div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><MetricCard label="Bookings received" value={s.bookings.toLocaleString("en-IN")} note={`${s.cancellations} cancelled · ${s.noShows} no-show`} tone="blue" /><MetricCard label="Bed occupancy" value={percent(s.occupancy)} note={`${s.occupiedBedNights ?? "—"} / ${s.availableBedNights ?? "—"} bed-nights`} /><MetricCard label="ADR" value={money(s.adr)} note={`${s.averageStayLength.toFixed(1)} nights average`} tone="blue" /><MetricCard label="RevPAR" value={money(s.revpar)} note="Booked value / available bed" tone="blue" /><MetricCard label="Food sales" value={money(s.foodRevenue)} note={`${s.foodOrders} orders · ${money(s.foodPending)} unpaid`} tone="amber" /><MetricCard label="Recorded expenses" value={money(s.expenses)} note={`${data.finance.byCategory.length} categories`} tone="rose" /></div>
    <Panel title="Unified operating trend" subtitle="Switch the measure without changing the selected date range. Hover points for exact values." icon={<BarChart3Icon className="h-5 w-5" />}>
      <div className="mb-5 flex flex-wrap gap-1.5">{trendMetrics.map((item) => <button key={item.id} type="button" onClick={() => setMetric(item.id)} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${metric === item.id ? "bg-brand-green text-white" : "bg-brand-sand/60 text-brand-green-dark/65 hover:bg-brand-green/10"}`}>{item.label}</button>)}</div>
      <UnifiedTrendChart rows={data.trend} metric={metric} />
      <div className="mt-4 grid gap-2 border-t border-brand-mist pt-4 text-xs text-brand-green-dark/60 sm:grid-cols-4"><span><b className="text-brand-green-dark">Total activity value</b><br />{money(s.totalRevenue)}</span><span><b className="text-brand-green-dark">Activity balance</b><br />{money(s.activityBalance)} <em className="not-italic text-[10px]">(not profit)</em></span><span><b className="text-brand-green-dark">Actual check-ins</b><br />{s.actualCheckIns}</span><span><b className="text-brand-green-dark">Actual checkouts</b><br />{s.actualCheckOuts}</span></div>
    </Panel>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="When bookings arrive" subtitle="Booking creation weekday and time in Asia/Kolkata. The darker cells show the busiest two-hour windows." icon={<CalendarDaysIcon className="h-5 w-5" />}><Heatmap bookingWeekdays={data.bookings.byWeekday} bookingWeekdayHours={data.bookings.byWeekdayHour} /><div className="mt-5 grid gap-3 border-t border-brand-mist pt-4 sm:grid-cols-2"><div><div className="text-[11px] uppercase tracking-wide text-brand-green-dark/45">Peak booking hour</div><div className="mt-1 font-semibold text-brand-green-dark">{formatHour(peakBookingHour.hour)}</div><div className="text-xs text-brand-green-dark/50">{peakBookingHour.count} bookings received</div></div><div><div className="text-[11px] uppercase tracking-wide text-brand-green-dark/45">Busiest arrival weekday</div><div className="mt-1 font-semibold text-brand-green-dark">{weekdayLabels[data.bookings.stayByWeekday.reduce((peak, row) => row.count > peak.count ? row : peak, { weekday: 0, count: 0 }).weekday]}</div><div className="text-xs text-brand-green-dark/50">Based on planned stays</div></div></div></Panel>
      <Panel title="Guest movement times" subtitle="Actual timestamps recorded at check-in and checkout, not planned arrival dates." icon={<UsersIcon className="h-5 w-5" />}><div className="mb-3 flex items-center justify-between text-xs text-brand-green-dark/55"><span>Check-ins</span><span className="font-medium text-brand-green">Peak {formatHour(peakCheckIn.hour)}</span></div><HourBars rows={data.bookings.checkInsByHour} color="#4f83cc" /><div className="my-5 border-t border-brand-mist" /><div className="mb-3 flex items-center justify-between text-xs text-brand-green-dark/55"><span>Checkouts</span><span className="font-medium text-brand-green">Peak {formatHour(peakCheckOut.hour)}</span></div><HourBars rows={data.bookings.checkOutsByHour} color="#7659a8" /></Panel>
    </div>
    <div className="grid gap-5 xl:grid-cols-3">
      <Panel title="Booking window" subtitle="How far in advance guests book. Useful for pricing and staffing decisions." icon={<CalendarDaysIcon className="h-5 w-5" />}><RankedRows rows={data.bookings.byBookingWindow.map((row) => ({ label: row.bucket, value: row.count }))} total={nonCancelledBookings} /></Panel>
      <Panel title="Channels / endpoints" subtitle="Booking volume, share, guests, and booked value by Booking.com, MMT, website, walk-in, and other sources." icon={<BarChart3Icon className="h-5 w-5" />}><RankedRows rows={channelRows} total={nonCancelledBookings} secondaryCurrency="rupees" /></Panel>
      <Panel title="Prepaid vs postpaid" subtitle="Cancelled bookings excluded. Partial and unknown stay visible so payment data gaps are not hidden." icon={<IndianRupeeIcon className="h-5 w-5" />}><RankedRows rows={paymentRows} total={nonCancelledBookings} secondaryCurrency="rupees" /></Panel>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Stay mix and room types" subtitle="Planned confirmed/completed stays whose check-in date falls in the selected range." icon={<BedDoubleIcon className="h-5 w-5" />}><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-brand-sand/60 p-3"><div className="text-[11px] text-brand-green-dark/50">Planned stays</div><div className="mt-1 text-xl font-bold text-brand-green-dark">{s.plannedStays}</div></div><div className="rounded-xl bg-brand-sand/60 p-3"><div className="text-[11px] text-brand-green-dark/50">Guests</div><div className="mt-1 text-xl font-bold text-brand-green-dark">{s.guests}</div></div><div className="rounded-xl bg-brand-sand/60 p-3"><div className="text-[11px] text-brand-green-dark/50">Average lead</div><div className="mt-1 text-xl font-bold text-brand-green-dark">{s.averageLeadDays.toFixed(1)}d</div></div></div><div className="mt-5"><RankedRows rows={data.stays.byRoomType.map((row) => ({ label: titleCase(row.roomType), value: row.stays, secondary: row.revenue }))} total={s.plannedStays} secondaryCurrency="rupees" /></div></Panel>
      <Panel title="Bed inventory and utilisation" subtitle="Historical occupancy from assigned bed-nights. Active blocks and permanently blocked beds are excluded from sellable capacity." icon={<BedDoubleIcon className="h-5 w-5" />}><div className="grid gap-3 sm:grid-cols-3"><div><div className="text-[11px] text-brand-green-dark/50">Sellable beds</div><div className="mt-1 text-xl font-bold text-brand-green-dark">{data.occupancy.totalBeds || "—"}</div></div><div><div className="text-[11px] text-brand-green-dark/50">Occupied bed-nights</div><div className="mt-1 text-xl font-bold text-brand-green-dark">{s.occupiedBedNights ?? "—"}</div></div><div><div className="text-[11px] text-brand-green-dark/50">Blocked bed-nights</div><div className="mt-1 text-xl font-bold text-brand-green-dark">{data.occupancy.blockedBedNights}</div></div></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead className="border-b border-brand-mist text-brand-green-dark/50"><tr><th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Occupied</th><th className="pb-2 font-medium">Available</th><th className="pb-2 text-right font-medium">Occupancy</th></tr></thead><tbody>{data.occupancy.byDate.filter((_, index) => data.occupancy.byDate.length <= 31 || index % Math.ceil(data.occupancy.byDate.length / 15) === 0).map((row) => <tr key={row.date} className="border-b border-brand-mist/60 last:border-0"><td className="py-2 text-brand-green-dark/70">{formatDate(row.date)}</td><td className="py-2">{row.occupiedBeds}</td><td className="py-2">{row.availableBeds}</td><td className="py-2 text-right font-semibold text-brand-green">{percent(row.occupancy)}</td></tr>)}</tbody></table></div></Panel>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Food orders: timing and mix" subtitle="Order volume by hour plus guest type, payment method, and menu category." icon={<UtensilsIcon className="h-5 w-5" />}><div className="mb-4 text-xs text-brand-green-dark/55">{nonCancelledFoodOrders} non-cancelled orders · {money(s.foodRevenue)} sales</div><HourBars rows={data.food.byHour.map((row) => ({ hour: row.hour, count: row.orders }))} color="#d88919" /><div className="mt-5 grid gap-5 border-t border-brand-mist pt-4 sm:grid-cols-2 lg:grid-cols-3"><div><div className="mb-3 text-xs font-semibold text-brand-green-dark">Guest type</div><RankedRows rows={data.food.byGuestType.map((row) => ({ label: titleCase(row.guestType), value: row.orders }))} total={nonCancelledFoodOrders} /></div><div><div className="mb-3 text-xs font-semibold text-brand-green-dark">Payment method</div><RankedRows rows={data.food.byPaymentMethod.map((row) => ({ label: titleCase(row.paymentMethod), value: row.orders }))} total={nonCancelledFoodOrders} /></div><div><div className="mb-3 text-xs font-semibold text-brand-green-dark">Category sales</div><RankedRows rows={data.food.byCategory.map((row) => ({ label: titleCase(row.category), value: row.revenue }))} total={s.foodRevenue} moneyValue /></div></div></Panel>
      <Panel title="Top food items" subtitle="Items ranked by quantity sold, with revenue shown in the detail." icon={<UtensilsIcon className="h-5 w-5" />}><RankedRows rows={topItems} total={data.food.topItems.reduce((sum, row) => sum + row.quantity, 0)} /><div className="mt-5 overflow-x-auto border-t border-brand-mist pt-4"><table className="w-full min-w-[420px] text-left text-xs"><thead className="border-b border-brand-mist text-brand-green-dark/50"><tr><th className="pb-2 font-medium">Item</th><th className="pb-2 text-right font-medium">Qty</th><th className="pb-2 text-right font-medium">Sales</th></tr></thead><tbody>{data.food.topItems.slice(0, 10).map((row) => <tr key={row.item} className="border-b border-brand-mist/60 last:border-0"><td className="py-2 text-brand-green-dark/75">{row.item}</td><td className="py-2 text-right">{row.quantity}</td><td className="py-2 text-right font-semibold text-brand-green">{money(row.revenue)}</td></tr>)}</tbody></table></div></Panel>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Expenses by category" subtitle="Recorded expenses grouped by sub-category/category. Use this for cost control, not profit accounting." icon={<IndianRupeeIcon className="h-5 w-5" />}><RankedRows rows={expenseRows} total={s.expenses} moneyValue /><div className="mt-5 border-t border-brand-mist pt-4"><div className="mb-3 text-xs font-semibold text-brand-green-dark">Monthly expense trend</div><div className="overflow-x-auto"><div className="flex min-w-[360px] items-end gap-2" style={{ height: 130 }}>{data.finance.byMonth.map((row) => { const max = Math.max(1, ...data.finance.byMonth.map((item) => item.total)); return <div key={row.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${formatMonth(row.month)}: ${money(row.total)}`}><div className="w-full rounded-t bg-rose-400" style={{ height: `${Math.max(row.total ? 4 : 1, (row.total / max) * 100)}%` }} /><span className="max-w-full truncate text-[9px] text-brand-green-dark/50">{formatMonth(row.month)}</span></div>; })}</div></div></div></Panel>
      <Panel title="Management readout" subtitle="A compact decision layer for the selected period." icon={<BarChart3Icon className="h-5 w-5" />}><div className="space-y-3 text-sm text-brand-green-dark/70"><div className="flex items-center justify-between rounded-xl bg-brand-sand/60 px-3 py-3"><span>Non-cancelled booking share</span><b className="text-brand-green">{share(nonCancelledBookings, s.bookings)}</b></div><div className="flex items-center justify-between rounded-xl bg-brand-sand/60 px-3 py-3"><span>Food sales per order</span><b className="text-brand-green">{money(s.foodOrders ? s.foodRevenue / s.foodOrders : 0)}</b></div><div className="flex items-center justify-between rounded-xl bg-brand-sand/60 px-3 py-3"><span>Recorded cost per occupied bed-night</span><b className="text-brand-green">{money(s.occupiedBedNights ? s.expenses / s.occupiedBedNights : 0)}</b></div><div className="flex items-center justify-between rounded-xl bg-brand-sand/60 px-3 py-3"><span>Food paid collection rate</span><b className="text-brand-green">{share(s.foodPaid, s.foodRevenue)}</b></div></div><div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">Use Revenue, ADR, RevPAR, occupancy, booking window, pickup, channel mix, and cost categories together. This dashboard intentionally labels activity balance as an operational indicator—not cash, profit, or statutory accounting.</div></Panel>
    </div>
    <details className="rounded-xl border border-brand-mist bg-white px-4 py-3 text-xs text-brand-green-dark/60 dark:bg-card"><summary className="cursor-pointer font-semibold text-brand-green-dark">Definitions and data coverage</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(data.definitions).map(([key, value]) => <p key={key}><b className="text-brand-green-dark">{titleCase(key)}:</b> {value}</p>)}<p><b className="text-brand-green-dark">Coverage:</b> {data.dataQuality.occupancy ? "Occupancy is available from bed assignments." : "No bed inventory is configured."} Food preparation times, OTA commission, and expense service dates are not captured in the current schema.</p></div></details>
  </div>;
}
