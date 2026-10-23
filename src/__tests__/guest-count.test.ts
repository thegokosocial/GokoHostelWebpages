import { describe, expect, it } from "vitest";
import { guestCount } from "@/lib/guestCount";

describe("guestCount", () => {
  it.each([
    [3, 3],
    ["2", 2],
    [undefined, 1],
    [0, 1],
    [-1, 1],
    ["not-a-number", 1],
    [1.5, 1],
  ])("returns %i guests for %j", (value, expected) => {
    expect(guestCount(value)).toBe(expected);
  });
});
