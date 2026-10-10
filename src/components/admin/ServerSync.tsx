"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  ServerIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  WifiIcon,
  WifiOffIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  CloudIcon,
  CpuIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  ChevronDownIcon,
  PowerIcon,
  DownloadIcon,
  ShieldIcon,
} from "lucide-react";
import type { Role } from "./types";

type ServerStatus = {
  online: boolean;
  build: string;
  records: number;
  lastSeen: string | null;
};

type SyncStatus = {
  runtime?: "cloudflare" | "pi";
  cloudflare: ServerStatus;
  pi: ServerStatus;
  internetConnected: boolean;
  primaryServer: "cloudflare" | "pi";
  lastSync: string | null;
  recordsPulled: number;
  recordsPushed: number;
  conflicts: number;
  pendingChanges: number;
  autoSync: boolean;
};

type Conflict = {
  id: string;
  table: string;
  identifier: string;
  cloudValue: Record<string, string>;
  piValue: Record<string, string>;
};

type SyncLogEntry = {
  id: string;
  timestamp: string;
  type: "Full Sync" | "Auto Pull" | "Manual Push" | "Auto Push" | "Pull Only";
  pulled: number;
  pushed: number;
  conflicts: number;
  status: "success" | "warning" | "error";
  errorMessage?: string;
};

const MOCK_STATUS: SyncStatus = {
  cloudflare: { online: true, build: "abc1234", records: 2847, lastSeen: new Date().toISOString() },
  pi: { online: true, build: "abc1234", records: 2847, lastSeen: new Date(Date.now() - 120000).toISOString() },
  internetConnected: true,
  primaryServer: "cloudflare",
  lastSync: new Date(Date.now() - 300000).toISOString(),
  recordsPulled: 12,
  recordsPushed: 8,
  conflicts: 0,
  pendingChanges: 23,
  autoSync: true,
};

const MOCK_CONFLICTS: Conflict[] = [];

const MOCK_LOG: SyncLogEntry[] = [
  { id: "1", timestamp: new Date(Date.now() - 300000).toISOString(), type: "Full Sync", pulled: 12, pushed: 8, conflicts: 0, status: "success" },
  { id: "2", timestamp: new Date(Date.now() - 600000).toISOString(), type: "Auto Pull", pulled: 3, pushed: 0, conflicts: 0, status: "success" },
  { id: "3", timestamp: new Date(Date.now() - 7200000).toISOString(), type: "Manual Push", pulled: 0, pushed: 45, conflicts: 2, status: "warning" },
  { id: "4", timestamp: new Date(Date.now() - 86400000).toISOString(), type: "Full Sync", pulled: 0, pushed: 0, conflicts: 0, status: "error", errorMessage: "Timeout" },
];

