"use client";

import { cn } from "@/lib/utils";
import { UsersIcon } from "lucide-react";
import { STATUS_COLORS } from "./utils";
import { PlatformBadge } from "./PlatformBadge";
import type { DashboardBooking } from "./types";

export function BookingTile({
  booking,
  occupancyCheckinDate,
  occupancyCheckoutDate,
  isMultiBed,
  isSelected,
  onClick,
}: {
  booking: DashboardBooking;
  occupancyCheckinDate: string;
  occupancyCheckoutDate: string;
  isMultiBed: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[booking.status] ?? STATUS_COLORS.received;
  const occupancyDiffers = occupancyCheckinDate !== booking.checkinDate || occupancyCheckoutDate !== booking.checkoutDate;
  const label = `${booking.guestName} - ${booking.platform} (bed occupancy: ${occupancyCheckinDate} to ${occupancyCheckoutDate})${occupancyDiffers ? `; scheduled stay: ${booking.checkinDate} to ${booking.checkoutDate}` : ""}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "group flex h-full w-full items-center gap-1 overflow-hidden rounded-md px-1.5 text-left text-[11px] leading-tight transition-all",
        statusColor.bg,
        statusColor.text,
        statusColor.border,
        "border",
        isSelected && "ring-2 ring-brand-green ring-offset-1 dark:ring-offset-gray-900",
        "hover:brightness-95 dark:hover:brightness-110 cursor-pointer",
      )}
    >
      <PlatformBadge platform={booking.platform} size={14} />
      <span className="min-w-0 flex-1 truncate font-medium">
        {booking.guestName}
      </span>
      {isMultiBed && (
        <UsersIcon className="size-3 shrink-0 opacity-60" />
      )}
    </button>
  );
}
