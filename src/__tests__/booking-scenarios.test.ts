import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { stayNightCount } from "@/lib/inventoryAvailability";
import { getNights, calculateTax } from "@/components/admin/booking-dashboard/utils";
import { stringifyGokoWalkin } from "@/lib/bookingPricing";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getCalendarAvailability: vi.fn(),
  getBookingCalendarData: vi.fn(),
  getBookingTableData: vi.fn(),
  getBookingDetail: vi.fn(),
  searchBookings: vi.fn(),
  getUnassignedBookings: vi.fn(),
  checkBedAvailability: vi.fn(),
  getAvailableBedsForRange: vi.fn(),
  validateBedsForRange: vi.fn(),
  assignBedToBooking: vi.fn(),
  unassignBookingBeds: vi.fn(),
  unassignBookingBedsByBedIds: vi.fn(),
  cancelBedAssignments: vi.fn(),
  addBookingHistoryEntry: vi.fn(),
  getBookingHistoryEntries: vi.fn(),
  addBooking: vi.fn(),
  updateBookingFull: vi.fn(),
  getAllDorms: vi.fn(),
  getAllBeds: vi.fn(),
  getBedById: vi.fn(),
  getChannelConfig: vi.fn(),
  getSetting: vi.fn(),
  getActiveBedBlocks: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getRatePlanMappings: vi.fn(),
  getAllDailyRates: vi.fn(),
  deactivateBedBlocksByBedIds: vi.fn(),
  shortenAssignedCheckout: vi.fn(),
  pushNoShow: vi.fn(),
  resolveReceiptAccount: vi.fn(),
  createGuestReceipt: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/aiosellSync", () => ({
  otaFingerprint: vi.fn(async () => "fp"),
  pushIfOtaChanged: vi.fn(async () => undefined),
}));
vi.mock("@/lib/aiosell", () => ({ pushNoShow: q.pushNoShow }));
vi.mock("@/lib/guestReceipts", () => ({
  createGuestReceipt: q.createGuestReceipt,
  resolveReceiptAccount: q.resolveReceiptAccount,
  latestReceiptAccount: vi.fn(),
}));
vi.mock("@/db/queries", () => ({
  getCalendarAvailability: q.getCalendarAvailability,
  getBookingCalendarData: q.getBookingCalendarData,
  getBookingTableData: q.getBookingTableData,
  getBookingDetail: q.getBookingDetail,
  searchBookings: q.searchBookings,
  getUnassignedBookings: q.getUnassignedBookings,
  checkBedAvailability: q.checkBedAvailability,
  getAvailableBedsForRange: q.getAvailableBedsForRange,
  validateBedsForRange: q.validateBedsForRange,
  assignBedToBooking: q.assignBedToBooking,
  unassignBookingBeds: q.unassignBookingBeds,
  unassignBookingBedsByBedIds: q.unassignBookingBedsByBedIds,
  cancelBedAssignments: q.cancelBedAssignments,
  addBookingHistoryEntry: q.addBookingHistoryEntry,
  getBookingHistoryEntries: q.getBookingHistoryEntries,
  addBooking: q.addBooking,
  updateBookingFull: q.updateBookingFull,
  getAllDorms: q.getAllDorms,
  getAllBeds: q.getAllBeds,
  getBedById: q.getBedById,
  getChannelConfig: q.getChannelConfig,
  getSetting: q.getSetting,
  getActiveBedBlocks: q.getActiveBedBlocks,
  getRoomTypeMappings: q.getRoomTypeMappings,
  getRatePlanMappings: q.getRatePlanMappings,
  getAllDailyRates: q.getAllDailyRates,
  deactivateBedBlocksByBedIds: q.deactivateBedBlocksByBedIds,
  shortenAssignedCheckout: q.shortenAssignedCheckout,
}));

import { POST } from "@/app/api/admin/bookings/route";
import { pushIfOtaChanged } from "@/lib/aiosellSync";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };

function priced(rate: number, nights: number, beds: number) {
  const before = rate * nights * beds;
  return { ...calculateTax(before), nights, beds, before };
}

