"use client";

import { useEffect } from "react";

export type CheckoutWaitPhase =
  | "preparing"
  | "awaiting_payment"
  | "confirming"
  | "finishing";

const COPY: Record<CheckoutWaitPhase, { title: string; body: string }> = {
  preparing: {
    title: "Securing your beds",
    body: "Please wait while we reserve your stay. Do not press Back or close this page.",
  },
  awaiting_payment: {
    title: "Complete payment securely",
    body: "Finish in the payment window. Keep this tab open — do not refresh or go back.",
  },
  confirming: {
    title: "Confirming your payment",
    body: "Almost done. Please wait — do not press Back or close this page.",
  },
  finishing: {
    title: "Opening your confirmation",
    body: "Your booking is confirmed. Taking you to the confirmation page…",
  },
};

/** Full-screen wait state for guest checkout / payment. Non-dismissible. */
export function CheckoutWaitOverlay({ phase }: { phase: CheckoutWaitPhase | null }) {
  useEffect(() => {
    if (!phase) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Do not warn on `finishing` — that phase navigates to confirmation and must not block.
    if (phase === "finishing") {
      return () => { document.body.style.overflow = previous; };
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.body.style.overflow = previous;
    };
  }, [phase]);

  if (!phase) return null;
  const copy = COPY[phase];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="checkout-wait-title"
      aria-describedby="checkout-wait-body"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-brand-green-dark/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center text-brand-green-dark shadow-2xl sm:p-8">
        <div
          className="mx-auto size-12 animate-spin rounded-full border-[3px] border-brand-mist border-t-brand-green"
          aria-hidden="true"
        />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-green">Goko Hostel</p>
        <h2 id="checkout-wait-title" className="mt-2 font-display text-2xl font-bold leading-tight">
          {copy.title}
        </h2>
        <p id="checkout-wait-body" className="mt-3 text-sm leading-relaxed text-brand-green-dark/85">
          {copy.body}
        </p>
        <p className="mt-5 rounded-xl bg-brand-sand px-3 py-2.5 text-xs leading-relaxed text-brand-green-dark">
          Stay on this page until confirmation opens. Leaving early can interrupt payment.
        </p>
      </div>
    </div>
  );
}
