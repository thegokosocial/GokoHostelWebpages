"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import {
  applyRangeSelection,
  isoRangeToDateRange,
  parseCalendarDate,
} from "@/lib/dateRangePicker";

export type DateRangePickerProps = {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  minDate?: string;
  maxNights?: number;
  minNights?: number;
  applyMode?: "immediate" | "manual";
  presentation?: "popover" | "inline";
  disabled?: boolean;
  required?: boolean;
  variant?: "marketing" | "admin" | "compact";
  labels?: { start?: string; end?: string };
  className?: string;
  id?: string;
};

function useMonthCount(): number {
  const [months, setMonths] = useState(1);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setMonths(mq.matches ? 2 : 1);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return months;
}

function formatTriggerLabel(startDate: string, endDate: string, labels?: DateRangePickerProps["labels"]): string {
  const startLabel = labels?.start ?? "Check-in";
  const endLabel = labels?.end ?? "Check-out";
  if (!startDate && !endDate) return `Select ${startLabel.toLowerCase()} — ${endLabel.toLowerCase()}`;
  if (startDate && !endDate) {
    return `${format(parseCalendarDate(startDate), "EEE, d MMM")} — ${endLabel}`;
  }
  if (startDate && endDate) {
    return `${format(parseCalendarDate(startDate), "EEE, d MMM")} — ${format(parseCalendarDate(endDate), "EEE, d MMM")}`;
  }
  return `Select dates`;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  minDate,
  maxNights,
  minNights = 1,
  applyMode = "immediate",
  presentation = "popover",
  disabled,
  required,
  variant = "marketing",
  labels,
  className,
  id,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const monthCount = useMonthCount();
  const selected = useMemo(() => isoRangeToDateRange(startDate, endDate), [startDate, endDate]);

  const floorDate = minDate ?? (maxNights != null ? todayIST() : undefined);

  const disabledMatcher = useMemo(() => {
    const matchers: Array<Date | { before: Date } | { after: Date }> = [];
    if (floorDate) matchers.push({ before: parseCalendarDate(floorDate) });
    if (maxNights != null && startDate) {
      matchers.push({ after: parseCalendarDate(addCalendarDays(startDate, maxNights)) });
    }
    return matchers.length ? matchers : undefined;
  }, [floorDate, maxNights, startDate]);

  function handleSelect(range: DateRange | undefined) {
    const result = applyRangeSelection(range, {
      minNights,
      maxNights,
      minDate: floorDate,
    });
    onChange({ startDate: result.startDate, endDate: result.endDate });
    if (applyMode === "immediate" && result.complete && result.valid) {
      setOpen(false);
    }
  }

  const triggerClass = cn(
    "flex w-full min-w-0 items-center gap-2 border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:cursor-not-allowed disabled:opacity-50",
    variant === "marketing" &&
      "min-h-12 rounded-lg border-brand-green/25 bg-white px-3 py-3 text-base text-brand-green-dark",
    variant === "admin" &&
      "min-h-10 rounded-md border-input bg-background px-3 py-2 text-sm",
    variant === "compact" &&
      "h-7 rounded-md border-input bg-background px-2 text-xs",
    className,
  );

  const calendar = (
    <Calendar
      mode="range"
      numberOfMonths={monthCount}
      selected={selected.from ? { from: selected.from, to: selected.to } : undefined}
      onSelect={handleSelect}
      disabled={disabled ? true : disabledMatcher}
      defaultMonth={selected.from ?? (floorDate ? parseCalendarDate(floorDate) : undefined)}
    />
  );

  if (presentation === "inline") {
    return (
      <div className={cn("space-y-2", className)} id={id}>
        <p className="text-sm font-medium text-muted-foreground">
          {formatTriggerLabel(startDate, endDate, labels)}
        </p>
        <div className="rounded-xl border border-border bg-background p-1">{calendar}</div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        aria-required={required}
        className={triggerClass}
      >
        <CalendarIcon className={cn("shrink-0 opacity-60", variant === "compact" ? "size-3.5" : "size-4")} />
        <span className="min-w-0 truncate">{formatTriggerLabel(startDate, endDate, labels)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}
