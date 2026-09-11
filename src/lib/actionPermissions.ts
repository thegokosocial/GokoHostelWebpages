export type UserRole = "admin" | "manager" | "staff";

/** Single key, admin-only, or OR-list (any listed key is enough). */
export type ActionPerm = "admin_only" | string | readonly string[];

/** Compatibility aliases for permission names renamed in the active catalog. */
export const PERMISSION_ALIASES: Record<string, readonly string[]> = {
  canViewFoodTabs: ["canViewTabs"],
  canGenerateFoodBills: ["canGenerateBills"],
  canReconcileAccounts: ["canReconcile"],
  canManageAccountSettings: ["canManageAccounts"],
};

export function permissionEnabled(permissions: Record<string, boolean>, key: string): boolean {
  return Boolean(permissions[key] || PERMISSION_ALIASES[key]?.some((alias) => permissions[alias]));
}

export function actionAllowed(
  role: UserRole,
  permissions: Record<string, boolean>,
  required: ActionPerm | undefined
): "allowed" | "forbidden" | "admin_required" {
  if (required == null) return "allowed";
  if (required === "admin_only") return role === "admin" ? "allowed" : "admin_required";
  if (role === "admin") return "allowed";
  const keys = typeof required === "string" ? [required] : required;
  return keys.some((k) => permissionEnabled(permissions, k)) ? "allowed" : "forbidden";
}
