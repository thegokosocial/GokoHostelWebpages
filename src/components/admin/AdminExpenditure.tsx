"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { PlusCircleIcon, FileTextIcon, IndianRupeeIcon, BedDoubleIcon, BookOpenIcon, ScaleIcon, HandCoinsIcon } from "lucide-react";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import type { Role } from "./types";

const tabLoader = () => <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-green-dark border-t-transparent" /></div>;
const AdminAddExpense = dynamic(() => import("./AdminAddExpense").then((m) => m.AdminAddExpense), { loading: tabLoader, ssr: false });
const AdminAddIncome = dynamic(() => import("./AdminAddIncome").then((m) => m.AdminAddIncome), { loading: tabLoader, ssr: false });
const AdminIncomeRecords = dynamic(() => import("./AdminIncomeRecords").then((m) => m.AdminIncomeRecords), { loading: tabLoader, ssr: false });
const AdminBillRecords = dynamic(() => import("./AdminBillRecords").then((m) => m.AdminBillRecords), { loading: tabLoader, ssr: false });
const AdminFoodBill = dynamic(() => import("./AdminFoodBill").then((m) => m.AdminFoodBill), { loading: tabLoader, ssr: false });
const AdminRoomRevenue = dynamic(() => import("./AdminRoomRevenue").then((m) => m.AdminRoomRevenue), { loading: tabLoader, ssr: false });
const DailyLedger = dynamic(() => import("./DailyLedger").then((m) => m.DailyLedger), { loading: tabLoader, ssr: false });
const DailyReconcile = dynamic(() => import("./DailyReconcile").then((m) => m.DailyReconcile), { loading: tabLoader, ssr: false });

type AccountsTab = "addExpense" | "addIncome" | "dailyLedger" | "billRecords" | "incomeRecords" | "foodBill" | "roomBill" | "reconcile";

const TABS: { id: AccountsTab; label: string; icon: React.ReactNode; permission?: string }[] = [
  { id: "addExpense", label: "Add Expense", icon: <PlusCircleIcon className="h-3.5 w-3.5" />, permission: "canAddExpense" },
  { id: "addIncome", label: "Add Income", icon: <HandCoinsIcon className="h-3.5 w-3.5" />, permission: "canAddIncome" },
  { id: "dailyLedger", label: "Daily Ledger", icon: <BookOpenIcon className="h-3.5 w-3.5" />, permission: "canViewAccounts" },
  { id: "billRecords", label: "Expense Records", icon: <FileTextIcon className="h-3.5 w-3.5" />, permission: "canViewExpenses" },
  { id: "incomeRecords", label: "Income Records", icon: <HandCoinsIcon className="h-3.5 w-3.5" />, permission: "canViewAccounts" },
  { id: "foodBill", label: "Food Revenue", icon: <IndianRupeeIcon className="h-3.5 w-3.5" />, permission: "canViewFoodBills" },
  { id: "roomBill", label: "Room Revenue", icon: <BedDoubleIcon className="h-3.5 w-3.5" />, permission: "canViewFoodBills" },
  { id: "reconcile", label: "Reconcile", icon: <ScaleIcon className="h-3.5 w-3.5" />, permission: "canReconcile" },
];

export function AdminExpenditure({
  password,
  username,
  role,
  permissions,
}: {
  password: string;
  username?: string;
  role: Role;
  permissions: Record<string, boolean>;
}) {
  const visibleTabs = TABS.filter((t) => !t.permission || role === "admin" || !!permissions[t.permission!]);
  const defaultTab = visibleTabs[0]?.id || "addExpense";
  const [tab, setTab] = useTabWithHistory<AccountsTab>("tab", defaultTab);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Accounts</h2>
      </div>

      {/* Tab buttons */}
      <div className="mt-4 flex flex-wrap gap-1.5 rounded-xl border border-brand-mist bg-white dark:bg-card p-1.5">
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
                layoutId="expenditure-tab-pill"
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

      <div className="mt-6">
        {tab === "addExpense" && <AdminAddExpense password={password} username={username} role={role} permissions={permissions} />}
        {tab === "addIncome" && <AdminAddIncome password={password} username={username} />}
        {tab === "dailyLedger" && <DailyLedger password={password} username={username} role={role} permissions={permissions} />}
        {tab === "billRecords" && <AdminBillRecords password={password} username={username} role={role} permissions={permissions} />}
        {tab === "incomeRecords" && <AdminIncomeRecords password={password} username={username} role={role} permissions={permissions} />}
        {tab === "foodBill" && <AdminFoodBill password={password} username={username} role={role} permissions={permissions} />}
        {tab === "roomBill" && <AdminRoomRevenue password={password} username={username} role={role} permissions={permissions} />}
        {tab === "reconcile" && <DailyReconcile password={password} username={username} role={role} permissions={permissions} />}
      </div>
    </div>
  );
}
