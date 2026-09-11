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

  it("routes booking-linked assignments through the booking flow before legacy bed mutation", () => {
    const dashboard = readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
    const beds = readFileSync("src/components/admin/AdminBeds.tsx", "utf8");
    const route = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");

    expect(dashboard).toContain("item.linkedBookingId");
    expect(dashboard).toContain('onNavigate("bookings", { bookingId: item.linkedBookingId })');
    expect(beds).toContain("onNavigateToBooking");
    expect(route).toContain("This guest has a booking. Open the booking assignment screen to assign the room.");
    expect(route).toContain("bookingId: linkedBooking[0].id");
  });
});
