"use client";

import { useState, useEffect, useCallback } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DownloadIcon, Loader2Icon, Settings2Icon, Trash2Icon } from "lucide-react";
import { cn, localDateStr } from "@/lib/utils";
import { OrderHistory } from "./AdminFoodOrders";
import type { Role } from "./types";

type AuditSubTab = "room" | "bookings" | "food";

type AuditEntry = {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  target: string;
  details: string;
};

type AuditRetentionState = {
  years: number;
  months: number;
  totalMonths: number;
  cutoff: string;
  eligible: { auditLog: number; bookingHistory: number; total: number };
};

export function ManagementAudit({ password, username }: { password: string; username?: string; role: Role }) {
  const [subTab, setSubTab] = useState<AuditSubTab>("room");
  const { apiCall } = useAdminApi(password, username);

  const foodApiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const bookingApiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const auditTabs = [
    { id: "room" as AuditSubTab, label: "Room & General" },
    { id: "bookings" as AuditSubTab, label: "Bookings" },
    { id: "food" as AuditSubTab, label: "Food Orders" },
  ];

  return (
    <div className="space-y-4">
      <AuditRetentionControls apiCall={apiCall} />
      <div className="flex gap-1 rounded-lg border border-brand-mist bg-white dark:bg-card p-1">
        {auditTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors lg:flex-none lg:py-1.5",
              subTab === tab.id ? "bg-brand-green text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === "room" && <RoomAuditTrail apiCall={apiCall} />}
      {subTab === "bookings" && <BookingAuditTrail apiCall={bookingApiCall} />}
      {subTab === "food" && <OrderHistory apiCall={foodApiCall} />}
    </div>
  );
}

function RoomAuditTrail({ apiCall }: { apiCall: (body: Record<string, any>) => Promise<Response> }) {
  const loadEntries = useCallback(() => apiCall({ action: "getAuditLog" }), [apiCall]);
  return <AuditTrail loadEntries={loadEntries} filePrefix="audit-log" />;
}

function BookingAuditTrail({ apiCall }: { apiCall: (body: Record<string, any>) => Promise<Response> }) {
  const loadEntries = useCallback(() => apiCall({ action: "getBookingAuditLog" }), [apiCall]);
  return <AuditTrail loadEntries={loadEntries} filePrefix="booking-audit-log" emptyMessage="No booking audit entries yet" />;
}

function AuditRetentionControls({ apiCall }: { apiCall: (body: Record<string, any>) => Promise<Response> }) {
  const [retention, setRetention] = useState<AuditRetentionState | null>(null);
  const [years, setYears] = useState(3);
  const [months, setMonths] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState("");

  const loadRetention = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getAuditRetention" });
      if (!res.ok) return;
      const data = await res.json() as AuditRetentionState;
      setRetention(data);
      setYears(data.years);
      setMonths(data.months);
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void loadRetention();
  }, [loadRetention]);

  const saveRetention = async () => {
    const totalMonths = years * 12 + months;
    if (totalMonths < 1) {
      setMessage("Retention must be at least 1 month.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await apiCall({ action: "setAuditRetention", years, months });
      if (!res.ok) {
        setMessage("Could not save the retention period.");
        return;
      }
      setRetention(await res.json() as AuditRetentionState);
      setMessage("Retention period saved. Cleanup has not run.");
    } finally {
      setSaving(false);
    }
  };

  const cleanupAudit = async () => {
    if (!retention || retention.eligible.total === 0) return;
    const cutoff = new Date(retention.cutoff).toLocaleDateString();
    if (!window.confirm(`Delete ${retention.eligible.total} audit entries older than ${cutoff}? Booking, check-in, food, and account data will not be deleted.`)) return;
    setCleaning(true);
    setMessage("");
    try {
      const res = await apiCall({ action: "cleanupAuditLog" });
      if (!res.ok) {
        setMessage("Could not clean up the audit trail.");
        return;
      }
      const data = await res.json() as AuditRetentionState & { deleted: AuditRetentionState["eligible"] };
      setRetention(data);
      setMessage(`${data.deleted.total} audit entries deleted. Operational records were kept.`);
    } finally {
      setCleaning(false);
    }
  };

  const totalMonths = years * 12 + months;
  return (
    <section className="rounded-xl border border-brand-mist bg-white p-4 shadow-sm dark:bg-card dark:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-brand-green-dark">
            <Settings2Icon className="h-4 w-4" /> Audit retention
          </div>
          <p className="mt-1 text-xs text-brand-green-dark/60">Choose how long audit entries are kept. Saving changes the policy; cleanup is always manual.</p>
        </div>
        {retention && <span className="rounded-full bg-brand-sand px-2.5 py-1 text-xs text-brand-green-dark/70">{retention.totalMonths} months configured</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-brand-green-dark/70">
          Years
          <select value={years} onChange={(event) => setYears(Number(event.target.value))} className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm">
            {Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-brand-green-dark/70">
          Months
          <select value={months} onChange={(event) => setMonths(Number(event.target.value))} className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm">
            {Array.from({ length: 12 }, (_, value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <span className="pb-2 text-xs text-brand-green-dark/60">{totalMonths} months total</span>
        <Button type="button" variant="ctaOutline" onClick={() => void saveRetention()} disabled={loading || saving || totalMonths < 1}>
          {saving && <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />} Save policy
        </Button>
      </div>

      {retention && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-sand/50 p-3 text-xs text-brand-green-dark/70">
          <span>Eligible for cleanup: <strong>{retention.eligible.total}</strong> entries before {new Date(retention.cutoff).toLocaleDateString()}</span>
          <Button type="button" variant="ctaOutline" onClick={() => void cleanupAudit()} disabled={cleaning || retention.eligible.total === 0}>
            {cleaning ? <Loader2Icon className="mr-1 h-4 w-4 animate-spin" /> : <Trash2Icon className="mr-1 h-4 w-4" />} Clean up older entries
          </Button>
        </div>
      )}
      {message && <p className="mt-2 text-xs text-brand-green-dark/70" role="status">{message}</p>}
    </section>
  );
}

function auditActionClass(action: string): string {
  const key = action.toLowerCase();
  if (key.includes("delete") || key.includes("cancel") || key.includes("no-show")) {
    return "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400";
  }
  if (key.includes("assign") || key.includes("created") || key.includes("received") || key.includes("linked")) {
    return "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400";
  }
  if (key.includes("checkout") || key.includes("hold")) {
    return "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400";
  }
  if (key.includes("checkin") || key.includes("check-in") || key.includes("payment")) {
    return "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400";
  }
  return "bg-gray-100 dark:bg-[#1c1c1c] text-gray-700 dark:text-gray-300";
}

function csvValue(value: string): string {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function AuditTrail({
  loadEntries,
  filePrefix,
  emptyMessage = "No audit entries yet",
}: {
  loadEntries: () => Promise<Response>;
  filePrefix: string;
  emptyMessage?: string;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterUser, setFilterUser] = useState("");

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadEntries();
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } finally {
      setLoading(false);
    }
  }, [loadEntries]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const filtered = entries.filter((entry) => {
    if (search) {
      const query = search.toLowerCase();
      const searchable = [entry.username, entry.target, entry.action, entry.details].join(" ").toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    if (filterAction && entry.action !== filterAction) return false;
    if (filterUser && entry.username !== filterUser) return false;
    return true;
  });

  const allActions = [...new Set(entries.map((entry) => entry.action))];
  const allUsers = [...new Set(entries.map((entry) => entry.username))];

  const exportCsv = () => {
    const header = "Timestamp,User,Action,Target,Details";
    const body = filtered
      .map((entry) => [entry.timestamp, entry.username, entry.action, entry.target, entry.details].map(csvValue).join(","))
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filePrefix}-${localDateStr(new Date())}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <AdminLoading message="Loading audit log..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-brand-green-dark">Audit Trail</h3>
        <div className="flex gap-2">
          <Button type="button" variant="ctaOutline" onClick={exportCsv} disabled={filtered.length === 0}>
            <DownloadIcon className="mr-1 h-4 w-4" /> Export CSV
          </Button>
          <Button type="button" variant="ctaOutline" onClick={() => void loadAudit()}>Refresh</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Search..." value={search} onChange={(event) => setSearch(event.target.value)} className="w-full sm:w-48" />
        <select value={filterAction} onChange={(event) => setFilterAction(event.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All actions</option>
          {allActions.map((action) => <option key={action} value={action}>{action}</option>)}
        </select>
        <select value={filterUser} onChange={(event) => setFilterUser(event.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All users</option>
          {allUsers.map((user) => <option key={user} value={user}>{user}</option>)}
        </select>
        <span className="ml-auto self-center text-xs text-brand-green-dark/50">{filtered.length} entries</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-sm dark:shadow-none">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-brand-mist bg-brand-sand/50">
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Time</th>
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">User</th>
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Action</th>
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Target</th>
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-brand-green-dark/50">{emptyMessage}</td></tr>
            ) : (
              filtered.slice(0, 200).map((entry) => (
                <tr key={entry.id} className="border-b border-brand-mist/50 last:border-0 hover:bg-brand-sand/30">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-brand-green-dark/70">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs font-medium text-brand-green-dark">{entry.username}</td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", auditActionClass(entry.action))}>{entry.action}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-green-dark/80">{entry.target}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-xs text-brand-green-dark/50" title={entry.details}>{entry.details}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
