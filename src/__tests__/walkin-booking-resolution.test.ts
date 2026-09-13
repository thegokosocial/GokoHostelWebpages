import { describe, expect, it } from "vitest";
import { bookingReference, getCheckinBookingMatch, isWalkinBookingCheckin } from "@/lib/bookingResolution";

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 1, guestName: "Guest One", contact: "+91 9876543210", status: "received", checkinDate: "2026-09-13", checkoutDate: "2026-09-15", ...overrides,
});

describe("walk-in booking resolution", () => {
  it("only treats active walk-in/offline check-ins as candidates", () => {
    expect(isWalkinBookingCheckin({ status: "active", bookingPlatform: "Walk-in", arrivalDate: "2026-09-13" })).toBe(true);
    expect(isWalkinBookingCheckin({ status: "checked_out", bookingPlatform: "Walk-in", arrivalDate: "2026-09-13" })).toBe(false);
    expect(isWalkinBookingCheckin({ status: "active", bookingPlatform: "Booking.com", arrivalDate: "2026-09-13" })).toBe(false);
  });

  it("matches by stable reference before identity", () => {
    const result = getCheckinBookingMatch({ status: "active", bookingPlatform: "Walk-in", bookingId: "SELF-1", arrivalDate: "2026-09-13", stayingDays: "2", name: "Other", contact: "" }, [booking({ bookingRef: "SELF-1", guestName: "Guest One" })]);
    expect(result?.method).toBe("reference");
  });

  it("matches a unique phone/date candidate and leaves ambiguity unresolved", () => {
    const checkin = { status: "active", bookingPlatform: "Walk-in", arrivalDate: "2026-09-13", stayingDays: "2", name: "Guest One", contact: "9876543210" };
    expect(getCheckinBookingMatch(checkin, [booking()])?.method).toBe("phone");
    expect(getCheckinBookingMatch(checkin, [booking(), booking({ id: 2 })])).toBeNull();
  });

  it("uses a stable reference for linked bookings", () => {
    expect(bookingReference({ bookingRef: "", gokoBookingId: "GOKO-1", cmBookingId: "CM-1" })).toBe("GOKO-1");
  });
});
