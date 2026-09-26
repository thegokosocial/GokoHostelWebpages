/** Detect / heal incomplete food order creates (header without line items). */

export type FoodOrderTotals = { subtotal: number; tax: number; total: number };

export type ValidatedFoodLine = {
  menuItemId: number;
  itemName: string;
  itemPrice: number;
  quantity: number;
  lineTotal: number;
  pricingStatus?: string;
  notes?: string;
  trackInventory?: boolean;
};

export function isIncompleteFoodOrder(order: { total?: number | null; status?: string | null }, itemCount: number): boolean {
  if (order.status === "cancelled") return false;
  const total = Number(order.total) || 0;
  return total > 0 && itemCount === 0;
}

/** Request lines must reproduce the stored header money exactly. */
export function foodOrderTotalsMatch(
  order: FoodOrderTotals,
  lines: Array<{ lineTotal: number }>,
  tax: number,
): boolean {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const total = subtotal + tax;
  return order.subtotal === subtotal && order.tax === tax && order.total === total;
}

export const INCOMPLETE_FOOD_ORDER_BANNER =
  "This order has no line items (create failed). Cancel and place again.";

export const FOOD_ORDER_CREATE_FAILED_MESSAGE =
  "Order could not be completed (line items failed). The incomplete order was cancelled — please place again.";
