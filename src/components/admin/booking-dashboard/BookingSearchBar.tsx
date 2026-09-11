"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SearchIcon, XIcon } from "lucide-react";
import { STATUS_COLORS, platformLogo, STATUS_LABELS } from "./utils";
import type { DashboardBooking } from "./types";

export function BookingSearchBar({
  bookings,
  onSelect,
  onRemoteSearch,
}: {
  bookings: DashboardBooking[];
  onSelect: (id: number) => void;
  onRemoteSearch?: (query: string) => Promise<DashboardBooking[]>;
}) {
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<DashboardBooking[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const localResults = useMemo(() => {
    if (query.length < 4) return [];
    const q = query.toLowerCase();
    return bookings
      .filter(
        (b) =>
          b.guestName.toLowerCase().includes(q) ||
          b.bookingRef.toLowerCase().includes(q) ||
          b.cmBookingId.toLowerCase().includes(q) ||
          b.gokoBookingId.toLowerCase().includes(q) ||
          b.contact.includes(q),
      )
      .slice(0, 10);
  }, [bookings, query]);

  useEffect(() => {
    if (!onRemoteSearch || query.length < 4) {
      setRemoteResults(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void onRemoteSearch(query).then((next) => {
        if (active) setRemoteResults(next);
      }).catch(() => {
        if (active) setRemoteResults([]);
      });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onRemoteSearch, query]);

  const results = remoteResults ?? localResults;

  useEffect(() => {
    setIsOpen(results.length > 0 && query.length >= 4);
  }, [results, query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (id: number) => {
    onSelect(id);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bookings..."
          className="h-8 w-48 rounded-lg border border-input bg-background pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-56"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setIsOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-border bg-popover shadow-lg">
          <div className="max-h-72 overflow-y-auto p-1">
            {results.map((booking) => {
              const statusColor = STATUS_COLORS[booking.status] ?? STATUS_COLORS.received;
              const platform = platformLogo(booking.platform);
              return (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => handleSelect(booking.id)}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
                >
                  {platform && (
                    <span
                      className={cn(
                        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white",
                        platform.color,
                      )}
                    >
                      {platform.abbr}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {booking.guestName}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
                          statusColor.bg,
                          statusColor.text,
                        )}
                      >
                        {STATUS_LABELS[booking.status] ?? booking.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {booking.checkinDate} - {booking.checkoutDate}
                      {booking.bookingRef && (
                        <span className="ml-2 text-[10px] opacity-60">#{booking.bookingRef}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
