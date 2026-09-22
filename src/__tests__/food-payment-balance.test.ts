import { describe, expect, it } from "vitest";
import { foodAmountPaid, foodDue, foodPaymentState } from "@/lib/foodPaymentBalance";

describe("food payment balances", () => {
  it("preserves collected money and exposes only the revised due", () => {
    const order = { total: 600, amountPaid: 400, paymentStatus: "partial" };
    expect(foodAmountPaid(order)).toBe(400);
    expect(foodDue(order)).toBe(200);
    expect(foodPaymentState(800, order.amountPaid)).toMatchObject({ amountPaid: 400, due: 400, paymentStatus: "partial" });
  });

  it("treats legacy paid rows as fully paid until migration data is present", () => {
    expect(foodAmountPaid({ total: 400, paymentStatus: "paid" })).toBe(400);
    expect(foodDue({ total: 400, paymentStatus: "paid" })).toBe(0);
  });

  it("keeps an on-tab order open only while no money has been collected", () => {
    expect(foodPaymentState(400, 0, true)).toMatchObject({ paymentStatus: "on_tab", due: 400 });
    expect(foodPaymentState(400, 400, true)).toMatchObject({ paymentStatus: "paid", due: 0 });
  });

  it("clamps stale payment amounts to the current total", () => {
    expect(foodPaymentState(300, 500)).toMatchObject({ amountPaid: 300, due: 0, paymentStatus: "paid" });
  });
});
