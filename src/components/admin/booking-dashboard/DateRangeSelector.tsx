"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { getDateRange, getHostelToday } from "./utils";
import type { DateRange } from "./types";

const MODES = [
  { value: "week" as const, label: "Week" },
  { value: "10days" as const, label: "10 Days" },
  { value: "30days" as const, label: "30 Days" },
  { value: "custom" as const, label: "Custom" },
];

export function DateRangeSelector({
  dateRange,
  onChange,
}: {
  dateRange: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [customStart, setCustomStart] = useState(dateRange.startDate);
  const [customEnd, setCustomEnd] = useState(dateRange.endDate);
  const [customError, setCustomError] = useState("");

  useEffect(() => {
    setCustomStart(dateRange.startDate);
    setCustomEnd(dateRange.endDate);
  }, [dateRange.startDate, dateRange.endDate]);

  const handleModeChange = (mode: DateRange["mode"]) => {
    if (mode === "custom") {
      setCustomError("");
      onChange({ startDate: customStart, endDate: customEnd, mode: "custom" });
    } else {
      const { start, end } = getDateRange(mode);
      onChange({ startDate: start, endDate: end, mode });
    }
  };

  const handleCustomApply = () => {
    const start = new Date(customStart + "T12:00:00Z");
    const end = new Date(customEnd + "T12:00:00Z");
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
    if (!customStart || !customEnd || !Number.isFinite(diffDays) || diffDays < 0) {
      setCustomError("Choose a valid date range.");
      return;
    }
    setCustomError("");
    onChange({ startDate: customStart, endDate: customEnd, mode: "custom" });
  };

  const handleToday = () => {
    const { start, end } = getDateRange("10days");
    onChange({ startDate: start, endDate: end, mode: "10days" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-input">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => handleModeChange(m.value)}
            className={cn(
              "px-2.5 py-1.5 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg",
              dateRange.mode === m.value
                ? "bg-brand-green text-white"
                : "bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {dateRange.mode === "custom" && (
        <div className="flex items-center gap-1.5">
          <DateRangePicker
            variant="compact"
            applyMode="manual"
            minNights={0}
            startDate={customStart}
            endDate={customEnd}
            onChange={({ startDate, endDate }) => {
              setCustomStart(startDate);
              setCustomEnd(endDate);
            }}
            className="w-56"
          />
          <Button variant="outline" size="xs" onClick={handleCustomApply}>
            Apply
          </Button>
        </div>
      )}

      {customError && <span className="text-xs text-destructive">{customError}</span>}

      <Button variant="ghost" size="xs" onClick={handleToday} className="text-xs">
        <CalendarIcon className="size-3" />
        Today
      </Button>
    </div>
  );
}
