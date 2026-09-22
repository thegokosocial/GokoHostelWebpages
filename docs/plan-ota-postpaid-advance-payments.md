# Plan: OTA postpaid advance payments

**Status:** Implemented and validated on the local checkout. See the implementation and validation notes below.

## Goal

Let authorized staff record cash, online, or split payments received directly from guests on eligible pay-at-property OTA bookings. Support full and partial amounts, update the booking balance, and preserve an auditable record without granting booking-edit permissions.

## Decisions and recommendation

- Scope the action to explicit OTA pay-at-property/postpaid bookings. Do not infer eligibility for prepaid or unknown-payment bookings.
- Add a separate payment-date view for pre-arrival advances/collections on the Accounts → Room Revenue page. Keep the existing occupied-stay revenue view grouped by check-in date. This makes money received visible immediately while keeping the report's two date bases clear; do not add advance amounts to the existing billed or occupied-stay totals before arrival. This is my recommendation: the user prefers immediate visibility and is open to this separation if it avoids mixing report bases or double counting.
- Support recording refunds when a booking with a Goko-collected advance is cancelled or becomes a no-show. Use the same partial/full refund flow for both. Cap the refund at the unrefunded Goko collection. Keep any amount not refunded visible as held/unresolved until staff explicitly records its disposition; do not silently classify it as earned room revenue.

## Scope and eligibility

Enable the payment action only when all of these are true:

1. Booking source is the channel manager and the OTA payment terms explicitly mean pay at property (`pah: true`, or the persisted `pay_at_hotel` / supported equivalent).
2. The OTA explicitly supplied INR as its source currency. Current ingest can default a missing currency to INR, so do not rely on that legacy `currency` value alone; persist a nullable source `otaCurrency` (or equivalent explicit-known marker). Do not guess an exchange rate for another or missing currency.
3. Booking state is `received`, `hold`, `checked_in`, or `checked_out`.
4. There is a positive amount still due.

Do not expose this action for prepaid OTA stays, unknown OTA terms, cancelled/no-show/guest-declined bookings, or manual walk-in/offline/direct-website bookings. Keep existing editing and collection workflows for those other booking types unchanged.

The action records money received by Goko; it does not charge a card, request a Booking.com payment, or claim that the OTA has collected anything.

Persist channel payment terms and source currency separately from local payment progress. Populate them from explicit OTA values, update them only when a later OTA payload explicitly supplies supported values, and preserve them when a payload omits the field. `paymentStatus` may become `paid` after Goko collection and is not the source of truth for OTA terms. Snapshot the terms and currency on each event for audit.

## UI and authorization

- Add a payment-only action to Booking Detail for eligible bookings. Show the existing total, already paid, remaining balance, and a full-balance shortcut; allow a custom partial amount.
- For an eligible OTA booking, show one clear collection action. Staff with the new permission use the partial-payment flow instead of seeing duplicate legacy/new buttons; existing `canCheckIn`/`canAddBooking` users retain their existing full-balance path where they do not have the new permission.
- Payment methods: cash, online, and cash + online. Require split components to add up exactly to the amount being applied. For cash, distinguish amount applied from tender/change. Support two decimal places because OTA booking totals can contain paise fractions such as ₹472.50.
- Convert booking totals, current paid amounts, payment inputs, and comparisons to integer paise through one shared helper; project back to rupee fields to two decimals. Never use whole-rupee rounding for this feature.
- Allow an optional note and show the payment date, amount, method/split, receiving account for the online portion, and actor in payment history.
- Create one operation/idempotency key per payment attempt for every method, including cash. Reuse it for retries and keep the modal open until the server confirms success or the event is reloaded by that key; do not close the modal before the result is known.
- Reject zero/negative amounts, amounts above the current due, invalid split totals, and inactive/virtual receiving accounts. Re-read the booking and balance on the server before recording.
- Require a unique idempotency key per operation. Reusing a key with a different booking, cycle, amount, method, or payload returns a conflict; a same-payload retry returns the original result and repairs missing projections.
- Protect the balance check with an atomic compare-and-set/transaction against booking ID, cycle, current total, paid/refunded projection, eligible status, and source payment terms. A fresh read alone is insufficient when two staff submit different payments at the same time or an OTA update changes the total/status concurrently.
- Add a narrow `canRecordBookingPayments` permission to the shared permission catalog and server action map. It grants no booking edit, cancellation, check-in, or refund rights. Admin continues to bypass action maps.
- This action permission does not grant the Bookings page/detail view gate. A non-admin must also have the existing booking-view access to open a booking; page access remains separate from the payment mutation right.
- The online-account selector must use the safe room-receipt account action and add `canRecordBookingPayments` to that action's access map. Do not make this permission depend on `canManageAccountSettings` or expose account-setting mutation APIs.
- The cancellation/no-show refund selector must use the same safe account list and permit users already authorized for that operation (`canDeleteBooking`, including the existing manager cancellation exception where it applies) to select an active non-virtual account when the refund has an online portion.
- Keep cancellation/refund authorization under the existing cancellation permission; this is a separate action from recording a payment.
- Refresh Booking Detail, the booking list/calendar balance, and payment history from the committed response so the user does not see a stale balance after saving.

