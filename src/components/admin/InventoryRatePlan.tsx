"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn, todayIST } from "@/lib/utils";
import {
  RefreshCwIcon, Loader2Icon, ChevronLeftIcon, ChevronRightIcon,
  PackageIcon, EditIcon,
} from "lucide-react";
import { computeNightAvailability, pickInventoryOverride, overrideRemainingInput, overridePreview, overrideCeilingToSave, exclusiveEndFromInclusive, addCalendarDays, inclusiveNights, civilWeekday, unassignedOtaOnNight, type AvailabilitySummary, type NightAvailability } from "@/lib/inventoryAvailability";
import type { Role } from "./types";

type Props = { password: string; username?: string; role: Role; permissions: Record<string, boolean> };

type DormData = { id: number; name: string };
type BedData = { id: number; dormId: number; bedId: string; type: string };
type BlockData = { id: number; bedId: number; dormId: number; startDate: string; endDate: string; reason: string };
type AssignmentData = { bedId: number; dormId: number; checkinDate: string; checkoutDate: string; status: string; inventoryPool?: string | null };
type RatePlanData = { id: number; roomMappingId: number; ratePlanCode: string; ratePlanName: string };
type RoomMappingData = { id: number; dormId: number; dormName: string; channelRoomCode: string; totalInventory: number };
type DailyRateData = { id: number; ratePlanId: number; date: string; rate: number; stopSell: number; minimumStay: number; maximumStay: number | null; closeOnArrival: number; closeOnDeparture: number; minimumAdvanceReservation: number | null; maximumAdvanceReservation: number | null; adult1Rate: number | null; adult2Rate: number | null; childRate: number | null; infantRate: number | null; extraPersonRate: number | null };

type OverrideData = { id: number; dormId: number; channelId: number | null; date: string; onlineAvailable: number | null; offlineAvailable: number | null };

type GridData = {
  dorms: DormData[];
  beds: BedData[];
  blocks: BlockData[];
  assignments: AssignmentData[];
  roomMappings: RoomMappingData[];
  ratePlans: RatePlanData[];
  rates: DailyRateData[];
  overrides: OverrideData[];
  unassignedOta?: Array<{ dormId: number; date: string; rooms: number }>;
  bedConfigs: Array<{ id: number; dormId: number; bedType: string; maxOccupancy: number; extraPersonAllowed: number }>;
};

type BulkAvailabilityPreview = {
  selected: { rooms: number; nights: number; roomNights: number };
  current: AvailabilitySummary;
  after: AvailabilitySummary;
  capped: number;
  requestedOnline: number | null;
};

function generateDates(start: string, days: number): string[] {
  const dates: string[] = [];
  let current = start;
  for (let i = 0; i < days; i++) {
    dates.push(current);
    current = addCalendarDays(current, 1);
  }
  return dates;
}

function formatDateShort(dateStr: string): { day: string; weekday: string; isToday: boolean; isWeekend: boolean } {
  const weekdayNum = civilWeekday(dateStr);
  const weekday = new Date(dateStr + "T12:00:00+05:30").toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
  const day = dateStr.slice(8, 10).replace(/^0/, "") || dateStr.slice(8);
  return {
    day,
    weekday,
    isToday: dateStr === todayIST(),
    isWeekend: weekdayNum === 0 || weekdayNum === 6,
  };
}

function dateTint(isWeekend: boolean, isToday: boolean) {
  if (isToday) return "bg-brand-green/[0.09] dark:bg-brand-green/20";
  if (isWeekend) return "bg-amber-50/90 dark:bg-amber-950/25";
  return "";
}

