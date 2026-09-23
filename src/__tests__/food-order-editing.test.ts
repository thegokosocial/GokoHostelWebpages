import { describe, expect, it } from "vitest";
import { effectiveFoodOrderQuantity, nextFoodOrderQuantity } from "@/lib/foodOrderEditing";

describe("food-order draft quantity editing", () => {
  it("uses the staged quantity as the base for subsequent changes", () => {
    expect(nextFoodOrderQuantity(2, { quantity: 3 }, 1)).toBe(4);
    expect(nextFoodOrderQuantity(2, { quantity: 3 }, -1)).toBe(2);
  });

  it("keeps the original quantity when no draft exists", () => {
    expect(effectiveFoodOrderQuantity(2)).toBe(2);
    expect(nextFoodOrderQuantity(2, undefined, 1)).toBe(3);
  });

  it("clamps only at zero so the UI can open removal confirmation", () => {
    expect(nextFoodOrderQuantity(1, undefined, -1)).toBe(0);
    expect(nextFoodOrderQuantity(0, { quantity: 0 }, -1)).toBe(0);
  });
});
