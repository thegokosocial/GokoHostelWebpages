"use client";

import { useState, useEffect, useRef } from "react";
import { useAdminApi, fetchWithRetry } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { DownloadIcon, AlertCircleIcon, AlertTriangleIcon, InfoIcon, CopyIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn, localDateStr } from "@/lib/utils";
import { previousPmsPayload, summarizePmsLog } from "@/lib/pmsLogSummary";
import {
  downloadJsonFile,
  formatPmsLogsForPdf,
  formatSystemLogsForPdf,
  prettyJson,
  saveTextPdf,
} from "@/lib/logExport";
import {
  DEFAULT_LOG_PAGE_SIZE,
  LOG_DOWNLOAD_MAX,
  LOG_PAGE_SIZE_OPTIONS,
  LOG_RETENTION_DAYS,
  logPageCount,
  logPagerItems,
} from "@/lib/logRetention";
import type { Role } from "./types";
import {
  managementSectionTabActiveClass,
  managementSectionTabClass,
  managementSectionTabsClass,
  managementSectionTabInactiveClass,
} from "./managementSectionTabs";

type LogSubTab = "system" | "pms";

type LogEntryData = {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  details: string;
};

type PmsLogRow = {
  id: number;
  direction: string;
  type: string;
  status: string;
  requestPayload: string;
  responsePayload: string;
  errorMessage: string;
  recordsAffected: number | null;
  createdAt: string;
  httpMethod?: string | null;
  url?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
};

