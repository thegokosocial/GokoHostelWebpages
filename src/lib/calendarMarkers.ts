import { addCalendarDays, civilWeekday } from "@/lib/inventoryAvailability";
import { MAX_CALENDAR_HOLIDAYS, type CalendarHoliday } from "@/lib/websiteBookingSettings";

export type CalendarDayMarker = {
  weekend: boolean;
  holidays: string[];
  longWeekend: boolean;
  longWeekendStart?: string;
  longWeekendEnd?: string;
};

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) dates.push(date);
  return dates;
}

function markerForDate(date: string, holidays: CalendarHoliday[]): CalendarDayMarker {
  const names = [...new Set(holidays
    .filter((holiday) => holiday.date === date || (holiday.recurrence === "annual" && holiday.date.slice(5) === date.slice(5)))
    .map((holiday) => holiday.name))];
  return { weekend: [5, 6].includes(civilWeekday(date)), holidays: names, longWeekend: false };
}

type DateRange = { start: string; end: string };

function mergeRanges(ranges: DateRange[]) {
  const merged: DateRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const previous = merged.at(-1);
    if (previous && range.start <= addCalendarDays(previous.end, 1)) previous.end = previous.end > range.end ? previous.end : range.end;
    else merged.push({ ...range });
  }
  return merged;
}

/** Display-only markers. The bounded shoulders keep long weekends correct at range edges. */
export function calendarMarkersForRange(startDate: string, endDate: string, holidays: CalendarHoliday[]): Record<string, CalendarDayMarker> {
  const shoulder = MAX_CALENDAR_HOLIDAYS + 4;
  const allDates = datesBetween(addCalendarDays(startDate, -shoulder), addCalendarDays(endDate, shoulder));
  const allMarkers = new Map(allDates.map((date) => [date, markerForDate(date, holidays)]));
  const ranges: DateRange[] = [];

  for (let index = 0; index < allDates.length;) {
    if (!allMarkers.get(allDates[index])?.weekend && !allMarkers.get(allDates[index])?.holidays.length) { index++; continue; }
    const start = index;
    while (index < allDates.length && (allMarkers.get(allDates[index])?.weekend || allMarkers.get(allDates[index])?.holidays.length)) index++;
    if (index - start >= 3) ranges.push({ start: allDates[start], end: allDates[index - 1] });
  }

  for (const date of allDates) {
    if (!allMarkers.get(date)?.holidays.length) continue;
    const weekday = civilWeekday(date);
    if (weekday === 5) ranges.push({ start: date, end: addCalendarDays(date, 2) });
    if (weekday === 1) ranges.push({ start: addCalendarDays(date, -2), end: date });
  }

  for (const range of mergeRanges(ranges)) for (const date of datesBetween(range.start, range.end)) {
    const marker = allMarkers.get(date);
    if (marker) Object.assign(marker, { longWeekend: true, longWeekendStart: range.start, longWeekendEnd: range.end });
  }

  return Object.fromEntries(datesBetween(startDate, endDate).map((date) => [date, allMarkers.get(date)!]));
}
