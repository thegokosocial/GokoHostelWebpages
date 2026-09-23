import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  delete: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/index", () => ({ getDb: dbMocks.getDb }));

import { clearDirtyInventory } from "@/db/queries";

describe("clearDirtyInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.where.mockResolvedValue(undefined);
    dbMocks.delete.mockReturnValue({ where: dbMocks.where });
    dbMocks.getDb.mockReturnValue({ delete: dbMocks.delete });
  });

  it("deletes large dirty sets in bind-safe batches", async () => {
    await clearDirtyInventory(Array.from({ length: 101 }, (_, index) => index + 1));

    expect(dbMocks.delete).toHaveBeenCalledTimes(5);
    expect(dbMocks.where).toHaveBeenCalledTimes(5);
  });
});
