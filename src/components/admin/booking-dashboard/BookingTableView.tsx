"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronUpIcon, ChevronDownIcon } from "lucide-react";
import { STATUS_COLORS, platformLogo, STATUS_LABELS, formatCurrency } from "./utils";
import type { DashboardBooking, BedAssignment } from "./types";

type SortKey = "guestName" | "platform" | "bookingRef" | "checkinDate" | "checkoutDate" | "status" | "amountTotal" | "createdAt";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "guestName", label: "Guest Name" },
  { key: "platform", label: "Platform", className: "hidden sm:table-cell" },
  { key: "bookingRef", label: "Booking Ref", className: "hidden md:table-cell" },
  { key: "checkinDate", label: "Check-in" },
  { key: "checkoutDate", label: "Check-out" },
  { key: "status", label: "Status" },
  { key: "amountTotal", label: "Amount", className: "hidden sm:table-cell" },
  { key: "createdAt", label: "Created", className: "hidden lg:table-cell" },
];

export function BookingTableView({
  bookings,
  assignments,
  onSelectBooking,
  selectedBookingId,
}: {
  bookings: DashboardBooking[];
  assignments: BedAssignment[];
  onSelectBooking: (id: number) => void;
  selectedBookingId: number | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("checkinDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const bedCounts = useMemo(() => {
    const map = new Map<number, number>();
    assignments.filter((a) => a.status === "assigned").forEach((a) => {
      map.set(a.bookingId, (map.get(a.bookingId) || 0) + 1);
    });
    return map;
  }, [assignments]);

  const sorted = useMemo(() => {
    const list = [...bookings];
    list.sort((a, b) => {
      let cmp = 0;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv);
      } else if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [bookings, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white dark:bg-card">
      <div className="overflow-x-auto overflow-y-visible overscroll-x-contain">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-20 bg-white dark:bg-card">
            <tr className="border-b border-border bg-muted/50">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "sticky top-0 z-20 cursor-pointer select-none bg-white px-3 py-2.5 text-left font-medium text-muted-foreground transition-colors hover:text-foreground dark:bg-card",
                    col.className,
                  )}
                  onClick={() => toggleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      sortDir === "asc"
                        ? <ChevronUpIcon className="size-3" />
                        : <ChevronDownIcon className="size-3" />
                    )}
                  </div>
                </th>
              ))}
              <th className="sticky top-0 z-20 hidden bg-white px-3 py-2.5 text-left font-medium text-muted-foreground dark:bg-card md:table-cell">Beds</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((booking) => {
              const statusColor = STATUS_COLORS[booking.status] ?? STATUS_COLORS.received;
              const platform = platformLogo(booking.platform);
              const beds = bedCounts.get(booking.id) || 0;
              return (
                <tr
                  key={booking.id}
                  onClick={() => onSelectBooking(booking.id)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/50",
                    selectedBookingId === booking.id && "bg-brand-green/5 dark:bg-brand-green/10",
                  )}
                >
                  <td className="px-3 py-2 font-medium text-foreground">{booking.guestName}</td>
                  <td className="hidden sm:table-cell px-3 py-2">
                    {platform ? (
                      <div className="flex items-center gap-1.5">
                        <span className={cn("inline-flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white", platform.color)}>
                          {platform.abbr}
                        </span>
                        <span className="text-muted-foreground">{platform.label}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{booking.platform}</span>
                    )}
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-muted-foreground">{booking.bookingRef || "-"}</td>
                  <td className="px-3 py-2 text-foreground">{booking.checkinDate}</td>
                  <td className="px-3 py-2 text-foreground">{booking.checkoutDate}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", statusColor.bg, statusColor.text)}>
                      {STATUS_LABELS[booking.status] ?? booking.status}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 text-foreground">{formatCurrency(booking.amountTotal)}</td>
                  <td className="hidden lg:table-cell px-3 py-2 text-muted-foreground">{booking.createdAt?.split("T")[0] || "-"}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-muted-foreground">{beds > 0 ? beds : "-"}</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                  No bookings found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
