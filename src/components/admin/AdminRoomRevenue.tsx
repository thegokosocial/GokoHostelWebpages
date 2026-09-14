"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BanknoteIcon, SmartphoneIcon, AlertTriangleIcon, BedDoubleIcon, RotateCcwIcon } from "lucide-react";
import { cn, localDateStr } from "@/lib/utils";
import { AdminLoading } from "./AdminLoading";
import type { Role } from "./types";

function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getToday() {
  return localDateStr(new Date());
}

function rupees(amount: number) {
  return `₹${(amount || 0).toLocaleString("en-IN")}`;
}

export function AdminRoomRevenue({
  password,
  username,
}: {
  password: string;
  username?: string;
  role: Role;
  permissions?: Record<string, boolean>;
}) {
  const [fromDate, setFromDate] = useState(getMonthStart);
  const [toDate, setToDate] = useState(getToday);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const expenseApi = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseApi({ action: "getRoomRevenue", fromDate, toDate });
      if (res.ok) setData(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [expenseApi, fromDate, toDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const summary = data?.summary || {
    billed: 0, stayCount: 0, cashCollected: 0, onlineCollected: 0, unspecifiedCollected: 0,
    unpaid: 0, prepaid: 0, cashRefunded: 0, onlineRefunded: 0, refunded: 0,
    netCash: 0, netOnline: 0, netGoko: 0,
  };
  const guests: any[] = data?.guestBreakdown || [];

  const cards: { label: string; value: number; hint: string; icon: React.ReactNode; wrap?: string }[] = [
    { label: "Billed", value: summary.billed, hint: `${summary.stayCount} stays`, icon: <BedDoubleIcon className="h-5 w-5 text-green-600" />, wrap: "bg-green-50 dark:bg-green-950" },
    { label: "Cash collected", value: summary.cashCollected, hint: "Goko till", icon: <BanknoteIcon className="h-5 w-5 text-emerald-600" />, wrap: "bg-emerald-50 dark:bg-emerald-950" },
    { label: "Online collected", value: summary.onlineCollected, hint: "UPI / card", icon: <SmartphoneIcon className="h-5 w-5 text-blue-600" />, wrap: "bg-blue-50 dark:bg-blue-950" },
    { label: "Unpaid", value: summary.unpaid, hint: "Hotel due", icon: <AlertTriangleIcon className="h-5 w-5 text-orange-600" />, wrap: "bg-orange-50 dark:bg-orange-950" },
    { label: "OTA prepaid", value: summary.prepaid, hint: "Not yet checked in / not recorded", icon: <BedDoubleIcon className="h-5 w-5 text-indigo-600" />, wrap: "bg-indigo-50 dark:bg-indigo-950" },
    { label: "Cash refunded", value: summary.cashRefunded, hint: "Out", icon: <RotateCcwIcon className="h-5 w-5 text-red-600" />, wrap: "bg-red-50 dark:bg-red-950" },
    { label: "Online refunded", value: summary.onlineRefunded, hint: "Out", icon: <RotateCcwIcon className="h-5 w-5 text-red-500" />, wrap: "bg-red-50 dark:bg-red-950" },
    { label: "Net Goko", value: summary.netGoko, hint: `Cash net ${rupees(summary.netCash)} · Online net ${rupees(summary.netOnline)}`, icon: <BanknoteIcon className="h-5 w-5 text-green-700" />, wrap: "bg-green-50 dark:bg-green-950" },
  ];
  if (summary.unspecifiedCollected > 0) {
    cards.splice(3, 0, {
      label: "Collected (no method)",
      value: summary.unspecifiedCollected,
      hint: "Before Cash/Online",
      icon: <BanknoteIcon className="h-5 w-5 text-gray-600" />,
      wrap: "bg-gray-50 dark:bg-zinc-800",
    });
  }

  return (
    <div>
      <h3 className="font-display text-lg font-bold text-brand-green-dark">Room Revenue</h3>
      <p className="mt-1 text-xs text-brand-green-dark/50">By check-in date. Occupied stays only (checked in, checked out, or cancelled after check-in).</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1" />
        </div>
        <Button type="button" variant="cta" onClick={loadData} disabled={loading}>
          {loading ? "Loading..." : "Apply"}
        </Button>
      </div>

      {loading && !data ? (
        <AdminLoading message="Loading room revenue..." />
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c.wrap)}>
                    {c.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold text-brand-green-dark">{rupees(c.value)}</p>
                    <p className="text-xs text-brand-green-dark/60">{c.label}</p>
                    <p className="truncate text-[10px] text-brand-green-dark/40">{c.hint}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {guests.length > 0 && (
            <>
              <h4 className="mt-8 font-display text-base font-bold text-brand-green-dark">Stay-wise Breakdown</h4>
              <div className="isolate mt-3 overflow-x-clip rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="sticky top-[4.5rem] z-20 bg-brand-sand/95">
                    <tr className="border-b border-brand-mist bg-brand-sand/50">
                      {["Guest", "Dates", "Status", "Method", "Billed", "Cash in", "Online in", "Unpaid", "Refund", "Cash out", "Online out"].map((h) => (
                        <th key={h} className="sticky top-[4.5rem] z-20 whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g: any) => (
                      <tr key={g.id} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-green-dark">{g.guestName}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{g.checkinDate} → {g.checkoutDate}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{g.status}{g.prepaid ? " · prepaid" : ""}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{g.paymentMethod}</td>
                        <td className="whitespace-nowrap px-3 py-3">{rupees(g.billed)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-emerald-700">{rupees(g.cashIn)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-blue-700">{rupees(g.onlineIn)}</td>
                        <td className={cn("whitespace-nowrap px-3 py-3", g.unpaid > 0 ? "font-medium text-orange-600" : "")}>{rupees(g.unpaid)}</td>
                        <td className="whitespace-nowrap px-3 py-3">{g.refundMethod}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-red-700">{rupees(g.cashOut)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-red-700">{rupees(g.onlineOut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
