"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLoading } from "./AdminLoading";
import { useAdminToast } from "@/components/admin/AdminToast";

type AccountOption = { id: number; name: string; nickname: string | null; isVirtual: number; isActive: number };
type ActivityRow = { id: string; date: string; kind: string; description: string; amount: number; reference: string; addedBy: string };

export function AccountActivity({ password, username }: { password: string; username?: string }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("cash");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(today);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [account, setAccount] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [checkpointDate, setCheckpointDate] = useState<string | null>(null);
  const [checkpointType, setCheckpointType] = useState<string>("opening_balance");
  const [loading, setLoading] = useState(true);
  const { showError } = useAdminToast();
  const pageSize = 50;

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(username ? { username } : {}), action: "getAccountActivity", accountId, fromDate, toDate, page: nextPage, pageSize }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load account activity");
      setAccounts(data.accounts || []); setRows(data.activity || []); setTotal(data.total || 0); setAccount(data.account || null);
      setBalance(data.balanceAsOf || 0); setCheckpointDate(data.checkpointDate || null); setCheckpointType(data.checkpointType || "opening_balance"); setPage(nextPage);
    } catch (error) { showError(error instanceof Error ? error.message : "Could not load account activity"); }
    finally { setLoading(false); }
  }, [accountId, fromDate, password, showError, toDate, username]);

  useEffect(() => { load(1); }, [load]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="space-y-4">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h3 className="font-display text-lg font-bold text-brand-green-dark">Account Activity</h3><p className="text-xs text-brand-green-dark/60">All history is included by default. Account numbers are masked.</p></div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"><select value={accountId} onChange={(event) => { setAccountId(event.target.value); setPage(1); }} className="col-span-2 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-1"><option value="cash">Cash</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.nickname || item.name}{item.isVirtual ? " · virtual" : ""}{!item.isActive ? " · inactive" : ""}</option>)}</select><Input className="min-w-0" aria-label="Activity from date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><Input className="min-w-0" aria-label="Activity to date" type="date" value={toDate} max={today} onChange={(event) => setToDate(event.target.value)} /><Button className="col-span-2 sm:col-span-1" type="button" variant="outline" onClick={() => load(1)} disabled={loading}>Apply</Button></div>
    </div>
    {account && <div className="grid gap-3 rounded-xl border border-brand-mist bg-white p-4 text-sm dark:bg-card sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-brand-green-dark/50">Account</span><p className="font-semibold">{account.nickname || account.name}</p></div><div><span className="text-brand-green-dark/50">Bank / type</span><p>{account.bankName || (account.isVirtual ? "Virtual account" : "Cash")} · {account.accountType || "—"}</p></div><div><span className="text-brand-green-dark/50">Account number</span><p>{account.accountNumber || "—"}</p></div><div><span className="text-brand-green-dark/50">Balance through {toDate}</span><p className="font-semibold">₹{(balance / 100).toFixed(2)}</p><span className="text-xs text-brand-green-dark/50">{checkpointType === "actual_close" ? `Actual close checkpoint: ${checkpointDate}` : checkpointType === "opening_adjustment" ? `Adjusted opening balance: ${checkpointDate}` : `Opening balance: ₹${((account.openingBalance || 0) / 100).toFixed(2)}`}</span></div></div>}
    <div className="overflow-x-auto rounded-xl border border-brand-mist bg-white dark:bg-card"><table className="hidden w-full min-w-[820px] text-left text-sm md:table"><thead className="border-b bg-brand-sand/40 text-xs text-brand-green-dark/60"><tr>{["Date", "Type", "Details", "Reference", "Added by", "Amount"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="whitespace-nowrap p-3">{row.date}</td><td className="p-3 capitalize">{row.kind.replaceAll("_", " ")}</td><td className="p-3">{row.description || "—"}</td><td className="p-3">{row.reference || "—"}</td><td className="whitespace-nowrap p-3">{row.addedBy || "System"}</td><td className={`whitespace-nowrap p-3 text-right font-semibold ${row.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>{row.amount < 0 ? "−" : "+"}₹{(Math.abs(row.amount) / 100).toFixed(2)}</td></tr>)}</tbody></table><div className="space-y-2 p-2 md:hidden">{rows.map((row) => <article key={row.id} className="rounded-lg border border-brand-mist p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-brand-green-dark/60">{row.date} · {row.kind.replaceAll("_", " ")}</p><p className="break-words text-sm font-medium">{row.description || "—"}</p>{row.reference && <p className="break-all text-xs text-brand-green-dark/50">{row.reference}</p>}<p className="mt-1 text-xs text-brand-green-dark/60">Added by {row.addedBy || "System"}</p></div><strong className={`shrink-0 text-sm ${row.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>{row.amount < 0 ? "−" : "+"}₹{(Math.abs(row.amount) / 100).toFixed(2)}</strong></div></article>)}</div>{loading && !rows.length ? <AdminLoading message="Loading account activity..." /> : rows.length === 0 ? <p className="py-10 text-center text-sm text-brand-green-dark/50">No activity in this date range.</p> : null}</div>
    <div className="flex items-center justify-between text-xs text-brand-green-dark/60"><span>{total} entries · page {page} of {pages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>Next</Button></div></div>
  </div>;
}
