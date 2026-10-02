# Accounts (expenses, ledger, salary)

**Git-safe.** Admin `/admin` → Accounts. Bill photos → Google Drive (folder id in secrets file) under `Goko Bills/{MONTH}/`.

---

## Tabs

| Tab | Perm (non-admin) | API |
|-----|------------------|-----|
| Add Expense | `canAddExpense` | `addExpense` |
| Bills Payable (creation) | `canAddExpense` | `createPayableBill` on `expenses` API |
| Unpaid Bills (records) | view: `canViewExpenses`; pay/note: `canAddExpense`; increase: `canEditExpense`; delete empty bill: `canDeleteExpense` | payable-bill reads and actions on `expenses` API |
| Add Income | `canAddIncome` | `getIncomeAccounts`, `addDailyIncome` |
| Daily Ledger | `canViewAccounts` | `getDailyLedger` (quick add also needs `canAddIncome`) |
| Expense Records | `canViewExpenses` | `listExpenses` |
| Income Records | `canViewAccounts` | `listIncomeRecords` |
| Food Revenue | `canViewFoodBills` | `getFoodRevenue` |
| Room Revenue | `canViewFoodBills` | `getRoomRevenue` |
| Reconcile | `canReconcileCash` or `canReconcileOnline` | `getReconciliation`, `saveReconciliation`; Admin-only `undoReconciliation` |
| OTA Receivables | `canViewAccounts`; mutations additionally require `canSettlePlatformPayments` / `canAdjustPlatformReceivables` | `/api/admin/platform-settlements`: list, createSettlement, allocate, adjust |
| Account Activity | `canViewAccounts` **and** `canViewExpenses` | `getAccountActivity` |

On phones and tablets, Accounts uses grouped navigation: **New Additions** (Add Expense, Recurring Expenses, Add Income), **Reports & Charts** (Daily Ledger, records, Food Revenue, Room Revenue), **Reconcile** (Reconcile, Platform Receivables), and **Account Activity**. Activity defaults to **All activity**, combining Cash, real accounts, and virtual accounts; every row identifies its account. The per-account balance/checkpoint card appears only after selecting Cash or one account.

## Bills Payable

Creation remains under **New Additions → Bills Payable** (`tab=payableBills`). **Reports & Charts → Unpaid Bills** (`tab=unpaidBills`), beside Expense Records, owns the detailed records list. It defaults to unpaid obligations and supports Show paid, search by title/vendor/category/description, overdue labels, and complete total/paid/remaining amounts. Cards show metadata, creator, original invoices and latest activity; expandable history combines every note, payment and total adjustment newest first. Corrected/deleted payments remain visible as reversed and do not count toward paid totals. The same history appears last in the accessible bill dialog, below action forms. Switching bills resets payment/note/file drafts and payment request keys; a failed payment keeps its key for retry.

Notes are text-only. Original invoice uploads remain on creation; the detail screen has no standalone upload. **Add invoice files (optional)** appears only inside Make payment and uploads to that payment's normal linked expense. Existing original and payment files are preserved; the append-upload API remains compatible for existing clients. Money remains integer paise. No new permission key or schema migration is required.

Bills Payable records an unpaid supplier obligation without changing Accounts. The original amount, invoice, description, category/type, vendor, bill/due dates, and append-only notes live on the payable bill. Each **Make payment** action requires a short payment note and creates one linked normal expense, so only the paid installment changes Cash/bank activity and reconciliation. Payment history displays the amount, method/account, actor, timestamp, and saved note. Payments are capped at the calculated remaining balance; an exact final payment shows the bill as Paid. Payment correction uses Expense Records and retains the existing reconciliation locks. Bill totals only increase through an append-only, reasoned adjustment by entering the desired new total; bills with active payments cannot be deleted. Creation/payment invoice controls accept up to five JPEG, PNG, WebP, or PDF files (10 MB each).

