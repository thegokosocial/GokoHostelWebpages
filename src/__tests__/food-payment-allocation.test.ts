import { describe, expect, it } from "vitest";
import { allocateFoodPayment } from "@/lib/foodPaymentAllocation";

const orders = [{ id: 11, total: 7000 }, { id: 12, total: 4300 }];

describe("combined food payment allocation", () => {
  it("records one online portion per order", () => {
    expect(allocateFoodPayment(orders, "online")).toEqual([
      { orderId: 11, total: 7000, paymentMethod: "online", cashReceived: 0, changeGiven: 0, onlineAmount: 7000 },
      { orderId: 12, total: 4300, paymentMethod: "online", cashReceived: 0, changeGiven: 0, onlineAmount: 4300 },
    ]);
  });

  it("keeps combined cash tender and change on the final order", () => {
    expect(allocateFoodPayment(orders, "cash", 15000, 3700)).toEqual([
      { orderId: 11, total: 7000, paymentMethod: "cash", cashReceived: 7000, changeGiven: 0, onlineAmount: 0 },
      { orderId: 12, total: 4300, paymentMethod: "cash", cashReceived: 8000, changeGiven: 3700, onlineAmount: 0 },
    ]);
  });

  it("does not repeat split cash across orders", () => {
    expect(allocateFoodPayment(orders, "split", 5000)).toEqual([
      { orderId: 11, total: 7000, paymentMethod: "split", cashReceived: 5000, changeGiven: 0, onlineAmount: 2000 },
      { orderId: 12, total: 4300, paymentMethod: "split", cashReceived: 0, changeGiven: 0, onlineAmount: 4300 },
    ]);
  });
});
