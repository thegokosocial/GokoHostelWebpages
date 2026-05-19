"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DownloadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type AuditEntry = {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  target: string;
  details: string;
};

export function ManagementAudit({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterUser, setFilterUser] = useState("");

  useEffect(() => { loadAudit(); }, []);

  const loadAudit = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getAuditLog" });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } finally { setLoading(false); }
  };

  const filtered = entries.filter((e) => {
    if (search) {
      const q = search.toLowerCase();
      if (!e.username.toLowerCase().includes(q) && !e.target.toLowerCase().includes(q) && !e.action.toLowerCase().includes(q)) return false;
    }
    if (filterAction && e.action !== filterAction) return false;
    if (filterUser && e.username !== filterUser) return false;
    return true;
  });

  const allActions = [...new Set(entries.map((e) => e.action))];
  const allUsers = [...new Set(entries.map((e) => e.username))];

  const exportCsv = () => {
    const header = "Timestamp,User,Action,Target,Details";
    const body = filtered.map((e) => `"${e.timestamp}","${e.username}","${e.action}","${e.target}","${e.details}"`).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <AdminLoading message="Loading audit log..." />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">Audit Trail</h3>
        <div className="flex gap-2">
          <Button type="button" variant="ctaOutline" onClick={exportCsv} disabled={filtered.length === 0}>
            <DownloadIcon className="mr-1 h-4 w-4" /> Export CSV
          </Button>
          <Button type="button" variant="ctaOutline" onClick={loadAudit}>Refresh</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All actions</option>
          {allActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All users</option>
          {allUsers.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <span className="ml-auto self-center text-xs text-brand-green-dark/50">{filtered.length} entries</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-brand-mist bg-white shadow-sm">
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
              <tr><td colSpan={5} className="px-4 py-12 text-center text-brand-green-dark/50">No audit entries yet</td></tr>
            ) : (
              filtered.slice(0, 200).map((e) => (
                <tr key={e.id} className="border-b border-brand-mist/50 last:border-0 hover:bg-brand-sand/30">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-brand-green-dark/70">{new Date(e.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs font-medium text-brand-green-dark">{e.username}</td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      e.action.includes("delete") && "bg-red-100 text-red-700",
                      e.action.includes("assign") && "bg-green-100 text-green-700",
                      e.action.includes("checkout") && "bg-orange-100 text-orange-700",
                      e.action.includes("checkin") && "bg-blue-100 text-blue-700",
                      !e.action.includes("delete") && !e.action.includes("assign") && !e.action.includes("checkout") && !e.action.includes("checkin") && "bg-gray-100 text-gray-700",
                    )}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-green-dark/80">{e.target}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-brand-green-dark/50">{e.details}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
