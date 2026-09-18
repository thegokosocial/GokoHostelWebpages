"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Attempt = {
  id: string;
  createdAt: string;
  outcome: string;
  gokoBookingId: string | null;
  guestName: string;
  guestEmail: string;
  dueNowPaise: number;
  environment: string;
  razorpayOrderId: string | null;
  paymentIds: string[];
  state: string;
  closureReason: string | null;
};

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Management → Booking Settings → Payments: native website checkout attempts (test + live). */
export function WebsitePaymentsLedger({ password, username }: { password: string; username?: string }) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/booking-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "listWebsiteAttempts" }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load website payments");
      setAttempts(data.attempts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load website payments");
    } finally {
      setBusy(false);
    }
  }, [password, username]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mt-6 space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">Website payments</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Recent native checkout attempts (test and live). Search Razorpay by Goko booking ID in order notes, or open the booking in Admin.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {attempts.length === 0 && !busy && !error && (
        <p className="text-sm text-muted-foreground">No website checkout attempts yet.</p>
      )}
      {attempts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-2 font-medium">When</th>
                <th className="py-2 pr-2 font-medium">Outcome</th>
                <th className="py-2 pr-2 font-medium">Goko ID</th>
                <th className="py-2 pr-2 font-medium">Guest</th>
                <th className="py-2 pr-2 font-medium">Due</th>
                <th className="py-2 pr-2 font-medium">Env</th>
                <th className="py-2 pr-2 font-medium">Order / payments</th>
                <th className="py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-2 whitespace-nowrap">{when(a.createdAt)}</td>
                  <td className="py-2 pr-2 font-semibold">{a.outcome}</td>
                  <td className="py-2 pr-2 font-mono text-[11px] break-all">{a.gokoBookingId || "—"}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium text-foreground">{a.guestName}</div>
                    <div className="text-muted-foreground">{a.guestEmail}</div>
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">{money(a.dueNowPaise)}</td>
                  <td className="py-2 pr-2 uppercase">{a.environment}</td>
                  <td className="py-2 pr-2 font-mono text-[11px] break-all">
                    {a.razorpayOrderId || "—"}
                    {a.paymentIds.length > 0 && (
                      <div className="mt-0.5 text-muted-foreground">{a.paymentIds.join(", ")}</div>
                    )}
                  </td>
                  <td className="py-2">
                    <div>{a.state}</div>
                    {a.closureReason && <div className="text-muted-foreground">{a.closureReason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
