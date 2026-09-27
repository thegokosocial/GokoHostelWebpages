"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdminLoading } from "./AdminLoading";
import { RefreshCwIcon } from "lucide-react";
import { useAdminToast } from "@/components/admin/AdminToast";

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
  payments: Array<{ id: string; status: string; captured: number; amountPaise: number }>;
};

export function FoodPaymentsLedger({ password, username }: { password: string; username?: string }) {
  const { showError, showSuccess } = useAdminToast();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<FoodQrAttemptRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const res = await apiCall({ action: "listFoodQrAttempts", limit: 50 });
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

  if (loading) return <AdminLoading />;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-foreground">Food payments</h4>
          <p className="text-sm text-muted-foreground">Razorpay QR attempts for food bills (Cloudflare-only).</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" /> Reload
        </Button>
      </div>
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
                <th className="px-3 py-2">Guest</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Env</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {attempts.map((row) => {
                const pay = row.payments.find((p) => p.captured) || row.payments[0];
                return (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.guestName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.guestPhone || ""}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">₹{(row.paymentAmountPaise / 100).toFixed(0)}</td>
                    <td className="px-3 py-2 uppercase text-xs">{row.environment}</td>
                    <td className="px-3 py-2">{row.state}</td>
                    <td className="px-3 py-2 font-mono text-xs">{pay?.id || row.qrCodeId || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === row.id || row.state === "paid"}
                        onClick={() => void reconcile(row.id)}
                      >
                        {busyId === row.id ? "…" : "Reconcile"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
