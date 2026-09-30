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

/** Display-only markers. The bounded shoulders keep long weekends correct at range edges. */
export function calendarMarkersForRange(startDate: string, endDate: string, holidays: CalendarHoliday[]): Record<string, CalendarDayMarker> {
  const shoulder = MAX_CALENDAR_HOLIDAYS + 2;
  const allDates = datesBetween(addCalendarDays(startDate, -shoulder), addCalendarDays(endDate, shoulder));
  const allMarkers = new Map(allDates.map((date) => [date, markerForDate(date, holidays)]));

  for (let index = 0; index < allDates.length;) {
    if (!allMarkers.get(allDates[index])?.weekend && !allMarkers.get(allDates[index])?.holidays.length) { index++; continue; }
    const start = index;
    while (index < allDates.length && (allMarkers.get(allDates[index])?.weekend || allMarkers.get(allDates[index])?.holidays.length)) index++;
    if (index - start < 3) continue;
    const runStart = allDates[start], runEnd = allDates[index - 1];
    for (let cursor = start; cursor < index; cursor++) {
      const marker = allMarkers.get(allDates[cursor]);
      if (marker) Object.assign(marker, { longWeekend: true, longWeekendStart: runStart, longWeekendEnd: runEnd });
    }
  }

  return Object.fromEntries(datesBetween(startDate, endDate).map((date) => [date, allMarkers.get(date)!]));
}
