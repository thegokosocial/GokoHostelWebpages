"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  LockIcon,
  Undo2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminLoading } from "./AdminLoading";
import { hasPermission, type Role } from "./types";

type AccountBalance = {
  accountId: number | null;
  accountName: string;
  openingBalance: number;
  totalIncome: number;
  manualIncome?: number;
  automaticGuestReceipts?: number;
  bookingPaymentCash?: number;
  totalExpense: number;
  dayIncome?: number;
  dayExpense?: number;
  asOfDate?: string;
  expectedClosing: number;
  actualClosing: number | null;
  isReconciled: boolean;
  notes: string;
  reconciledBy: string;
  reconciledAt: string;
};

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DailyReconcile({ password, username, role, permissions }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean> }) {
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const [date, setDate] = useState(() =>
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : getToday(),
  );
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [bookingPaymentEvents, setBookingPaymentEvents] = useState<any[]>([]);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reconciled, setReconciled] = useState(false);
  const [undoingKey, setUndoingKey] = useState("");
  const [error, setError] = useState("");
  const cashBalance = balances.find((balance) => balance.accountId === null);
  const onlineBalances = balances.filter((balance) => balance.accountId !== null);
  const reconciledOnlineCount = onlineBalances.filter((balance) => balance.isReconciled).length;

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const loadReconciliation = useCallback(async (preserveDrafts = false) => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getReconciliation", date });
      if (res.ok) {
        const d = await res.json();
        setBalances(d.balances || []);
        setBookingPaymentEvents(d.bookingPaymentEvents || []);
        setReconciled(d.isReconciled || false);
        const initialActuals: Record<string, string> = {};
        const initialNotes: Record<string, string> = {};
        for (const b of d.balances || []) {
          const key = b.accountId != null ? String(b.accountId) : "cash";
          if (b.actualClosing != null) {
            initialActuals[key] = (b.actualClosing / 100).toFixed(2);
          }
          initialNotes[key] = b.notes || "";
        }
        setActuals((previous) => {
          if (!preserveDrafts) return initialActuals;
          for (const balance of d.balances || []) {
            const key = balance.accountId != null ? String(balance.accountId) : "cash";
            if (!balance.isReconciled && previous[key] !== undefined) initialActuals[key] = previous[key];
          }
          return initialActuals;
        });
        setNotes((previous) => {
          if (!preserveDrafts) return initialNotes;
          for (const balance of d.balances || []) {
            const key = balance.accountId != null ? String(balance.accountId) : "cash";
            if (!balance.isReconciled && previous[key] !== undefined) initialNotes[key] = previous[key];
          }
          return initialNotes;
        });
        setError("");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Unable to load reconciliation balances");
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall, date]);

  useEffect(() => { loadReconciliation(); }, [loadReconciliation]);

  const saveReconciliation = async (balance: AccountBalance) => {
    const key = balance.accountId != null ? String(balance.accountId) : "cash";
    const amount = Number(actuals[key]);
    if (actuals[key]?.trim() === "" || !Number.isFinite(amount)) {
      setError(`Enter the actual closing balance for ${balance.accountName}`);
      return;
    }
    setSavingKey(key);
    setError("");
    try {
      const res = await apiCall({
        action: "saveReconciliation",
        date,
        target: balance.accountId === null ? { type: "cash" } : { type: "online", accountId: balance.accountId },
        actualClosing: Math.round(amount * 100),
        notes: notes[key] || "",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) await loadReconciliation(true);
        setError(d.error || `Unable to reconcile ${balance.accountName}`);
        return;
      }
      await loadReconciliation(true);
    } finally {
      setSavingKey("");
    }
  };

  const adjustOpening = async (accountId: number | null, newOpening: number) => {
    await apiCall({
      action: "adjustOpeningBalance",
      date,
      accountId,
      openingBalance: Math.round(newOpening * 100),
    });
    loadReconciliation(true);
  };

  const undoReconciliation = async (balance: AccountBalance) => {
    const key = balance.accountId != null ? String(balance.accountId) : "cash";
    if (!confirm(`Undo the ${balance.accountName} reconciliation for ${formatDate(date)}?`)) return;
    setUndoingKey(key);
    setError("");
    try {
      const res = await apiCall({
        action: "undoReconciliation",
        date,
        target: balance.accountId === null ? { type: "cash" } : { type: "online", accountId: balance.accountId },
      });
      if (res.ok) {
        await loadReconciliation(true);
      } else {
        const d = await res.json().catch(() => ({}));
        if (res.status === 409) await loadReconciliation(true);
        setError(d.error || `Unable to undo ${balance.accountName}`);
      }
    } finally {
      setUndoingKey("");
    }
  };

  const shiftDate = (days: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(y, m - 1, d + days);
    setDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`);
  };

  return (
    <div className="space-y-6">
      {/* Date Navigator */}
      <div className="flex items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card p-3">
        <button type="button" onClick={() => shiftDate(-1)} className="rounded-lg p-2 hover:bg-brand-sand">
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-brand-green" />
          <input
            type="date"
            value={date}
            max={getToday()}
            onChange={(e) => setDate(e.target.value)}
            className="border-none bg-transparent text-sm font-medium text-brand-green-dark focus:outline-none"
          />
          <span className="text-xs text-brand-green-dark/50">{formatDate(date)}</span>
        </div>
        <button
          type="button"
          onClick={() => shiftDate(1)}
          disabled={date >= getToday()}
          className="rounded-lg p-2 hover:bg-brand-sand disabled:opacity-30"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      {reconciled && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950 px-4 py-3">
          <div className="flex items-center gap-2">
            <LockIcon className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">Cash and all online accounts are reconciled for this day.</span>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && balances.length > 0 && !reconciled && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-brand-mist bg-white p-3 text-center text-xs dark:bg-card">
          <div>
            <p className="text-brand-green-dark/50">Cash</p>
            <p className={cashBalance?.isReconciled ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
              {cashBalance?.isReconciled ? "Reconciled" : "Pending"}
            </p>
          </div>
          <div>
            <p className="text-brand-green-dark/50">Online accounts</p>
            <p className={reconciledOnlineCount === onlineBalances.length ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
              {reconciledOnlineCount} of {onlineBalances.length} reconciled
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <AdminLoading message="Loading balances..." />
      ) : (
        <>
          {/* Account Balances */}
          <div className="space-y-3">
            {balances.map((b) => {
              const key = b.accountId != null ? String(b.accountId) : "cash";
              const actual = actuals[key] ? parseFloat(actuals[key]) * 100 : null;
              const mismatch = actual != null && Math.abs(actual - b.expectedClosing) > 50;
              const canReconcile = hasPermission(role, permissions || {}, b.accountId === null ? "canReconcileCash" : "canReconcileOnline");

              return (
                <div key={key} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-brand-green-dark">{b.accountName}</h4>
                    {b.isReconciled ? (
                      <div className="flex items-center gap-2">
                        <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
                        {role === "admin" && (
                          <button
                            type="button"
                            onClick={() => undoReconciliation(b)}
                            disabled={undoingKey === key}
                            className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
                          >
                            {undoingKey === key ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <Undo2Icon className="h-3 w-3" />}
                            Undo
                          </button>
                        )}
                      </div>
                    ) : mismatch ? (
                      <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
                    <div>
                      <p className="text-[10px] uppercase text-brand-green-dark/50">Opening</p>
                      <p className="text-sm font-medium text-brand-green-dark">₹{(b.openingBalance / 100).toFixed(0)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-brand-green-dark/50">+ Income since close</p>
                      <p className="text-sm font-medium text-emerald-600">₹{(b.totalIncome / 100).toFixed(0)}</p>
                      {(b.automaticGuestReceipts || 0) !== 0 && <p className="text-[10px] text-blue-600">Guest online ₹{((b.automaticGuestReceipts || 0) / 100).toFixed(0)}</p>}
                      {(b.bookingPaymentCash || 0) !== 0 && <p className="text-[10px] text-emerald-700">OTA booking cash ₹{((b.bookingPaymentCash || 0) / 100).toFixed(2)}</p>}
                      <p className="text-[10px] text-brand-green-dark/50">Selected date: ₹{((b.dayIncome || 0) / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-brand-green-dark/50">- Expenses since close</p>
                      <p className="text-sm font-medium text-red-500">₹{(b.totalExpense / 100).toFixed(0)}</p>
                      <p className="text-[10px] text-brand-green-dark/50">Selected date: ₹{((b.dayExpense || 0) / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-brand-green-dark/50">Expected Closing</p>
                      <p className="text-sm font-bold text-brand-green-dark">₹{(b.expectedClosing / 100).toFixed(0)}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <div className="flex-1">
                      <Label className="text-[10px]">Actual Closing (₹)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={actuals[key] || ""}
                        onChange={(e) => setActuals((prev) => ({ ...prev, [key]: e.target.value }))}
                        className={cn("mt-1 h-8 text-xs", mismatch && "border-amber-400 bg-amber-50")}
                        placeholder="Enter actual balance..."
                        disabled={b.isReconciled}
                      />
                    </div>
                    {mismatch && (
                      <p className="text-[10px] text-amber-600 font-medium mt-4">
                        Diff: ₹{((actual! - b.expectedClosing) / 100).toFixed(0)}
                      </p>
                    )}
                  </div>

                  {b.isReconciled ? (
                    <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Reconciled{b.reconciledBy ? ` by ${b.reconciledBy}` : ""}
                      {b.reconciledAt ? ` on ${new Date(b.reconciledAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}` : ""}
                      {b.notes ? <p className="mt-1 whitespace-pre-wrap">Notes: {b.notes}</p> : null}
                    </div>
                  ) : canReconcile ? (
                    <div className="mt-3 space-y-2 border-t border-brand-mist pt-3">
                      <div>
                        <Label className="text-[10px]">Notes (optional)</Label>
                        <Input
                          value={notes[key] || ""}
                          maxLength={1000}
                          onChange={(e) => setNotes((previous) => ({ ...previous, [key]: e.target.value }))}
                          className="mt-1 h-8 text-xs"
                          placeholder={`Observations for ${b.accountName}...`}
                        />
                      </div>
                      <Button type="button" onClick={() => saveReconciliation(b)} disabled={Boolean(savingKey || undoingKey)} className="w-full gap-1.5">
                        {savingKey === key ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
                        Reconcile {b.accountName}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-[10px] text-brand-green-dark/50">You do not have permission to reconcile this account.</p>
                  )}

                  {role === "admin" && !b.isReconciled && (
                    <button
                      type="button"
                      onClick={() => {
                        const val = prompt("Adjust opening balance (₹):", (b.openingBalance / 100).toFixed(2));
                        if (val) adjustOpening(b.accountId, parseFloat(val));
                      }}
                      className="mt-2 text-[10px] text-brand-green/70 hover:text-brand-green"
                    >
                      Adjust opening balance
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {bookingPaymentEvents.length > 0 && (
            <section className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
              <h4 className="text-sm font-semibold text-brand-green-dark">OTA booking cash movements · {date}</h4>
              <p className="mt-1 text-[10px] text-brand-green-dark/50">Included in Cash expected closing. Do not record these payments again as manual Stay Revenue.</p>
              <div className="mt-3 space-y-2">
                {bookingPaymentEvents.map((event) => (
                  <div key={event.eventId} className="flex flex-wrap justify-between gap-2 border-b border-brand-mist/60 pb-2 text-xs last:border-0">
                    <span className="font-medium text-brand-green-dark">{event.guestNameSnapshot} · {event.bookingRefSnapshot || `Booking #${event.bookingId}`} · cycle {event.bookingCycle}</span>
                    <span className={event.cashPaise < 0 ? "text-red-600" : "text-emerald-700"}>{event.eventType === "refund" ? "Refund" : "Collection"} · {event.cashPaise < 0 ? "−" : "+"}₹{(Math.abs(event.cashPaise) / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {balances.length === 0 && (
            <p className="py-8 text-center text-sm text-brand-green-dark/50">
              No accounts configured. Add accounts in Management → Account Settings.
            </p>
          )}

        </>
      )}
    </div>
  );
}
