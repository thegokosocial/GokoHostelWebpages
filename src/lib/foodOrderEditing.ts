export type FoodOrderDraftQuantity = { quantity?: number } | undefined;

export function effectiveFoodOrderQuantity(
  originalQuantity: number,
  draft?: FoodOrderDraftQuantity,
): number {
  return draft?.quantity ?? originalQuantity;
}

export function nextFoodOrderQuantity(
  originalQuantity: number,
  draft: FoodOrderDraftQuantity,
  delta: number,
): number {
  return Math.max(0, effectiveFoodOrderQuantity(originalQuantity, draft) + delta);
}
