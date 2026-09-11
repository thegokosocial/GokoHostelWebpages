import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("double bed support", () => {
  it("creates two lower beds per double unit and exposes the layout in setup", () => {
    const route = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    const setup = readFileSync("src/components/admin/AdminSetup.tsx", "utf8");

    expect(route).toContain('bedType === "Double"');
    expect(route.match(/position: "Lower", type: "Double"/g)).toHaveLength(2);
    expect(setup).toContain('<option value="Double">Double bed (2 lower)</option>');
  });

  it("keeps booking planning separate from post-check-in physical assignment", () => {
    const dashboard = readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
    const beds = readFileSync("src/components/admin/AdminBeds.tsx", "utf8");
    const route = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    const bookingRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");

    expect(dashboard).toContain("assignGuestCheckinId");
    expect(dashboard).toContain('Assign bed');
    expect(beds).not.toContain("onNavigateToBooking");
    expect(route).not.toContain("This guest has a booking. Open the booking assignment screen to assign the room.");
    expect(route).toContain("assignPhysicalBed");
    expect(route).toContain("checkinId: isValidId(checkinId) ? Number(checkinId) : undefined");
    expect(route).toContain("assignedCheckinIds");
    expect(route).toContain("linkedBookingDetails");
    expect(route).toContain("function checkinIdentity");
    expect(readFileSync("src/db/queries.ts", "utf8")).toContain("excludePhysicalOccupancy = false");
    expect(readFileSync("src/db/queries.ts", "utf8")).toContain("loadBedsAvailabilityForRange(startDate, endDate, dormId, true)");
    expect(route).not.toContain("This double room is reserved for a different booking");
    expect(bookingRoute).toContain('const slots = available.map');
    expect(bookingRoute).toContain('allowPartialDouble = detail.booking.persons === 1');
    expect(readFileSync("src/lib/inventoryAvailability.ts", "utf8")).toContain("partially free");
  });

  it("shows server reasons for legacy bed-action failures", () => {
    const beds = readFileSync("src/components/admin/AdminBeds.tsx", "utf8");

    expect(beds).toContain('showError(d.error || "Could not assign this bed")');
    expect(beds).toContain('showError(d.error || "Could not check out this bed")');
    expect(beds).toContain('showError(d.error || "Could not change this bed")');
  });
});
