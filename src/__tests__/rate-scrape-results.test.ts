import { describe, expect, it } from "vitest";
import { parseRateResults, rateScrapeDates } from "@/lib/rateScrapeResults";

describe("rate scrape compatibility and dates", () => {
  const properties = [{ property: "Goko", rating: null, prices: { "2026-09-16": 500 } }];
  it("reads historical arrays without inventing evidence", () => {
    expect(parseRateResults(JSON.stringify(properties))).toEqual({ properties, failedDates: [], legacy: true });
    expect(parseRateResults("").properties).toEqual([]);
  });
  it("preserves partial diagnostics and decimal prices", () => {
    const payload = { version: 2, properties: [{ ...properties[0], prices: { "2026-09-16": 500.25, "2026-09-17": null } }], failedDates: ["2026-09-17"] };
    expect(parseRateResults(JSON.stringify(payload))).toEqual({ ...payload, legacy: false });
  });
  it("rejects invalid prices and unsafe evidence links", () => {
    expect(() => parseRateResults([{ ...properties[0], prices: { date: -100 } }])).toThrow();
    expect(() => parseRateResults([{ ...properties[0], evidence: { date: { sourceUrl: "javascript:alert(1)", capturedAt: "", cardText: "", priceText: "" } } }])).toThrow();
  });
  it("includes missing first-property dates and excludes checkout", () => {
    const dates = rateScrapeDates("2026-09-08", "2026-09-30");
    expect(dates).toHaveLength(22);
    expect(dates).toContain("2026-09-12");
    expect(dates).toContain("2026-09-13");
    expect(dates.at(-1)).toBe("2026-09-29");
  });
  it("handles year boundaries and invalid ranges", () => {
    expect(rateScrapeDates("2026-12-31", "2027-01-02")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(rateScrapeDates("2026-09-17", "2026-09-16")).toEqual([]);
  });
});
