import { describe, expect, it } from "vitest";
import { foodAmountPaid, foodDue, foodPaymentState, foodPaymentStatus, isFoodDiscountRemovable } from "@/lib/foodPaymentBalance";

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

  it("subtracts audited refunds from collected money without losing the gross collection", () => {
    const order = { total: 300, amountPaid: 400, amountRefunded: 100, paymentStatus: "partial" };
    expect(foodAmountPaid(order)).toBe(300);
    expect(foodDue(order)).toBe(0);
    expect(foodPaymentState(450, foodAmountPaid(order))).toMatchObject({ amountPaid: 300, due: 150, paymentStatus: "partial" });
  });

  it("still exposes due for a stale paid status when the net balance is outstanding", () => {
    expect(foodDue({ total: 300, amountPaid: 100, paymentStatus: "paid" })).toBe(200);
  });

  it("derives the visible badge from the net balance, not a stale status", () => {
    expect(foodPaymentStatus({ total: 300, amountPaid: 100, amountRefunded: 0 })).toBe("partial");
    expect(foodPaymentStatus({ total: 300, amountPaid: 400, amountRefunded: 100 })).toBe("paid");
    expect(foodPaymentStatus({ total: 300, amountPaid: 0, amountRefunded: 0 })).toBe("pending");
  });

  it("marks 100%-zeroed mistake rows as removable and leaves collected payments alone", () => {
    expect(isFoodDiscountRemovable({
      discount: 61000,
      total: 0,
      amountPaid: 0,
      paymentStatus: "paid",
    })).toBe(true);
    expect(isFoodDiscountRemovable({
      discount: 5000,
      total: 45000,
      amountPaid: 0,
      paymentStatus: "pending",
    })).toBe(true);
    expect(isFoodDiscountRemovable({
      discount: 5000,
      total: 45000,
      amountPaid: 45000,
      paymentStatus: "paid",
    })).toBe(false);
    expect(isFoodDiscountRemovable({
      discount: 0,
      total: 10000,
      amountPaid: 0,
      paymentStatus: "pending",
    })).toBe(false);
  });
});
