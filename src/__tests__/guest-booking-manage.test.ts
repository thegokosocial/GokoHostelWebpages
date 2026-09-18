import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatPaymentChoice, guestActionFlags, roomLinesFromQuote } from "@/lib/guestBookingDetails";
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

  it("exposes canCancel/canModify when policy and status allow", () => {
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

  it("confirmation page uses GuestBookingManage with amend panel and demoted cancel", () => {
    const manage = readFileSync("src/components/booking/GuestBookingManage.tsx", "utf8");
    const page = readFileSync("src/app/(marketing)/booking/[reference]/page.tsx", "utf8");
    const amend = readFileSync("src/components/booking/GuestBookingAmendPanel.tsx", "utf8");
    expect(page).toContain("GuestBookingManage");
    expect(page).toContain("GuestBookingAmendPanel");
    expect(page).not.toContain("Cancel booking");
    expect(manage).toContain("Edit stay");
    expect(manage).toContain("onEditStay");
    expect(manage).not.toContain("Stay changes will be available soon");
    expect(manage).toContain("Cancel booking");
    expect(manage).toContain("canModify");
    expect(manage).toContain("cancellationDeadlineAt");
    expect(manage).toContain("dueAtPropertyPaise");
    expect(manage).toMatch(/text-brand-red underline/);
    expect(amend).toContain("/api/guest-booking/amend");
    expect(amend).toContain("Pay difference");
  });

  it("My booking stores manage token and redirects to confirmation", () => {
    const panel = readFileSync("src/components/booking/BookingHeroPanel.tsx", "utf8");
    expect(panel).toContain("data.guestAccessToken");
    expect(panel).toContain("sessionStorage.setItem(`goko_booking_${ref}`");
    expect(panel).toContain("window.location.assign(href)");
    expect(panel).toContain("Manage booking");
  });
});
