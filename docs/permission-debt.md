# Permission Debt Ledger

This file records permission keys that are retained for compatibility but are no longer assigned or used by the active product.

## Deferred cleanup

| Key | Current state | Why retained | Review target |
|---|---|---|---|
| `canSyncBookings` | Removed from active UI and legacy booking controls | Existing users may still have the key stored in `users.permissions` | Re-check after 30 days, then remove from stored JSON if no deployment uses email booking sync |
| `canAccessKitchen` | Removed from the permission form | Kitchen authentication is handled separately and does not use this key | Remove from stored JSON after the same compatibility review |
| `canViewTabs` | Replaced in the active catalog by `canViewFoodTabs` | Existing users may have the old key | Migrate only after confirming no older build depends on it |
| `canGenerateBills` | Replaced in the active catalog by `canGenerateFoodBills` | Existing users may have the old key | Migrate only after confirming no older build depends on it |
| `canReconcileAccounts` | Replaced by `canReconcileCash` and `canReconcileOnline` | Existing users may have the combined key | Migrate after users receive the appropriate scoped keys |
| `canReconcile` | Older combined reconciliation key; grants both new scopes | Existing users may have the old key | Migrate only after compatibility verification |
| `canManageAccounts` | Replaced in the active catalog by `canManageAccountSettings` | Existing users may have the old key and current APIs still recognize it | Remove after API compatibility aliases are retired |

Do not delete these keys from existing permission JSON until the review date. New users should receive only keys from `src/lib/permissionCatalog.ts`.

## Website booking foundation

Booking Settings uses an administrator-role gate, not a new stored permission or compatibility alias. Payment view/reconcile/refund permissions in the reviewed plan are not yet active because the corresponding payment actions are not implemented. Existing permission keys and compatibility fallbacks remain unchanged.

The authenticated Razorpay test preview also uses administrator role only for all actions, with no legacy aliases. It does not handle real guest bookings/payments. Separate view/reconcile/refund permission keys remain required when live staff payment workflows are implemented; do not reuse the test-role gate as their final authorization design.
# Internal native hold milestone (17 September 2026)

The [physical inventory hold primitive](native-inventory-hold-foundation.md) adds no page, public/admin API action or permission key. Creation is Cloudflare-only and default-disabled via `GOKO_NATIVE_HOLD_INTERNAL_ENABLED`; recovery/release require the original hashed owner token. No guest authorization, payment permission or production checkout is implemented by this primitive. Existing permission aliases and page gates are unchanged. Public exposure requires the remaining pool/quota, fulfilment, abuse-protection and Pi ownership release gates first.
