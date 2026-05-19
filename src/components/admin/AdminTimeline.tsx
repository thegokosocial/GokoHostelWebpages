"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminApi } from "./useAdminApi";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronRightIcon, LogOutIcon, SparklesIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { parseBedRow, type Role, type BedRow } from "./types";
import { AdminLoading } from "./AdminLoading";

function fmtDate(d: Date): string { return d.toISOString().split("T")[0]; }
function fmtShort(d: Date): string {
  const day = d.getDate();
  const mon = d.toLocaleDateString("en", { month: "short" });
  const wd = d.toLocaleDateString("en", { weekday: "short" });
  return `${wd} ${day} ${mon}`;
}

type CellInfo = { status: "free" | "occupied" | "checkout" | "cleanup"; guest: string };

function cellFor(bed: BedRow, dayStr: string, todayStr: string): CellInfo {
  if (bed.status === "cleanup" && dayStr === todayStr) return { status: "cleanup", guest: "" };
  if (bed.status === "occupied" && bed.checkinDate) {
    const co = bed.expectedCheckout || "";
    if (co && dayStr === co) return { status: "checkout", guest: bed.guestName };
    if (dayStr >= bed.checkinDate && (!co || dayStr < co)) return { status: "occupied", guest: bed.guestName };
  }
  return { status: "free", guest: "" };
}

