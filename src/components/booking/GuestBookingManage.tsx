"use client";

import { useState } from "react";
import {
  buildBookingChangeRequestText,
  formatPaymentChoice,
  type GuestRoomLine,
} from "@/lib/guestBookingDetails";
import { site } from "@/lib/site";

const money = (rupees: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);

export type GuestBookingStatus = {
  reference: string | null;
  bookingStatus: string | null;
  state: string;
  checkinDate: string | null;
  checkoutDate: string | null;
  guestName: string;
  email?: string;
  phone?: string;
  amountTotal: number | null;
  amountPaid: number | null;
  amountRefunded?: number | null;
  dueAtPropertyPaise?: number | null;
  rooms?: GuestRoomLine[];
  nights?: number;
  persons?: number | null;
  roomType?: string | null;
  beforeTaxRupees?: number | null;
  taxRupees?: number | null;
  taxPercent?: number | null;
  paymentChoice?: string | null;
  canCancel?: boolean;
  canModify?: boolean;
  cancellationDeadlineAt?: string | null;
  stayUpdatedAt?: string | null;
  error?: string;
};

function statusLabel(bookingStatus: string | null, checkoutState: string) {
  if (bookingStatus === "cancelled" || checkoutState === "cancelled") return "Cancelled";
  if (checkoutState === "fulfilled" || bookingStatus === "received") return "Confirmed";
  if (checkoutState === "expired") return "Expired";
  if (checkoutState === "captured_unfulfilled") return "Payment received — assigning beds";
  return checkoutState.replace(/_/g, " ");
}

