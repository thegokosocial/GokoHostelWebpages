import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({
  getDb: dbMock.getDb,
}));

import { getFoodOrderItemsBatch, getMenuItemTagsByIds } from "@/db/queries";

beforeEach(() => dbMock.getDb.mockReset());

describe("getMenuItemTagsByIds", () => {
  it("returns an empty Map without touching the database", async () => {
    await expect(getMenuItemTagsByIds([])).resolves.toEqual(new Map());
    await expect(getFoodOrderItemsBatch([])).resolves.toEqual(new Map());
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("batches large menu-id lists and combines every tag row", async () => {
    const batches = [
      Array.from({ length: 50 }, (_, index) => ({ id: index + 1, tags: `["tag-${index + 1}"]` })),
      Array.from({ length: 50 }, (_, index) => ({ id: index + 51, tags: `["tag-${index + 51}"]` })),
      [{ id: 101, tags: "[\"tag-101\"]" }],
    ];
    const where = vi.fn(() => Promise.resolve(batches.shift() || []));
    const select = vi.fn(() => ({ from: () => ({ where }) }));
    dbMock.getDb.mockReturnValue({ select });

    const result = await getMenuItemTagsByIds(Array.from({ length: 101 }, (_, index) => index + 1));

    expect(select).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(101);
    expect(result.get(1)).toBe('["tag-1"]');
    expect(result.get(101)).toBe('["tag-101"]');
  });

  it("batches large order-id lists and preserves item grouping", async () => {
    const batches = [
      [{ orderId: 1, id: 11, itemName: "A" }],
      [{ orderId: 51, id: 12, itemName: "B" }],
      [{ orderId: 101, id: 13, itemName: "C" }],
    ];
    const where = vi.fn(() => Promise.resolve(batches.shift() || []));
    const select = vi.fn(() => ({ from: () => ({ where }) }));
    dbMock.getDb.mockReturnValue({ select });

    const result = await getFoodOrderItemsBatch(Array.from({ length: 101 }, (_, index) => index + 1));

    expect(select).toHaveBeenCalledTimes(3);
    expect(result.get(1)).toEqual([{ orderId: 1, id: 11, itemName: "A" }]);
    expect(result.get(51)).toEqual([{ orderId: 51, id: 12, itemName: "B" }]);
    expect(result.get(101)).toEqual([{ orderId: 101, id: 13, itemName: "C" }]);
  });
});
