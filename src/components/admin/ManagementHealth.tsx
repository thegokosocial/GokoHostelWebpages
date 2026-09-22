"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCwIcon, CheckCircle2Icon, XCircleIcon, Loader2Icon, LinkIcon,
  EyeIcon, HardDriveIcon, TableIcon, ActivityIcon, AlertTriangleIcon,
} from "lucide-react";
import type { Role } from "./types";

type ServiceStatus = {
  name: string;
  status: "ok" | "error" | "checking";
  message?: string;
  lastChecked?: string;
};

type StatRow = {
  month: string;
  vision: number;
  sheets: number;
  drive: number;
  total: number;
};

const VISION_FREE_TIER = 1000;

const MONTH_ORDER = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

function sortStatsChronologically(stats: StatRow[]): StatRow[] {
  return [...stats].sort((a, b) => {
    const [aMonth, aYear] = a.month.split("-");
    const [bMonth, bYear] = b.month.split("-");
    const yearDiff = parseInt(aYear) - parseInt(bYear);
    if (yearDiff !== 0) return yearDiff;
    return MONTH_ORDER.indexOf(aMonth) - MONTH_ORDER.indexOf(bMonth);
  });
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${MONTH_ORDER[now.getUTCMonth()]}-${now.getUTCFullYear()}`;
}

export function ManagementHealth({ password, role }: { password: string; role: Role }) {
  const passwordRef = useRef(password);
  passwordRef.current = password;

  const [services, setServices] = useState<ServiceStatus[]>([
    { name: "D1 Database", status: "checking" },
    { name: "Google Drive", status: "checking" },
    { name: "Vision API", status: "checking" },
    { name: "Gmail", status: "checking" },
  ]);
  const [checking, setChecking] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [stats, setStats] = useState<StatRow[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const apiCall = (body: Record<string, any>) =>
    fetch("/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordRef.current, ...body }),
    });

  const runHealthCheck = async () => {
    setChecking(true);
    setServices((prev) => prev.map((s) => ({ ...s, status: "checking" as const })));
    try {
      const res = await apiCall({ action: "healthCheck" });
      const data = await res.json();
      if (data.results) {
        const now = new Date().toLocaleTimeString();
        setServices([
          { name: "D1 Database", status: data.results.d1.status, message: data.results.d1.message, lastChecked: now },
          { name: "Google Drive", status: data.results.drive.status, message: data.results.drive.message, lastChecked: now },
          { name: "Vision API", status: data.results.vision.status, message: data.results.vision.message, lastChecked: now },
          { name: "Gmail", status: data.results.gmail.status, message: data.results.gmail.message, lastChecked: now },
        ]);
      }
    } catch {
      setServices((prev) => prev.map((s) => ({ ...s, status: "error" as const, message: "Health check failed" })));
    } finally {
      setChecking(false);
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await apiCall({ action: "getStats" });
      if (res.ok) {
        const d = await res.json();
        setStats(d.stats || []);
      }
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    runHealthCheck();
    loadStats();
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_success") === "true") {
      setSuccessMsg("Google account reconnected successfully!");
      params.delete("oauth_success");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
    const oauthErr = params.get("oauth_error");
    if (oauthErr) {
      setErrorMsg(`Google reconnect failed: ${oauthErr.replace(/_/g, " ")}`);
      params.delete("oauth_error");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, []);

  const hasOAuthError = services.some(
    (s) =>
      (s.name === "Google Drive" || s.name === "Gmail") &&
      s.status === "error" &&
      (s.message?.toLowerCase().includes("oauth") ||
        s.message?.toLowerCase().includes("token") ||
        s.message?.toLowerCase().includes("reconnect"))
  );

  const handleReconnect = () => {
    window.location.href = "/api/auth/google/start";
  };

  const sortedStats = sortStatsChronologically(stats);
  const currentMonthKey = getCurrentMonthKey();
  const currentMonth = stats.find((s) => s.month === currentMonthKey) || (sortedStats.length > 0 ? sortedStats[sortedStats.length - 1] : null);
  const visionUsedPct = currentMonth ? Math.min(100, (currentMonth.vision / VISION_FREE_TIER) * 100) : 0;
  const totalVision = stats.reduce((sum, r) => sum + r.vision, 0);
  const totalSheets = stats.reduce((sum, r) => sum + r.sheets, 0);
  const totalDrive = stats.reduce((sum, r) => sum + r.drive, 0);
  const totalAll = stats.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="space-y-8">
      {/* === SERVICE HEALTH === */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-brand-green-dark">Service Health</h3>
          <button
            type="button"
            onClick={runHealthCheck}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-lg bg-brand-green/10 px-3 py-1.5 text-xs font-medium text-brand-green transition-colors hover:bg-brand-green/20 disabled:opacity-50"
          >
            <RefreshCwIcon className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
            Check Now
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => (
            <div key={service.name} className="flex items-start gap-3 rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
              <div className="mt-0.5">
                {service.status === "checking" && <Loader2Icon className="h-5 w-5 animate-spin text-brand-green/50" />}
                {service.status === "ok" && <CheckCircle2Icon className="h-5 w-5 text-emerald-500" />}
                {service.status === "error" && <XCircleIcon className="h-5 w-5 text-red-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-green-dark">{service.name}</p>
                <p className={cn(
                  "mt-0.5 text-xs",
                  service.status === "ok" && "text-emerald-600",
                  service.status === "error" && "text-red-600",
                  service.status === "checking" && "text-brand-green-dark/50",
                )}>
                  {service.status === "checking" && "Checking..."}
                  {service.status === "ok" && "Connected"}
                  {service.status === "error" && (service.message || "Connection failed")}
                </p>
                {service.lastChecked && (
                  <p className="mt-1 text-[10px] text-brand-green-dark/40">Last checked: {service.lastChecked}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {successMsg && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{successMsg}</p>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">{errorMsg}</p>
          </div>
        )}

        {hasOAuthError && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4">
            <div className="flex items-start gap-3">
              <LinkIcon className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Google OAuth token expired or missing</p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Click below to reconnect your Google account. This will fix both Drive and Gmail.
                </p>
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="mt-3 rounded-lg bg-brand-green px-4 py-2 text-xs font-semibold text-white shadow-sm dark:shadow-none transition-colors hover:bg-brand-green-dark"
                >
                  Reconnect Google
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-brand-mist bg-brand-sand/30 p-4">
          <p className="text-xs text-brand-green-dark/60">
            <strong>Note:</strong> Vision API uses a service account (auto-renewing).
            Drive & Gmail share the same OAuth token — reconnecting fixes both.
          </p>
        </div>
      </section>

      {/* === API USAGE STATS === */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-brand-green-dark">API Usage</h3>
          <button type="button" onClick={loadStats} disabled={statsLoading}
            className="flex items-center gap-1.5 rounded-lg bg-brand-sand px-3 py-1.5 text-xs font-medium text-brand-green-dark/70 hover:bg-brand-sand/80 disabled:opacity-50">
            <RefreshCwIcon className={cn("h-3.5 w-3.5", statsLoading && "animate-spin")} /> Refresh
          </button>
        </div>

        {currentMonth && (
          <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-6 shadow-sm dark:shadow-none">
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">
              Current Month — {currentMonth.month}
            </h4>
            <div className="grid gap-4 sm:grid-cols-4">
              <StatCard icon={<EyeIcon className="h-5 w-5 text-purple-500" />} label="Vision AI" value={currentMonth.vision} limit={VISION_FREE_TIER} />
              <StatCard icon={<TableIcon className="h-5 w-5 text-green-500" />} label="Sheets" value={currentMonth.sheets} />
              <StatCard icon={<HardDriveIcon className="h-5 w-5 text-blue-500" />} label="Drive" value={currentMonth.drive} />
              <StatCard icon={<ActivityIcon className="h-5 w-5 text-orange-500" />} label="Total" value={currentMonth.total} />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-purple-700 dark:text-purple-400">Vision AI Free Tier Usage</span>
                <span className="font-bold text-purple-900 dark:text-purple-300">{currentMonth.vision} / {VISION_FREE_TIER}</span>
              </div>
              <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-purple-100 dark:bg-purple-900/50">
                <div
                  className={cn("h-full rounded-full transition-all duration-500",
                    visionUsedPct > 80 ? "bg-red-500" : visionUsedPct > 50 ? "bg-yellow-500" : "bg-purple-500"
                  )}
                  style={{ width: `${visionUsedPct}%` }}
                />
              </div>
              {visionUsedPct > 80 && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                  <AlertTriangleIcon className="h-3.5 w-3.5" />
                  <span>Approaching free tier limit! Consider disabling auto-validation.</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-6 shadow-sm dark:shadow-none">
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">
            Lifetime Totals
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Vision AI" value={totalVision} />
            <MiniStat label="Sheets" value={totalSheets} />
            <MiniStat label="Drive" value={totalDrive} />
            <MiniStat label="All APIs" value={totalAll} />
          </div>
        </div>

        {stats.length > 0 && (
          <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-6 shadow-sm dark:shadow-none">
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">
              Monthly Breakdown
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-mist text-xs font-semibold uppercase tracking-wide text-brand-green-dark/50">
                    <th className="pb-2 pr-4">Month</th>
                    <th className="pb-2 pr-4 text-right">Vision AI</th>
                    <th className="pb-2 pr-4 text-right">Sheets</th>
                    <th className="pb-2 pr-4 text-right">Drive</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sortedStats].reverse().map((row) => (
                    <tr key={row.month} className="border-b border-brand-mist/50 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-brand-green-dark">{row.month}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                          row.vision > 800 ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400" : row.vision > 500 ? "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400" : "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400"
                        )}>
                          {row.vision}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-brand-green-dark/70">{row.sheets}</td>
                      <td className="py-2.5 pr-4 text-right text-brand-green-dark/70">{row.drive}</td>
                      <td className="py-2.5 text-right font-semibold text-brand-green-dark">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, limit }: { icon: React.ReactNode; label: string; value: number; limit?: number }) {
  return (
    <div className="rounded-xl border border-brand-mist/50 bg-brand-sand/30 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-brand-green-dark/60">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-brand-green-dark">{value.toLocaleString()}</p>
      {limit !== undefined && <p className="mt-0.5 text-[10px] text-brand-green-dark/40">of {limit.toLocaleString()} free</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-brand-sand/50 p-3 text-center">
      <p className="text-lg font-bold text-brand-green-dark">{value.toLocaleString()}</p>
      <p className="text-[10px] font-medium text-brand-green-dark/50">{label}</p>
    </div>
  );
}
