"use client";

import { MAPPING_HEALTH_LABELS, type MappingHealth } from "@/lib/aiosellMappingHealth";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { cn, localDateStr } from "@/lib/utils";
import { staggerContainer, staggerItem, overlayVariants, modalVariants } from "@/lib/animations";
import { BedDoubleIcon, UsersIcon, CalendarCheckIcon, AlertTriangleIcon, LogOutIcon, Loader2Icon, ExternalLinkIcon, BanknoteIcon, SmartphoneIcon, XIcon, CheckCircleIcon, UtensilsIcon, BookOpenIcon, CalendarPlusIcon, BanIcon, UserRoundCheckIcon, QrCodeIcon } from "lucide-react";
import { getAgeFromDob, dobsMatch } from "@/lib/parseDob";
import { RecordPaymentModal } from "@/components/admin/RecordPaymentModal";
import { useAdminToast } from "@/components/admin/AdminToast";
import { hasPermission, type Role, type AdminSection, type ManagementTab } from "./types";
import { canLookupFoodTab, foodTabUncheckedMessage } from "@/lib/foodTab";

export function AdminDashboard({
  password,
  username,
  role,
  onNavigate,
  permissions,
}: {
  password: string;
  username?: string;
  role: Role;
  onNavigate: (section: AdminSection, opts?: { assignGuestCheckinId?: number; bookingId?: number; managementTab?: ManagementTab; channelManagerTab?: "sync" }) => void;
  permissions?: Record<string, boolean>;
}) {
  const { apiCall } = useAdminApi(password, username);
  const router = useRouter();
  const { showError } = useAdminToast();
  const [todayCheckins, setTodayCheckins] = useState<{ row: string[]; assignedBed: string | null; linkedBookingId: number | null; dob: string; dobFromId: string; vibeMatched: number }[]>([]);
  const [todayCompletedCheckinCount, setTodayCompletedCheckinCount] = useState(0);
  const [todayExpectedCheckinCount, setTodayExpectedCheckinCount] = useState(0);
  const [todayCheckouts, setTodayCheckouts] = useState<{
    name: string; contact: string; bedId: string; dorm: string; bedIdx: number; expectedCheckout: string;
    pendingTab: number; paidTotal: number; totalOrders: number; pendingOrders: number; checkinId: number | null;
    roomStatus: "pending" | "clear" | "not_linked"; roomDue: number | null;
  }[]>([]);
  const [todayBookings, setTodayBookings] = useState<{
    id: number; guestName: string; platform: string; bookingRef: string; checkinDate: string; checkoutDate: string;
    persons: number; status: string; createdAt: string;
  }[]>([]);
  const [todayBookingCount, setTodayBookingCount] = useState(0);
  const [todayCancellationCount, setTodayCancellationCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, occupied: 0, available: 0, cleanup: 0 });
  const [mappingHealth, setMappingHealth] = useState<MappingHealth | null>(null);
  const [validationOn, setValidationOn] = useState(true);
  const [togglingValidation, setTogglingValidation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [ageRange, setAgeRange] = useState({ min: 18, max: 40 });
  const [unpaidStays, setUnpaidStays] = useState<{
    id: number; guestName: string; contact: string; checkinDate: string; checkoutDate: string; due: number; amountTotal: number;
  }[]>([]);
  const [stayPay, setStayPay] = useState<{ id: number; name: string; due: number } | null>(null);
  const [stayPayBusy, setStayPayBusy] = useState(false);
  const [vibeMatchingId, setVibeMatchingId] = useState<number | null>(null);
  const [reconciliationWarning, setReconciliationWarning] = useState<{
    date: string;
    missingAccountNames: string[];
  } | null>(null);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getDashboard" });
      if (res.ok) {
        const data = await res.json();
        setTodayCheckins(data.todayCheckins || []);
        setTodayCompletedCheckinCount(Number(data.todayCompletedCheckinCount) || 0);
        setTodayExpectedCheckinCount(Number(data.todayExpectedCheckinCount) || 0);
        setTodayCheckouts(data.todayCheckouts || []);
        setTodayBookings(data.todayBookings || []);
        setTodayBookingCount(Number(data.todayBookingCount) || 0);
        setTodayCancellationCount(Number(data.todayCancellationCount) || 0);
        setUnpaidStays(data.unpaidStays || []);
        setReconciliationWarning(data.reconciliationWarning || null);
        setMappingHealth(data.mappingHealth || null);
        setStats(data.stats || { total: 0, occupied: 0, available: 0, cleanup: 0 });
        setValidationOn(data.validationEnabled !== false);
        if (data.guestMinAge || data.guestMaxAge) {
          setAgeRange({ min: data.guestMinAge || 18, max: data.guestMaxAge || 40 });
        }
      }
    } finally { setLoading(false); }
  };

  const toggleValidation = async () => {
    setTogglingValidation(true);
    try {
      const newValue = validationOn ? "off" : "on";
      const res = await apiCall({ action: "setSetting", key: "image_validation", value: newValue });
      if (res.ok) setValidationOn(!validationOn);
    } finally { setTogglingValidation(false); }
  };

  const [checkoutModal, setCheckoutModal] = useState<{
    bedIdx: number; name: string; pendingTab: number; pendingOrders: number; checkinId: number | null; contact: string; orderIds: number[];
  } | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const bookingsApiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }, [password, username]);

  const canCollectStay = hasPermission(role, permissions || {}, "canCheckIn") || hasPermission(role, permissions || {}, "canAddBooking");
  const canViewBookings = hasPermission(role, permissions || {}, "canViewBookings");
  const canManageAttendance = role === "admin" || (role === "manager" && !!permissions?.canManageAttendance);
  const canViewQuickLinks = hasPermission(role, permissions || {}, "canViewQuickLinks");
  const canViewReconciliation = role === "admin" || (!!(permissions?.canReconcileAccounts || permissions?.canReconcile) && !!permissions?.canViewAccounts);

  const foodApiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/food-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }, [password, username]);

  const doCheckout = async (bedIdx: number) => {
    setBusyIdx(bedIdx);
    setCheckoutBusy(true);
    try {
      const res = await apiCall({ action: "checkoutBed", bedId: bedIdx });
      if (res.ok) { setCheckoutModal(null); await loadDashboard(); }
    } finally { setBusyIdx(null); setCheckoutBusy(false); }
  };

  const handleCheckoutClick = async (co: typeof todayCheckouts[0]) => {
    setBusyIdx(co.bedIdx);
    try {
      if (!canLookupFoodTab({ contact: co.contact, checkinId: co.checkinId })) {
        if (!confirm(foodTabUncheckedMessage("no-phone"))) return;
        await doCheckout(co.bedIdx);
        return;
      }
      const res = await apiCall({
        action: "getPendingFoodTab",
        checkinId: co.checkinId || undefined,
        contact: co.contact || "",
      });
      if (!res.ok) {
        if (!confirm(foodTabUncheckedMessage("lookup-failed"))) return;
        await doCheckout(co.bedIdx);
        return;
      }
      const tab = await res.json();
      const pendingTab = Number(tab.pendingTab) || 0;
      if (pendingTab > 0) {
        setCheckoutModal({
          bedIdx: co.bedIdx,
          name: co.name,
          pendingTab,
          pendingOrders: Number(tab.pendingOrders) || 0,
          checkinId: tab.checkinId || co.checkinId,
          contact: co.contact,
          orderIds: Array.isArray(tab.orderIds) ? tab.orderIds : [],
        });
        return;
      }
      await doCheckout(co.bedIdx);
    } finally {
      setBusyIdx(null);
    }
  };

  const handleCheckoutWithPayment = async (method: string) => {
    if (!checkoutModal) return;
    setCheckoutBusy(true);
    try {
      let orderIds = [...checkoutModal.orderIds];
      if (orderIds.length === 0 && checkoutModal.checkinId) {
        const tabRes = await foodApiCall({ action: "getGuestTab", checkinId: checkoutModal.checkinId });
        if (tabRes.ok) {
          const tabData = await tabRes.json();
          orderIds = (tabData.orders || []).map((o: { id: number }) => o.id);
        }
      }
      if (orderIds.length > 0) {
        const payRes = await foodApiCall({ action: "markOrderPaid", orderIds, paymentMethod: method });
        if (!payRes.ok) {
          const data = await payRes.json().catch(() => ({ error: "Could not record food payment" }));
          showError(data.error || "Could not record food payment");
          setCheckoutBusy(false);
          return;
        }
      }
      await doCheckout(checkoutModal.bedIdx);
    } catch {
      setCheckoutBusy(false);
    }
  };

  const handleVibeMatch = async (checkinId: number) => {
    setVibeMatchingId(checkinId);
    try {
      const res = await apiCall({ action: "markVibeMatched", checkinId });
      if (res.ok) {
        setTodayCheckins((prev) =>
          prev.map((item) =>
            item.row[15] === String(checkinId) ? { ...item, vibeMatched: 1 } : item
          )
        );
      }
    } finally { setVibeMatchingId(null); }
  };

  const today = localDateStr(new Date());

  if (loading) {
    return <AdminLoading message="Loading dashboard..." />;
  }

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Dashboard</h2>
      <p className="mt-1 text-sm text-brand-green-dark/60 dark:text-zinc-500">{today}</p>

      {mappingHealth && !["match", "disabled"].includes(mappingHealth.status) && (role === "admin" || role === "manager") && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
          {role === "admin" ? <button type="button" className="w-full text-left" onClick={() => onNavigate("management", { managementTab: "channelManager", channelManagerTab: "sync" })}>
            <span className="font-semibold">{MAPPING_HEALTH_LABELS[mappingHealth.status]}{mappingHealth.report?.issues.length ? ` · ${mappingHealth.report.issues.length} issue(s)` : ""}</span>
            <span className="mt-1 block text-sm">Review differences and resolution steps in Channel Manager → Sync & Logs.</span>
          </button> : <><p className="font-semibold">{MAPPING_HEALTH_LABELS[mappingHealth.status]}</p><p className="mt-1 text-sm">Ask an administrator to review Channel Manager → Sync & Logs.</p></>}
          <p className="mt-1 text-xs">Pushes continue using saved mappings.</p>
        </div>
      )}
      {reconciliationWarning && (role === "admin" || role === "manager") && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-100">Previous day reconciliation is pending</p>
              <p className="mt-0.5 text-sm text-amber-800/80 dark:text-amber-200/80">
                {reconciliationWarning.date} · {reconciliationWarning.missingAccountNames.length} account{reconciliationWarning.missingAccountNames.length === 1 ? "" : "s"} remaining
              </p>
            </div>
          </div>
          {canViewReconciliation && (
            <button
              type="button"
              onClick={() => router.push(`/admin?section=expenditure&tab=reconcile&date=${reconciliationWarning.date}`)}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
            >
              Open Reconciliation
            </button>
          )}
        </div>
      )}

      {/* Quick access */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button type="button" onClick={() => onNavigate("foodOrders")} className="flex w-full items-center justify-between rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-card dark:shadow-none transition-all hover:shadow-soft dark:hover:bg-zinc-800/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/10"><UtensilsIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" /></div>
            <div className="text-left">
              <p className="font-semibold text-brand-green-dark dark:text-zinc-100">Food Orders</p>
              <p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">Manage orders & payments</p>
            </div>
          </div>
          <span className="text-brand-green-dark/30 dark:text-zinc-600">→</span>
        </button>
        {canViewBookings && (
          <button type="button" onClick={() => onNavigate("bookings")} className="flex w-full items-center justify-between rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-card dark:shadow-none transition-all hover:shadow-soft dark:hover:bg-zinc-800/70">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10"><BookOpenIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" /></div>
              <div className="text-left">
                <p className="font-semibold text-brand-green-dark dark:text-zinc-100">Bookings</p>
                <p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">View booking calendar</p>
              </div>
            </div>
            <span className="text-brand-green-dark/30 dark:text-zinc-600">→</span>
          </button>
        )}
        {canManageAttendance && (
          <button type="button" onClick={() => onNavigate("management", { managementTab: "attendance" })} className="flex w-full items-center justify-between rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-card dark:shadow-none transition-all hover:shadow-soft dark:hover:bg-zinc-800/70">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10"><UserRoundCheckIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /></div>
              <div className="text-left"><p className="font-semibold text-brand-green-dark dark:text-zinc-100">Staff Attendance</p><p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">Mark leave &amp; view payroll</p></div>
            </div>
            <span className="text-brand-green-dark/30 dark:text-zinc-600">→</span>
          </button>
        )}
        {canViewQuickLinks && (
          <button type="button" onClick={() => window.open("/quick-links", "_blank", "noopener,noreferrer")} className="flex w-full items-center justify-between rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-card dark:shadow-none transition-all hover:shadow-soft dark:hover:bg-zinc-800/70">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10"><QrCodeIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /></div>
              <div className="text-left"><p className="font-semibold text-brand-green-dark dark:text-zinc-100">Guest Links & QRs</p><p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">Open the guest QR page</p></div>
            </div>
            <span className="text-brand-green-dark/30 dark:text-zinc-600">↗</span>
          </button>
        )}
      </div>

      {/* Stats cards */}
      <motion.div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6" variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div variants={staggerItem} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10"><UsersIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" /></div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-brand-green-dark dark:text-zinc-100 leading-tight">{todayCompletedCheckinCount} <span className="text-sm font-semibold text-brand-green-dark/55 dark:text-zinc-400">/ {todayExpectedCheckinCount}</span></p>
              <p className="text-[10px] text-brand-green-dark/60 dark:text-zinc-500 leading-tight">Completed / expected check-ins</p>
            </div>
          </div>
        </motion.div>
        <motion.div variants={staggerItem} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/10"><CalendarPlusIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-brand-green-dark dark:text-zinc-100 leading-tight">{todayBookingCount}</p>
              <p className="text-[10px] text-brand-green-dark/60 dark:text-zinc-500 leading-tight">Bookings today</p>
            </div>
          </div>
        </motion.div>
        <motion.div variants={staggerItem} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-500/10"><BanIcon className="h-4 w-4 text-rose-600 dark:text-rose-400" /></div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-brand-green-dark dark:text-zinc-100 leading-tight">{todayCancellationCount}</p>
              <p className="text-[10px] text-brand-green-dark/60 dark:text-zinc-500 leading-tight">Cancellations today</p>
            </div>
          </div>
        </motion.div>
        <motion.div variants={staggerItem} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-500/10"><CalendarCheckIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" /></div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-brand-green-dark dark:text-zinc-100 leading-tight">{todayCheckouts.length}</p>
              <p className="text-[10px] text-brand-green-dark/60 dark:text-zinc-500 leading-tight">Checkouts due</p>
            </div>
          </div>
        </motion.div>
        <motion.div variants={staggerItem} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-500/10"><BedDoubleIcon className="h-4 w-4 text-green-600 dark:text-green-400" /></div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-brand-green-dark dark:text-zinc-100 leading-tight">{stats.available}</p>
              <p className="text-[10px] text-brand-green-dark/60 dark:text-zinc-500 leading-tight">Beds available</p>
            </div>
          </div>
        </motion.div>
        <motion.div variants={staggerItem} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 transition-all duration-200 hover:shadow-lift dark:hover:shadow-none hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10"><BedDoubleIcon className="h-4 w-4 text-red-600 dark:text-red-400" /></div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-brand-green-dark dark:text-zinc-100 leading-tight">{stats.occupied}/{stats.total}</p>
              <p className="text-[10px] text-brand-green-dark/60 dark:text-zinc-500 leading-tight">Beds occupied</p>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Occupancy bar */}
      {stats.total > 0 && (
        <div className="mt-4 rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between text-xs text-brand-green-dark/70 dark:text-zinc-400">
            <span>Occupancy: {Math.round((stats.occupied / stats.total) * 100)}%</span>
            <span>{stats.occupied} occupied, {stats.available} available, {stats.cleanup} cleanup</span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
            {stats.occupied > 0 && <div className="bg-red-400" style={{ width: `${(stats.occupied / stats.total) * 100}%` }} />}
            {stats.cleanup > 0 && <div className="bg-orange-400" style={{ width: `${(stats.cleanup / stats.total) * 100}%` }} />}
            {stats.available > 0 && <div className="bg-green-400" style={{ width: `${(stats.available / stats.total) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Unpaid stay */}
      {unpaidStays.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3 sm:p-4">
          <div className="flex items-center gap-2 px-1">
            <BanknoteIcon className="h-5 w-5 text-red-600 dark:text-red-400" />
            <span className="font-medium text-red-800 dark:text-red-200">{unpaidStays.length} unpaid stay{unpaidStays.length !== 1 ? "s" : ""}</span>
          </div>
          <motion.div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" variants={staggerContainer} initial="hidden" animate="visible">
            {unpaidStays.map((s) => (
              <motion.div key={s.id} variants={staggerItem} className="rounded-xl border border-gray-100 dark:border-zinc-700/50 bg-white dark:bg-zinc-900 p-3 shadow-sm dark:shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-brand-green-dark dark:text-zinc-100">{s.guestName}</p>
                    <p className="mt-0.5 text-xs text-brand-green-dark/50 dark:text-zinc-500">{s.checkinDate} → {s.checkoutDate}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-950 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-400">
                      ₹{s.due.toLocaleString("en-IN")}
                    </span>
                    {canCollectStay && (
                      <button
                        type="button"
                        onClick={() => setStayPay({ id: s.id, name: s.guestName, due: s.due })}
                        className="rounded-lg border border-green-500 bg-green-50 dark:bg-green-950 px-3 py-1.5 text-xs font-semibold text-green-700 dark:text-green-400"
                      >
                        Mark Paid
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Checkouts due */}
      {todayCheckouts.length > 0 && (
        <div className="mt-4 rounded-xl border border-orange-200 dark:border-amber-900/50 bg-orange-50 dark:bg-amber-950/30 p-3 sm:p-4">
          <div className="flex items-center gap-2 px-1">
            <AlertTriangleIcon className="h-5 w-5 text-orange-600 dark:text-amber-400" />
            <span className="font-medium text-orange-800 dark:text-amber-200">{todayCheckouts.length} guest{todayCheckouts.length !== 1 ? "s" : ""} due for checkout</span>
          </div>
          <motion.div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" variants={staggerContainer} initial="hidden" animate="visible">
            {todayCheckouts.map((co, i) => (
              <motion.div key={i} variants={staggerItem} className="rounded-xl border border-gray-100 dark:border-zinc-700/50 bg-white dark:bg-zinc-900 p-3 shadow-sm dark:shadow-none transition-all duration-200 hover:bg-brand-sand/50 dark:hover:bg-zinc-800/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-brand-green-dark dark:text-zinc-100">{co.name}</p>
                    <p className="mt-0.5 text-xs text-brand-green-dark/50 dark:text-zinc-500">{co.dorm} / {co.bedId}</p>
                  </div>
                  <button type="button" onClick={() => handleCheckoutClick(co)} disabled={busyIdx === co.bedIdx}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50 active:bg-red-200 disabled:opacity-50">
                    {busyIdx === co.bedIdx ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <LogOutIcon className="h-3.5 w-3.5" />}
                    Checkout
                  </button>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 dark:border-zinc-800 pt-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {co.roomStatus === "not_linked" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-zinc-800 px-2 py-1 text-xs font-semibold text-gray-600 dark:text-zinc-400">Room: Not linked</span>
                      ) : co.roomStatus === "pending" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-950 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-400"><BanknoteIcon className="h-3 w-3" />Room: ₹{(co.roomDue || 0).toLocaleString("en-IN")} pending</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-green-50 dark:bg-green-950 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-400"><CheckCircleIcon className="h-3 w-3" />Room: All clear</span>
                      )}
                      {co.pendingTab > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-950 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-400"><BanknoteIcon className="h-3 w-3" />Food: ₹{(co.pendingTab / 100).toFixed(0)} pending <span className="font-normal text-red-500">({co.pendingOrders})</span></span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-green-50 dark:bg-green-950 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-400"><CheckCircleIcon className="h-3 w-3" />Food: All clear</span>
                      )}
                      {co.roomStatus === "clear" && co.pendingTab <= 0 && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircleIcon className="h-3 w-3" />All clear</span>}
                    </div>
                    {co.contact && (
                      <a
                        href={`/my-bills?phone=${encodeURIComponent(co.contact)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-md bg-blue-50 dark:bg-blue-950 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/50 active:bg-blue-200"
                      >
                        Bills <ExternalLinkIcon className="h-3 w-3" />
                      </a>
                    )}
                  </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Today's check-ins */}
      <div className="mt-6">
        <h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">Today&apos;s Check-ins</h3>
        {todayCheckins.length === 0 ? (
          <p className="mt-2 text-sm text-brand-green-dark/50 dark:text-zinc-500">No check-ins today yet</p>
        ) : (
          <motion.div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" variants={staggerContainer} initial="hidden" animate="visible">
            {todayCheckins.map((item, i) => {
              const age = getAgeFromDob(item.dob);
              const isFlagged = age !== null && !item.vibeMatched && (age < ageRange.min || age > ageRange.max);
              const isUnderage = age !== null && age < ageRange.min;
              const hasDobMismatch = !!(item.dob && item.dobFromId && !item.vibeMatched && !dobsMatch(item.dob, item.dobFromId));
              const isAnyFlagged = isFlagged || hasDobMismatch;
              const checkinId = parseInt(item.row[15]);
              return (
              <motion.div key={i} variants={staggerItem} className={cn("rounded-xl border bg-white dark:bg-zinc-900 p-3 shadow-sm dark:shadow-none transition-all duration-200 hover:bg-brand-sand/50 dark:hover:bg-zinc-800/50", isAnyFlagged ? "border-orange-300 dark:border-amber-800/50 bg-orange-50/40 dark:bg-amber-950/20" : "border-gray-100 dark:border-zinc-800")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-brand-green-dark dark:text-zinc-100">{item.row[3]}</p>
                    <p className="mt-0.5 text-xs text-brand-green-dark/60 dark:text-zinc-500">{item.row[7]}, {item.row[8]} · {item.row[4]} person{item.row[4] !== "1" ? "s" : ""} · {item.row[6]} days</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.assignedBed ? (
                      <span className="rounded-lg bg-brand-green/10 px-2.5 py-1 text-xs font-semibold text-brand-green">
                        {item.assignedBed}
                      </span>
                    ) : (
                      <button type="button" onClick={() => onNavigate("beds", { assignGuestCheckinId: checkinId })}
                        className="rounded-lg bg-blue-50 dark:bg-blue-950 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/50 active:bg-blue-200">
                        Assign bed
                      </button>
                    )}
                    <span className="text-[11px] text-brand-green-dark/40 dark:text-zinc-600">{item.row[2]}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {item.row[14] === "yes" ? (
                    <span className="rounded-md bg-green-50 dark:bg-green-950 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">ID verified</span>
                  ) : item.row[14] === "no" ? (
                    <span className="rounded-md bg-red-50 dark:bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">ID rejected</span>
                  ) : item.row[14] === "spoof_warning" ? (
                    <span className="rounded-md bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">Possibly fake ID</span>
                  ) : !item.row[14] || item.row[14] === "pending" ? (
                    <span className="rounded-md bg-yellow-50 dark:bg-yellow-950 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-700 dark:text-yellow-400">ID pending</span>
                  ) : null}
                  {isFlagged && (
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", isUnderage ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400" : "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400")}>
                      {isUnderage ? `Underage (${age})` : `Overage (${age})`}
                    </span>
                  )}
                  {hasDobMismatch && (
                    <span className="rounded-md bg-red-50 dark:bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">DOB mismatch</span>
                  )}
                  {item.vibeMatched === 1 && (
                    (age !== null && (age < ageRange.min || age > ageRange.max)) ||
                    (item.dob && item.dobFromId && !dobsMatch(item.dob, item.dobFromId))
                  ) && (
                    <span className="rounded-md bg-green-50 dark:bg-green-950 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">Vibe OK</span>
                  )}
                  {isAnyFlagged && (
                    <button
                      type="button"
                      onClick={() => handleVibeMatch(checkinId)}
                      disabled={vibeMatchingId === checkinId}
                      className="ml-auto flex items-center gap-1 rounded-lg bg-green-50 dark:bg-green-950 px-2.5 py-1 text-[11px] font-medium text-green-700 dark:text-green-400 transition-colors hover:bg-green-100 dark:hover:bg-green-900/50 active:bg-green-200 disabled:opacity-50"
                    >
                      <CheckCircleIcon className="h-3 w-3" />
                      {vibeMatchingId === checkinId ? "..." : "Vibe OK"}
                    </button>
                  )}
                </div>
              </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Today's bookings */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">Today&apos;s Bookings</h3>
          {canViewBookings && todayBookings.length > 0 && (
            <button type="button" onClick={() => onNavigate("bookings")} className="text-xs font-medium text-brand-green hover:underline">View calendar</button>
          )}
        </div>
        {todayBookings.length === 0 ? (
          <p className="mt-2 text-sm text-brand-green-dark/50 dark:text-zinc-500">No bookings received today yet</p>
        ) : (
          <motion.div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" variants={staggerContainer} initial="hidden" animate="visible">
            {todayBookings.map((booking) => (
              <motion.button
                key={booking.id}
                type="button"
                variants={staggerItem}
                disabled={!canViewBookings}
                onClick={() => onNavigate("bookings", { bookingId: booking.id })}
                className="flex w-full items-start justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm transition-colors hover:bg-brand-sand/50 disabled:cursor-default dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none dark:hover:bg-zinc-800/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[15px] font-semibold text-brand-green-dark dark:text-zinc-100">{booking.guestName}</p>
                    <span className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                      booking.status === "cancelled" || booking.status === "no_show"
                        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
                        : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
                    )}>{booking.status.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-brand-green-dark/60 dark:text-zinc-500">
                    {booking.checkinDate} → {booking.checkoutDate} · {booking.persons} person{booking.persons !== 1 ? "s" : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-brand-green-dark/40 dark:text-zinc-600">
                    {booking.platform.replaceAll("_", " ")}{booking.bookingRef ? ` · #${booking.bookingRef}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-brand-green-dark/40 dark:text-zinc-600">
                  {new Date(booking.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => onNavigate("beds")} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left transition-all hover:shadow-soft dark:hover:shadow-none dark:hover:bg-zinc-800/70">
          <BedDoubleIcon className="h-5 w-5 text-brand-green" />
          <p className="mt-2 font-medium text-brand-green-dark dark:text-zinc-100">Assign Beds</p>
          <p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">Manage dorm assignments</p>
        </button>
        <button type="button" onClick={() => onNavigate("records")} className="rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left transition-all hover:shadow-soft dark:hover:shadow-none dark:hover:bg-zinc-800/70">
          <UsersIcon className="h-5 w-5 text-brand-green" />
          <p className="mt-2 font-medium text-brand-green-dark dark:text-zinc-100">View Records</p>
          <p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">All check-in entries</p>
        </button>
      </div>

      {/* Validation toggle (admin only) */}
      {role === "admin" && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-brand-mist dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <span className="text-sm font-medium text-brand-green-dark dark:text-zinc-200">ID Validation (Vision API)</span>
          <button type="button" onClick={toggleValidation} disabled={togglingValidation}
            className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", validationOn ? "bg-brand-green" : "bg-brand-green-dark/20")}>
            <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", validationOn ? "translate-x-5" : "translate-x-0.5")} />
          </button>
          <span className={cn("text-xs font-semibold", validationOn ? "text-brand-green" : "text-brand-green-dark/40")}>
            {togglingValidation ? "..." : validationOn ? "ON" : "OFF"}
          </span>
        </div>
      )}

      {/* Checkout confirmation modal */}
      <AnimatePresence>
      {checkoutModal && (
        <motion.div className="fixed inset-0 z-[60] flex items-center justify-center p-4" variants={overlayVariants} initial="hidden" animate="visible" exit="exit">
          <div className="absolute inset-0 bg-black/40" onClick={() => !checkoutBusy && setCheckoutModal(null)} />
          <motion.div className="relative w-full min-w-0 max-w-sm rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl dark:shadow-none dark:border dark:border-zinc-800" variants={modalVariants} initial="hidden" animate="visible" exit="exit">
            <div className="flex items-center justify-between border-b border-brand-mist dark:border-zinc-800 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-brand-green-dark dark:text-zinc-100">Checkout {checkoutModal.name}</h3>
                <p className="text-xs text-brand-green-dark/50 dark:text-zinc-500">Unpaid food tab</p>
              </div>
              <button type="button" onClick={() => !checkoutBusy && setCheckoutModal(null)} className="rounded-lg p-1.5 hover:bg-brand-sand dark:hover:bg-zinc-800">
                <XIcon className="h-5 w-5 text-brand-green-dark/60 dark:text-zinc-400" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 text-center">
                <p className="text-sm text-red-800 dark:text-red-300">This guest has an unpaid food tab of</p>
                <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">₹{(checkoutModal.pendingTab / 100).toFixed(0)}</p>
                <p className="mt-1 text-xs text-red-600">{checkoutModal.pendingOrders} unpaid order{checkoutModal.pendingOrders !== 1 ? "s" : ""}</p>
              </div>

              <p className="mt-4 text-sm font-medium text-brand-green-dark dark:text-zinc-200">Record payment & checkout:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleCheckoutWithPayment("cash")}
                  disabled={checkoutBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-green-500 dark:border-green-700 bg-green-50 dark:bg-green-950 px-4 py-2.5 text-sm font-medium text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 disabled:opacity-50"
                >
                  <BanknoteIcon className="h-4 w-4" /> Pay Cash & Checkout
                </button>
                <button
                  type="button"
                  onClick={() => handleCheckoutWithPayment("online")}
                  disabled={checkoutBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-500 dark:border-blue-700 bg-blue-50 dark:bg-blue-950 px-4 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                >
                  <SmartphoneIcon className="h-4 w-4" /> Pay Online & Checkout
                </button>
              </div>

              <div className="mt-4 border-t border-brand-mist dark:border-zinc-800 pt-3">
                <button
                  type="button"
                  onClick={() => doCheckout(checkoutModal.bedIdx)}
                  disabled={checkoutBusy}
                  className="w-full rounded-lg border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                >
                  {checkoutBusy ? "Processing..." : "Checkout without payment"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {stayPay && (
        <RecordPaymentModal
          totalAmount={stayPay.due}
          guestName={stayPay.name}
          amountUnit="rupees"
          zClass="z-[70]"
          password={password} username={username} receiptKind="room"
          onConfirm={async (method, cashReceived, changeGiven, onlineAccountId, receiptId) => {
            setStayPayBusy(true);
            try {
              const res = await bookingsApiCall({
                action: "collectStayPayment",
                bookingId: stayPay.id,
                paymentMethod: method,
                cashReceived,
                changeGiven,
                onlineAccountId,
                receiptId,
              });
              if (res.ok) {
                setStayPay(null);
                await loadDashboard();
              } else {
                const data = await res.json().catch(() => ({ error: "Could not record payment" }));
                showError(data.error || "Could not record payment");
              }
            } catch {
              showError("Network error");
            } finally {
              setStayPayBusy(false);
            }
          }}
          onClose={() => !stayPayBusy && setStayPay(null)}
        />
      )}
    </div>
  );
}
