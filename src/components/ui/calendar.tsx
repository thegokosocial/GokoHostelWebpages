"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const defaults = getDefaultClassNames();
  const multiMonth = (props.numberOfMonths ?? 1) > 1;

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit max-w-full p-2", className)}
      classNames={{
        root: cn("w-fit max-w-full", defaults.root),
        months: cn(
          "relative flex gap-4",
          multiMonth ? "flex-row flex-wrap md:gap-3" : "flex-col",
          defaults.months,
        ),
        month: cn("flex w-full min-w-[16.5rem] flex-col gap-3 md:w-auto md:min-w-[13.5rem] md:gap-2", defaults.month),
        month_caption: cn(
          "relative z-0 flex h-9 w-full items-center justify-center px-10",
          defaults.month_caption,
        ),
        caption_label: cn("truncate text-sm font-medium", defaults.caption_label),
        nav: cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex w-full items-center justify-between gap-1 px-1",
          defaults.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "pointer-events-auto relative z-10 size-7 shrink-0 bg-transparent p-0 opacity-70 hover:opacity-100",
          defaults.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "pointer-events-auto relative z-10 size-7 shrink-0 bg-transparent p-0 opacity-70 hover:opacity-100",
          defaults.button_next,
        ),
        month_grid: cn("w-full border-collapse", defaults.month_grid),
        weekdays: cn("flex", defaults.weekdays),
        weekday: cn(
          "flex-1 rounded-md text-[0.7rem] font-normal text-muted-foreground md:text-[0.65rem]",
          defaults.weekday,
        ),
        week: cn("mt-1 flex w-full md:mt-0.5", defaults.week),
        day: cn(
          "relative flex-1 p-0 text-center text-sm md:text-xs focus-within:relative focus-within:z-20",
          defaults.day,
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "mx-auto size-9 max-w-full p-0 font-normal aria-selected:opacity-100 md:size-7",
          defaults.day_button,
        ),
        range_start: "rounded-l-md bg-brand-green/15",
        range_middle: "rounded-none bg-brand-green/10",
        range_end: "rounded-r-md bg-brand-green/15",
        selected:
          "bg-brand-green text-white hover:bg-brand-green hover:text-white focus:bg-brand-green focus:text-white",
        today: "font-bold text-brand-green",
        outside: "text-muted-foreground opacity-40",
        disabled: "text-muted-foreground opacity-30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
