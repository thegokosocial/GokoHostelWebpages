# Permission Debt Ledger

This file records permission keys that are retained for compatibility but are no longer assigned or used by the active product.

## Deferred cleanup

| Key | Current state | Why retained | Review target |
|---|---|---|---|
| `canSyncBookings` | Removed from active UI and legacy booking controls | Existing users may still have the key stored in `users.permissions` | Re-check after 30 days, then remove from stored JSON if no deployment uses email booking sync |
| `canAccessKitchen` | Removed from the permission form | Kitchen authentication is handled separately and does not use this key | Remove from stored JSON after the same compatibility review |
| `canViewTabs` | Replaced in the active catalog by `canViewFoodTabs` | Existing users may have the old key | Migrate only after confirming no older build depends on it |
| `canGenerateBills` | Replaced in the active catalog by `canGenerateFoodBills` | Existing users may have the old key | Migrate only after confirming no older build depends on it |
| `canReconcile` | Replaced in the active catalog by `canReconcileAccounts` | Existing users may have the old key | Migrate only after compatibility verification |
| `canManageAccounts` | Replaced in the active catalog by `canManageAccountSettings` | Existing users may have the old key and current APIs still recognize it | Remove after API compatibility aliases are retired |

Do not delete these keys from existing permission JSON until the review date. New users should receive only keys from `src/lib/permissionCatalog.ts`.
