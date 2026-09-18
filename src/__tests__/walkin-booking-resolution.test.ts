import { describe, expect, it } from "vitest";
import {
  bookingReference,
  checkinLinksBooking,
  getCheckinBookingMatch,
  isManualWalkinBooking,
  isRecordsLinkedWalkinBooking,
  isWalkinBookingCheckin,
  liveBookingCoversResolution,
  resolutionNeedsReopen,
} from "@/lib/bookingResolution";
import { tagBedsForPicker } from "@/lib/inventoryAvailability";

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 1, guestName: "Guest One", contact: "+91 9876543210", status: "received", checkinDate: "2026-09-13", checkoutDate: "2026-09-15", source: "manual", platform: "walkin", ...overrides,
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

  it("detects Records-linked manual walk-in bookings and ignores OTA", () => {
    const checkin = { status: "active", bookingPlatform: "Walk-in", bookingId: "GOKO202609178DEBXV", arrivalDate: "2026-09-17" };
    expect(isManualWalkinBooking({ source: "manual", platform: "walkin" })).toBe(true);
    expect(isManualWalkinBooking({ source: "channel_manager", platform: "Booking.com" })).toBe(false);
    expect(isRecordsLinkedWalkinBooking(
      { source: "manual", platform: "walkin", bookingRef: "GOKO202609178DEBXV", gokoBookingId: "GOKO20260918CIVOK4" },
      [checkin],
    )).toBe(true);
    expect(isRecordsLinkedWalkinBooking(
      { source: "manual", platform: "walkin", bookingRef: "", gokoBookingId: "GOKO-NEW" },
      [checkin],
    )).toBe(false);
    expect(checkinLinksBooking(checkin, { bookingRef: "GOKO202609178DEBXV" })).toBe(true);
  });

  it("reopens resolution when created/linked but no live booking remains", () => {
    expect(resolutionNeedsReopen("created")).toBe(true);
    expect(resolutionNeedsReopen("pending")).toBe(false);
    const checkin = { bookingId: "GOKO1", bookingLinkedRef: "", bookingResolution: "created" as string };
    expect(liveBookingCoversResolution(checkin, [booking({ bookingRef: "GOKO1", status: "cancelled" })])).toBe(false);
    expect(liveBookingCoversResolution(checkin, [booking({ bookingRef: "GOKO1", status: "received" })])).toBe(true);
  });
});

describe("past-night picker tagging", () => {
  it("tags fully past stays as offline even when OTA holds would zero online inventory", () => {
    const beds = [
      { id: 1, dormId: 1, bedId: "A1" },
      { id: 2, dormId: 1, bedId: "A2" },
    ];
    const holds = [{ dormId: 1, date: "2026-09-17", rooms: 2 }];
    const tagged = tagBedsForPicker(beds, [], beds, ["2026-09-17"], [], [], [], holds, "2026-09-18");
    expect(tagged.every((b) => b.pool === "offline")).toBe(true);
    expect(tagged).toHaveLength(2);
  });
});
