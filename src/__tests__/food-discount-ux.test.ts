import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isFoodDiscountRemovable } from "@/lib/foodPaymentBalance";

describe("food discount UX contracts", () => {
  const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
  const queries = readFileSync("src/db/queries.ts", "utf8");
  const route = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");

  it("defaults DiscountModal to Fixed Amount first, with Percentage second", () => {
    expect(ui).toMatch(/useState<"percent" \| "fixed">\("fixed"\)/);
    expect(ui).toContain('{ id: "fixed" as const, label: "Fixed Amount" }');
    expect(ui).toContain('{ id: "percent" as const, label: "Percentage" }');
    expect(ui.indexOf('{ id: "fixed" as const, label: "Fixed Amount" }')).toBeLessThan(
      ui.indexOf('{ id: "percent" as const, label: "Percentage" }'),
    );
    expect(ui).toContain("max discount % can be 100 itself.");
    expect(ui).toContain("Remove Discount");
    expect(ui).toContain("percentTooHigh");
    expect(ui).toContain("window.confirm");
  });

  it("Summary apply uses unpaid due IDs and Remove uses removable zero-collection IDs", () => {
    expect(ui).toContain("foodDue(o) > 0");
    expect(ui).toContain("isFoodDiscountRemovable");
    expect(ui).toContain('action: "applyDiscount", orderIds');
    expect(ui).toContain('action: "removeDiscount", orderIds');
    expect(ui).toContain('showError("Discount"');
    expect(ui).toContain('showError("Remove discount"');
    expect(ui).toContain("canApplyFoodDiscounts");
  });

  it("API rejects percent over 100 and only clears zero-collection discounts", () => {
    expect(route).toContain("max discount % can be 100 itself");
    expect(route).toContain("isFoodDiscountRemovable");
    expect(route).toContain("Cannot remove discount on orders that already have payment collected");
    expect(route).toContain("removedOrderIds");
    expect(route).toContain("skippedPaidOrderIds");
  });

  it("chunks addFoodOrderItems under the D1 bind limit", () => {
    expect(queries).toContain("FOOD_ORDER_ITEM_INSERT_CHUNK");
    expect(queries).toMatch(/FOOD_ORDER_ITEM_INSERT_CHUNK\s*=\s*5/);
    expect(queries).toContain("for (let start = 0; start < items.length; start += FOOD_ORDER_ITEM_INSERT_CHUNK)");
  });

  it("history copy distinguishes remove vs apply", () => {
    expect(ui).toContain('mod.newValue === "discount removed"');
    expect(ui).toContain("removed discount");
    expect(ui).toContain("applied discount:");
  });

  it("selects removable discount IDs the way Summary Remove will", () => {
    const group = [
      { id: 1, discount: 61000, total: 0, amountPaid: 0, paymentStatus: "paid" },
      { id: 2, discount: 5000, total: 45000, amountPaid: 0, paymentStatus: "pending" },
      { id: 3, discount: 2000, total: 18000, amountPaid: 18000, paymentStatus: "paid" },
      { id: 4, discount: 0, total: 10000, amountPaid: 0, paymentStatus: "pending" },
    ];
    expect(group.filter((o) => isFoodDiscountRemovable(o)).map((o) => o.id)).toEqual([1, 2]);
  });
});
