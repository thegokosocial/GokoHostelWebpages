"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { site } from "@/lib/site";

const money = (rupees: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);

type Status = {
  reference: string | null;
  bookingStatus: string | null;
  state: string;
  checkinDate: string | null;
  checkoutDate: string | null;
  guestName: string;
  amountTotal: number | null;
  amountPaid: number | null;
  canCancel?: boolean;
  error?: string;
};

function statusLabel(bookingStatus: string | null, checkoutState: string) {
  if (bookingStatus === "cancelled" || checkoutState === "cancelled") return "Cancelled";
  if (checkoutState === "fulfilled" || bookingStatus === "received") return "Confirmed";
  if (checkoutState === "expired") return "Expired";
  if (checkoutState === "captured_unfulfilled") return "Payment received — assigning beds";
  return checkoutState.replace(/_/g, " ");
}

export default function BookingConfirmationPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(params.reference || "");
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setBusy(true);
      try {
        const stored = sessionStorage.getItem(`goko_booking_${reference}`);
        if (!stored) {
          if (active) {
            setMessage("Open this page from the same browser after checkout, or use My booking on /book with your email.");
          }
          return;
        }
        const { guestAccessToken } = JSON.parse(stored) as { guestAccessToken: string };
        const res = await fetch("/api/guest-booking/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference, guestAccessToken }),
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load booking");
        if (active) setStatus(data);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Unable to load booking");
      } finally {
        if (active) setBusy(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [reference]);

  async function cancel() {
    setBusy(true);
    setMessage("");
    try {
      const stored = sessionStorage.getItem(`goko_booking_${reference}`);
      if (!stored) throw new Error("Missing booking access on this device");
      const { guestAccessToken } = JSON.parse(stored) as { guestAccessToken: string };
      const res = await fetch("/api/guest-booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, guestAccessToken }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to cancel");
      setStatus(data);
      setMessage("Booking cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to cancel");
    } finally {
      setBusy(false);
    }
  }

  const label = status ? statusLabel(status.bookingStatus, status.state) : null;
  const confirmed = label === "Confirmed";

  return (
    <main className="mx-auto max-w-xl px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-brand-green-dark sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-green">Goko Hostel</p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">Your booking</h1>
      <p className="mt-2 break-all text-sm text-brand-green sm:text-base">{reference}</p>

      {busy && !status && <p className="mt-8 text-sm">Loading your confirmation…</p>}

      {status && (
        <div className="mt-8 space-y-5 rounded-2xl border border-brand-mist bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                confirmed
                  ? "bg-brand-green/15 text-brand-green-dark"
                  : label === "Cancelled" || label === "Expired"
                    ? "bg-brand-sand text-brand-green-dark"
                    : "bg-amber-50 text-amber-950"
              }`}
            >
              {label}
            </span>
          </div>
          <div>
            <p className="text-lg font-semibold sm:text-xl">{status.guestName}</p>
            <p className="mt-1 text-sm sm:text-base">
              {status.checkinDate} – {status.checkoutDate}
            </p>
          </div>
          <dl className="grid gap-3 border-t border-brand-mist pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-brand-green">Total</dt>
              <dd className="mt-0.5 font-semibold">{status.amountTotal == null ? "—" : money(status.amountTotal)}</dd>
            </div>
            <div>
              <dt className="text-brand-green">Paid</dt>
              <dd className="mt-0.5 font-semibold">{status.amountPaid == null ? "—" : money(status.amountPaid)}</dd>
            </div>
          </dl>
          {status.canCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="min-h-12 w-full rounded-lg border border-brand-red px-4 py-3 font-semibold text-brand-red disabled:opacity-50 sm:w-auto"
            >
              Cancel booking
            </button>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="mt-5 rounded-xl bg-brand-sand px-4 py-3 text-sm leading-relaxed">
          {message}
        </p>
      )}

      <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap sm:gap-4">
        <Link
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand-green px-5 py-3 text-center font-semibold text-white"
          href="/book"
        >
          Back to booking
        </Link>
        <a
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-green px-5 py-3 text-center font-semibold"
          href={site.whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp Goko
        </a>
      </div>
    </main>
  );
}
