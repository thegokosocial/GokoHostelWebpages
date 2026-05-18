"use client";

import { useState, useEffect, useRef } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { RefreshCwIcon, EyeIcon, HardDriveIcon, TableIcon, ActivityIcon, AlertTriangleIcon } from "lucide-react";

type StatRow = {
  month: string;
  vision: number;
  sheets: number;
  drive: number;
  totalCalls: number;
};

const VISION_FREE_TIER = 1000;

export function AdminStats({ password }: { password: string }) {
  const { apiCall } = useAdminApi(password);
  const apiRef = useRef(apiCall);
  apiRef.current = apiCall;
  const [stats, setStats] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRef.current({ action: "getStats" });
      if (res.ok) {
        const d = await res.json();
        setStats(d.stats || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const currentMonth = stats.length > 0 ? stats[stats.length - 1] : null;
  const visionUsedPct = currentMonth ? Math.min(100, (currentMonth.vision / VISION_FREE_TIER) * 100) : 0;
  const totalVision = stats.reduce((sum, r) => sum + r.vision, 0);
  const totalSheets = stats.reduce((sum, r) => sum + r.sheets, 0);
  const totalDrive = stats.reduce((sum, r) => sum + r.drive, 0);
  const totalAll = stats.reduce((sum, r) => sum + r.totalCalls, 0);

  if (loading && stats.length === 0) {
    return <AdminLoading message="Loading stats..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-brand-green-dark">API Usage Statistics</h2>
        <button type="button" onClick={load} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-brand-sand px-3 py-1.5 text-xs font-medium text-brand-green-dark/70 hover:bg-brand-sand/80 disabled:opacity-50">
          <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Current Month Highlight */}
      {currentMonth && (
        <div className="rounded-2xl border border-brand-mist bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">
            Current Month — {currentMonth.month}
          </h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              icon={<EyeIcon className="h-5 w-5 text-purple-500" />}
              label="Vision AI"
              value={currentMonth.vision}
              limit={VISION_FREE_TIER}
            />
            <StatCard
              icon={<TableIcon className="h-5 w-5 text-green-500" />}
              label="Sheets"
              value={currentMonth.sheets}
            />
            <StatCard
              icon={<HardDriveIcon className="h-5 w-5 text-blue-500" />}
              label="Drive"
              value={currentMonth.drive}
            />
            <StatCard
              icon={<ActivityIcon className="h-5 w-5 text-orange-500" />}
              label="Total"
              value={currentMonth.totalCalls}
            />
          </div>

          {/* Vision API Progress Bar */}
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-purple-700">Vision AI Free Tier Usage</span>
              <span className="font-bold text-purple-900">{currentMonth.vision} / {VISION_FREE_TIER}</span>
            </div>
            <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-purple-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${visionUsedPct > 80 ? "bg-red-500" : visionUsedPct > 50 ? "bg-yellow-500" : "bg-purple-500"}`}
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

      {/* Lifetime Summary */}
      <div className="rounded-2xl border border-brand-mist bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">
          Lifetime Totals
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Vision AI" value={totalVision} />
          <MiniStat label="Sheets" value={totalSheets} />
          <MiniStat label="Drive" value={totalDrive} />
          <MiniStat label="All APIs" value={totalAll} />
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <div className="rounded-2xl border border-brand-mist bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">
          Monthly Breakdown
        </h3>
        {stats.length === 0 ? (
          <p className="text-sm text-brand-green-dark/50">No usage data recorded yet. Stats will appear after the first API call.</p>
        ) : (
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
                {[...stats].reverse().map((row) => (
                  <tr key={row.month} className="border-b border-brand-mist/50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-brand-green-dark">{row.month}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${row.vision > 800 ? "bg-red-100 text-red-700" : row.vision > 500 ? "bg-yellow-100 text-yellow-700" : "bg-purple-100 text-purple-700"}`}>
                        {row.vision}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-brand-green-dark/70">{row.sheets}</td>
                    <td className="py-2.5 pr-4 text-right text-brand-green-dark/70">{row.drive}</td>
                    <td className="py-2.5 text-right font-semibold text-brand-green-dark">{row.totalCalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="rounded-xl bg-brand-sand/50 p-4 text-xs text-brand-green-dark/60">
        <p className="font-medium">How tracking works:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li><strong>Vision AI</strong> — Each document validation call (image or PDF page) counts as 1 unit. Free tier: {VISION_FREE_TIER}/month.</li>
          <li><strong>Sheets</strong> — Each check-in submission that writes to Google Sheets counts as 1 unit.</li>
          <li><strong>Drive</strong> — Each file uploaded to Google Drive counts as 1 unit.</li>
          <li>Stats are tracked per calendar month and stored in the &quot;ApiStats&quot; tab of your Google Sheet.</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, limit }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  limit?: number;
}) {
  return (
    <div className="rounded-xl border border-brand-mist/50 bg-brand-sand/30 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-brand-green-dark/60">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-brand-green-dark">{value.toLocaleString()}</p>
      {limit && <p className="mt-0.5 text-[10px] text-brand-green-dark/40">of {limit.toLocaleString()} free</p>}
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
