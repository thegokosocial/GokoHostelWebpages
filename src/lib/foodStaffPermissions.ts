/**
 * Full Food & Kitchen permission set granted to every staff/manager by default.
 * Admins bypass maps; DB users receive these keys so front-desk never blocks on a missing food grant.
 */

export const DEFAULT_FOOD_STAFF_PERMISSION_KEYS = [
  "canViewFoodOrders",
  "canViewFoodTabs",
  "canPlaceOrders",
  "canEditFoodOrders",
  "canVoidFoodOrders",
  "canMarkPaid",
  "canApplyFoodDiscounts",
  "canGenerateFoodBills",
  "canManageInventory",
  "canViewMenu",
  "canManageMenuCategories",
  "canManageMenuItems",
  "canToggleMenuAvailability",
  "canManageFoodSettings",
  "canReceiveFoodNotifications",
] as const;

export type DefaultFoodStaffPermissionKey = (typeof DEFAULT_FOOD_STAFF_PERMISSION_KEYS)[number];

/** True when the stored JSON already mentions any food-ops key (explicit config). */
export function hasConfiguredFoodStaffPermissions(permissions: Record<string, boolean>): boolean {
  return DEFAULT_FOOD_STAFF_PERMISSION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(permissions, key));
}

/** Force every food key to true (create / save / live backfill). */
export function grantAllFoodStaffPermissions(permissions: Record<string, boolean>): Record<string, boolean> {
  return {
    ...permissions,
    ...Object.fromEntries(DEFAULT_FOOD_STAFF_PERMISSION_KEYS.map((key) => [key, true])),
  };
}

/** New-user / edit form helper — always grant the full food set. */
export function withDefaultFoodStaffPermissions(permissions: Record<string, boolean>): Record<string, boolean> {
  return grantAllFoodStaffPermissions(permissions);
}

/** Alias used by createUser/updateUser and edit form — always grant the full food set. */
export function ensureDefaultFoodStaffPermissions(permissions: Record<string, boolean>): Record<string, boolean> {
  return grantAllFoodStaffPermissions(permissions);
}
