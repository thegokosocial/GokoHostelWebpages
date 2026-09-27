"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminLoading } from "./AdminLoading";
import { RefreshCwIcon } from "lucide-react";
import { useAdminToast } from "@/components/admin/AdminToast";
import {
  foodQrAttemptIsCloseable,
  foodQrAttemptMatchesQuery,
  foodQrAttemptOutcome,
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

export function FoodPaymentsLedger({ password, username }: { password: string; username?: string }) {
  const { showError, showSuccess } = useAdminToast();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<FoodQrAttemptRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");

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
    try {
      const res = await apiCall({ action: "listFoodQrAttempts", limit: 100 });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setAttempts(data.attempts || []);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Failed to load food payments");
    } finally {
      setLoading(false);
    }
  }, [apiCall, showError]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => attempts.filter((row) => foodQrAttemptMatchesQuery(row, query)),
    [attempts, query],
  );

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
      if (!res.ok) throw new Error(data.error || "Close failed");
      const n = Array.isArray(data.releasedAttemptIds) ? data.releasedAttemptIds.length : 0;
      showSuccess(n ? "QR closed — totals can be edited again" : "No open QR to close");
      await load();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Close failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <AdminLoading />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-foreground">Food payments</h4>
          <p className="text-sm text-muted-foreground">
            Razorpay QR attempts for food bills (Cloudflare-only).
            {" "}
            <span className="text-foreground/80">
              Reconcile pulls Razorpay (apply paid / expire closed). Close QR cancels an unpaid open QR so staff can edit totals.
            </span>
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" /> Reload
        </Button>
      </div>
      {attempts.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <label className="grid min-w-[12rem] flex-1 gap-1 text-xs font-medium text-muted-foreground">
            Search
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Guest, phone, order id, qr_ or pay_"
            />
          </label>
          <Button type="button" size="sm" onClick={() => setQuery(searchDraft.trim())}>Search</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { setSearchDraft(""); setQuery(""); }}
          >
            Clear
          </Button>
        </div>
      )}
      {!attempts.length ? (
        <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
          No food QR payment attempts yet. Enable Razorpay mode in Bill Settings, then open an unpaid bill.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Orders</th>
                <th className="px-3 py-2">Guest</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Env</th>
                <th className="px-3 py-2">QR / payments</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const outcome = foodQrAttemptOutcome(row);
                const orderIds = parseFoodQrOrderIds(row.foodOrderIds);
                const capturedPays = row.payments.filter((p) => Number(p.captured) === 1).map((p) => p.id);
                const closeable = foodQrAttemptIsCloseable(row.state);
                return (
                  <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {when(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-semibold">{outcome}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {orderIds.length ? orderIds.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.guestName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.guestPhone || ""}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      ₹{(row.paymentAmountPaise / 100).toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-xs uppercase">{row.environment}</td>
                    <td className="px-3 py-2 font-mono text-[11px] break-all">
                      {row.qrCodeId || "—"}
                      {capturedPays.length > 0 && (
                        <div className="mt-0.5 text-muted-foreground">{capturedPays.join(", ")}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.state}</div>
                      {row.closeBy && (
                        <div className="text-[11px] text-muted-foreground">
                          until {when(row.closeBy)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyId === row.id || row.state === "paid"}
                          onClick={() => void reconcile(row.id)}
                        >
                          {busyId === row.id ? "…" : "Reconcile"}
                        </Button>
                        {closeable && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => void closeQr(row.id)}
                          >
                            Close QR
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No attempts match this search.</p>
          )}
        </div>
      )}
    </section>
  );
}