function timeAgo(isoString: string | null): string {
  if (!isoString) return "never";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatTimestamp(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function ServerSync({ password, username, role }: { password: string; username?: string; role: Role }) {
  const passwordRef = useRef(password);
  passwordRef.current = password;

  const [status, setStatus] = useState<SyncStatus>(MOCK_STATUS);
  const [conflicts, setConflicts] = useState<Conflict[]>(MOCK_CONFLICTS);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>(MOCK_LOG);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<"full" | "pull" | "push" | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [logLimit, setLogLimit] = useState(20);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [shutdownMessage, setShutdownMessage] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployMessage, setDeployMessage] = useState<string | null>(null);
  const [restartingTunnel, setRestartingTunnel] = useState(false);
  const [tunnelMessage, setTunnelMessage] = useState<string | null>(null);
  const [failoverEnabled, setFailoverEnabled] = useState(false);
  const [failoverActive, setFailoverActive] = useState(false);
  const [failoverLoading, setFailoverLoading] = useState(false);
  const [piLocalUrl, setPiLocalUrl] = useState("");
  const [piLocalUrlSaved, setPiLocalUrlSaved] = useState(false);

  const apiCall = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordRef.current, action, ...extra }),
      });
      if (res.status === 404) {
        setApiAvailable(false);
        return null;
      }
      setApiAvailable(true);
      return res;
    } catch {
      setApiAvailable(false);
      return null;
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall("status");
      if (res && res.ok) {
        const data = await res.json();
        if (data.status) setStatus(data.status);
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  const loadConflicts = useCallback(async () => {
    const res = await apiCall("getConflicts");
    if (res && res.ok) {
      const data = await res.json();
      if (data.conflicts) setConflicts(data.conflicts);
    }
  }, [apiCall]);

  const loadSyncLog = useCallback(async () => {
    const res = await apiCall("getSyncLog", { limit: logLimit });
    if (res && res.ok) {
      const data = await res.json();
      if (data.logs) {
        setSyncLog(
          data.logs.map((row: any) => ({
            id: String(row.id),
            timestamp: row.startedAt || row.completedAt || "",
            type: row.direction === "full" ? "Full Sync" : row.direction === "pull" ? "Pull Only" : "Manual Push",
            pulled: row.recordsPulled ?? 0,
            pushed: row.recordsPushed ?? 0,
            conflicts: row.conflictsFound ?? 0,
            status: row.status === "completed" ? (row.conflictsFound > 0 ? "warning" : "success") : row.status === "error" ? "error" : "success",
            errorMessage: row.errorMessage || undefined,
          })),
        );
      }
    }
  }, [apiCall, logLimit]);

  const loadFailoverStatus = useCallback(async () => {
    const res = await apiCall("getFailoverStatus");
    if (res && res.ok) {
      const data = await res.json();
      setFailoverEnabled(data.failoverEnabled ?? false);
      setFailoverActive(data.failoverActive ?? false);
      if (data.piLocalUrl) setPiLocalUrl(data.piLocalUrl);
    }
  }, [apiCall]);

  useEffect(() => {
    loadStatus();
    loadConflicts();
    loadSyncLog();
    loadFailoverStatus();
    const interval = setInterval(() => { loadStatus(); loadFailoverStatus(); }, 30000);
    return () => clearInterval(interval);
  }, [loadStatus, loadConflicts, loadSyncLog, loadFailoverStatus]);

  const handleSync = async (mode: "full" | "pull" | "push") => {
    setSyncing(mode);
    const res = await apiCall("sync", { mode });
    if (res && res.ok) {
      await loadStatus();
      await loadSyncLog();
    }
    setSyncing(null);
  };

  const handleResolveConflict = async (conflictId: string, resolution: "cloud" | "pi") => {
    await apiCall("resolveConflict", { conflictId, resolution });
    await loadConflicts();
    await loadStatus();
  };

  const handleBulkResolve = async (resolution: "cloud" | "pi") => {
    await apiCall("resolveAll", { resolution });
    await loadConflicts();
    await loadStatus();
  };

  const handleToggleAutoSync = async () => {
    const newValue = !status.autoSync;
    setStatus((prev) => ({ ...prev, autoSync: newValue }));
    await apiCall("toggleAutoSync", { enabled: newValue });
  };

  const handleSwitchPrimary = async () => {
    const newPrimary = status.primaryServer === "cloudflare" ? "pi" : "cloudflare";
    await apiCall("setPrimary", { server: newPrimary });
    setStatus((prev) => ({ ...prev, primaryServer: newPrimary }));
    setConfirmSwitch(false);
  };

  const handleShutdownPi = async () => {
    setShuttingDown(true);
    setShutdownMessage(null);
    const res = await apiCall("shutdownPi");
    if (res && res.ok) {
      const data = await res.json();
      setShutdownMessage(data.message || "Shutdown initiated.");
    } else {
      setShutdownMessage("Failed to initiate shutdown.");
    }
    setShuttingDown(false);
    setConfirmShutdown(false);
  };

  const handleDeployUpdate = async () => {
    setDeploying(true);
    setDeployMessage(null);
    const res = await apiCall("deployUpdate");
    if (res && res.ok) {
      const data = await res.json();
      setDeployMessage(data.message || "Deploy triggered.");
    } else {
      const data = await res?.json().catch(() => null);
      setDeployMessage(data?.error || "Failed to trigger deploy.");
    }
    setDeploying(false);
  };

  const handleRestartTunnel = async () => {
    setRestartingTunnel(true);
    setTunnelMessage(null);
    const res = await apiCall("restartCloudflared");
    if (res && res.ok) {
      const data = await res.json();
      setTunnelMessage(data.message || "Tunnel restart requested.");
    } else {
      setTunnelMessage("Failed to restart tunnel.");
    }
    setRestartingTunnel(false);
  };

  const handleToggleFailover = async () => {
    setFailoverLoading(true);
    const newValue = !failoverEnabled;
    const res = await apiCall("toggleFailover", { enabled: newValue });
    if (res && res.ok) {
      setFailoverEnabled(newValue);
      if (!newValue) setFailoverActive(false);
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "UPDATE_FAILOVER_CONFIG",
          config: { failoverEnabled: newValue, piLocalUrl: piLocalUrl || null },
        });
      }
    }
    setFailoverLoading(false);
  };

  const handleSavePiLocalUrl = async () => {
    const res = await apiCall("setPiLocalUrl", { url: piLocalUrl.replace(/\/+$/, "") });
    if (res && res.ok) {
      setPiLocalUrlSaved(true);
      setTimeout(() => setPiLocalUrlSaved(false), 2000);
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "UPDATE_FAILOVER_CONFIG",
          config: { piLocalUrl: piLocalUrl || null },
        });
      }
    }
  };

  if (role !== "admin") {
    return <p className="py-10 text-center text-brand-green-dark/50">Only admins can manage server sync.</p>;
  }

  const buildsMatch = status.cloudflare.build === status.pi.build;

  return (
    <div className="space-y-8">
      {apiAvailable === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Sync API not available — showing mock data. The <code className="rounded bg-amber-100 px-1 text-xs">/api/sync</code> endpoint is not yet deployed.
            </p>
          </div>
        </div>
      )}

      {/* Section A: Connection Status */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-brand-green-dark">Connection Status</h3>
          <button
            type="button"
            onClick={loadStatus}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-brand-green/10 px-3 py-1.5 text-xs font-medium text-brand-green transition-colors hover:bg-brand-green/20 disabled:opacity-50"
          >
            <RefreshCwIcon className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ServerCard
            label="Cloudflare"
            sublabel={status.primaryServer === "cloudflare" ? "Primary" : undefined}
            icon={<CloudIcon className="h-5 w-5 text-blue-500" />}
            server={status.cloudflare}
          />
          <ServerCard
            label="Raspberry Pi"
            sublabel={status.primaryServer === "pi" ? "Primary" : undefined}
            icon={<CpuIcon className="h-5 w-5 text-purple-500" />}
            server={status.pi}
          />
        </div>

        {!status.pi.online && status.runtime !== "pi" && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Cloudflare cannot reach the Pi public URL (tunnel down). The Pi app may still be running on hostel Wi‑Fi. Restart <span className="font-mono">cloudflared</span> on the Pi to bring it back.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            {status.internetConnected
              ? <WifiIcon className="h-5 w-5 text-emerald-500" />
              : <WifiOffIcon className="h-5 w-5 text-red-500" />}
            <div>
              <p className="text-sm font-medium text-brand-green-dark">Internet</p>
              <p className={cn("text-xs", status.internetConnected ? "text-emerald-600" : "text-red-600")}>
                {status.internetConnected ? "Connected" : "Disconnected"}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            <div className="flex items-center gap-3">
              <ServerIcon className="h-5 w-5 text-brand-green" />
              <div>
                <p className="text-sm font-medium text-brand-green-dark">Primary Server</p>
                <p className="text-xs text-brand-green-dark/60 capitalize">{status.primaryServer}</p>
              </div>
            </div>
            {confirmSwitch ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSwitchPrimary}
                  className="rounded-lg bg-brand-green px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-brand-green-dark"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSwitch(false)}
                  className="rounded-lg bg-brand-mist px-2.5 py-1 text-[10px] font-semibold text-brand-green-dark/60 hover:bg-brand-mist/80"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmSwitch(true)}
                className="rounded-lg border border-brand-mist px-2.5 py-1 text-[10px] font-medium text-brand-green-dark/60 hover:bg-brand-sand/50"
              >
                Switch
              </button>
            )}
          </div>
        </div>

        {!buildsMatch && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950 p-3">
            <AlertTriangleIcon className="h-4 w-4 text-amber-600" />
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Build mismatch — Cloudflare: <code className="rounded bg-amber-100 px-1">{status.cloudflare.build}</code> vs Pi: <code className="rounded bg-amber-100 px-1">{status.pi.build}</code>
            </p>
          </div>
        )}

        {buildsMatch && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950 p-3">
            <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Builds match: <code className="rounded bg-emerald-100 px-1">{status.cloudflare.build}</code></p>
          </div>
        )}

        {/* Pi Deploy, Tunnel & Shutdown Controls */}
        {(status.pi.online || status.runtime === "pi") && (
          <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DownloadIcon className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-brand-green-dark">Update Pi Build</p>
                  <p className="text-xs text-brand-green-dark/60">Pull latest code from GitHub, rebuild, and restart</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDeployUpdate}
                disabled={deploying}
                className="flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
              >
                {deploying ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                {deploying ? "Deploying..." : "Deploy Now"}
              </button>
            </div>
            {deployMessage && (
              <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 p-3">
                <p className="text-xs font-medium text-blue-800">{deployMessage}</p>
              </div>
            )}
          </div>
        )}

        {status.runtime === "pi" && (
          <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <WifiIcon className="h-5 w-5 text-purple-500" />
                <div>
                  <p className="text-sm font-medium text-brand-green-dark">Public tunnel</p>
                  <p className="text-xs text-brand-green-dark/60">Restart cloudflared so pi.gokohostel.com works from the internet</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRestartTunnel}
                disabled={restartingTunnel}
                className="flex items-center gap-1.5 rounded-lg border border-purple-200 px-3 py-1.5 text-[11px] font-medium text-purple-600 transition-colors hover:bg-purple-50 disabled:opacity-50"
              >
                {restartingTunnel ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <RefreshCwIcon className="h-3.5 w-3.5" />}
                {restartingTunnel ? "Restarting..." : "Restart tunnel"}
              </button>
            </div>
            {tunnelMessage && (
              <div className="mt-3 rounded-lg bg-purple-50 dark:bg-purple-950 border border-purple-200 p-3">
                <p className="text-xs font-medium text-purple-800">{tunnelMessage}</p>
              </div>
            )}
          </div>
        )}

        {status.pi.online && (
          <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PowerIcon className="h-5 w-5 text-red-400" />
                <div>
                  <p className="text-sm font-medium text-brand-green-dark">Raspberry Pi Power</p>
                  <p className="text-xs text-brand-green-dark/60">Safely shut down the Pi before unplugging power</p>
                </div>
              </div>
              {confirmShutdown ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleShutdownPi}
                    disabled={shuttingDown}
                    className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {shuttingDown ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <PowerIcon className="h-3 w-3" />}
                    Yes, Shut Down
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmShutdown(false)}
                    className="rounded-lg bg-brand-mist px-3 py-1.5 text-[11px] font-semibold text-brand-green-dark/60 hover:bg-brand-mist/80"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmShutdown(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950"
                >
                  <PowerIcon className="h-3.5 w-3.5" />
                  Shutdown Pi
                </button>
              )}
            </div>
            {shutdownMessage && (
              <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 p-3">
                <p className="text-xs font-medium text-amber-800">{shutdownMessage}</p>
              </div>
            )}
          </div>
        )}

        {/* Local DNS Failover */}
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldIcon className={cn("h-5 w-5", failoverActive ? "text-amber-500" : failoverEnabled ? "text-emerald-500" : "text-brand-green-dark/30")} />
              <div>
                <p className="text-sm font-medium text-brand-green-dark">Local DNS Failover</p>
                <p className="text-xs text-brand-green-dark/60">
                  {failoverActive
                    ? "Active — local traffic redirected to Pi (internet is down)"
                    : failoverEnabled
                    ? "Standby — will activate automatically if internet goes down"
                    : "Disabled — enable to auto-redirect traffic when internet drops"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {failoverActive && (
                <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">ACTIVE</span>
              )}
              <button
                type="button"
                onClick={handleToggleFailover}
                disabled={failoverLoading}
                className="text-brand-green transition-colors hover:text-brand-green-dark"
                aria-label="Toggle failover"
              >
                {failoverEnabled
                  ? <ToggleRightIcon className="h-6 w-6 text-brand-green" />
                  : <ToggleLeftIcon className="h-6 w-6 text-brand-green-dark/30" />}
              </button>
              <span className={cn("text-xs font-semibold", failoverEnabled ? "text-brand-green" : "text-brand-green-dark/40")}>
                {failoverEnabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
          {failoverEnabled && (
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs font-medium text-brand-green-dark/60 whitespace-nowrap">Pi Local URL:</label>
              <input
                type="text"
                value={piLocalUrl}
                onChange={(e) => { setPiLocalUrl(e.target.value); setPiLocalUrlSaved(false); }}
                placeholder="http://192.168.0.80"
                className="flex-1 rounded-lg border border-brand-mist px-2.5 py-1.5 text-xs text-brand-green-dark placeholder:text-brand-green-dark/30 focus:border-brand-green focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSavePiLocalUrl}
                className="rounded-lg bg-brand-green/10 px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/20"
              >
                {piLocalUrlSaved ? "Saved!" : "Save"}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Section B: Sync Controls */}
      <section className="space-y-4">
        <h3 className="font-display text-lg font-semibold text-brand-green-dark">Sync Controls</h3>

        <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 shadow-sm dark:shadow-none sm:p-6">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleSync("full")}
              disabled={syncing !== null}
              className="flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-green-dark disabled:opacity-50"
            >
              {syncing === "full" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <RefreshCwIcon className="h-3.5 w-3.5" />}
              Sync Now
            </button>
            <button
              type="button"
              onClick={() => handleSync("pull")}
              disabled={syncing !== null}
              className="flex items-center gap-1.5 rounded-lg border border-brand-mist px-4 py-2 text-xs font-medium text-brand-green-dark transition-colors hover:bg-brand-sand/50 disabled:opacity-50"
            >
              {syncing === "pull" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownIcon className="h-3.5 w-3.5" />}
              Pull Only
            </button>
            <button
              type="button"
              onClick={() => handleSync("push")}
              disabled={syncing !== null}
              className="flex items-center gap-1.5 rounded-lg border border-brand-mist px-4 py-2 text-xs font-medium text-brand-green-dark transition-colors hover:bg-brand-sand/50 disabled:opacity-50"
            >
              {syncing === "push" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpIcon className="h-3.5 w-3.5" />}
              Push Only
            </button>
          </div>

          <div className="mt-4 grid gap-3 text-xs text-brand-green-dark/60 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="font-medium text-brand-green-dark/80">Last sync:</span>{" "}
              {status.lastSync ? formatTimestamp(status.lastSync) : "Never"}
            </div>
            <div>
              <span className="font-medium text-brand-green-dark/80">Pulled:</span> {status.recordsPulled} records
            </div>
            <div>
              <span className="font-medium text-brand-green-dark/80">Pushed:</span> {status.recordsPushed} records
            </div>
            <div>
              <span className="font-medium text-brand-green-dark/80">Conflicts:</span> {status.conflicts}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-sand/50 p-3">
            <div>
              <p className="text-xs font-medium text-brand-green-dark">Pending local changes</p>
              <p className="text-lg font-bold text-brand-green-dark">{status.pendingChanges} <span className="text-xs font-normal text-brand-green-dark/50">records</span></p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-brand-green-dark/60">Auto-sync</span>
              <button
                type="button"
                onClick={handleToggleAutoSync}
                className="text-brand-green transition-colors hover:text-brand-green-dark"
                aria-label="Toggle auto-sync"
              >
                {status.autoSync
                  ? <ToggleRightIcon className="h-6 w-6 text-brand-green" />
                  : <ToggleLeftIcon className="h-6 w-6 text-brand-green-dark/30" />}
              </button>
              <span className={cn("text-xs font-semibold", status.autoSync ? "text-brand-green" : "text-brand-green-dark/40")}>
                {status.autoSync ? "ON" : "OFF"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Section C: Conflict Resolution */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-brand-green-dark">
            Conflicts {conflicts.length > 0 && <span className="ml-2 inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">{conflicts.length} unresolved</span>}
          </h3>
          {conflicts.length > 0 && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleBulkResolve("cloud")}
                className="rounded-lg bg-blue-50 dark:bg-blue-950 px-2.5 py-1 text-[10px] font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50"
              >
                Resolve All: Use Cloud
              </button>
              <button
                type="button"
                onClick={() => handleBulkResolve("pi")}
                className="rounded-lg bg-purple-50 dark:bg-purple-950 px-2.5 py-1 text-[10px] font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50"
              >
                Resolve All: Use Pi
              </button>
            </div>
          )}
        </div>

        {conflicts.length === 0 ? (
          <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-6 text-center shadow-sm dark:shadow-none">
            <CheckCircleIcon className="mx-auto h-8 w-8 text-emerald-400" />
            <p className="mt-2 text-sm font-medium text-brand-green-dark/60">No conflicts</p>
            <p className="mt-1 text-xs text-brand-green-dark/40">All records are in sync between servers.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {conflicts.map((conflict, idx) => (
              <div key={conflict.id} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4 shadow-sm dark:shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-brand-green-dark/50">#{idx + 1}</p>
                    <p className="text-sm font-medium text-brand-green-dark">
                      <span className="rounded bg-brand-sand px-1.5 py-0.5 text-xs font-mono">{conflict.table}</span>
                      <span className="ml-2">{conflict.identifier}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950 p-2">
                    <p className="font-semibold text-blue-700 dark:text-blue-400">Cloud</p>
                    {Object.entries(conflict.cloudValue).map(([key, val]) => (
                      <p key={key} className="text-blue-600">{key}: <span className="font-medium">{val}</span></p>
                    ))}
                  </div>
                  <div className="rounded-lg bg-purple-50 dark:bg-purple-950 p-2">
                    <p className="font-semibold text-purple-700 dark:text-purple-400">Pi</p>
                    {Object.entries(conflict.piValue).map(([key, val]) => (
                      <p key={key} className="text-purple-600">{key}: <span className="font-medium">{val}</span></p>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleResolveConflict(conflict.id, "cloud")}
                    className="rounded-lg bg-blue-100 dark:bg-blue-900/50 px-3 py-1.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/50"
                  >
                    Use Cloud
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveConflict(conflict.id, "pi")}
                    className="rounded-lg bg-purple-100 dark:bg-purple-900/50 px-3 py-1.5 text-[10px] font-semibold text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/50"
                  >
                    Use Pi
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section D: Sync Log */}
      <section className="space-y-4">
        <h3 className="font-display text-lg font-semibold text-brand-green-dark">Sync History</h3>

        <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-sm dark:shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-mist text-xs font-semibold uppercase tracking-wide text-brand-green-dark/50">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-center">Pulled</th>
                  <th className="px-4 py-3 text-center">Pushed</th>
                  <th className="px-4 py-3 text-center">Conflicts</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {syncLog.slice(0, logLimit).map((entry) => (
                  <tr key={entry.id} className="border-b border-brand-mist/50 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-brand-green-dark/70">
                      {formatTimestamp(entry.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-brand-green-dark">
                      {entry.type}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-brand-green-dark/70">
                      {entry.pulled > 0 && <span className="text-blue-600">{entry.pulled}↓</span>}
                      {entry.pulled === 0 && <span className="text-brand-green-dark/30">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-brand-green-dark/70">
                      {entry.pushed > 0 && <span className="text-purple-600">{entry.pushed}↑</span>}
                      {entry.pushed === 0 && <span className="text-brand-green-dark/30">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">
                      {entry.conflicts > 0
                        ? <span className="text-amber-600">{entry.conflicts}⚡</span>
                        : <span className="text-brand-green-dark/30">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {entry.status === "success" && <CheckCircleIcon className="mx-auto h-4 w-4 text-emerald-500" />}
                      {entry.status === "warning" && <AlertTriangleIcon className="mx-auto h-4 w-4 text-amber-500" />}
                      {entry.status === "error" && (
                        <span className="inline-flex items-center gap-1">
                          <XCircleIcon className="h-4 w-4 text-red-500" />
                          {entry.errorMessage && <span className="text-[10px] text-red-600">{entry.errorMessage}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {syncLog.length >= logLimit && (
            <div className="border-t border-brand-mist p-3 text-center">
              <button
                type="button"
                onClick={() => setLogLimit((prev) => prev + 20)}
                className="flex items-center gap-1 mx-auto text-xs font-medium text-brand-green hover:text-brand-green-dark"
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
                Load More
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ServerCard({ label, sublabel, icon, server }: { label: string; sublabel?: string; icon: React.ReactNode; server: ServerStatus }) {
  const lastSeenMs = server.lastSeen ? Date.now() - new Date(server.lastSeen).getTime() : Infinity;
  const isStale = lastSeenMs > 300000;
  const statusColor = !server.online ? "text-red-500" : isStale ? "text-amber-500" : "text-emerald-500";
  const statusLabel = !server.online
    ? (server.lastSeen ? "Unreachable" : "Offline")
    : isStale ? "Stale" : "Online";

  return (
    <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-brand-green-dark">{label}</p>
            {sublabel && <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-[10px] font-semibold text-brand-green">{sublabel}</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={cn("text-lg leading-none", statusColor)}>●</span>
            <span className={cn("text-xs font-medium", statusColor)}>{statusLabel}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-brand-sand/50 px-2 py-1.5">
          <p className="text-[10px] text-brand-green-dark/50">Build</p>
          <p className="text-xs font-mono font-medium text-brand-green-dark">{server.build}</p>
        </div>
        <div className="rounded-lg bg-brand-sand/50 px-2 py-1.5">
          <p className="text-[10px] text-brand-green-dark/50">{server.online ? "Records" : "Records (cached)"}</p>
          <p className="text-xs font-medium text-brand-green-dark">{server.records.toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-brand-sand/50 px-2 py-1.5">
          <p className="text-[10px] text-brand-green-dark/50">Last seen</p>
          <p className="text-xs font-medium text-brand-green-dark">{timeAgo(server.lastSeen)}</p>
        </div>
      </div>
    </div>
  );
}
