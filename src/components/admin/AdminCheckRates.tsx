"use client";

import { useState, useEffect, useRef } from "react";
import { useAdminApi } from "./useAdminApi";
import { useAdminToast } from "@/components/admin/AdminToast";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { cn, localDateStr, todayIST } from "@/lib/utils";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import type { Role } from "./types";

import { estimateRateScrapeMinutes, parseRateResults, rateScrapeDates, type RateResult } from "@/lib/rateScrapeResults";

const POLL_MS = 10_000;
const STUCK_PENDING_MS = 12 * 60_000;
const LONG_RANGE_NIGHTS = 14;
const ACTIONS_URL = "https://github.com/thegokosocial/GokoHostelWebpages/actions/workflows/scrape-rates.yml";

type ScrapeData = {
  id: number;
  city: string;
  startDate: string;
  endDate: string;
  propertyType: string;
  status: string;
  results: RateResult[];
  failedDates?: string[];
  legacy?: boolean;
  createdAt: string;
  completedAt: string;
};

function applyScrapePayload(scrape: Record<string, unknown>): ScrapeData {
  const parsed = parseRateResults(scrape.results);
  return {
    ...(scrape as unknown as ScrapeData),
    results: parsed.properties,
    failedDates: parsed.failedDates,
    legacy: parsed.legacy,
  };
}

