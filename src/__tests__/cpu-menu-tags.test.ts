import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({
  getDb: dbMock.getDb,
}));

import { getFoodOrderItemsBatch, getMenuItemCategoryExemptions, getMenuItemTagsByIds } from "@/db/queries";

beforeEach(() => dbMock.getDb.mockReset());

describe("getMenuItemTagsByIds", () => {
  it("returns an empty Map without touching the database", async () => {
    await expect(getMenuItemTagsByIds([])).resolves.toEqual(new Map());
    await expect(getFoodOrderItemsBatch([])).resolves.toEqual(new Map());
    await expect(getMenuItemCategoryExemptions([])).resolves.toEqual(new Map());
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("batches large menu-id lists and combines every tag row", async () => {
    const batches = [
      Array.from({ length: 25 }, (_, index) => ({ id: index + 1, tags: `[\"tag-${index + 1}\"]` })),
      Array.from({ length: 25 }, (_, index) => ({ id: index + 26, tags: `[\"tag-${index + 26}\"]` })),
      [{ id: 51, tags: "[\"tag-51\"]" }],
    ];
    const where = vi.fn(() => Promise.resolve(batches.shift() || []));
    const select = vi.fn(() => ({ from: () => ({ where }) }));
    dbMock.getDb.mockReturnValue({ select });

    const result = await getMenuItemTagsByIds(Array.from({ length: 51 }, (_, index) => index + 1));

    expect(select).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(51);
    expect(result.get(1)).toBe('["tag-1"]');
    expect(result.get(51)).toBe('["tag-51"]');
  });

  it("batches large order-id lists and preserves item grouping", async () => {
    const batches = [
      [{ orderId: 1, id: 11, itemName: "A" }],
      [{ orderId: 26, id: 12, itemName: "B" }],
      [{ orderId: 51, id: 13, itemName: "C" }],
    ];
    const where = vi.fn(() => Promise.resolve(batches.shift() || []));
    const select = vi.fn(() => ({ from: () => ({ where }) }));
    dbMock.getDb.mockReturnValue({ select });

    const result = await getFoodOrderItemsBatch(Array.from({ length: 51 }, (_, index) => index + 1));

    expect(select).toHaveBeenCalledTimes(3);
    expect(result.get(1)).toEqual([{ orderId: 1, id: 11, itemName: "A" }]);
    expect(result.get(26)).toEqual([{ orderId: 26, id: 12, itemName: "B" }]);
    expect(result.get(51)).toEqual([{ orderId: 51, id: 13, itemName: "C" }]);
  });

  it("batches menu-category lookups used by discounts", async () => {
    const batches = [
      Array.from({ length: 25 }, (_, index) => ({ menuItemId: index + 1, discountExempt: index % 2 })),
      Array.from({ length: 25 }, (_, index) => ({ menuItemId: index + 26, discountExempt: index % 2 })),
      [{ menuItemId: 51, discountExempt: 1 }],
    ];
    const where = vi.fn(() => Promise.resolve(batches.shift() || []));
    const select = vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where }) }) }));
    dbMock.getDb.mockReturnValue({ select });

    const result = await getMenuItemCategoryExemptions(Array.from({ length: 51 }, (_, index) => index + 1));

    expect(select).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(51);
    expect(result.get(1)).toBe(false);
    expect(result.get(51)).toBe(true);
  });
});
