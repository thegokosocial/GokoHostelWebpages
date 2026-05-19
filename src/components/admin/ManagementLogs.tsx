"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { DownloadIcon, AlertCircleIcon, AlertTriangleIcon, InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type LogEntry = {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  details: string;
};

export function ManagementLogs({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [configuredLevel, setConfiguredLevel] = useState("error");
  const [savingLevel, setSavingLevel] = useState(false);

  useEffect(() => { loadLogs(); loadLogLevel(); }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getSystemLogs" });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } finally { setLoading(false); }
  };

  const loadLogLevel = async () => {
    const res = await apiCall({ action: "getSetting", key: "log_level" });
    if (res.ok) { const d = await res.json(); setConfiguredLevel(d.value || "error"); }
  };

  const changeLogLevel = async (level: string) => {
    setSavingLevel(true);
    try {
      await apiCall({ action: "setSetting", key: "log_level", value: level });
      setConfiguredLevel(level);
    } finally { setSavingLevel(false); }
  };

  const filtered = logs.filter((l) => {
    if (filterLevel && l.level !== filterLevel) return false;
    if (filterSource && l.source !== filterSource) return false;
    return true;
  });

  const allSources = [...new Set(logs.map((l) => l.source).filter(Boolean))];

  const downloadLogs = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `system-logs-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const levelIcon = (level: string) => {
    if (level === "error") return <AlertCircleIcon className="h-3.5 w-3.5 text-red-500" />;
    if (level === "warn") return <AlertTriangleIcon className="h-3.5 w-3.5 text-yellow-500" />;
    return <InfoIcon className="h-3.5 w-3.5 text-blue-500" />;
  };

  if (loading) return <AdminLoading message="Loading logs..." />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">System Logs</h3>
        <div className="flex gap-2">
          <Button type="button" variant="ctaOutline" onClick={downloadLogs} disabled={filtered.length === 0}>
            <DownloadIcon className="mr-1 h-4 w-4" /> Download
          </Button>
          <Button type="button" variant="ctaOutline" onClick={loadLogs}>Refresh</Button>
        </div>
      </div>

      {/* Log level config */}
      {role === "admin" && (
        <div className="flex items-center gap-3 rounded-xl border border-brand-mist bg-white p-3">
          <span className="text-xs font-medium text-brand-green-dark/60">Logging level:</span>
          <select
            value={configuredLevel}
            onChange={(e) => changeLogLevel(e.target.value)}
            disabled={savingLevel}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="error">Error only (default)</option>
            <option value="warn">Warn + Error</option>
            <option value="info">Info + Warn + Error</option>
            <option value="debug">Debug (all)</option>
          </select>
          <span className="text-[10px] text-brand-green-dark/40">Higher levels = more logs = more storage used</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
        </select>
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
          <option value="">All sources</option>
          {allSources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto self-center text-xs text-brand-green-dark/50">{filtered.length} logs</span>
      </div>

      {/* Log entries */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-brand-green-dark/50">No logs recorded yet. Logs appear when errors or important events occur.</p>
        ) : (
          filtered.slice(0, 100).map((l) => (
            <div key={l.id} className={cn(
              "rounded-xl border p-3",
              l.level === "error" && "border-red-200 bg-red-50/50",
              l.level === "warn" && "border-yellow-200 bg-yellow-50/50",
              l.level === "info" && "border-blue-100 bg-blue-50/30",
            )}>
              <div className="flex items-start gap-2">
                {levelIcon(l.level)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-brand-green-dark">{l.message}</span>
                    {l.source && <span className="rounded bg-brand-sand px-1.5 py-0.5 text-[9px] font-medium text-brand-green-dark/50">{l.source}</span>}
                  </div>
                  <p className="mt-0.5 text-[10px] text-brand-green-dark/40">{new Date(l.timestamp).toLocaleString()}</p>
                  {l.details && <pre className="mt-1 max-h-20 overflow-auto rounded bg-brand-sand/50 p-2 text-[10px] text-brand-green-dark/60">{l.details}</pre>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
