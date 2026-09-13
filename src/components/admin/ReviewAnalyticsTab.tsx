"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2Icon, RefreshCwIcon, StarIcon, SendIcon, ExternalLinkIcon, MessageSquareIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Analytics {
  totalRequests: number;
  totalSent: number;
  totalRated: number;
  googleRedirects: number;
  feedbackSubmissions: number;
  responseRate: number;
  ratingDistribution: number[];
  improvementAreas: Record<string, number>;
}

interface Props {
  password: string;
  username: string;
  onNavigateToResponses?: () => void;
}

export function ReviewAnalyticsTab({ password, username, onNavigateToResponses }: Props) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    const res = await fetch("/api/admin/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res;
  }, [password, username]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { action: "getAnalytics" };
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      if (propertyFilter) params.property = propertyFilter;
      const res = await apiCall(params);
      if (res.ok) setAnalytics(await res.json());
    } catch {}
    setLoading(false);
  }, [apiCall, fromDate, toDate, propertyFilter]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-brand-green" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center">
        <p className="text-sm text-brand-green-dark/50">Failed to load analytics.</p>
      </div>
    );
  }

  const maxRating = Math.max(...analytics.ratingDistribution, 1);
  const sortedAreas = Object.entries(analytics.improvementAreas).sort((a, b) => b[1] - a[1]);
  const maxAreaCount = sortedAreas.length > 0 ? sortedAreas[0][1] : 1;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="min-w-0 w-full rounded-md border border-brand-mist px-2 py-1.5 text-xs sm:w-auto"
          />
          <span className="hidden text-xs text-brand-green-dark/50 sm:inline">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="min-w-0 w-full rounded-md border border-brand-mist px-2 py-1.5 text-xs sm:w-auto"
          />
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="col-span-2 min-w-0 w-full rounded-md border border-brand-mist px-2 py-1.5 text-xs sm:col-span-1 sm:w-auto"
          >
            <option value="">All Properties</option>
            <option value="goko_hostel">Goko Hostel</option>
            <option value="sunnys_paradise">Sunny&apos;s Paradise</option>
          </select>
          <button
            type="button"
            onClick={loadAnalytics}
            className="justify-self-end rounded-lg p-2 text-brand-green-dark/60 hover:bg-brand-green/[0.06] sm:ml-auto"
            title="Refresh"
          >
            <RefreshCwIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard icon={<SendIcon className="h-4 w-4 text-blue-600" />} label="Requests Sent" value={analytics.totalSent} bgClass="bg-blue-50 dark:bg-blue-950" />
        <MetricCard icon={<StarIcon className="h-4 w-4 text-amber-600" />} label="Ratings Received" value={analytics.totalRated} bgClass="bg-amber-50 dark:bg-amber-950" />
        <MetricCard icon={<ExternalLinkIcon className="h-4 w-4 text-green-600" />} label="Google Redirects" value={analytics.googleRedirects} bgClass="bg-green-50 dark:bg-green-950" onClick={() => window.open("https://search.google.com/local/reviews?placeid=ChIJ0VfULgOBvjsRiCk-2gxFE4I", "_blank")} />
        <MetricCard icon={<MessageSquareIcon className="h-4 w-4 text-red-600" />} label="Feedback Submitted" value={analytics.feedbackSubmissions} bgClass="bg-red-50 dark:bg-red-950" onClick={onNavigateToResponses} />
        <MetricCard icon={<TrendingUpIcon className="h-4 w-4 text-purple-600" />} label="Response Rate" value={`${analytics.responseRate}%`} bgClass="bg-purple-50 dark:bg-purple-950" />
      </div>

      {/* Rating Distribution */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
        <h3 className="font-display text-sm font-bold text-brand-green-dark mb-3">Rating Distribution</h3>
        <div className="space-y-2">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = analytics.ratingDistribution[star - 1];
            const pct = maxRating > 0 ? (count / maxRating) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="w-8 text-right text-xs font-medium text-brand-green-dark/70">{star}★</span>
                <div className="flex-1 h-5 rounded-full bg-gray-100 dark:bg-[#1c1c1c] overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      star >= 4 ? "bg-emerald-500" : star === 3 ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-8 text-xs text-brand-green-dark/60">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Improvement Areas */}
      {sortedAreas.length > 0 && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <h3 className="font-display text-sm font-bold text-brand-green-dark mb-3">Improvement Areas (from negative feedback)</h3>
          <div className="space-y-2">
            {sortedAreas.map(([area, count]) => {
              const pct = (count / maxAreaCount) * 100;
              return (
                <div key={area} className="flex items-center gap-2">
                  <span className="min-w-0 w-28 truncate text-xs font-medium text-brand-green-dark/70">{area}</span>
                  <div className="flex-1 h-5 rounded-full bg-gray-100 dark:bg-[#1c1c1c] overflow-hidden">
                    <div className="h-full rounded-full bg-red-400 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-xs text-brand-green-dark/60">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, bgClass, onClick }: { icon: React.ReactNode; label: string; value: number | string; bgClass: string; onClick?: () => void }) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("rounded-xl border border-brand-mist bg-white dark:bg-card p-3 text-left", onClick && "cursor-pointer hover:shadow-soft dark:hover:shadow-none transition-shadow")}
    >
      <div className={cn("inline-flex rounded-lg p-2", bgClass)}>{icon}</div>
      <p className="mt-2 text-xl font-bold text-brand-green-dark">{value}</p>
      <p className="text-xs text-brand-green-dark/50">{label}</p>
    </Wrapper>
  );
}
