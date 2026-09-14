import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  getChannelConfig: vi.fn(),
  getRoomTypeMappings: vi.fn(),
  getRatePlanMappings: vi.fn(),
  getAllDailyRates: vi.fn(),
  updateChannelSyncTime: vi.fn(),
  getActiveAssignmentCountForDorm: vi.fn(),
  getOnlineAssignmentCountForDorm: vi.fn(),
  getBlockedBedIdsForDate: vi.fn(),
  getInventoryOverrideForDormDate: vi.fn(),
  markInventoryDirty: vi.fn(),
  getDirtyInventory: vi.fn(),
  clearDirtyInventory: vi.fn(),
  getUnassignedOtaRoomCountForDorm: vi.fn(),
  getAvailabilitySnapshot: vi.fn(),
}));

const pushInventory = vi.hoisted(() => vi.fn());
const getAiosellPropertyDetails = vi.hoisted(() => vi.fn());

vi.mock("@/db/queries", () => queryMocks);
vi.mock("@/db", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: async () => [{ count: 12 }],
      }),
    }),
  })),
}));
vi.mock("@/lib/aiosell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aiosell")>();
  return {
    ...actual,
    pushInventory,
    getAiosellPropertyDetails,
    pushRates: vi.fn(),
    pushRateRestrictions: vi.fn(),
    pushInventoryRestrictions: vi.fn(),
  };
});
vi.mock("@/lib/pmsLog", () => ({
  logPmsCall: vi.fn(),
}));

import { getDateAwareAvailability, getDateAwareAvailabilityRange, otaFingerprint, pushIfOtaChanged, triggerInventoryPush } from "@/lib/aiosellSync";
import { logPmsCall } from "@/lib/pmsLog";

const CONFIG = {
  isActive: 1,
  autoPushInventory: 1,
  hotelCode: "GOKO-001",
  pmsId: "goko-pms",
  apiBaseUrl: "https://live.aiosell.com",
  apiUsername: "aiosell",
  apiPassword: "secret",
};

const mappings = [
  { id: 1, dormId: 8, channelRoomCode: "executive", isActive: 1 },
  { id: 2, dormId: 9, channelRoomCode: "dorm-6", isActive: 1 },
];

