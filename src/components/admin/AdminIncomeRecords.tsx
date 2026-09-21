"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AdminLoading } from "./AdminLoading";
import { incomeSourceLabel, type IncomeAccount } from "./IncomeForm";
import type { Role } from "./types";
import { hasPermission } from "./types";
import { DEFAULT_INCOME_CATEGORIES, type IncomeCategory } from "@/lib/accountCategories";
import { defaultAccountingDateRange } from "@/lib/accountingDates";

type IncomeRecord = {
  id: number; date: string; accountId: number | null; accountName: string; type: string; amount: number;
  source: string; sourceDetail: string; description: string; createdBy: string; createdAt: string;
};

export function AdminIncomeRecords({ password, username, role, permissions = {} }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean> }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [entries, setEntries] = useState<IncomeRecord[]>([]);
  const [accounts, setAccounts] = useState<IncomeAccount[]>([]);
  const [fromDate, setFromDate] = useState(() => defaultAccountingDateRange(today).fromDate);
  const [toDate, setToDate] = useState(today);
  const [source, setSource] = useState("");
  const [sourceOptions, setSourceOptions] = useState<IncomeCategory[]>(DEFAULT_INCOME_CATEGORIES);
  const [accountId, setAccountId] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const apiCall = useCallback(async (body: Record<string, unknown>) => fetch("/api/admin/expenses", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, ...(username ? { username } : {}), ...body }),
  }), [password, username]);

  const load = useCallback(async (start = fromDate, end = toDate) => {
    setLoading(true); setError("");
    try {
      const response = await apiCall({ action: "listIncomeRecords", fromDate: start, toDate: end });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setError(body.error || "Failed to load income records.");
      setEntries(body.incomeEntries || []); setAccounts(body.accounts || []); setFromDate(body.fromDate || start); setToDate(body.toDate || end); setSourceOptions(body.incomeCategories || DEFAULT_INCOME_CATEGORIES);
    } catch { setError("Something went wrong while loading income records."); }
    finally { setLoading(false); }
  }, [apiCall, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => entries.filter((entry) => {
    if (source && entry.source !== source) return false;
    if (accountId === "cash" && entry.accountId !== null) return false;
    if (accountId !== "all" && accountId !== "cash" && entry.accountId !== Number(accountId)) return false;
    const query = search.trim().toLowerCase();
    return !query || [incomeSourceLabel(entry.source, entry.sourceDetail, sourceOptions), entry.description, entry.accountName, entry.createdBy].some((value) => (value || "").toLowerCase().includes(query));
  }), [accountId, entries, search, source, sourceOptions]);

  const remove = async (id: number) => {
    if (!confirm("Delete this income entry?")) return;
    const response = await apiCall({ action: "deleteDailyIncome", id });
    if (response.ok) setEntries((current) => current.filter((entry) => entry.id !== id));
    else setError((await response.json().catch(() => ({}))).error || "Failed to delete income.");
  };

  if (loading && !entries.length) return <AdminLoading message="Loading income records..." />;
  const total = filtered.reduce((sum, entry) => sum + entry.amount, 0);

  return <div>
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-display text-lg font-bold text-brand-green-dark">Income Records</h3><p className="text-xs text-brand-green-dark/50">Manually recorded income</p></div><Button type="button" variant="ctaOutline" onClick={() => load()} disabled={loading}><RefreshCwIcon className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh</Button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="col-span-full grid grid-cols-2 gap-2 sm:flex sm:items-center"><label className="min-w-0 text-xs text-brand-green-dark/60">From<Input className="mt-1 min-w-0" aria-label="From date" type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="min-w-0 text-xs text-brand-green-dark/60">To<Input className="mt-1 min-w-0" aria-label="To date" type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} /></label><Button className="col-span-2 sm:col-span-1" type="button" variant="outline" onClick={() => load(fromDate, toDate)} disabled={loading}>Apply</Button></div>
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search source, notes, account, creator..." />
      <select value={source} onChange={(event) => setSource(event.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">All sources</option>{sourceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="all">All accounts</option><option value="cash">Cash</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.nickname || account.name}</option>)}</select>
      <div className="rounded-md border border-brand-mist bg-white dark:bg-card px-3 py-2 text-sm"><span className="text-brand-green-dark/50">Filtered total: </span><strong className="text-brand-green-dark">₹{(total / 100).toFixed(2)}</strong></div>
    </div>
    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    <div className="mt-4 space-y-2 lg:hidden">
      {filtered.map((entry) => <div key={entry.id} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-brand-green-dark">{incomeSourceLabel(entry.source, entry.sourceDetail, sourceOptions)}</p><p className="mt-0.5 text-xs text-brand-green-dark/50">{new Date(entry.date + "T00:00:00").toLocaleDateString("en-IN")} · {entry.accountName} · <span className="capitalize">{entry.type}</span></p></div><p className="font-bold text-emerald-700">₹{(entry.amount / 100).toFixed(2)}</p></div>
        {entry.description && <p className="mt-2 text-xs text-brand-green-dark/70">{entry.description}</p>}
        <div className="mt-2 flex items-center justify-between text-[10px] text-brand-green-dark/40"><span>Added by {entry.createdBy || "—"}</span>{hasPermission(role, permissions, "canDeleteExpense") && <button type="button" onClick={() => remove(entry.id)} className="inline-flex items-center gap-1 text-red-500"><Trash2Icon className="h-3 w-3" /> Delete</button>}</div>
      </div>)}
    </div>
    <div className="mt-4 hidden overflow-x-auto rounded-xl border border-brand-mist bg-white dark:bg-card lg:block">
      <table className="w-full min-w-[850px] text-left text-xs"><thead className="border-b border-brand-mist bg-brand-sand/40 text-brand-green-dark/60"><tr>{["Date", "Source", "Account", "Type", "Description", "Created by", "Amount", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
        <tbody>{filtered.map((entry) => <tr key={entry.id} className="border-b border-brand-mist/70 last:border-0"><td className="whitespace-nowrap px-3 py-2">{new Date(entry.date + "T00:00:00").toLocaleDateString("en-IN")}</td><td className="px-3 py-2 font-medium">{incomeSourceLabel(entry.source, entry.sourceDetail, sourceOptions)}</td><td className="px-3 py-2">{entry.accountName}</td><td className="px-3 py-2 capitalize">{entry.type}</td><td className="max-w-[240px] truncate px-3 py-2">{entry.description || "—"}</td><td className="px-3 py-2">{entry.createdBy || "—"}</td><td className="px-3 py-2 font-semibold text-emerald-700">₹{(entry.amount / 100).toFixed(2)}</td><td className="px-3 py-2">{hasPermission(role, permissions, "canDeleteExpense") && <button type="button" onClick={() => remove(entry.id)} className="text-red-500" title="Delete income"><Trash2Icon className="h-4 w-4" /></button>}</td></tr>)}</tbody>
      </table>
    </div>
    {!filtered.length && <p className="mt-4 rounded-xl border border-brand-mist bg-white dark:bg-card py-12 text-center text-sm text-brand-green-dark/40">No matching income records.</p>}
    <p className="mt-2 text-right text-xs text-brand-green-dark/50">{filtered.length} record{filtered.length === 1 ? "" : "s"}</p>
  </div>;
}