function tagBeds(ids: number[], pool: "online" | "offline" = "online") {
  return ids.map((id) => ({
    id,
    bedId: `E${id}`,
    dormId: 9,
    dormName: "Executive",
    pool,
  }));
}

function mockBeds(ids: number[]) {
  q.getBedById.mockImplementation(async (id: number) => {
    if (!ids.includes(id)) return null;
    return { id, bedId: `E${id}`, dormId: 9, dormName: "Executive" };
  });
  q.getAvailableBedsForRange.mockResolvedValue(tagBeds(ids));
  q.validateBedsForRange.mockResolvedValue(null);
  q.assignBedToBooking.mockResolvedValue(true);
}

describe("Stay permutations: night math matches UI and server", () => {
  it.each([
    ["1 bed 1 night", "2026-09-05", "2026-09-06", 1],
    ["1 bed 3 nights", "2026-09-05", "2026-09-08", 3],
    ["month wrap", "2026-08-31", "2026-09-02", 2],
    ["year wrap", "2026-12-30", "2027-01-02", 3],
    ["week stay", "2026-09-01", "2026-09-08", 7],
  ] as const)("%s", (_label, ci, co, nights) => {
    expect(stayNightCount(ci, co)).toBe(nights);
    expect(getNights(ci, co)).toBe(nights);
  });

  it("UI tax for 3 people × 4 nights at ₹1000 matches server formula", () => {
    const p = priced(1000, 4, 3);
    expect(p.before).toBe(12000);
    expect(p.tax).toBe(600);
    expect(p.total).toBe(12600);
  });
});

