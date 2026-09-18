"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { GuestRoom } from "@/lib/guestBookingSearch";
import { bookingTotals } from "@/lib/bookingPricing";
import { canAddGuestRoom } from "@/lib/guestBookingSelection";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { CheckoutWaitOverlay, type CheckoutWaitPhase } from "@/components/booking/CheckoutWaitOverlay";
import {
  armUnpaidCheckoutAbandon, clearUnpaidCheckoutAbandon, bindUnpaidCheckoutPageHide,
  abandonUnpaidCheckoutBeacon,
} from "@/lib/guestCheckoutAbandonClient";
import { site } from "@/lib/site";
import { todayIST } from "@/lib/utils";

const actionBtn = "min-h-12 rounded-lg bg-brand-red px-4 py-3 font-semibold text-white disabled:opacity-50";
const money = (rupees: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);

async function readResponse(response: Response) {
  const data = await response.json().catch(() => {
    throw new Error("Could not reach Goko. Please try again.");
  });
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}

type Props = {
  reference: string;
  guestAccessToken: string;
  initialCheckin: string;
  initialCheckout: string;
  onDone: (status: Record<string, unknown>) => void;
  onCancel: () => void;
};

export function GuestBookingAmendPanel({
  reference, guestAccessToken, initialCheckin, initialCheckout, onDone, onCancel,
}: Props) {
  const [stay, setStay] = useState({ checkinDate: initialCheckin, checkoutDate: initialCheckout });
  const [rooms, setRooms] = useState<GuestRoom[] | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [plans, setPlans] = useState<Record<string, number>>({});
  const [taxPercent, setTaxPercent] = useState<number | null>(null);
  const [maxSelectedBeds, setMaxSelectedBeds] = useState<number | null>(null);
  const [quote, setQuote] = useState<{
    totalRupees: number; deltaPaise: number; dueNowPaise: number; refundPaise: number; requiresPayment: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutWait, setCheckoutWait] = useState<CheckoutWaitPhase | null>(null);
  const [message, setMessage] = useState("");
  const [requestKey, setRequestKey] = useState<string | null>(null);

  useEffect(() => bindUnpaidCheckoutPageHide(), []);

  const selectedCount = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0), 0) || 0;
  const chosenRate = (room: GuestRoom) => room.rates?.find((r) => r.id === plans[room.id]) ?? room.rates?.[0];
  const subtotal = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0) * (chosenRate(room)?.subtotalRupees || 0), 0) || 0;
  const totals = taxPercent == null ? null : bookingTotals(subtotal, { taxPercent });
  const ready = !!rooms && maxSelectedBeds != null && selectedCount > 0 && selectedCount <= maxSelectedBeds
    && rooms.every((room) => !selection[room.id] || (selection[room.id] <= room.availableUnits && !!chosenRate(room)));

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!stay.checkinDate || !stay.checkoutDate || stay.checkoutDate <= stay.checkinDate) {
      setMessage("Choose valid check-in and check-out dates.");
      return;
    }
    setBusy(true); setMessage(""); setRooms(null); setSelection({}); setPlans({}); setQuote(null);
    try {
      const data = await readResponse(await fetch("/api/guest-booking/amend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "availability", reference, guestAccessToken,
          checkinDate: stay.checkinDate, checkoutDate: stay.checkoutDate,
        }),
        cache: "no-store", signal: AbortSignal.timeout(15000),
      }));
      setRooms(data.rooms); setTaxPercent(data.taxPercent); setMaxSelectedBeds(data.maxSelectedBeds);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search.");
    } finally { setBusy(false); }
  }

  function addRoom(room: GuestRoom, planId: number) {
    setSelection((current) => canAddGuestRoom(rooms || [], current, room, maxSelectedBeds ?? 0)
      ? { ...current, [room.id]: (current[room.id] || 0) + 1 }
      : current);
    setPlans((current) => ({ ...current, [room.id]: planId }));
    setQuote(null);
  }

  function roomPayload() {
    return (rooms || []).filter((room) => selection[room.id]).map((room) => ({
      roomId: room.id, quantity: selection[room.id], ratePlanId: chosenRate(room)!.id,
    }));
  }

  async function getQuote() {
    if (!ready) return;
    setBusy(true); setMessage("");
    try {
      const data = await readResponse(await fetch("/api/guest-booking/amend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quote", reference, guestAccessToken, requestKey: crypto.randomUUID(),
          checkinDate: stay.checkinDate, checkoutDate: stay.checkoutDate, rooms: roomPayload(),
        }),
        cache: "no-store", signal: AbortSignal.timeout(20000),
      }));
      setQuote({
        totalRupees: data.totalRupees, deltaPaise: data.deltaPaise,
        dueNowPaise: data.dueNowPaise, refundPaise: data.refundPaise,
        requiresPayment: data.requiresPayment,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not quote change.");
    } finally { setBusy(false); }
  }

  function loadRazorpay(): Promise<void> {
    if (typeof window !== "undefined" && (window as unknown as { Razorpay?: unknown }).Razorpay) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load payment checkout"));
      document.body.appendChild(script);
    });
  }

  async function applyChange() {
    if (!ready || !quote) return;
    setBusy(true); setMessage(""); setCheckoutWait("preparing");
    try {
      const key = requestKey || crypto.randomUUID();
      if (!requestKey) setRequestKey(key);
      const prepared = await readResponse(await fetch("/api/guest-booking/amend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare", reference, guestAccessToken, requestKey: key,
          checkinDate: stay.checkinDate, checkoutDate: stay.checkoutDate, rooms: roomPayload(),
        }),
        cache: "no-store", signal: AbortSignal.timeout(30000),
      }));

      if (prepared.requiresPayment && prepared.razorpay && prepared.ownerToken && prepared.checkoutId) {
        setCheckoutWait("awaiting_payment");
        armUnpaidCheckoutAbandon({ checkoutId: prepared.checkoutId, ownerToken: prepared.ownerToken });
        await loadRazorpay();
        const claimed = await readResponse(await fetch("/api/guest-booking/amend", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "claim", checkoutId: prepared.checkoutId, ownerToken: prepared.ownerToken,
          }),
          cache: "no-store",
        }));
        const checkout = claimed.checkout || prepared.razorpay;
        await new Promise<void>((resolve, reject) => {
          const rzp = new (window as unknown as {
            Razorpay: new (o: Record<string, unknown>) => {
              open: () => void;
              on: (e: string, fn: () => void) => void;
            };
          }).Razorpay({
            key: checkout.key, amount: checkout.amount, currency: checkout.currency, order_id: checkout.order_id,
            name: site.shortName, description: "Booking change",
            handler: async (response: {
              razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string;
            }) => {
              try {
                setCheckoutWait("confirming");
                const verified = await readResponse(await fetch("/api/guest-booking/payment/verify", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    checkoutId: prepared.checkoutId, ownerToken: prepared.ownerToken,
                    paymentId: response.razorpay_payment_id, orderId: response.razorpay_order_id,
                    signature: response.razorpay_signature,
                  }),
                  cache: "no-store", signal: AbortSignal.timeout(20000),
                }));
                clearUnpaidCheckoutAbandon();
                onDone(verified);
                resolve();
              } catch (error) { reject(error); }
            },
            modal: { ondismiss: async () => {
              try {
                await fetch("/api/guest-booking/abandon", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ checkoutId: prepared.checkoutId, ownerToken: prepared.ownerToken }),
                  cache: "no-store",
                });
              } catch { /* ignore */ }
              clearUnpaidCheckoutAbandon();
              reject(new Error("Payment window closed."));
            } },
            theme: { color: "#1B4D3E" },
            retry: { enabled: false },
          });
          rzp.open();
        });
      } else if (prepared.checkoutId) {
        const confirmed = await readResponse(await fetch("/api/guest-booking/amend", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "confirm", reference, guestAccessToken,
            checkoutId: prepared.checkoutId, ownerToken: prepared.ownerToken || undefined,
          }),
          cache: "no-store", signal: AbortSignal.timeout(30000),
        }));
        clearUnpaidCheckoutAbandon();
        onDone(confirmed);
      }
    } catch (error) {
      abandonUnpaidCheckoutBeacon();
      setCheckoutWait(null);
      setMessage(error instanceof Error ? error.message : "Could not apply change.");
    } finally {
      setBusy(false);
      setCheckoutWait(null);
    }
  }

  return (
    <>
    <CheckoutWaitOverlay phase={checkoutWait} />
    <div className="mt-6 space-y-4 rounded-2xl border border-brand-mist bg-brand-sand/40 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-brand-green-dark">Change your stay</h2>
          <p className="mt-1 text-sm text-brand-green">
            New dates and rooms. You pay only the difference, or get a refund if the total drops.
          </p>
        </div>
        <button type="button" onClick={onCancel} disabled={!!checkoutWait} className="min-h-10 shrink-0 text-sm font-semibold text-brand-green-dark underline disabled:opacity-40">
          Close
        </button>
      </div>

      <form onSubmit={search} className="space-y-3">
        <label className="block text-sm font-semibold">
          Dates
          <DateRangePicker
            className="mt-1"
            variant="marketing"
            required
            disabled={busy}
            minDate={todayIST()}
            maxNights={30}
            startDate={stay.checkinDate}
            endDate={stay.checkoutDate}
            onChange={({ startDate, endDate }) => {
              setStay({ checkinDate: startDate, checkoutDate: endDate });
              setRooms(null);
              setQuote(null);
            }}
          />
        </label>
        <button type="submit" disabled={busy} className={actionBtn}>Check availability</button>
      </form>

      {rooms && (
        <div className="space-y-3">
          {rooms.length === 0 ? (
            <p className="text-sm">No online beds for these dates. Try different dates.</p>
          ) : rooms.map((room) => (
            <div key={room.id} className="rounded-xl border border-brand-mist bg-white p-3">
              <p className="font-semibold">{room.name} · {room.type === "Double" ? "Whole double" : "Single bed"}</p>
              <p className="text-sm text-brand-green">{room.availableUnits} available</p>
              {(room.rates || []).map((rate) => (
                <div key={rate.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{rate.name}: {money(rate.subtotalRupees)}</span>
                  <button
                    type="button"
                    disabled={busy || !canAddGuestRoom(rooms, selection, room, maxSelectedBeds ?? 0)}
                    onClick={() => addRoom(room, rate.id)}
                    className="min-h-10 rounded-lg border border-brand-green px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
                  >
                    Add{(selection[room.id] || 0) > 0 ? ` (${selection[room.id]})` : ""}
                  </button>
                </div>
              ))}
            </div>
          ))}
          {totals && selectedCount > 0 && (
            <p className="text-sm">Estimate: {money(totals.total)} incl. tax · {selectedCount} unit{selectedCount === 1 ? "" : "s"}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !ready} onClick={getQuote} className={actionBtn}>
              Review price difference
            </button>
            {selectedCount > 0 && (
              <button type="button" disabled={busy} onClick={() => { setSelection({}); setQuote(null); }}
                className="min-h-12 rounded-lg border border-brand-green px-4 py-3 font-semibold">
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}

      {quote && (
        <div className="space-y-3 rounded-xl border border-brand-green/20 bg-white p-4">
          <p className="font-semibold">New total: {money(quote.totalRupees)}</p>
          {quote.deltaPaise > 0 && <p className="text-sm">Pay now: {money(quote.dueNowPaise / 100)}</p>}
          {quote.deltaPaise < 0 && <p className="text-sm">Refund: {money(quote.refundPaise / 100)}</p>}
          {quote.deltaPaise === 0 && <p className="text-sm">No payment change.</p>}
          <button type="button" disabled={busy || !!checkoutWait} onClick={applyChange} className={actionBtn}>
            {checkoutWait
              ? "Please wait…"
              : quote.requiresPayment ? "Pay difference" : "Confirm change"}
          </button>
        </div>
      )}

      {message && <p role="status" className="text-sm text-brand-red">{message}</p>}
    </div>
    </>
  );
}