Account Settings (Management): accounts/vendors/employees/salary. Real accounts have a default-on **Require daily reconciliation** setting. When disabled, the account is immediately excluded from Reconcile, daily completion, dashboard warnings, and reminders; Cash remains required, virtual accounts remain excluded, and existing reconciled ledger rows remain historical locks. Employee deactivation uses `canManageEmployees`; an inactive employee can be removed from the roster with a sync tombstone, retaining compensation, payroll, and attendance history. Bulk XLSX: `/api/admin/bulk-import-accounts`.

---

## Money

Ledger / expenses / food / salary integers are **paise**. UI: rupees × 100 on the way in.

**Room Revenue** (`getRoomRevenue`) uses booking amounts, which are **rupees** — do not divide by 100. Prepaid check-in records `amountPaid` as online; the OTA prepaid card is only stays not yet recorded.

---

## Add expense

Amount, expense date (defaults to today in IST and cannot be future), stay vs food, category, vendor, cash/online, account if online, notes, bill images (base64). The selected expense date controls its accounting month and Daily Ledger/Reconciliation day; creation time remains the audit timestamp. Drive upload failure still saves the expense with empty/failed link. Audit `expense_added`. Clients send a required UUID `idempotencyKey` (stable until success); retries return `{ duplicate: true }` without a second row (migration **0080** `expenses.idempotency_key`). Same contract for `addDailyIncome`.

**Splits bridge:** Goko-as-payer and `payGokoReimbursement` insert the same `expenses` row (paise, split expense date, cash `accountId` null, never `paySalary` / Salary). See [flows-splits.md](flows-splits.md). Splits IOUs are **not** Accounts until cash moves.

---

## Ledger + reconcile

Manual income sources are Stay Revenue, Food Revenue, Refund Received, and Other. Other requires a separate source detail; description remains optional notes. Refund Received means positive money returned to Goko (for example, a vendor refund), not a refund paid to a guest. Cash has no account id; online income always names an active account. The Add Income page and Daily Ledger quick-add use the same form and validation.

Income cannot be added to or deleted from an account/date that is already reconciled; undo that reconciliation first.

```mermaid
flowchart TD
  OP[Opening: today row else yesterday close else account.opening_balance] --> INC[income + auto food]
  INC --> EXP[expenses that day]
  OP --> EXP
  EXP --> EXPCT[expected closing]
  EXPCT --> ACT[staff actual closing]
  ACT --> ROW[upsert daily_ledger isReconciled=1]
```

Unique `(date, account_id)`. Cash (`account_id = null`) and each configured online account are reconciled independently, with their own actual closing, notes, actor, timestamp, and action button. Multiple online accounts may be completed in any order by different authorized users. The day is complete only after Cash and every active account are reconciled. Mismatch highlight if |diff| > ₹0.50. `adjustOpeningBalance` works without reconciling (manage accounts). Admin-only `undoReconciliation` clears only the selected account lock.

Food and room **online** receipts are automatically recorded in `guest_receipts` against the selected receiving bank and included in reconciliation; manual `daily_income` remains separate. Food Mark Paid Received-in may also use the **Website / Razorpay** virtual account (`platformKey` `razorpay-website` from `ensurePlatformProfile("Razorpay Website")`); room receipts and `saveReceiptDefaults` still require non-virtual banks. When `markOrderPaid` closes an open food Razorpay QR, online/split payments require an explicit `onlineAccountId` (no silent default). A combined food payment keeps per-order receipt allocations but shares one operation ID, so Account Activity shows the bank-sized payment once (reference like `D261-01 + 17 more`). One Pay confirm from Order Summary, Combined Bill, or Dashboard checkout food pay is one Account Activity row for the confirmed amount; separate Mark Paid / payment-detail saves for the same guest stay separate. `markOrderPaid` assigns a single `operation_id` even when the client omits `receiptId`. Ordinary food and non-OTA room cash portions are recorded prospectively in `cash_payment_events`; OTA postpaid cash remains in `booking_payment_events`. Cash Account Activity and reconciliation include those journals plus manual cash income and expenses. Tender returned as change is excluded. Historical ordinary cash totals are not backfilled because their transaction dates cannot be reconstructed safely. Virtual platform accounts remain excluded from bank reconciliation; food Received-in is the only selector that includes the Razorpay Website virtual.

