"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminApi } from "./useAdminApi";
import { cn } from "@/lib/utils";
import { UserPlusIcon, SparklesIcon, ClockIcon, Loader2Icon } from "lucide-react";
import type { Role, BedRow } from "./types";
import { AdminLoading } from "./AdminLoading";

function parseBedRow(row: string[]): BedRow {
  return {
    dormName: row[0] || "",
    bedId: row[1] || "",
    position: (row[2] || "Lower") as BedRow["position"],
    type: (row[3] || "Bunk") as BedRow["type"],
    status: (row[4] || "available") as BedRow["status"],
    guestName: row[5] || "",
    guestContact: row[6] || "",
    checkinDate: row[7] || "",
    expectedCheckout: row[8] || "",
    stayingDays: row[9] || "",
  };
}

function getDaysRemaining(expectedCheckout: string): number {
  if (!expectedCheckout) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const checkout = new Date(expectedCheckout); checkout.setHours(0, 0, 0, 0);
  return Math.ceil((checkout.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function statusColor(status: string, isOverdue: boolean) {
  if (status === "available") return { border: "border-green-400", bg: "bg-green-50", fill: "#22c55e" };
  if (status === "occupied" && isOverdue) return { border: "border-yellow-400", bg: "bg-yellow-50", fill: "#eab308" };
  if (status === "occupied") return { border: "border-red-400", bg: "bg-red-50", fill: "#ef4444" };
  return { border: "border-orange-400", bg: "bg-orange-50", fill: "#f97316" };
}

function BedSlotSvg({ position, fill }: { position: string; fill: string }) {
  if (position === "Upper") {
    return (
      <svg viewBox="0 0 48 32" className="h-6 w-8" aria-hidden>
        <rect x="2" y="2" width="44" height="10" rx="2" fill={fill} opacity="0.25" stroke={fill} strokeWidth="1.5" />
        <rect x="2" y="14" width="44" height="10" rx="2" fill="none" stroke="#d1d5db" strokeWidth="1" strokeDasharray="3 2" />
        <line x1="4" y1="26" x2="4" y2="30" stroke={fill} strokeWidth="2" />
        <line x1="44" y1="26" x2="44" y2="30" stroke={fill} strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 32" className="h-6 w-8" aria-hidden>
      <rect x="2" y="2" width="44" height="10" rx="2" fill="none" stroke="#d1d5db" strokeWidth="1" strokeDasharray="3 2" />
      <rect x="2" y="14" width="44" height="10" rx="2" fill={fill} opacity="0.25" stroke={fill} strokeWidth="1.5" />
      <line x1="4" y1="26" x2="4" y2="30" stroke={fill} strokeWidth="2" />
      <line x1="44" y1="26" x2="44" y2="30" stroke={fill} strokeWidth="2" />
    </svg>
  );
}

function BedCard({ bed, onAssign, onCheckout, onMarkClean, onUnassign, onChangeBed, isLoading }: {
  bed: BedRow;
  onAssign: () => void;
  onCheckout: () => void;
  onMarkClean: () => void;
  onUnassign?: () => void;
  onChangeBed?: () => void;
  isLoading?: boolean;
}) {
  const daysLeft = getDaysRemaining(bed.expectedCheckout);
  const isOverdue = bed.status === "occupied" && daysLeft < 0;
  const colors = statusColor(bed.status, isOverdue);

  return (
    <div className={cn(
      "relative rounded-xl border-2 p-3 transition-all duration-200",
      colors.border, colors.bg,
      bed.status === "available" && !isLoading && "hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
    )} onClick={bed.status === "available" && !isLoading ? onAssign : undefined}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70">
          <Loader2Icon className="h-5 w-5 animate-spin text-brand-green" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <BedSlotSvg position={bed.position} fill={colors.fill} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-brand-green-dark/80">{bed.bedId}</span>
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
              bed.position === "Upper" ? "bg-brand-green-dark/10 text-brand-green-dark/60" : "bg-brand-green-dark/5 text-brand-green-dark/50"
            )}>{bed.position}</span>
          </div>
        </div>
      </div>

      {bed.status === "available" && (
        <div className="mt-2 flex items-center gap-1.5">
          <UserPlusIcon className="h-3.5 w-3.5 text-green-600" />
          <span className="text-[11px] font-medium text-green-700">Available</span>
        </div>
      )}

      {bed.status === "occupied" && (
        <div className="mt-2">
          <p className="truncate text-xs font-semibold text-brand-green-dark">{bed.guestName}</p>
          <div className="mt-1 flex items-center gap-1">
            <ClockIcon className="h-3 w-3 shrink-0" />
            <span className={cn("text-[10px] font-medium", isOverdue ? "text-red-600" : daysLeft <= 1 ? "text-orange-600" : "text-brand-green-dark/60")}>
              {isOverdue ? `OVERDUE ${Math.abs(daysLeft)}d` : daysLeft === 0 ? "Checkout today" : `${daysLeft}d remaining`}
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); onCheckout(); }}
              className="flex-1 rounded-lg bg-red-500/10 px-1 py-1.5 text-[9px] font-semibold text-red-600 hover:bg-red-500/20">
              Checkout
            </button>
            {onUnassign && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onUnassign(); }}
                className="flex-1 rounded-lg bg-gray-100 px-1 py-1.5 text-[9px] font-semibold text-gray-600 hover:bg-gray-200">
                Unassign
              </button>
            )}
            {onChangeBed && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onChangeBed(); }}
                className="flex-1 rounded-lg bg-blue-500/10 px-1 py-1.5 text-[9px] font-semibold text-blue-600 hover:bg-blue-500/20">
                Change
              </button>
            )}
          </div>
        </div>
      )}

      {bed.status === "cleanup" && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <SparklesIcon className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-[11px] font-medium text-orange-700">Needs cleaning</span>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onMarkClean(); }}
            className="mt-2 w-full rounded-lg bg-orange-500/10 px-2 py-1.5 text-[10px] font-semibold text-orange-600 transition-colors hover:bg-orange-500/20">
            Mark clean
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminBeds({ password, role }: { password: string; role: Role }) {
  const { apiCall } = useAdminApi(password);
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [unassigned, setUnassigned] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBedIdx, setLoadingBedIdx] = useState<number | null>(null);
  const [selectedDorm, setSelectedDorm] = useState<string | null>(null);
  const [assigningGuest, setAssigningGuest] = useState<string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => { loadBeds(); }, []);

  const loadBeds = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getBeds" });
      if (res.ok) {
        const data = await res.json();
        setBeds((data.beds || []).map(parseBedRow));
        setUnassigned(data.unassigned || []);
      }
    } finally { setLoading(false); }
  };

  const assignBed = async (bedIdx: number, guest: string[]) => {
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({
        action: "assignBed",
        bedIndex: bedIdx,
        guestName: guest[3],
        guestContact: guest[5],
        checkinDate: guest[1],
        stayingDays: guest[6],
      });
      if (res.ok) { setAssigningGuest(null); await loadBeds(); }
    } finally { setLoadingBedIdx(null); }
  };

  const checkoutBed = async (bedIdx: number) => {
    if (!confirm("Checkout this guest?")) return;
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({ action: "checkoutBed", bedIndex: bedIdx });
      if (res.ok) await loadBeds();
    } finally { setLoadingBedIdx(null); }
  };

  const markClean = async (bedIdx: number) => {
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({ action: "markClean", bedIndex: bedIdx });
      if (res.ok) await loadBeds();
    } finally { setLoadingBedIdx(null); }
  };

  const unassignBed = async (bedIdx: number) => {
    if (!confirm("Unassign this bed? (No cleanup needed - for wrong assignment correction)")) return;
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({ action: "unassignBed", bedIndex: bedIdx });
      if (res.ok) await loadBeds();
    } finally { setLoadingBedIdx(null); }
  };

  const [changingBed, setChangingBed] = useState<number | null>(null);

  const changeBed = async (fromIdx: number, toIdx: number) => {
    setLoadingBedIdx(fromIdx);
    try {
      const res = await apiCall({ action: "changeBed", fromBedIndex: fromIdx, toBedIndex: toIdx });
      if (res.ok) { setChangingBed(null); await loadBeds(); }
      else { const d = await res.json(); alert(d.error || "Failed"); }
    } finally { setLoadingBedIdx(null); }
  };

  if (loading) {
    return <AdminLoading message="Loading beds..." />;
  }

  const dorms = [...new Set(beds.map((b) => b.dormName))];
  const dormStats = dorms.map((name) => {
    const dormBeds = beds.filter((b) => b.dormName === name);
    const uppers = dormBeds.filter((b) => b.position === "Upper").length;
    const lowers = dormBeds.filter((b) => b.position === "Lower").length;
    const singleCount = dormBeds.filter((b) => b.position === "Single").length;
    let layoutType: "1u1l" | "1u2l" | "single" | "mixed" = "mixed";
    if (singleCount === dormBeds.length) layoutType = "single";
    else if (uppers > 0 && lowers > 0 && lowers / uppers >= 1.8) layoutType = "1u2l";
    else if (uppers > 0 && lowers > 0) layoutType = "1u1l";
    return {
      name,
      total: dormBeds.length,
      available: dormBeds.filter((b) => b.status === "available").length,
      occupied: dormBeds.filter((b) => b.status === "occupied").length,
      cleanup: dormBeds.filter((b) => b.status === "cleanup").length,
      layoutType,
      bunks: uppers,
    };
  });

  type BedItem = { bed: BedRow; idx: number };
  type BunkGroup = { upper?: BedItem; lowers: BedItem[] };
  const bunkGroups: BunkGroup[] = [];
  const singles: BedItem[] = [];

  if (selectedDorm) {
    let dormBedsWithIdx = beds.map((b, i) => ({ bed: b, idx: i })).filter(({ bed }) => bed.dormName === selectedDorm);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      dormBedsWithIdx = dormBedsWithIdx.filter(({ bed }) =>
        bed.guestName.toLowerCase().includes(q) || bed.bedId.toLowerCase().includes(q)
      );
    }
    const groupMap = new Map<string, BunkGroup>();

    for (const item of dormBedsWithIdx) {
      if (item.bed.type === "Single") { singles.push(item); continue; }
      const numMatch = item.bed.bedId.match(/\d+/);
      const groupKey = `${item.bed.dormName}-${numMatch?.[0] || item.bed.bedId}`;

      if (!groupMap.has(groupKey)) groupMap.set(groupKey, { lowers: [] });
      const group = groupMap.get(groupKey)!;
      if (item.bed.position === "Upper") group.upper = item;
      else group.lowers.push(item);
    }
    bunkGroups.push(...groupMap.values());
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Bed Management</h2>
        <Button type="button" variant="ctaOutline" onClick={loadBeds} disabled={loading}>Refresh</Button>
      </div>

      {/* Unassigned guests */}
      {unassigned.length > 0 && !assigningGuest && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="font-medium text-blue-800">{unassigned.length} guest{unassigned.length !== 1 ? "s" : ""} without bed assignment</h3>
          <div className="mt-2 space-y-2">
            {unassigned.map((guest, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                <div>
                  <span className="font-medium text-brand-green-dark">{guest[3]}</span>
                  <span className="ml-2 text-xs text-brand-green-dark/50">{guest[6]} days · {guest[7]}</span>
                </div>
                <button type="button" onClick={() => setAssigningGuest(guest)}
                  className="rounded-md bg-brand-green px-3 py-1 text-xs font-medium text-white hover:bg-brand-green-dark">
                  Assign bed
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assigning mode banner */}
      {assigningGuest && (
        <div className="mt-4 rounded-xl border-2 border-brand-green bg-brand-green/[0.04] p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-brand-green">Assigning bed to: <strong>{assigningGuest[3]}</strong> ({assigningGuest[6]} days)</p>
            <button type="button" onClick={() => setAssigningGuest(null)} className="text-sm text-brand-green-dark/60 hover:text-brand-red">Cancel</button>
          </div>
          <p className="mt-1 text-xs text-brand-green-dark/60">Click on any available (green) bed below to assign</p>
        </div>
      )}

      {/* Changing bed banner */}
      {changingBed !== null && (
        <div className="mt-4 rounded-xl border-2 border-blue-400 bg-blue-50/50 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-blue-700">Changing bed for: <strong>{beds[changingBed]?.guestName}</strong></p>
            <button type="button" onClick={() => setChangingBed(null)} className="text-sm text-brand-green-dark/60 hover:text-brand-red">Cancel</button>
          </div>
          <p className="mt-1 text-xs text-blue-600/70">Click on any available (green) bed to move the guest there. Old bed will go to cleanup.</p>
        </div>
      )}

      {/* Dorm overview cards */}
      {!selectedDorm && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dormStats.length === 0 ? (
            <p className="col-span-full text-center text-brand-green-dark/50 py-10">No dorms configured. Go to Setup to add dorms and beds.</p>
          ) : dormStats.map((dorm) => (
            <button key={dorm.name} type="button" onClick={() => setSelectedDorm(dorm.name)}
              className="rounded-2xl border border-brand-mist bg-white p-5 text-left shadow-card transition-all hover:shadow-lift hover:-translate-y-0.5">
              <div className="flex items-center gap-3">
                {/* Bunk layout icon */}
                {dorm.layoutType === "1u2l" ? (
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-green/[0.06]">
                    <svg viewBox="0 0 48 56" className="h-14 w-12" aria-hidden>
                      <rect x="3" y="3" width="42" height="14" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="24" y="13" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2d5c3f" opacity="0.5">Upper</text>
                      <rect x="3" y="21" width="20" height="14" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="13" y="31" textAnchor="middle" fontSize="7" fontWeight="600" fill="#2d5c3f" opacity="0.5">L1</text>
                      <rect x="25" y="21" width="20" height="14" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="35" y="31" textAnchor="middle" fontSize="7" fontWeight="600" fill="#2d5c3f" opacity="0.5">L2</text>
                      <line x1="5" y1="37" x2="5" y2="43" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                      <line x1="43" y1="37" x2="43" y2="43" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                      <line x1="5" y1="43" x2="43" y2="43" stroke="#2d5c3f" strokeWidth="1" opacity="0.15" />
                      <text x="24" y="53" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#2d5c3f" opacity="0.35">{dorm.bunks}x</text>
                    </svg>
                  </div>
                ) : dorm.layoutType === "1u1l" ? (
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-green/[0.06]">
                    <svg viewBox="0 0 48 56" className="h-14 w-12" aria-hidden>
                      <rect x="3" y="3" width="42" height="14" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="24" y="13" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2d5c3f" opacity="0.5">Upper</text>
                      <rect x="3" y="21" width="42" height="14" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="24" y="31" textAnchor="middle" fontSize="8" fontWeight="600" fill="#2d5c3f" opacity="0.5">Lower</text>
                      <line x1="5" y1="37" x2="5" y2="43" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                      <line x1="43" y1="37" x2="43" y2="43" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                      <line x1="5" y1="43" x2="43" y2="43" stroke="#2d5c3f" strokeWidth="1" opacity="0.15" />
                      <text x="24" y="53" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#2d5c3f" opacity="0.35">{dorm.bunks}x</text>
                    </svg>
                  </div>
                ) : (
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-green/[0.06]">
                    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden>
                      <rect x="3" y="12" width="42" height="16" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="24" y="23" textAnchor="middle" fontSize="9" fontWeight="600" fill="#2d5c3f" opacity="0.5">Single</text>
                      <line x1="5" y1="30" x2="5" y2="36" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                      <line x1="43" y1="30" x2="43" y2="36" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                    </svg>
                  </div>
                )}
                <div>
                  <h3 className="font-display text-lg font-bold text-brand-green-dark">{dorm.name}</h3>
                  <p className="text-[10px] text-brand-green-dark/40">
                    {dorm.layoutType === "1u2l" ? "2 Lower + 1 Upper bunk" : dorm.layoutType === "1u1l" ? "1 Lower + 1 Upper bunk" : "Single beds"}
                    {dorm.bunks > 0 && ` · ${dorm.bunks} units`}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100">
                {dorm.occupied > 0 && <div className="bg-red-400" style={{ width: `${(dorm.occupied / dorm.total) * 100}%` }} />}
                {dorm.cleanup > 0 && <div className="bg-orange-400" style={{ width: `${(dorm.cleanup / dorm.total) * 100}%` }} />}
                {dorm.available > 0 && <div className="bg-green-400" style={{ width: `${(dorm.available / dorm.total) * 100}%` }} />}
              </div>
              <div className="mt-2 flex gap-3 text-xs">
                <span className="text-green-700">{dorm.available} free</span>
                <span className="text-red-700">{dorm.occupied} occupied</span>
                {dorm.cleanup > 0 && <span className="text-orange-700">{dorm.cleanup} cleanup</span>}
              </div>
              <p className="mt-1 text-xs text-brand-green-dark/50">{dorm.total} beds total</p>
            </button>
          ))}
        </div>
      )}

      {/* Bed map for selected dorm */}
      {selectedDorm && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSelectedDorm(null)} className="text-sm text-brand-green hover:underline">All dorms</button>
              <span className="text-brand-green-dark/30">/</span>
              <h3 className="font-display text-lg font-bold text-brand-green-dark">{selectedDorm}</h3>
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="Search beds..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-40 text-xs" />
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-green-400 bg-green-50" /> Available</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-red-400 bg-red-50" /> Occupied</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-orange-400 bg-orange-50" /> Cleanup</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-yellow-400 bg-yellow-50" /> Overdue</span>
          </div>

          {/* Bunk bed groups */}
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {bunkGroups.map((group, gi) => {
              const groupLabel = group.upper?.bed.bedId.match(/\d+/)?.[0] || `${gi + 1}`;
              return (
                <div key={gi} className="relative overflow-hidden rounded-2xl border border-brand-mist bg-white shadow-card">
                  <div className="border-b border-brand-mist bg-brand-sand/30 px-3 py-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-green-dark/40">Bunk {groupLabel}</span>
                  </div>
                  {/* Upper bed */}
                  {group.upper && (
                    <div className="p-1.5">
                      <BedCard bed={group.upper.bed}
                        isLoading={loadingBedIdx === group.upper.idx}
                        onAssign={() => { if (changingBed !== null) changeBed(changingBed, group.upper!.idx); else if (assigningGuest) assignBed(group.upper!.idx, assigningGuest); }}
                        onCheckout={() => checkoutBed(group.upper!.idx)}
                        onUnassign={() => unassignBed(group.upper!.idx)}
                        onChangeBed={() => setChangingBed(group.upper!.idx)}
                        onMarkClean={() => markClean(group.upper!.idx)} />
                    </div>
                  )}
                  {/* Ladder divider */}
                  <div className="flex items-center gap-2 px-3">
                    <div className="h-px flex-1 bg-brand-mist" />
                    <svg viewBox="0 0 16 20" className="h-4 w-3 text-brand-green-dark/20" aria-hidden>
                      <line x1="3" y1="0" x2="3" y2="20" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="13" y1="0" x2="13" y2="20" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1" />
                      <line x1="3" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1" />
                      <line x1="3" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    <div className="h-px flex-1 bg-brand-mist" />
                  </div>
                  {/* Lower bed(s) */}
                  {group.lowers.map((lower, li) => (
                    <div key={li} className="p-1.5 pt-0">
                      <BedCard bed={lower.bed}
                        isLoading={loadingBedIdx === lower.idx}
                        onAssign={() => { if (changingBed !== null) changeBed(changingBed, lower.idx); else if (assigningGuest) assignBed(lower.idx, assigningGuest); }}
                        onCheckout={() => checkoutBed(lower.idx)}
                        onUnassign={() => unassignBed(lower.idx)}
                        onChangeBed={() => setChangingBed(lower.idx)}
                        onMarkClean={() => markClean(lower.idx)} />
                    </div>
                  ))}
                </div>
              );
            })}
            {singles.map(({ bed, idx }) => (
              <div key={idx} className="overflow-hidden rounded-2xl border border-brand-mist bg-white shadow-card">
                <div className="border-b border-brand-mist bg-brand-sand/30 px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-green-dark/40">Single</span>
                </div>
                <div className="p-1.5">
                  <BedCard bed={bed}
                    isLoading={loadingBedIdx === idx}
                    onAssign={() => { if (changingBed !== null) changeBed(changingBed, idx); else if (assigningGuest) assignBed(idx, assigningGuest); }}
                    onCheckout={() => checkoutBed(idx)}
                    onUnassign={() => unassignBed(idx)}
                    onChangeBed={() => setChangingBed(idx)}
                    onMarkClean={() => markClean(idx)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
