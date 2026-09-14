"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BanknoteIcon, SmartphoneIcon, AlertTriangleIcon, ShoppingCartIcon, TagIcon } from "lucide-react";
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

export function AdminFoodBill({
  password,
  username,
  role,
  permissions,
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
      const res = await expenseApi({
        action: "getFoodRevenue",
        fromDate,
        toDate,
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [expenseApi, fromDate, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = data?.summary || {
    totalRevenue: 0,
    totalDiscount: 0,
    orderCount: 0,
    cashPayments: 0,
    cashOrders: 0,
    onlinePayments: 0,
    onlineOrders: 0,
    unpaidTabs: 0,
    unpaidOrders: 0,
  };

  const guests: any[] = data?.guestBreakdown || [];

  return (
    <div>
      <h3 className="font-display text-lg font-bold text-brand-green-dark">Food Bill Summary</h3>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1"
          />
        </div>
        <Button type="button" variant="cta" onClick={loadData} disabled={loading}>
          {loading ? "Loading..." : "Apply"}
        </Button>
      </div>

      {loading && !data ? (
        <AdminLoading message="Loading food bill data..." />
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 dark:bg-green-950">
                  <ShoppingCartIcon className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-brand-green-dark">
                    ₹{(summary.totalRevenue / 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-brand-green-dark/60">
                    Total Revenue ({summary.orderCount} orders)
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950">
                  <BanknoteIcon className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-brand-green-dark">
                    ₹{(summary.cashPayments / 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-brand-green-dark/60">
                    Cash ({summary.cashOrders} orders)
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950">
                  <SmartphoneIcon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-brand-green-dark">
                    ₹{(summary.onlinePayments / 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-brand-green-dark/60">
                    Online ({summary.onlineOrders} orders)
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 dark:bg-orange-950">
                  <AlertTriangleIcon className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-brand-green-dark">
                    ₹{(summary.unpaidTabs / 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-brand-green-dark/60">
                    Unpaid ({summary.unpaidOrders} orders)
                  </p>
                </div>
              </div>
            </div>
            {summary.totalDiscount > 0 && (
              <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 dark:bg-green-950">
                    <TagIcon className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-brand-green-dark">
                      ₹{(summary.totalDiscount / 100).toFixed(0)}
                    </p>
                    <p className="text-xs text-brand-green-dark/60">
                      Total Discounts
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {guests.length > 0 && (
            <>
              <h4 className="mt-8 font-display text-base font-bold text-brand-green-dark">
                Guest-wise Breakdown
              </h4>
              <div className="mt-3 overflow-visible rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-brand-sand/95">
                    <tr className="border-b border-brand-mist bg-brand-sand/50">
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Guest Name</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Contact</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Room/Bed</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Orders</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Total Spent</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Discount</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Cash</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Online</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Unpaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g: any, i: number) => (
                      <tr key={g.checkinId || i} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-green-dark">{g.guestName || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{g.guestPhone || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{g.roomInfo || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/90">{g.orderCount || 0}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-green-dark">
                          ₹{((g.totalSpent || 0) / 100).toFixed(0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-purple-700">
                          {(g.totalDiscount || 0) > 0 ? (
                            <span>
                              ₹{((g.totalDiscount || 0) / 100).toFixed(0)}
                              <span className="ml-1 text-[10px] text-purple-500">
                                ({Math.round(((g.totalDiscount || 0) / ((g.totalSpent || 0) + (g.totalDiscount || 0))) * 100)}%)
                              </span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-emerald-700">
                          ₹{((g.cashPaid || 0) / 100).toFixed(0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-blue-700">
                          ₹{((g.onlinePaid || 0) / 100).toFixed(0)}
                        </td>
                        <td className={cn(
                          "whitespace-nowrap px-3 py-3",
                          (g.unpaid || 0) > 0 ? "font-medium text-orange-600" : "text-brand-green-dark/70"
                        )}>
                          ₹{((g.unpaid || 0) / 100).toFixed(0)}
                        </td>
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
