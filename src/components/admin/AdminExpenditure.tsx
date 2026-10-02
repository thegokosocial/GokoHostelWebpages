"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { PlusCircleIcon, FileTextIcon, IndianRupeeIcon, BedDoubleIcon, BookOpenIcon, ScaleIcon, HandCoinsIcon, Repeat2Icon, ChevronDownIcon, WalletCardsIcon } from "lucide-react";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import { hasPermission, type Role } from "./types";

const tabLoader = () => <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-green-dark border-t-transparent" /></div>;
const AdminAddExpense = dynamic(() => import("./AdminAddExpense").then((m) => m.AdminAddExpense), { loading: tabLoader, ssr: false });
const AdminAddIncome = dynamic(() => import("./AdminAddIncome").then((m) => m.AdminAddIncome), { loading: tabLoader, ssr: false });
const AdminRecurringExpenses = dynamic(() => import("./AdminRecurringExpenses").then((m) => m.AdminRecurringExpenses), { loading: tabLoader, ssr: false });
const AdminPayableBills = dynamic(() => import("./AdminPayableBills").then((m) => m.AdminPayableBills), { loading: tabLoader, ssr: false });
const AdminIncomeRecords = dynamic(() => import("./AdminIncomeRecords").then((m) => m.AdminIncomeRecords), { loading: tabLoader, ssr: false });
const AdminBillRecords = dynamic(() => import("./AdminBillRecords").then((m) => m.AdminBillRecords), { loading: tabLoader, ssr: false });
const AdminFoodBill = dynamic(() => import("./AdminFoodBill").then((m) => m.AdminFoodBill), { loading: tabLoader, ssr: false });
const AdminRoomRevenue = dynamic(() => import("./AdminRoomRevenue").then((m) => m.AdminRoomRevenue), { loading: tabLoader, ssr: false });
const DailyLedger = dynamic(() => import("./DailyLedger").then((m) => m.DailyLedger), { loading: tabLoader, ssr: false });
const DailyReconcile = dynamic(() => import("./DailyReconcile").then((m) => m.DailyReconcile), { loading: tabLoader, ssr: false });
const PlatformReceivables = dynamic(() => import("./PlatformReceivables").then((m) => m.PlatformReceivables), { loading: tabLoader, ssr: false });
const AccountActivity = dynamic(() => import("./AccountActivity").then((m) => m.AccountActivity), { loading: tabLoader, ssr: false });

type AccountsTab = "addExpense" | "payableBills" | "unpaidBills" | "recurringExpenses" | "addIncome" | "dailyLedger" | "billRecords" | "incomeRecords" | "foodBill" | "roomBill" | "reconcile" | "platformReceivables" | "accountActivity";

const TABS: { id: AccountsTab; label: string; icon: React.ReactNode; permission?: string | string[] }[] = [
  { id: "addExpense", label: "Add Expense", icon: <PlusCircleIcon className="h-3.5 w-3.5" />, permission: "canAddExpense" },
  { id: "payableBills", label: "Bills Payable", icon: <WalletCardsIcon className="h-3.5 w-3.5" />, permission: "canAddExpense" },
  { id: "recurringExpenses", label: "Recurring Expenses", icon: <Repeat2Icon className="h-3.5 w-3.5" /> },
  { id: "addIncome", label: "Add Income", icon: <HandCoinsIcon className="h-3.5 w-3.5" />, permission: "canAddIncome" },
  { id: "dailyLedger", label: "Daily Ledger", icon: <BookOpenIcon className="h-3.5 w-3.5" />, permission: "canViewAccounts" },
  { id: "billRecords", label: "Expense Records", icon: <FileTextIcon className="h-3.5 w-3.5" />, permission: "canViewExpenses" },
  { id: "unpaidBills", label: "Unpaid Bills", icon: <WalletCardsIcon className="h-3.5 w-3.5" />, permission: "canViewExpenses" },
  { id: "incomeRecords", label: "Income Records", icon: <HandCoinsIcon className="h-3.5 w-3.5" />, permission: "canViewAccounts" },
  { id: "foodBill", label: "Food Revenue", icon: <IndianRupeeIcon className="h-3.5 w-3.5" />, permission: "canViewFoodBills" },
  { id: "roomBill", label: "Room Revenue", icon: <BedDoubleIcon className="h-3.5 w-3.5" />, permission: "canViewFoodBills" },
  { id: "reconcile", label: "Reconcile", icon: <ScaleIcon className="h-3.5 w-3.5" />, permission: ["canReconcileCash", "canReconcileOnline"] },
  { id: "platformReceivables", label: "Platform Receivables", icon: <HandCoinsIcon className="h-3.5 w-3.5" />, permission: "canViewAccounts" },
  { id: "accountActivity", label: "Account Activity", icon: <BookOpenIcon className="h-3.5 w-3.5" /> },
];

