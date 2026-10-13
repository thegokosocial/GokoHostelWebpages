import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({
  getReleasedBookingsEligibleForAutoNoShow: vi.fn(), getBookingDetail: vi.fn(), getRoomTypeMappings: vi.fn(),
  transitionBookingStatus: vi.fn(), unassignBookingBeds: vi.fn(), updateBookingFull: vi.fn(), addBookingHistoryEntry: vi.fn(),
  getChannelConfig: vi.fn(), pushNoShow: vi.fn(), otaFingerprint: vi.fn(), pushIfOtaChanged: vi.fn(), dispatchPush: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  getReleasedBookingsEligibleForAutoNoShow: q.getReleasedBookingsEligibleForAutoNoShow, getBookingDetail: q.getBookingDetail,
  getRoomTypeMappings: q.getRoomTypeMappings, transitionBookingStatus: q.transitionBookingStatus,
  unassignBookingBeds: q.unassignBookingBeds, updateBookingFull: q.updateBookingFull, addBookingHistoryEntry: q.addBookingHistoryEntry,
  getChannelConfig: q.getChannelConfig,
}));
vi.mock("@/lib/aiosell", () => ({ pushNoShow: q.pushNoShow }));
vi.mock("@/lib/aiosellSync", () => ({ otaFingerprint: q.otaFingerprint, pushIfOtaChanged: q.pushIfOtaChanged }));
vi.mock("@/lib/pushNotify", () => ({ dispatchPush: q.dispatchPush, notificationDate: (date: string) => date, notificationFirstName: () => "Guest" }));

import { runAutomaticNoShows } from "@/lib/autoNoShow";

describe("automatic no-show workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.getReleasedBookingsEligibleForAutoNoShow.mockResolvedValue([{ id: 42, platform: "booking.com" }]);
    q.getBookingDetail.mockResolvedValue({ booking: {
      id: 42, status: "guest_declined", source: "channel_manager", platform: "booking.com", bookingRef: "BK-42",
      guestName: "Guest Name", checkinDate: "2026-10-13", checkoutDate: "2026-10-14", roomType: "Dorm", rawData: "",
    }, assignments: [] });
    q.getRoomTypeMappings.mockResolvedValue([]);
    q.transitionBookingStatus.mockResolvedValue(true);
    q.otaFingerprint.mockResolvedValue("before");
    q.getChannelConfig.mockResolvedValue({ isActive: true, hotelCode: "H", pmsId: "P", apiBaseUrl: "https://example.test", apiUsername: "u", apiPassword: "p" });
    q.pushNoShow.mockResolvedValue({ success: true });
    q.pushIfOtaChanged.mockResolvedValue(undefined);
  });

  it("atomically closes a released Booking.com stay and records a system audit entry without a refund", async () => {
    await expect(runAutomaticNoShows("2026-10-14")).resolves.toEqual({ scanned: 1, marked: 1, skipped: 0 });
    expect(q.transitionBookingStatus).toHaveBeenCalledWith(42, ["guest_declined"], { status: "no_show" });
    expect(q.unassignBookingBeds).toHaveBeenCalledWith(42);
    expect(q.addBookingHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42, action: "Auto-marked No-Show", performedBy: "system",
    }));
    expect(q.pushNoShow).toHaveBeenCalledWith(expect.objectContaining({ pmsId: "P" }), "BK-42");
  });

  it("skips non-Booking.com legacy rows without changing their status", async () => {
    q.getReleasedBookingsEligibleForAutoNoShow.mockResolvedValue([{ id: 9, platform: "hostelworld" }]);
    await expect(runAutomaticNoShows("2026-10-14")).resolves.toEqual({ scanned: 1, marked: 0, skipped: 1 });
    expect(q.transitionBookingStatus).not.toHaveBeenCalled();
  });
});
