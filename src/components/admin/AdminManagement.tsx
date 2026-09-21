"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { BedDoubleIcon, UsersIcon, DatabaseIcon, ShieldCheckIcon, FileTextIcon, HeartPulseIcon, HistoryIcon, IndianRupeeIcon, UtensilsIcon, SettingsIcon, UploadIcon, QrCodeIcon, ChevronDownIcon, WalletIcon, ServerIcon, WifiIcon, GlobeIcon, UserRoundCheckIcon, BarChart3Icon, LinkIcon, ListTodoIcon, ReceiptIcon } from "lucide-react";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import { hasPermission, type Role, type ManagementTab } from "./types";
import {
  managementSectionTabActiveClass,
  managementSectionTabClass,
  managementSectionTabsClass,
  managementSectionTabInactiveClass,
} from "./managementSectionTabs";

const tabLoader = () => <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-green-dark border-t-transparent" /></div>;

const AdminSetup = dynamic(() => import("./AdminSetup").then((m) => m.AdminSetup), { loading: tabLoader, ssr: false });
const ManagementUsers = dynamic(() => import("./ManagementUsers").then((m) => m.ManagementUsers), { loading: tabLoader, ssr: false });
const ManagementBackup = dynamic(() => import("./ManagementBackup").then((m) => m.ManagementBackup), { loading: tabLoader, ssr: false });
const ManagementAudit = dynamic(() => import("./ManagementAudit").then((m) => m.ManagementAudit), { loading: tabLoader, ssr: false });
const ManagementLogs = dynamic(() => import("./ManagementLogs").then((m) => m.ManagementLogs), { loading: tabLoader, ssr: false });
const ManagementHealth = dynamic(() => import("./ManagementHealth").then((m) => m.ManagementHealth), { loading: tabLoader, ssr: false });
const AdminBedHistory = dynamic(() => import("./AdminBedHistory").then((m) => m.AdminBedHistory), { loading: tabLoader, ssr: false });
const AdminCheckRates = dynamic(() => import("./AdminCheckRates").then((m) => m.AdminCheckRates), { loading: tabLoader, ssr: false });
const AdminMenuManagement = dynamic(() => import("./AdminMenuManagement").then((m) => m.AdminMenuManagement), { loading: tabLoader, ssr: false });
const AdminFoodSettings = dynamic(() => import("./AdminFoodSettings").then((m) => m.AdminFoodSettings), { loading: tabLoader, ssr: false });
const AdminBillSettings = dynamic(() => import("./AdminBillSettings").then((m) => m.AdminBillSettings), { loading: tabLoader, ssr: false });
const AdminBulkImport = dynamic(() => import("./AdminBulkImport").then((m) => m.AdminBulkImport), { loading: tabLoader, ssr: false });
const QRGenerator = dynamic(() => import("./qr-generator").then((m) => m.QRGenerator), { loading: tabLoader, ssr: false });
const AccountSettings = dynamic(() => import("./AccountSettings").then((m) => m.AccountSettings), { loading: tabLoader, ssr: false });
const ManagementAttendance = dynamic(() => import("./ManagementAttendance").then((m) => m.ManagementAttendance), { loading: tabLoader, ssr: false });
const ManagementTasks = dynamic(() => import("./ManagementTasks").then((m) => m.ManagementTasks), { loading: tabLoader, ssr: false });
const ServerSync = dynamic(() => import("./ServerSync").then((m) => m.ServerSync), { loading: tabLoader, ssr: false });
const ChannelManager = dynamic(() => import("./ChannelManager").then((m) => m.ChannelManager), { loading: tabLoader, ssr: false });
const BookingSettings = dynamic(() => import("./BookingSettings").then((m) => m.BookingSettings), { loading: tabLoader, ssr: false });
const AdminWebsite = dynamic(() => import("./AdminWebsite").then((m) => m.AdminWebsite), { loading: tabLoader, ssr: false });
const AdminAnalytics = dynamic(() => import("./AdminAnalytics").then((m) => m.AdminAnalytics), { loading: tabLoader, ssr: false });
const QuickLinks = dynamic(() => import("./QuickLinks").then((m) => m.QuickLinks), { loading: tabLoader, ssr: false });

