# Splits (staff / volunteer IOUs)

**Git-safe.** Admin `/admin` → **Splits**. Cloudflare-only: hidden on Pi, API 403, migrator skips `0041_splits.sql` and `0081_split_expense_idempotency.sql`.

Splits is a **group ledger of IOUs**, not a bank and not hostel P&L. Accounts still owns cash. UI **must** `fetch("/api/admin/splits")` — never `useAdminApi` (that POSTs checkins).

---

## People and groups

Independent `split_members` (not `users`, not `employees`). Optional `userId` (unique where not null) / `employeeId` (label only). Seeded house member **Goko** (`is_house=1`). Identify Goko by **`isHouse` only**, never `name === "Goko"`. Cannot rename, deactivate, or clear `isHouse`.

Named groups (`split_groups`). **No seed group.** Staff create Kitchen / House. Goko is never default-checked on a split. New groups do not include Goko. Saving a hostel-share expense does **not** add Goko to the group roster.

---

## Money kernel (`src/lib/splits.ts`)

All amounts **integer paise**. Remainder +1 paise to lowest **`memberId`**. `assertBalanced`: paid/owed ≥ 0, sums = total, no duplicate member.

`addExpense` requires a UUID `idempotencyKey` on the split row (and reuses it for the hostel Accounts insert when Goko pays). Retries return `{ ok: true, duplicate: true }` without a second split (migration **0080**).

`net = paid − owed + settlements_sent − settlements_received`. Settle is always **inside one group**. Overall nets are display-only.

**Goko attribution (FIFO):** partition each expense’s Goko owed across human payers (`memberId` asc). Cap for Pay via Accounts is that **(payee, expense)** slice. Client **must** send `splitExpenseId`. Human settlements do not change who fronted Goko. Do not use `min(-gokoNet, payeeNet)` or unary `min(G, paid)`.

---

## When Accounts is touched

| Situation | Splits | Accounts |
|-----------|--------|----------|
| Personal dinner, no Goko | IOUs | **Nothing** |
| Staff paid, Goko has a share | Goko owes that share | **Nothing until** Pay via Accounts |
| Goko sole payer and Goko owed = paid | Nets 0 | **Insert now** (`addExpense`, never `paySalary`). Cash forces `accountId` null. Online requires `accountId`. `createdMonth` = `getMonthKey()` UTC |

`payGokoReimbursement`: Accounts first, then settlement `from=Goko` with `hostelExpenseId` + `splitExpenseId`. Retry after a 500 may send the returned `hostelExpenseId` to **reuse** that Accounts row instead of booking twice (same `createdBy`, amount match, and the id must not already be on any split/settlement including soft-deleted). Share-insert cleanup always returns that id even if `hardDelete` fails. `insertSplitSettlement` returning null is treated as failure. Accounts `updateExpense` (any field) / `deleteExpense` refuse rows linked to Splits (`rejectIfSplitLinked`; missing `split_*` tables → skip). `addSettlement` **rejects** `from=Goko` and `to=Goko`. Soft-delete of Accounts-linked settlements is refused (`deleteSettlement`). Human settlements can be undone. Reimburse subCategory cannot be Salary.

`updateExpense` money is locked when `hostelExpenseId` is set, a reimbursement exists, **or** the group has live human settlements (description/notes/date only). UI greys money fields in that case. Converting Paid-by → Goko on an unbooked expense posts Accounts (needs `canAddExpense`). Kernel `assertGokoPayerRules`: house paid > 0 ⇒ sole payer and owed = total.

Delete expense is refused while the group has live **human** settlements (Goko reimbursements on other bills do not block). `deleteGroup` also refuses live settlements.

Known residual: two in-flight reimbursements of the same slice can still double-book once (no D1 lock). Sequential retry after a 500 is safe if the client sends `hostelExpenseId`. Pi has no `split_*` tables, so the Accounts lock cannot see linkage there unless those tables exist.

---

## API `POST /api/admin/splits`

Every action needs `canViewSplits`. Writes: manage / add / edit / delete / settle as mapped. **Inline AND** `canAddExpense` for Goko-as-payer `addExpense` / `updateExpense`, `payGokoReimbursement`, and `listAccounts` (`actionAllowed` arrays are OR).

Actions: `listMembers`, `addMember`, `updateMember`, `deactivateMember`, `listGroups`, `addGroup`, `updateGroup`, `setGroupMembers`, `deleteGroup`, `listLoginUsers`, `listActivity`, `addExpense`, `updateExpense`, `deleteExpense`, `getBalances`, `addSettlement`, `deleteSettlement`, `payGokoReimbursement`, `listAccounts`.

Missing tables → 503. Pi → 403.

Queries: `src/db/splitQueries.ts`. **No sync columns.** Soft-delete = `deleted_at`. Unique `(expense_id, member_id)` on shares. Unique `hostel_expense_id` where not null on `split_expenses` and `split_settlements`. Unique `is_house` where `= 1` on `split_members`.

---

## UI

Default tab **balances**. Happy path: description, ₹ (2 dp), paid by (linked self else A–Z human), equal all active non-house. Sticky group `goko.splits.lastGroupId`. Copy ₹ / Mark settled / custom amount (overpay confirms) / Copy settle summary. Goko: **Pay via Accounts** per expense slice (amount editable ≤ remaining). Activity → Edit or row click. Human settlements: Undo. Manage: People / Groups (optional login link for the overall You-owe strip).

Empty: “Add people, then create a group (e.g. Kitchen).” If people exist and there is no group: “Create a group (e.g. Kitchen).” Create group requires at least one person, defaults name Kitchen, then switches to Balances with that group selected.

Edit of equal-with-Goko infers `equal` (not `grid`). Include Goko “Equal with the group” locks Method to Equally. “Use the grid” with method Equally still puts Goko in the equal split. Multi-payer amounts stay visible after collapsing More. Sheet shows an owed preview before Save. Settle amount remounts when the remaining edge changes. After a human settlement, **edit** money is locked (not **add**).

---

## RBAC

`canViewSplits`, `canAddSplitExpense`, `canEditSplitExpense`, `canDeleteSplitExpense`, `canSettleSplits`, `canManageSplits`. Nav key is in `NAV_PERMISSION_OPTIONS`. Env manager `permissions: {}` sees nothing.

---

## Pi / sync

Skip `0041` like `0035`. Do not add `split_*` to `syncEngine.ts`. Hide nav including `ADMIN_NAV` so `firstVisibleAdminSection` cannot land on Splits.