Account Activity retains the guest/order reference and authenticated payment creator. Order Summary includes recent paid orders within the configured visibility window and keeps unpaid orders visible indefinitely. Food revenue remains based on paid non-cancelled food orders. Expense and Income Records use inclusive ISO accounting-date ranges, defaulting to the first of the previous month through today; expense filtering never uses legacy `created_month` labels.

Reconciliation balances use the latest prior actual close as a checkpoint, then include all account activity after that close through the selected date. When no actual close exists, the account opening balance is the base and all activity through the selected date is included. Cash corrections are append-only but displayed net against their original operation and business date; real refunds remain separate negative movements on the refund date. The detail rows remain scoped to the selected day. Financial edits, additions, and deletions are blocked when an affected transaction date is covered by a later actual close until reconciliation is undone.

Ordinary cash corrections reduce the latest recorded collections first, spanning operations when needed while retaining each original business date. They never attach to a refund. Corrections exceeding recorded collections are rejected for review; legacy cash history is not inferred. Conflicting reuse of a cash operation ID is rejected. Cash source balances and any split online receipts commit with their journal entries in one database batch/transaction.

## OTA receivables and settlement

Prepaid OTA bookings are recognized when the guest is checked in: any `paymentStatus === prepaid` check-in calls `recognizePlatformBooking` (idempotent by booking cycle), even if the compatibility `amountPaid` write was already applied. Recognition records gross charge, tax charged, tax withheld, commission, TDS, TCS, other deductions, and expected net payout in an immutable booking-cycle journal. Platform Receivables exposes each component with booking, guest, and stay details so tax charged is not confused with tax withheld or platform fees. The loaded list can be filtered client-side by platform and inclusive check-in date; hidden selections are removed, and the selected summary totals known values while marking incomplete Razorpay fee/net totals Pending. Mobile cards select from their non-interactive surface and turn green when selected. These view controls do not create a bank receipt or change authorization. A platform profile automatically creates a virtual account such as `MakeMyTrip Receivable` or `Goibibo Receivable`; virtual accounts never participate in daily reconciliation. The `recognizeMissing` API action (not exposed in the Accounts UI) backfills prepaid checked-in stays whose `checkin_date` is on or after `2026-09-20` and that still lack a recognition row; it requires `canAdjustPlatformReceivables`, skips already-recognized cycles, and continues past per-booking money/parse errors so one bad Aiosell float does not abort the batch.

Direct website Razorpay payments are shown from the Cloudflare-only native checkout ledger. Captured payments stay receivable until a real bank payout is recorded. Razorpay-reported fee and fee tax fields are retained with payment evidence and deducted, along with refunds, from the expected net; until both fee and tax are verified, net outstanding remains pending and the payment cannot be allocated. Staff can `refreshWebsiteFees` (provider evidence wins) or `setWebsiteFees` for still-null fields only (`canAdjustPlatformReceivables` for manual; settle permission for refresh). Website test-mode payments are excluded. Each payout can be allocated to multiple compatible receivable rows (OTA and website each capped at 100 selections). Inserts are chunked under D1’s ~100 bind/statement limit (OTA ~12 binds/row → chunks of 7; website ~7 binds/row → chunks of 12) and committed with `db.batch` so multi-chunk allocate stays all-or-nothing — UUID `allocationKey` values are not idempotent, so sequential chunk commits are forbidden. The Accounts UI shows the shared `ActionProgress` overlay for record payout (`Recording payout…`), allocate (`Allocating payout…`), and fee refresh/save while those requests run. Remaining payout and booking/payment balances are checked before insert. Unallocated and explicitly acknowledged variance amounts remain visible. Cancellations, post-recognition OTA modifications, refunds, and reversals append adjustment rows rather than overwriting history. A cancelled/no-show row reused by Aiosell increments `booking_cycle` so the new stay cannot inherit old receivable or refund state.