describe("createBooking permutations", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.addBooking.mockResolvedValue(10);
    q.resolveReceiptAccount.mockResolvedValue(22);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it.each([
    ["1 bed 1 night", "2026-09-05", "2026-09-06", [7], 1000, priced(1000, 1, 1)],
    ["1 bed 4 nights", "2026-09-05", "2026-09-09", [7], 800, priced(800, 4, 1)],
    ["3 beds 1 night", "2026-09-05", "2026-09-06", [7, 8, 9], 500, priced(500, 1, 3)],
    ["2 beds 3 nights", "2026-09-05", "2026-09-08", [7, 8], 1200, priced(1200, 3, 2)],
    ["month wrap 2 beds", "2026-08-31", "2026-09-02", [7, 8], 900, priced(900, 2, 2)],
  ] as const)("%s stores persons, nights, and tax", async (_label, ci, co, beds, rate, expectAmt) => {
    mockBeds([...beds]);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Test",
      checkinDate: ci,
      checkoutDate: co,
      nightlyRate: rate,
      bedIds: [...beds],
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      persons: beds.length,
      checkinDate: ci,
      checkoutDate: co,
      nightlyRate: rate,
      amountBeforeTax: expectAmt.before,
      amountTax: expectAmt.tax,
      amountTotal: expectAmt.total,
      source: "manual",
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(beds.length);
    for (const id of beds) {
      expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
        bookingId: 10,
        bedId: id,
        checkinDate: ci,
        checkoutDate: co,
      }));
    }
    expect(pushIfOtaChanged).toHaveBeenCalled();
  });

  it("a one-guest double-room booking reserves one slot at the room price", async () => {
    const doubles = [
      { id: 7, bedId: "D-1", dormId: 9, dormName: "Double Room", type: "Double" },
      { id: 8, bedId: "D-2", dormId: 9, dormName: "Double Room", type: "Double" },
    ];
    q.getAllBeds.mockResolvedValue(doubles);
    q.getBedById.mockImplementation(async (id: number) => doubles.find((bed) => bed.id === id) || null);
    q.getAvailableBedsForRange.mockResolvedValue(doubles.map((bed) => ({ ...bed, pool: "online" })));
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Double Guest",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      persons: 1,
      bedIds: [7],
      unitRates: { "9:double:1": 1000 },
    }));

    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      persons: 1,
      amountBeforeTax: 1000,
      amountTax: 50,
      amountTotal: 1050,
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(1);
    expect(q.validateBedsForRange).toHaveBeenCalledWith([7], "2026-09-05", "2026-09-06", undefined, true);
  });

  it("a two-guest double-room booking reserves both slots at the room price", async () => {
    const doubles = [
      { id: 7, bedId: "D-1", dormId: 9, dormName: "Double Room", type: "Double" },
      { id: 8, bedId: "D-2", dormId: 9, dormName: "Double Room", type: "Double" },
    ];
    q.getAllBeds.mockResolvedValue(doubles);
    q.getBedById.mockImplementation(async (id: number) => doubles.find((bed) => bed.id === id) || null);
    q.getAvailableBedsForRange.mockResolvedValue(doubles.map((bed) => ({ ...bed, pool: "online" })));
    q.validateBedsForRange.mockResolvedValue(null);
    q.assignBedToBooking.mockResolvedValue(true);

    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Double Guest",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      persons: 2,
      bedIds: [7, 8],
      unitRates: { "9:double:1": 1000 },
    }));

    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.validateBedsForRange).toHaveBeenCalledWith([7, 8], "2026-09-05", "2026-09-06", undefined, false);
  });

  it("rejects three guests in one double room", async () => {
    const doubles = [
      { id: 7, bedId: "D-1", dormId: 9, dormName: "Double Room", type: "Double" },
      { id: 8, bedId: "D-2", dormId: 9, dormName: "Double Room", type: "Double" },
    ];
    q.getAllBeds.mockResolvedValue(doubles);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Too Many",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      persons: 3,
      bedIds: [7, 8],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/at most 2/) });
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("rejects checkout on the check-in morning (zero-night)", async () => {
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Test",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-05",
      nightlyRate: 1000,
    }));
    expect(res.status).toBe(400);
    expect(q.addBooking).not.toHaveBeenCalled();
  });

  it("creates an unassigned walk-in when no beds are picked", async () => {
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Walk-in",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      nightlyRate: 700,
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      persons: 1,
      amountBeforeTax: 1400,
      amountTax: 70,
      amountTotal: 1470,
    }));
    expect(q.addBooking.mock.calls[0][0].paymentStatus).toBeUndefined();
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("applies walk-in percent discount then 5% tax on the remainder", async () => {
    mockBeds([7]);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Loyalty",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      nightlyRate: 550,
      bedIds: [7],
      discountPercent: 10,
      discountReason: "Loyalty Guest",
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      amountBeforeTax: 990,
      amountTax: 50,
      amountTotal: 1040,
      rawData: expect.stringContaining("gokoWalkin"),
    }));
  });

  it("applies walk-in amount discount and ignores it for booking_engine", async () => {
    mockBeds([7]);
    const walkin = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Amt",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      nightlyRate: 550,
      bedIds: [7],
      discountAmount: 100,
    }));
    expect(walkin.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      amountBeforeTax: 1000,
      amountTax: 50,
      amountTotal: 1050,
    }));

    q.addBooking.mockClear();
    q.addBooking.mockResolvedValue(11);
    const engine = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Web",
      platform: "booking_engine",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      nightlyRate: 550,
      bedIds: [7],
      discountPercent: 50,
    }));
    expect(engine.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      platform: "booking_engine",
      amountBeforeTax: 1100,
      amountTax: 55,
      amountTotal: 1155,
      rawData: undefined,
    }));
  });

  it("reads booking_tax_rate from settings", async () => {
    q.getSetting.mockResolvedValue("12");
    mockBeds([7]);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Tax",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      bedIds: [7],
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      amountBeforeTax: 1000,
      amountTax: 120,
      amountTotal: 1120,
    }));
  });

  it("stores amountTax 0 when booking_tax_rate is 0", async () => {
    q.getSetting.mockResolvedValue("0");
    mockBeds([7]);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "ZeroTax",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      bedIds: [7],
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      amountBeforeTax: 1000,
      amountTax: 0,
      amountTotal: 1000,
    }));
  });

  it("ignores a client-supplied taxPercent on create", async () => {
    mockBeds([7]);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Sneaky",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
      nightlyRate: 1000,
      bedIds: [7],
      taxPercent: 0,
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      amountBeforeTax: 1000,
      amountTax: 50,
      amountTotal: 1050,
    }));
  });

  it("500s when insert returns no id", async () => {
    q.addBooking.mockResolvedValue(null);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Test",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-06",
    }));
    expect(res.status).toBe(500);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });

  it("does not assign any bed when one of three is missing from the picker, then cancels", async () => {
    mockBeds([7, 8]);
    q.validateBedsForRange.mockResolvedValue(null);
    const res = await POST(req({
      password: "x",
      action: "createBooking",
      guestName: "Group",
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-08",
      nightlyRate: 500,
      bedIds: [7, 8, 9],
    }));
    expect(res.status).toBe(400);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.unassignBookingBeds).not.toHaveBeenCalled();
    expect(q.updateBookingFull).not.toHaveBeenCalled();
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });
});

