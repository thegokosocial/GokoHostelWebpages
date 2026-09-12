import { rateScrapeDates } from "@/lib/rateScrapeResults";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn, localDateStr } from "@/lib/utils";
import { computeNightAvailability, bedsFreeToBlock, summarizeAvailability } from "@/lib/inventoryAvailability";

const ui = readFileSync("src/components/admin/InventoryRatePlan.tsx", "utf8");
const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");
const route = readFileSync("src/app/api/admin/inventory/route.ts", "utf8");
const queries = readFileSync("src/db/queries.ts", "utf8");

function generateDates(start: string, days: number): string[] {
  const dates: string[] = [];
  const d = new Date(start + "T00:00:00");
  for (let i = 0; i < days; i++) {
    dates.push(localDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekdayNum = d.getDay();
  return {
    day: d.getDate().toString(),
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
    isToday: d.getTime() === today.getTime(),
    isWeekend: weekdayNum === 0 || weekdayNum === 6,
  };
}

function dateTint(isWeekend: boolean, isToday: boolean) {
  if (isToday) return "bg-brand-green/[0.09] dark:bg-brand-green/20";
  if (isWeekend) return "bg-amber-50/90 dark:bg-amber-950/25";
  return "";
}

type MockGrid = {
  dorms: { id: number; name: string }[];
  beds: { id: number; dormId: number; bedId: string }[];
  blocks: { id: number; bedId: number; dormId: number; startDate: string; endDate: string }[];
  assignments: { bedId: number; dormId: number; checkinDate: string; checkoutDate: string; status: string }[];
  overrides: { dormId: number; date: string; onlineAvailable: number | null }[];
  roomMappings: { id: number; dormId: number }[];
  ratePlans: { id: number; roomMappingId: number; ratePlanName: string }[];
  rates: { ratePlanId: number; date: string; rate: number; adult1Rate: number | null; stopSell: number }[];
};

function computeAvailability(data: MockGrid, dormId: number, date: string) {
  return computeNightAvailability(dormId, date, data.beds, data.blocks, data.assignments, data.overrides);
}

function computeHeaderStats(data: MockGrid, date: string) {
  let totalBeds = 0, totalBlocked = 0, totalAssigned = 0;
  for (const dorm of data.dorms) {
    const s = computeAvailability(data, dorm.id, date);
    totalBeds += s.total;
    totalBlocked += s.blocked;
    totalAssigned += s.assigned;
  }
  const sellable = totalBeds - totalBlocked;
  const occupancy = sellable > 0 ? Math.round((totalAssigned / sellable) * 100) : 0;
  return { occupancy, available: sellable - totalAssigned, sold: totalAssigned };
}

function fixture(): MockGrid {
  return {
    dorms: [
      { id: 1, name: "Dorm 1" },
      { id: 2, name: "Dorm 2" },
      { id: 3, name: "Female dorm" },
    ],
    beds: [
      ...Array.from({ length: 12 }, (_, i) => ({ id: i + 1, dormId: 1, bedId: `D1-${i + 1}` })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: 20 + i, dormId: 2, bedId: `D2-${i + 1}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: 40 + i, dormId: 3, bedId: `F-${i + 1}` })),
    ],
    blocks: [
      { id: 1, bedId: 1, dormId: 1, startDate: "2026-08-29", endDate: "2026-08-31" },
    ],
    assignments: [
      { bedId: 2, dormId: 1, checkinDate: "2026-08-29", checkoutDate: "2026-09-01", status: "assigned" },
      { bedId: 3, dormId: 1, checkinDate: "2026-08-30", checkoutDate: "2026-08-31", status: "assigned" },
      { bedId: 21, dormId: 2, checkinDate: "2026-08-29", checkoutDate: "2026-09-05", status: "cancelled" },
    ],
    overrides: [
      { dormId: 2, date: "2026-08-29", onlineAvailable: 3 },
    ],
    roomMappings: [
      { id: 10, dormId: 1 },
      { id: 11, dormId: 2 },
    ],
    ratePlans: [
      { id: 100, roomMappingId: 10, ratePlanName: "EP" },
      { id: 101, roomMappingId: 10, ratePlanName: "MAP" },
      { id: 102, roomMappingId: 10, ratePlanName: "CP" },
      { id: 200, roomMappingId: 11, ratePlanName: "EP" },
    ],
    rates: [
      { ratePlanId: 100, date: "2026-08-29", rate: 600, adult1Rate: 600, stopSell: 0 },
      { ratePlanId: 101, date: "2026-08-29", rate: 800, adult1Rate: 800, stopSell: 1 },
      { ratePlanId: 102, date: "2026-08-30", rate: 700, adult1Rate: null, stopSell: 0 },
    ],
  };
}

describe("Inventory grid: sticky + colour structure", () => {
  it("scrolls inside overflow-auto so sticky top is not cancelled by overflow-x-auto alone", () => {
    const gridOpen = ui.indexOf("{/* Grid");
    const header = ui.indexOf("Date header");
    const gridSlice = ui.slice(gridOpen, header + 400);
    expect(gridSlice).toMatch(/overflow-auto/);
    expect(gridSlice).toMatch(/sticky top-0/);
    expect(gridSlice).not.toMatch(/className="overflow-x-auto /);
  });

  it("pins the date row and the left labels, with the corner above both", () => {
    expect(ui).toMatch(/sticky top-0 z-20/);
    expect(ui).toMatch(/sticky left-0 z-30/);
    expect(ui.match(/sticky left-0 z-10/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("fills leftover viewport height instead of a magic 9rem, and skips y-transform on inventory", () => {
    expect(ui).not.toMatch(/100dvh-9rem/);
    expect(ui).toMatch(/h-full min-h-0 flex-1/);
    expect(adminPage).toMatch(/fillViewport = section === "inventory" \|\| section === "bookings"/);
    expect(adminPage).toMatch(/fillViewport \? "h-dvh" : "min-h-screen"/);
    expect(adminPage).toMatch(/fillViewport && "flex h-full min-h-0 flex-1 flex-col"/);
    const overflowAt = ui.indexOf("overflow-auto");
    const stickyAt = ui.indexOf("sticky top-0");
    expect(overflowAt).toBeGreaterThan(0);
    expect(stickyAt).toBeGreaterThan(overflowAt);
  });

  it("renders modals as fixed overlays outside the isolated scrollport", () => {
    const isolateAt = ui.indexOf("isolate min-h-0");
    const isolateClose = ui.indexOf("</div>", ui.indexOf("min-w-max"));
    const detailAt = ui.indexOf("Inventory Detail Popup");
    expect(isolateAt).toBeGreaterThan(0);
    expect(detailAt).toBeGreaterThan(isolateClose);
    expect(ui).toMatch(/editingCell && data &&/);
    expect(ui).toMatch(/editingRate && data &&/);
    expect(ui).toMatch(/bulkOpen &&/);
    expect(ui).toMatch(/fixed inset-0 z-50/);
  });

  it("still colour-codes sold-out, stop-sell, occupancy, overrides, and weekends", () => {
    expect(ui).toContain('available === 0 && "bg-red-50');
    expect(ui).toContain('isStopped && "bg-gray-100');
    expect(ui).toContain("stats.occupancy >= 90");
    expect(ui).toContain("decoration-dotted");
    expect(ui).not.toContain("BanIcon");
    expect(ui).toContain("dateTint(isWeekend, isToday)");
    expect(ui).toContain("bg-emerald-50");
    expect(ui).toContain("bg-sky-50");
    expect(ui).toContain("bg-brand-sand");
    expect(ui).toContain("overrideRemainingInput");
    expect(ui).toContain("overridePreview");
    expect(ui).toContain("overrideCeilingToSave");
    expect(ui).not.toContain("remainingSplit(stats.available, storedCeiling, stats.onlineAssigned)");
    expect(ui).not.toContain("ceilingFromRemaining(Math.min(stats.available, Math.max(0, remaining)), stats.onlineAssigned)");
  });
});

describe("Inventory grid: date helpers stay in sync with source", () => {
  it("keeps weekend = Sat/Sun and today beating weekend in dateTint", () => {
    expect(ui).toContain("isWeekend: weekdayNum === 0 || weekdayNum === 6");
    expect(ui).toContain('if (isToday) return "bg-brand-green/[0.09]');
    expect(ui).toContain('if (isWeekend) return "bg-amber-50/90');

    expect(formatDateShort("2026-08-29").isWeekend).toBe(true);
    expect(formatDateShort("2026-08-29").weekday).toBe("Sat");
    expect(formatDateShort("2026-08-30").isWeekend).toBe(true);
    expect(formatDateShort("2026-08-31").isWeekend).toBe(false);
    expect(formatDateShort("2026-08-31").weekday).toBe("Mon");

    expect(dateTint(true, true)).toContain("bg-brand-green");
    expect(dateTint(true, false)).toContain("bg-amber-50");
    expect(dateTint(false, false)).toBe("");
  });

  it("lets sold-out and stop-sell win over weekend/today tints via twMerge", () => {
    const soldOut = cn(
      dateTint(true, true),
      true && "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    );
    expect(soldOut).toContain("bg-red-50");
    expect(soldOut).not.toContain("bg-amber-50");
    expect(soldOut).not.toContain("bg-brand-green/[0.09]");

    const stopped = cn(
      dateTint(true, false),
      true && "bg-gray-100 text-gray-400 line-through dark:bg-gray-800/30",
    );
    expect(stopped).toContain("bg-gray-100");
    expect(stopped).not.toContain("bg-amber-50");
  });

  it("builds 7/14/30-day ranges without skipping days across month ends", () => {
    expect(ui).toContain("rangeDays <= 7 ? 80 : rangeDays <= 14 ? 60 : 48");
    const fourteen = generateDates("2026-08-29", 14);
    expect(fourteen).toHaveLength(14);
    expect(fourteen[0]).toBe("2026-08-29");
    expect(fourteen[2]).toBe("2026-08-31");
    expect(fourteen[3]).toBe("2026-09-01");
    expect(fourteen[13]).toBe("2026-09-11");
    expect(generateDates("2026-08-29", 7)).toHaveLength(7);
    expect(generateDates("2026-08-29", 30)[29]).toBe("2026-09-27");
  });
});

describe("Inventory grid: availability and occupancy workflows", () => {
  it("matches the source occupancy formula (blocked exclusive-end, cancelled ignored, override wins)", () => {
    expect(ui).toContain("computeNightAvailability");
    expect(ui).toContain("unassignedOtaOnNight");
    expect(ui).toContain("const hasHeld = useMemo");
    expect(ui).toContain("{hasHeld &&");
    expect(ui).toContain("OTA");
    expect(ui).toContain("walk-in");
    expect(ui).toContain("blocked</span>");
    expect(ui).toContain("{blocked}");
    expect(ui).toContain("${blocked} blocked");
    expect(ui).toContain("Unassigned OTA");
    expect(ui).toContain("channel bookings with no bed yet");
    expect(ui).toContain("unblock returns them here");
    expect(ui).toContain("Math.round((totalAssigned / sellable) * 100)");

    const data = fixture();

    const d1_29 = computeAvailability(data, 1, "2026-08-29");
    expect(d1_29.total).toBe(12);
    expect(d1_29.blocked).toBe(1);
    expect(d1_29.assigned).toBe(1);
    expect(d1_29.available).toBe(10);
    expect(d1_29.overridden).toBe(false);

    const d1_31 = computeAvailability(data, 1, "2026-08-31");
    expect(d1_31.blocked).toBe(0);
    expect(d1_31.assigned).toBe(1);
    expect(d1_31.available).toBe(11);

    const d1_sep1 = computeAvailability(data, 1, "2026-09-01");
    expect(d1_sep1.assigned).toBe(0);
    expect(d1_sep1.available).toBe(12);

    const d2_29 = computeAvailability(data, 2, "2026-08-29");
    expect(d2_29.assigned).toBe(0);
    expect(d2_29.overridden).toBe(true);
    expect(d2_29.available).toBe(8);
    expect(d2_29.online).toBe(3);
    expect(d2_29.offline).toBe(5);

    const stats29 = computeHeaderStats(data, "2026-08-29");
    expect(stats29.sold).toBe(1);
    expect(stats29.available).toBe(24);
    expect(stats29.occupancy).toBe(4);
  });

  it("bulk-block picker count matches leftover available (not total beds)", () => {
    const data = fixture();
    const d1 = data.beds.filter((b) => b.dormId === 1);
    const free29 = bedsFreeToBlock(d1, "2026-08-29", "2026-08-30", data.assignments, data.blocks);
    expect(free29).toHaveLength(10);
    expect(free29.map((b) => b.id)).not.toContain(1);
    expect(free29.map((b) => b.id)).not.toContain(2);

    const free30 = bedsFreeToBlock(d1, "2026-08-30", "2026-08-31", data.assignments, data.blocks);
    expect(free30).toHaveLength(9);
    expect(free30.map((b) => b.id)).not.toContain(3);
  });

  it("summarizes selected room-night counts without mixing units and nights", () => {
    const data = fixture();
    const summary = summarizeAvailability([
      computeAvailability(data, 1, "2026-08-29"),
      computeAvailability(data, 1, "2026-08-30"),
    ]);
    expect(summary.roomNights).toBe(2);
    expect(summary.total).toBe(24);
    expect(summary.blocked).toBe(2);
    expect(summary.assigned).toBe(3);
    expect(summary.available).toBe(19);
    expect(summary.online + summary.offline).toBe(summary.available);
  });

  it("maps rate-plan rows under the dorm's room mapping and prefers adult1Rate", () => {
    const data = fixture();
    const mapping = data.roomMappings.find((rm) => rm.dormId === 1);
    const plans = data.ratePlans.filter((rp) => rp.roomMappingId === mapping!.id);
    expect(plans.map((p) => p.ratePlanName)).toEqual(["EP", "MAP", "CP"]);

    const femalePlans = data.ratePlans.filter((rp) => {
      const rm = data.roomMappings.find((m) => m.dormId === 3);
      return rm ? rp.roomMappingId === rm.id : false;
    });
    expect(femalePlans).toHaveLength(0);

    const ep = data.rates.find((r) => r.ratePlanId === 100 && r.date === "2026-08-29");
    expect(ep?.adult1Rate ?? ep?.rate).toBe(600);
    const cp = data.rates.find((r) => r.ratePlanId === 102 && r.date === "2026-08-30");
    expect(cp?.adult1Rate ?? cp?.rate).toBe(700);
    const mapStopped = data.rates.find((r) => r.ratePlanId === 101 && r.date === "2026-08-29");
    expect(mapStopped?.stopSell).toBe(1);
  });
});

describe("Inventory grid: edit and bulk workflows still wired", () => {
  it("opens inventory override from a dorm cell and still posts updateInventoryOverride", () => {
    expect(ui).toContain("onClick={() => setEditingCell({ dormId: dorm.id, date })}");
    expect(ui).toContain('action: "updateInventoryOverride"');
    expect(ui).toContain("if (!json.success && !res.ok)");
    expect(route).toContain("updateInventoryOverride: \"canManageInventory\"");
  });

  it("opens rate edit from a rate-plan cell and still posts updateRate", () => {
    expect(ui).toContain("onClick={() => setEditingRate({ ratePlanId: rp.id, date })}");
    expect(ui).toContain('action: "updateRate"');
    expect(route).toContain("updateRate: \"canManageInventory\"");
  });

  it("keeps bulk update actions and range controls", () => {
    expect(ui).toContain("onClick={() => setBulkOpen(true)}");
    expect(ui).toContain('action: "blockBeds"');
    expect(ui).toContain('action: "unblockBeds"');
    expect(ui).toContain('action: "bulkSetAvailability"');
    expect(ui).toContain("AvailabilityPreviewPanel");
    expect(ui).toContain("Selected availability by room");
    expect(ui).toContain("Each room is shown separately because room capacities can differ");
    expect(ui).toContain("units/night");
    expect(ui).toContain("Combined selection · overall totals");
    expect(route).toContain("byRoom");
    expect(ui).toContain("Select at least one room/dorm and both dates");
    expect(ui).toContain("availabilityActionValid");
    expect(ui).toContain('variant={availabilityActionValid ? "cta" : "secondary"}');
    expect(ui).toContain("grid-cols-1 gap-2 sm:grid-cols-2");
    expect(route).toContain("preview === true");
    expect(route).toContain("summarizeAvailability");
    expect(ui).toContain('action: "bulkSetRates"');
    expect(ui).toContain('action: "bulkAdjustRates"');
    expect(ui).toContain('action: "bulkSetRestrictions"');
    expect(ui).toContain("{[7, 14, 30].map");
    expect(ui).toContain('action: "getInventoryGrid"');
    expect(queries).toContain("export async function getInventoryGridData");
    expect(queries).toContain("unassignedOta");
  });

  it("only offers beds free to block (not booked or already blocked)", () => {
    expect(ui).toContain("exclusiveEndFromInclusive");
    expect(ui).toContain("addCalendarDays");
    expect(ui).toContain("min={today}");
    expect(ui).toContain("setStartAndNextEnd");
    expect(ui).toContain('action: "getBedsFreeToBlock"');
    expect(ui).toContain("Beds free to block");
    expect(ui).not.toContain("localFreeBeds");
    expect(ui).toContain("fetchedFreeBeds ?? []");
    expect(ui).toContain('action: "getActiveBlocks"');
    expect(route).toContain("getBedsFreeToBlock: \"canManageInventory\"");
    expect(route).toContain("bulkSetAvailability: \"canManageInventory\"");
    expect(route).toContain("One or more beds are booked or already blocked for these dates");
    expect(queries).toContain("export async function getBedsFreeToBlock");
    expect(ui).toContain("setFetchedFreeBeds(null)");
    expect(route).toContain("stayNights(b.startDate, b.endDate)");
  });

  it("Set Rates multi-selects rate plans grouped by room", () => {
    expect(ui).toContain("setRateRpIds");
    expect(ui).not.toMatch(/\bsetRateRpId\b/);
    expect(ui).toContain("ratePlanIds: rateRpIds");
    expect(ui).toContain("RatePlanChipPicker");
    expect(ui).toContain("Select All");
    expect(ui).toContain("Writes ₹");
    expect(route).toContain("ratePlanIds?.length ? ratePlanIds");
    expect(route).toContain("triggerRatePush(filteredDates, ids)");
  });
});

describe("Check Rates scrape dates are exclusive", () => {
  const checkRates = readFileSync("src/components/admin/AdminCheckRates.tsx", "utf8");

  it("greys past From dates and excludes checkout from scraped nights", () => {
    expect(checkRates).toContain("min={todayIST()}");
    expect(checkRates).toContain("min={startDate ? addCalendarDays(startDate, 1) : todayIST()}");
    expect(rateScrapeDates("2026-09-16", "2026-09-18")).toEqual(["2026-09-16", "2026-09-17"]);
  });
});