const TABS: { id: ManagementTab; label: string; icon: React.ReactNode; adminOnly?: boolean; permission?: string | string[] }[] = [
  { id: "dorms", label: "Dorms", icon: <BedDoubleIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "users", label: "Users", icon: <UsersIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "backup", label: "Backup", icon: <DatabaseIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "audit", label: "Audit", icon: <ShieldCheckIcon className="h-3.5 w-3.5" />, permission: "canViewAudit" },
  { id: "logs", label: "Logs", icon: <FileTextIcon className="h-3.5 w-3.5" />, permission: "canViewLogs" },
  { id: "health", label: "Health & Stats", icon: <HeartPulseIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "history", label: "History", icon: <HistoryIcon className="h-3.5 w-3.5" /> },
  { id: "rates", label: "Rates", icon: <IndianRupeeIcon className="h-3.5 w-3.5" /> },
  { id: "menu", label: "Menu", icon: <UtensilsIcon className="h-3.5 w-3.5" />, permission: "canViewMenu" },
  { id: "website", label: "Website", icon: <GlobeIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "foodSettings", label: "Food Settings", icon: <SettingsIcon className="h-3.5 w-3.5" />, permission: "canManageFoodSettings" },
  { id: "billSettings", label: "Bill Settings", icon: <ReceiptIcon className="h-3.5 w-3.5" />, permission: "canManageFoodSettings" },
  { id: "bulkUpload", label: "Bulk Upload", icon: <UploadIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "qrGenerator", label: "QR Codes", icon: <QrCodeIcon className="h-3.5 w-3.5" />, permission: "canUseQRGenerator" },
  { id: "accountSettings", label: "Account Settings", icon: <WalletIcon className="h-3.5 w-3.5" />, permission: "canManageAccountSettings" },
  { id: "attendance", label: "Attendance", icon: <UserRoundCheckIcon className="h-3.5 w-3.5" />, permission: "canManageAttendance" },
  { id: "tasks", label: "To Do", icon: <ListTodoIcon className="h-3.5 w-3.5" />, permission: ["canViewTasks", "canManageTasks"] },
  { id: "serverSync", label: "Server Sync", icon: <ServerIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "channelManager", label: "Channel Manager", icon: <WifiIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "bookingSettings", label: "Booking Settings", icon: <SettingsIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "analytics", label: "Analytics", icon: <BarChart3Icon className="h-3.5 w-3.5" />, permission: "canViewAnalytics" },
  { id: "quickLinks", label: "Links & QRs", icon: <LinkIcon className="h-3.5 w-3.5" />, permission: "canViewQuickLinks" },
];

const FOOD_SETTINGS_TAB_IDS = new Set<ManagementTab>(["menu", "foodSettings", "billSettings"]);
type ManagementNavTab = { id: string; label: string; icon: React.ReactNode; tab: ManagementTab; active: boolean };

