export type FoodPaymentMethod = "cash" | "online" | "split";

export type FoodPaymentAllocation = {
  orderId: number;
  total: number;
  paymentMethod: FoodPaymentMethod;
  cashReceived: number;
  changeGiven: number;
  onlineAmount: number;
};

/** Allocate one food-bill payment across orders without repeating combined tender values. */
export function allocateFoodPayment(
  orders: Array<{ id: number; total: number }>,
  paymentMethod: FoodPaymentMethod,
  cashReceived = 0,
  changeGiven = 0,
): FoodPaymentAllocation[] {
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  if (paymentMethod === "online") {
    return orders.map((order) => ({
      orderId: order.id,
      total: order.total,
      paymentMethod,
      cashReceived: 0,
      changeGiven: 0,
      onlineAmount: order.total,
    }));
  }

  if (paymentMethod === "cash") {
    return orders.map((order, index) => ({
      orderId: order.id,
      total: order.total,
      paymentMethod,
      cashReceived: index === orders.length - 1 ? order.total + changeGiven : order.total,
      changeGiven: index === orders.length - 1 ? changeGiven : 0,
      onlineAmount: 0,
    }));
  }

  let remainingCash = Math.min(Math.max(0, cashReceived), total);
  return orders.map((order) => {
    const cashPart = Math.min(order.total, remainingCash);
    remainingCash -= cashPart;
    return {
      orderId: order.id,
      total: order.total,
      paymentMethod,
      cashReceived: cashPart,
      changeGiven: 0,
      onlineAmount: order.total - cashPart,
    };
  });
}
