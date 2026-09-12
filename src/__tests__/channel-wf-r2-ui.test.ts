import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

const unassigned = readFile("src/components/admin/booking-dashboard/UnassignedBookings.tsx");
const dashboard = readFile("src/components/admin/booking-dashboard/index.tsx");
const panel = readFile("src/components/admin/booking-dashboard/BookingDetailPanel.tsx");
const types = readFile("src/components/admin/booking-dashboard/types.ts");

describe("Round 2 Unassigned UI: reject copy, labels, assign leftover, calendar jump", () => {
  it("confirm string is Goko-only and does not cancel the OTA", () => {
    expect(unassigned).toContain("window.confirm(");
    expect(unassigned).toContain(
      "Reject removes this stay from Goko only. It does not cancel the OTA booking. Cancel it on Booking.com / the channel too, or the guest will still arrive.",
    );
    expect(unassigned).toContain("Reject is Goko-only; cancel the OTA separately.");
    expect(unassigned).toMatch(/does not cancel the OTA/i);
    expect(unassigned).toMatch(/Booking\.com/);
  });

  it("renders requestedNeedLabels with roomLabel fallback when empty", () => {
    expect(types).toContain("requestedNeedLabels?: string");
    expect(types).toContain("requestedBedCount?: number");
    expect(types).toContain("requestedDormIds?: number[]");
    expect(types).toContain("requestedDormNames?: string[]");
    expect(unassigned).toContain("Requested:");
    expect(unassigned).toContain("booking.requestedNeedLabels || roomLabel");
    expect(unassigned).toContain(
      "booking.requestedDormNames?.length",
    );
    expect(unassigned).toContain('booking.roomType || "Unknown room type"');
    expect(unassigned).toContain(
      "Pick {need} room/bed unit{need !== 1 ? \"s\" : \"\"}{booking.requestedNeedLabels ? ` (${booking.requestedNeedLabels})` : \"\"}",
    );
  });

  it("assigns one sellable unit while retaining guest count", () => {
    expect(unassigned).toContain("booking.requestedUnitCount || booking.requestedBedCount || booking.persons || 1");
    expect(unassigned).toContain("A double unit can hold up to two guests");
    expect(unassigned).toContain("Select ${need} room/bed unit");
    expect(unassigned).toContain("for the whole stay");
    expect(unassigned).toContain("Assign available offline units");
    expect(unassigned).toContain('canReject ? " or reject." : "."');
    expect(unassigned).toContain("selectedBeds.length !== need");
    expect(unassigned).toContain("disabled={selectedBeds.length !== need || busy || loadingBeds}");
  });

  it("Reject is shown for admin/manager only and calls cancelBooking", () => {
    expect(dashboard).toContain('canReject={role === "admin" || role === "manager"}');
    expect(dashboard).not.toContain('canReject={hasPermission(role, permissions, "canDeleteBooking")}');
    expect(dashboard).toContain('handleBookingAction("cancelBooking", bookingId)');
    expect(unassigned).toContain("canReject = false");
    expect(unassigned).toContain("{canReject && onReject && (");
    expect(unassigned).toContain("Reject");
    expect(unassigned).toContain("onClick={() => handleReject(booking.id)}");
    expect(dashboard).not.toContain("canCancelBooking");
    const route = readFile("src/app/api/admin/bookings/route.ts");
    expect(route).toContain('cancelBooking: "canDeleteBooking"');
    expect(route).toContain("Admin or manager access required");
    expect(route).toContain("const lead = role === \"admin\" || role === \"manager\"");
    expect(panel).toContain("canCancelStay");
    expect(panel).toContain("role === \"admin\" || role === \"manager\"");
  });

  it("getAvailableBeds payload includes the current bookingId", () => {
    expect(unassigned).toContain('action: "getAvailableBeds"');
    expect(unassigned).toContain(
      '{ password, action: "getAvailableBeds", checkinDate, checkoutDate, bookingId: booking.id }',
    );
    expect(unassigned).toContain("bookingId: booking.id");
  });

  it("offline leftover chips are green and labelled off", () => {
    expect(unassigned).toContain('pool === "offline" && <span className="text-[9px] opacity-70">off</span>');
    expect(unassigned).toContain("Green chips are offline (walk-in) inventory");
    expect(unassigned).toContain('isSelected && pool === "offline" && "border-emerald-600 bg-emerald-100 text-emerald-800"');
    expect(unassigned).toContain('!isSelected && allowed && pool === "offline" && "border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100"');
  });

  it("splits picker into requested vs other rooms", () => {
    expect(unassigned).toContain("requestedDormIds");
    expect(unassigned).toContain("requestedIds.size");
    expect(unassigned).toContain("requestedDorms");
    expect(unassigned).toContain("otherDorms");
    expect(unassigned).toContain("Requested room");
    expect(unassigned).toContain("Other rooms (overflow)");
    expect(unassigned).toContain("requestedDorms.map((d) => renderDorm(d, booking))");
    expect(unassigned).toContain("otherDorms.map((d) => renderDorm(d, booking))");
  });

  it("after assign, off-calendar stays jump via rangeCoveringStay and the panel closes", () => {
    expect(dashboard).toContain("rangeCoveringStay");
    expect(dashboard).toContain("setShowUnassigned(false)");
    expect(dashboard).toContain("setDateRange(next)");
    expect(dashboard).toContain('handleBookingAction("assignBeds", bookingId, { bedIds }, !jumping)');
    expect(unassigned).toContain("Off this calendar");
    expect(unassigned).toContain("stayOverlapsVisible");
  });
});

describe("Round 2 Unassigned UI: mixed-type staff clicks (API 400s)", () => {
  it("shows per-type requestedNeedLabels so mixed stays are not labelled as a single room", () => {
    expect(unassigned).toContain("requestedNeedLabels");
    expect(unassigned).toContain("booking.requestedNeedLabels || roomLabel");
    expect(types).toContain("requestedNeeds?: Array<{ dormId: number; count: number; units?: number; name: string }>");
  });

  it("caps requested-dorm chips at that dorm's quota and labels overflow rooms", () => {
    expect(unassigned).toContain("canSelectBed");
    expect(unassigned).toContain("disabled={!isSelected && !allowed}");
    expect(unassigned).toContain("picked}/{quota}");
    expect(unassigned).toContain("Other rooms (overflow)");
    expect(unassigned).toContain("Overflow does not have to match the room-type split");
    expect(unassigned).toContain("Assign the reserved room/bed units: ${booking.requestedNeedLabels}");
  });
});
