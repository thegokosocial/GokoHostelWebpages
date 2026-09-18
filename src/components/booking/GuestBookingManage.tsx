"use client";

import { formatPaymentChoice, type GuestRoomLine } from "@/lib/guestBookingDetails";

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
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

type Props = {
  status: GuestBookingStatus;
  busy?: boolean;
  onCancel?: () => void;
  onEditStay?: () => void;
  editing?: boolean;
};

export function GuestBookingManage({ status, busy, onCancel, onEditStay, editing }: Props) {
  const label = statusLabel(status.bookingStatus, status.state);
  const confirmed = label === "Confirmed";
  const dueRupees = status.dueAtPropertyPaise != null
    ? Math.round(status.dueAtPropertyPaise / 100)
    : status.amountTotal != null && status.amountPaid != null
      ? Math.max(0, status.amountTotal - status.amountPaid)
      : null;
  const deadline = formatDeadline(status.cancellationDeadlineAt);

  return (
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
        {status.paymentChoice && (
          <span className="text-xs text-brand-green">{formatPaymentChoice(status.paymentChoice)}</span>
        )}
      </div>

      <div>
        <p className="text-lg font-semibold sm:text-xl">{status.guestName}</p>
        <p className="mt-1 text-sm sm:text-base">
          {status.checkinDate} – {status.checkoutDate}
          {status.nights != null && status.nights > 0
            ? ` · ${status.nights} ${status.nights === 1 ? "night" : "nights"}`
            : ""}
        </p>
        {(status.email || status.phone) && (
          <p className="mt-1 text-xs text-brand-green">
            {[status.email, status.phone].filter(Boolean).join(" · ")}
          </p>
        )}
        {status.persons != null && (
          <p className="mt-1 text-sm text-brand-green">Sleeps up to {status.persons}</p>
        )}
      </div>

      {!!status.rooms?.length && (
        <div className="border-t border-brand-mist pt-4">
          <h2 className="text-sm font-semibold text-brand-green">Rooms</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {status.rooms.map((room) => (
              <li key={`${room.dormId}-${room.type}`} className="flex justify-between gap-3">
                <span>{room.label}</span>
                <span className="shrink-0 font-medium">{money(room.subtotalRupees)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="grid gap-3 border-t border-brand-mist pt-4 text-sm sm:grid-cols-2">
        {status.beforeTaxRupees != null && (
          <div>
            <dt className="text-brand-green">Subtotal</dt>
            <dd className="mt-0.5 font-semibold">{money(status.beforeTaxRupees)}</dd>
          </div>
        )}
        {status.taxRupees != null && (
          <div>
            <dt className="text-brand-green">
              Tax{status.taxPercent != null ? ` (${status.taxPercent}%)` : ""}
            </dt>
            <dd className="mt-0.5 font-semibold">{money(status.taxRupees)}</dd>
          </div>
        )}
        <div>
          <dt className="text-brand-green">Total</dt>
          <dd className="mt-0.5 font-semibold">{status.amountTotal == null ? "—" : money(status.amountTotal)}</dd>
        </div>
        <div>
          <dt className="text-brand-green">Paid online</dt>
          <dd className="mt-0.5 font-semibold">{status.amountPaid == null ? "—" : money(status.amountPaid)}</dd>
        </div>
        {dueRupees != null && (
          <div>
            <dt className="text-brand-green">Due at property</dt>
            <dd className="mt-0.5 font-semibold">{money(dueRupees)}</dd>
          </div>
        )}
        {status.amountRefunded != null && status.amountRefunded > 0 && (
          <div>
            <dt className="text-brand-green">Refunded</dt>
            <dd className="mt-0.5 font-semibold">{money(status.amountRefunded)}</dd>
          </div>
        )}
      </dl>

      {deadline && (status.canCancel || status.canModify) && (
        <p className="text-xs text-brand-green">
          Online changes / cancellation available until {deadline} IST.
        </p>
      )}

      <div className="space-y-3 border-t border-brand-mist pt-4">
        {status.canModify && onEditStay && (
          <button
            type="button"
            disabled={busy}
            onClick={onEditStay}
            className="min-h-12 w-full rounded-lg bg-brand-green px-4 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto"
          >
            {editing ? "Hide stay editor" : "Edit stay"}
          </button>
        )}
        {status.canCancel && onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="block min-h-10 w-full text-left text-sm font-medium text-brand-red underline decoration-brand-red/40 underline-offset-2 disabled:opacity-50 sm:w-auto"
          >
            Cancel booking
          </button>
        )}
      </div>
    </div>
  );
}
