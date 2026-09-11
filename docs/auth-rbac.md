# Auth and RBAC

**Git-safe.** Passwords: [secrets-and-access.md](secrets-and-access.md).

Code: `src/lib/auth.ts`, `src/lib/actionPermissions.ts`, `src/lib/adminNav.ts`.

---

## How login works

There are **no JWT cookies**. The admin SPA keeps the password in React state (optional “remember me” in localStorage). Every admin `fetch` sends `{ password, username? }`.

```mermaid
sequenceDiagram
  participant U as Staff
  participant UI as /admin
  participant API as POST /api/admin/*
  participant AUTH as authenticateUser
  U->>UI: ADMIN_PASSWORD
  UI->>API: password + action
  API->>AUTH: compare env or hash
  AUTH-->>API: role + permissions
  API-->>UI: JSON or 401/403
```

**Env passwords:** values in [secrets-and-access.md](secrets-and-access.md).

| Env | Username when required | Result |
|-----|------------------------|--------|
| `ADMIN_PASSWORD` | omitted, or `admin` | `role: admin`, `permissions: {}`, **bypasses** all maps |
| `MANAGER_PASSWORD` | omitted, or `manager` | `role: manager`, `permissions: {}` |

DB users: `users.password_hash` = SHA-256(password + `"goko-salt-2026"`). JSON `permissions` object.

Kitchen (`authenticateKitchen`): env admin **or** env manager **or any DB user hash** (no username). Stored in `sessionStorage.kitchen_pw`.

---

## Gate function

```ts
// src/lib/actionPermissions.ts
actionAllowed(role, permissions, required)
// admin → always allowed (unless required === "admin_only" and role !== admin)
// admin_only → admin_required if not admin
// string | string[] → any listed key true on permissions
```

**Trap:** env manager has empty permissions → **forbidden** on every gated action. That is intentional (changelog item 2). Give them a DB user with keys, or use `ADMIN_PASSWORD`.

Website CMS: **admin role only**, not a permission key. **403 on Pi.**

`auth` on checkins returns `{ role, permissions }` with no extra gate. `changeMyPassword` is **omitted** from `ACTION_PERMISSIONS`, so `actionAllowed(undefined)` → **allowed** for any authenticated user.

`/api/admin/channel-manager`: **admin role only**. `/api/admin/food` uses a per-action permission map for menu, stock, and food settings; admin bypasses all permissions.

`/api/admin/reviews`: admin **or** `canViewReviews`.

`/api/admin/import` and `/api/admin/upload`: env `ADMIN_PASSWORD` / `MANAGER_PASSWORD` only — **not** DB users.

Form C: token = `ADMIN_PASSWORD` or fallback `"goko-form-c-secret"`.

Sync: `ADMIN_PASSWORD` **or** `SYNC_SECRET`.

Aiosell webhook: D1 `channel_config.webhookSecret` via `Authorization` or `x-api-key` (raw or `Bearer …`). 503 if inactive or secret empty. 401 on mismatch.

---

## Full permission keys (Users UI)

From `ManagementUsers.tsx`. Admin bypasses all. Putting a key in the UI **does not** always mean the API checks it (see [llm-onboarding.md](llm-onboarding.md) §4).

**Nav:** `canViewDashboard`, `canViewBookings`, `canViewBeds`, `canViewTimeline`, `canViewRecords`, `canViewFoodOrders`, `canViewAccounts`, `canViewSplits`, `canViewReviews`, `canViewManagement`

**Check-in:** `canAddCheckin`, `canAssignBed`, `canCheckout`, `canMarkClean`, `canEditRecords`, `canDeleteRecords`

**Booking:** `canAddBooking`, `canCheckIn`, `canCheckOut`, `canDeleteBooking`, `canManageBookingTemplates`

**Food:** `canViewFoodOrders`, `canViewFoodTabs`, `canPlaceOrders`, `canEditFoodOrders`, `canVoidFoodOrders`, `canMarkPaid`, `canApplyFoodDiscounts`, `canGenerateFoodBills`, `canManageInventory`, `canViewMenu`, `canManageMenuCategories`, `canManageMenuItems`, `canToggleMenuAvailability`, `canManageFoodSettings`

**Expenses:** `canAddExpense`, `canEditExpense`, `canDeleteExpense`, `canViewExpenses`, `canViewFoodBills`, `canAddIncome`, `canReconcileAccounts`, `canManageAccountSettings`, `canManageVendors`, `canManageEmployees`, `canManagePayroll`

**Splits:** `canAddSplitExpense`, `canEditSplitExpense`, `canDeleteSplitExpense`, `canSettleSplits`, `canManageSplits` (plus nav `canViewSplits`). `payGokoReimbursement` / Goko-as-payer add **and update** / `listAccounts` also need `canAddExpense` (inline AND; `actionAllowed` arrays are OR).