describe("getDateAwareAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMocks.getRoomTypeMappings.mockResolvedValue([]);
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(0);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(0);
    queryMocks.getInventoryOverrideForDormDate.mockResolvedValue(null);
    queryMocks.getUnassignedOtaRoomCountForDorm.mockResolvedValue(0);
  });

  it("is physical minus blocks minus assignments, capped by online ceiling", async () => {
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([1, 2]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(3);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(1);
    queryMocks.getInventoryOverrideForDormDate.mockResolvedValue({ onlineAvailable: 5 });
    // 12 - 2 blocked - 3 assigned = 7 physical free; ceiling 5 - 1 online assigned = 4
    expect(await getDateAwareAvailability(8, "2026-09-05")).toBe(4);
  });

  it("holds unassigned OTA rooms against the online ceiling, not physical leftover", async () => {
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([1, 2]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(3);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(1);
    queryMocks.getInventoryOverrideForDormDate.mockResolvedValue({ onlineAvailable: 5 });
    queryMocks.getUnassignedOtaRoomCountForDorm.mockResolvedValue(2);
    // physical 7; ceiling 5 - 1 assigned - 2 unassigned OTA = 2
    expect(await getDateAwareAvailability(8, "2026-09-05")).toBe(2);
  });

  it("no override: blocked beds come out of the OTA ceiling so unblock raises what we push", async () => {
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([10, 11, 12]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(5);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(5);
    queryMocks.getUnassignedOtaRoomCountForDorm.mockResolvedValue(4);
    // 12-3-5=4 leftover; ceiling 9 - 9 held = 0 OTA
    expect(await getDateAwareAvailability(8, "2026-08-31")).toBe(0);

    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([12]);
    // 12-1-5=6 leftover; ceiling 11 - 9 held = 2 OTA (the two unblocked beds)
    expect(await getDateAwareAvailability(8, "2026-08-31")).toBe(2);
  });

  it("never goes below zero when everything is taken", async () => {
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([1, 2, 3, 4, 5, 6]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(10);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(9);
    expect(await getDateAwareAvailability(8, "2026-09-05")).toBe(0);
  });

  it("reports double-bed room inventory as rooms rather than sleeping positions", async () => {
    queryMocks.getRoomTypeMappings.mockResolvedValue([
      { dormId: 8, totalInventory: 4, isActive: 1 },
    ]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(2);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(2);
    // Eight local sleeping positions represent four double rooms; two assigned positions consume one room.
    expect(await getDateAwareAvailability(8, "2026-09-05")).toBe(3);
  });

  it("calculates a date range from one availability snapshot", async () => {
    queryMocks.getAvailabilitySnapshot.mockResolvedValue([
      Array.from({ length: 8 }, (_, i) => ({ id: i + 1, dormId: 8, bedId: `DOR-${i + 1}`, type: "Double" })),
      [
        { bedId: 1, dormId: 8, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "online" },
        { bedId: 2, dormId: 8, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", inventoryPool: "online" },
      ],
      [], [], [],
    ]);
    const values = await getDateAwareAvailabilityRange(
      [{ dormId: 8, channelRoomCode: "double", totalInventory: 4 }],
      ["2026-09-05", "2026-09-06"],
    );
    expect(queryMocks.getAvailabilitySnapshot).toHaveBeenCalledOnce();
    expect(values.get("8:2026-09-05")).toBe(3);
    expect(values.get("8:2026-09-06")).toBe(4);
  });
});

describe("triggerInventoryPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiosellPropertyDetails.mockResolvedValue({ success: true, details: { hotel_id: "GOKO-001", rooms: mappings.map((m) => ({ room_id: m.channelRoomCode, active: true })) } });
    queryMocks.getChannelConfig.mockResolvedValue(CONFIG);
    queryMocks.getRoomTypeMappings.mockResolvedValue(mappings);
    queryMocks.markInventoryDirty.mockResolvedValue(undefined);
    queryMocks.updateChannelSyncTime.mockResolvedValue(undefined);
    queryMocks.getDirtyInventory.mockResolvedValue([]);
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(2);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(1);
    queryMocks.getInventoryOverrideForDormDate.mockResolvedValue(null);
    queryMocks.getUnassignedOtaRoomCountForDorm.mockResolvedValue(0);
    pushInventory.mockResolvedValue({ success: true });
  });

  it("returns immediately on an empty date list without touching D1", async () => {
    await triggerInventoryPush([]);
    expect(queryMocks.getChannelConfig).not.toHaveBeenCalled();
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("marks dirty then skips Aiosell when autoPushInventory is off", async () => {
    queryMocks.getChannelConfig.mockResolvedValue({ ...CONFIG, autoPushInventory: 0 });
    await triggerInventoryPush(["2026-09-05"]);
    expect(queryMocks.markInventoryDirty).toHaveBeenCalled();
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("skips Aiosell when the channel is inactive", async () => {
    queryMocks.getChannelConfig.mockResolvedValue({ ...CONFIG, isActive: 0 });
    await triggerInventoryPush(["2026-09-05"]);
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("skips Aiosell when no room mappings exist", async () => {
    queryMocks.getRoomTypeMappings.mockResolvedValue([]);
    await triggerInventoryPush(["2026-09-05"]);
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("pushes only the affected mapped dorm", async () => {
    await triggerInventoryPush(["2026-09-05"], 8);
    expect(pushInventory).toHaveBeenCalledTimes(1);
    const updates = pushInventory.mock.calls[0][1];
    expect(updates).toEqual([{
      startDate: "2026-09-05",
      endDate: "2026-09-05",
      rooms: [{ roomCode: "executive", available: 10 }],
    }]);
    expect(pushInventory.mock.calls[0][3]).toBe("auto");
  });

  it("pushes saved mappings without fetching Property Details", async () => {
    getAiosellPropertyDetails.mockResolvedValue({ success: true, details: { hotel_id: "GOKO-001", rooms: [{ room_id: "suite", active: true }] } });
    const result = await triggerInventoryPush(["2026-09-05"], 8);
    expect(result).toMatchObject({ attempted: true, accepted: true });
    expect(pushInventory).toHaveBeenCalledTimes(1);
    expect(getAiosellPropertyDetails).not.toHaveBeenCalled();
  });

  it("does not push an unmapped dorm", async () => {
    await triggerInventoryPush(["2026-09-05"], 99);
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("clears dirty rows for the nights actually sent", async () => {
    queryMocks.getDirtyInventory.mockResolvedValue([
      { id: 1, dormId: 8, date: "2026-09-05" },
      { id: 2, dormId: 8, date: "2026-09-06" },
      { id: 3, dormId: 9, date: "2026-09-05" },
    ]);
    await triggerInventoryPush(["2026-09-05"], 8);
    expect(queryMocks.clearDirtyInventory).toHaveBeenCalledWith([1]);
  });

  it("keeps remote success when local dirty cleanup fails", async () => {
    queryMocks.getDirtyInventory.mockResolvedValue([{ id: 1, dormId: 8, date: "2026-09-05" }]);
    queryMocks.clearDirtyInventory.mockRejectedValue(new Error("cleanup failed"));

    await expect(triggerInventoryPush(["2026-09-05"], 8)).resolves.toMatchObject({
      attempted: true,
      accepted: true,
      message: expect.stringMatching(/Aiosell accepted inventory/i),
    });
  });

  it("logs inventory (auto) when push throws", async () => {
    queryMocks.getChannelConfig.mockRejectedValue(new Error("boom"));
    await triggerInventoryPush(["2026-09-05"]);
    expect(pushInventory).not.toHaveBeenCalled();
    expect(logPmsCall).toHaveBeenCalledWith(expect.objectContaining({
      type: "inventory (auto)",
      status: "failed",
    }));
  });
});

describe("pushIfOtaChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiosellPropertyDetails.mockResolvedValue({ success: true, details: { hotel_id: "GOKO-001", rooms: mappings.map((m) => ({ room_id: m.channelRoomCode, active: true })) } });
    queryMocks.getChannelConfig.mockResolvedValue(CONFIG);
    queryMocks.getRoomTypeMappings.mockResolvedValue(mappings);
    queryMocks.markInventoryDirty.mockResolvedValue(undefined);
    queryMocks.getDirtyInventory.mockResolvedValue([]);
    queryMocks.getBlockedBedIdsForDate.mockResolvedValue([]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(2);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(1);
    queryMocks.getInventoryOverrideForDormDate.mockResolvedValue(null);
    queryMocks.getUnassignedOtaRoomCountForDorm.mockResolvedValue(0);
    pushInventory.mockResolvedValue({ success: true });
  });

  it("does not push when the fingerprint is unchanged", async () => {
    const before = await otaFingerprint([8], ["2026-09-05"]);
    await pushIfOtaChanged(before, [8], ["2026-09-05"]);
    expect(pushInventory).not.toHaveBeenCalled();
  });

  it("pushes when availability changed", async () => {
    const before = await otaFingerprint([8], ["2026-09-05"]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(4);
    await pushIfOtaChanged(before, [8], ["2026-09-05"]);
    expect(pushInventory).toHaveBeenCalled();
    expect(pushInventory.mock.calls[0][1][0].rooms).toEqual([{ roomCode: "executive", available: 8 }]);
  });

  it("does not let unrelated invalid mappings block an affected valid dorm", async () => {
    getAiosellPropertyDetails.mockResolvedValue({ success: true, details: { hotel_id: "GOKO-001", rooms: [{ room_id: "executive", active: true }] } });
    const before = await otaFingerprint([8], ["2026-09-05"]);
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(1);
    const result = await pushIfOtaChanged(before, [8], ["2026-09-05"]);
    expect(result).toMatchObject({ attempted: true, accepted: true });
    expect(pushInventory.mock.calls[0][1][0].rooms).toEqual([{ roomCode: "executive", available: 11 }]);
  });

  it("releases two cancelled beds in one inventory request with the final availability", async () => {
    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(4);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(4);
    const before = await otaFingerprint([8], ["2026-09-05"]);

    queryMocks.getActiveAssignmentCountForDorm.mockResolvedValue(2);
    queryMocks.getOnlineAssignmentCountForDorm.mockResolvedValue(2);
    await pushIfOtaChanged(before, [8], ["2026-09-05"]);

    expect(pushInventory).toHaveBeenCalledTimes(1);
    expect(pushInventory.mock.calls[0][1]).toEqual([{
      startDate: "2026-09-05",
      endDate: "2026-09-05",
      rooms: expect.arrayContaining([{ roomCode: "executive", available: 10 }]),
    }]);
  });

  it("skips empty dates or dorms", async () => {
    await pushIfOtaChanged("x", [], ["2026-09-05"]);
    await pushIfOtaChanged("x", [8], []);
    expect(pushInventory).not.toHaveBeenCalled();
  });
});
