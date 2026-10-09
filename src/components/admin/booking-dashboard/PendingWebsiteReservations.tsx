"use client";

import { Clock3Icon } from "lucide-react";
import { PlatformBadge } from "./PlatformBadge";
import type { PendingWebsiteReservation } from "./types";
import { formatDateCompact } from "./utils";

export function PendingWebsiteReservations({ reservations }: { reservations: PendingWebsiteReservation[] }) {
  if (reservations.length === 0) return null;
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-900/20">
      <div className="flex items-center gap-2 border-b border-sky-200 px-4 py-2 dark:border-sky-800">
        <Clock3Icon className="size-4 text-sky-700 dark:text-sky-300" />
        <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">Pending website payments ({reservations.length})</h3>
      </div>
      <div className="divide-y divide-sky-200 dark:divide-sky-800">
        {reservations.map(({ booking, checkoutState, dueNowPaise, holdExpiresAt, requestedRooms }) => (
          <div key={booking.id} className="p-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <PlatformBadge platform={booking.platform} size={16} />
              {booking.guestName}
            </div>
            <p className="mt-0.5 text-muted-foreground">
              {formatDateCompact(booking.checkinDate)} – {booking.checkoutDate ? formatDateCompact(booking.checkoutDate) : "—"}
              {booking.bookingRef ? ` | ${booking.bookingRef}` : ""}
            </p>
            <p className="mt-1 font-medium text-sky-950 dark:text-sky-100">Reserved: {requestedRooms}</p>
            <p className="mt-1 text-sky-800 dark:text-sky-200">
              Payment pending · ₹{(dueNowPaise / 100).toFixed(2)} due online · {checkoutState} · hold expires {new Date(holdExpiresAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