function formatDeadline(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

type Props = {
  status: GuestBookingStatus;
  busy?: boolean;
  onCancel?: () => void;
};

export function GuestBookingManage({ status, busy, onCancel }: Props) {
  const [copied, setCopied] = useState(false);
  const label = statusLabel(status.bookingStatus, status.state);
  const confirmed = label === "Confirmed";
  const dueRupees = status.dueAtPropertyPaise != null
    ? Math.round(status.dueAtPropertyPaise / 100)
    : status.amountTotal != null && status.amountPaid != null
      ? Math.max(0, status.amountTotal - status.amountPaid)
      : null;
  const deadline = formatDeadline(status.cancellationDeadlineAt);
  const updatedAt = formatDeadline(status.stayUpdatedAt);
  const reference = status.reference || "—";
  const changeText = buildBookingChangeRequestText({
    reference,
    guestName: status.guestName,
    checkinDate: status.checkinDate,
    checkoutDate: status.checkoutDate,
    nights: status.nights,
    rooms: status.rooms,
    amountTotal: status.amountTotal,
    amountPaid: status.amountPaid,
    dueRupees,
  });
  const whatsappHref = `${site.whatsAppUrl}?text=${encodeURIComponent(changeText)}`;

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(changeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-brand-mist bg-white shadow-sm">
      <div className="border-b border-brand-mist bg-brand-sand/50 px-5 py-4 sm:px-7 sm:py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              confirmed
                ? "bg-brand-green/15 text-brand-green-dark"
                : label === "Cancelled" || label === "Expired"
                  ? "bg-white text-brand-green-dark"
                  : "bg-amber-50 text-amber-950"
            }`}
          >
            {label}
          </span>
          {updatedAt && confirmed && (
            <span className="rounded-full bg-brand-sand px-3 py-1.5 text-xs font-semibold text-brand-green-dark">
              Updated
            </span>
          )}
          {status.paymentChoice && (
            <span className="text-xs text-brand-green">{formatPaymentChoice(status.paymentChoice)}</span>
          )}
        </div>
        <p className="mt-3 font-display text-2xl font-bold leading-tight sm:text-3xl">{status.guestName}</p>
        <p className="mt-1 text-sm text-brand-green">
          Confirmation <span className="font-semibold text-brand-green-dark break-all">{reference}</span>
        </p>
        <p className="mt-3 text-base font-semibold sm:text-lg">
          {status.checkinDate} – {status.checkoutDate}
          {status.nights != null && status.nights > 0
            ? ` · ${status.nights} ${status.nights === 1 ? "night" : "nights"}`
            : ""}
        </p>
        {updatedAt && (
          <p className="mt-2 text-sm text-brand-green">
            Your stay was updated on {updatedAt}. The details below are current.
            {dueRupees != null && dueRupees > 0 ? " Any extra amount is due at the hostel." : ""}
          </p>
        )}
        {(status.email || status.phone) && (
          <p className="mt-1 text-xs text-brand-green">
            {[status.email, status.phone].filter(Boolean).join(" · ")}
          </p>
        )}
        {status.persons != null && (
          <p className="mt-1 text-sm text-brand-green">Sleeps up to {status.persons}</p>
        )}
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
        {!!status.rooms?.length && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-green">Rooms</h2>
            <ul className="mt-2 divide-y divide-brand-mist border-y border-brand-mist">
              {status.rooms.map((room) => (
                <li key={`${room.dormId}-${room.type}`} className="flex justify-between gap-3 py-3 text-sm">
                  <span>{room.label}</span>
                  <span className="shrink-0 font-semibold">{money(room.subtotalRupees)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-green">Payment</h2>
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            {status.beforeTaxRupees != null && (
              <div className="rounded-xl bg-brand-sand/40 px-3 py-2.5">
                <dt className="text-xs text-brand-green">Subtotal</dt>
                <dd className="mt-0.5 font-semibold">{money(status.beforeTaxRupees)}</dd>
              </div>
            )}
            {status.taxRupees != null && (
              <div className="rounded-xl bg-brand-sand/40 px-3 py-2.5">
                <dt className="text-xs text-brand-green">
                  Tax{status.taxPercent != null ? ` (${status.taxPercent}%)` : ""}
                </dt>
                <dd className="mt-0.5 font-semibold">{money(status.taxRupees)}</dd>
              </div>
            )}
            <div className="rounded-xl bg-brand-sand/40 px-3 py-2.5">
              <dt className="text-xs text-brand-green">Total</dt>
              <dd className="mt-0.5 font-semibold">{status.amountTotal == null ? "—" : money(status.amountTotal)}</dd>
            </div>
            <div className="rounded-xl bg-brand-sand/40 px-3 py-2.5">
              <dt className="text-xs text-brand-green">Paid</dt>
              <dd className="mt-0.5 font-semibold">{status.amountPaid == null ? "—" : money(status.amountPaid)}</dd>
            </div>
            {dueRupees != null && (
              <div className={`rounded-xl px-3 py-2.5 sm:col-span-2 ${dueRupees > 0 ? "bg-brand-green/10 ring-1 ring-brand-green/20" : "bg-brand-sand/40"}`}>
                <dt className="text-xs text-brand-green">Due at property</dt>
                <dd className="mt-0.5 text-lg font-bold">{money(dueRupees)}</dd>
              </div>
            )}
            {status.amountRefunded != null && status.amountRefunded > 0 && (
              <div className="rounded-xl bg-brand-sand/40 px-3 py-2.5 sm:col-span-2">
                <dt className="text-xs text-brand-green">Refunded</dt>
                <dd className="mt-0.5 font-semibold">{money(status.amountRefunded)}</dd>
              </div>
            )}
          </dl>
        </div>

        {deadline && status.canCancel && (
          <p className="text-xs leading-relaxed text-brand-green">
            Online cancellation available until {deadline} IST.
          </p>
        )}

        <div className="space-y-3 border-t border-brand-mist pt-4">
          <p className="text-sm leading-relaxed text-brand-green">
            For any changes, modifications, or cancellations, copy the booking details and message us on WhatsApp.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#25D366] px-4 py-3 text-center font-semibold text-white"
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void copyDetails()}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-green px-4 py-3 font-semibold disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy booking details"}
            </button>
            {status.canCancel && onCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-red/40 bg-white px-4 py-3 font-semibold text-brand-red disabled:opacity-50 sm:col-span-2"
              >
                Cancel booking
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
