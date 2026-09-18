import { describe, expect, it } from "vitest";
import { clampHoldSeconds } from "@/lib/nativeInventoryHold";

describe("clampHoldSeconds", () => {
  it("defaults to 900 and clamps to [300, 900]", () => {
    expect(clampHoldSeconds()).toBe(900);
    expect(clampHoldSeconds(undefined)).toBe(900);
    expect(clampHoldSeconds(300)).toBe(300);
    expect(clampHoldSeconds(5 * 60)).toBe(300);
    expect(clampHoldSeconds(15 * 60)).toBe(900);
    expect(clampHoldSeconds(60)).toBe(300);
    expect(clampHoldSeconds(1200)).toBe(900);
  });
});
