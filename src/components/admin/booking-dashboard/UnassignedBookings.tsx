"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { XIcon, CheckIcon, Loader2Icon, AlertCircleIcon } from "lucide-react";
import { useAdminToast } from "@/components/admin/AdminToast";
import { fetchWithRetry } from "@/components/admin/useAdminApi";
import { exclusiveEndDate } from "@/lib/inventoryAvailability";
import { platformLogo, stayOverlapsVisible, formatDateCompact } from "./utils";
import type { DashboardBooking, CalendarDorm, DateRange } from "./types";

type AvailableBed = { key: string; label: string; dormId: number; dormName: string; capacity: number; bedIds: number[]; pool?: "online" | "offline" | "block" };
type DormBeds = { id: number; name: string; beds: AvailableBed[] };

export function UnassignedBookings({
  bookings,
  dateRange,
  onAssign,
  onReject,
  onClose,
  password,
  username,
  canAssign = true,
  canReject = false,
}: {
  bookings: DashboardBooking[];
  dorms: CalendarDorm[];
  dateRange: DateRange;
  onAssign: (bookingId: number, bedIds: number[]) => Promise<boolean>;
  onReject?: (bookingId: number) => Promise<boolean>;
  onClose: () => void;
  password: string;
  username?: string;
  canAssign?: boolean;
  canReject?: boolean;
}) {
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [selectedBeds, setSelectedBeds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [rangeBeds, setRangeBeds] = useState<AvailableBed[]>([]);
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [bedsError, setBedsError] = useState("");
  const { showError } = useAdminToast();

  const { ordered, offCalendarCount } = useMemo(() => {
    const inView: DashboardBooking[] = [];
    const out: DashboardBooking[] = [];
    for (const b of bookings) {
      if (stayOverlapsVisible(b.checkinDate, b.checkoutDate, dateRange.startDate, dateRange.endDate)) {
        inView.push(b);
      } else {
        out.push(b);
      }
    }
    return { ordered: [...inView, ...out], offCalendarCount: out.length };
  }, [bookings, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    if (!assigningId) {
      setRangeBeds([]);
      setLoadingBeds(false);
      setBedsError("");
      return;
    }
    const booking = bookings.find((b) => b.id === assigningId);
    if (!booking?.checkinDate) {
      setRangeBeds([]);
      setLoadingBeds(false);
      setBedsError("This booking has no check-in date.");
      return;
    }
    const checkinDate = booking.checkinDate;
    const checkoutDate = exclusiveEndDate(checkinDate, booking.checkoutDate);
    if (!checkoutDate) {
      setRangeBeds([]);
      setLoadingBeds(false);
      setBedsError("Invalid stay dates on this booking.");
      return;
    }
    setLoadingBeds(true);
    setSelectedBeds([]);
    setBedsError("");
    const payload: Record<string, unknown> = { password, action: "getAvailableBeds", checkinDate, checkoutDate, bookingId: booking.id };
    if (username) payload.username = username;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithRetry("/api/admin/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, { retryServerError: true });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            setRangeBeds([]);
            setBedsError(typeof data.error === "string" ? data.error : `Failed to load beds (${res.status})`);
          }
          return;
        }
        if (!cancelled) setRangeBeds(booking.persons === 1 ? (data.slots || data.units || []) : (data.units || []));
      } catch {
        if (!cancelled) {
          setRangeBeds([]);
          setBedsError("Network error loading beds");
        }
      } finally {
        if (!cancelled) setLoadingBeds(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assigningId, bookings, password, username]);

  const availableBeds = useMemo(() => {
    const dormMap = new Map<number, DormBeds>();
    for (const bed of rangeBeds) {
      if (!dormMap.has(bed.dormId)) {
        dormMap.set(bed.dormId, { id: bed.dormId, name: bed.dormName, beds: [] });
      }
      dormMap.get(bed.dormId)!.beds.push(bed);
    }
    return Array.from(dormMap.values());
  }, [rangeBeds]);

  const toggleBed = useCallback((bedId: string) => {
    setSelectedBeds((prev) =>
      prev.includes(bedId) ? prev.filter((id) => id !== bedId) : [...prev, bedId],
    );
  }, []);

  const bedsNeeded = (booking: DashboardBooking) =>
    booking.requestedUnitCount || booking.requestedBedCount || booking.persons || 1;

  const bedById = useCallback((id: string) => rangeBeds.find((b) => b.key === id), [rangeBeds]);

  const isOverflowSelection = (booking: DashboardBooking, selected: string[]) => {
    const requested = new Set(booking.requestedDormIds || []);
    if (requested.size === 0) return false;
    return selected.some((id) => {
      const bed = bedById(id);
      return !!bed && !requested.has(bed.dormId);
    });
  };

  const canSelectBed = (bed: AvailableBed, booking: DashboardBooking) => {
    if (selectedBeds.includes(bed.key)) return true;
    if (selectedBeds.length >= bedsNeeded(booking)) return false;
    const requested = new Set(booking.requestedDormIds || []);
    const overflow = isOverflowSelection(booking, selectedBeds) || (requested.size > 0 && !requested.has(bed.dormId));
    if (overflow) return true;
    const need = (booking.requestedNeeds || []).find((n) => n.dormId === bed.dormId);
    const quota = need?.units ?? need?.count;
    if (quota == null) return true;
    const inDorm = selectedBeds.filter((id) => bedById(id)?.dormId === bed.dormId).length;
    return inDorm < quota;
  };

  const handleAssign = async (booking: DashboardBooking) => {
    const need = bedsNeeded(booking);
    if (selectedBeds.length !== need) {
      showError(`Select ${need} room/bed unit${need !== 1 ? "s" : ""}`);
      return;
    }
    const quotas = booking.requestedNeeds || [];
    if (quotas.length > 0 && !isOverflowSelection(booking, selectedBeds)) {
      const mismatch = quotas.some((n) =>
        selectedBeds.filter((id) => bedById(id)?.dormId === n.dormId).length !== (n.units ?? n.count),
      );
      if (mismatch) {
        showError(`Assign the reserved room/bed units: ${booking.requestedNeedLabels}`);
        return;
      }
    }
    setBusy(true);
    try {
      const ok = await onAssign(booking.id, rangeBeds.filter((u) => selectedBeds.includes(u.key)).flatMap((u) => u.bedIds));
      if (!ok) return;
      setAssigningId(null);
      setSelectedBeds([]);
    } catch {
      showError("Failed to assign beds");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (bookingId: number) => {
    if (!onReject) return;
    if (!window.confirm("Reject removes this stay from Goko only. It does not cancel the OTA booking. Cancel it on Booking.com / the channel too, or the guest will still arrive.")) return;
    setBusy(true);
    try {
      const ok = await onReject(bookingId);
      if (ok && assigningId === bookingId) {
        setAssigningId(null);
        setSelectedBeds([]);
      }
    } catch {
      showError("Failed to reject booking");
    } finally {
      setBusy(false);
    }
  };

  const renderDorm = (dorm: DormBeds, booking: DashboardBooking) => {
    const need = (booking.requestedNeeds || []).find((n) => n.dormId === dorm.id);
    const quota = need?.units ?? need?.count;
    const picked = selectedBeds.filter((id) => bedById(id)?.dormId === dorm.id).length;
    return (
    <div key={dorm.id} className="rounded-lg border border-border bg-white p-2 dark:bg-card">
      <div className="mb-1.5 text-[11px] font-semibold text-foreground">
        {dorm.name}
        {quota != null && (
          <span className="ml-1 font-normal text-muted-foreground">({picked}/{quota})</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {dorm.beds.map((bed) => {
          const isSelected = selectedBeds.includes(bed.key);
          const pool = bed.pool ?? "online";
          const allowed = canSelectBed(bed, booking);
          return (
            <button
              key={bed.key}
              type="button"
              disabled={!isSelected && !allowed}
              onClick={() => allowed && toggleBed(bed.key)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                !isSelected && !allowed && "cursor-not-allowed opacity-40",
                isSelected && pool === "online" && "border-sky-600 bg-sky-100 text-sky-800",
                isSelected && pool === "offline" && "border-emerald-600 bg-emerald-100 text-emerald-800",
                isSelected && pool === "block" && "border-orange-500 bg-orange-100 text-orange-800",
                !isSelected && allowed && pool === "online" && "border-sky-200 bg-sky-50/80 text-sky-800 hover:bg-sky-100",
                !isSelected && allowed && pool === "offline" && "border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100",
                !isSelected && allowed && pool === "block" && "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100",
              )}
            >
              {isSelected && <CheckIcon className="size-3" />}
              {bed.label}{bed.capacity > 1 ? " · 2 guests" : ""}
              {pool === "offline" && <span className="text-[9px] opacity-70">off</span>}
            </button>
          );
        })}
      </div>
    </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
    >
      <div className="flex items-center justify-between border-b border-orange-200 px-4 py-2 dark:border-orange-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 text-orange-600 dark:text-orange-400" />
            <h3 className="text-sm font-semibold text-orange-800 dark:text-orange-300">
              Unassigned Bookings ({bookings.length})
            </h3>
            {offCalendarCount > 0 && (
              <span className="text-[11px] font-normal text-orange-700 dark:text-orange-400">
                {offCalendarCount} outside current dates
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-orange-800/80 dark:text-orange-300/80">
            Online units in the requested room type were full. Assign available offline units{canReject ? " or reject." : "."}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="divide-y divide-orange-200 dark:divide-orange-800">
        {ordered.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            No unassigned bookings. Assigned stays appear as bars on the calendar.
          </p>
        ) : ordered.map((booking) => {
          const platform = platformLogo(booking.platform);
          const isAssigning = assigningId === booking.id;
          const onCalendar = stayOverlapsVisible(
            booking.checkinDate,
            booking.checkoutDate,
            dateRange.startDate,
            dateRange.endDate,
          );
          const need = bedsNeeded(booking);
          const roomLabel = booking.requestedDormNames?.length
            ? `${booking.requestedDormNames.join(", ")} (${(booking.requestedRoomCodes || []).join(", ")})`
            : booking.roomType || "Unknown room type";
          const requestedIds = new Set(booking.requestedDormIds || []);
          const quotas = booking.requestedNeeds || [];
          const requestedDorms = requestedIds.size
            ? availableBeds.filter((d) => requestedIds.has(d.id))
            : availableBeds;
          const otherDorms = requestedIds.size
            ? availableBeds.filter((d) => !requestedIds.has(d.id))
            : [];
          return (
            <div key={booking.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {platform && (
                      <span className={cn("inline-flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white", platform.color)}>
                        {platform.abbr}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-foreground">{booking.guestName}</span>
                    {!onCalendar && (
                      <span className="shrink-0 rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-medium text-orange-900 dark:bg-orange-800 dark:text-orange-100">
                        Off this calendar
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                     {formatDateCompact(booking.checkinDate)} – {booking.checkoutDate ? formatDateCompact(booking.checkoutDate) : "—"} | {need} unit{need !== 1 ? "s" : ""} ({booking.persons} guest{booking.persons !== 1 ? "s" : ""})
                    {booking.bookingRef ? ` | ${booking.bookingRef}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-orange-900 dark:text-orange-200">
                    Requested: {booking.requestedNeedLabels || roomLabel}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canReject && onReject && (
                    <Button
                      size="xs"
                      variant="outline"
                      className="border-red-300 text-red-700 hover:bg-red-50"
                      disabled={busy}
                      onClick={() => handleReject(booking.id)}
                    >
                      Reject
                    </Button>
                  )}
                  {canAssign && (
                    !isAssigning ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => { setAssigningId(booking.id); setSelectedBeds([]); }}
                    >
                      Assign
                    </Button>
                    ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => { setAssigningId(null); setSelectedBeds([]); }}
                    >
                      <XIcon className="size-3" />
                    </Button>
                    )
                  )}
                </div>
              </div>

              {isAssigning && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                     Pick {need} room/bed unit{need !== 1 ? "s" : ""}{booking.requestedNeedLabels ? ` (${booking.requestedNeedLabels})` : ""} for the whole stay. A double unit can hold up to two guests. Green chips are offline (walk-in) inventory.{canReject ? " Reject is Goko-only; cancel the OTA separately." : ""}
                  </p>
                  {loadingBeds ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3.5 animate-spin" /> Loading available beds...
                    </div>
                  ) : bedsError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{bedsError}</p>
                  ) : availableBeds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No beds available for this stay.</p>
                  ) : (
                    <>
                      {requestedDorms.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-800">
                            {quotas.length > 1 ? "Requested rooms" : "Requested room"}
                          </div>
                          {requestedDorms.map((d) => renderDorm(d, booking))}
                        </div>
                      )}
                      {otherDorms.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Other rooms (overflow)</div>
                          <p className="text-[10px] text-muted-foreground">
                            Use only if leftover beds in the requested type are gone. Overflow does not have to match the room-type split.
                          </p>
                          {otherDorms.map((d) => renderDorm(d, booking))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="xs"
                      onClick={() => handleAssign(booking)}
                      disabled={selectedBeds.length !== need || busy || loadingBeds}
                    >
                      {busy && <Loader2Icon className="size-3 animate-spin" />}
                       Assign {selectedBeds.length}/{need} unit{need !== 1 ? "s" : ""}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
