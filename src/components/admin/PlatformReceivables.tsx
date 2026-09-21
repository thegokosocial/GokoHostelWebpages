"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminToast } from "@/components/admin/AdminToast";
import type { Role } from "./types";

type Booking = { guestName: string; bookingRef: string | null; gokoBookingId: string | null; checkinDate: string; checkoutDate: string | null } | null;
type PlatformRow = { bookingId: number; bookingCycle: number; platformKey: string; expectedNetPaise: number; allocatedPaise: number; outstandingPaise: number; grossPaise: number; taxChargedPaise: number; taxWithheldPaise: number; commissionPaise: number; tdsPaise: number; tcsPaise: number; otherDeductionsPaise: number; booking: Booking };
type WebsiteRow = { paymentId: string; bookingId: number | null; guestName: string; bookingRef: string | null; gokoBookingId: string | null; checkinDate: string | null; checkoutDate: string | null; amountPaise: number; refundedPaise: number; feePaise: number | null; taxPaise: number | null; expectedNetPaise: number | null; allocatedPaise: number; outstandingPaise: number | null; verifiedAt: string };
type Bank = { id: number; name: string; nickname: string | null };
type Settlement = { id: number; platformKey: string; payoutDate: string; actualAmountPaise: number; reference: string; allocatedPaise: number; unallocatedPaise: number };

