"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { bookingGateCopy } from "@/content/bookingGate";
import { site } from "@/lib/site";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type View = "idle" | "main" | "early" | "terms";

type BookingGateContextValue = {
  openBookingGate: () => void;
};

const BookingGateContext = createContext<BookingGateContextValue | null>(null);

export function useBookingGate() {
  const ctx = useContext(BookingGateContext);
  if (!ctx) {
    throw new Error("useBookingGate must be used within BookingGateProvider");
  }
  return ctx;
}

export function BookingGateProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("idle");
  const [mainAgreed, setMainAgreed] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);

  const openBookingGate = useCallback(() => {
    setMainAgreed(false);
    setTermsAgreed(false);
    setView("main");
  }, []);

  const closeAll = useCallback(() => {
    setView("idle");
    setMainAgreed(false);
    setTermsAgreed(false);
  }, []);

  const goBooking = useCallback(() => {
    window.open(site.bookingUrl, "_blank", "noopener,noreferrer");
    closeAll();
  }, [closeAll]);

  const overlayClick = () => {
    if (view === "main") closeAll();
    else if (view === "early" || view === "terms") setView("main");
  };

  useEffect(() => {
    if (view === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [view]);

  useEffect(() => {
    if (view === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view === "terms" || view === "early") setView("main");
      else closeAll();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, closeAll]);

  const value: BookingGateContextValue = { openBookingGate };

  return (
    <BookingGateContext.Provider value={value}>
      {children}
      {view !== "idle" ? (
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center bg-brand-green-dark/70 p-3 backdrop-blur-sm md:p-6"
          role="presentation"
          onClick={overlayClick}
        >
          <div
            className={cn(
              "w-full max-w-lg rounded-2xl border-2 border-brand-mist bg-gradient-to-b from-brand-sand to-white shadow-[0_25px_80px_rgba(0,0,0,0.22)]",
              view === "terms"
                ? "flex max-h-[min(92vh,880px)] flex-col overflow-hidden"
                : "max-h-[min(92vh,880px)] overflow-y-auto"
            )}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            {view === "main" ? (
              <MainGateBody
                mainAgreed={mainAgreed}
                setMainAgreed={setMainAgreed}
                onClose={closeAll}
                onEarly={() => setView("early")}
                onTerms={() => setView("terms")}
                onReserve={() => {
                  if (mainAgreed) goBooking();
                }}
              />
            ) : null}
            {view === "early" ? (
              <EarlyCheckinBody onBack={() => setView("main")} />
            ) : null}
            {view === "terms" ? (
              <TermsBody
                termsAgreed={termsAgreed}
                setTermsAgreed={setTermsAgreed}
                onBack={() => {
                  setTermsAgreed(false);
                  setView("main");
                }}
                onAgreeReserve={() => {
                  if (termsAgreed) {
                    setMainAgreed(true);
                    goBooking();
                  }
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </BookingGateContext.Provider>
  );
}

function MainGateBody({
  mainAgreed,
  setMainAgreed,
  onClose,
  onEarly,
  onTerms,
  onReserve,
}: {
  mainAgreed: boolean;
  setMainAgreed: (v: boolean) => void;
  onClose: () => void;
  onEarly: () => void;
  onTerms: () => void;
  onReserve: () => void;
}) {
  const c = bookingGateCopy;
  return (
    <>
      <div className="relative border-b border-dashed border-brand-mist/80 px-5 pb-3 pt-4 text-center md:px-6">
        <button
          type="button"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-brand-green/70 transition hover:bg-brand-mist hover:text-brand-green-dark focus-visible:goko-focus"
          aria-label="Close"
          onClick={onClose}
        >
          <span className="text-xl leading-none" aria-hidden>
            ×
          </span>
        </button>
        <h2 className="font-display text-xl font-bold uppercase tracking-wide text-brand-green md:text-2xl">
          {c.mainTitle}
        </h2>
      </div>
      <div className="px-5 py-4 md:px-6">
        <p className="text-sm font-semibold text-brand-green-dark">
          {c.pleaseNote}
        </p>
        <ul className="mt-3 space-y-2">
          {c.notes.map((n) => (
            <li key={n.strong} className="flex gap-2 text-sm leading-snug text-brand-green-dark/90">
              <span aria-hidden>{n.icon}</span>
              <span>
                <strong className="text-brand-green-dark">{n.strong}</strong>
                {n.rest}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden>🚪</span>
            <span className="font-semibold text-brand-red">{c.checkInLabel}</span>
            <span>{c.checkInValue}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden>🎒</span>
            <span className="font-semibold text-brand-red">{c.checkOutLabel}</span>
            <span>{c.checkOutValue}</span>
          </span>
        </div>
        <button
          type="button"
          className="mt-2 text-left text-sm font-medium text-brand-green underline-offset-2 hover:underline"
          onClick={onEarly}
        >
          {c.earlyLinkLabel}
        </button>
        <div className="my-4 h-px bg-gradient-to-r from-transparent via-brand-mist to-transparent" />
        <div className="rounded-xl border border-brand-mist bg-white/90 p-4">
          <p className="text-center text-sm font-semibold text-brand-green-dark">
            {c.managementWarning}
          </p>
          <div className="mt-3 flex gap-2 rounded-lg bg-brand-sand/80 p-3 text-sm text-brand-green-dark/90">
            <span aria-hidden>📬</span>
            <p>
              {c.reachOutBefore}{" "}
              <a
                href={site.whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-green underline-offset-2 hover:underline"
              >
                {c.whatsappLabel}
              </a>
              .
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-4 border-t border-brand-mist bg-brand-sand/30 px-5 py-5 md:px-6">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={mainAgreed}
            onChange={(e) => setMainAgreed(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-brand-mist text-brand-green focus:ring-brand-green"
          />
          <span className="text-sm text-brand-green-dark/95">
            {c.agreeLabelBefore}
            <button
              type="button"
              className="font-semibold text-brand-red underline-offset-2 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                onTerms();
              }}
            >
              {c.termsInlineLabel}
            </button>
          </span>
        </label>
        <Button
          type="button"
          variant="primary"
          className="w-full disabled:opacity-45"
          disabled={!mainAgreed}
          onClick={onReserve}
        >
          {c.reserveCta}
        </Button>
        <p className="flex items-start justify-center gap-2 text-center text-xs text-brand-green-dark/80">
          <span aria-hidden>📢</span>
          <span>
            {c.redirectNoteLine1}{" "}
            <strong className="text-brand-green-dark">{c.redirectPartner}</strong>
          </span>
        </p>
      </div>
    </>
  );
}

function EarlyCheckinBody({ onBack }: { onBack: () => void }) {
  const e = bookingGateCopy.early;
  return (
    <>
      <div className="relative border-b border-brand-mist px-5 pb-4 pt-4 text-center md:px-6">
        <button
          type="button"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-brand-green/70 hover:bg-brand-mist focus-visible:goko-focus"
          aria-label="Back"
          onClick={onBack}
        >
          <span className="text-xl" aria-hidden>
            ×
          </span>
        </button>
        <p className="text-2xl" aria-hidden>
          ⏰
        </p>
        <h3 className="mt-2 font-display text-lg font-bold text-brand-green md:text-xl">
          {e.title}
        </h3>
      </div>
      <div className="space-y-4 px-5 py-5 md:px-6">
        <div className="flex gap-3 rounded-xl border border-brand-mist bg-white p-4">
          <span className="text-xl" aria-hidden>
            🛏️
          </span>
          <p className="text-sm leading-relaxed text-brand-green-dark/90">{e.body}</p>
        </div>
        <ul className="space-y-2 text-sm text-brand-green-dark/90">
          {e.amenities.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span className="text-brand-red" aria-hidden>
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
        <div className="flex gap-3 rounded-xl bg-brand-mist/50 p-4">
          <span aria-hidden>🎒</span>
          <p className="text-sm leading-relaxed text-brand-green-dark/90">
            {e.checkoutNote}
          </p>
        </div>
        <Button type="button" variant="secondary" className="w-full" onClick={onBack}>
          {e.thanksCta}
        </Button>
      </div>
    </>
  );
}

function TermsBody({
  termsAgreed,
  setTermsAgreed,
  onBack,
  onAgreeReserve,
}: {
  termsAgreed: boolean;
  setTermsAgreed: (v: boolean) => void;
  onBack: () => void;
  onAgreeReserve: () => void;
}) {
  const t = bookingGateCopy.terms;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 border-b border-brand-mist px-5 pb-3 pt-4 text-center md:px-6">
        <button
          type="button"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-brand-green/70 hover:bg-brand-mist focus-visible:goko-focus"
          aria-label="Back"
          onClick={onBack}
        >
          <span className="text-xl" aria-hidden>
            ×
          </span>
        </button>
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">
          {t.title}
        </h2>
        <p className="mt-1 text-xs text-brand-green-dark/70">{t.lastUpdated}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
        <p className="text-sm leading-relaxed text-brand-green-dark/90">{t.intro}</p>
        <div className="mt-5 space-y-5">
          {t.sections.map((sec) => (
            <section key={sec.title} className="rounded-xl border border-brand-mist bg-white/80 p-4">
              <div className="flex items-center gap-2">
                <span aria-hidden>{sec.icon}</span>
                <h3 className="font-display text-base font-bold text-brand-green-dark">
                  {sec.title}
                </h3>
              </div>
              <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-brand-green-dark/90">
                {sec.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-5 rounded-xl border-2 border-brand-mist bg-amber-50/80 p-4">
          <p className="flex items-center gap-2 font-display text-sm font-bold text-brand-green-dark">
            <span aria-hidden>⚡</span>
            {t.importantTitle}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-brand-green-dark/90">
            {t.importantBody}
          </p>
        </div>
        <div className="mt-4 space-y-1 text-center text-sm text-brand-green-dark/80">
          <p>
            <span aria-hidden>🚀 </span>
            {t.footerName}
          </p>
          <p>
            <span aria-hidden>📍 </span>
            {t.footerTagline}
          </p>
        </div>
      </div>
      <div className="shrink-0 space-y-4 border-t border-brand-mist bg-brand-sand/40 px-5 py-4 md:px-6">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={termsAgreed}
            onChange={(e) => setTermsAgreed(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-brand-mist text-brand-green focus:ring-brand-green"
          />
          <span className="text-sm text-brand-green-dark/95">{t.agreeCheckbox}</span>
        </label>
        <Button
          type="button"
          variant="primary"
          className="w-full disabled:opacity-45"
          disabled={!termsAgreed}
          onClick={onAgreeReserve}
        >
          {t.agreeCta}
        </Button>
        <p className="flex items-start justify-center gap-2 text-center text-xs text-brand-green-dark/80">
          <span aria-hidden>📢</span>
          <span>
            {bookingGateCopy.redirectNoteLine1}{" "}
            <strong className="text-brand-green-dark">{bookingGateCopy.redirectPartner}</strong>
          </span>
        </p>
      </div>
    </div>
  );
}
