import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildBookingChangeRequestText, formatPaymentChoice, guestActionFlags, roomLinesFromQuote, roomLinesFromAssignments,
} from "@/lib/guestBookingDetails";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS } from "@/lib/websiteBookingSettings";

describe("Guest booking manage details", () => {
  it("builds room lines and tax percent from an accepted quote", () => {
    const quote = JSON.stringify({
      checkinDate: "2026-10-01",
      checkoutDate: "2026-10-03",
      taxBasisPoints: 500,
      paymentChoice: "advance",
      beforeTaxRupees: 2000,
      taxRupees: 100,
      units: [
        { key: "1:bed:10", nightlyRates: [{ date: "2026-10-01", rupees: 500 }, { date: "2026-10-02", rupees: 500 }] },
        { key: "1:bed:11", nightlyRates: [{ date: "2026-10-01", rupees: 500 }, { date: "2026-10-02", rupees: 500 }] },
      ],
    });
    const lines = roomLinesFromQuote(quote, new Map([[1, "Shiva dorm"]]));
    expect(lines.nights).toBe(2);
    expect(lines.taxPercent).toBe(5);
    expect(lines.rooms).toHaveLength(1);
    expect(lines.rooms[0]).toMatchObject({ quantity: 2, subtotalRupees: 2000 });
    expect(lines.rooms[0].label).toContain("Shiva dorm");
  });

  it("counts one double unit from a single enriched assignment row", () => {
    const rooms = roomLinesFromAssignments(
      [{ dormId: 1, dormName: "Shiva", status: "assigned", bedLabel: "double" }],
      new Map([[1, "Shiva"]]),
      2000,
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ type: "Double", quantity: 1, subtotalRupees: 2000 });
    expect(rooms[0].label).toContain("Whole double bed");
  });

  it("exposes canCancel when policy and status allow; canModify stays for internal amend helpers", () => {
    const flags = guestActionFlags({
      checkoutState: "fulfilled",
      bookingStatus: "received",
      checkinDate: "2099-12-01",
      policy: DEFAULT_WEBSITE_BOOKING_SETTINGS,
      nowEpochMs: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(flags.canCancel).toBe(true);
    expect(flags.canModify).toBe(true);
    expect(flags.cancellationDeadlineAt).toBeTruthy();
  });

  it("formats payment choice labels", () => {
    expect(formatPaymentChoice("advance")).toBe("Advance paid online");
    expect(formatPaymentChoice("property")).toBe("Pay at property");
  });

  it("builds WhatsApp change-request text with reference and stay", () => {
    const text = buildBookingChangeRequestText({
      reference: "GOKO-1",
      guestName: "Ada",
      checkinDate: "2026-10-01",
      checkoutDate: "2026-10-03",
      nights: 2,
      rooms: [{ label: "2 × Shiva dorm · Single bed" }],
      amountTotal: 1000,
      amountPaid: 500,
      dueRupees: 500,
    });
    expect(text).toContain("GOKO-1");
    expect(text).toContain("I'd like to change");
    expect(text).toContain("Due at property: ₹500");
  });

  it("confirmation page uses WhatsApp change CTA, copy details, and Cancel button (no amend panel)", () => {
    const manage = readFileSync("src/components/booking/GuestBookingManage.tsx", "utf8");
    const page = readFileSync("src/app/(marketing)/booking/[reference]/page.tsx", "utf8");
    const amendRoute = readFileSync("src/app/api/guest-booking/amend/route.ts", "utf8");
    expect(page).toContain("GuestBookingManage");
    expect(page).not.toContain("GuestBookingAmendPanel");
    expect(manage).toContain("Change stay on WhatsApp");
    expect(manage).toContain("Copy booking details");
    expect(manage).toContain("Cancel booking");
    expect(manage).not.toContain("Edit stay");
    expect(manage).not.toContain("onEditStay");
    expect(manage).toContain("dueAtPropertyPaise");
    expect(manage).toContain("buildBookingChangeRequestText");
    expect(amendRoute).toContain("status: 403");
    expect(amendRoute).toContain("WhatsApp");
  });

  it("My booking stores manage token and redirects to confirmation", () => {
    const panel = readFileSync("src/components/booking/BookingHeroPanel.tsx", "utf8");
    expect(panel).toContain("data.guestAccessToken");
    expect(panel).toContain("sessionStorage.setItem(`goko_booking_${ref}`");
    expect(panel).toContain("window.location.assign(href)");
    expect(panel).toContain("Manage booking");
  });

  it("admin Edit Booking is available for website and manual sources", () => {
    const detail = readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8");
    const modal = readFileSync("src/components/admin/booking-dashboard/EditBookingModal.tsx", "utf8");
    expect(detail).toContain('booking.source === "manual" || booking.source === "website"');
    expect(detail).toContain('booking.source === "website"');
    expect(detail).toContain("canHardDeleteWebsite");
    expect(modal).toContain('canEditPaid = booking.source === "manual"');
    expect(modal).toContain("Collect remaining");
    expect(modal).toContain("AvailableBedsPicker");
  });

  it("guest confirmation shows Updated when stayUpdatedAt is set", () => {
    const manage = readFileSync("src/components/booking/GuestBookingManage.tsx", "utf8");
    expect(manage).toContain("stayUpdatedAt");
    expect(manage).toContain("Updated");
    expect(manage).toContain("Your stay was updated on");
    expect(manage).toContain("Any extra amount is due at the hostel");
  });
});
