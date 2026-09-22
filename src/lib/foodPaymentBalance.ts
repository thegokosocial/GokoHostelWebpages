export type FoodPaymentStatus = "pending" | "partial" | "paid" | "on_tab";

export function foodAmountPaid(order: { total: number; amountPaid?: number | null; paymentStatus?: string | null }): number {
  if (order.amountPaid != null) return Math.max(0, Math.min(order.total, Number(order.amountPaid) || 0));
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

export function foodDue(order: { total: number; amountPaid?: number | null; paymentStatus?: string | null }): number {
  return Math.max(0, order.total - foodAmountPaid(order));
}
