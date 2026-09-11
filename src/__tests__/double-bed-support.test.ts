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
    const bookingRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");

    expect(dashboard).toContain("item.linkedBookingId");
    expect(dashboard).toContain('onNavigate("bookings", { bookingId: item.linkedBookingId })');
    expect(beds).toContain("onNavigateToBooking");
    expect(route).toContain("This guest has a booking. Open the booking assignment screen to assign the room.");
    expect(route).toContain("bookingId: linkedBooking[0].id");
    expect(route).toContain("function checkinIdentity");
    expect(route).not.toContain("This double room is reserved for a different booking");
    expect(bookingRoute).toContain('const slots = available.map');
    expect(bookingRoute).toContain('allowPartialDouble = detail.booking.persons === 1');
  });

  it("shows server reasons for legacy bed-action failures", () => {
    const beds = readFileSync("src/components/admin/AdminBeds.tsx", "utf8");

    expect(beds).toContain('showError(d.error || "Could not assign this bed")');
    expect(beds).toContain('showError(d.error || "Could not check out this bed")');
    expect(beds).toContain('showError(d.error || "Could not change this bed")');
  });
});
