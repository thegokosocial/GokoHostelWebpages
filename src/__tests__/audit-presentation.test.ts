import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { auditActionLabel, formatAuditDetails, formatAuditTarget, presentAuditEntry } from "@/lib/auditPresentation";

describe("audit presentation", () => {
  const maps = {
    dormNames: { "13": "Dorm 1 – single bed", "14": "Dorm 1 – double bed" },
    ratePlanNames: { "8": "Dorm 1 – Rooms Only" },
  };

  it("turns inventory bulk data into readable room, date, and PMS context", () => {
    const details = formatAuditDetails(JSON.stringify({
      mode: "set", dormIds: [13, 14], startDate: "2026-11-01", endDate: "2026-12-31",
      dateCount: 61, dayFilter: [0, 1, 2, 3, 4, 5, 6], cellCount: 122, applied: 122,
      requestedValue: 0, partial: false, sync: { attempted: true, accepted: true },
    }), "INVENTORY_AVAILABILITY_BULK_UPDATED", maps);

    expect(details).toContain("Rooms: Dorm 1 – single bed, Dorm 1 – double bed");
    expect(details).toContain("Dates: 1 Nov 2026 to 31 Dec 2026");
    expect(details).toContain("61 nights");
    expect(details).toContain("online availability: 0");
    expect(details).toContain("PMS sync: accepted");
  });

  it("humanizes targets and preserves useful fallback text", () => {
    expect(auditActionLabel("INVENTORY_AVAILABILITY_BULK_UPDATED")).toBe("Inventory availability updated");
    expect(auditActionLabel("new_custom_action")).toBe("New Custom Action");
    expect(formatAuditTarget("INVENTORY_AVAILABILITY_BULK_UPDATED", "13,14", maps)).toBe("Dorm 1 – single bed, Dorm 1 – double bed");
    expect(formatAuditDetails("legacy text")).toBe("legacy text");
    expect(formatAuditTarget("BEDS_BLOCKED", "dorm:99")).toBe("Dorm 99");
    expect(formatAuditDetails(JSON.stringify({ mode: "percentage" }), "RATES_BULK_ADJUSTED")).toBe("Mode: Percentage");
  });

  it("keeps raw fields while adding display fields", () => {
    const entry = presentAuditEntry({ id: 1, timestamp: "2026-09-15T00:00:00.000Z", username: "admin", action: "RATE_UPDATED", target: "ratePlan:8 2026-11-01", details: JSON.stringify({ rate: 1200 }) }, maps);
    expect(entry.action).toBe("RATE_UPDATED");
    expect(entry.target).toBe("ratePlan:8 2026-11-01");
    expect(entry.displayAction).toBe("Rate updated");
    expect(entry.displayTarget).toContain("Dorm 1 – Rooms Only");
    expect(entry.displayTarget).toContain("1 Nov 2026");
    expect(entry.displayDetails).toContain("Rate: 1200");
  });

  it("renders full audit details in the table instead of truncating them", () => {
    const source = readFileSync("src/components/admin/ManagementAudit.tsx", "utf8");
    expect(source).toContain("min-w-[320px] whitespace-normal break-words");
    expect(source).not.toContain("max-w-[360px] truncate");
    expect(source).toContain("DateRangePicker");
    expect(source).toContain('labels={{ start: "From", end: "To" }}');
  });

  it("uses global retention for every audit source and removes food cleanup", () => {
    const queries = readFileSync("src/db/queries.ts", "utf8");
    const attendance = readFileSync("src/app/api/admin/attendance/route.ts", "utf8");
    const foodRoute = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    const foodUi = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(queries).toContain("employeeAttendanceHistory");
    expect(attendance).toContain("getAuditRetentionCutoff");
    expect(foodRoute).toContain("auditHistory");
    expect(foodUi).toContain("auditHistory: true");
    expect(foodUi).not.toContain("Cleanup Old Orders");
    expect(foodRoute).not.toContain('case "cleanupOldOrders"');
  });
});
