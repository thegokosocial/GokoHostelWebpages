export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

/** Calendar occurrence anchored to the rule's original start date, never the prior short month. */
export function recurrenceDate(startDate: string, frequency: RecurrenceFrequency, index: number): string {
  const [year, month, day] = startDate.split("-").map(Number);
  if (frequency === "weekly") {
    const date = new Date(Date.UTC(year, month - 1, day + 7 * index));
    return date.toISOString().slice(0, 10);
  }
  const targetYear = frequency === "yearly" ? year + index : year + Math.floor((month - 1 + index) / 12);
  const targetMonth = frequency === "yearly" ? month : (month - 1 + index) % 12 + 1;
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, daysInMonth(targetYear, targetMonth))).padStart(2, "0")}`;
}

export function recurrenceDatesThrough(startDate: string, frequency: RecurrenceFrequency, through: string): string[] {
  const dates: string[] = [];
  for (let index = 0; ; index++) { const date = recurrenceDate(startDate, frequency, index); if (date > through) return dates; dates.push(date); }
}
