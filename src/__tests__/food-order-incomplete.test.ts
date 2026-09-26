import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FOOD_ORDER_CREATE_FAILED_MESSAGE,
  INCOMPLETE_FOOD_ORDER_BANNER,
  foodOrderTotalsMatch,
  isIncompleteFoodOrder,
} from "@/lib/foodOrderCreate";

describe("foodOrderCreate incomplete detection", () => {
  it("flags placed/on_tab headers with money and zero lines", () => {
    expect(isIncompleteFoodOrder({ total: 203000, status: "placed" }, 0)).toBe(true);
    expect(isIncompleteFoodOrder({ total: 203000, status: "cancelled" }, 0)).toBe(false);
    expect(isIncompleteFoodOrder({ total: 203000, status: "placed" }, 2)).toBe(false);
    expect(isIncompleteFoodOrder({ total: 0, status: "placed" }, 0)).toBe(false);
  });

  it("requires exact subtotal/tax/total match before healing an orphan", () => {
    const order = { subtotal: 203000, tax: 0, total: 203000 };
    expect(foodOrderTotalsMatch(order, [{ lineTotal: 203000 }], 0)).toBe(true);
    expect(foodOrderTotalsMatch(order, [{ lineTotal: 100000 }, { lineTotal: 103000 }], 0)).toBe(true);
    expect(foodOrderTotalsMatch(order, [{ lineTotal: 200000 }], 0)).toBe(false);
    expect(foodOrderTotalsMatch(order, [{ lineTotal: 193000 }], 10000)).toBe(false);
  });

  it("keeps incomplete banner and create-failed copy in admin UI / helper", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toContain("INCOMPLETE_FOOD_ORDER_BANNER");
    expect(INCOMPLETE_FOOD_ORDER_BANNER).toMatch(/no line items/i);
    expect(FOOD_ORDER_CREATE_FAILED_MESSAGE).toMatch(/cancelled/i);
  });
});