describe("assignBeds permutations", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("assigns 3 beds for a 5-night channel_manager stay on the online pool with no push", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-10",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    mockBeds([7, 8, 9]);
    const res = await POST(req({
      password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 9],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assigned).toHaveLength(3);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(3);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-10",
      inventoryPool: "online",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("staff assigning leftover offline chips on a channel_manager stay stores offline pool", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-07",
        status: "received",
        source: "channel_manager",
      },
      assignments: [],
    });
    mockBeds([7, 8]);
    q.getAvailableBedsForRange.mockResolvedValue(tagBeds([7, 8], "offline"));
    const res = await POST(req({
      password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8],
    }));
    expect(res.status).toBe(200);
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      checkinDate: "2026-09-05",
      checkoutDate: "2026-09-07",
      inventoryPool: "offline",
    }));
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
  });

  it("409s a 2-of-3 pick without inserting any assignment", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
      },
      assignments: [],
    });
    mockBeds([7, 8]);
    const res = await POST(req({
      password: "x", action: "assignBeds", bookingId: 42, bedIds: [7, 8, 9],
    }));
    expect(res.status).toBe(409);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
  });
});

describe("date change permutations", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.checkBedAvailability.mockResolvedValue(true);
    vi.mocked(pushIfOtaChanged).mockReset();
    vi.mocked(pushIfOtaChanged).mockResolvedValue(undefined);
  });

  it("late check-in on a 3-night 2-bed stay shortens nights and amount", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-08",
        status: "received",
        source: "manual",
        nightlyRate: 1000,
      },
      assignments: [
        { id: 1, status: "assigned", bedId: 7, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online" },
        { id: 2, status: "assigned", bedId: 8, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "online" },
      ],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckin", bookingId: 5, newCheckinDate: "2026-09-06",
    }));
    expect(res.status).toBe(200);
    const p = priced(1000, 2, 2);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      checkinDate: "2026-09-06",
      checkoutDate: "2026-09-08",
      amountBeforeTax: p.before,
      amountTax: p.tax,
      amountTotal: p.total,
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledTimes(2);
  });

  it("extend checkout on a 1-bed 1-night stay to 4 nights", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
        nightlyRate: 800,
      },
      assignments: [
        { id: 1, status: "assigned", bedId: 7, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "offline" },
      ],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckout", bookingId: 5, newCheckoutDate: "2026-09-09",
    }));
    expect(res.status).toBe(200);
    const p = priced(800, 4, 1);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      checkoutDate: "2026-09-09",
      amountBeforeTax: p.before,
      amountTotal: p.total,
    }));
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({
      checkoutDate: "2026-09-09",
      inventoryPool: "offline",
    }));
  });

  it("does not extend a channel_manager stay with an Aiosell occupancy push", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
        nightlyRate: 3700,
      },
      assignments: [
        { id: 1, status: "assigned", bedId: 7, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "online" },
      ],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckout", bookingId: 5, newCheckoutDate: "2026-09-08",
    }));
    expect(res.status).toBe(200);
    expect(pushIfOtaChanged).not.toHaveBeenCalled();
    expect(q.assignBedToBooking).toHaveBeenCalledWith(expect.objectContaining({ inventoryPool: "online" }));
  });

  it("re-applies a walk-in percent discount when checkout is extended", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-07",
        status: "received",
        source: "manual",
        nightlyRate: 550,
        rawData: stringifyGokoWalkin({
          discount: 110,
          discountPercent: 10,
          discountReason: "Loyalty Guest",
          taxPercent: 5,
        }),
      },
      assignments: [
        { id: 1, status: "assigned", bedId: 7, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-07", inventoryPool: "offline" },
      ],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckout", bookingId: 5, newCheckoutDate: "2026-09-09",
    }));
    expect(res.status).toBe(200);
    // gross 550*4*1=2200, 10% = 220, taxable 1980, tax 99
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      checkoutDate: "2026-09-09",
      amountBeforeTax: 1980,
      amountTax: 99,
      amountTotal: 2079,
    }));
    const saved = JSON.parse(q.updateBookingFull.mock.calls[0][1].rawData);
    expect(saved.gokoWalkin.discount).toBe(220);
    expect(saved.gokoWalkin.discountPercent).toBe(10);
  });

  it("caps a walk-in amount discount when the stay is shortened", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-08",
        status: "received",
        source: "manual",
        nightlyRate: 500,
        rawData: stringifyGokoWalkin({
          discount: 1200,
          discountAmount: 1200,
          taxPercent: 5,
        }),
      },
      assignments: [
        { id: 1, status: "assigned", bedId: 7, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-08", inventoryPool: "offline" },
      ],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckout", bookingId: 5, newCheckoutDate: "2026-09-06",
    }));
    expect(res.status).toBe(200);
    // gross 500*1=500, amount 1200 capped to 500, tax 0
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      amountBeforeTax: 0,
      amountTax: 0,
      amountTotal: 0,
    }));
  });

  it("does not treat Aiosell rawData as a walk-in discount on date change", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "channel_manager",
        nightlyRate: 1000,
        rawData: JSON.stringify({ action: "book", rooms: [{ roomCode: "executive" }] }),
      },
      assignments: [
        { id: 1, status: "assigned", bedId: 7, dormId: 9, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "online" },
      ],
    });
    q.assignBedToBooking.mockResolvedValue(true);
    const res = await POST(req({
      password: "x", action: "modifyCheckout", bookingId: 5, newCheckoutDate: "2026-09-08",
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      amountBeforeTax: 3000,
      amountTax: 150,
      amountTotal: 3150,
    }));
    expect(q.updateBookingFull.mock.calls[0][1]).not.toHaveProperty("rawData");
  });

  it("editReservation exclusive tax uses booking_tax_rate not 12%", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: {
        checkinDate: "2026-09-05",
        checkoutDate: "2026-09-06",
        status: "received",
        source: "manual",
        rawData: stringifyGokoWalkin({
          discount: 110,
          discountPercent: 10,
          discountReason: "Loyalty Guest",
          taxPercent: 5,
        }),
      },
      assignments: [],
    });
    const res = await POST(req({
      password: "x",
      action: "editReservation",
      bookingId: 5,
      taxMode: "exclusive",
      amountBeforeTax: 1000,
    }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(5, expect.objectContaining({
      amountBeforeTax: 1000,
      amountTax: 50,
      amountTotal: 1050,
    }));
    const saved = JSON.parse(q.updateBookingFull.mock.calls[0][1].rawData);
    expect(saved.gokoWalkin.discount).toBe(0);
    expect(saved.gokoWalkin.discountPercent).toBeUndefined();
  });
});

