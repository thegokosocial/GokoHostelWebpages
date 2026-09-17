import { describe, expect, it, vi, afterEach } from "vitest";
import { aggregateGuestRooms, guestSearchSchema, guestRateForStay, guestTaxPercent } from "@/lib/guestBookingSearch";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("@/db/queries", () => ({}));
afterEach(() => vi.unstubAllEnvs());
const stay = () => ({ checkinDate: addCalendarDays(todayIST(), 1), checkoutDate: addCalendarDays(todayIST(), 3) });
describe("Guest stay search", () => {
  it("uses explicit zero tax and the PMS default only when absent, not corrupt", () => {
    expect(guestTaxPercent("0")).toBe(0); expect(guestTaxPercent("12.5")).toBe(12.5); expect(guestTaxPercent(null)).toBe(5);
    for (const raw of ["", "bad", "-1", "101", "Infinity"]) expect(() => guestTaxPercent(raw)).toThrow();
  });
  it("validates date-only stay boundaries and rejects obsolete guest/units fields", () => {
    expect(guestSearchSchema.parse(stay())).toEqual(stay());
    for (const change of [{ guests: 5 }, { units: 3 }, { guests: 0 }, { checkinDate: "2026-02-30" }, { checkoutDate: stay().checkinDate }, { checkoutDate: addCalendarDays(stay().checkinDate, 31) }, { checkinDate: addCalendarDays(todayIST(), -1) }, { checkinDate: addCalendarDays(todayIST(), 366) }, { price: 1 }]) expect(guestSearchSchema.safeParse({ ...stay(), ...change }).success).toBe(false);
  });
  it("only exposes whole online units, excludes holds and drops orphaned doubles", () => {
    const beds = [{ id: 1, dormId: 1, type: "Bunk", guestName: "PRIVATE" }, { id: 2, dormId: 2, type: "Double" }, { id: 3, dormId: 2, type: "Double" }, { id: 4, dormId: 2, type: "Double" }];
    const dorms = [{ id: 1, name: "Mixed dorm" }, { id: 2, name: "Double dorm" }];
    expect(aggregateGuestRooms(beds, new Set([1, 2, 3, 4]), dorms, new Set())).toHaveLength(2);
    expect(aggregateGuestRooms(beds, new Set([1, 2, 4]), dorms, new Set())).toHaveLength(1);
    expect(aggregateGuestRooms(beds, new Set([1, 2, 3, 4]), dorms, new Set([1, 2]))).toEqual([]);
    expect(JSON.stringify(aggregateGuestRooms(beds, new Set([1]), dorms, new Set()))).not.toContain("PRIVATE");
  });
});
const row = (date: string) => ({ date, rate: 1001, adult1Rate: null, adult2Rate: 1800, stopSell: 0, minimumStay: 1, maximumStay: null, closeOnArrival: 0, closeOnDeparture: 0, minimumAdvanceReservation: null, maximumAdvanceReservation: null });
describe("Guest rate display", () => {
  const arrival = "2026-10-01", departure = "2026-10-03", today = "2026-09-30";
  const rows = () => [row(arrival), row("2026-10-02"), row(departure)];
  it("sums exact occupied-night rupees and uses occupancy prices", () => {
    expect(guestRateForStay(rows(), arrival, departure, 1, today)?.subtotalRupees).toBe(2002);
    expect(guestRateForStay(rows(), arrival, departure, 2, today)?.subtotalRupees).toBe(3600);
    expect(guestRateForStay(rows(), arrival, departure, 1, today)?.nightlyRates).toHaveLength(2);
  });
  it.each([{ stopSell: 1 }, { minimumStay: 3 }, { maximumStay: 1 }, { closeOnArrival: 1 }, { minimumAdvanceReservation: 2 }, { maximumAdvanceReservation: 0 }, { rate: -1 }, { rate: 0 }, { rate: 1.5 }, { rate: Number.MAX_SAFE_INTEGER }, { rate: Math.floor(Number.MAX_SAFE_INTEGER / 120) }])("rejects unavailable/invalid rate %j", change => {
    const rates = rows(); rates[0] = { ...rates[0], ...change } as typeof rates[0];
    expect(guestRateForStay(rates, arrival, departure, 1, today)).toBeNull();
  });
  it("checks departure restriction, gaps, duplicates and overnight stop sell", () => {
    const rates = rows(); rates[2].closeOnDeparture = 1;
    expect(guestRateForStay(rates, arrival, departure, 1, today)).toBeNull();
    expect(guestRateForStay([row(arrival)], arrival, departure, 1, today)).toBeNull();
    expect(guestRateForStay([...rows(), row(arrival)], arrival, departure, 1, today)).toBeNull();
    rates[2].closeOnDeparture = 0; rates[1].stopSell = 1;
    expect(guestRateForStay(rates, arrival, departure, 1, today)).toBeNull();
  });
});
