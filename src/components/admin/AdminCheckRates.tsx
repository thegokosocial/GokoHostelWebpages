"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type RateResult = {
  property: string;
  rating: number;
  prices: Record<string, number | null>;
};

type ScrapeData = {
  id: number;
  city: string;
  startDate: string;
  endDate: string;
  propertyType: string;
  status: string;
  results: RateResult[];
  createdAt: string;
  completedAt: string;
};

export function AdminCheckRates({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const [loading, setLoading] = useState(false);
  const [scrapeData, setScrapeData] = useState<ScrapeData | null>(null);
  const [scraping, setScraping] = useState(false);

  const [city, setCity] = useState("Gokarna");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]
  );
  const [propertyType, setPropertyType] = useState("hostels");
  const [proxyUrl, setProxyUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => { loadLatest(); }, [city]);

  const loadLatest = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getLatestRateScrape", city });
      if (res.ok) {
        const d = await res.json();
        if (d.scrape) {
          setScrapeData({
            ...d.scrape,
            results: d.scrape.results ? JSON.parse(d.scrape.results) : [],
          });
        }
      }
    } finally { setLoading(false); }
  };

  const startScrape = async () => {
    setScraping(true);
    try {
      const scraperKey = proxyUrl.trim();
      const fullProxyUrl = scraperKey ? `http://scraperapi:${scraperKey}@proxy-server.scraperapi.com:8001` : undefined;
      const res = await apiCall({ action: "startRateScrape", city, startDate, endDate, propertyType, proxyUrl: fullProxyUrl });
      if (res.ok) {
        const d = await res.json();
        setScrapeData({ id: d.id, city, startDate, endDate, propertyType, status: "pending", results: [], createdAt: new Date().toISOString(), completedAt: "" });
      } else {
        const d = await res.json();
        alert(d.error || "Failed to start scrape");
      }
    } finally { setScraping(false); }
  };

  const pollStatus = async () => {
    if (!scrapeData) return;
    const res = await apiCall({ action: "getRateScrapeStatus", scrapeId: scrapeData.id });
    if (res.ok) {
      const d = await res.json();
      if (d.scrape) {
        setScrapeData({
          ...d.scrape,
          results: d.scrape.results ? JSON.parse(d.scrape.results) : [],
        });
      }
    }
  };

  const dates = scrapeData?.results?.length ? Object.keys(scrapeData.results[0]?.prices || {}).sort() : generateDateRange(startDate, endDate);

  if (loading) return <AdminLoading message="Loading rates..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Check Rates</h2>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">City</label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Gokarna" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">From Date</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">To Date</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
          scrapeData.status === "pending" && "bg-yellow-50 text-yellow-700",
          scrapeData.status === "in_progress" && "bg-blue-50 text-blue-700",
          scrapeData.status === "done" && "bg-green-50 text-green-700",
          scrapeData.status === "failed" && "bg-red-50 text-red-700",
        )}>
          <div className="flex items-center justify-between">
            <div>
              {scrapeData.status === "pending" && <p>Scrape queued. The GitHub Action will process it shortly. Check back in ~3 minutes.</p>}
              {scrapeData.status === "in_progress" && <p>Scrape in progress... fetching rates from Booking.com.</p>}
              {scrapeData.status === "done" && <p>Scrape completed at {new Date(scrapeData.completedAt).toLocaleString()} — showing {scrapeData.results.length} properties.</p>}
              {scrapeData.status === "failed" && <p>Scrape failed. Try again or check logs.</p>}
            </div>
            <div className="flex gap-2">
              {(scrapeData.status === "pending" || scrapeData.status === "in_progress") && (
                <Button type="button" variant="ctaOutline" onClick={pollStatus}>
                  <RefreshCwIcon className="mr-1 h-3.5 w-3.5" /> Check Status
                </Button>
              )}
              {scrapeData.status === "failed" && (
                <Button type="button" variant="cta" onClick={startScrape} disabled={scraping}>
                  {scraping ? "Retrying..." : "Retry Scrape"}
                </Button>
              )}
              {scrapeData.status === "done" && (
                <Button type="button" variant="ctaOutline" onClick={startScrape} disabled={scraping}>
                  {scraping ? "Starting..." : "New Scrape"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results Grid */}
      {scrapeData?.status === "done" && scrapeData.results.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-brand-mist bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-mist bg-brand-sand/50">
                <th className="sticky left-0 z-10 bg-brand-sand/50 px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Property</th>
                <th className="px-3 py-3 text-xs font-bold text-brand-green-dark/70">Rating</th>
                {dates.map((d) => (
                  <th key={d} className="px-3 py-3 text-center text-[10px] font-bold text-brand-green-dark/70">
                    {new Date(d).toLocaleDateString("en", { day: "numeric", month: "short" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scrapeData.results.map((r, i) => (
                <tr key={i} className={cn("border-b border-brand-mist/50 last:border-0",
                  r.property.toLowerCase().includes("goko") && "bg-brand-green/[0.04] font-semibold"
                )}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 text-xs font-medium text-brand-green-dark">
                    {r.property}
                    {r.property.toLowerCase().includes("goko") && <span className="ml-1 text-[9px] text-brand-green">(You)</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-brand-green-dark/70">{r.rating || "—"}</td>
                  {dates.map((d) => {
                    const price = r.prices[d];
                    return (
                      <td key={d} className="px-3 py-3 text-center text-xs">
                        {price ? (
                          <span className={cn("rounded px-1.5 py-0.5 font-medium",
                            r.property.toLowerCase().includes("goko") ? "bg-brand-green/10 text-brand-green" : "text-brand-green-dark/70"
                          )}>
                            ₹{price}
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
        <div className="rounded-2xl border border-brand-mist bg-white p-12 text-center shadow-sm">
          <p className="text-brand-green-dark/50">No rate data yet. Select a city and date range, then click &quot;Scrape Rates&quot; to fetch competitor prices.</p>
        </div>
      )}
    </div>
  );
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current < endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
