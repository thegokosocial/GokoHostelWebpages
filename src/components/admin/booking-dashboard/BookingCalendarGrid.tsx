"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronRightIcon, BanIcon } from "lucide-react";
import { BookingTile } from "./BookingTile";
import { getDatesArray, formatDateShort, formatDateCompact, isToday, isWeekend, computeTilePlacements } from "./utils";
import type { DashboardBooking, BedAssignment, CalendarDorm, DateRange } from "./types";

type TilePlacement = {
  booking: DashboardBooking;
  startCol: number;
  spanCols: number;
  isMultiBed: boolean;
};

export function BookingCalendarGrid({
  bookings,
  assignments,
  dorms,
  dateRange,
  onSelectBooking,
  selectedBookingId,
  onToggleDorm,
}: {
  bookings: DashboardBooking[];
  assignments: BedAssignment[];
  dorms: CalendarDorm[];
  dateRange: DateRange;
  today: string;
  onSelectBooking: (id: number) => void;
  selectedBookingId: number | null;
  onToggleDorm: (dormId: number) => void;
}) {
  const dates = useMemo(() => getDatesArray(dateRange.startDate, dateRange.endDate), [dateRange]);
  const isCompact = dates.length > 10;
  const colWidth = isCompact ? 50 : 80;

  const bookingMap = useMemo(() => {
    const m = new Map<number, DashboardBooking>();
    bookings.forEach((b) => m.set(b.id, b));
    return m;
  }, [bookings]);
  const bookingIds = useMemo(() => new Set(bookingMap.keys()), [bookingMap]);

  const multiBedBookings = useMemo(() => {
    const counts = new Map<number, number>();
    assignments.filter((a) => a.status === "assigned").forEach((a) => {
      counts.set(a.bookingId, (counts.get(a.bookingId) || 0) + 1);
    });
    const multi = new Set<number>();
    counts.forEach((count, bId) => { if (count > 1) multi.add(bId); });
    return multi;
  }, [assignments]);

  const [detail, setDetail] = useState<{ message: string; dormId: number; date: string; hadHold: boolean } | null>(null);
  useEffect(() => {
    setDetail(null);
  }, [dorms, dates]);
  const detailHasCurrentHold = detail
    ? (dorms.find((dorm) => dorm.id === detail.dormId)?.availability?.[detail.date]?.unassignedOta || 0) > 0
    : false;
  const showDetail = detail && (!detail.hadHold || detailHasCurrentHold);
  const hasHeld = useMemo(
    () => dorms.some((dorm) => dates.some((date) => (dorm.availability?.[date]?.unassignedOta || 0) > 0)),
    [dorms, dates],
  );
  const statusLabel = { online: "Online / OTA available", offline: "Walk-in available", block: "Blocked", occupied: "Occupied", held: "Capacity reserved for unassigned OTA bookings" };
  const statusColour = {
    online: "bg-sky-50/80 dark:bg-sky-950/30",
    offline: "bg-emerald-50/80 dark:bg-emerald-950/30",
    block: "bg-orange-50 dark:bg-orange-950/30",
    occupied: "bg-white dark:bg-card",
    held: "bg-zinc-100 dark:bg-zinc-800/50",
  };

  const gridWidth = dates.length * colWidth;

  return (
    <>
    <div className="shrink-0 space-y-1 pb-2 text-[11px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Nightly totals: online / walk-in / blocked{hasHeld ? " / held" : ""}</span>
        <span className="text-sky-700 dark:text-sky-300">Blue = online / OTA</span>
        <span className="text-emerald-700 dark:text-emerald-300">Green = walk-in</span>
        <span className="text-orange-700 dark:text-orange-300">Orange = blocked</span>
        {hasHeld && <span className="text-zinc-600 dark:text-zinc-300">Grey = held for unassigned OTA</span>}
      </div>
      {showDetail && <div role="status" className="flex items-center gap-2 rounded border border-border bg-brand-sand px-2 py-1 dark:bg-zinc-800">
        <span>{detail.message}</span>
        <button type="button" className="ml-auto underline" onClick={() => setDetail(null)}>Dismiss</button>
      </div>}
    </div>
    <div className="isolate min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-border bg-white dark:bg-card">
      <div className="inline-flex min-w-full">
          {/* Sticky left column: dorm/bed labels */}
          <div className="sticky left-0 z-20 w-[140px] shrink-0 border-r border-border bg-white dark:bg-card">
            <div className="sticky top-0 left-0 z-30 flex h-[52px] items-end border-b border-border bg-brand-sand px-2 pb-1 shadow-[0_1px_4px_rgba(45,92,63,0.08)] dark:bg-zinc-800 dark:shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
              <span className="text-[10px] font-medium text-muted-foreground">Dorms / Beds</span>
            </div>
            {dorms.map((dorm, dormIdx) => {
              const dormBg = dormIdx % 2 === 0
                ? "bg-emerald-50 dark:bg-emerald-950/30"
                : "bg-sky-50 dark:bg-sky-950/25";
              return (
                <div key={dorm.id}>
                  <button
                    type="button"
                    onClick={() => onToggleDorm(dorm.id)}
                    className={cn(
                      "flex h-8 w-full items-center gap-1 border-b border-border px-2 text-left text-xs font-semibold text-foreground transition-colors hover:bg-muted",
                      dormBg,
                    )}
                  >
                    {dorm.collapsed ? <ChevronRightIcon className="size-3.5 shrink-0" /> : <ChevronDownIcon className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{dorm.name}</span>
                  </button>
                  {!dorm.collapsed && dorm.beds.map((bed, bedIdx) => {
                    const bedBg = bedIdx % 2 === 0
                        ? "bg-white text-foreground dark:bg-card"
                        : "bg-brand-sand text-foreground dark:bg-zinc-800";
                    return (
                    <div
                      key={bed.id}
                      className={cn("flex h-8 items-center border-b border-border px-2 text-[11px]", bedBg)}
                    >
                      <span className="truncate">{bed.bedId}</span>
                    </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Right side: date grid with spanning tiles */}
          <div className="flex-1" style={{ minWidth: gridWidth }}>
            {/* Date header row */}
            <div className="sticky top-0 z-20 flex h-[52px] border-b border-border bg-brand-sand shadow-[0_1px_4px_rgba(45,92,63,0.08)] dark:bg-zinc-800 dark:shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
              {dates.map((date) => {
                const weekend = isWeekend(date);
                const todayCol = isToday(date);
                return (
                <div
                  key={date}
                  className={cn(
                    "flex shrink-0 flex-col items-center justify-end pb-1",
                    todayCol && "bg-brand-green/[0.09] dark:bg-brand-green/20",
                    weekend && !todayCol && "bg-amber-50/90 dark:bg-amber-950/25",
                  )}
                  style={{ width: colWidth }}
                >
                  <span className={cn(
                    "text-[10px] font-medium",
                    weekend && !todayCol ? "text-amber-700/70 dark:text-amber-400/70" : "text-muted-foreground",
                  )}>
                    {new Date(date + "T12:00:00Z").toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}
                  </span>
                  <span className={cn(
                    "text-xs font-semibold",
                    todayCol ? "text-brand-green" : weekend ? "text-amber-800 dark:text-amber-300" : "text-foreground",
                  )}>
                    {isCompact ? formatDateCompact(date) : formatDateShort(date)}
                  </span>
                </div>
                );
              })}
            </div>

            {/* Dorm/Bed rows with tiles */}
            {dorms.map((dorm, dormIdx) => {
              const dormBg = dormIdx % 2 === 0
                ? "bg-emerald-50 dark:bg-emerald-950/30"
                : "bg-sky-50 dark:bg-sky-950/25";
              return (
              <div key={dorm.id}>
                {/* Dorm summary row */}
                <div className={cn("flex h-8 border-b border-border", dormBg)}>
                  {dates.map((date) => {
                    const snap = dorm.availability?.[date];
                    const message = snap
                      ? `${dorm.name} · ${date}: ${snap.online} online / OTA · ${snap.offline} walk-in · ${snap.blocked} blocked${snap.unassignedOta > 0 ? ` · ${snap.unassignedOta} held` : ""} · ${snap.assigned} occupied${snap.total > 0 && snap.blocked === snap.total ? " — Fully blocked" : snap.unassignedOta > 0 && snap.available === 0 ? " — Remaining bed(s) held for unassigned OTA" : snap.online === 0 && snap.offline > 0 ? " — No online availability — walk-in available" : snap.available === 0 ? " — No availability" : ""}`
                      : `${dorm.name} · ${date}: Availability unavailable`;
                    return <button key={date} type="button" title={message} aria-label={message} onClick={() => setDetail({ message, dormId: dorm.id, date, hadHold: (snap?.unassignedOta || 0) > 0 })}
                      className="shrink-0 border-r border-border text-[10px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
                      style={{ width: colWidth }}>
                      {snap ? <>
                        <span className="text-sky-700 dark:text-sky-300">{snap.online}</span>
                        <span className="text-muted-foreground/50"> / </span>
                        <span className="text-emerald-700 dark:text-emerald-300">{snap.offline}</span>
                        <span className={cn(isCompact && "block leading-3")}>
                          <span className="text-muted-foreground/50"> / </span>
                          <span className="text-orange-700 dark:text-orange-300">{snap.blocked}</span>
                        </span>
                        {hasHeld && <span className={cn(isCompact && "block leading-3")}>
                          <span className="text-muted-foreground/50"> / </span>
                          <span className="text-zinc-600 dark:text-zinc-300">{snap.unassignedOta}</span>
                        </span>}
                      </> : "—"}
                    </button>;
                  })}
                </div>

                {/* Bed rows */}
                {!dorm.collapsed && dorm.beds.map((bed, bedIdx) => {
                  const placements: TilePlacement[] = computeTilePlacements(
                    bed.id, assignments, dates, bookingIds, multiBedBookings,
                  ).flatMap((p) => {
                    const booking = bookingMap.get(p.bookingId);
                    if (!booking) return [];
                    return [{ booking, startCol: p.startCol, spanCols: p.spanCols, isMultiBed: p.isMultiBed }];
                  });
                  const bedRowBg = bedIdx % 2 === 0
                      ? "bg-white dark:bg-card"
                      : "bg-brand-sand dark:bg-zinc-800";

                  return (
                    <div key={bed.id} className={cn("relative h-8 border-b border-border", bedRowBg)}>
                      {/* Grid lines (background) */}
                      <div className="absolute inset-0 flex">
                        {dates.map((date) => {
                          const status = bed.availability?.[date];
                          const message = `${dorm.name} · ${bed.bedId} · ${date}: ${status ? statusLabel[status] : "Availability unavailable"}`;
                          return <button key={date} type="button" title={message} aria-label={message} onClick={() => setDetail({ message, dormId: dorm.id, date, hadHold: false })}
                            className={cn("flex shrink-0 items-center justify-center border-r border-border focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600", status ? statusColour[status] : "bg-zinc-50 dark:bg-zinc-900")}
                            style={{ width: colWidth }}>
                            {status === "block" && <BanIcon aria-hidden="true" className="size-3 text-orange-300 dark:text-orange-700" />}
                          </button>;
                        })}
                      </div>

                      {/* Booking tiles (positioned absolutely over the grid) */}
                      {placements.map((p) => (
                        <div
                          key={`${p.booking.id}-${p.startCol}`}
                          className="absolute top-0.5 bottom-0.5 z-10"
                          style={{
                            left: p.startCol * colWidth + 2,
                            width: p.spanCols * colWidth - 4,
                          }}
                        >
                          <BookingTile
                            booking={p.booking}
                            isMultiBed={p.isMultiBed}
                            isSelected={selectedBookingId === p.booking.id}
                            onClick={() => onSelectBooking(p.booking.id)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              );
            })}
          </div>
      </div>
    </div>
    </>
  );
}
