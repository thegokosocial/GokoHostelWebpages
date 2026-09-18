"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { STATUS_COLORS, STATUS_LABELS, formatDateShort, getHostelToday, isToday } from "./utils";
import { PlatformBadge } from "./PlatformBadge";
import type { DashboardBooking, BedAssignment, CalendarDorm, DateRange } from "./types";

export function BookingMobileDayView({
  bookings,
  assignments,
  dorms,
  dateRange,
  onSelectBooking,
}: {
  bookings: DashboardBooking[];
  assignments: BedAssignment[];
  dorms: CalendarDorm[];
  dateRange: DateRange;
  onSelectBooking: (id: number) => void;
}) {
  const [currentDate, setCurrentDate] = useState(getHostelToday());

  const dayBookings = useMemo(() => {
    const activeAssigns = assignments.filter(
      (a) => a.status === "assigned" && a.checkinDate <= currentDate && a.checkoutDate > currentDate,
    );
    const bookingIds = new Set(activeAssigns.map((a) => a.bookingId));

    const checkingIn = bookings.filter(
      (b) => b.checkinDate === currentDate && b.status !== "cancelled",
    );
    checkingIn.forEach((b) => bookingIds.add(b.id));

    const checkingOut = bookings.filter(
      (b) => b.checkoutDate === currentDate && b.status !== "cancelled",
    );
    checkingOut.forEach((b) => bookingIds.add(b.id));

    return {
      all: bookings.filter((b) => bookingIds.has(b.id)),
      checkingIn,
      checkingOut,
      staying: bookings.filter(
        (b) =>
          bookingIds.has(b.id) &&
          b.checkinDate !== currentDate &&
          b.checkoutDate !== currentDate,
      ),
    };
  }, [bookings, assignments, currentDate]);

  const dormBookings = useMemo(() => {
    const map = new Map<string, DashboardBooking[]>();
    for (const dorm of dorms) {
      const dormAssigns = assignments.filter(
        (a) =>
          a.status === "assigned" &&
          a.dormId === dorm.id &&
          a.checkinDate <= currentDate &&
          a.checkoutDate > currentDate,
      );
      const bIds = new Set(dormAssigns.map((a) => a.bookingId));
      const bs = bookings.filter((b) => bIds.has(b.id));
      if (bs.length > 0) map.set(dorm.name, bs);
    }
    return map;
  }, [dorms, assignments, bookings, currentDate]);

  const navigateDay = (delta: number) => {
    const d = new Date(currentDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    setCurrentDate(d.toISOString().split("T")[0]);
  };

  return (
    <div className="space-y-4">
      {/* Day navigator */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-white p-3 dark:bg-card">
        <Button variant="ghost" size="icon-sm" onClick={() => navigateDay(-1)}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <div className="text-center">
          <div className={cn("text-sm font-semibold", isToday(currentDate) && "text-brand-green")}>
            {formatDateShort(currentDate)}
          </div>
          {isToday(currentDate) && (
            <span className="text-[10px] font-medium text-brand-green">Today</span>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => navigateDay(1)}>
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-green-200 bg-green-50 p-2 text-center dark:border-green-800 dark:bg-green-900/20">
          <div className="text-lg font-bold text-green-700 dark:text-green-400">{dayBookings.checkingIn.length}</div>
          <div className="text-[10px] text-green-600 dark:text-green-500">Arrivals</div>
        </div>
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-2 text-center dark:border-purple-800 dark:bg-purple-900/20">
          <div className="text-lg font-bold text-purple-700 dark:text-purple-400">{dayBookings.checkingOut.length}</div>
          <div className="text-[10px] text-purple-600 dark:text-purple-500">Departures</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-center dark:border-blue-800 dark:bg-blue-900/20">
          <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{dayBookings.staying.length}</div>
          <div className="text-[10px] text-blue-600 dark:text-blue-500">Staying</div>
        </div>
      </div>

      {/* Dorm sections */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentDate}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          {dormBookings.size === 0 && (
            <div className="rounded-xl border border-border bg-white p-8 text-center dark:bg-card">
              <p className="text-sm text-muted-foreground">No bookings for this date</p>
            </div>
          )}
          {Array.from(dormBookings.entries()).map(([dormName, bs]) => (
            <div key={dormName} className="rounded-xl border border-border bg-white dark:bg-card">
              <div className="border-b border-border px-3 py-2">
                <h3 className="text-xs font-semibold text-foreground">{dormName}</h3>
              </div>
              <div className="divide-y divide-border">
                {bs.map((booking) => {
                  const statusColor = STATUS_COLORS[booking.status] ?? STATUS_COLORS.received;
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={() => onSelectBooking(booking.id)}
                      className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className={cn("mt-0.5 h-8 w-1 shrink-0 rounded-full", statusColor.bg.split(" ")[0])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <PlatformBadge platform={booking.platform} size={16} />
                          <span className="truncate text-sm font-medium text-foreground">{booking.guestName}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{booking.checkinDate} - {booking.checkoutDate}</span>
                          <span className={cn("rounded px-1 py-0.5 text-[9px] font-medium", statusColor.bg, statusColor.text)}>
                            {STATUS_LABELS[booking.status] ?? booking.status}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