## Payment record and booking balance

Use a durable, append-only booking payment event journal for collections, refunds, and required payment adjustments. Keep the booking's existing amount-paid and payment-method fields as compatibility projections used by Booking Detail, Room Revenue, and existing APIs. Store cumulative `amountRefunded` from the journal too; legacy single-refund method fields can represent a single tender only, so use the event history for method splits when a cycle has multiple refunds.

Each event should retain:

- a unique event/idempotency key, unique across both runtimes;
- booking ID **and booking cycle** (Aiosell can reuse a cancelled/no-show booking row for a new stay);
- currency code; feature-created events are INR, while legacy unknowns retain unknown currency and cannot be used to infer eligibility;
- event type (`collection`, `refund`, or `correction`) and integer paise amounts. Collections/refunds are positive actual money movements; a correction is a reason-required, signed non-payment adjustment linked to the event it corrects, and never masquerades as an actual receipt/refund;
- cash amount applied, online amount applied, cash tender, and change as distinct values where relevant. Room reporting must sum event components, not infer a multi-installment method split only from the booking's single `paymentMethod`/`cashReceived` fields;
- online bank account used for the incoming receipt or outgoing refund when applicable;
- guest name, OTA booking reference, platform, and stay-date snapshots. Aiosell can reuse the same booking row for a new cycle, so audit and account activity must not display the new guest/reference on an older event;
- business date, optional note, actor, and sync metadata. `businessDate` is null for legacy opening entries whose actual date is unknown.

Set the payment business date from the recording runtime in Asia/Kolkata for v1; do not silently backdate or future-date it. Keep the precise creation timestamp as well. If late entry/backdating is later needed, make the actual received date explicit and audited rather than changing the event timestamp.

The journal is authoritative for eligible-OTA money movements. Recompute the booking's compatibility projections from a deterministic per-cycle legacy opening collection/refund plus posted journal events. Seed both legacy `amountPaid` and prior `amountRefunded`, preserving known tender splits where possible; otherwise retain an explicit unknown-method amount. Do not seed a fictional date or create a guest receipt. Refund summaries also come from events; the old single-refund method fields cannot represent multiple refunds. Do not create new committed events until the same-replica balance compare-and-set succeeds.

Derive each event's stable seed/key from the booking's sync UUID plus booking cycle, not its local integer row ID, so the same legacy event is deduplicated after FK remapping across Pi and Cloudflare. Append-only sync must merge events by stable event identity and never last-write-wins one runtime's journal over the other's. Rebuild the per-cycle projection deterministically from the merged set after every sync; retain distinct events from disconnected replicas. Add indexes for `(booking_id, booking_cycle)` and payment business date so booking history and date-filtered reports do not scan the full journal.

