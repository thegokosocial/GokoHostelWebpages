"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2Icon, RefreshCwIcon, StarIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/dates/DateRangePicker";

const IMPROVEMENT_OPTIONS = ["Dorms", "Washrooms", "Comfort", "Vibe", "Common Area", "Cafe Food"];

interface FeedbackRow {
  id: number;
  reviewRequestId: number;
  rating: number;
  improvementAreas: string;
  comments: string;
  submittedAt: string;
  guestName: string;
  guestContact: string;
  propertyId: string;
  bookingId: string;
}

interface Props {
  password: string;
  username: string;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <StarIcon
          key={s}
          className={cn("h-3.5 w-3.5", s <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300 dark:text-gray-600")}
        />
      ))}
    </div>
  );
}

export function ReviewResponsesTab({ password, username }: Props) {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [ratingFilter, setRatingFilter] = useState<number | "">("");
  const [areaFilter, setAreaFilter] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { action: "listResponses" };
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      if (ratingFilter) params.rating = ratingFilter;
      if (areaFilter) params.improvementArea = areaFilter;
      if (propertyFilter) params.property = propertyFilter;
      const res = await apiCall(params);
      if (res.ok) {
        const data = await res.json();
        setFeedback(data.feedback || []);
      }
    } catch {}
    setLoading(false);
  }, [apiCall, fromDate, toDate, ratingFilter, areaFilter, propertyFilter]);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <DateRangePicker
            variant="compact"
            applyMode="manual"
            minNights={0}
            startDate={fromDate}
            endDate={toDate}
            onChange={({ startDate, endDate }) => {
              setFromDate(startDate);
              setToDate(endDate);
            }}
            className="w-56"
          />
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value ? Number(e.target.value) : "")}
            className="rounded-md border border-brand-mist px-2 py-1.5 text-xs"
          >
            <option value="">All Ratings</option>
            {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r} Star{r > 1 ? "s" : ""}</option>)}
          </select>
          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="rounded-md border border-brand-mist px-2 py-1.5 text-xs"
          >
            <option value="">All Areas</option>
            {IMPROVEMENT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="rounded-md border border-brand-mist px-2 py-1.5 text-xs"
          >
            <option value="">All Properties</option>
            <option value="goko_hostel">Goko Hostel</option>
            <option value="sunnys_paradise">Sunny&apos;s Paradise</option>
          </select>
          <button
            type="button"
            onClick={loadFeedback}
            className="ml-auto rounded-lg p-2 text-brand-green-dark/60 hover:bg-brand-green/[0.06]"
            title="Refresh"
          >
            <RefreshCwIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="h-5 w-5 animate-spin text-brand-green" />
        </div>
      ) : feedback.length === 0 ? (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center">
          <p className="text-sm text-brand-green-dark/50">No feedback found for the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-brand-green-dark/50">{feedback.length} feedback response{feedback.length !== 1 ? "s" : ""}</p>

          {feedback.map((f) => {
            let areas: string[] = [];
            try { areas = JSON.parse(f.improvementAreas || "[]"); } catch {}
            const isExpanded = expandedId === f.id;
            return (
              <div key={f.id} className="rounded-xl border border-brand-mist bg-white dark:bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : f.id)}
                  className="w-full px-4 py-3 text-left hover:bg-brand-sand/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-brand-green-dark">{f.guestName}</span>
                        <StarDisplay rating={f.rating} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        {areas.map((a) => (
                          <span key={a} className="rounded-full bg-red-50 dark:bg-red-950 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                            {a}
                          </span>
                        ))}
                        <span className="text-xs text-brand-green-dark/40">{formatDate(f.submittedAt)}</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUpIcon className="h-4 w-4 text-brand-green-dark/40 flex-shrink-0" /> : <ChevronDownIcon className="h-4 w-4 text-brand-green-dark/40 flex-shrink-0" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-brand-mist px-4 py-3 bg-brand-sand/20">
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      <div><span className="text-brand-green-dark/50">Contact:</span> <span className="text-brand-green-dark">{f.guestContact}</span></div>
                      <div><span className="text-brand-green-dark/50">Booking:</span> <span className="text-brand-green-dark">{f.bookingId || "N/A"}</span></div>
                      <div><span className="text-brand-green-dark/50">Property:</span> <span className="text-brand-green-dark">{f.propertyId === "sunnys_paradise" ? "Sunny's Paradise" : "Goko Hostel"}</span></div>
                    </div>
                    {f.comments && (
                      <div className="mt-3">
                        <p className="text-xs text-brand-green-dark/50 mb-1">Comments:</p>
                        <p className="text-sm text-brand-green-dark whitespace-pre-wrap">{f.comments}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
