import { describe, expect, it, vi } from "vitest";
import { collectInBatches, D1_IN_BATCH_SIZE, uniqueInBatches } from "@/lib/dbBatch";

describe("D1 bulk-query batching", () => {
  it("keeps empty inputs empty and removes duplicate ids", () => {
    expect(uniqueInBatches([])).toEqual([]);
    expect(uniqueInBatches([1, 1, 2, 2])).toEqual([[1, 2]]);
  });

  it("splits exactly at the D1 safety boundary", () => {
    const values = Array.from({ length: D1_IN_BATCH_SIZE * 2 + 1 }, (_, index) => index + 1);
    const batches = uniqueInBatches(values);
    expect(batches.map((batch) => batch.length)).toEqual([25, 25, 1]);
    expect(batches.flat()).toEqual(values);
  });

  it("collects every batch in order and never silently drops a failed batch", async () => {
    const load = vi.fn(async (batch: number[]) => batch.map((id) => `row-${id}`));
    const values = Array.from({ length: 51 }, (_, index) => index + 1);

    await expect(collectInBatches(values, load)).resolves.toEqual(values.map((id) => `row-${id}`));
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.map(([batch]) => batch.length)).toEqual([25, 25, 1]);

    const failingLoad = vi.fn(async (batch: number[]) => {
      if (batch[0] === 26) throw new Error("D1_ERROR");
      return batch;
    });
    await expect(collectInBatches(values, failingLoad)).rejects.toThrow("D1_ERROR");
  });
});