export function ManagementLogs({ password, username, role }: { password: string; username?: string; role: Role }) {
  const [subTab, setSubTab] = useState<LogSubTab>("system");

  return (
    <div className="space-y-4">
      <div className={managementSectionTabsClass}>
        {([
          { id: "system" as const, label: "System" },
          { id: "pms" as const, label: "PMS" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={cn(
              managementSectionTabClass,
              subTab === t.id ? managementSectionTabActiveClass : managementSectionTabInactiveClass
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "system" && <SystemLogsPanel password={password} username={username} role={role} />}
      {subTab === "pms" && <PmsLogsPanel password={password} username={username} />}
    </div>
  );
}

function SystemLogsPanel({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const [logs, setLogs] = useState<LogEntryData[]>([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_LOG_PAGE_SIZE);
  const [configuredLevel, setConfiguredLevel] = useState("error");
  const [savingLevel, setSavingLevel] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const loadGen = useRef(0);

  useEffect(() => { if (role === "admin") void loadLogLevel(); }, [role]);
  useEffect(() => { loadLogs(); }, [page, pageSize, filterLevel, filterSource]);

  const loadLogs = async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    try {
      const res = await apiCall({
        action: "getSystemLogs",
        page,
        pageSize,
        level: filterLevel || undefined,
        source: filterSource || undefined,
      });
      if (gen !== loadGen.current) return;
      if (res.ok) {
        const data = await res.json();
        if (gen !== loadGen.current) return;
        setLogs(data.logs || []);
        setTotal(Number(data.total) || 0);
        setSources(Array.isArray(data.sources) ? data.sources : []);
        const applied = Math.min(Number(data.page) || page, logPageCount(Number(data.total) || 0, Number(data.pageSize) || pageSize));
        if (applied !== page) setPage(applied);
      }
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
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

  const fetchDownloadLogs = async (): Promise<LogEntryData[] | null> => {
    const res = await apiCall({
      action: "getSystemLogs",
      page: 1,
      pageSize: LOG_DOWNLOAD_MAX,
      download: true,
      level: filterLevel || undefined,
      source: filterSource || undefined,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.logs || [];
  };

  const downloadLogs = async (format: "json" | "pdf") => {
    setDownloading(true);
    try {
      const rows = await fetchDownloadLogs();
      if (!rows) return;
      const stamp = localDateStr(new Date());
      if (format === "json") {
        downloadJsonFile(`system-logs-${stamp}.json`, rows);
        return;
      }
      await saveTextPdf(`system-logs-${stamp}.pdf`, formatSystemLogsForPdf(rows));
    } catch { /* keep the list as-is */ } finally {
      setDownloading(false);
    }
  };

  const levelIcon = (level: string) => {
    if (level === "error") return <AlertCircleIcon className="h-3.5 w-3.5 text-red-500" />;
    if (level === "warn") return <AlertTriangleIcon className="h-3.5 w-3.5 text-yellow-500" />;
    return <InfoIcon className="h-3.5 w-3.5 text-blue-500" />;
  };

  if (loading && logs.length === 0) return <AdminLoading message="Loading logs..." />;

  const pages = logPageCount(total, pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">System Logs</h3>
        <div className="flex flex-wrap gap-2">
          <DownloadMenu
            disabled={total === 0}
            busy={downloading}
            onPdf={() => downloadLogs("pdf")}
            onJson={() => downloadLogs("json")}
          />
          <Button type="button" variant="ctaOutline" onClick={loadLogs}>Refresh</Button>
        </div>
      </div>

      <p className="text-[11px] text-brand-green-dark/50">
        Errors and important events from the last {LOG_RETENTION_DAYS} days. Older rows are deleted automatically.
      </p>

      {role === "admin" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center rounded-xl border border-brand-mist bg-white dark:bg-card p-3">
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

      <div className="flex flex-wrap gap-3">
        <select
          value={filterLevel}
          onChange={(e) => { setFilterLevel(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-xs"
        >
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-xs"
        >
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <LogPageSize value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} />
        <span className="ml-auto self-center text-xs text-brand-green-dark/50">{total} logs</span>
      </div>

      <div className="space-y-2">
        {logs.length === 0 ? (
          <p className="py-12 text-center text-sm text-brand-green-dark/50">No logs recorded yet. Logs appear when errors or important events occur.</p>
        ) : (
          logs.map((l) => (
            <LogEntryCard key={l.id} log={l} levelIcon={levelIcon} />
          ))
        )}
      </div>
      <LogPager page={page} pageCount={pages} onPage={setPage} disabled={loading} />
    </div>
  );
}

function LogEntryCard({ log, levelIcon }: { log: LogEntryData; levelIcon: (level: string) => React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const copyLog = () => {
    const text = [
      `[${log.level.toUpperCase()}] ${log.message}`,
      `Source: ${log.source || "unknown"}`,
      `Time: ${new Date(log.timestamp).toLocaleString()}`,
      log.details ? `\nDetails:\n${log.details}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={cn(
      "rounded-xl border p-3 overflow-hidden",
      log.level === "error" && "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/50",
      log.level === "warn" && "border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/50",
      log.level === "info" && "border-blue-100 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/30",
    )}>
      <div className="flex items-start gap-2">
        {levelIcon(log.level)}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-brand-green-dark break-all">{log.message}</span>
                {log.source && <span className="shrink-0 rounded bg-brand-sand px-1.5 py-0.5 text-[9px] font-medium text-brand-green-dark/50">{log.source}</span>}
              </div>
              <p className="mt-0.5 text-[10px] text-brand-green-dark/40">{new Date(log.timestamp).toLocaleString()}</p>
            </div>
            <button
              onClick={copyLog}
              className="shrink-0 rounded-md p-1 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green-dark transition-colors"
              title="Copy log entry"
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
          {log.details && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-brand-sand/50 p-2 text-[10px] text-brand-green-dark/60">{log.details}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function PmsLogsPanel({ password, username }: { password: string; username?: string }) {
  const [logs, setLogs] = useState<PmsLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_LOG_PAGE_SIZE);
  const [downloading, setDownloading] = useState(false);
  const loadGen = useRef(0);

  const loadLogs = async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        password,
        action: "getSyncLogs",
        page,
        pageSize,
      };
      if (username) payload.username = username;
      if (filterDirection) payload.direction = filterDirection;
      if (filterType) payload.type = filterType;
      if (filterStatus) payload.status = filterStatus;
      const res = await fetchWithRetry("/api/admin/channel-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (gen !== loadGen.current) return;
      if (!res.ok) {
        setLogs([]);
        setTotal(0);
        setError(typeof data.error === "string" ? data.error : `Failed to load logs (${res.status})`);
        return;
      }
      setLogs(data.logs || []);
      setTotal(Number(data.total) || 0);
      const applied = Math.min(Number(data.page) || page, logPageCount(Number(data.total) || 0, Number(data.pageSize) || pageSize));
      if (applied !== page) setPage(applied);
    } catch {
      if (gen !== loadGen.current) return;
      setLogs([]);
      setTotal(0);
      setError("Failed to load logs");
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  };

  useEffect(() => { loadLogs(); }, [page, pageSize, filterDirection, filterType, filterStatus]);

  const fetchDownloadLogs = async (): Promise<PmsLogRow[] | null> => {
    const payload: Record<string, unknown> = {
      password,
      action: "getSyncLogs",
      page: 1,
      pageSize: LOG_DOWNLOAD_MAX,
      download: true,
    };
    if (username) payload.username = username;
    if (filterDirection) payload.direction = filterDirection;
    if (filterType) payload.type = filterType;
    if (filterStatus) payload.status = filterStatus;
    const res = await fetchWithRetry("/api/admin/channel-manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return data.logs || [];
  };

  const downloadLogs = async (format: "json" | "pdf") => {
    setDownloading(true);
    try {
      const rows = await fetchDownloadLogs();
      if (!rows) return;
      const stamp = localDateStr(new Date());
      if (format === "json") {
        downloadJsonFile(`pms-logs-${stamp}.json`, rows);
        return;
      }
      await saveTextPdf(`pms-logs-${stamp}.pdf`, formatPmsLogsForPdf(rows));
    } catch { /* keep the list as-is */ } finally {
      setDownloading(false);
    }
  };

  if (loading && logs.length === 0) return <AdminLoading message="Loading PMS logs..." />;

  const pages = logPageCount(total, pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">PMS Logs</h3>
        <div className="flex flex-wrap gap-2">
          <DownloadMenu
            disabled={total === 0}
            busy={downloading}
            onPdf={() => downloadLogs("pdf")}
            onJson={() => downloadLogs("json")}
          />
          <Button type="button" variant="ctaOutline" onClick={loadLogs}>Refresh</Button>
        </div>
      </div>

      <p className="text-[11px] text-brand-green-dark/50">
        Every call to and from Aiosell: inbound reservation webhooks (pull), Channel Manager fetch (pull), and outbound inventory / rates / restrictions / no-show (push). Last {LOG_RETENTION_DAYS} days; older rows are deleted automatically.
      </p>

      <div className="flex flex-wrap gap-3">
        <select
          value={filterDirection}
          onChange={(e) => { setFilterDirection(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-xs"
        >
          <option value="">All directions</option>
          <option value="push">Push (outbound)</option>
          <option value="pull">Pull (inbound)</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-xs"
        >
          <option value="">All types</option>
          <option value="inventory">Inventory</option>
          <option value="rate">Rate</option>
          <option value="restriction">Restriction</option>
          <option value="reservation">Reservation (webhook)</option>
          <option value="fetch">Fetch from Aiosell</option>
          <option value="noshow">No-show</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-xs"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
        <LogPageSize value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} />
        <span className="ml-auto self-center text-xs text-brand-green-dark/50">{total} logs</span>
      </div>

      <div className="space-y-2">
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : logs.length === 0 ? (
          <p className="py-12 text-center text-sm text-brand-green-dark/50">
            No PMS calls yet. They appear when inventory, rates, or no-show are pushed, or when Aiosell sends a reservation.
          </p>
        ) : (
          logs.map((l, i) => (
            <PmsLogCard key={l.id} log={l} previousRequestPayload={previousPmsPayload(logs, i)} />
          ))
        )}
      </div>
      <LogPager page={page} pageCount={pages} onPage={setPage} disabled={loading} />
    </div>
  );
}

function DownloadMenu({
  disabled,
  busy,
  onPdf,
  onJson,
}: {
  disabled: boolean;
  busy?: boolean;
  onPdf: () => void;
  onJson: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        type="button"
        variant="ctaOutline"
        disabled={disabled || busy}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <DownloadIcon className="mr-1 h-4 w-4" />
        {busy ? "Preparing…" : "Download"}
        <ChevronDownIcon className="ml-1 h-3.5 w-3.5" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-md border border-brand-mist bg-white py-1 shadow-md dark:bg-card"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs font-medium text-brand-green-dark hover:bg-brand-sand/50"
            onClick={() => { setOpen(false); onPdf(); }}
          >
            PDF
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs font-medium text-brand-green-dark hover:bg-brand-sand/50"
            onClick={() => { setOpen(false); onJson(); }}
          >
            JSON
          </button>
        </div>
      )}
    </div>
  );
}

function LogPageSize({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-brand-green-dark/60">
      Per page
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-input bg-background px-2 py-2 text-xs"
      >
        {LOG_PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

function LogPager({
  page, pageCount, onPage, disabled,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  disabled?: boolean;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1 pt-2" aria-label="Pagination">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
        className="px-2 py-1 text-xs text-brand-green underline disabled:opacity-40 disabled:no-underline"
      >
        Previous
      </button>
      {logPagerItems(page, pageCount).map((item, i) =>
        item === "ellipsis" ? (
          <span key={`e${i}`} className="px-1 text-xs text-brand-green-dark/40">…</span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === page ? "page" : undefined}
            disabled={disabled}
            onClick={() => onPage(item)}
            className={cn(
              "min-w-7 rounded-full px-2 py-1 text-xs font-medium",
              item === page
                ? "bg-brand-green text-white"
                : "text-brand-green hover:bg-brand-green/10"
            )}
          >
            {item}
          </button>
        )
      )}
      <button
        type="button"
        disabled={disabled || page >= pageCount}
        onClick={() => onPage(page + 1)}
        className="px-2 py-1 text-xs text-brand-green underline disabled:opacity-40 disabled:no-underline"
      >
        Next
      </button>
    </nav>
  );
}

function PmsLogCard({ log, previousRequestPayload }: { log: PmsLogRow; previousRequestPayload?: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const failed = log.status !== "success";
  const summary = summarizePmsLog({
    type: log.type,
    requestPayload: log.requestPayload,
    previousRequestPayload,
  });

  const copyLog = () => {
    const requestText = prettyJson(log.requestPayload);
    const responseText = prettyJson(log.responsePayload);
    const text = [
      `${log.direction} ${log.type} ${log.status}`,
      summary ? `Operation:\n${summary}` : "",
      log.url ? `URL: ${log.httpMethod || "POST"} ${log.url}` : "",
      log.httpStatus === 0 ? "network error" : log.httpStatus != null ? `HTTP ${log.httpStatus}` : "",
      log.durationMs != null ? `${log.durationMs}ms` : "",
      `Time: ${new Date(log.createdAt).toLocaleString()}`,
      log.errorMessage ? `Error: ${log.errorMessage}` : "",
      requestText ? `\nRequest:\n${requestText}` : "",
      responseText ? `\nResponse:\n${responseText}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden",
      failed
        ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/50"
        : "border-brand-mist bg-white dark:bg-card"
    )}>
      <div className="flex items-start gap-2 p-3">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", failed ? "bg-red-500" : "bg-green-500")} />
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-brand-sand px-1.5 py-0.5 text-[9px] font-medium uppercase text-brand-green-dark/60">{log.direction}</span>
            <span className="text-xs font-medium text-brand-green-dark">{log.type}</span>
            {log.httpStatus === 0 && (
              <span className="text-[10px] text-brand-green-dark/50">network</span>
            )}
            {log.httpStatus != null && log.httpStatus !== 0 && (
              <span className="text-[10px] text-brand-green-dark/50">HTTP {log.httpStatus}</span>
            )}
            {log.durationMs != null && (
              <span className="text-[10px] text-brand-green-dark/40">{log.durationMs}ms</span>
            )}
            {(log.recordsAffected ?? 0) > 0 && (
              <span className="text-[10px] text-brand-green-dark/40">{log.recordsAffected} records</span>
            )}
          </div>
          {summary && (
            <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-brand-green-dark/80">{summary}</p>
          )}
          {log.url && <p className="mt-0.5 truncate font-mono text-[10px] text-brand-green-dark/40">{log.httpMethod || "POST"} {log.url}</p>}
          {log.errorMessage && <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400 break-all">{log.errorMessage}</p>}
          <p className="mt-0.5 text-[10px] text-brand-green-dark/40">{new Date(log.createdAt).toLocaleString()}</p>
        </button>
        <button
          type="button"
          onClick={copyLog}
          className="shrink-0 rounded-md p-1 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green-dark transition-colors"
          title="Copy log entry"
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded-md p-1 text-brand-green-dark/40"
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronDownIcon className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (() => {
        const requestText = prettyJson(log.requestPayload);
        const responseText = prettyJson(log.responsePayload);
        return (
        <div className="space-y-2 border-t border-brand-mist/60 px-3 pb-3 pt-2">
          {requestText ? (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-brand-green-dark/50">Request</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-brand-sand/50 p-2 text-[10px] text-brand-green-dark/60">{requestText}</pre>
            </div>
          ) : null}
          {responseText ? (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-brand-green-dark/50">Response</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-brand-sand/50 p-2 text-[10px] text-brand-green-dark/60">{responseText}</pre>
            </div>
          ) : null}
          {!requestText && !responseText && (
            <p className="text-[10px] text-brand-green-dark/40">No request or response body stored.</p>
          )}
        </div>
        );
      })()}
    </div>
  );
}