describe("walk-in advance payment", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.addBooking.mockResolvedValue(10);
    q.resolveReceiptAccount.mockResolvedValue(22);
  });

  it("records a cash advance and leaves the calculated balance", async () => {
    const res = await POST(req({
      password: "x", action: "createBooking", guestName: "Cash Guest",
      checkinDate: "2026-09-05", checkoutDate: "2026-09-06", nightlyRate: 1000,
      advanceAmount: 400, advancePaymentMethod: "cash",
    }));
    expect(res.status).toBe(200);
    expect(q.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      amountTotal: 1050, amountPaid: 400, paymentStatus: "paid", paymentMethod: "cash", cashReceived: 400,
    }));
    expect(q.createGuestReceipt).not.toHaveBeenCalled();
  });

  it("records an online advance with a room receipt account", async () => {
    const res = await POST(req({
      password: "x", action: "createBooking", guestName: "Online Guest",
      checkinDate: "2026-09-05", checkoutDate: "2026-09-06", nightlyRate: 1000,
      advanceAmount: 500, advancePaymentMethod: "online", advanceOnlineAccountId: 22,
    }));
    expect(res.status).toBe(200);
    expect(q.resolveReceiptAccount).toHaveBeenCalledWith("room", 22);
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 10, kind: "stay", accountId: 22, amount: 500 }));
  });

  it("does not create an online receipt when bed assignment fails", async () => {
    mockBeds([7]);
    q.assignBedToBooking.mockResolvedValue(false);
    const res = await POST(req({
      password: "x", action: "createBooking", guestName: "Conflict Guest",
      checkinDate: "2026-09-05", checkoutDate: "2026-09-06", nightlyRate: 1000,
      bedIds: [7], advanceAmount: 500, advancePaymentMethod: "online", advanceOnlineAccountId: 22,
    }));
    expect(res.status).toBe(409);
    expect(q.createGuestReceipt).not.toHaveBeenCalled();
  });

  it("rejects invalid, over-total, and engine-booking advances", async () => {
    const over = await POST(req({
      password: "x", action: "createBooking", guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", nightlyRate: 1000,
      advanceAmount: 1051, advancePaymentMethod: "cash",
    }));
    expect(over.status).toBe(400);
    const engine = await POST(req({
      password: "x", action: "createBooking", guestName: "Guest", platform: "booking_engine", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", nightlyRate: 1000,
      advanceAmount: 100, advancePaymentMethod: "cash",
    }));
    expect(engine.status).toBe(400);
  });

  it("does not allow an edit to reduce the total below collected money", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual", amountTotal: 1050, amountPaid: 500 },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, amountTotal: 400 }));
    expect(res.status).toBe(400);
    expect(q.updateBookingFull).not.toHaveBeenCalled();
  });

  it("allows a manual booking payment correction down to zero without a refund", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual", amountTotal: 1050, amountPaid: 500, paymentMethod: "cash", cashReceived: 500 },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, amountPaid: 0, paymentAdjustment: "correction" }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(10, expect.objectContaining({ amountPaid: 0, paymentStatus: "unknown", paymentMethod: "" }));
    expect(q.createGuestReceipt).not.toHaveBeenCalled();
  });

  it("records an online payment adjustment and receipt when editing amount received upward", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual", amountTotal: 1050, amountPaid: 400, paymentMethod: "cash", cashReceived: 400 },
      assignments: [],
    });
    q.resolveReceiptAccount.mockResolvedValue(22);
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, amountPaid: 600, paymentAdjustment: "payment", paymentMethod: "online", onlineAccountId: 22, receiptId: "receipt-1" }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(10, expect.objectContaining({ amountPaid: 600, paymentMethod: "split" }));
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 10, kind: "stay", accountId: 22, amount: 200, receiptId: "receipt-1" }));
  });

  it("records a refund adjustment and negative online receipt when editing amount received downward", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual", amountTotal: 1050, amountPaid: 500, paymentMethod: "online", cashReceived: 0 },
      assignments: [],
    });
    q.resolveReceiptAccount.mockResolvedValue(22);
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, amountPaid: 300, paymentAdjustment: "refund", refundMethod: "online", onlineAccountId: 22, receiptId: "refund-1" }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(10, expect.objectContaining({ amountPaid: 300, amountRefunded: 200, refundMethod: "online" }));
    expect(q.createGuestReceipt).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 10, kind: "refund", accountId: 22, amount: -200, receiptId: "refund-1" }));
  });

  it("validates a changed booking total against the edited final amount received", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual", amountTotal: 1050, amountPaid: 500, paymentMethod: "cash", cashReceived: 500 },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, amountTotal: 400, amountPaid: 300, paymentAdjustment: "correction" }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(10, expect.objectContaining({ amountTotal: 400, amountPaid: 300 }));
  });

  it("does not reprice a booking when the edit submits the unchanged nightly rate", async () => {
    q.getSetting.mockResolvedValue("0");
    q.getBookingDetail.mockResolvedValue({
      booking: {
        id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received",
        source: "manual", nightlyRate: 1350, amountBeforeTax: 1286, amountTax: 64, amountTotal: 1350, amountPaid: 1350,
        rawData: stringifyGokoWalkin({ discount: 64, taxPercent: 5 }),
      },
      assignments: [],
    });
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, guestName: "Renamed Guest", nightlyRate: 1350 }));
    expect(res.status).toBe(200);
    expect(q.updateBookingFull).toHaveBeenCalledWith(10, expect.objectContaining({ guestName: "Renamed Guest" }));
    expect(q.updateBookingFull).not.toHaveBeenCalledWith(10, expect.objectContaining({ amountTotal: expect.anything() }));
  });

  it("rejects an invalid total before changing beds", async () => {
    q.getBookingDetail.mockResolvedValue({
      booking: { id: 10, guestName: "Guest", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "received", source: "manual", amountTotal: 1050, amountPaid: 500 },
      assignments: [{ id: 1, status: "assigned", bedId: 7, dormId: 9 }],
    });
    const res = await POST(req({ password: "x", action: "editReservation", bookingId: 10, amountTotal: 400, addBedIds: [9] }));
    expect(res.status).toBe(400);
    expect(q.assignBedToBooking).not.toHaveBeenCalled();
    expect(q.cancelBedAssignments).not.toHaveBeenCalled();
  });
});

