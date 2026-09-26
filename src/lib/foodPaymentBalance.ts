export type FoodPaymentStatus = "pending" | "partial" | "paid" | "on_tab";

export function foodAmountPaid(order: { total: number; amountPaid?: number | null; amountRefunded?: number | null; paymentStatus?: string | null }): number {
  if (order.amountPaid != null) {
    const collected = Math.max(0, Number(order.amountPaid) || 0);
    const refunded = Math.max(0, Number(order.amountRefunded) || 0);
    return Math.max(0, Math.min(order.total, collected - refunded));
  }
  return order.paymentStatus === "paid" ? Math.max(0, order.total) : 0;
}

export function foodPaymentState(total: number, amountPaid: number, onTab = false): { amountPaid: number; due: number; paymentStatus: FoodPaymentStatus } {
  const paid = Math.max(0, Math.min(Math.max(0, total), Math.round(amountPaid || 0)));
  return {
    amountPaid: paid,
    due: Math.max(0, total - paid),
    paymentStatus: paid >= total ? "paid" : paid > 0 ? "partial" : onTab ? "on_tab" : "pending",
  };
}

export function foodDue(order: { total: number; amountPaid?: number | null; amountRefunded?: number | null; paymentStatus?: string | null }): number {
  return Math.max(0, order.total - foodAmountPaid(order));
}

export function foodPaymentStatus(order: { total: number; amountPaid?: number | null; amountRefunded?: number | null }): FoodPaymentStatus {
  return foodPaymentState(order.total, foodAmountPaid(order)).paymentStatus;
}

/**
 * Discount may be cleared when no real money was collected — unpaid tabs and
 * 100%-zeroed rows that look "paid" only because total and amountPaid are both 0.
 * Orders with foodAmountPaid > 0 keep their discount.
 */
export function isFoodDiscountRemovable(order: {
  discount?: number | null;
  total: number;
  amountPaid?: number | null;
  amountRefunded?: number | null;
  paymentStatus?: string | null;
}): boolean {
  return (Number(order.discount) || 0) > 0 && foodAmountPaid(order) === 0;
}