function todayIST(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
const rupees = (amount: number | null | undefined) => amount == null ? "Pending" : `₹${(amount / 100).toFixed(2)}`;

export function PlatformReceivables({ password, username }: { password: string; username?: string; role: Role }) {
  const { showError, showSuccess } = useAdminToast();
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [websitePayments, setWebsitePayments] = useState<WebsiteRow[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementId, setSettlementId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ platform: "Razorpay Website", amount: "", payoutDate: todayIST(), bankAccountId: "", reference: "" });
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/admin/platform-settlements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, ...(username ? { username } : {}), action, ...extra }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Platform finance action failed");
    return data;
  }, [password, username]);
  const load = useCallback(async () => {
    try {
      const data = await call("list");
      setRows(data.receivables || []); setWebsitePayments(data.websitePayments || []); setBanks(data.bankAccounts || []); setSettlements(data.settlements || []);
      if (!form.bankAccountId && data.bankAccounts?.[0]) setForm((old) => ({ ...old, bankAccountId: String(data.bankAccounts[0].id) }));
    } catch (error) { showError(error instanceof Error ? error.message : "Could not load platform receivables"); }
  }, [call, form.bankAccountId, showError]);
  useEffect(() => { load(); }, [load]);

  const currentSettlement = settlements.find((item) => String(item.id) === settlementId);
  const razorpayPayout = currentSettlement?.platformKey === "razorpay-website";
  const createSettlement = async () => {
    setBusy(true);
    try {
      const data = await call("createSettlement", { ...form, bankAccountId: Number(form.bankAccountId) });
      setSettlementId(String(data.id)); setForm((old) => ({ ...old, amount: "", reference: "" })); showSuccess("Payout recorded in the receiving bank account"); await load();
    } catch (error) { showError(error instanceof Error ? error.message : "Could not record payout"); } finally { setBusy(false); }
  };
  const keyFor = (row: PlatformRow | WebsiteRow) => "paymentId" in row ? `website:${row.paymentId}` : `ota:${row.bookingId}:${row.bookingCycle}`;
  const toggle = (row: PlatformRow | WebsiteRow) => {
    const key = keyFor(row);
    const selectedNow = selected.includes(key);
    setSelected((current) => selectedNow ? current.filter((item) => item !== key) : [...current, key]);
    const outstanding = row.outstandingPaise;
    if (!selectedNow && outstanding != null) setAmounts((current) => ({ ...current, [key]: (outstanding / 100).toFixed(2) }));
  };
  const allocateSelected = async () => {
    if (!settlementId || selected.length === 0) { showError("Choose a payout and at least one outstanding entry"); return; }
    if (!currentSettlement) { showError("Select a valid payout"); return; }
    setBusy(true);
    try {
      const allocations = selected.map((key) => {
        const [type, ...parts] = key.split(":");
        const amount = Number(amounts[key]);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive amount for every selected entry");
        const allocatedPaise = Math.round(amount * 100);
        return type === "website" ? { type: "website", paymentId: parts.join(":"), allocatedPaise }
          : { type: "ota", bookingId: Number(parts[0]), bookingCycle: Number(parts[1]), allocatedPaise };
      });
      await call("allocateBatch", { settlementId: Number(settlementId), allocations }); showSuccess("Selected payout allocations recorded"); setSelected([]); setAmounts({}); await load();
    } catch (error) { showError(error instanceof Error ? error.message : "Could not allocate payout"); }
    finally { setBusy(false); }
  };
  const bookingDetails = (booking: Booking) => <><strong>{booking?.guestName || "Guest details unavailable"}</strong><br />{booking?.gokoBookingId || booking?.bookingRef || "No booking reference"} · {booking?.checkinDate || "—"} to {booking?.checkoutDate || "—"}</>;

  return <div className="space-y-5">
    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <h3 className="font-semibold text-brand-green">Record platform or website payout</h3>
      <p className="mt-1 text-xs text-brand-green-dark/60">Records one real bank receipt on the payout date. Website gateway fees are shown only when verified by provider evidence.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        <Input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="Platform or provider" />
        <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount ₹" inputMode="decimal" />
        <Input type="date" value={form.payoutDate} onChange={(e) => setForm({ ...form, payoutDate: e.target.value })} />
        <select className="rounded-md border px-2 text-sm" value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}><option value="">Bank account</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.nickname || bank.name}</option>)}</select>
        <div className="flex gap-2"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="UTR / reference" /><Button disabled={busy || !form.amount || !form.bankAccountId} onClick={createSettlement}>Record</Button></div>
      </div>
      {settlements.length > 0 && <div className="mt-3 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center"><span>Allocate payout:</span><select className="w-full min-w-0 rounded-md border px-2 py-2 sm:w-auto" value={settlementId} onChange={(e) => { setSettlementId(e.target.value); setSelected([]); setAmounts({}); }}><option value="">Choose payout</option>{settlements.map((item) => <option key={item.id} value={item.id}>{item.platformKey} · {item.payoutDate} · received ₹{(item.actualAmountPaise / 100).toFixed(2)} · remaining ₹{(item.unallocatedPaise / 100).toFixed(2)}</option>)}</select>{currentSettlement && <span>Unallocated payout: <strong>{rupees(currentSettlement.unallocatedPaise)}</strong></span>}</div>}
      {selected.length > 0 && <div className="mt-3 flex items-center justify-between rounded-lg bg-brand-green/5 p-3"><span>{selected.length} entries selected</span><Button type="button" disabled={busy || !settlementId} onClick={allocateSelected}>Allocate selected entries</Button></div>}
    </div>
    <div className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
      <h3 className="font-semibold text-brand-green">Outstanding platform receivables</h3>
      <p className="mt-1 text-xs text-brand-green-dark/60">Tax and deductions are shown individually. “Tax charged” and “tax withheld” are separate because they have different settlement treatment.</p>
      <div className="mt-3 hidden overflow-x-auto md:block"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b text-xs text-brand-green-dark/60"><th className="p-2">Select</th><th className="p-2">Booking / guest</th><th className="p-2">Platform</th><th className="p-2">Gross</th><th className="p-2">Tax charged</th><th className="p-2">Tax withheld</th><th className="p-2">Commission</th><th className="p-2">TDS / TCS</th><th className="p-2">Other deductions</th><th className="p-2">Expected net</th><th className="p-2">Allocated</th><th className="p-2">Outstanding</th><th className="p-2">Allocate ₹</th></tr></thead><tbody>
        {rows.map((row) => { const key = keyFor(row); const compatible = !currentSettlement || row.platformKey === currentSettlement.platformKey; return <tr key={key} className="border-b align-top last:border-0"><td className="p-2"><input type="checkbox" aria-label={`Select booking ${row.bookingId}`} disabled={!compatible || row.outstandingPaise <= 0 || busy} checked={selected.includes(key)} onChange={() => toggle(row)} /></td><td className="p-2">{bookingDetails(row.booking)}</td><td className="p-2">{row.platformKey} · cycle {row.bookingCycle}</td><td className="p-2">{rupees(row.grossPaise)}</td><td className="p-2">{rupees(row.taxChargedPaise)}</td><td className="p-2">{rupees(row.taxWithheldPaise)}</td><td className="p-2">{rupees(row.commissionPaise)}</td><td className="p-2">{rupees(row.tdsPaise)} / {rupees(row.tcsPaise)}</td><td className="p-2">{rupees(row.otherDeductionsPaise)}</td><td className="p-2">{rupees(row.expectedNetPaise)}</td><td className="p-2">{rupees(row.allocatedPaise)}</td><td className="p-2 font-medium">{rupees(row.outstandingPaise)}</td><td className="p-2"><Input className="w-28" aria-label={`Allocation amount for booking ${row.bookingId}`} value={amounts[key] || ""} onChange={(e) => setAmounts((current) => ({ ...current, [key]: e.target.value }))} disabled={!selected.includes(key)} inputMode="decimal" /></td></tr>; })}
        {websitePayments.map((row) => { const key = keyFor(row); const netDetail = row.expectedNetPaise == null ? "Fee / tax pending verification" : rupees(row.expectedNetPaise); return <tr key={key} className="border-b align-top last:border-0"><td className="p-2"><input type="checkbox" aria-label={`Select website payment ${row.paymentId}`} disabled={!razorpayPayout || row.outstandingPaise == null || row.outstandingPaise <= 0 || busy} checked={selected.includes(key)} onChange={() => toggle(row)} /></td><td className="p-2"><strong>{row.guestName}</strong><br />{row.gokoBookingId || row.bookingRef || row.paymentId} · {row.checkinDate || "—"} to {row.checkoutDate || "—"}</td><td className="p-2">Website · Razorpay</td><td className="p-2">{rupees(row.amountPaise)}</td><td className="p-2">—</td><td className="p-2">—</td><td className="p-2">Gateway fee {rupees(row.feePaise)}<br />Gateway tax {rupees(row.taxPaise)}</td><td className="p-2">—</td><td className="p-2">Refunded {rupees(row.refundedPaise)}</td><td className="p-2">{netDetail}</td><td className="p-2">{rupees(row.allocatedPaise)}</td><td className="p-2 font-medium">{rupees(row.outstandingPaise)}</td><td className="p-2"><Input className="w-28" aria-label={`Allocation amount for website payment ${row.paymentId}`} value={amounts[key] || ""} onChange={(e) => setAmounts((current) => ({ ...current, [key]: e.target.value }))} disabled={!selected.includes(key)} inputMode="decimal" /></td></tr>; })}
      </tbody></table></div>
      <div className="mt-3 space-y-3 md:hidden">
        {rows.map((row) => { const key = keyFor(row); const compatible = !currentSettlement || row.platformKey === currentSettlement.platformKey; return <article key={key} className="rounded-lg border border-brand-mist p-3 text-sm"><div className="flex items-start gap-3"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" aria-label={`Select booking ${row.bookingId}`} disabled={!compatible || row.outstandingPaise <= 0 || busy} checked={selected.includes(key)} onChange={() => toggle(row)} /><div className="min-w-0 flex-1"><div className="break-words">{bookingDetails(row.booking)}</div><p className="mt-1 text-xs text-brand-green-dark/60">{row.platformKey} · cycle {row.bookingCycle}</p></div></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-brand-green-dark/50">Gross</dt><dd>{rupees(row.grossPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Tax charged / withheld</dt><dd>{rupees(row.taxChargedPaise)} / {rupees(row.taxWithheldPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Commission</dt><dd>{rupees(row.commissionPaise)}</dd></div><div><dt className="text-brand-green-dark/50">TDS / TCS</dt><dd>{rupees(row.tdsPaise)} / {rupees(row.tcsPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Other deductions</dt><dd>{rupees(row.otherDeductionsPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Expected net</dt><dd>{rupees(row.expectedNetPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Allocated</dt><dd>{rupees(row.allocatedPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Outstanding</dt><dd className="font-semibold">{rupees(row.outstandingPaise)}</dd></div></dl><label className="mt-3 block text-xs text-brand-green-dark/60">Allocate amount (₹)<Input className="mt-1" value={amounts[key] || ""} onChange={(e) => setAmounts((current) => ({ ...current, [key]: e.target.value }))} disabled={!selected.includes(key)} inputMode="decimal" /></label></article>; })}
        {websitePayments.map((row) => { const key = keyFor(row); const netDetail = row.expectedNetPaise == null ? "Fee / tax pending verification" : rupees(row.expectedNetPaise); return <article key={key} className="rounded-lg border border-brand-mist p-3 text-sm"><div className="flex items-start gap-3"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" aria-label={`Select website payment ${row.paymentId}`} disabled={!razorpayPayout || row.outstandingPaise == null || row.outstandingPaise <= 0 || busy} checked={selected.includes(key)} onChange={() => toggle(row)} /><div className="min-w-0 flex-1"><strong className="break-words">{row.guestName}</strong><p className="break-words text-xs">{row.gokoBookingId || row.bookingRef || row.paymentId}</p><p className="text-xs text-brand-green-dark/60">{row.checkinDate || "—"} to {row.checkoutDate || "—"} · Website / Razorpay</p></div></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-brand-green-dark/50">Gross</dt><dd>{rupees(row.amountPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Refunded</dt><dd>{rupees(row.refundedPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Gateway fee</dt><dd>{rupees(row.feePaise)}</dd></div><div><dt className="text-brand-green-dark/50">Gateway tax</dt><dd>{rupees(row.taxPaise)}</dd></div><div><dt className="text-brand-green-dark/50">Expected net</dt><dd>{netDetail}</dd></div><div><dt className="text-brand-green-dark/50">Allocated / outstanding</dt><dd>{rupees(row.allocatedPaise)} / {rupees(row.outstandingPaise)}</dd></div></dl><label className="mt-3 block text-xs text-brand-green-dark/60">Allocate amount (₹)<Input className="mt-1" value={amounts[key] || ""} onChange={(e) => setAmounts((current) => ({ ...current, [key]: e.target.value }))} disabled={!selected.includes(key)} inputMode="decimal" /></label></article>; })}
        {rows.length === 0 && websitePayments.length === 0 && <p className="py-8 text-center text-sm text-brand-green-dark/60">No receivables recorded yet.</p>}
      </div>
    </div>
  </div>;
}
