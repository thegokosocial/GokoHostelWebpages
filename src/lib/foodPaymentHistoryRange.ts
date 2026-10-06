import { localDateStr } from "@/lib/utils";

export type FoodPaymentHistoryRange = 7 | 15 | 30;

/** Inclusive IST calendar-date window: today plus the preceding range - 1 dates. */
export function foodPaymentHistoryDateRange(range: FoodPaymentHistoryRange, now = new Date()) {
  const to = localDateStr(now);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (range - 1));
  return { from: fromDate.toISOString().slice(0, 10), to };
}
