"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3Icon, DownloadIcon, RefreshCwIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLoading } from "./AdminLoading";
import type { Role } from "./types";
import { todayIST } from "@/lib/utils";

type Point = { label: string; value: number; secondary?: number };
type AnalyticsData = {
  range: { fromDate: string; toDate: string; days: number; timezone: string };
  summary: Record<string, number | null>;
  bookings: { byDay: { date: string; count: number }[]; byHour: { hour: number; count: number }[]; byWeekday: { weekday: number; count: number }[]; byChannel: { channel: string; count: number; revenue: number }[] };
  stays: { stays: number; guests: number; revenue: number; adr: number };
  food: { byHour: { hour: number; orders: number; revenue: number }[]; topItems: { item: string; quantity: number; revenue: number }[] };
  finance: { byCategory: { category: string; count: number; total: number }[] };
  dataQuality: Record<string, boolean>;
};

const money = (v: number | null | undefined) => `₹${Math.round((v || 0) / 100).toLocaleString("en-IN")}`;
const pct = (v: number, total: number) => total ? `${Math.round((v / total) * 100)}%` : "0%";

function MiniBars({ points, color = "#2f6b4f" }: { points: Point[]; color?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return <div className="flex h-40 items-end gap-1.5 border-b border-l border-brand-mist px-2 pb-0 pt-4">
    {points.map((p) => <div key={p.label} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${p.label}: ${p.value.toLocaleString("en-IN")}`}>
      <div className="w-full rounded-t bg-brand-green/80 transition-opacity group-hover:opacity-70" style={{ height: `${Math.max(3, (p.value / max) * 100)}%`, backgroundColor: color }} />
      <span className="max-w-full truncate text-[9px] text-brand-green-dark/50">{p.label}</span>
    </div>)}
  </div>;
}

function Card({ label, value, note, trend }: { label: string; value: string; note?: string; trend?: "up" | "down" }) {
  return <div className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none">
    <div className="flex items-center justify-between text-xs text-brand-green-dark/55"><span>{label}</span>{trend === "up" ? <TrendingUpIcon className="h-4 w-4 text-emerald-600" /> : trend === "down" ? <TrendingDownIcon className="h-4 w-4 text-rose-500" /> : null}</div>
    <div className="mt-2 text-2xl font-bold text-brand-green-dark dark:text-zinc-100">{value}</div>
    {note && <div className="mt-1 text-[11px] text-brand-green-dark/45">{note}</div>}
  </div>;
}

export function AdminAnalytics({ password, username, role, permissions }: { password: string; username?: string; role: Role; permissions: Record<string, boolean> }) {
  const today = todayIST();
  const initialFromDate = `${today.slice(0, 8)}01`;
  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(today);
  const [draftFromDate, setDraftFromDate] = useState(initialFromDate);
  const [draftToDate, setDraftToDate] = useState(today);
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

  const bookingHours = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, value: data?.bookings.byHour.find((p) => p.hour === hour)?.count || 0 })), [data]);
  const foodHours = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, value: data?.food.byHour.find((p) => p.hour === hour)?.orders || 0 })), [data]);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, weekday) => ({ label, value: data?.bookings.byWeekday.find((p) => p.weekday === weekday)?.count || 0 }));
  const exportData = () => {
    if (!data) return;
    const rows = [
      ["Section", "Metric", "Value", "Secondary value"],
      ...Object.entries(data.summary).map(([k, v]) => ["Summary", k, String(v ?? ""), ""]),
      ...data.bookings.byDay.map((r) => ["Bookings by day", r.date, String(r.count), ""]),
      ...data.bookings.byHour.map((r) => ["Bookings by hour", `${r.hour}:00`, String(r.count), ""]),
      ...data.bookings.byWeekday.map((r) => ["Bookings by weekday", String(r.weekday), String(r.count), ""]),
      ...data.bookings.byChannel.map((r) => ["Booking channels", r.channel, String(r.count), String(r.revenue)]),
      ...data.food.byHour.map((r) => ["Food by hour", `${r.hour}:00`, String(r.orders), String(r.revenue)]),
      ...data.food.topItems.map((r) => ["Top food items", r.item, String(r.quantity), String(r.revenue)]),
      ...data.finance.byCategory.map((r) => ["Expenses by category", r.category, String(r.total), String(r.count)]),
    ];
    const blob = new Blob([rows.map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `goko-analytics-${fromDate}-${toDate}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (loading && !data) return <AdminLoading message="Loading analytics..." />;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error || "Unable to load analytics"}<Button className="ml-3" size="sm" onClick={load}>Retry</Button></div>;
  const s = data.summary;
  const cancellationRate = pct(Number(s.cancellations || 0), Number(s.bookings || 0));

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Analytics</h2><p className="mt-1 text-xs text-brand-green-dark/55">Revenue and operations summary · {data.range.timezone}</p></div>
      <div className="flex flex-wrap items-end gap-2"><label className="text-[11px] text-brand-green-dark/60">From<Input type="date" value={draftFromDate} onChange={(e) => setDraftFromDate(e.target.value)} className="mt-1 w-36 text-xs" /></label><label className="text-[11px] text-brand-green-dark/60">To<Input type="date" value={draftToDate} onChange={(e) => setDraftToDate(e.target.value)} className="mt-1 w-36 text-xs" /></label><Button size="sm" onClick={() => { setFromDate(draftFromDate); setToDate(draftToDate); }} disabled={loading}><RefreshCwIcon className="mr-1 h-3.5 w-3.5" />{loading ? "Loading" : "Apply"}</Button><Button size="sm" variant="outline" onClick={exportData}><DownloadIcon className="mr-1 h-3.5 w-3.5" />Export CSV</Button></div>
    </div>
    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Card label="Bookings received" value={String(s.bookings || 0)} /><Card label="Actual check-ins" value={String(s.actualCheckIns || 0)} /><Card label="Actual checkouts" value={String(s.actualCheckOuts || 0)} /><Card label="Planned stays" value={String(s.plannedStays || 0)} /><Card label="Cancellations" value={String(s.cancellations || 0)} note={`${cancellationRate} of bookings`} trend={Number(s.cancellations || 0) ? "down" : undefined} /><Card label="Booked stay value" value={money(s.bookedStayValue)} /><Card label="Activity balance" value={money(s.activityBalance)} note="Not cash or profit" trend={Number(s.activityBalance || 0) >= 0 ? "up" : "down"} /></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><div className="mb-3 flex items-center gap-2"><BarChart3Icon className="h-4 w-4 text-brand-green" /><h3 className="font-display font-bold text-brand-green-dark dark:text-zinc-100">Bookings by hour</h3></div><MiniBars points={bookingHours} /><p className="mt-2 text-[11px] text-brand-green-dark/45">Booking received time, converted to Asia/Kolkata.</p></section>
      <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><div className="mb-3 flex items-center gap-2"><BarChart3Icon className="h-4 w-4 text-brand-green" /><h3 className="font-display font-bold text-brand-green-dark dark:text-zinc-100">Bookings by weekday</h3></div><MiniBars points={weekdays} color="#4f83cc" /></section>
      <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><div className="mb-3 flex items-center gap-2"><BarChart3Icon className="h-4 w-4 text-brand-green" /><h3 className="font-display font-bold text-brand-green-dark dark:text-zinc-100">Food orders by hour</h3></div><MiniBars points={foodHours} color="#d88919" /><p className="mt-2 text-[11px] text-brand-green-dark/45">Cancelled orders excluded; quantity and revenue are available below.</p></section>
      <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><h3 className="mb-3 font-display font-bold text-brand-green-dark dark:text-zinc-100">Booking channels</h3><div className="space-y-2">{data.bookings.byChannel.length === 0 ? <p className="text-sm text-brand-green-dark/45">No bookings in this range.</p> : data.bookings.byChannel.map((row) => <div key={row.channel} className="flex items-center justify-between text-sm"><span className="capitalize text-brand-green-dark/75">{row.channel.replaceAll("_", " ")}</span><span className="font-semibold text-brand-green-dark">{row.count} <span className="ml-2 text-xs font-normal text-brand-green-dark/45">{money(row.revenue)}</span></span></div>)}</div></section>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><h3 className="mb-3 font-display font-bold text-brand-green-dark dark:text-zinc-100">Top food items</h3><div className="space-y-2">{data.food.topItems.length === 0 ? <p className="text-sm text-brand-green-dark/45">No food orders in this range.</p> : data.food.topItems.map((row) => <div key={row.item} className="flex items-center justify-between text-sm"><span className="truncate pr-3 text-brand-green-dark/75">{row.item}</span><span className="whitespace-nowrap font-semibold text-brand-green-dark">{row.quantity} sold <span className="ml-2 text-xs font-normal text-brand-green-dark/45">{money(row.revenue)}</span></span></div>)}</div></section>
      <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none"><h3 className="mb-3 font-display font-bold text-brand-green-dark dark:text-zinc-100">Expenses by category</h3><div className="space-y-2">{data.finance.byCategory.length === 0 ? <p className="text-sm text-brand-green-dark/45">No expenses in this range.</p> : data.finance.byCategory.map((row) => <div key={row.category} className="flex items-center justify-between text-sm"><span className="capitalize text-brand-green-dark/75">{row.category.replaceAll("_", " ")}</span><span className="font-semibold text-brand-green-dark">{money(row.total)} <span className="ml-2 text-xs font-normal text-brand-green-dark/45">{row.count} entries</span></span></div>)}</div></section>
    </div>
    <div className="rounded-xl border border-brand-mist bg-brand-sand/40 px-4 py-3 text-xs text-brand-green-dark/60">Booked stay value is prorated across overlapping stay nights; food sales exclude cancelled orders. Activity balance is booked stay value plus food sales minus recorded expenses—it is not cash, profit, or accrual revenue. This version is combined across properties because food orders and expenses are not property-tagged.</div>
  </div>;
}
