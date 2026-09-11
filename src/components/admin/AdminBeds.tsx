"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminApi } from "./useAdminApi";
import { useAdminToast } from "@/components/admin/AdminToast";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, overlayVariants, modalVariants } from "@/lib/animations";
import { UserPlusIcon, SparklesIcon, ClockIcon, Loader2Icon } from "lucide-react";
import { parseBedRow, type Role, type BedRow, hasPermission } from "./types";
import { AdminLoading } from "./AdminLoading";
import { canLookupFoodTab, foodTabUncheckedMessage, unpaidFoodCheckoutMessage } from "@/lib/foodTab";

function getDaysRemaining(expectedCheckout: string): number {
  if (!expectedCheckout) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const checkout = new Date(expectedCheckout);
  if (isNaN(checkout.getTime())) return 0;
  checkout.setHours(0, 0, 0, 0);
  return Math.ceil((checkout.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function statusColor(status: string, isOverdue: boolean) {
  if (status === "available") return { border: "border-green-400", bg: "bg-green-50 dark:bg-green-950", fill: "#22c55e" };
  if (status === "occupied" && isOverdue) return { border: "border-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950", fill: "#eab308" };
  if (status === "occupied") return { border: "border-red-400", bg: "bg-red-50 dark:bg-red-950", fill: "#ef4444" };
  return { border: "border-orange-400", bg: "bg-orange-50 dark:bg-orange-950", fill: "#f97316" };
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
  onAssign?: () => void;
  onCheckout?: () => void;
  onMarkClean?: () => void;
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
      bed.status === "available" && !isLoading && onAssign && "hover:shadow-md dark:hover:shadow-none hover:-translate-y-0.5 cursor-pointer",
    )} onClick={bed.status === "available" && !isLoading && onAssign ? onAssign : undefined}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70 dark:bg-card/70">
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
        <div className="mt-2 flex items-center gap-1.5 transition-colors">
          <UserPlusIcon className="h-3.5 w-3.5 text-green-600" />
          <span className="text-[11px] font-medium text-green-700 dark:text-green-400">Available</span>
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
            {onCheckout && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onCheckout(); }}
                className="flex-1 rounded-lg bg-red-500/10 px-1 py-1.5 text-[9px] font-semibold text-red-600 transition-colors hover:bg-red-500/20">
                Checkout
              </button>
            )}
            {onUnassign && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onUnassign(); }}
                className="flex-1 rounded-lg bg-gray-100 dark:bg-muted px-1 py-1.5 text-[9px] font-semibold text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent">
                Unassign
              </button>
            )}
            {onChangeBed && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onChangeBed(); }}
                className="flex-1 rounded-lg bg-blue-500/10 px-1 py-1.5 text-[9px] font-semibold text-blue-600 transition-colors hover:bg-blue-500/20">
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
            <span className="text-[11px] font-medium text-orange-700 dark:text-orange-400">Needs cleaning</span>
          </div>
          {onMarkClean && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onMarkClean(); }}
              className="mt-2 w-full rounded-lg bg-orange-500/10 px-2 py-1.5 text-[10px] font-semibold text-orange-600 transition-colors hover:bg-orange-500/20">
              Mark clean
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminBeds({ password, username, role, permissions = {}, pendingAssignCheckinId, onPendingAssignConsumed }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean>; pendingAssignCheckinId?: number | null; onPendingAssignConsumed?: () => void }) {
  const { apiCall } = useAdminApi(password, username);
  const { showError } = useAdminToast();
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [unassigned, setUnassigned] = useState<string[][]>([]);
  const [linkedBookingDetails, setLinkedBookingDetails] = useState<Record<string, { id: number; persons: number; roomType: string; reference: string }>>({});
  const [loading, setLoading] = useState(true);
  const [loadingBedIdx, setLoadingBedIdx] = useState<number | null>(null);
  const [selectedDorm, setSelectedDorm] = useState<string | null>(null);
  const [assigningGuest, setAssigningGuest] = useState<string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [checkoutConfirm, setCheckoutConfirm] = useState<{
    guest: string[];
    pendingTab: number;
    pendingOrders: number;
    tabUnchecked?: "lookup-failed";
  } | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => { loadBeds(); }, []);

  useEffect(() => {
    if (!pendingAssignCheckinId || loading || unassigned.length === 0) return;
    const guest = unassigned.find((g) => Number(g[15]) === pendingAssignCheckinId);
    if (guest) {
      setChangingBed(null);
      setAssigningGuest(guest);
    }
    onPendingAssignConsumed?.();
  }, [pendingAssignCheckinId, loading, unassigned, onPendingAssignConsumed]);

  const loadBeds = async () => {
    setLoading(true);
    setChangingBed(null);
    try {
      const res = await apiCall({ action: "getBeds" });
      if (res.ok) {
        const data = await res.json();
        setBeds((data.beds || []).map(parseBedRow));
        setUnassigned(data.unassigned || []);
        setLinkedBookingDetails(data.linkedBookingDetails || {});
      }
    } finally { setLoading(false); }
  };

  const checkoutGuestDirect = async (guest: string[]) => {
    setCheckingOut(true);
    try {
      const checkinId = parseInt(guest[15] || "0", 10);
      const res = await apiCall({ action: "checkoutGuest", checkinId, guestName: guest[3] || "" });
      if (res.ok) {
        setCheckoutConfirm(null);
        await loadBeds();
      } else {
        const d = await res.json().catch(() => ({}));
        showError(d.error || "Could not check out this bed");
      }
    } finally { setCheckingOut(false); }
  };

  const openGuestCheckout = async (guest: string[]) => {
    const checkinId = parseInt(guest[15] || "0", 10);
    let pendingTab = 0;
    let pendingOrders = 0;
    let tabUnchecked: "lookup-failed" | undefined;
    try {
      const res = await apiCall({ action: "getPendingFoodTab", checkinId, contact: guest[5] || "" });
      if (res.ok) {
        const d = await res.json();
        pendingTab = Number(d.pendingTab) || 0;
        pendingOrders = Number(d.pendingOrders) || 0;
      } else {
        tabUnchecked = "lookup-failed";
      }
    } catch {
      tabUnchecked = "lookup-failed";
    }
    setCheckoutConfirm({ guest, pendingTab, pendingOrders, tabUnchecked });
  };

  const assignBed = async (bedIdx: number, guest: string[]) => {
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({
        action: "assignBed",
        bedId: bedIdx,
        guestName: guest[3],
        guestContact: guest[5],
        checkinDate: guest[1],
        stayingDays: guest[6],
        checkinId: guest[15],
      });
      if (res.ok) { setAssigningGuest(null); await loadBeds(); }
      else { const d = await res.json().catch(() => ({})); showError(d.error || "Could not assign this bed"); }
    } finally { setLoadingBedIdx(null); }
  };

  const checkoutBed = async (bedIdx: number) => {
    const bed = beds.find((b) => b.id === bedIdx);
    const contact = bed?.guestContact || "";
    let msg = "Checkout this guest?";
    if (!canLookupFoodTab({ contact })) {
      msg = foodTabUncheckedMessage("no-phone");
    } else {
      try {
        const res = await apiCall({ action: "getPendingFoodTab", contact });
        if (!res.ok) {
          msg = foodTabUncheckedMessage("lookup-failed");
        } else {
          const d = await res.json();
          if (d.pendingTab > 0) {
            msg = unpaidFoodCheckoutMessage(bed?.guestName || "This guest", d.pendingTab, d.pendingOrders);
          }
        }
      } catch {
        msg = foodTabUncheckedMessage("lookup-failed");
      }
    }
    if (!confirm(msg)) return;
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({ action: "checkoutBed", bedId: bedIdx });
      if (res.ok) await loadBeds();
      else { const d = await res.json().catch(() => ({})); showError(d.error || "Could not check out this bed"); }
    } finally { setLoadingBedIdx(null); }
  };

  const markClean = async (bedIdx: number) => {
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({ action: "markClean", bedId: bedIdx });
      if (res.ok) await loadBeds();
      else { const d = await res.json().catch(() => ({})); showError(d.error || "Could not mark this bed clean"); }
    } finally { setLoadingBedIdx(null); }
  };

  const unassignBed = async (bedIdx: number) => {
    if (!confirm("Unassign this bed? (No cleanup needed - for wrong assignment correction)")) return;
    setLoadingBedIdx(bedIdx);
    try {
      const res = await apiCall({ action: "unassignBed", bedId: bedIdx });
      if (res.ok) await loadBeds();
      else { const d = await res.json().catch(() => ({})); showError(d.error || "Could not unassign this bed"); }
    } finally { setLoadingBedIdx(null); }
  };

  const [changingBed, setChangingBed] = useState<number | null>(null);

  const changeBed = async (fromIdx: number, toIdx: number) => {
    setLoadingBedIdx(fromIdx);
    try {
      const res = await apiCall({ action: "changeBed", fromBedId: fromIdx, toBedId: toIdx });
      if (res.ok) { setChangingBed(null); await loadBeds(); }
      else { const d = await res.json(); showError(d.error || "Could not change this bed"); }
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
    const doubleCount = dormBeds.filter((b) => b.type === "Double").length;
    let layoutType: "1u1l" | "1u2l" | "double" | "single" | "mixed" = "mixed";
    if (singleCount === dormBeds.length) layoutType = "single";
    else if (doubleCount === dormBeds.length) layoutType = "double";
    else if (uppers > 0 && lowers > 0 && lowers / uppers >= 1.8) layoutType = "1u2l";
    else if (uppers > 0 && lowers > 0) layoutType = "1u1l";
    return {
      name,
      total: dormBeds.length,
      available: dormBeds.filter((b) => b.status === "available").length,
      occupied: dormBeds.filter((b) => b.status === "occupied").length,
      cleanup: dormBeds.filter((b) => b.status === "cleanup").length,
      layoutType,
      units: layoutType === "double" ? doubleCount / 2 : uppers,
    };
  });

  type BedItem = { bed: BedRow; idx: number };
  type BunkGroup = { upper?: BedItem; lowers: BedItem[] };
  const bunkGroups: BunkGroup[] = [];
  const singles: BedItem[] = [];

  if (selectedDorm) {
    let dormBedsWithIdx = beds.map((b) => ({ bed: b, idx: b.id })).filter(({ bed }) => bed.dormName === selectedDorm);
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
      const num = parseInt(numMatch?.[0] || "0");
      const bunkNum = Math.ceil(num / 2);
      const groupKey = `${item.bed.dormName}-bunk-${bunkNum}`;

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
        <div className="mt-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-4">
          <h3 className="font-medium text-blue-800 dark:text-blue-300">{unassigned.length} guest{unassigned.length !== 1 ? "s" : ""} without bed assignment</h3>
          <motion.div className="mt-2 space-y-2" variants={staggerContainer} initial="hidden" animate="visible">
            {unassigned.map((guest, i) => (
              <motion.div key={i} variants={staggerItem} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg bg-white dark:bg-card px-3 py-2 transition-all duration-200 hover:shadow-soft dark:hover:shadow-none">
                <div>
                  <span className="font-medium text-brand-green-dark">{guest[3]}</span>
                  <span className="ml-2 text-xs text-brand-green-dark/50">{guest[6]} days · {guest[7]}</span>
                  {linkedBookingDetails[guest[15]] && <span className="ml-2 text-xs text-blue-700 dark:text-blue-400">Online booking · {linkedBookingDetails[guest[15]].roomType || "room type not specified"} · {linkedBookingDetails[guest[15]].persons} person{linkedBookingDetails[guest[15]].persons === 1 ? "" : "s"}</span>}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void openGuestCheckout(guest)}
                    className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/50">
                    Checkout
                  </button>
                  <button type="button" onClick={() => {
                    setChangingBed(null);
                    setAssigningGuest(guest);
                  }}
                    className="rounded-md bg-brand-green px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-green-dark">
                    Assign bed
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Checkout confirmation popup */}
      <AnimatePresence>
      {checkoutConfirm && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" variants={overlayVariants} initial="hidden" animate="visible" exit="exit">
          <motion.div className="w-full min-w-0 max-w-sm rounded-2xl bg-white dark:bg-card p-6 shadow-xl dark:shadow-none" variants={modalVariants} initial="hidden" animate="visible" exit="exit">
            <h3 className="font-display text-lg font-bold text-brand-green-dark">Confirm Checkout</h3>
            {checkoutConfirm.pendingTab > 0 ? (
              <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
                {unpaidFoodCheckoutMessage(checkoutConfirm.guest[3] || "This guest", checkoutConfirm.pendingTab, checkoutConfirm.pendingOrders)}
              </p>
            ) : checkoutConfirm.tabUnchecked ? (
              <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-400">
                {foodTabUncheckedMessage("lookup-failed")}
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-brand-green-dark/80">
                  Are you sure you want to mark <strong>{checkoutConfirm.guest[3]}</strong> as checked out?
                </p>
                <p className="mt-1 text-xs text-brand-green-dark/50">
                  This guest will be removed from the unassigned list. No bed assignment needed.
                </p>
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCheckoutConfirm(null)} disabled={checkingOut}
                className="rounded-lg border border-brand-mist px-4 py-2 text-sm font-medium text-brand-green-dark transition-colors hover:bg-brand-sand/50">
                No
              </button>
              <button type="button" onClick={() => checkoutGuestDirect(checkoutConfirm.guest)} disabled={checkingOut}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50">
                {checkingOut ? "Processing..." : (checkoutConfirm.pendingTab > 0 || checkoutConfirm.tabUnchecked) ? "Checkout anyway" : "Yes, Checkout"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Assigning mode banner */}
      {assigningGuest && (
        <div className="mt-4 rounded-xl border-2 border-brand-green bg-brand-green/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 truncate font-medium text-brand-green">Assigning bed to: <strong>{assigningGuest[3]}</strong> ({assigningGuest[6]} days)
              {linkedBookingDetails[assigningGuest[15]] && <span className="ml-2 text-xs font-normal text-blue-700 dark:text-blue-400">Online booking: {linkedBookingDetails[assigningGuest[15]].roomType || "room type not specified"} · booking bed is informational only</span>}
            </div>
            <button type="button" onClick={() => setAssigningGuest(null)} className="text-sm text-brand-green-dark/60 hover:text-brand-red">Cancel</button>
          </div>
          <p className="mt-1 text-xs text-brand-green-dark/60">Click on any available (green) bed below to assign</p>
        </div>
      )}

      {/* Changing bed banner */}
      {changingBed !== null && (
        <div className="mt-4 rounded-xl border-2 border-blue-400 bg-blue-50/50 dark:bg-blue-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium text-blue-700 dark:text-blue-400">Changing bed for: <strong>{beds[changingBed]?.guestName}</strong></p>
            <button type="button" onClick={() => setChangingBed(null)} className="text-sm text-brand-green-dark/60 hover:text-brand-red">Cancel</button>
          </div>
          <p className="mt-1 text-xs text-blue-600/70">Click on any available (green) bed to move the guest there. Old bed will go to cleanup.</p>
        </div>
      )}

      {/* Dorm overview cards */}
      {!selectedDorm && (
        <motion.div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" variants={staggerContainer} initial="hidden" animate="visible">
          {dormStats.length === 0 ? (
            <p className="col-span-full text-center text-brand-green-dark/50 py-10">No dorms configured. Go to Setup to add dorms and beds.</p>
          ) : dormStats.map((dorm) => (
            <motion.button key={dorm.name} type="button" variants={staggerItem} onClick={() => setSelectedDorm(dorm.name)}
              className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 text-left shadow-card dark:shadow-none transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
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
                      <text x="24" y="53" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#2d5c3f" opacity="0.35">{dorm.units}x</text>
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
                      <text x="24" y="53" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#2d5c3f" opacity="0.35">{dorm.units}x</text>
                    </svg>
                  </div>
                ) : (
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-green/[0.06]">
                    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden>
                      <rect x="3" y="12" width="42" height="16" rx="3" fill="#2d5c3f" opacity="0.18" stroke="#2d5c3f" strokeWidth="1.2" />
                      <text x="24" y="23" textAnchor="middle" fontSize="9" fontWeight="600" fill="#2d5c3f" opacity="0.5">{dorm.layoutType === "double" ? "Double" : "Single"}</text>
                      <line x1="5" y1="30" x2="5" y2="36" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                      <line x1="43" y1="30" x2="43" y2="36" stroke="#2d5c3f" strokeWidth="2" opacity="0.25" />
                    </svg>
                  </div>
                )}
                <div>
                  <h3 className="font-display text-lg font-bold text-brand-green-dark">{dorm.name}</h3>
                  <p className="text-[10px] text-brand-green-dark/40">
                    {dorm.layoutType === "1u2l" ? "2 Lower + 1 Upper bunk" : dorm.layoutType === "1u1l" ? "1 Lower + 1 Upper bunk" : dorm.layoutType === "double" ? "Double beds (2 lower)" : "Single beds"}
                    {dorm.units > 0 && ` · ${dorm.units} units`}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-muted">
                {dorm.occupied > 0 && <div className="bg-red-400" style={{ width: `${(dorm.occupied / dorm.total) * 100}%` }} />}
                {dorm.cleanup > 0 && <div className="bg-orange-400" style={{ width: `${(dorm.cleanup / dorm.total) * 100}%` }} />}
                {dorm.available > 0 && <div className="bg-green-400" style={{ width: `${(dorm.available / dorm.total) * 100}%` }} />}
              </div>
              <div className="mt-2 flex gap-3 text-xs">
                <span className="text-green-700 dark:text-green-400">{dorm.available} free</span>
                <span className="text-red-700 dark:text-red-400">{dorm.occupied} occupied</span>
                {dorm.cleanup > 0 && <span className="text-orange-700 dark:text-orange-400">{dorm.cleanup} cleanup</span>}
              </div>
              <p className="mt-1 text-xs text-brand-green-dark/50">{dorm.total} beds total</p>
            </motion.button>
          ))}
        </motion.div>
      )}

      {/* Bed map for selected dorm */}
      {selectedDorm && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => { setSelectedDorm(null); setSearchQuery(""); }} className="text-sm text-brand-green hover:underline">All dorms</button>
              <span className="text-brand-green-dark/30">/</span>
              <h3 className="font-display text-lg font-bold text-brand-green-dark">{selectedDorm}</h3>
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="Search beds..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-40 text-xs" />
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-green-400 bg-green-50 dark:bg-green-950" /> Available</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-red-400 bg-red-50 dark:bg-red-950" /> Occupied</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-orange-400 bg-orange-50 dark:bg-orange-950" /> Cleanup</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950" /> Overdue</span>
          </div>

          {/* Bunk bed groups */}
          <motion.div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" variants={staggerContainer} initial="hidden" animate="visible">
            {bunkGroups.map((group, gi) => {
              const isDouble = group.lowers[0]?.bed.type === "Double";
              const upperNum = parseInt(group.upper?.bed.bedId.match(/\d+/)?.[0] || "0");
              const groupLabel = upperNum > 0 ? String(Math.ceil(upperNum / 2)) : `${gi + 1}`;
              return (
                <motion.div key={gi} variants={staggerItem} className="relative overflow-hidden rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none transition-all duration-200 hover:shadow-soft dark:hover:shadow-none">
                  <div className="border-b border-brand-mist bg-brand-sand/30 px-3 py-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-green-dark/40">{isDouble ? "Double" : "Bunk"} {groupLabel}</span>
                  </div>
                  {/* Upper bed */}
                  {group.upper && (
                    <div className="p-1.5">
                      <BedCard bed={group.upper.bed}
                        isLoading={loadingBedIdx === group.upper.idx}
                        onAssign={hasPermission(role, permissions, "canAssignBed") ? () => { if (changingBed !== null) changeBed(changingBed, group.upper!.idx); else if (assigningGuest) assignBed(group.upper!.idx, assigningGuest); } : undefined}
                        onCheckout={hasPermission(role, permissions, "canCheckout") ? () => checkoutBed(group.upper!.idx) : undefined}
                        onUnassign={hasPermission(role, permissions, "canAssignBed") ? () => unassignBed(group.upper!.idx) : undefined}
                        onChangeBed={hasPermission(role, permissions, "canAssignBed") ? () => { setAssigningGuest(null); setChangingBed(group.upper!.idx); } : undefined}
                        onMarkClean={hasPermission(role, permissions, "canMarkClean") ? () => markClean(group.upper!.idx) : undefined} />
                    </div>
                  )}
                  {/* Ladder divider */}
                  {group.upper && <div className="flex items-center gap-2 px-3">
                    <div className="h-px flex-1 bg-brand-mist" />
                    <svg viewBox="0 0 16 20" className="h-4 w-3 text-brand-green-dark/20" aria-hidden>
                      <line x1="3" y1="0" x2="3" y2="20" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="13" y1="0" x2="13" y2="20" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1" />
                      <line x1="3" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1" />
                      <line x1="3" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    <div className="h-px flex-1 bg-brand-mist" />
                  </div>}
                  {/* Lower bed(s) */}
                  {group.lowers.map((lower, li) => (
                    <div key={li} className="p-1.5 pt-0">
                      <BedCard bed={lower.bed}
                        isLoading={loadingBedIdx === lower.idx}
                        onAssign={hasPermission(role, permissions, "canAssignBed") ? () => { if (changingBed !== null) changeBed(changingBed, lower.idx); else if (assigningGuest) assignBed(lower.idx, assigningGuest); } : undefined}
                        onCheckout={hasPermission(role, permissions, "canCheckout") ? () => checkoutBed(lower.idx) : undefined}
                        onUnassign={hasPermission(role, permissions, "canAssignBed") ? () => unassignBed(lower.idx) : undefined}
                        onChangeBed={hasPermission(role, permissions, "canAssignBed") ? () => { setAssigningGuest(null); setChangingBed(lower.idx); } : undefined}
                        onMarkClean={hasPermission(role, permissions, "canMarkClean") ? () => markClean(lower.idx) : undefined} />
                    </div>
                  ))}
                </motion.div>
              );
            })}
            {singles.map(({ bed, idx }) => (
              <motion.div key={idx} variants={staggerItem} className="overflow-hidden rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none transition-all duration-200 hover:shadow-soft dark:hover:shadow-none">
                <div className="border-b border-brand-mist bg-brand-sand/30 px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-green-dark/40">Single</span>
                </div>
                <div className="p-1.5">
                  <BedCard bed={bed}
                    isLoading={loadingBedIdx === idx}
                    onAssign={hasPermission(role, permissions, "canAssignBed") ? () => { if (changingBed !== null) changeBed(changingBed, idx); else if (assigningGuest) assignBed(idx, assigningGuest); } : undefined}
                    onCheckout={hasPermission(role, permissions, "canCheckout") ? () => checkoutBed(idx) : undefined}
                    onUnassign={hasPermission(role, permissions, "canAssignBed") ? () => unassignBed(idx) : undefined}
                    onChangeBed={hasPermission(role, permissions, "canAssignBed") ? () => { setAssigningGuest(null); setChangingBed(idx); } : undefined}
                    onMarkClean={hasPermission(role, permissions, "canMarkClean") ? () => markClean(idx) : undefined} />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}