export function AdminCheckRates({ password, username, role: _role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const { showError, showApiError } = useAdminToast();
  const [loading, setLoading] = useState(false);
  const [scrapeData, setScrapeData] = useState<ScrapeData | null>(null);
  const [scraping, setScraping] = useState(false);
  const [polling, setPolling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scrapeIdRef = useRef<number | null>(null);

  const [city, setCity] = useState("Gokarna");
  const [startDate, setStartDate] = useState(localDateStr(new Date()));
  const [endDate, setEndDate] = useState(
    localDateStr(new Date(Date.now() + 7 * 86400000))
  );
  const [propertyType, setPropertyType] = useState("hostels");
  const [proxyUrl, setProxyUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    scrapeIdRef.current = scrapeData?.id ?? null;
  }, [scrapeData?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadLatest = async () => {
      setLoading(true);
      setScrapeData(null);
      try {
        const res = await apiCall({ action: "getLatestRateScrape", city });
        if (!res.ok) throw new Error("Failed to load rates");
        const d = await res.json();
        if (cancelled) return;
        if (d.scrape) setScrapeData(applyScrapePayload(d.scrape));
      } catch {
        if (!cancelled) showError("Failed to load rates");
      } finally { if (!cancelled) setLoading(false); }
    };
    void loadLatest();
    return () => { cancelled = true; };
    // useAdminApi returns a new function each render; refetch only when its inputs or city change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, password, username]);

  const pollStatus = async (opts?: { silent?: boolean }) => {
    const id = scrapeIdRef.current;
    if (id == null) return;
    setPolling(true);
    try {
      const res = await apiCall({ action: "getRateScrapeStatus", scrapeId: id });
      if (res.ok) {
        const d = await res.json();
        if (d.scrape) setScrapeData(applyScrapePayload(d.scrape));
      } else if (!opts?.silent) {
        const d = await res.json().catch(() => ({}));
        showApiError({ response: res, data: d, action: "getRateScrapeStatus", endpoint: "/api/admin/checkins" }, "Could not check scrape status.");
      }
    } catch {
      if (!opts?.silent) showError("Could not check scrape status.");
    } finally {
      setPolling(false);
      setNow(Date.now());
    }
  };

  // Auto-poll while the Action is queued or running.
  useEffect(() => {
    if (!scrapeData || !["pending", "in_progress"].includes(scrapeData.status)) return;
    const tick = window.setInterval(() => {
      void pollStatus({ silent: true });
    }, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrapeData?.id, scrapeData?.status, password, username]);

  const startScrape = async () => {
    setScraping(true);
    try {
      const scraperKey = proxyUrl.trim();
      const fullProxyUrl = scraperKey ? `http://scraperapi:${scraperKey}@proxy-server.scraperapi.com:8001` : undefined;
      const res = await apiCall({ action: "startRateScrape", city, startDate, endDate, propertyType, proxyUrl: fullProxyUrl });
      if (res.ok) {
        const d = await res.json();
        setScrapeData({ id: d.id, city, startDate, endDate, propertyType, status: "pending", results: [], createdAt: new Date().toISOString(), completedAt: "" });
        setNow(Date.now());
      } else {
        const d = await res.json();
        showApiError({ response: res, data: d, action: "startRateScrape", endpoint: "/api/admin/checkins" }, "Could not start the rate scrape.");
      }
    } finally { setScraping(false); }
  };

  const dates = rateScrapeDates(scrapeData?.startDate || startDate, scrapeData?.endDate || endDate);
  const nightCount = dates.length;
  const etaMinutes = estimateRateScrapeMinutes(nightCount);
  const pendingStuck = !!scrapeData
    && scrapeData.status === "pending"
    && now - new Date(scrapeData.createdAt).getTime() >= STUCK_PENDING_MS;
  const selectedNights = rateScrapeDates(startDate, endDate).length;

  if (loading) return <AdminLoading message="Loading rates..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Check Rates</h2>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-sm dark:shadow-none">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">City</label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Gokarna" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Date range</label>
            <DateRangePicker
              variant="admin"
              minDate={todayIST()}
              startDate={startDate}
              endDate={endDate}
              onChange={({ startDate: nextStart, endDate: nextEnd }) => {
                setStartDate(nextStart);
                setEndDate(nextEnd);
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Property Type</label>
            <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="hostels">Hostels</option>
              <option value="hotels">Hotels</option>
              <option value="guesthouses">Guesthouses</option>
              <option value="homestays">Homestays</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="cta" className="w-full" onClick={startScrape} disabled={scraping || !city || !startDate || !endDate}>
              {scraping ? <><Loader2Icon className="mr-1 h-4 w-4 animate-spin" /> Starting...</> : "Scrape Rates"}
            </Button>
          </div>
        </div>

        {selectedNights > LONG_RANGE_NIGHTS && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            {selectedNights} nights selected — scrape may take ~{estimateRateScrapeMinutes(selectedNights)} minutes. Prefer a shorter range for a quicker check.
          </p>
        )}

        {/* Advanced settings */}
        <div className="mt-3 border-t border-brand-mist pt-3">
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-[11px] font-medium text-brand-green-dark/40 hover:text-brand-green">
            {showAdvanced ? "Hide" : "Show"} advanced settings
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-2">
              <label className="mb-1 block text-[10px] font-medium text-brand-green-dark/50">ScraperAPI Key (optional — use if scraping gets blocked)</label>
              <Input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="Paste your ScraperAPI key here"
                className="text-xs"
              />
              <div className="rounded-lg bg-brand-sand/50 p-2.5 text-[9px] text-brand-green-dark/50">
                <p className="font-medium">How to get a key (free, 2 minutes):</p>
                <ol className="mt-1 list-inside list-decimal space-y-0.5">
                  <li>Go to <a href="https://www.scraperapi.com/signup" target="_blank" rel="noopener" className="text-brand-green underline">scraperapi.com/signup</a> — sign up (free, 5000 requests included)</li>
                  <li>Copy your API key from the dashboard</li>
                  <li>Paste it above</li>
                </ol>
                <p className="mt-1">Leave empty if scraping works without it. Only needed if Booking.com blocks the request.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      {scrapeData && (
        <div className={cn("rounded-xl p-4 text-sm",
          scrapeData.status === "pending" && "bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400",
          scrapeData.status === "in_progress" && "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400",
          (scrapeData.status === "done" || scrapeData.status === "partial") && "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400",
          scrapeData.status === "failed" && "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400",
        )}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              {scrapeData.status === "pending" && !pendingStuck && (
                <p>
                  Scrape queued. The GitHub Action will start shortly
                  {nightCount > 0 ? ` (~${etaMinutes} min for ${nightCount} night${nightCount === 1 ? "" : "s"})` : ""}.
                  Status refreshes automatically.
                </p>
              )}
              {scrapeData.status === "pending" && pendingStuck && (
                <p>
                  Still queued after ~{Math.round(STUCK_PENDING_MS / 60_000)} minutes — the Action may not be reporting back.
                  Check{" "}
                  <a href={ACTIONS_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                    GitHub Actions → Scrape Booking.com Rates
                  </a>
                  {" "}and repo secrets <code className="text-[11px]">API_URL</code> / <code className="text-[11px]">API_PASSWORD</code>
                  {" "}(password must match Worker <code className="text-[11px]">ADMIN_PASSWORD</code>).
                </p>
              )}
              {scrapeData.status === "in_progress" && (
                <p>
                  Scrape in progress… fetching rates from Booking.com
                  {nightCount > 0 ? ` (~${etaMinutes} min for ${nightCount} night${nightCount === 1 ? "" : "s"})` : ""}.
                </p>
              )}
              {scrapeData.status === "done" && <p>Scrape completed at {new Date(scrapeData.completedAt).toLocaleString()} — showing {scrapeData.results.length} properties.</p>}
              {scrapeData.status === "partial" && <p>Scrape partially completed. Some prices could not be verified.</p>}
              {!!scrapeData.failedDates?.length && <p>Incomplete dates: {scrapeData.failedDates.join(", ")}</p>}
              {scrapeData.status === "failed" && (
                <p>
                  Scrape failed. Check{" "}
                  <a href={ACTIONS_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                    Actions logs
                  </a>
                  {" "}— auth preflight or callback 401 usually means repo secret{" "}
                  <code className="text-[11px]">API_PASSWORD</code> no longer matches Worker{" "}
                  <code className="text-[11px]">ADMIN_PASSWORD</code>.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(scrapeData.status === "pending" || scrapeData.status === "in_progress") && (
                <Button type="button" variant="ctaOutline" onClick={() => void pollStatus()} disabled={polling}>
                  {polling ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCwIcon className="mr-1 h-3.5 w-3.5" />}
                  Check Status
                </Button>
              )}
              {scrapeData.status === "failed" && (
                <Button type="button" variant="cta" onClick={startScrape} disabled={scraping}>
                  {scraping ? "Retrying..." : "Retry Scrape"}
                </Button>
              )}
              {(scrapeData.status === "done" || scrapeData.status === "partial") && (
                <Button type="button" variant="ctaOutline" onClick={startScrape} disabled={scraping}>
                  {scraping ? "Starting..." : "New Scrape"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results Grid */}
      {scrapeData && ["done", "partial", "failed"].includes(scrapeData.status) && scrapeData.results.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-sm dark:shadow-none">
          <p className="px-4 py-3 text-xs text-brand-green-dark/70">
            {scrapeData.startDate} to {scrapeData.endDate} (checkout exclusive). INR · 1 adult · 0 children · 1 room · 1 night.
            {scrapeData.legacy ? " Historical scrape: verification evidence unavailable." : " Signed-out desktop Booking.com prices; separately listed taxes excluded. Hover over a price for captured card details."}
            {" — means no verified observation, not necessarily sold out. First 20 search results per date."}
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-mist bg-brand-sand/50">
                <th className="sticky left-0 z-10 bg-brand-sand/50 px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Property</th>
                {dates.map((d) => (
                  <th key={d} className="px-3 py-3 text-center text-[10px] font-bold text-brand-green-dark/70">
                    {new Date(d).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scrapeData.results.map((r, i) => (
                <tr key={i} className={cn("border-b border-brand-mist/50 last:border-0",
                  r.property.toLowerCase().includes("goko") && "bg-brand-green/[0.04] font-semibold"
                )}>
                  <td className="sticky left-0 z-10 bg-white dark:bg-card px-4 py-3 text-xs font-medium text-brand-green-dark">
                    {r.property}
                    {r.property.toLowerCase().includes("goko") && <span className="ml-1 text-[9px] text-brand-green">(You)</span>}
                  </td>
                  {dates.map((d) => {
                    const price = r.prices[d];
                    return (
                      <td key={d} className="px-3 py-3 text-center text-xs">
                        {price != null ? (
                          <span title={r.evidence?.[d] ? `${r.evidence[d].capturedAt}\n${r.evidence[d].cardText}` : "Historical price: no evidence captured"} className={cn("rounded px-1.5 py-0.5 font-medium",
                            r.property.toLowerCase().includes("goko") ? "bg-brand-green/10 text-brand-green" : "text-brand-green-dark/70"
                          )}>
                            ₹{price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                          </span>
                        ) : <span className="text-brand-green-dark/30">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {(!scrapeData || (scrapeData.status === "done" && scrapeData.results.length === 0)) && !loading && (
        <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-12 text-center shadow-sm dark:shadow-none">
          <p className="text-brand-green-dark/50">No rate data yet. Select a city and date range, then click &quot;Scrape Rates&quot; to fetch competitor prices.</p>
        </div>
      )}
    </div>
  );
}