export function InventoryRatePlan({ password, username, role, permissions }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GridData | null>(null);
  const [rangeStart, setRangeStart] = useState(() => todayIST());
  const [rangeDays, setRangeDays] = useState(14);
  const [editingCell, setEditingCell] = useState<{ dormId: number; date: string } | null>(null);
  const [editingRate, setEditingRate] = useState<{ ratePlanId: number; date: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const dates = useMemo(() => generateDates(rangeStart, rangeDays), [rangeStart, rangeDays]);
  const endDate = useMemo(() => addCalendarDays(rangeStart, rangeDays), [rangeStart, rangeDays]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "getInventoryGrid", startDate: rangeStart, endDate }),
      });
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [password, username, rangeStart, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const computeAvailability = useCallback((dormId: number, date: string) => {
    if (!data) return { total: 0, blocked: 0, assigned: 0, onlineAssigned: 0, unassignedOta: 0, available: 0, online: 0, offline: 0, overridden: false };
    return computeNightAvailability(
      dormId, date, data.beds, data.blocks, data.assignments, data.overrides ?? [],
      unassignedOtaOnNight(data.unassignedOta, dormId, date),
    );
  }, [data]);

  const computeHeaderStats = useCallback((date: string) => {
    if (!data) return { occupancy: 0, available: 0, sold: 0 };
    let totalBeds = 0, totalBlocked = 0, totalAssigned = 0;
    for (const dorm of data.dorms) {
      const s = computeAvailability(dorm.id, date);
      totalBeds += s.total;
      totalBlocked += s.blocked;
      totalAssigned += s.assigned + s.unassignedOta;
    }
    const sellable = totalBeds - totalBlocked;
    const occupancy = sellable > 0 ? Math.round((totalAssigned / sellable) * 100) : 0;
    return { occupancy, available: sellable - totalAssigned, sold: totalAssigned };
  }, [data, computeAvailability]);

  const getRateForCell = useCallback((ratePlanId: number, date: string): number | null => {
    if (!data) return null;
    const r = data.rates.find((rt) => rt.ratePlanId === ratePlanId && rt.date === date);
    if (!r) return null;
    return r.adult1Rate ?? r.rate;
  }, [data]);

  const getRatePlansForDorm = useCallback((dormId: number): RatePlanData[] => {
    if (!data) return [];
    const roomMapping = data.roomMappings.find((rm) => rm.dormId === dormId);
    if (!roomMapping) return [];
    return data.ratePlans.filter((rp) => rp.roomMappingId === roomMapping.id);
  }, [data]);

  const getRatePlanLabel = useCallback((rp: RatePlanData): string => {
    if (!data) return rp.ratePlanName || rp.ratePlanCode;
    const rm = data.roomMappings.find((m) => m.id === rp.roomMappingId);
    const dormName = rm?.dormName ?? "Unknown";
    return `${dormName} — ${rp.ratePlanName || rp.ratePlanCode}`;
  }, [data]);

  const shiftRange = (days: number) => {
    setRangeStart(addCalendarDays(rangeStart, days));
  };

  const colWidth = rangeDays <= 7 ? 80 : rangeDays <= 14 ? 60 : 48;

  if (loading && !data) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center py-20">
        <Loader2Icon className="h-6 w-6 animate-spin text-brand-green" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      {/* Controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => shiftRange(-rangeDays)}>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-brand-green-dark dark:text-zinc-200 min-w-[140px] text-center">
            {new Date(rangeStart + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            {" — "}
            {new Date(dates[dates.length - 1] + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => shiftRange(rangeDays)}>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30].map((d) => (
            <Button key={d} variant={rangeDays === d ? "default" : "outline"} size="sm" onClick={() => setRangeDays(d)}>
              {d}d
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
          <PackageIcon className="h-3.5 w-3.5" /> Bulk Update
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={fetchData} disabled={loading}>
          <RefreshCwIcon className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <span className="text-[10px] text-muted-foreground">
          Cells: <span className="font-medium text-sky-700 dark:text-sky-400">OTA</span>
          <span className="mx-0.5">/</span>
          <span className="font-medium text-emerald-700 dark:text-emerald-400">walk-in</span>
          <span className="mx-0.5">/</span>
          <span className="font-medium text-orange-700 dark:text-orange-400">blocked</span>
        </span>
      </div>

      {/* Grid — overflow-auto so sticky header/labels pin inside this scrollport (overflow-x-auto alone would cancel sticky top) */}
      <div className="isolate min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none">
        <div className="min-w-max">
          {/* Date header */}
          <div className="sticky top-0 z-20 flex border-b border-brand-mist bg-brand-sand shadow-[0_1px_4px_rgba(45,92,63,0.08)] dark:bg-zinc-800 dark:shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
            <div className="sticky left-0 z-30 w-[160px] shrink-0 border-r border-brand-mist bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-green-dark/60 dark:bg-zinc-800 dark:text-zinc-400">
              Dorm / Rate Plan
            </div>
            {dates.map((date) => {
              const { day, weekday, isToday, isWeekend } = formatDateShort(date);
              return (
                <div
                  key={date}
                  className={cn(
                    "shrink-0 border-r border-brand-mist px-1 py-1.5 text-center",
                    dateTint(isWeekend, isToday),
                  )}
                  style={{ width: colWidth }}
                >
                  <div className={cn("text-[10px]", isWeekend && !isToday ? "text-amber-700/70 dark:text-amber-400/70" : "text-brand-green-dark/50 dark:text-zinc-500")}>{weekday}</div>
                  <div className={cn("text-xs font-semibold", isToday ? "text-brand-green" : isWeekend ? "text-amber-800 dark:text-amber-300" : "text-brand-green-dark dark:text-zinc-200")}>{day}</div>
                </div>
              );
            })}
          </div>

          {/* Header stats rows */}
          {["occupancy", "available", "sold"].map((stat) => (
            <div key={stat} className="flex border-b border-brand-mist/50 bg-slate-50 dark:bg-zinc-800/60">
              <div className="sticky left-0 z-10 w-[160px] shrink-0 border-r border-brand-mist bg-slate-50 px-3 py-1.5 text-[11px] font-medium capitalize text-brand-green-dark/50 dark:bg-zinc-800 dark:text-zinc-500">
                {stat === "occupancy" ? "Occupancy %" : stat === "available" ? "Available" : "Sold"}
              </div>
              {dates.map((date) => {
                const { isToday, isWeekend } = formatDateShort(date);
                const stats = computeHeaderStats(date);
                const val = stat === "occupancy" ? `${stats.occupancy}%` : stat === "available" ? stats.available : stats.sold;
                return (
                  <div
                    key={date}
                    className={cn(
                      "shrink-0 border-r border-brand-mist/50 px-1 py-1.5 text-center text-[11px] font-medium",
                      dateTint(isWeekend, isToday),
                      stat === "occupancy" && stats.occupancy >= 90 && "text-red-600",
                      stat === "occupancy" && stats.occupancy >= 70 && stats.occupancy < 90 && "text-amber-600",
                      stat === "available" && stats.available === 0 && "text-red-600 font-bold",
                    )}
                    style={{ width: colWidth }}
                  >
                    {val}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Dorm rows */}
          {data?.dorms.map((dorm, dormIdx) => {
            const ratePlans = getRatePlansForDorm(dorm.id);
            const dormLabelBg = dormIdx % 2 === 0
              ? "bg-emerald-50 dark:bg-emerald-950/30"
              : "bg-sky-50 dark:bg-sky-950/25";
            return (
              <div key={dorm.id}>
                {/* Availability row */}
                <div className={cn("flex border-b border-brand-mist", dormLabelBg)}>
                  <div className={cn("sticky left-0 z-10 flex w-[160px] shrink-0 items-center gap-2 border-r border-brand-mist px-3 py-2", dormLabelBg)}>
                    <span className="truncate text-xs font-semibold text-brand-green-dark dark:text-zinc-200">{dorm.name}</span>
                  </div>
                  {dates.map((date) => {
                    const { available, blocked, overridden, online, offline, unassignedOta } = computeAvailability(dorm.id, date);
                    const { isToday, isWeekend } = formatDateShort(date);
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => setEditingCell({ dormId: dorm.id, date })}
                        className={cn(
                          "shrink-0 cursor-pointer border-r border-brand-mist/50 px-1 py-2 text-center text-xs font-medium transition-colors hover:bg-brand-green/[0.08]",
                          dateTint(isWeekend, isToday),
                          available === 0 && "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
                          overridden && "underline decoration-dotted decoration-blue-400",
                        )}
                        style={{ width: colWidth }}
                        title={`${online} online (OTA) · ${offline} walk-in · ${blocked} blocked${unassignedOta > 0 ? ` · ${unassignedOta} unassigned OTA` : ""}${overridden ? " · Override active" : ""}`}
                      >
                        <span className="tabular-nums">
                          <span className="text-sky-700 dark:text-sky-400">{online}</span>
                          <span className="text-muted-foreground/40">/</span>
                          <span className="text-emerald-700 dark:text-emerald-400">{offline}</span>
                          <span className="text-muted-foreground/40">/</span>
                          <span className="text-orange-700 dark:text-orange-400">{blocked}</span>
                        </span>
                        {overridden && <EditIcon className="ml-0.5 inline h-2.5 w-2.5 text-blue-400" />}
                      </button>
                    );
                  })}
                </div>

                {/* Rate plan rows */}
                {ratePlans.length > 0 ? ratePlans.map((rp, rpIdx) => {
                  const rpBg = rpIdx % 2 === 0
                    ? "bg-white dark:bg-card"
                    : "bg-brand-sand dark:bg-zinc-800";
                  return (
                  <div key={rp.id} className={cn("flex border-b border-brand-mist/30", rpBg)}>
                    <div className={cn("sticky left-0 z-10 flex w-[160px] shrink-0 items-center gap-1.5 border-r border-brand-mist px-3 py-1.5 pl-5", rpBg)}>
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green/60" />
                      <span className="truncate text-[11px] font-medium text-brand-green-dark/70 dark:text-zinc-400">{rp.ratePlanName || rp.ratePlanCode}</span>
                    </div>
                    {dates.map((date) => {
                      const rateVal = getRateForCell(rp.id, date);
                      const rateRow = data?.rates.find((r) => r.ratePlanId === rp.id && r.date === date);
                      const isStopped = rateRow?.stopSell === 1;
                      const { isToday, isWeekend } = formatDateShort(date);
                      return (
                        <button
                          key={date}
                          type="button"
                          onClick={() => setEditingRate({ ratePlanId: rp.id, date })}
                          className={cn(
                            "shrink-0 cursor-pointer border-r border-brand-mist/30 px-1 py-1.5 text-center text-[11px] transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/10",
                            dateTint(isWeekend, isToday),
                            isStopped && "bg-gray-100 text-gray-400 line-through dark:bg-gray-800/30",
                            !isStopped && rateVal && "text-brand-green-dark dark:text-zinc-300",
                          )}
                          style={{ width: colWidth }}
                        >
                          {rateVal ? `₹${rateVal}` : "—"}
                        </button>
                      );
                    })}
                  </div>
                  );
                }) : (
                  <div className="flex border-b border-brand-mist/30 bg-white dark:bg-card">
                    <div className="sticky left-0 z-10 w-[160px] shrink-0 border-r border-brand-mist bg-white px-3 py-1.5 pl-5 dark:bg-card">
                      <span className="text-[10px] italic text-brand-green-dark/40 dark:text-zinc-600">No rate plans</span>
                    </div>
                    {dates.map((date) => {
                      const { isToday, isWeekend } = formatDateShort(date);
                      return (
                        <div key={date} className={cn("shrink-0 border-r border-brand-mist/30 px-1 py-1.5 text-center text-[10px] text-brand-green-dark/30", dateTint(isWeekend, isToday))} style={{ width: colWidth }}>—</div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Inventory Detail Popup */}
      {editingCell && data && (
        <InventoryDetailModal
          dormId={editingCell.dormId}
          date={editingCell.date}
          data={data}
          computeAvailability={computeAvailability}
          password={password}
          username={username}
          onClose={() => setEditingCell(null)}
          onSaved={fetchData}
        />
      )}

      {/* Rate Edit Popup */}
      {editingRate && data && (
        <RateEditModal
          ratePlanId={editingRate.ratePlanId}
          date={editingRate.date}
          data={data}
          password={password}
          username={username}
          onClose={() => setEditingRate(null)}
          onSaved={fetchData}
        />
      )}

      {/* Bulk Update */}
      {bulkOpen && (
        <BulkUpdateModal
          data={data}
          password={password}
          username={username}
          onClose={() => setBulkOpen(false)}
          onSaved={fetchData}
        />
      )}
    </div>
  );
}

// --- Inventory Detail Modal ---
function InventoryDetailModal({ dormId, date, data, computeAvailability, password, username, onClose, onSaved }: {
  dormId: number; date: string; data: GridData;
  computeAvailability: (dormId: number, date: string) => NightAvailability;
  password: string; username?: string; onClose: () => void; onSaved: () => void;
}) {
  const stats = computeAvailability(dormId, date);
  const dorm = data.dorms.find((d) => d.id === dormId);
  const existingOverride = pickInventoryOverride(data.overrides ?? [], dormId, date);
  const storedCeiling = existingOverride?.onlineAvailable;
  const initialRemaining = overrideRemainingInput(stats, storedCeiling);
  const [saving, setSaving] = useState(false);
  const [onlineOverride, setOnlineOverride] = useState<string>(initialRemaining);
  const [error, setError] = useState("");

  const typedRemaining = onlineOverride === "" ? NaN : parseInt(onlineOverride, 10);
  const preview = overridePreview(stats, typedRemaining);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const remaining = onlineOverride !== "" ? parseInt(onlineOverride, 10) : NaN;
      const onlineAvailable = Number.isFinite(remaining)
        ? overrideCeilingToSave(stats, remaining)
        : null;
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password, username, action: "updateInventoryOverride",
          dormId, channelId: null, date,
          onlineAvailable,
          offlineAvailable: null,
        }),
      });
      const json = await res.json();
      if (!json.success && !res.ok) { setError(json.error || "Save failed"); return; }
      onSaved();
      setTimeout(onClose, 400);
    } catch { setError("Network error"); } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-base font-bold text-brand-green-dark dark:text-zinc-100">
          {dorm?.name} — {new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </h3>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-brand-green-dark/60">Total Beds</span><span className="font-medium">{stats.total}</span></div>
          <div className="flex justify-between"><span className="text-brand-green-dark/60">Booked</span><span className="font-medium">{stats.assigned}</span></div>
          {stats.unassignedOta > 0 && (
            <div className="flex justify-between"><span className="text-brand-green-dark/60">Unassigned OTA</span><span className="font-medium text-sky-700">{stats.unassignedOta}</span></div>
          )}
          <div className="flex justify-between"><span className="text-brand-green-dark/60">Blocked</span><span className="font-medium text-orange-600">{stats.blocked}</span></div>
          <div className="flex justify-between"><span className="text-brand-green-dark/60">Available</span><span className="font-bold text-brand-green">{stats.available}</span></div>
          <p className="text-[10px] text-brand-green-dark/40">
            {stats.total} total = {stats.assigned} booked + {stats.blocked} blocked + {preview.online} online + {preview.offline} walk-in
          </p>
          <hr className="border-brand-mist" />
          <div>
            <label className="text-xs text-brand-green-dark/60">Online (OTA/PMS)</label>
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              value={onlineOverride}
              onChange={(e) => setOnlineOverride(e.target.value)}
              placeholder={String(stats.online)}
              min={0}
              max={stats.available}
            />
            <p className="mt-0.5 text-[10px] text-brand-green-dark/40">
              Same as the grid OTA number. Unassigned OTA rooms (channel bookings with no bed yet) and assigned online beds are already excluded. With no override, blocked beds come out of this number — unblock returns them here, not to walk-in.
            </p>
            {Number.isFinite(typedRemaining) && typedRemaining > stats.available && (
              <p className="mt-0.5 text-[10px] text-amber-700">Capped at {stats.available} available. Extra cannot be sold.</p>
            )}
          </div>
          <div>
            <label className="text-xs text-brand-green-dark/60">Offline (Walk-ins)</label>
            <div className="mt-1 rounded-md border border-input bg-muted/50 px-3 py-1.5 text-sm font-medium">{preview.offline}</div>
            <p className="mt-0.5 text-[10px] text-brand-green-dark/40">
              Auto: {stats.available} available − {preview.online} online = {preview.offline} walk-in
            </p>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Override"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Rate Edit Modal ---
function RateEditModal({ ratePlanId, date, data, password, username, onClose, onSaved }: {
  ratePlanId: number; date: string; data: GridData;
  password: string; username?: string; onClose: () => void; onSaved: () => void;
}) {
  const existing = data.rates.find((r) => r.ratePlanId === ratePlanId && r.date === date);
  const ratePlan = data.ratePlans.find((rp) => rp.id === ratePlanId);
  const roomMapping = ratePlan ? data.roomMappings.find((rm) => rm.id === ratePlan.roomMappingId) : null;
  const bedConfig = roomMapping ? data.bedConfigs.find((bc) => bc.dormId === roomMapping.dormId) : null;
  const maxOcc = bedConfig?.maxOccupancy ?? 1;
  const extraAllowed = bedConfig?.extraPersonAllowed ?? 0;

  const [rate, setRate] = useState(String(existing?.rate ?? ""));
  const [adult1, setAdult1] = useState(String(existing?.adult1Rate ?? ""));
  const [adult2, setAdult2] = useState(String(existing?.adult2Rate ?? ""));
  const [child, setChild] = useState(String(existing?.childRate ?? ""));
  const [infant, setInfant] = useState(String(existing?.infantRate ?? ""));
  const [extra, setExtra] = useState(String(existing?.extraPersonRate ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password, username, action: "updateRate",
          ratePlanId, date,
          rate: parseInt(rate) || parseInt(adult1) || 0,
          adult1Rate: adult1 ? parseInt(adult1) : null,
          adult2Rate: adult2 ? parseInt(adult2) : null,
          childRate: child ? parseInt(child) : null,
          infantRate: infant ? parseInt(infant) : null,
          extraPersonRate: extra ? parseInt(extra) : null,
        }),
      });
      const json = await res.json();
      if (!json.success && !res.ok) { setError(json.error || "Save failed"); return; }
      onSaved();
      setTimeout(onClose, 400);
    } catch { setError("Network error"); } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-base font-bold text-brand-green-dark dark:text-zinc-100">
          {ratePlan?.ratePlanName || ratePlan?.ratePlanCode} — {new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </h3>
        <div className="mt-3 space-y-2">
          <div>
            <label className="text-xs text-brand-green-dark/60">Adult 1 Rate (₹)</label>
            <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={adult1} onChange={(e) => setAdult1(e.target.value)} />
          </div>
          {maxOcc >= 2 && (
            <div>
              <label className="text-xs text-brand-green-dark/60">Adult 2 Rate (₹)</label>
              <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={adult2} onChange={(e) => setAdult2(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs text-brand-green-dark/60">Child Rate (₹)</label>
            <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={child} onChange={(e) => setChild(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-brand-green-dark/60">Infant Rate (₹)</label>
            <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={infant} onChange={(e) => setInfant(e.target.value)} />
          </div>
          {extraAllowed === 1 && (
            <div>
              <label className="text-xs text-brand-green-dark/60">Extra Person Rate (₹)</label>
              <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs text-brand-green-dark/60">Display Rate (₹)</label>
            <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Auto from Adult 1" />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Rate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RatePlanChipPicker({
  plans,
  mappings,
  selectedIds,
  onChange,
}: {
  plans: RatePlanData[];
  mappings: RoomMappingData[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const groups: Array<{ mappingId: number; dormName: string; plans: RatePlanData[] }> = [];
  const byMapping = new Map<number, (typeof groups)[0]>();
  const mappingById = new Map(mappings.map((m) => [m.id, m]));
  for (const rp of plans) {
    let g = byMapping.get(rp.roomMappingId);
    if (!g) {
      g = { mappingId: rp.roomMappingId, dormName: mappingById.get(rp.roomMappingId)?.dormName ?? "Unknown", plans: [] };
      byMapping.set(rp.roomMappingId, g);
      groups.push(g);
    }
    g.plans.push(rp);
  }
  const allIds = plans.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  const toggleGroup = (g: (typeof groups)[0]) => {
    const gids = g.plans.map((p) => p.id);
    const allOn = gids.every((id) => selectedIds.includes(id));
    onChange(allOn ? selectedIds.filter((id) => !gids.includes(id)) : [...new Set([...selectedIds, ...gids])]);
  };

  if (plans.length === 0) return <p className="text-xs text-brand-green-dark/50">No rate plans mapped.</p>;

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => onChange(allSelected ? [] : allIds)}
        className="px-2 py-1 rounded text-[10px] font-medium border border-brand-green text-brand-green">
        {allSelected ? "Deselect All" : "Select All"}
      </button>
      {groups.map((g) => {
        const gids = g.plans.map((p) => p.id);
        const groupAll = gids.every((id) => selectedIds.includes(id));
        return (
          <div key={g.mappingId}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-brand-green-dark/80">{g.dormName}</span>
              <button type="button" onClick={() => toggleGroup(g)}
                className="text-[10px] text-brand-green hover:underline">
                {groupAll ? "Deselect" : "Select all"}
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {g.plans.map((rp) => (
                <button key={rp.id} type="button" onClick={() => toggle(rp.id)}
                  className={cn("px-2 py-1 rounded text-[10px] font-medium border", selectedIds.includes(rp.id) ? "bg-brand-green text-white border-brand-green" : "border-input")}>
                  {rp.ratePlanName || rp.ratePlanCode}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DormAvailabilityPicker({
  dorms,
  mappings,
  selectedIds,
  onChange,
}: {
  dorms: DormData[];
  mappings: RoomMappingData[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const mappingByDorm = new Map(mappings.map((mapping) => [mapping.dormId, mapping]));
  const allIds = dorms.map((dorm) => dorm.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  if (dorms.length === 0) return <p className="text-xs text-brand-green-dark/50">No rooms configured.</p>;

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => onChange(allSelected ? [] : allIds)}
        className="px-2 py-1 rounded text-[10px] font-medium border border-brand-green text-brand-green">
        {allSelected ? "Deselect All" : "Select All"}
      </button>
      <div className="flex flex-wrap gap-1.5">
        {dorms.map((dorm) => {
          const mapping = mappingByDorm.get(dorm.id);
          const selected = selectedIds.includes(dorm.id);
          return (
            <button key={dorm.id} type="button" onClick={() => toggle(dorm.id)}
              className={cn("rounded border px-2 py-1 text-left text-[10px] font-medium", selected ? "border-brand-green bg-brand-green text-white" : "border-input text-brand-green-dark/80")}>
              <span>{dorm.name}</span>
              <span className={cn("ml-1 text-[9px]", selected ? "text-white/70" : "text-brand-green-dark/40")}>
                {mapping ? "PMS" : "Local"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-brand-green-dark/50">PMS updates are sent only for active mapped rooms. Local-only rooms still keep their availability override in Goko.</p>
    </div>
  );
}

function AvailabilityPreviewPanel({ preview, loading, mode }: { preview: BulkAvailabilityPreview | null; loading: boolean; mode: "set" | "clear" }) {
  if (!preview && !loading) return null;
  if (loading) return (
    <div className="rounded-lg border border-brand-mist bg-brand-sand/40 px-3 py-2 text-xs text-brand-green-dark/60">
      <Loader2Icon className="mr-1 inline-block h-3 w-3 animate-spin" /> Loading selected availability…
    </div>
  );
  if (!preview) return null;

  const rows = [
    ["Online", preview.current.online, preview.after.online, "text-sky-700"],
    ["Offline", preview.current.offline, preview.after.offline, "text-emerald-700"],
    ["Blocked", preview.current.blocked, preview.after.blocked, "text-orange-700"],
    ["Booked / held", preview.current.assigned + preview.current.unassignedOta, preview.after.assigned + preview.after.unassignedOta, "text-brand-green-dark"],
  ] as const;
  const afterLabel = mode === "clear"
    ? "after clear"
    : preview.requestedOnline == null
      ? "after value"
      : `after set ${preview.requestedOnline}`;

  return (
    <div className="rounded-lg border border-brand-mist bg-brand-sand/40 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[10px] text-brand-green-dark/60">
        <span className="font-medium text-brand-green-dark">Selected availability</span>
        <span>{preview.selected.rooms} room{preview.selected.rooms === 1 ? "" : "s"} × {preview.selected.nights} night{preview.selected.nights === 1 ? "" : "s"} · {preview.selected.roomNights} room-nights</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {rows.map(([label, current, after, color]) => (
          <div key={label} className="rounded-md border border-brand-mist/70 bg-white/70 px-2 py-1.5">
            <div className={cn("text-[10px] font-medium", color)}>{label}</div>
            <div className="mt-0.5 text-sm font-bold text-brand-green-dark">
              {current} <span className="text-[10px] font-normal text-brand-green-dark/40">→ {after}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-brand-green-dark/50">Counts are summed across the selected room-nights. Left = current, right = {afterLabel}. Blocked and booked/held counts are preserved.</p>
      {preview.capped > 0 && <p className="mt-0.5 text-[10px] text-amber-700">{preview.capped} selected cell{preview.capped === 1 ? " is" : "s are"} above physical availability and will be capped.</p>}
    </div>
  );
}

// --- Bulk Update Modal ---
function BulkUpdateModal({ data, password, username, onClose, onSaved }: {
  data: GridData | null; password: string; username?: string; onClose: () => void; onSaved: () => void;
}) {
  const [tab, setTab] = useState<"blockBeds" | "unblockBeds" | "availability" | "setRates" | "adjustRates" | "restrictions">("blockBeds");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string>("");

  // Block beds state
  const [blockBedIds, setBlockBedIds] = useState<number[]>([]);
  const [blockDormId, setBlockDormId] = useState<number>(0);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [fetchedFreeBeds, setFetchedFreeBeds] = useState<BedData[] | null>(null);
  const [loadingFreeBeds, setLoadingFreeBeds] = useState(false);

  // Unblock state
  const [unblockIds, setUnblockIds] = useState<number[]>([]);
  const [activeBlocks, setActiveBlocks] = useState<BlockData[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);

  // Availability override state
  const [availabilityDormIds, setAvailabilityDormIds] = useState<number[]>([]);
  const [availabilityStart, setAvailabilityStart] = useState("");
  const [availabilityEnd, setAvailabilityEnd] = useState("");
  const [availabilityDays, setAvailabilityDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [availabilityMode, setAvailabilityMode] = useState<"set" | "clear">("set");
  const [availabilityValue, setAvailabilityValue] = useState("");
  const [availabilityPreview, setAvailabilityPreview] = useState<BulkAvailabilityPreview | null>(null);
  const [loadingAvailabilityPreview, setLoadingAvailabilityPreview] = useState(false);

  // Set rates state
  const [rateRpIds, setRateRpIds] = useState<number[]>([]);
  const [rateStart, setRateStart] = useState("");
  const [rateEnd, setRateEnd] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [rateDays, setRateDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Adjust rates state
  const [adjustRpIds, setAdjustRpIds] = useState<number[]>([]);
  const [adjustStart, setAdjustStart] = useState("");
  const [adjustEnd, setAdjustEnd] = useState("");
  const [adjustDirection, setAdjustDirection] = useState<"increase" | "decrease">("increase");
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustType, setAdjustType] = useState<"percentage" | "flat">("percentage");
  const [adjustDays, setAdjustDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Restrictions state
  const [restrictRpIds, setRestrictRpIds] = useState<number[]>([]);
  const [restrictStart, setRestrictStart] = useState("");
  const [restrictEnd, setRestrictEnd] = useState("");
  const [restrictDays, setRestrictDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [restrictType, setRestrictType] = useState<string>("stopSell");
  const [restrictValue, setRestrictValue] = useState<string | boolean>("");

  const today = todayIST();
  const blockExclusiveEnd = exclusiveEndFromInclusive(blockStart, blockEnd);

  useEffect(() => {
    if (!availabilityDormIds.length || !availabilityStart || !availabilityEnd) {
      setAvailabilityPreview(null);
      setLoadingAvailabilityPreview(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoadingAvailabilityPreview(true);
      try {
        const typedValue = Number(availabilityValue);
        const validValue = Number.isInteger(typedValue) && typedValue >= 0;
        const res = await fetch("/api/admin/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password, username, action: "bulkSetAvailability", preview: true,
            dormIds: availabilityDormIds, startDate: availabilityStart, endDate: availabilityEnd,
            dayFilter: availabilityDays, mode: availabilityMode,
            onlineRemaining: availabilityMode === "set" && validValue ? typedValue : undefined,
          }),
        });
        const json = await res.json();
        if (!cancelled) setAvailabilityPreview(res.ok && json.success && json.preview ? json : null);
      } catch {
        if (!cancelled) setAvailabilityPreview(null);
      } finally {
        if (!cancelled) setLoadingAvailabilityPreview(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [availabilityDormIds, availabilityStart, availabilityEnd, availabilityDays, availabilityMode, availabilityValue, password, username]);

  const setStartAndNextEnd = (start: string, setStart: (v: string) => void, setEnd: (v: string) => void) => {
    setStart(start);
    setEnd(start ? addCalendarDays(start, 1) : "");
  };

  useEffect(() => {
    if (!blockDormId || !blockStart || !blockExclusiveEnd) {
      setFetchedFreeBeds(null);
      return;
    }
    let cancelled = false;
    setFetchedFreeBeds(null);
    setLoadingFreeBeds(true);
    (async () => {
      try {
        const res = await fetch("/api/admin/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password, username, action: "getBedsFreeToBlock",
            dormId: blockDormId, startDate: blockStart, endDate: blockExclusiveEnd,
          }),
        });
        const json = await res.json();
        if (!cancelled && Array.isArray(json.beds)) setFetchedFreeBeds(json.beds);
        else if (!cancelled) setFetchedFreeBeds(null);
      } catch {
        if (!cancelled) setFetchedFreeBeds(null);
      } finally {
        if (!cancelled) setLoadingFreeBeds(false);
      }
    })();
    return () => { cancelled = true; };
  }, [blockDormId, blockStart, blockExclusiveEnd, password, username]);

  useEffect(() => {
    if (tab !== "unblockBeds") return;
    let cancelled = false;
    setLoadingBlocks(true);
    (async () => {
      try {
        const res = await fetch("/api/admin/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, username, action: "getActiveBlocks" }),
        });
        const json = await res.json();
        if (!cancelled && Array.isArray(json.blocks)) setActiveBlocks(json.blocks);
        else if (!cancelled) setActiveBlocks([]);
      } catch {
        if (!cancelled) setActiveBlocks([]);
      } finally {
        if (!cancelled) setLoadingBlocks(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, password, username]);

  const dormBeds = fetchedFreeBeds ?? [];
  const freeBedKey = dormBeds.map((b) => b.id).sort((a, b) => a - b).join(",");

  useEffect(() => {
    const ids = new Set(freeBedKey ? freeBedKey.split(",").map(Number) : []);
    setBlockBedIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [freeBedKey]);

  const toggleDay = (day: number, currentDays: number[], setter: (d: number[]) => void) => {
    setter(currentDays.includes(day) ? currentDays.filter((d) => d !== day) : [...currentDays, day]);
  };

  const DaySelector = ({ days, setDays }: { days: number[]; setDays: (d: number[]) => void }) => (
    <div className="flex gap-1 flex-wrap">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, i) => (
        <button key={i} type="button" onClick={() => toggleDay(i, days, setDays)}
          aria-pressed={days.includes(i)}
          className={cn("px-2 py-1 rounded text-[10px] font-medium border", days.includes(i) ? "bg-brand-green text-white border-brand-green" : "border-input text-brand-green-dark/60")}
        >{name}</button>
      ))}
      {[
        { label: "Weekdays", preset: [0, 1, 2, 3, 4] },
        { label: "Weekends", preset: [5, 6] },
        { label: "All", preset: [0, 1, 2, 3, 4, 5, 6] },
      ].map(({ label, preset }) => {
        const selected = days.length === preset.length && preset.every((day) => days.includes(day));
        return (
          <button key={label} type="button" onClick={() => setDays(preset)} aria-pressed={selected}
            className={cn("px-2 py-1 rounded text-[10px] font-medium border transition-colors", selected ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700" : "border-input text-brand-green-dark/60 hover:bg-brand-sand")}
          >{label}</button>
        );
      })}
    </div>
  );

  const handleBlockBeds = async () => {
    if (!blockBedIds.length || !blockStart || !blockExclusiveEnd) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "blockBeds", bedIds: blockBedIds, dormId: blockDormId, startDate: blockStart, endDate: blockExclusiveEnd, reason: blockReason }),
      });
      const json = await res.json();
      setResult(json.success ? `Blocked ${json.blocked} bed(s)` : json.error);
      if (json.success) { onSaved(); setTimeout(onClose, 800); }
    } finally { setSaving(false); }
  };

  const handleUnblockBeds = async () => {
    if (!unblockIds.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "unblockBeds", blockIds: unblockIds }),
      });
      const json = await res.json();
      setResult(json.success ? "Beds unblocked" : json.error);
      if (json.success) { onSaved(); setTimeout(onClose, 800); }
    } finally { setSaving(false); }
  };

  const handleBulkAvailability = async () => {
    if (!availabilityDormIds.length || !availabilityStart || !availabilityEnd) return;
    const value = Number(availabilityValue);
    if (availabilityMode === "set" && (!Number.isInteger(value) || value < 0)) return;
    const affectedNights = inclusiveNights(availabilityStart, availabilityEnd).filter((date) => availabilityDays.length === 0 || availabilityDays.includes(civilWeekday(date))).length;
    const confirmed = window.confirm(
      `${availabilityMode === "set" ? "Set" : "Clear"} availability for ${availabilityDormIds.length} room${availabilityDormIds.length === 1 ? "" : "s"} across ${affectedNights} night${affectedNights === 1 ? "" : "s"}?${availabilityMode === "set" ? `\n\nOTA/PMS slots remaining: ${value}.` : "\n\nThis removes the default override and restores calculated availability."}`,
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password, username, action: "bulkSetAvailability",
          dormIds: availabilityDormIds,
          startDate: availabilityStart,
          endDate: availabilityEnd,
          dayFilter: availabilityDays,
          mode: availabilityMode,
          onlineRemaining: availabilityMode === "set" ? value : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setResult(json.error || "Availability update failed");
        if (json.partial) onSaved();
        return;
      }
      const count = availabilityMode === "set" ? json.updated : json.cleared;
      const syncMessage = json.sync?.accepted
        ? " PMS inventory synced."
        : json.sync?.message
          ? ` Local update saved; PMS sync pending: ${json.sync.message}.`
          : " Local update saved; PMS sync can be retried from Channel Manager.";
      const capMessage = json.capped ? ` ${json.capped} cell(s) capped to available inventory.` : "";
      const unmappedMessage = json.unmappedDormIds?.length ? ` ${json.unmappedDormIds.length} unmapped dorm(s) are local-only.` : "";
      setResult(`${availabilityMode === "set" ? "Updated" : "Cleared"} ${count} availability cell(s).${capMessage}${unmappedMessage}${syncMessage}`);
      onSaved();
      setTimeout(onClose, 1200);
    } catch {
      setResult("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleSetRates = async () => {
    if (!rateRpIds.length || !rateStart || !rateEnd || !rateValue) return;
    setSaving(true);
    try {
      const dates = inclusiveNights(rateStart, rateEnd);
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "bulkSetRates", ratePlanIds: rateRpIds, dates, dayFilter: rateDays, rate: parseInt(rateValue), adult1Rate: parseInt(rateValue) }),
      });
      const json = await res.json();
      setResult(json.success ? `Updated ${json.updated} rate(s)` : json.error);
      if (json.success) { onSaved(); setTimeout(onClose, 800); }
    } finally { setSaving(false); }
  };

  const handleAdjustRates = async () => {
    if (!adjustRpIds.length || !adjustStart || !adjustEnd || !adjustValue) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "bulkAdjustRates", ratePlanIds: adjustRpIds, startDate: adjustStart, endDate: adjustEnd, dayFilter: adjustDays, direction: adjustDirection, value: parseInt(adjustValue), type: adjustType }),
      });
      const json = await res.json();
      setResult(json.success ? `Adjusted ${json.updated} rate(s)` : json.error);
      if (json.success) { onSaved(); setTimeout(onClose, 800); }
    } finally { setSaving(false); }
  };

  const handleSetRestrictions = async () => {
    if (!restrictRpIds.length || !restrictStart || !restrictEnd || !restrictType) return;
    setSaving(true);
    try {
      const booleanTypes = ["stopSell", "closeOnArrival", "closeOnDeparture"];
      const numVal = parseInt(String(restrictValue));
      const val = booleanTypes.includes(restrictType) ? (restrictValue === true || restrictValue === "true") : (isNaN(numVal) ? null : numVal);
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "bulkSetRestrictions", ratePlanIds: restrictRpIds, startDate: restrictStart, endDate: restrictEnd, dayFilter: restrictDays, restrictionType: restrictType, value: val }),
      });
      const json = await res.json();
      setResult(json.success ? `Updated ${json.updated} restriction(s)` : json.error);
      if (json.success) { onSaved(); setTimeout(onClose, 800); }
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">Bulk Update</h3>

        {/* Tabs */}
        <div className="mt-3 flex gap-1 flex-wrap">
          {([["blockBeds", "Block Beds"], ["unblockBeds", "Unblock"], ["availability", "Availability"], ["setRates", "Set Rates"], ["adjustRates", "Adjust Rates"], ["restrictions", "Restrictions"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setTab(id); setResult(""); }}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", tab === id ? "bg-brand-green text-white" : "bg-brand-sand text-brand-green-dark/70 hover:bg-brand-mist")}
            >{label}</button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {tab === "blockBeds" && (
            <>
              <div>
                <label className="text-xs font-medium">Dorm</label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={blockDormId} onChange={(e) => { setBlockDormId(Number(e.target.value)); setBlockBedIds([]); }}>
                  <option value={0}>Select dorm</option>
                  {data?.dorms.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Start Date</label>
                  <input type="date" min={today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={blockStart} onChange={(e) => setStartAndNextEnd(e.target.value, setBlockStart, setBlockEnd)} />
                </div>
                <div>
                  <label className="text-xs font-medium">End Date</label>
                  <input type="date" min={blockStart || today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} />
                </div>
              </div>
              <p className="text-[10px] text-brand-green-dark/50">Both dates are nights included. 1 Sep–2 Sep covers both nights; only beds free on every night in the range are shown (the tightest night wins). Past dates are disabled.</p>
              {blockDormId > 0 && blockExclusiveEnd && (
                <div>
                  <label className="text-xs font-medium">Beds free to block</label>
                  {loadingFreeBeds ? (
                    <p className="mt-1 text-xs text-brand-green-dark/50">Loading available beds...</p>
                  ) : dormBeds.length === 0 ? (
                    <p className="mt-1 text-xs text-brand-green-dark/50">No beds free to block for these dates (already booked or blocked).</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      <button type="button" onClick={() => setBlockBedIds(blockBedIds.length === dormBeds.length ? [] : dormBeds.map((b) => b.id))}
                        className="px-2 py-1 rounded text-[10px] font-medium border border-brand-green text-brand-green">
                        {blockBedIds.length === dormBeds.length && dormBeds.length > 0 ? "Deselect All" : "Select All"}
                      </button>
                      {dormBeds.map((b) => (
                        <button key={b.id} type="button" onClick={() => setBlockBedIds(blockBedIds.includes(b.id) ? blockBedIds.filter((x) => x !== b.id) : [...blockBedIds, b.id])}
                          className={cn("px-2 py-1 rounded text-[10px] font-medium border", blockBedIds.includes(b.id) ? "bg-brand-green text-white border-brand-green" : "border-input")}>
                          {b.bedId}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div><label className="text-xs font-medium">Reason</label><input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Maintenance, etc." /></div>
              <Button variant="cta" size="sm" className="w-full" onClick={handleBlockBeds} disabled={saving || !blockBedIds.length || !blockStart || !blockExclusiveEnd}>
                {saving ? "Blocking..." : `Block ${blockBedIds.length} Bed(s)`}
              </Button>
            </>
          )}

          {tab === "unblockBeds" && (
            <>
              <div className="text-xs text-brand-green-dark/60 mb-2">Active blocks:</div>
              {loadingBlocks ? (
                <p className="text-sm text-brand-green-dark/50">Loading blocks...</p>
              ) : activeBlocks.length === 0 ? (
                <p className="text-sm text-brand-green-dark/50">No active blocks found.</p>
              ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {activeBlocks.map((bl) => {
                  const bed = data?.beds.find((b) => b.id === bl.bedId);
                  const dorm = data?.dorms.find((d) => d.id === bl.dormId);
                  return (
                    <label key={bl.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-brand-sand text-xs cursor-pointer">
                      <input type="checkbox" checked={unblockIds.includes(bl.id)} onChange={() => setUnblockIds(unblockIds.includes(bl.id) ? unblockIds.filter((x) => x !== bl.id) : [...unblockIds, bl.id])} />
                      <span className="font-medium">{dorm?.name} — {bed?.bedId}</span>
                      <span className="text-brand-green-dark/50">{bl.startDate}{bl.endDate > bl.startDate ? ` to ${addCalendarDays(bl.endDate, -1)}` : ""}</span>
                      {bl.reason && <span className="text-brand-green-dark/40">({bl.reason})</span>}
                    </label>
                  );
                })}
              </div>
              )}
              <Button variant="cta" size="sm" className="w-full" onClick={handleUnblockBeds} disabled={saving || !unblockIds.length}>
                {saving ? "Unblocking..." : `Unblock ${unblockIds.length} Block(s)`}
              </Button>
            </>
          )}

          {tab === "availability" && (
            <>
              <div>
                <label className="text-xs font-medium">Rooms / Dorms</label>
                <div className="mt-1">
                  <DormAvailabilityPicker
                    dorms={data?.dorms ?? []}
                    mappings={data?.roomMappings ?? []}
                    selectedIds={availabilityDormIds}
                    onChange={setAvailabilityDormIds}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-medium">Start Date</label><input type="date" min={today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={availabilityStart} onChange={(e) => setStartAndNextEnd(e.target.value, setAvailabilityStart, setAvailabilityEnd)} /></div>
                <div><label className="text-xs font-medium">End Date</label><input type="date" min={availabilityStart || today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={availabilityEnd} onChange={(e) => setAvailabilityEnd(e.target.value)} /></div>
              </div>
              <p className="text-[10px] text-brand-green-dark/50">Both dates are nights included. Availability means OTA/PMS slots remaining; walk-in availability is calculated automatically. Past dates are disabled.</p>
              <div><label className="text-xs font-medium">Days</label><div className="mt-1"><DaySelector days={availabilityDays} setDays={setAvailabilityDays} /></div></div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAvailabilityMode("set")} className={cn("flex-1 py-1.5 rounded text-xs font-medium border", availabilityMode === "set" ? "bg-brand-green text-white border-brand-green" : "border-input")}>Set Availability</button>
                <button type="button" onClick={() => setAvailabilityMode("clear")} className={cn("flex-1 py-1.5 rounded text-xs font-medium border", availabilityMode === "clear" ? "bg-amber-600 text-white border-amber-600" : "border-input")}>Clear Override</button>
              </div>
              {availabilityMode === "set" && (
                <div>
                  <label className="text-xs font-medium">Online (OTA/PMS) slots remaining</label>
                  <input type="number" min={0} step={1} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={availabilityValue} onChange={(e) => setAvailabilityValue(e.target.value)} placeholder="e.g. 3" />
                  <p className="mt-0.5 text-[10px] text-brand-green-dark/50">The value is applied per selected room/date. Existing bookings, holds, and blocks are preserved; values above available inventory are capped.</p>
                </div>
              )}
              <AvailabilityPreviewPanel preview={availabilityPreview} loading={loadingAvailabilityPreview} mode={availabilityMode} />
              <Button variant="cta" size="sm" className="w-full" onClick={handleBulkAvailability} disabled={saving || !availabilityDormIds.length || !availabilityStart || !availabilityEnd || (availabilityMode === "set" && (!availabilityValue || !Number.isInteger(Number(availabilityValue)) || Number(availabilityValue) < 0))}>
                {saving ? "Updating..." : availabilityMode === "set" ? `Set ${availabilityValue || "…"} OTA slot${availabilityValue === "1" ? "" : "s"}` : "Clear Availability Overrides"}
              </Button>
            </>
          )}

          {tab === "setRates" && (
            <>
              <div>
                <label className="text-xs font-medium">Rooms / Rate Plans</label>
                <div className="mt-1">
                  <RatePlanChipPicker
                    plans={data?.ratePlans ?? []}
                    mappings={data?.roomMappings ?? []}
                    selectedIds={rateRpIds}
                    onChange={setRateRpIds}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-medium">Start Date</label><input type="date" min={today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={rateStart} onChange={(e) => setStartAndNextEnd(e.target.value, setRateStart, setRateEnd)} /></div>
                <div><label className="text-xs font-medium">End Date</label><input type="date" min={rateStart || today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={rateEnd} onChange={(e) => setRateEnd(e.target.value)} /></div>
              </div>
              <div><label className="text-xs font-medium">Days</label><div className="mt-1"><DaySelector days={rateDays} setDays={setRateDays} /></div></div>
              <div><label className="text-xs font-medium">Rate (₹)</label><input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={rateValue} onChange={(e) => setRateValue(e.target.value)} /></div>
              {rateRpIds.length > 0 && rateValue && (
                <p className="text-[10px] text-brand-green-dark/60">Writes ₹{rateValue} onto {rateRpIds.length} rate plan{rateRpIds.length === 1 ? "" : "s"}.</p>
              )}
              <Button variant="cta" size="sm" className="w-full" onClick={handleSetRates} disabled={saving || !rateRpIds.length || !rateStart || !rateEnd || !rateValue}>
                {saving ? "Setting..." : `Set ₹${rateValue || "…"} on ${rateRpIds.length} plan${rateRpIds.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}

          {tab === "adjustRates" && (
            <>
              <div>
                <label className="text-xs font-medium">Rooms / Rate Plans</label>
                <div className="mt-1">
                  <RatePlanChipPicker
                    plans={data?.ratePlans ?? []}
                    mappings={data?.roomMappings ?? []}
                    selectedIds={adjustRpIds}
                    onChange={setAdjustRpIds}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-medium">Start</label><input type="date" min={today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={adjustStart} onChange={(e) => setStartAndNextEnd(e.target.value, setAdjustStart, setAdjustEnd)} /></div>
                <div><label className="text-xs font-medium">End</label><input type="date" min={adjustStart || today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={adjustEnd} onChange={(e) => setAdjustEnd(e.target.value)} /></div>
              </div>
              <div><label className="text-xs font-medium">Days</label><div className="mt-1"><DaySelector days={adjustDays} setDays={setAdjustDays} /></div></div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAdjustDirection("increase")} className={cn("flex-1 py-1.5 rounded text-xs font-medium border", adjustDirection === "increase" ? "bg-green-600 text-white border-green-600" : "border-input")}>Increase</button>
                <button type="button" onClick={() => setAdjustDirection("decrease")} className={cn("flex-1 py-1.5 rounded text-xs font-medium border", adjustDirection === "decrease" ? "bg-red-600 text-white border-red-600" : "border-input")}>Decrease</button>
              </div>
              <div className="flex gap-2">
                <input type="number" className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={adjustValue} onChange={(e) => setAdjustValue(e.target.value)} placeholder="Value" />
                <select className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={adjustType} onChange={(e) => setAdjustType(e.target.value as any)}>
                  <option value="percentage">%</option>
                  <option value="flat">₹ Flat</option>
                </select>
              </div>
              <Button variant="cta" size="sm" className="w-full" onClick={handleAdjustRates} disabled={saving || !adjustRpIds.length || !adjustStart || !adjustEnd || !adjustValue}>
                {saving ? "Adjusting..." : "Adjust Rates"}
              </Button>
            </>
          )}

          {tab === "restrictions" && (
            <>
              <div>
                <label className="text-xs font-medium">Rooms / Rate Plans</label>
                <div className="mt-1">
                  <RatePlanChipPicker
                    plans={data?.ratePlans ?? []}
                    mappings={data?.roomMappings ?? []}
                    selectedIds={restrictRpIds}
                    onChange={setRestrictRpIds}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-medium">Start</label><input type="date" min={today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={restrictStart} onChange={(e) => setStartAndNextEnd(e.target.value, setRestrictStart, setRestrictEnd)} /></div>
                <div><label className="text-xs font-medium">End</label><input type="date" min={restrictStart || today} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={restrictEnd} onChange={(e) => setRestrictEnd(e.target.value)} /></div>
              </div>
              <div><label className="text-xs font-medium">Days</label><div className="mt-1"><DaySelector days={restrictDays} setDays={setRestrictDays} /></div></div>
              <div>
                <label className="text-xs font-medium">Restriction Type</label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={restrictType} onChange={(e) => { setRestrictType(e.target.value); setRestrictValue(""); }}>
                  <option value="stopSell">Stop Sell</option>
                  <option value="closeOnArrival">Close on Arrival</option>
                  <option value="closeOnDeparture">Close on Departure</option>
                  <option value="minimumStay">Minimum Stay</option>
                  <option value="maximumStay">Maximum Stay</option>
                  <option value="minimumAdvanceReservation">Min Advance Reservation</option>
                  <option value="maximumAdvanceReservation">Max Advance Reservation</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Value</label>
                {["stopSell", "closeOnArrival", "closeOnDeparture"].includes(restrictType) ? (
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => setRestrictValue(true)} className={cn("flex-1 py-1.5 rounded text-xs font-medium border", restrictValue === true ? "bg-red-600 text-white border-red-600" : "border-input")}>Enable</button>
                    <button type="button" onClick={() => setRestrictValue(false)} className={cn("flex-1 py-1.5 rounded text-xs font-medium border", restrictValue === false ? "bg-green-600 text-white border-green-600" : "border-input")}>Disable</button>
                  </div>
                ) : (
                  <input type="number" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={String(restrictValue)} onChange={(e) => setRestrictValue(e.target.value)} placeholder="Number of nights / days" />
                )}
              </div>
              <Button variant="cta" size="sm" className="w-full" onClick={handleSetRestrictions} disabled={saving || !restrictRpIds.length || !restrictStart || !restrictEnd || restrictValue === ""}>
                {saving ? "Setting..." : "Set Restrictions"}
              </Button>
            </>
          )}
        </div>

        {result && <p className="mt-3 text-sm font-medium text-brand-green">{result}</p>}

        <div className="mt-4">
          <Button variant="outline" size="sm" className="w-full" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