**Reviews:** `canViewReviews`, `canSendReviewRequests`, `canEditReviewRequests`, `canManageReviewSettings`

**Analytics:** `canViewAnalytics`

**Tools:** `canUseQRGenerator`, `canManageAttendance`

`canManageInventory` gates the **Inventory** admin tab and `/api/admin/inventory`, plus stock controls inside Menu. Menu viewing and administration use the dedicated menu permissions above.
`canCheckIn` / `canCheckOut` are grantable calendar controls. The booking API remains backward-compatible with `canAddBooking`.
Obsolete keys and their planned cleanup are tracked in [permission-debt.md](permission-debt.md).

### Admin nav permissions

| Section | Key |
|---------|-----|
| dashboard | `canViewDashboard` |
| bookings | `canViewBookings` |
| beds | `canViewBeds` |
| timeline | `canViewTimeline` |
| inventory | `canManageInventory` |
| records | `canViewRecords` |
| foodOrders | `canViewFoodOrders` |
| expenditure | `canViewAccounts` |
| splits | `canViewSplits` (omitted from `ADMIN_NAV` on Pi) |
| reviews | `canViewReviews` |
| management | `canViewManagement` |

Admin always sees all. Staff see first allowed section (`firstVisibleAdminSection`).

Management tabs: most `adminOnly: true`. Exceptions: History, Rates (visible), Menu (`canViewMenu`), Food Settings (`canManageFoodSettings`), QR (`canUseQRGenerator`), Account Settings (`canManageAccountSettings`), Analytics (`canViewAnalytics`; existing managers retain compatibility access). Website hidden when `NEXT_PUBLIC_GOKO_RUNTIME === "pi"`.

---

## Action maps (source of truth in routes)

### `/api/admin/checkins`

| Actions | Perm |
|---------|------|
| list, verifyCheckin, getFormCData | `canViewRecords` |
| add | `canAddCheckin` |
| addPast, reExtractFormC, updateFormCData | admin_only |
| update | `canEditRecords` |
| delete | `canDeleteRecords` |
| getDashboard, markVibeMatched | `canViewDashboard` |
| checkoutBed, checkoutGuest, undoCheckout, getPendingFoodTab | `canCheckout` **or** `canViewDashboard` |
| getBeds | `canViewBeds` **or** `canViewTimeline` |
| getBedHistory | `canViewBeds` |
| assignBed, unassignBed, changeBed | `canAssignBed` **or** `canViewBeds` |
| markClean | `canMarkClean` |
| getBookings, getUpcomingBookings, updateBookingStatus | `canViewBookings` |
| addBooking | `canAddBooking` |
| deleteBooking | `canDeleteBooking` |
| users, audit, backup, settings, stats, health, rate scrape, initDorms… | admin_only |

### `/api/admin/bookings`

Calendar PMS. View keys `canViewBookings`. Mutating `canAddBooking` / `canDeleteBooking` / `canCheckIn` / `canCheckOut`. `getPendingFoodTab` is the same OR as `checkOut`. Rollback check-in/out = admin_only. Unassigned **Reject** is admin/manager (`role`), not `canDeleteBooking` — staff 403 on full-cancel of a stay with no assigned beds. Env manager can Reject without that key; assigned cancel still needs `canDeleteBooking`.

### `/api/admin/inventory`

All actions: `canManageInventory`.

### `/api/admin/food-orders`

View list/tabs: `canViewFoodOrders`. Place/void/qty: `canPlaceOrders` or view. Pay/discount: `canMarkPaid`. cleanupOldOrders: admin_only.

### `/api/admin/expenses`

list/getMy: `canViewExpenses`. add: `canAddExpense`. update/delete: edit/delete expense keys. food revenue **and** room revenue (`getRoomRevenue`): `canViewFoodBills`. ledger: `canViewAccounts`. income: `canAddIncome`. reconcile: `canReconcileAccounts` (legacy alias `canReconcile`). opening balance: `canManageAccountSettings` (legacy alias `canManageAccounts`).

Accounts UI uses `canReconcileAccounts` on the Reconcile tab; `canReconcile` remains a compatibility alias.

### `/api/admin/splits`

Every action requires `canViewSplits`. Then: list* → view; people/groups → `canManageSplits`; `addExpense` → `canAddSplitExpense`; update/delete → edit/delete keys; `addSettlement` / `deleteSettlement` / `payGokoReimbursement` → `canSettleSplits`. Goko cash paths **and** `listAccounts` **also** require `canAddExpense` after the map. 403 on Pi. See [flows-splits.md](flows-splits.md).

### `/api/admin/account-settings`

Entire route: `canManageAccountSettings` (or legacy `canManageAccounts`) or admin.

---

## Public / guest (no staff password)

Check-in, food menu/order/status/bills, `/api/site`, `/api/media`, `/api/settings`, `/api/validate-id`, review token page, Aiosell webhook (provider auth, not staff password).

Kitchen is staff-passworded but not full admin RBAC.