export function AdminManagement({ password, username, role, permissions = {}, initialTab, initialChannelTab, onTabUsed }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean>; initialTab?: ManagementTab; initialChannelTab?: "sync"; onTabUsed?: () => void }) {
  const visibleTabs = useMemo(() => TABS.filter((t) => {
    if ((t.id === "website" || t.id === "bookingSettings") && process.env.NEXT_PUBLIC_GOKO_RUNTIME === "pi") return false;
    if (t.adminOnly && role !== "admin") return false;
    if (t.id === "analytics" && role === "manager") return true;
    if (t.permission && (Array.isArray(t.permission) ? !t.permission.some((permission) => hasPermission(role, permissions, permission)) : !hasPermission(role, permissions, t.permission))) return false;
    return true;
  }), [role, permissions]);
  const defaultTab = visibleTabs[0]?.id || "history";
  const [tab, setTab] = useTabWithHistory<ManagementTab>("tab", defaultTab, {
    validValues: visibleTabs.map((t) => t.id),
  });
  const visibleFoodTabs = visibleTabs.filter((t) => FOOD_SETTINGS_TAB_IDS.has(t.id));
  const foodSettingsAnchor = visibleFoodTabs.find((t) => t.id === "foodSettings") ?? visibleFoodTabs[0];
  const isFoodSettingsTab = FOOD_SETTINGS_TAB_IDS.has(tab);
  const navTabs = visibleTabs.reduce<ManagementNavTab[]>((items, t) => {
    if (FOOD_SETTINGS_TAB_IDS.has(t.id)) {
      if (foodSettingsAnchor?.id === t.id) {
        items.push({
          id: "foodSettingsGroup",
          label: "Food Settings",
          icon: <SettingsIcon className="h-3.5 w-3.5" />,
          tab: isFoodSettingsTab ? tab : t.id,
          active: isFoodSettingsTab,
        });
      }
      return items;
    }
    items.push({ id: t.id, label: t.label, icon: t.icon, tab: t.id, active: tab === t.id });
    return items;
  }, []);
  const activeNavTab = navTabs.find((t) => t.active);

  useEffect(() => {
    if (initialTab && visibleTabs.some((t) => t.id === initialTab)) {
      setTab(initialTab);
      onTabUsed?.();
    }
  }, [initialTab, onTabUsed, setTab, visibleTabs]);
  const [subMenuOpen, setSubMenuOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Management</h2>
      </div>

      {/* Desktop tabs */}
      <div className="mt-4 hidden flex-wrap gap-1.5 rounded-xl border border-brand-mist bg-white dark:bg-card p-1.5 lg:flex">
        {navTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.tab)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              t.active
                ? "text-brand-green"
                : "text-brand-green-dark/60 hover:bg-brand-sand/50"
            )}
          >
            {t.active && (
              <motion.span
                layoutId="management-tab-pill"
                className="absolute inset-0 rounded-lg bg-brand-green/10"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {t.icon}
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Mobile/Tablet dropdown */}
      <div className="relative z-10 mt-4 lg:hidden">
        <button
          type="button"
          onClick={() => setSubMenuOpen(!subMenuOpen)}
          className="flex w-full items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card px-4 py-3"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-brand-green">
            {activeNavTab?.icon}
            {activeNavTab?.label}
          </span>
          <ChevronDownIcon className={cn("h-4 w-4 text-brand-green-dark/40 transition-transform", subMenuOpen && "rotate-180")} />
        </button>
        {subMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setSubMenuOpen(false)} />
            <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-brand-mist bg-white dark:bg-card p-2 shadow-lg dark:shadow-none">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {navTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTab(t.tab); setSubMenuOpen(false); }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors",
                      t.active
                        ? "bg-brand-green/10 text-brand-green"
                        : "text-brand-green-dark/60 hover:bg-brand-sand/50"
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tab content */}
      {isFoodSettingsTab && (
        <div className={cn(managementSectionTabsClass, "mt-4")} role="tablist" aria-label="Food settings tabs">
          {visibleFoodTabs.map((t) => {
            const label = t.id === "foodSettings" ? "General" : t.label;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  managementSectionTabClass,
                  tab === t.id ? managementSectionTabActiveClass : managementSectionTabInactiveClass
                )}
              >
                <span className="flex items-center gap-1.5">{t.icon}{label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-6">
        {tab === "dorms" && <AdminSetup password={password} />}
        {tab === "users" && <ManagementUsers password={password} role={role} />}
        {tab === "backup" && <ManagementBackup password={password} role={role} />}
        {tab === "audit" && <ManagementAudit password={password} role={role} />}
        {tab === "logs" && <ManagementLogs password={password} username={username} role={role} />}
        {tab === "health" && <ManagementHealth password={password} role={role} />}
        {tab === "history" && <AdminBedHistory password={password} username={username} role={role} />}
        {tab === "rates" && <AdminCheckRates password={password} username={username} role={role} />}
        {tab === "menu" && <AdminMenuManagement password={password} username={username} role={role} permissions={permissions} />}
        {tab === "website" && visibleTabs.some((t) => t.id === "website") && <AdminWebsite password={password} username={username} role={role} />}
        {tab === "foodSettings" && <AdminFoodSettings password={password} username={username} role={role} />}
        {tab === "billSettings" && <AdminBillSettings password={password} username={username} />}
        {tab === "bulkUpload" && <AdminBulkImport password={password} username={username} role={role} />}
        {tab === "qrGenerator" && <QRGenerator password={password} username={username} role={role} />}
        {tab === "accountSettings" && <AccountSettings password={password} username={username} role={role} />}
        {tab === "attendance" && <ManagementAttendance password={password} username={username} role={role} canManageAttendance={hasPermission(role, permissions, "canManageAttendance")} />}
        {tab === "tasks" && <ManagementTasks password={password} username={username} role={role} permissions={permissions} />}
        {tab === "serverSync" && <ServerSync password={password} username={username} role={role} />}
        {tab === "channelManager" && <ChannelManager password={password} username={username} role={role} initialTab={initialChannelTab} />}
        {tab === "bookingSettings" && visibleTabs.some((t) => t.id === "bookingSettings") && <BookingSettings password={password} username={username} />}
        {tab === "analytics" && <AdminAnalytics password={password} username={username} role={role} permissions={permissions} />}
        {tab === "quickLinks" && <QuickLinks password={password} username={username} role={role} />}
      </div>
    </div>
  );
}
