"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { BedDoubleIcon, UsersIcon, DatabaseIcon, ShieldCheckIcon, FileTextIcon, HeartPulseIcon, HistoryIcon, IndianRupeeIcon, UtensilsIcon, SettingsIcon, UploadIcon, QrCodeIcon, ChevronDownIcon, WalletIcon, ServerIcon, WifiIcon, GlobeIcon, UserRoundCheckIcon, BarChart3Icon } from "lucide-react";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import type { Role, ManagementTab } from "./types";

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
const AdminBulkImport = dynamic(() => import("./AdminBulkImport").then((m) => m.AdminBulkImport), { loading: tabLoader, ssr: false });
const QRGenerator = dynamic(() => import("./qr-generator").then((m) => m.QRGenerator), { loading: tabLoader, ssr: false });
const AccountSettings = dynamic(() => import("./AccountSettings").then((m) => m.AccountSettings), { loading: tabLoader, ssr: false });
const ManagementAttendance = dynamic(() => import("./ManagementAttendance").then((m) => m.ManagementAttendance), { loading: tabLoader, ssr: false });
const ServerSync = dynamic(() => import("./ServerSync").then((m) => m.ServerSync), { loading: tabLoader, ssr: false });
const ChannelManager = dynamic(() => import("./ChannelManager").then((m) => m.ChannelManager), { loading: tabLoader, ssr: false });
const AdminWebsite = dynamic(() => import("./AdminWebsite").then((m) => m.AdminWebsite), { loading: tabLoader, ssr: false });
const AdminAnalytics = dynamic(() => import("./AdminAnalytics").then((m) => m.AdminAnalytics), { loading: tabLoader, ssr: false });

const TABS: { id: ManagementTab; label: string; icon: React.ReactNode; adminOnly?: boolean; permission?: string }[] = [
  { id: "dorms", label: "Dorms", icon: <BedDoubleIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "users", label: "Users", icon: <UsersIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "backup", label: "Backup", icon: <DatabaseIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "audit", label: "Audit", icon: <ShieldCheckIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "logs", label: "Logs", icon: <FileTextIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "health", label: "Health & Stats", icon: <HeartPulseIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "history", label: "History", icon: <HistoryIcon className="h-3.5 w-3.5" /> },
  { id: "rates", label: "Rates", icon: <IndianRupeeIcon className="h-3.5 w-3.5" /> },
  { id: "menu", label: "Menu", icon: <UtensilsIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "website", label: "Website", icon: <GlobeIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "foodSettings", label: "Food Settings", icon: <SettingsIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "bulkUpload", label: "Bulk Upload", icon: <UploadIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "qrGenerator", label: "QR Codes", icon: <QrCodeIcon className="h-3.5 w-3.5" />, permission: "canUseQRGenerator" },
  { id: "accountSettings", label: "Account Settings", icon: <WalletIcon className="h-3.5 w-3.5" />, permission: "canManageAccounts" },
  { id: "attendance", label: "Attendance", icon: <UserRoundCheckIcon className="h-3.5 w-3.5" />, permission: "canManageAttendance" },
  { id: "serverSync", label: "Server Sync", icon: <ServerIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "channelManager", label: "Channel Manager", icon: <WifiIcon className="h-3.5 w-3.5" />, adminOnly: true },
  { id: "analytics", label: "Analytics", icon: <BarChart3Icon className="h-3.5 w-3.5" /> },
];

export function AdminManagement({ password, username, role, permissions = {}, initialTab, initialChannelTab, onTabUsed }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean>; initialTab?: ManagementTab; initialChannelTab?: "sync"; onTabUsed?: () => void }) {
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "website" && process.env.NEXT_PUBLIC_GOKO_RUNTIME === "pi") return false;
    if (t.adminOnly && role !== "admin") return false;
    if (t.permission && role !== "admin" && !permissions[t.permission]) return false;
    return true;
  });
  const defaultTab = visibleTabs[0]?.id || "history";
  const [tab, setTab] = useTabWithHistory<ManagementTab>("tab", defaultTab, {
    validValues: visibleTabs.map((t) => t.id),
  });

  useEffect(() => {
    if (initialTab && visibleTabs.some((t) => t.id === initialTab)) {
      setTab(initialTab);
      onTabUsed?.();
    }
  }, [initialTab]);
  const [subMenuOpen, setSubMenuOpen] = useState(false);

  const activeTab = visibleTabs.find((t) => t.id === tab);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Management</h2>
      </div>

      {/* Desktop tabs */}
      <div className="mt-4 hidden flex-wrap gap-1.5 rounded-xl border border-brand-mist bg-white dark:bg-card p-1.5 lg:flex">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              tab === t.id
                ? "text-brand-green"
                : "text-brand-green-dark/60 hover:bg-brand-sand/50"
            )}
          >
            {tab === t.id && (
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
      <div className="relative z-30 mt-4 lg:hidden">
        <button
          type="button"
          onClick={() => setSubMenuOpen(!subMenuOpen)}
          className="flex w-full items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card px-4 py-3"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-brand-green">
            {activeTab?.icon}
            {activeTab?.label}
          </span>
          <ChevronDownIcon className={cn("h-4 w-4 text-brand-green-dark/40 transition-transform", subMenuOpen && "rotate-180")} />
        </button>
        {subMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setSubMenuOpen(false)} />
            <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-brand-mist bg-white dark:bg-card p-2 shadow-lg dark:shadow-none">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {visibleTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTab(t.id); setSubMenuOpen(false); }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors",
                      tab === t.id
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
      <div className="mt-6">
        {tab === "dorms" && <AdminSetup password={password} />}
        {tab === "users" && <ManagementUsers password={password} role={role} />}
        {tab === "backup" && <ManagementBackup password={password} role={role} />}
        {tab === "audit" && <ManagementAudit password={password} role={role} />}
        {tab === "logs" && <ManagementLogs password={password} username={username} role={role} />}
        {tab === "health" && <ManagementHealth password={password} role={role} />}
        {tab === "history" && <AdminBedHistory password={password} username={username} role={role} />}
        {tab === "rates" && <AdminCheckRates password={password} username={username} role={role} />}
        {tab === "menu" && <AdminMenuManagement password={password} username={username} role={role} />}
        {tab === "website" && visibleTabs.some((t) => t.id === "website") && <AdminWebsite password={password} username={username} role={role} />}
        {tab === "foodSettings" && <AdminFoodSettings password={password} username={username} role={role} />}
        {tab === "bulkUpload" && <AdminBulkImport password={password} username={username} role={role} />}
        {tab === "qrGenerator" && <QRGenerator password={password} username={username} role={role} />}
        {tab === "accountSettings" && <AccountSettings password={password} username={username} role={role} />}
        {tab === "attendance" && <ManagementAttendance password={password} username={username} role={role} />}
        {tab === "serverSync" && <ServerSync password={password} username={username} role={role} />}
        {tab === "channelManager" && <ChannelManager password={password} username={username} role={role} initialTab={initialChannelTab} />}
        {tab === "analytics" && <AdminAnalytics password={password} username={username} role={role} permissions={permissions} />}
      </div>
    </div>
  );
}