Projection rules: `amountPaid` is legacy gross collections plus journal collections and correction effects on collection events; `amountRefunded` is legacy refunds plus journal refunds and correction effects on refund events; neither projection treats a refund as if the original collection never happened. Due is `max(0, amountTotal - (amountPaid - amountRefunded))` for active pay-at-property bookings; credit/overpayment is `max(0, amountPaid - amountRefunded - amountTotal)`. A correction must reference the event it reverses, cannot reverse more than its remaining amount, and is excluded from cash-movement totals. If it corrects an online receipt, append a linked receipt reversal of the opposite sign so Account Activity nets to the corrected amount while keeping the false original and correction visible in audit.

The journal must be durable across the Pi/Cloudflare sync path. Recompute the payment projection after sync instead of letting the ordinary `bookings` row update conflict decide `amountPaid`, payment method, or refund totals. Before enabling writes, backfill source terms/currency only from explicit raw OTA fields (leave `otaCurrency` null when missing; never copy the schema's default `currency=INR`), then seed the current booking-cycle row on both runtimes only when terms and INR currency are verified. Payment events and cycle snapshots require the booking's stable `sync_id`; if an eligible row is missing one, reject the write with a recoverable 409 instead of creating a local-only identity or risking a colliding opening event. Complete the existing Server Sync sync-ID backfill and synchronize identities before staff use the action. Do not pretend overwritten historical cycles can be reconstructed from a reused row. Never lazily seed different opening values on disconnected replicas. Mark those as legacy balances, do not assign a fabricated receipt date, and do not create guest receipts for them. A stale-balance conflict may still produce an overpaid booking if two offline replicas independently accept money; preserve both real receipt events, show the overpaid amount, and require an explicit refund/resolution rather than dropping or clamping money. If disconnected replicas both issue refunds against the same stale refundable balance, retain both actual refund events and visibly flag the resulting over-refund/underpaid state for review; never discard a real refund to force the projection back under its cap.

Because Aiosell reuses the booking row when an OTA reference is rebooked, archive the prior cycle's stay snapshot before incrementing `bookingCycle`: guest/reference/platform, stay dates, booking status, booking-created, checked-in and checked-out timestamps, persons/room, subtotal/tax/total in integer paise, source currency (including unknown), and source payment terms. Sync this small immutable `booking_cycle_snapshots` record by stable booking sync UUID + cycle. `getRoomRevenue` and stay-finance analytics can then preserve historical occupied-stay rows by check-in date while joining payment/refund components from that cycle's journal. A cycle snapshot created at reuse preserves future history; previously overwritten cycles cannot be reliably backfilled. Current balance and active controls still use only the live cycle. The snapshot does not recreate old bed assignments, so it must not be used to claim historical bed occupancy beyond the data it stores.

Use the same journal writer for new advance collections, existing check-in/remaining-balance collections on eligible postpaid OTAs, cancellation refunds, and no-show refunds. Do not journal OTA-prepaid receivable recognition as Goko cash: that recognition is not a guest payment to Goko. Preserve the existing API restriction that `editReservation` only edits payment amounts for manual bookings; eligible channel-manager OTA payments use the dedicated flow. Keep existing edit behavior for walk-in/offline/website and other out-of-scope booking types unchanged.

Do not edit/delete posted journal events. If a record was entered by mistake without money moving, allow an Admin-only, reason-required correction linked to that event. It does not count as an actual collection/refund in the payment-date view, but it must offset the erroneous entry in cash/online reconciliation (including a linked opposite-sign `guest_receipts` reversal for an online entry). If money was actually returned, record a refund event instead.

Preserve the OTA's pay-at-property terms while the local paid amount changes. Derive balance/progress from the recorded amount and total, and set the existing payment override so a later OTA webhook cannot silently erase the local payment state. A later OTA price reduction can leave a credit/overpayment: show it explicitly and never display a negative amount due or collect more.

Exclude legacy opening-balance rows from the payment-date cash-movement view because their actual payment date is unknown. They still count in the occupied-stay balance/revenue projection. Label the payment-date view as available from event-journal rollout onward where needed.

Writes must be idempotent and recoverable: a retried collection, cancellation, no-show, or refund request with the same event key must not increase/decrease the balance twice or create another online receipt. Within one runtime, the event, balance compare-and-set, lifecycle transition, booking projection, and receipt projection should post atomically. External Aiosell inventory/no-show calls happen after the local commit; their failure must return a retryable warning without inviting staff to repeat the financial event. If a receipt projection needs repair, retrying the same key must repair that receipt without applying the collection/refund again. Keep the idempotency key on screen after an uncertain response so staff can retry/check the same operation instead of unknowingly creating a new one.

## Refund and cancellation handling

- Extend full cancellation so a received/held booking with recorded Goko advances can record a cash, online, or split refund, as the checked-in cancellation flow already does. Commit the status transition and refund event together, so a concurrent OTA cancellation/status change cannot leave a refund receipt without the matching booking outcome.
- For a non-cancelled/non-no-show eligible booking (`received`, `hold`, `checked_in`, or `checked_out`), refundable credit is at most `max(0, Goko collections − prior Goko refunds − current booking total)`; this permits an OTA price-reduction overpayment to be returned without refunding room charges that remain due, including after checkout. For a cancelled/no-show booking, the cap is `Goko collections − prior Goko refunds`. Neither cap includes OTA-prepaid receivables or platform payouts.
- Record the refund as a separate event. For its online part, write exactly one negative `guest_receipts` row to the selected/appropriate active bank account. Record the cash part in the event journal. If an online refund has no valid account, reject it before changing cancellation/no-show state or posting a partial refund.
- Leave `amountPaid` as the historical gross collected amount; track cumulative refunds separately and calculate net Goko collection as collections minus refunds. The refundable ceiling is gross Goko collections minus all prior Goko refunds.
- A cancelled booking must not show an actionable hotel balance or a collect button. Any amount not refunded remains explicitly held/unresolved until staff records refund or retention disposition.
- OTA-prepaid cancellation/refund continues through Platform Receivables; never create a Goko bank refund from an expected OTA payout.
- Extend the no-show workflow to offer the same partial/full cash, online, or split refund flow as cancellation. Include eligible `hold` bookings in the no-show transition once their check-in date has arrived; the current route accepts `received` and `guest_declined` but not `hold`, which otherwise strands a collected advance. Add a refund action for eligible non-cancelled/non-no-show bookings only up to refundable price-reduction credit (including checked-out stays), plus a refund-only action for later refunds on cancelled/no-show bookings while unrefunded Goko collections remain. Stand-alone refunds use the existing `canDeleteBooking` permission; an immediate refund remains available only to a user authorized to perform that cancellation/no-show transition. Commit the no-show transition and any immediate refund together. Do not auto-refund or silently treat an unrefunded amount as earned room revenue; keep it visible as held/unresolved pending explicit disposition.
- OTA cancellation webhooks do not imply that Goko returned money. Keep any Goko advance as held/unresolved, show the refund action, and record a negative receipt only after staff confirms an actual refund.
- Partial bed-assignment cancellation is not a full booking cancellation. Do not prorate or refund an advance automatically; if an OTA total later changes, recalculate due/credit from the updated total and preserve the payment events.

## Accounts, Room Revenue, and analytics

### Room Revenue

Keep the existing stay view: occupied stays selected by **check-in date**, with billed amount, Goko cash/online collected, unpaid, refunds, and net. For journal-backed bookings, source collected/refunded tender totals from current-cycle events and exclude their compatibility `amountPaid`/refund projections from the legacy aggregation, so one payment is never counted twice or assigned to only the latest payment method. Leave legacy/prepaid booking calculations on their current path. Do not alter subtotal, tax, or booking total when a payment is recorded: the advance settles the existing guest balance; it is not a new sale or tax calculation. It remains rupee-denominated and does not automatically post income to the Daily Ledger.

Add a clearly separate **Postpaid OTA payments received** cash-movement view/section selected by **payment date**, with an advance/pre-arrival marker, cash/online split, refunds, and unresolved cancellation/no-show amounts. Show gross collections, refunds, and net Goko movement as distinct amounts; none is labeled recognized/earned room revenue. It should show the advance as received immediately. Apply the selected date endpoints independently: the stay section filters by check-in date; the payment section filters by payment date. Put the date basis in each section heading and do not combine their totals: the two views can refer to the same money from different reporting perspectives. Keep payment dates in the event journal after check-in so the cash-flow history does not disappear. Do not imply this subsection covers every channel's room receipts unless their existing collection paths are also brought into the journal.

The payment-date section covers actual collection/refund events only; exclude undated legacy opening balances and non-cash correction events/reversals. Query by indexed business date and show the selected range and basis in the section heading so the existing check-in-date range control cannot be mistaken for the payment-date basis.

When the guest checks in, the advance is included in the occupied stay's collected amount and reduces its remaining balance. The receipt-date event remains available in the separate payment history. Label the two views so staff do not add them together.

### Account Activity and reconciliation

- Write the online portion once to `guest_receipts` in paise, using the actual receiving bank. It should then appear in Account Activity and online reconciliation on its business date. Link it to the payment event by a stable event/receipt ID and use the event's guest/reference/cycle snapshot in Account Activity after OTA row reuse. Ensure sync applies the event before its receipt or persist the display snapshot on the receipt too, so a partial sync cannot show the wrong guest. A receipt projection reversal that corrects an erroneous journal entry must retain its own `reversal` kind and reference the original receipt; it is not a claim that money physically moved back.
- Cash remains a cash movement in the booking payment journal/Room Revenue payment view; include applied cash collections and cash refunds in the Cash Reconcile expected balance directly from journal events. Include correction effects there only to offset a mistaken posted event; do not count a correction as a real collection/refund. Do not also insert payment events into `daily_income`, which would double count if manually entered. Show the journal movements in reconciliation details with booking/event references, and tell staff not to add the same booking payment as manual Stay Revenue; leave the manual Income Records and Daily Ledger entry model intact.
- Online refunds are negative guest receipts; cash refunds remain explicit cash refund events.
- Pay-at-property guest payments are not OTA receivable settlements. Leave platform payout/receivable rows unchanged.
- Before committing a cash/online collection, refund, or correction, reject it if its business date/account is already covered by a reconciled close; staff must undo the affected reconciliation first. Apply the same guard to later actual closes whose opening-to-close range includes that event. This keeps both the expected and saved actual-close comparison valid.

### Analytics

Update payment reporting to separate OTA payment terms from payment progress. A Goko-collected postpaid booking must not be mislabeled as OTA-prepaid merely because it is fully paid. Eligibility and terms reporting must use the separately persisted channel terms, not only the mutable `paymentStatus`: existing check-in collection can set that status to `paid` even though the channel terms were postpaid. Report partially paid, fully paid, and still-due progress from net Goko collections/booking total while retaining the OTA terms history.

Add a Goko-collected-postpaid-OTA payment/refund metric by payment date from the journal so an advance appears when received. Do not assume the current stay-based `obtained room revenue` queries will include it merely because `amountPaid` changes: the main query filters to `confirmed`, `checked_in`, and `checked_out`, excluding pre-arrival `received`/`hold` rows. Keep existing stay/cohort metrics on their documented date/status basis or deliberately revise both query and labels; test this distinction explicitly.

Do not count OTA-prepaid receivable recognition as a Goko payment in the new metric. Preserve the existing prepaid check-in/Platform Receivables workflow and verify that it creates no postpaid collection event or duplicate bank receipt.

## Audit and history

- Show every collection/refund event in Booking Detail history and the Management → Audit → Bookings view, with amount, currency, method/split, event date, actor, note, and OTA booking cycle. The current booking balance shows only the current cycle.
- The payment event journal is the durable financial audit source. `booking_history` can remain a user-facing projection, but do not rely on it as the only record: it is not in the Pi sync table list and standard audit-retention cleanup can delete booking history.
- Preserve earlier booking cycles in audit, check-in-date stay revenue, and payment-date cash-movement totals, using captured cycle snapshots and journal events. Show only the current cycle's events in the current booking balance/active detail. A reused OTA reference must never inherit a previous cycle's paid/refunded balance or make earlier receipts disappear from either date-based report.

## Sync and lifecycle edge cases

- Register the append-only payment journal and cycle snapshots in the Cloudflare/Pi sync allowlist and FK remapping, add the D1/Pi migration, and document reseed/sync ordering. Migrate both runtimes and finish deterministic opening-entry backfill before enabling payment writes; a runtime that has not migrated must not expose the feature. Ensure bookings/accounts are available before their event/receipt dependents and payment events are available before receipts that use event snapshots.
- Test a payment on Pi while offline, a payment on Cloudflare, and both replicas collecting from stale balances. After sync, no event may disappear; overpayment must be visible for resolution. Confirm cash collection/refund events flow into Cash Reconcile once, online receipts flow into the selected account once, and neither is duplicated in `daily_income`.
- Test both replicas refunding from the same stale refundable balance. Preserve both real refund records and surface over-refund for review instead of clamping or deleting an event.
- OTA modify changing the total after payment must preserve payment events, recalculate due/credit, and respect the local payment override. It must not create another guest receipt.
- A cancelled/no-show OTA reference reused as a new booking cycle must start with a zero current-cycle balance while retaining prior-cycle audit history.

## Workflow scenarios and expected outcomes

These acceptance scenarios describe the intended behavior. The focused journal suite now exercises 13 payment, eligibility, reconciliation, lifecycle, correction, and cycle-snapshot cases; the repository checks below verify the application build, full regression suite, and configured browser workflows. They do not simulate production traffic or a live disconnected Pi/Cloudflare pair.

| Scenario | Expected result |
|---|---|
| ₹472.50 OTA pay-at-property booking; receive ₹150 online before arrival | Paid ₹150.00; due ₹322.50. Payment-date view immediately shows ₹150.00 as an advance. One `guest_receipts` entry for 15,000 paise appears in the selected bank's Account Activity/reconciliation. It is not inserted into Daily Income or the occupied-stay total before arrival. |
| Apply ₹100 of a partial advance in cash; guest hands over ₹120 | Paid increases by ₹100, change due is ₹20, Room Revenue shows ₹100 cash collected, and Cash Reconcile expected closing increases by ₹100 once. It must not include ₹120 tender or require a duplicate manual Stay Revenue entry. |
| Guest checks in; collect remaining ₹322.50 as ₹100 cash + ₹222.50 online | Paid ₹472.50; due ₹0. Occupied-stay Room Revenue shows billed ₹472.50, cash ₹100, online ₹372.50, unpaid ₹0. Journal preserves the three receipt components/dates; no duplicate cash or online entry is created. |
| Same date range, September payment date but October check-in date | September payment section includes the advance and September stay-cohort section excludes the future stay. In October, the stay section includes the stay and payment section excludes the September receipt. The page keeps the two totals separate and labeled. |
| Retry the same online payment request after a timeout | Same event key returns/rebuilds the original result; amount paid and bank receipt remain unchanged. A genuinely new event key is a new payment. |
| Two staff submit different payments at the same time against one local ₹322.50 balance | Atomic compare-and-set allows only the request(s) whose combined applied amount fits the balance; the losing request returns a conflict and creates no event or receipt. |
| Attempt ₹322.51 against a ₹322.50 balance, use an inactive bank, or submit a mismatched split | Server rejects before changing the booking or creating a receipt. |
| Guest cancels before arrival after ₹50 cash + ₹150 online; refund ₹100 online | Cancelled booking has no hotel amount due. Journal shows gross ₹200, refund ₹100, net ₹100 held/unresolved. Account Activity has +15,000 and −10,000 paise online receipts; the cash ₹50 remains visible as a cash event. No occupied-stay room revenue is created. |
| A second refund is requested after ₹100 of the ₹200 collection was already refunded | Refund up to the remaining ₹100 is accepted; ₹100.01 or more is rejected. The cumulative online/cash split, refund cap, and net held amount are recomputed from journal events. |
| Online refund has no active receiving account | Reject the refund before changing the terminal booking state or writing any event/receipt. Cash-only refunds remain available without a bank account. |
| Guest is marked no-show after paying an advance | Offer the same partial/full refund controls as cancellation. Refund entries, online bank receipt reversals, cash movements, audit detail, and unresolved remainder follow the same caps and reporting rules. No-show revenue is not silently added to occupied-stay revenue. |
| Refund or cancel/no-show response times out after the server commits | Retrying with the original operation key returns the committed outcome and creates no second refund receipt or event. A new key is not silently generated while the previous outcome is uncertain. |
| OTA cancellation webhook arrives after a Goko advance | Mark the booking cancelled but do not assume Goko refunded the guest. Keep the advance unresolved, add no negative bank receipt, and allow an authorized staff member to record the actual refund later. |
| OTA reduces total from ₹472.50 to ₹400 after ₹450 was collected, including after checkout | Keep all receipts; show ₹50 refundable credit, due ₹0, block further collection, and allow an authorized credit refund up to ₹50 while the booking is not cancelled/no-show. A ₹50 refund leaves ₹400 collected against ₹400 billed; do not make due negative or rewrite event amounts. |
| OTA increases total from ₹472.50 to ₹500 after ₹150 was collected | Keep the ₹150 event and bank receipt; show the new due as ₹350. Do not duplicate a receipt or replace the original payment date/method. |
| Staff records payment on a postpaid booking, then OTA modify arrives | Payment event and amount remain; the protected local payment state is not reset by the webhook. New total, if any, recalculates the due/credit. |
| Aiosell reuses a cancelled/no-show OTA row for a new booking cycle | New cycle starts at ₹0 paid/refunded for current balance. Older cycle events remain attributed to the prior cycle in audit and payment-date cash-movement totals; only the current balance/stay row excludes them. |
| Aiosell reuses an occupied cycle for a later reservation | Archive the prior guest, stay dates, occupied status, subtotal/tax/total before row reuse. The prior stay remains in check-in-date Room Revenue and stay-finance analytics with its cycle's journal payments; the live booking detail shows only the new cycle and its ₹0 balance. Do not fabricate old bed-occupancy history from the financial snapshot. |
| An eligible pay-at-property booking is on hold when check-in day passes | It can be marked no-show through the existing authorized no-show flow, with any immediate refund committed with the status transition. A hold before check-in date cannot be marked no-show. |
| Open Account Activity after an OTA row has been reused for a new guest | Old online receipt rows still show the guest, OTA reference, stay dates, and cycle captured when money moved; they must not join to the new guest's current booking details. |
| Existing OTA booking already has ₹100 recorded before rollout | Preserve ₹100 as a legacy opening balance in stay totals; create no fictional payment date or duplicate bank receipt. Do not show that opening amount as a new payment in the payment-date range. |
| Prepaid OTA, unknown OTA payment terms, cancelled/no-show booking, or manual/website booking | New payment-only action is unavailable/rejected. Existing workflows for those booking types continue unchanged. |
| OTA omits currency but legacy booking field defaults to INR | `otaCurrency` remains unknown, so the new payment action is unavailable until an explicit supported currency is received; do not infer INR from the legacy default. |
| Migration runs for an existing OTA booking whose raw payload omitted currency | Do not backfill `otaCurrency` from the defaulted booking `currency`; leave payment collection disabled for that row until the OTA provides an explicit supported currency. |
| A previously fully collected OTA postpaid booking receives a higher OTA total | Even if mutable `paymentStatus` is `paid`, persisted `pah: true`/payment terms still identify it as pay-at-property. The due increases by the price delta and the remaining-payment action is available; do not misclassify it as prepaid. |
| OTA-prepaid booking is checked in | Existing Platform Receivables recognition continues; no new Goko collection event or online bank receipt is created by this feature. |
| Staff has booking-view access plus only `canRecordBookingPayments` | Can open an eligible booking and record a payment/view safe receiving-account choices; cannot edit booking details, cancel, check in, refund, or manage accounts. Booking-view access alone is not enough to post a payment; direct mutation calls without the new permission return 403. |
| Staff corrects a mistaken cash payment entry where no money moved | Posted event remains immutable; an Admin-only, reason-required correction reverses the uncorrected amount in the balance projection and nets the false entry out of Cash Reconcile as a correction, not an actual collection/refund. An actual returned payment uses a refund event instead. |
| Admin corrects a mistaken online collection that created a guest receipt | Original collection and receipt remain in the audit trail; a linked correction and negative receipt reversal net the false account activity to zero. The correction is excluded from actual payment-date cash movement and cannot reverse more than the unreversed event amount. |
| Advance is recorded on a `received`/`hold` booking before arrival | New payment-date metric includes the event. Existing stay-based Analytics only includes it if that query's eligible statuses and date range include the booking; the two labels never imply otherwise. |
| Two disconnected replicas each collect against the same stale balance | Both real events survive sync. If their sum exceeds the final due, the booking is visibly overpaid and needs resolution; offline software cannot prevent money already accepted at both locations. |
| Two disconnected replicas each refund the same stale refundable amount | Both real refund events and matching receipt/cash records survive sync. Flag the over-refund/underpaid result for staff review; never drop an actual returned-money event to satisfy the local cap. |
| A payment date is near UTC midnight | Use the Asia/Kolkata business date consistently on Pi and Cloudflare (for example, 19:00 UTC is the next IST calendar day); do not use the UTC date in one runtime and local date in the other. |

## Implementation and validation notes

Implemented as an append-only event journal plus compatibility projections, with a Pi-safe synchronous SQLite transaction path, stable Pi/Cloudflare sync identity, cycle snapshots, collection/refund/correction actions, cancellation/no-show handling, and payment-date reporting. Booking Detail exposes the narrow payment action and history; Accounts Room Revenue and Analytics separate money movement by payment date from occupied stay revenue by check-in date. Cash entries feed reconciliation once, online entries create one guest receipt, and the feature does not create duplicate Daily Ledger income.

Workflow coverage is in `src/__tests__/booking-payment-journal.test.ts`: paise precision and eligibility, online advance and idempotent retry, overcollection and stale-balance conflict, tender/change, cancellation and no-show refund caps/transitions, correction receipt reversal, cycle snapshots, and payment-term/permission separation. The Pi migration path was exercised in in-memory SQLite. Full repository check results are reported below and do not imply a live Cloudflare/Pi deployment or a disconnected-runtime integration test.

## Implementation files and required validation

Implemented touchpoints: booking and reservation APIs, Room Revenue and Analytics APIs/UI, booking payment modal/detail panel, permission catalog and action map, payment journal and stay balance helpers, schema/migration, Pi/Cloudflare sync, reports, and focused workflow tests. Existing compatibility behavior and permission aliases were retained.

Update the shared permission catalog and keep `docs/pages-and-ui.md`, `docs/auth-rbac.md`, `docs/api-map.md`, `docs/flows-pms.md`, `docs/flows-accounts.md`, `docs/flows-sync.md`, `docs/testing-and-ci.md`, and relevant onboarding notes synchronized. `docs/permission-debt.md` changes only if a key is retired or compatibility behavior changes. Add focused Vitest coverage for eligibility/permissions, paise calculations, idempotency, partial/split collections, cancellation/no-show and active-credit refunds, reporting, correction reversals, and sync reconciliation.

Validation on 2026-09-22:

- `npx vitest run` — passed, 127 files / 1,888 tests.
- `npm run test:e2e` — passed, 6 Playwright browser workflows, including all top-level admin sections and Management tabs.
- `npx tsc --noEmit` — passed.
- `SQLITE_PATH=:memory: node --import tsx scripts/migrate-pi.ts` — passed through all 70 migrations, including 0069.
- `git diff --check` — passed.
- `npm run build` — passed. Next.js reported non-fatal hook-dependency and `<img>` optimization warnings.

These checks validate the local application and Pi migration path. After validation, commit `ab2ae68` was pushed to `main`, the Workers deployment reached 100% traffic on 22 Sep 2026, and migration `0069_ota_postpaid_booking_payments.sql` was applied to production D1. A live disconnected Pi/Cloudflare financial-sync test was not performed.

## Policy note

The user confirmed that no-shows should use the same refund flow as cancellations. The no-show/cancellation flow should support partial or full refunds, and the booking should remain eligible for later refunds up to the unrefunded Goko collection. No retention/forfeiture rule was specified, so any amount not refunded stays visibly unresolved and out of earned/occupied Room Revenue until staff records its disposition.
