"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { AdminLoading } from "./AdminLoading";
import { useAdminToast } from "@/components/admin/AdminToast";
import {
  foodQrAttemptCanReconcile,
  foodQrAttemptIsCloseable,
  foodQrAttemptOutcome,
  formatFoodQrOrderIdsPreview,
  parseFoodQrOrderIds,
} from "@/lib/foodBillQrUi";

type FoodQrAttemptRow = {
  id: string;
  state: string;
  environment: string;
  paymentAmountPaise: number;
  qrCodeId: string | null;
  guestName: string;
  guestPhone: string;
  createdAt: string;
  closeBy: string | null;
  foodOrderIds?: string | number[];
  payments: Array<{ id: string; status: string; captured: number; amountPaise: number }>;
};

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function OrdersCell({ orderIds }: { orderIds: number[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!orderIds.length) return <>—</>;
  const { visible, hiddenCount } = formatFoodQrOrderIdsPreview(orderIds, { limit: 3 });
  if (!hiddenCount || expanded) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1">
        <span>{orderIds.join(", ")}</span>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="text-[10px] font-semibold text-brand-green underline-offset-2 hover:underline"
            onClick={() => setExpanded(false)}
          >
            Show less
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span>{visible.join(", ")}</span>
      <button
        type="button"
        className="text-[10px] font-semibold text-brand-green underline-offset-2 hover:underline"
        onClick={() => setExpanded(true)}
      >
        +{hiddenCount} more
      </button>
    </span>
  );
}

export function FoodPaymentsLedger({ password, username }: { password: string; username?: string }) {
  const { showError, showSuccess } = useAdminToast();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<FoodQrAttemptRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");

  const apiCall = useCallback(async (body: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/food-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiCall({
        action: "listFoodQrAttempts",
        page,
        query: query || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setAttempts(data.attempts || []);
      setTotalPages(data.totalPages || 1);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load food payments";
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [apiCall, fromDate, page, query, showError, toDate]);

  useEffect(() => { void load(); }, [load]);

  const reconcile = async (attemptId: string) => {
    setBusyId(attemptId);
    try {
      const res = await apiCall({ action: "reconcileFoodQrAttempt", attemptId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reconcile failed");
      showSuccess(`Attempt ${data.attempt?.state || "updated"}`);
      await load();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setBusyId(null);
    }
  };

  const closeQr = async (attemptId: string) => {
    setBusyId(attemptId);
    try {
      const res = await apiCall({ action: "closeActiveFoodQr", attemptId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retire failed");
      const n = Array.isArray(data.releasedAttemptIds) ? data.releasedAttemptIds.length : 0;
      showSuccess(n ? "QR retired — a new bill QR can mint when needed" : "No open QR to retire");
      await load();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Retire failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading && attempts.length === 0) return <AdminLoading />;

  return (
    <section className="mt-6 space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-foreground">Food payments</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Razorpay QR attempts for food bills (Cloudflare-only). Search guest, phone, order id, qr_ or pay_.
            Reconcile (open attempts only) pulls Razorpay. Retire cancels an unpaid open QR.
            Switching Bill Settings to Static also retires open QRs.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <div className="grid gap-2 rounded-lg border border-brand-mist bg-brand-sand/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Search
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Guest, phone, order id, qr_ or pay_"
          />
        </label>
        <DateRangePicker
          variant="compact"
          applyMode="manual"
          minNights={0}
          labels={{ start: "From", end: "To" }}
          startDate={fromDate}
          endDate={toDate}
          onChange={({ startDate, endDate }) => { setFromDate(startDate); setToDate(endDate); setPage(1); }}
          className="w-full sm:w-56"
        />
        <div className="flex gap-2 sm:justify-end">
          <Button type="button" size="sm" onClick={() => { setQuery(searchDraft.trim()); setPage(1); }}>Search</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { setSearchDraft(""); setQuery(""); setFromDate(""); setToDate(""); setPage(1); }}
          >
            Clear
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {attempts.length === 0 && !loading && !error && (
        <p className="text-sm text-muted-foreground">
          No food QR payment attempts match this search. Enable Razorpay mode in Bill Settings, then open an unpaid bill.
        </p>
      )}
      {attempts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-2 font-medium">When</th>
                <th className="py-2 pr-2 font-medium">Outcome</th>
                <th className="py-2 pr-2 font-medium">Orders</th>
                <th className="py-2 pr-2 font-medium">Guest</th>
                <th className="py-2 pr-2 font-medium">Amount</th>
                <th className="py-2 pr-2 font-medium">Env</th>
                <th className="py-2 pr-2 font-medium">QR / payments</th>
                <th className="py-2 pr-2 font-medium">State</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {attempts.map((row) => {
                const outcome = foodQrAttemptOutcome(row);
                const orderIds = parseFoodQrOrderIds(row.foodOrderIds);
                const capturedPays = row.payments.filter((p) => Number(p.captured) === 1).map((p) => p.id);
                const closeable = foodQrAttemptIsCloseable(row.state);
                const canReconcile = foodQrAttemptCanReconcile(row);
                return (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">{when(row.createdAt)}</td>
                    <td className="py-2 pr-2 font-semibold">{outcome}</td>
                    <td className="py-2 pr-2 font-mono text-[11px]">
                      <OrdersCell orderIds={orderIds} />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-foreground">{row.guestName || "—"}</div>
                      <div className="text-muted-foreground">{row.guestPhone || ""}</div>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      ₹{(row.paymentAmountPaise / 100).toFixed(0)}
                    </td>
                    <td className="py-2 pr-2 uppercase">{row.environment}</td>
                    <td className="py-2 pr-2 font-mono text-[11px] break-all">
                      {row.qrCodeId || "—"}
                      {capturedPays.length > 0 && (
                        <div className="mt-0.5 text-muted-foreground">{capturedPays.join(", ")}</div>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <div>{row.state}</div>
                      {row.closeBy && (
                        <div className="text-muted-foreground">until {when(row.closeBy)}</div>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {canReconcile && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => void reconcile(row.id)}
                          >
                            {busyId === row.id ? "…" : "Reconcile"}
                          </Button>
                        )}
                        {closeable && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => void closeQr(row.id)}
                          >
                            Retire QR
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span>Page {page} of {totalPages} · 25 entries per page</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Button type="button" size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
    </section>
  );
}
