import { z } from "zod";

const evidence = z.object({
  sourceUrl: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.booking.com"; }),
  capturedAt: z.string(),
  priceText: z.string(),
  cardText: z.string(),
  error: z.string().optional(),
});
const property = z.object({
  property: z.string(),
  rating: z.number().nullable(),
  prices: z.record(z.string(), z.number().positive().finite().nullable()),
  evidence: z.record(z.string(), evidence).optional(),
});
const resultsSchema = z.union([
  z.array(property),
  z.object({ version: z.literal(2), properties: z.array(property), failedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }),
]);
export type RateResult = z.infer<typeof property>;
export function parseRateResults(raw: unknown) {
  const value = resultsSchema.parse(typeof raw === "string" ? JSON.parse(raw || "[]") : raw);
  return Array.isArray(value)
    ? { properties: value, failedDates: [], legacy: true }
    : { ...value, legacy: false };
}
export function rateScrapeDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current < last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
