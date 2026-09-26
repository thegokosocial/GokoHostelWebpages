import { PERMISSION_GROUPS } from "@/lib/permissionCatalog";

export type UserRole = "admin" | "manager" | "staff";

/** Single key, admin-only, or OR-list (any listed key is enough). */
export type ActionPerm = "admin_only" | string | readonly string[];

/** Compatibility aliases for permission names renamed in the active catalog. */
export const PERMISSION_ALIASES: Record<string, readonly string[]> = {
  canViewFoodTabs: ["canViewTabs"],
  canGenerateFoodBills: ["canGenerateBills"],
  canReconcileCash: ["canReconcileAccounts", "canReconcile"],
  canReconcileOnline: ["canReconcileAccounts", "canReconcile"],
  canManageAccountSettings: ["canManageAccounts"],
};

const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) => group.options.map((opt) => [opt.key, opt.label])),
);

export function permissionEnabled(permissions: Record<string, boolean>, key: string): boolean {
  return Boolean(permissions[key] || PERMISSION_ALIASES[key]?.some((alias) => permissions[alias]));
}

export function requiredPermissionKeys(required: ActionPerm | undefined): string[] {
  if (required == null || required === "admin_only") return [];
  return typeof required === "string" ? [required] : [...required];
}

/** 403 body that names the keys an admin must grant (Management → Users). */
export function permissionDeniedPayload(required: ActionPerm | undefined): {
  error: string;
  code: "permission_denied";
  requiredPermissions: string[];
  howToFix: string;
} {
  const keys = requiredPermissionKeys(required);
  if (keys.length === 0) {
    return {
      error: "You don't have permission to perform this action",
      code: "permission_denied",
      requiredPermissions: [],
      howToFix: "Ask an admin to review your permissions under Management → Users.",
    };
  }
  const named = keys.map((key) => {
    const label = PERMISSION_LABELS[key];
    return label ? `${label} (${key})` : key;
  });
  const need = named.length === 1 ? named[0] : named.slice(0, -1).join(", ") + " or " + named[named.length - 1];
  return {
    error: `Missing permission: need ${need}.`,
    code: "permission_denied",
    requiredPermissions: keys,
    howToFix: `Ask an admin to enable ${keys.length === 1 ? "this permission" : "one of these permissions"} under Management → Users.`,
  };
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

/** Require every listed key for compound reads such as account activity. */
export function actionAllowedAll(role: UserRole, permissions: Record<string, boolean>, required: readonly string[]) {
  if (role === "admin") return "allowed" as const;
  return required.every((key) => permissionEnabled(permissions, key)) ? "allowed" as const : "forbidden" as const;
}
