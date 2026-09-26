import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/db", () => ({ getDb }));

import { EMPTY_FOOD_TAB } from "@/lib/foodTab";
import { getPendingFoodTab } from "@/lib/foodTabDb";

function drizzleChain(result: unknown) {
  const p = Promise.resolve(result);
  const grouped = {
    groupBy: () => p,
    then: p.then.bind(p),
    catch: p.catch.bind(p),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => grouped,
      }),
    }),
  };
}

describe("getPendingFoodTab db workflows", () => {
  beforeEach(() => {
    getDb.mockReset();
  });

  it("checkinId with on_tab unpaid sums order rows and returns orderIds", async () => {
    getDb.mockReturnValueOnce(
      drizzleChain([
        { id: 1, checkinId: 10, total: 10000 },
        { id: 2, checkinId: 10, total: 15000 },
        { id: 3, checkinId: 10, total: 0 },
      ]),
    );

    await expect(getPendingFoodTab({ checkinId: 10 })).resolves.toEqual({
      checkinId: 10,
      pendingTab: 25000,
      pendingOrders: 3,
      orderIds: [1, 2, 3],
    });
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("paid-only orders yield pendingTab 0 (SQL would return no on_tab/pending rows)", async () => {
    getDb.mockReturnValueOnce(drizzleChain([]));

    await expect(getPendingFoodTab({ checkinId: 10 })).resolves.toEqual({
      checkinId: 10,
      pendingTab: 0,
      pendingOrders: 0,
      orderIds: [],
    });
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("phone +91 on booking still matches a 10-digit checkin contact", async () => {
    getDb
      .mockReturnValueOnce(drizzleChain([{ id: 42, contact: "9876543210" }]))
      .mockReturnValueOnce(
        drizzleChain([{ id: 8, checkinId: 42, total: 5000 }]),
      );

    await expect(
      getPendingFoodTab({ contact: "+91 98765 43210" }),
    ).resolves.toEqual({
      checkinId: 42,
      pendingTab: 5000,
      pendingOrders: 1,
      orderIds: [8],
    });
    expect(getDb).toHaveBeenCalledTimes(2);
  });

  it("two active checkins with the same phone sum both order groups", async () => {
    getDb
      .mockReturnValueOnce(
        drizzleChain([
          { id: 1, contact: "9876543210" },
          { id: 3, contact: "+91 98765 43210" },
        ]),
      )
      .mockReturnValueOnce(
        drizzleChain([
          { id: 11, checkinId: 1, total: 6000 },
          { id: 12, checkinId: 1, total: 4000 },
          { id: 13, checkinId: 3, total: 5000 },
        ]),
      );

    await expect(
      getPendingFoodTab({ contact: "9876543210" }),
    ).resolves.toEqual({
      checkinId: 3,
      pendingTab: 15000,
      pendingOrders: 3,
      orderIds: [11, 12, 13],
    });
    expect(getDb).toHaveBeenCalledTimes(2);
  });

  it("cancelled orders are not included (SQL filter; empty rows → 0)", async () => {
    getDb.mockReturnValueOnce(drizzleChain([]));

    await expect(getPendingFoodTab({ checkinId: 10 })).resolves.toEqual({
      checkinId: 10,
      pendingTab: 0,
      pendingOrders: 0,
      orderIds: [],
    });
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("no matching checkin and no checkinId returns EMPTY without an orders query", async () => {
    getDb.mockReturnValueOnce(
      drizzleChain([{ id: 1, contact: "1111111111" }]),
    );

    await expect(
      getPendingFoodTab({ contact: "9999999999" }),
    ).resolves.toEqual(EMPTY_FOOD_TAB);
    expect(getDb).toHaveBeenCalledTimes(1);

    getDb.mockReset();
    await expect(getPendingFoodTab({})).resolves.toEqual(EMPTY_FOOD_TAB);
    expect(getDb).toHaveBeenCalledTimes(0);
  });

  it("checkinId 0 / invalid is ignored", async () => {
    await expect(getPendingFoodTab({ checkinId: 0 })).resolves.toEqual(EMPTY_FOOD_TAB);
    await expect(getPendingFoodTab({ checkinId: -1 })).resolves.toEqual(EMPTY_FOOD_TAB);
    await expect(getPendingFoodTab({ checkinId: null })).resolves.toEqual(EMPTY_FOOD_TAB);
    expect(getDb).not.toHaveBeenCalled();

    getDb
      .mockReturnValueOnce(drizzleChain([{ id: 7, contact: "5555555555" }]))
      .mockReturnValueOnce(
        drizzleChain([{ id: 20, checkinId: 7, total: 2000 }]),
      );
    await expect(
      getPendingFoodTab({ checkinId: 0, contact: "5555555555" }),
    ).resolves.toEqual({ checkinId: 7, pendingTab: 2000, pendingOrders: 1, orderIds: [20] });
    expect(getDb).toHaveBeenCalledTimes(2);
  });

  it("SQLite totals returned as strings are still Number()'d", async () => {
    getDb.mockReturnValueOnce(
      drizzleChain([
        { id: 1, checkinId: 10, total: "10000" },
        { id: 2, checkinId: 10, total: "5000" },
      ]),
    );

    await expect(getPendingFoodTab({ checkinId: 10 })).resolves.toEqual({
      checkinId: 10,
      pendingTab: 15000,
      pendingOrders: 2,
      orderIds: [1, 2],
    });
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("booking-only phone with no matching checkin yields empty unpaid tab", async () => {
    getDb.mockReturnValueOnce(drizzleChain([]));
    await expect(getPendingFoodTab({ contact: "9123456789" })).resolves.toEqual(EMPTY_FOOD_TAB);
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("active checkin with on_tab unpaid rows returns pending tab", async () => {
    getDb.mockReturnValueOnce(
      drizzleChain([{ id: 9, checkinId: 77, total: 4200 }]),
    );
    await expect(getPendingFoodTab({ checkinId: 77 })).resolves.toEqual({
      checkinId: 77,
      pendingTab: 4200,
      pendingOrders: 1,
      orderIds: [9],
    });
  });
});