const TAB_GROUPS = [
  { id: "newAdditions", label: "New Additions", tabIds: ["addExpense", "payableBills", "recurringExpenses", "addIncome"] },
  { id: "reports", label: "Reports & Charts", tabIds: ["dailyLedger", "billRecords", "unpaidBills", "incomeRecords", "foodBill", "roomBill"] },
  { id: "reconcile", label: "Reconcile", tabIds: ["reconcile", "platformReceivables"] },
  { id: "activity", label: "Account Activity", tabIds: ["accountActivity"] },
] as const;

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
  const visibleTabs = TABS.filter((t) => t.id === "recurringExpenses" ? role === "admin" : t.id === "accountActivity"
    ? hasPermission(role, permissions, "canViewAccounts") && hasPermission(role, permissions, "canViewExpenses")
    : !t.permission || (Array.isArray(t.permission)
    ? t.permission.some((permission) => hasPermission(role, permissions, permission))
    : hasPermission(role, permissions, t.permission)));
  const defaultTab = visibleTabs[0]?.id || "addExpense";
  const [tab, setTab] = useTabWithHistory<AccountsTab>("tab", defaultTab, { validValues: visibleTabs.map((t) => t.id) });
  const mobileGroups = useMemo(() => TAB_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabIds.map((id) => visibleTabs.find((tab) => tab.id === id)).filter((tab): tab is typeof visibleTabs[number] => Boolean(tab)),
  })).filter((group) => group.tabs.length), [visibleTabs]);
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const activeTab = visibleTabs.find((item) => item.id === tab);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Accounts</h2>
      </div>

      <div className="mt-4 hidden flex-wrap gap-1.5 rounded-xl border border-brand-mist bg-white p-1.5 dark:bg-card lg:flex">
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

      <div className={cn("relative mt-4 lg:hidden", subMenuOpen ? "z-[26]" : "z-10")}>
        <button type="button" aria-expanded={subMenuOpen} aria-controls="accounts-mobile-nav" onClick={() => setSubMenuOpen(!subMenuOpen)} className="flex w-full items-center justify-between rounded-xl border border-brand-mist bg-white px-4 py-3 dark:bg-card">
          <span className="flex items-center gap-2 text-sm font-medium text-brand-green">{activeTab?.icon}{activeTab?.label}</span>
          <ChevronDownIcon className={cn("h-4 w-4 text-brand-green-dark/40 transition-transform", subMenuOpen && "rotate-180")} />
        </button>
        {subMenuOpen && <>
          <div className="fixed inset-0 z-[25] bg-black/40" onClick={() => setSubMenuOpen(false)} aria-hidden />
          <div id="accounts-mobile-nav" role="listbox" aria-label="Accounts sections" className="absolute left-0 right-0 top-full z-[26] mt-1 max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-brand-mist bg-white p-3 shadow-lg dark:bg-card dark:shadow-none">
            <div className="space-y-3">{mobileGroups.map((group) => <div key={group.id}>
              <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-green-dark/40">{group.label}</p>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">{group.tabs.map((item) => <button key={item.id} type="button" role="option" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setSubMenuOpen(false); }} className={cn("flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center text-[10px] font-medium leading-tight transition-colors", tab === item.id ? "bg-brand-green/10 text-brand-green" : "text-brand-green-dark/65 hover:bg-brand-sand/50")}>
                <span className="[&>svg]:h-4 [&>svg]:w-4">{item.icon}</span><span className="line-clamp-2">{item.label}</span>
              </button>)}</div>
            </div>)}</div>
          </div>
        </>}
      </div>

      <div className="mt-6">
        {tab === "addExpense" && <AdminAddExpense password={password} username={username} role={role} permissions={permissions} />}
        {tab === "payableBills" && <AdminPayableBills key="create" mode="create" onViewRecords={() => setTab("unpaidBills")} password={password} username={username} role={role} permissions={permissions} />}
        {tab === "unpaidBills" && <AdminPayableBills key="records" mode="records" password={password} username={username} role={role} permissions={permissions} />}
        {tab === "recurringExpenses" && <AdminRecurringExpenses password={password} username={username} />}
        {tab === "addIncome" && <AdminAddIncome password={password} username={username} />}
        {tab === "dailyLedger" && <DailyLedger password={password} username={username} role={role} permissions={permissions} />}
        {tab === "billRecords" && <AdminBillRecords password={password} username={username} role={role} permissions={permissions} />}
        {tab === "incomeRecords" && <AdminIncomeRecords password={password} username={username} role={role} permissions={permissions} />}
        {tab === "foodBill" && <AdminFoodBill password={password} username={username} role={role} permissions={permissions} />}
        {tab === "roomBill" && <AdminRoomRevenue password={password} username={username} role={role} permissions={permissions} />}
        {tab === "reconcile" && <DailyReconcile password={password} username={username} role={role} permissions={permissions} />}
        {tab === "platformReceivables" && <PlatformReceivables password={password} username={username} role={role} />}
        {tab === "accountActivity" && <AccountActivity password={password} username={username} />}
      </div>
    </div>
  );
}
