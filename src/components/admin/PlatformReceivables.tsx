"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminToast } from "@/components/admin/AdminToast";
import type { Role } from "./types";

type Row = { id: number; bookingId: number; bookingCycle: number; platformKey: string; expectedNetPaise: number; allocatedPaise: number; outstandingPaise: number };
type Bank = { id: number; name: string; nickname: string | null };
type Settlement = { id: number; platformKey: string; payoutDate: string; actualAmountPaise: number; reference: string };

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function PlatformReceivables({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { showError, showSuccess } = useAdminToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementId, setSettlementId] = useState("");
  const [form, setForm] = useState({ platform: "MakeMyTrip", amount: "", payoutDate: todayIST(), bankAccountId: "", reference: "" });
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const body = { password, action, ...(username ? { username } : {}), ...extra };
    const response = await fetch("/api/admin/platform-settlements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Platform finance action failed");
    return data;
  }, [password, username]);

  const load = useCallback(async () => {
    try {
      const data = await call("list");
      setRows(data.receivables || []); setBanks(data.bankAccounts || []); setSettlements(data.settlements || []);
      if (!form.bankAccountId && data.bankAccounts?.[0]) setForm((old) => ({ ...old, bankAccountId: String(data.bankAccounts[0].id) }));
    } catch (error) { showError(error instanceof Error ? error.message : "Could not load OTA receivables"); }
  }, [call, form.bankAccountId, showError]);
  useEffect(() => { load(); }, [load]);

  const createSettlement = async () => {
    setBusy(true);
    try {
      const data = await call("createSettlement", { ...form, bankAccountId: Number(form.bankAccountId) });
      setSettlementId(String(data.id)); setForm((old) => ({ ...old, amount: "", reference: "" })); showSuccess("Payout recorded in the real bank account"); await load();
    } catch (error) { showError(error instanceof Error ? error.message : "Could not record payout"); } finally { setBusy(false); }
  };

  const allocate = async (row: Row) => {
    if (!settlementId) { showError("Select or create a payout first"); return; }
    const amount = window.prompt(`Allocate amount in ₹ (outstanding ₹${(row.outstandingPaise / 100).toFixed(2)})`, (row.outstandingPaise / 100).toFixed(2));
    if (!amount) return;
    setBusy(true);
    try { await call("allocate", { settlementId: Number(settlementId), bookingId: row.bookingId, bookingCycle: row.bookingCycle, amount }); showSuccess("Payout allocated"); await load(); }
    catch (error) { showError(error instanceof Error ? error.message : "Could not allocate payout"); }
    finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <h3 className="font-semibold text-brand-green">Record OTA payout</h3>
      <p className="mt-1 text-xs text-brand-green-dark/60">This creates one real-bank receipt on the payout date. It does not add the virtual account to daily reconciliation.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        <Input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="Platform" />
        <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount ₹" inputMode="decimal" />
        <Input type="date" value={form.payoutDate} onChange={(e) => setForm({ ...form, payoutDate: e.target.value })} />
        <select className="rounded-md border px-2 text-sm" value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}><option value="">Bank account</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.nickname || bank.name}</option>)}</select>
        <div className="flex gap-2"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="UTR / reference" /><Button disabled={busy || !form.amount || !form.bankAccountId} onClick={createSettlement}>Record</Button></div>
      </div>
      {settlements.length > 0 && <div className="mt-3 flex items-center gap-2 text-xs"><span>Allocate against:</span><select className="rounded-md border px-2 py-1" value={settlementId} onChange={(e) => setSettlementId(e.target.value)}><option value="">Choose payout</option>{settlements.map((item) => <option key={item.id} value={item.id}>{item.platformKey} · {item.payoutDate} · ₹{(item.actualAmountPaise / 100).toFixed(2)}</option>)}</select></div>}
    </div>
    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <h3 className="font-semibold text-brand-green">Outstanding platform receivables</h3>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-brand-green-dark/60"><th className="p-2">Booking</th><th className="p-2">Platform</th><th className="p-2">Expected net</th><th className="p-2">Allocated</th><th className="p-2">Outstanding</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={`${row.bookingId}-${row.bookingCycle}`} className="border-b last:border-0"><td className="p-2">#{row.bookingId} / cycle {row.bookingCycle}</td><td className="p-2">{row.platformKey}</td><td className="p-2">₹{(row.expectedNetPaise / 100).toFixed(2)}</td><td className="p-2">₹{(row.allocatedPaise / 100).toFixed(2)}</td><td className="p-2 font-medium">₹{(row.outstandingPaise / 100).toFixed(2)}</td><td className="p-2">{row.outstandingPaise > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => allocate(row)}>Allocate</Button>}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="py-8 text-center text-sm text-brand-green-dark/60">No OTA receivables recognized yet.</p>}</div>
    </div>
  </div>;
}
