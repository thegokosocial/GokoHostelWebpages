"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAdminApi } from "./useAdminApi";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import type { Role } from "./types";
import { AdminLoading } from "./AdminLoading";

const HISTORY_COLUMNS = ["Timestamp", "Bed ID", "Dorm", "Action", "Guest Name", "Guest Contact"];

export function AdminBedHistory({ password, role }: { password: string; role: Role }) {
  const { apiCall } = useAdminApi(password);
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterDorm, setFilterDorm] = useState<string>("");

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getBedHistory" });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
      }
    } finally { setLoading(false); }
  };

  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);

  const deleteEntry = async (origIdx: number) => {
    if (!confirm("Delete this history entry? This cannot be undone.")) return;
    setDeletingIdx(origIdx);
    try {
      const res = await apiCall({ action: "deleteBedHistory", rowIndex: origIdx });
      if (res.ok) await loadHistory();
      else { const d = await res.json(); alert(d.error || "Failed to delete"); }
    } finally { setDeletingIdx(null); }
  };

  const filteredRows = (() => {
    let result = [...rows].map((row, origIdx) => ({ row, origIdx }));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(({ row }) => row.some((cell) => cell?.toLowerCase().includes(q)));
    }

    if (filterAction) {
      result = result.filter(({ row }) => row[3] === filterAction);
    }

    if (filterDorm) {
      result = result.filter(({ row }) => row[2] === filterDorm);
    }

    result.reverse();
    return result;
  })();

  const allDorms = [...new Set(rows.map((r) => r[2]).filter(Boolean))];
  const allActions = [...new Set(rows.map((r) => r[3]).filter(Boolean))];
  const hasFilters = searchQuery.trim() !== "" || filterAction !== "" || filterDorm !== "";

  const exportCsv = () => {
    const header = HISTORY_COLUMNS.join(",");
    const body = rows.map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const csv = header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bed-history-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <AdminLoading message="Loading history..." />;
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Bed History</h2>
        <div className="flex gap-2">
          <Button type="button" variant="ctaOutline" onClick={exportCsv} disabled={rows.length === 0}>
            <DownloadIcon className="mr-1 h-4 w-4" /> Export CSV
          </Button>
          <Button type="button" variant="ctaOutline" onClick={loadHistory} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input placeholder="Search by name, bed, dorm..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-xs" />
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All actions</option>
          {allActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterDorm} onChange={(e) => setFilterDorm(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All dorms</option>
          {allDorms.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {hasFilters && (
          <button type="button" onClick={() => { setSearchQuery(""); setFilterAction(""); setFilterDorm(""); }}
            className="rounded-md bg-brand-red/10 px-3 py-2 text-xs font-medium text-brand-red hover:bg-brand-red/20">
            Clear filters
          </button>
        )}
        <p className="ml-auto text-sm text-brand-green-dark/70">
          {filteredRows.length}{filteredRows.length !== rows.length ? ` of ${rows.length}` : ""} entries
        </p>
      </div>

      {/* Table */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-brand-mist bg-white shadow-card">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-brand-mist bg-brand-sand/50">
              {HISTORY_COLUMNS.map((col) => (
                <th key={col} className="whitespace-nowrap px-4 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">{col}</th>
              ))}
              {role === "admin" && <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70" />}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={HISTORY_COLUMNS.length + (role === "admin" ? 1 : 0)} className="px-4 py-12 text-center text-brand-green-dark/50">No history records</td></tr>
            ) : (
              filteredRows.map(({ row, origIdx }) => (
                <tr key={origIdx} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                  {HISTORY_COLUMNS.map((_, ci) => {
                    const cell = row[ci] || "";
                    return (
                      <td key={ci} className="whitespace-nowrap px-4 py-3">
                        {ci === 3 ? (
                          <span className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                            cell === "assign" && "bg-green-100 text-green-700",
                            cell === "checkout" && "bg-orange-100 text-orange-700",
                            cell === "extend" && "bg-blue-100 text-blue-700",
                            cell === "swap" && "bg-purple-100 text-purple-700",
                            cell === "unassign" && "bg-gray-100 text-gray-700",
                            cell === "change-out" && "bg-yellow-100 text-yellow-700",
                            cell === "change-in" && "bg-teal-100 text-teal-700",
                            cell === "markClean" && "bg-emerald-100 text-emerald-700",
                          )}>
                            {cell}
                          </span>
                        ) : ci === 0 ? (
                          <span className="text-brand-green-dark/70">{cell ? new Date(cell).toLocaleString() : ""}</span>
                        ) : (
                          <span className="text-brand-green-dark/90">{cell}</span>
                        )}
                      </td>
                    );
                  })}
                  {role === "admin" && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <button type="button" onClick={() => deleteEntry(origIdx)}
                        disabled={deletingIdx === origIdx}
                        className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                        {deletingIdx === origIdx
                          ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-red-600" />
                          : <Trash2Icon className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