export function AdminTimeline({ password, role }: { password: string; role: Role }) {
  const { apiCall } = useAdminApi(password);
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [unassigned, setUnassigned] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(fmtDate(new Date()));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<{ bedIdx: number; day: string } | null>(null);
  const [numDays, setNumDays] = useState(10);

  const days = Array.from({ length: numDays }, (_, i) => { const d = new Date(startDate); d.setDate(d.getDate() + i); return d; });
  const colWidth = numDays <= 5 ? "flex-1" : numDays <= 7 ? "w-[120px] shrink-0" : "w-[100px] shrink-0";
  const today = fmtDate(new Date());

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getBeds" });
      if (res.ok) { const d = await res.json(); setBeds((d.beds || []).map(parseBedRow)); setUnassigned(d.unassigned || []); }
    } finally { setLoading(false); }
  };

  const act = async (action: string, bedIdx: number, extra?: Record<string, any>) => {
    setBusyIdx(bedIdx); setPopup(null);
    try { const r = await apiCall({ action, bedId: bedIdx, ...extra }); if (r.ok) await load(); else { const d = await r.json(); alert(d.error || "Failed"); } }
    finally { setBusyIdx(null); }
  };

  const dorms = [...new Set(beds.map((b) => b.dormName))];

  if (loading && beds.length === 0) {
    return <AdminLoading message="Loading timeline..." />;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Occupancy Timeline</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40 text-xs" />
          <select value={numDays} onChange={(e) => setNumDays(parseInt(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium">
            <option value="3">3 days</option>
            <option value="5">5 days</option>
            <option value="7">7 days</option>
            <option value="10">10 days</option>
            <option value="14">14 days</option>
          </select>
          <Button type="button" variant="ctaOutline" onClick={() => setStartDate(fmtDate(new Date()))}>Today</Button>
          <Button type="button" variant="ctaOutline" onClick={load}>Refresh</Button>
        </div>
      </div>

      <div className="mt-2 flex gap-4 text-[11px] text-brand-green-dark/60">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm bg-green-300/50" /> Free</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm bg-red-400/40" /> Occupied</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm bg-yellow-400/40" /> Checkout</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm bg-orange-400/40" /> Cleanup</span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-brand-mist bg-white shadow-card" onClick={() => setPopup(null)}>
        <div style={{ minWidth: `${140 + numDays * (numDays <= 5 ? 100 : numDays <= 7 ? 120 : 100)}px` }}>
        {/* Header */}
        <div className="flex border-b border-brand-mist bg-brand-sand/40">
          <div className="w-[140px] shrink-0 border-r border-brand-mist px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-brand-green-dark/50">Bed</div>
          {days.map((d, i) => (
            <div key={i} className={cn(colWidth, "px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide", fmtDate(d) === today ? "bg-brand-green/[0.07] text-brand-green" : "text-brand-green-dark/40")}>
              {fmtShort(d)}
            </div>
          ))}
        </div>

        {dorms.length === 0 && <div className="py-12 text-center text-sm text-brand-green-dark/40">No dorms configured</div>}

        {dorms.map((dormName, dormIdx) => {
          const dormBeds = beds.map((b) => ({ bed: b, idx: b.id })).filter(({ bed }) => bed.dormName === dormName);
          const isOpen = !collapsed.has(dormName);
          const occToday = dormBeds.filter(({ bed }) => cellFor(bed, today, today).status === "occupied").length;

          const dormColors = [
            { border: "border-l-blue-400", bg: "bg-blue-50/30", header: "bg-blue-50/50", badge: "bg-blue-100 text-blue-700" },
            { border: "border-l-purple-400", bg: "bg-purple-50/30", header: "bg-purple-50/50", badge: "bg-purple-100 text-purple-700" },
            { border: "border-l-teal-400", bg: "bg-teal-50/30", header: "bg-teal-50/50", badge: "bg-teal-100 text-teal-700" },
            { border: "border-l-amber-400", bg: "bg-amber-50/30", header: "bg-amber-50/50", badge: "bg-amber-100 text-amber-700" },
            { border: "border-l-rose-400", bg: "bg-rose-50/30", header: "bg-rose-50/50", badge: "bg-rose-100 text-rose-700" },
            { border: "border-l-emerald-400", bg: "bg-emerald-50/30", header: "bg-emerald-50/50", badge: "bg-emerald-100 text-emerald-700" },
          ];
          const dc = dormColors[dormIdx % dormColors.length];

          return (
            <div key={dormName}>
              {/* Dorm header */}
              <div className={cn("flex cursor-pointer border-b border-brand-mist border-l-4 hover:brightness-95", dc.border, dc.header)}
                onClick={(e) => { e.stopPropagation(); setCollapsed((p) => { const n = new Set(p); n.has(dormName) ? n.delete(dormName) : n.add(dormName); return n; }); }}>
                <div className="flex w-full items-center gap-2 px-3 py-2">
                  {isOpen ? <ChevronDownIcon className="h-3.5 w-3.5 text-brand-green-dark/40" /> : <ChevronRightIcon className="h-3.5 w-3.5 text-brand-green-dark/40" />}
                  <span className="font-display text-xs font-bold text-brand-green-dark">{dormName}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", dc.badge)}>{occToday}/{dormBeds.length}</span>
                </div>
              </div>

              {/* Bed rows */}
              {isOpen && dormBeds.map(({ bed, idx }) => {
                const isBusy = busyIdx === idx;

                const cells: { day: string; info: CellInfo; spanLen: number }[] = [];
                let skip = 0;
                for (let i = 0; i < days.length; i++) {
                  if (skip > 0) { skip--; continue; }
                  const dayStr = fmtDate(days[i]);
                  const info = cellFor(bed, dayStr, today);
                  if (info.status === "occupied") {
                    let len = 1;
                    while (i + len < days.length && cellFor(bed, fmtDate(days[i + len]), today).status === "occupied") len++;
                    cells.push({ day: dayStr, info, spanLen: len });
                    skip = len - 1;
                  } else {
                    cells.push({ day: dayStr, info, spanLen: 1 });
                  }
                }

                return (
                  <div key={idx} className={cn("flex border-b border-brand-mist/60 border-l-4", dc.border, isBusy && "opacity-40")}>
                    <div className={cn("flex w-[140px] shrink-0 items-center gap-1.5 border-r border-brand-mist px-3 py-1.5", dc.bg)}>
                      {isBusy && <Loader2Icon className="h-3 w-3 animate-spin text-brand-green" />}
                      <span className="text-[11px] font-semibold text-brand-green-dark">{bed.bedId}</span>
                      <span className="text-[9px] text-brand-green-dark/35">{bed.position}</span>
                    </div>
                    {cells.map((c, ci) => {
                      const isActive = popup?.bedIdx === idx && popup?.day === c.day;
                      return (
                        <div key={ci} className={cn("relative p-0.5", numDays <= 5 ? "" : "shrink-0")}
                          style={numDays > 5 ? { width: `${c.spanLen * (numDays <= 7 ? 120 : 100)}px` } : { flex: c.spanLen }}
                          onClick={(e) => e.stopPropagation()}>
                          <button type="button" disabled={isBusy}
                            onClick={() => setPopup(isActive ? null : { bedIdx: idx, day: c.day })}
                            className={cn(
                              "block h-full w-full rounded-md py-1.5 text-[10px] font-medium transition-all",
                              c.info.status === "free" && "bg-green-200/30 hover:bg-green-300/40",
                              c.info.status === "occupied" && "bg-red-400/25 text-red-900 hover:bg-red-400/35",
                              c.info.status === "checkout" && "bg-yellow-400/30 text-yellow-900 hover:bg-yellow-400/40",
                              c.info.status === "cleanup" && "bg-orange-400/25 text-orange-800 hover:bg-orange-400/35",
                            )}>
                            {c.info.status === "occupied" && <span className="block truncate px-1 font-semibold">{c.info.guest}</span>}
                            {c.info.status === "checkout" && <span className="block text-[9px]">checkout</span>}
                            {c.info.status === "cleanup" && <SparklesIcon className="mx-auto h-3 w-3" />}
                          </button>

                          {isActive && (
                            <div className="absolute left-0 top-full z-30 mt-1 min-w-[150px] rounded-xl border border-brand-mist bg-white p-2.5 shadow-lift"
                              onClick={(e) => e.stopPropagation()}>
                              {c.info.status === "free" && unassigned.length > 0 && (
                                <div>
                                  <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-brand-green-dark/40">Assign</p>
                                  {unassigned.slice(0, 5).map((g, gi) => (
                                    <button key={gi} type="button"
                                      onClick={() => act("assignBed", idx, { guestName: g[3], guestContact: g[5], checkinDate: c.day, stayingDays: g[6] })}
                                      className="block w-full rounded-md px-2 py-1 text-left text-[11px] hover:bg-brand-sand">
                                      {g[3]} <span className="text-brand-green-dark/40">{g[6]}d</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {c.info.status === "free" && unassigned.length === 0 && <p className="text-[10px] text-brand-green-dark/40">No guests to assign</p>}
                              {(c.info.status === "occupied" || c.info.status === "checkout") && (
                                <div>
                                  <p className="mb-1 text-[11px] font-semibold">{bed.guestName}</p>
                                  <button type="button" onClick={() => act("checkoutBed", idx)}
                                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-red-600 hover:bg-red-50">
                                    <LogOutIcon className="h-3 w-3" /> Checkout
                                  </button>
                                  <button type="button" onClick={() => { if (confirm("Unassign this bed? (No cleanup needed)")) act("unassignBed", idx); }}
                                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">
                                    <XCircleIcon className="h-3 w-3" /> Unassign
                                  </button>
                                </div>
                              )}
                              {c.info.status === "cleanup" && (
                                <button type="button" onClick={() => act("markClean", idx)}
                                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-orange-600 hover:bg-orange-50">
                                  <SparklesIcon className="h-3 w-3" /> Mark clean
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