`pah: true` (pay at hotel) remains a normal desk collection and is not recognized as an OTA receivable. Missing/unsupported currency is not guessed into INR. Existing historical rows are not silently rewritten; the Sep-20+ `recognizeMissing` API action is the explicit reviewed ops backfill (one-shot after deploy, not a standing UI control). Website Razorpay rows use the same settlement-compatibility rule as OTA rows: with no payout selected, or with a `razorpay-website` payout selected, checkboxes stay enabled when outstanding is positive; other payout platforms leave website rows disabled.

Room booking receipt writers now pass paise to `guest_receipts` (booking UI amounts remain rupees). Existing pre-0054 room receipt rows are left untouched because their unit provenance cannot be safely inferred; review those rows before any historical correction.

---

## Room Revenue

Accounts tab cloned from Food Revenue. `getRoomRevenue` (`canViewFoodBills`): stays whose **check-in date** is in `[fromDate, toDate]` and `occupiedForRoomRevenue` — `checked_in`, `checked_out`, or `cancelled` with `checkedInAt` set. No-shows and cancel-before-check-in are out.

Goko till = `amountPaid` (never invent OTA prepaid as collected). Cash/online split via `payment_method` + `cash_received` (`cashCollected` / `onlineCollected` in `src/lib/stayPayment.ts`). Cash method uses `amountPaid`, not tender. Paid rows with empty method → summary **Collected (no method)**. Refunds (`amount_refunded`) reduce net Room Revenue and do **not** reduce `amountPaid`. Room Revenue does **not** auto-post `daily_income`.

For eligible OTA postpaid INR bookings, the append-only `booking_payment_events` journal supplies collection/refund tender values by booking cycle, avoiding double-counting the booking's compatibility `amountPaid` projection. Stay totals remain selected by **check-in date**. The separate **Postpaid OTA payments received** section is selected by payment business date and shows collection, refund, net Goko movement, cash/online split, and unresolved cancelled/no-show advances; it is a cash-movement report, not earned room revenue. Corrections are excluded as actual movement but offset the reconciliation balance. Future occupied-stay totals include net collections/refunds, including advances; payment itself does not change subtotal, tax, or billed total. Archived cycle snapshots preserve future OTA rebook history, but older cycles overwritten before rollout cannot be reconstructed.

Cash collections/refunds feed Cash Reconcile directly from journal cash portions exactly once. Online collection/refund portions create linked positive/negative `guest_receipts` in the selected active non-virtual account and therefore flow through online account activity/reconciliation. Do not add these same payments as manual Stay Revenue or Daily Ledger income. Legacy opening balances have unknown actual dates and are not shown in the payment-date movement section.

When sync merges real refunds from disconnected replicas that exceed the Goko collection total, the booking detail and Room Revenue show a review warning and preserve the negative net instead of dropping a real refund. Check the event/tender history and reconcile the actual cash/bank movements before posting further refunds.

---

## Salary

`paySalary` → `salary_payments` **and** `expenses` category Salary. Month string on both.

---

## Bulk import

XLSX template → validate → dedupe → batch 50. Duplicate expense: date + amount + category + notes. Income: date + amount + source + source detail + description. Online rows require an account; cash rows must not include one. Excel serial dates supported.

## Recurring expenses

Cloudflare web Admins can create daily, weekly, monthly, or yearly recurring expense rules with an optional inclusive end date. Rules retain normal expense category, vendor, payment, type, and notes fields; Internal Transfer is deliberately not recurring. Review rules create non-financial due drafts; automatic rules require a fixed amount and post a normal expense. Pending drafts may be posted with an actual amount and bill files or skipped. A unique rule/date occurrence makes retries safe, and a draft never affects Accounts or reconciliation before posting. Expense Records labels every expense linked to an occurrence as **Recurring**, including automatic posts and reviewed drafts that were posted from the schedule.

Rules are displayed as detail cards showing status, amount, type/category, schedule, payment/account, vendor, notes, and audit metadata. The pencil opens a scroll-safe full-field editor; it uses the same validation and `saveRule` contract as creation.

Internal Transfer creates a linked debit expense on the source ledger and an income credit on the destination ledger. Cash is an account endpoint; cash transfers require Cash on one side and online transfers require two active real bank accounts. Transfers never contribute to Analytics, are immutable, and require both expense and income creation permissions.
