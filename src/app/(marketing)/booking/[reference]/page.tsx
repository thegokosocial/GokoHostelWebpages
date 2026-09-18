"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { site } from "@/lib/site";
import { GuestBookingManage, type GuestBookingStatus } from "@/components/booking/GuestBookingManage";

export default function BookingConfirmationPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(params.reference || "");
  const [status, setStatus] = useState<GuestBookingStatus | null>(null);
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
        const { guestAccessToken: token } = JSON.parse(stored) as { guestAccessToken: string };
        const res = await fetch("/api/guest-booking/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference, guestAccessToken: token }),
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
    if (!window.confirm("Cancel this booking? This cannot be undone online.")) return;
    setBusy(true);
    setMessage("");
    try {
      const stored = sessionStorage.getItem(`goko_booking_${reference}`);
      if (!stored) throw new Error("Missing booking access on this device");
      const { guestAccessToken: token } = JSON.parse(stored) as { guestAccessToken: string };
      const res = await fetch("/api/guest-booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, guestAccessToken: token }),
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

  return (
    <main className="mx-auto max-w-xl px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-brand-green-dark sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-green">Goko Hostel</p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">Your booking</h1>
      <p className="mt-2 text-sm text-brand-green sm:text-base">
        Keep this confirmation for check-in. Need a change? Message us on WhatsApp with your details.
      </p>

      {busy && !status && <p className="mt-8 text-sm">Loading your confirmation…</p>}

      {status && (
        <GuestBookingManage
          status={status}
          busy={busy}
          onCancel={status.canCancel ? cancel : undefined}
        />
      )}

      {message && (
        <p role="status" className="mt-5 rounded-xl bg-brand-sand px-4 py-3 text-sm leading-relaxed">
          {message}
        </p>
      )}

      <div className="mt-8">
        <Link
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-brand-green px-5 py-3 text-center font-semibold sm:w-auto"
          href="/book"
        >
          Back to booking
        </Link>
      </div>
    </main>
  );
}