describe("calendar nights enrichment", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.authenticateUser.mockResolvedValue(admin);
    q.getAllDorms.mockResolvedValue([]);
    q.getAllBeds.mockResolvedValue([]);
    q.getCalendarAvailability.mockResolvedValue({ beds: {}, dorms: {} });
  });

  it("annotates 1-night, multi-night, and year-wrap stays", async () => {
    q.getBookingCalendarData.mockResolvedValue({
      bookings: [
        { id: 1, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", amountTotal: 1000, amountPaid: 0 },
        { id: 2, checkinDate: "2026-09-05", checkoutDate: "2026-09-08", amountTotal: 3000, amountPaid: 500 },
        { id: 3, checkinDate: "2026-12-31", checkoutDate: "2027-01-02", amountTotal: 2000, amountPaid: 2000 },
      ],
      assignments: [],
    });
    const res = await POST(req({
      password: "x", action: "getCalendarData", startDate: "2026-09-01", endDate: "2027-01-10",
    }));
    const json = await res.json();
    expect(json.bookings[0]).toMatchObject({ nights: 1, balance: 1000 });
    expect(json.bookings[1]).toMatchObject({ nights: 3, balance: 2500 });
    expect(json.bookings[2]).toMatchObject({ nights: 2, balance: 0 });
  });

  it("returns cancelled and no-show rows through the table-only action", async () => {
    q.getBookingTableData.mockResolvedValue({
      bookings: [
        { id: 1, status: "cancelled", checkinDate: "2026-09-05", checkoutDate: "2026-09-06", amountTotal: 1000, amountPaid: 0 },
        { id: 2, status: "no_show", checkinDate: "2026-09-07", checkoutDate: "2026-09-08", amountTotal: 2000, amountPaid: 500 },
      ],
      total: 2,
      statusCounts: { cancelled: 1, no_show: 1 },
      page: 0,
      pageSize: 50,
    });
    const res = await POST(req({
      password: "x", action: "getAllBookings", startDate: "2026-09-01", endDate: "2026-09-10", status: "all",
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bookings).toEqual([
      expect.objectContaining({ id: 1, status: "cancelled", nights: 1, balance: 1000 }),
      expect.objectContaining({ id: 2, status: "no_show", nights: 1, balance: 1500 }),
    ]);
    expect(q.getBookingTableData).toHaveBeenCalledWith("2026-09-01", "2026-09-10", expect.objectContaining({ status: undefined, page: 0, pageSize: 50 }));
  });
});
