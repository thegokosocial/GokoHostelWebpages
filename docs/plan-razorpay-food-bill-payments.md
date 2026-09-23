# Razorpay food-bill payments plan

**Status:** reviewed on 23 September 2026 against the current repository layout and Razorpay's published API docs; implementation has not started. This is the separate food-payment plan requested for food bills. Website booking payments remain a separate workflow and environment selector.

## Current layout verified

The plan now follows the layout that is actually in the repository:

- **Management → Food Settings** is a grouped selector containing **Menu**, **General**, and **Bill Settings**. `AdminFoodSettings` owns kitchen/tax/order configuration; `AdminBillSettings` owns bill branding, UPI ID, and the uploaded manual payment QR. Keep these existing responsibilities intact.
- **Management → Razorpay payments** is a separate **admin-only, Cloudflare-only** page. `RazorpayPayments` has **Room** and **Food** tabs. Room renders the existing `WebsitePaymentsLedger`; Food currently renders a placeholder (“Food payment records will be available here soon”). The Food tab is the planned destination for food payment records, audit, reconciliation, and exceptions.
- `BookingSettings` still owns website booking gateway mode/readiness and the isolated Razorpay test preview. Its gateway selector must not be reused for food. Food needs an independent mode/policy record while using the same environment-specific server secrets.
- `/api/admin/booking-payments` currently serves the Room ledger and booking test preview only. `/api/admin/food` currently serves menu, general food settings, and bill branding only. There are no food Razorpay routes, food gateway tables, or food QR provider handlers yet.
- The current Management navigation makes `razorpayPayments` admin-only and keeps Food Settings children on their existing permissions. No new food payment permission or route should be implied by the placeholder UI.
- Admin and kitchen API calls now use the server-side HttpOnly session model (with optional 15-day remembered sessions); implementation must not introduce browser-stored Razorpay credentials or depend on a plaintext password being sent for new payment actions.

## Decision

Use Razorpay's **single-use, fixed-amount UPI QR Code API** for automatic food-bill collection. The server creates one QR for an immutable snapshot of one or more payable food orders. A verified captured payment can then be matched to those exact order amounts. Keep a manual prefilled-UPI option only as an explicitly unverified fallback; keep cash and existing staff-entered online/split payments available.

Razorpay documents `POST /v1/payments/qr_codes` with `type: "upi_qr"`, `usage: "single_use"`, `fixed_amount: true`, and `payment_amount` in paise. The QR accepts UPI only. Bharat QR/card support is a separate on-demand capability, outside this plan. A QR Code entry in the Dashboard does not establish that API creation is enabled for this merchant; test-key API access and live entitlement must be confirmed first. See [QR Code API](https://razorpay.com/docs/api/qr-codes/) and [UPI QR FAQs](https://razorpay.com/docs/payments/payment-methods/upi-qr/faqs/).

## Current application constraints

- Food order totals are stored in paise in `food_orders`; one guest's My Bills page can aggregate several unpaid orders. Some items can be awaiting special-price entry, so those orders are not payable yet.
- Existing staff cash, online, and split payment actions write `guest_receipts` against a real active bank account. **Razorpay capture must not call that path:** capture is not a bank payout.
- The existing `food_payment_events` table is an append-only manual food payment/refund/correction journal. Keep it for that workflow; do not overload it with provider QR attempts, webhooks, or settlement evidence. Add separate gateway tables with provider-ID uniqueness.
- Existing food correction flows can write negative receipts. A Razorpay refund must instead be recorded as a gateway receivable/refund adjustment; it is not a bank debit until bank evidence shows it.
- Existing `gateway_settlement_allocations.payment_id` has a foreign key to `native_booking_payments`. It cannot safely hold food QR payment IDs. A separate food allocation table must reference the same `platform_settlements` payout; do not create a second payout/bank receipt for the same UTR.
- Food bill QR image/UPI ID settings are already present in Bill Settings. They remain the manual fallback. Automatic Razorpay payment records and audit belong in Management → Razorpay payments → Food, not in the existing Food Settings child tabs.
- Razorpay booking Test/Live configuration and its webhook route already exist. Food gets its own mode selector using the matching existing environment-specific Razorpay secrets; changing Food mode must not change Booking mode. Razorpay secrets stay server-side.

## User and staff experience

### Guest My Bills / PDF

1. Show the exact balance and line/order summary before offering **Pay by Razorpay UPI QR**.
2. Create a server-side QR for that exact amount in integer paise. Render the QR image/provider URL, amount, expiry, and “Pay in your UPI app” instructions. The QR is an incoming payment; never ask the guest to scan it to receive money or provide a UPI PIN to staff.
3. Display a pending state while the provider reports created/authorized or no final evidence. Refresh reads the server's status; it never trusts a browser success claim.
4. Show success only after verified capture and local bill reconciliation. If live auto-confirm is disabled, show **Payment received — staff confirmation needed** and put it in Management → Razorpay payments → Food → Payment audit.
5. On expiry, hide the scannable QR, show “Checking payment status” until reconciliation is complete, and offer cash/manual payment only when the old attempt is safe to close. Do not invite a second payment while an earlier attempt may still capture.

An order placed after a QR snapshot is created is not part of that QR amount. It remains separately due and can get its own attempt. Existing reserved orders cannot be edited or manually marked paid through the ordinary payment endpoint until the attempt is closed/reconciled. An audited override, if later required operationally, must invalidate the QR and route any later capture to review.

### Manual fallback

The current uploaded static QR can remain visible, with explicit “amount may need to be entered; staff must verify payment” wording. If the guest-facing UI generates an amount-prefilled UPI URI, treat it as a convenience only: it is not a Razorpay transaction, does not enforce a fixed amount, and never auto-marks a bill paid. Staff continue using the existing authorized manual payment action.

## Management pages and controls

Keep the existing Food Settings grouping unchanged:

- **Food Settings → General:** kitchen hours, tax, tables, ordering, and kitchen display behavior.
- **Food Settings → Bill Settings:** bill branding, UPI ID, uploaded manual QR, and bill image storage. Add only manual-fallback wording here if the UI needs to distinguish a static QR from an automatic Razorpay QR.
- **Food Settings → Menu:** existing menu and inventory actions.

Extend the existing **Management → Razorpay payments → Food** placeholder into the food payment workspace. It should contain its own sub-tabs or filterable panels for:

- **Food payment ledger:** QR attempts and provider payments with order/bill reference, amount, environment, status, capture/refund totals, and timestamps.
- **Payment audit/reconciliation:** webhook and fetch evidence, unknown/mismatch/duplicate exceptions, staff confirmation, retry/reconcile actions, refund posting review, and settlement allocation links.
- **Food Razorpay settings:** independent Test/Live selector, credential/webhook readiness indicators (presence only), QR API connectivity, webhook setup instructions, QR expiry, auto-confirm toggle, refund posting mode, and enable/disable. Keep this configuration close to the Food tab because it controls that ledger, but do not place it in the existing General food settings form or alter Booking Settings.

The Room tab remains the existing website checkout ledger. Do not mix room and food records in one table or infer food behavior from the Room UI. Do not create a new top-level Management tab for food payments while this shared Razorpay payments page exists.

Defaults: automatic QR disabled until Test-mode verification is complete; food mode is independent of Booking Settings; live auto-confirm **off**; refund posting **staff review**; QR lifetime 30 minutes. The lifetime exceeds Razorpay documentation's minimum close-by interval, whose published docs differ by API version/account. Configure `close_by` on creation, but still reconcile locally at expiry.

Reuse existing permissions where possible: keep the page entry admin-only as the current `razorpayPayments` tab is; use `canManageFoodSettings` only for the existing Food Settings forms; use existing food view/payment permissions for food bill data and staff confirmation where the implementation introduces those APIs; use existing Accounts permissions for payout allocation. Admin bypass continues as documented. Do not grant non-admins access merely because the Food placeholder is visible in source. If the product later needs non-admin access to this page, add a dedicated catalog/action permission and update all RBAC maps/docs/tests together.

### Implementation sequence for the current layout

1. Replace the Food placeholder inside `RazorpayPayments` with a read-only ledger shell and server route, leaving Room unchanged.
2. Add Food Razorpay settings/readiness and audit/reconciliation panels inside that Food tab; keep Bill Settings as the manual QR/branding editor.
3. Add the Cloudflare-only food payment tables and admin actions, then add guest bill create/status endpoints and UI.
4. Add signed webhook/fetch recovery and staff confirmation before any automatic paid-state update.
5. Add refund posting and shared Accounts payout allocation only after the capture/refund/fee/tax evidence gates pass.

## Server and provider flow

### Create

1. Guest submits only the order IDs plus an application request UUID. Server re-reads payable totals, special-price readiness, payment state, current environment, and guest ownership/share-token authorization. Ignore client-supplied amount, guest name, and provider state. A QR always collects the full selected order total; it does not support partial or split collection.
2. Persist an attempt and immutable snapshot (order IDs, per-order total paise, total paise, INR, environment, creation time, expiry) before the provider call. Atomically claim every included order so concurrent tabs/cashier actions cannot create overlapping active attempts.
3. POST one `upi_qr` with `single_use`, `fixed_amount: true`, `payment_amount: snapshot total`, `close_by`, and an opaque internal attempt UUID in Razorpay notes. Do not place guest PII in notes. Save QR ID and returned image URL only after validating response IDs, amount, status, and environment.
4. The QR creation API documents no idempotency header. A request timeout, lost response, database write failure after provider success, or malformed response becomes `create_unknown`; do not automatically POST again. Reconcile by paging the QR API list and matching the opaque note, exact amount/environment/time. If zero or multiple candidates remain, retain the reservation and require staff review through the Dashboard/API logs. Never interpret “no immediate match” as proof the POST did not happen.

### Capture and webhook verification

Use the existing `/api/webhooks/razorpay` route and environment-specific webhook secrets. Add QR event routing without changing booking handlers. Subscribe to `qr_code.credited`, `qr_code.closed`, and the existing payment/refund events needed for reconciliation. Razorpay's QR webhook docs describe `qr_code.credited` and `qr_code.closed`; another Razorpay QR guide notes `qr_code.closed` is not emitted for automatic expiry, so expiry cannot rely on that event. See [QR webhooks](https://razorpay.com/docs/payments/qr-codes/subscribe-to-webhooks/) and [QR webhook details](https://curlec.com/docs/webhooks/qr-codes/).

For each delivery:

- Verify HMAC using the exact raw body and the secret for the configured environment before parsing. Check merchant `account_id`, supported event type, and saved Razorpay QR/payment/refund identifiers.
- Persist environment + event ID + payload hash + minimal IDs before processing. An identical replay is idempotent; changed bytes under an existing ID are rejected. Return retryable failure until the local processing step commits.
- Treat `qr_code.credited` as a signal, not proof of capture. Fetch the QR and all its payments from `GET /v1/payments/qr_codes/:qr_id/payments`; fetch/verify payment details where needed. Paginate (the API caps one page at 100). Require exact saved QR, expected account/environment, INR, UPI method, exact paise amount, and `captured: true`/captured status. `authorized`, `created`, and `failed` are not paid. Do not let a stale failure/closed event downgrade verified capture.
- If exact capture matches and all snapshotted orders remain unpaid at the snapshotted totals, atomically apply paid status to those orders and create a gateway receivable entry. Auto-confirm only when the live toggle is explicitly enabled. Otherwise retain verified capture as `captured_needs_staff_confirmation` until an authorized staff member reviews and confirms it.
- A mismatch, missing attempt, different environment/account/QR, stale invoice, already-manually-paid order, or second captured payment must create a visible review exception. Never double-pay an order or discard a distinct captured payment. Razorpay says duplicate payments on its one-time UPI QR are refunded by Razorpay; track each payment and verify its provider refund instead of issuing an additional refund blindly.
- `qr_code.closed` initiates a fresh provider lookup; closure alone does not prove that no payment was already in flight. At local expiry, fetch QR and payments. Release order claims only after a terminal no-payment/failed state is established; authorized or unknown provider states stay reserved and visible for reconciliation.

### Refunds

Version 1 does not initiate refunds from Goko. Staff initiate them from the Razorpay Dashboard; Goko fetches/records them through the shared webhook/reconciliation path. Cover multiple partial refunds, full refunds, pending, failed, delayed processing, repeated/out-of-order events, and an over-refund attempt. Keep provider refund status separate from Goko's accounting-posting state.

- A verified `refund.processed` (or a provider fetch confirming processed) reduces the payment's expected receivable net exactly once, keyed by provider refund ID. Created/pending refunds reserve unrefunded balance but do not count as completed.
- Default mode creates `needs_staff_review`; `canMarkPaid` staff posts one linked negative gateway receivable/refund adjustment with reason and actor. An opt-in automatic posting mode may post only after provider-verified processed state and only once per refund ID. The bill remains paid after a refund; refund history is not erased.
- Do not write a negative real-bank receipt at refund time. Record an actual bank debit only when the settlement/bank evidence shows it; any intervening settlement netting stays in the Razorpay receivable ledger.
- No posting may exceed captured value less already processed and pending refund claims. Duplicate or conflicting provider refund IDs are an exception, not a second adjustment.

Razorpay permits full and multiple partial refunds for captured payments; fees and fee tax are not reversed by the refund. See [Razorpay refund behavior](https://razorpay.com/docs/payments/refunds/issue/) and [refund FAQs](https://razorpay.com/docs/pos/refunds/faqs/).

### Settlement and Accounts

Capture creates a paid food bill and a Razorpay gateway receivable, **not** a bank receipt. Reuse the actual Razorpay payout header/bank receipt once per settlement/UTR. Allocate it to booking payments and food QR payments in a single shared payout reconciliation, using payment-level evidence from Razorpay settlement details/reports; do not match only by amount/date. Razorpay's basic Settlements API exposes settlement amount/status/fees/tax/UTR, but payment-level allocation evidence must be confirmed from the merchant's dashboard report or enabled report/API before automating allocations. See [Fetch Settlements](https://razorpay.com/docs/api/settlements/fetch-all/) and [settlement dashboard details](https://razorpay.com/docs/payments/settlements/dashboard/).

Keep the current booking allocation table's native-payment foreign key intact. Add a Cloudflare-only food gateway allocation table referencing `platform_settlements` and the food QR payment row. Merge both allocation sources in Accounts UI/API totals, outstanding calculation, idempotency checks, audit, and settlement retry repair. A shared UTR can have mixed booking and food sources but only one bank receipt.

**Required pre-live accounting check:** `gatewayExpectedNetPaise` currently subtracts stored `feePaise` and `taxPaise` separately. Razorpay's QR/payment API describes `fee` as including GST/tax while also returning `tax` separately. Confirm the exact semantics with a real Test-mode payment and its settlement breakdown before reusing this helper; otherwise it can double-subtract tax. Compare capture, refund, fee, tax, settlement amount, and bank credit from the same test sample. Fix the shared helper/docs/tests only after that evidence establishes the correct interpretation. Until resolved, show net outstanding as pending and do not automatically allocate food QR payments.

## Data and API shape

Keep financial ownership in Cloudflare; do not sync gateway IDs, credentials, QR attempts, webhook history, or settlement allocations to the Raspberry Pi.

Minimum additions (table names are proposals, subject to existing migration conventions):

- `food_bill_payment_attempts`: unique request key, environment, immutable amount/order snapshot, provider QR ID, QR image URL, expiry, attempt state, timestamps.
- `food_bill_payment_order_claims`: one active attempt claim per food order; atomically insert/delete claims. Unknown or authorized attempts keep claims until reconciled.
- `food_bill_gateway_payments`: unique provider payment ID, attempt ID, amount/currency/status/captured/refunded/fee/tax evidence, confirmation state and timestamps. Preserve multiple IDs for duplicate-payment review.
- `food_bill_gateway_refunds`: unique Razorpay refund ID, payment ID, amount, provider status, posting state, unique adjustment key, actor/reason/timestamps.
- `food_bill_razorpay_webhooks`: environment + event ID uniqueness, payload hash, minimal resource IDs, received/processed/retry state.
- `food_gateway_settlement_allocations`: settlement FK + food payment FK + unique allocation key + allocated paise and audit fields.

Use unique constraints as the final defense for request keys, QR IDs, payment IDs, refund IDs, webhook IDs per environment, active order claims, receipt/adjustment keys, payout allocations, and bank receipt IDs. Use integer paise end-to-end. Database transitions for capture/mark-paid/claims must be atomic in D1; provider network requests happen outside the transaction with an explicit recoverable intermediate state.

Proposed route responsibilities (final names follow repo conventions):

- Guest create/status: server-authorized bill ownership; never accept amount or payment status from client.
- Food admin ledger/settings: use a new food-specific admin route (for example `/api/admin/food-payments`) rather than adding gateway actions to `/api/admin/food` or `/api/admin/booking-payments`. The route must remain admin-only while the current Management tab is admin-only; it owns food ledger queries, settings readiness, reconciliation, staff confirmation, and refund posting actions.
- Existing Razorpay webhook: signed event dispatch to booking or food QR service.
- Management → Razorpay payments → Food: read/search the food ledger; reconcile selected attempt; confirm verified capture; post verified refund adjustment. Each mutation re-checks environment, amount, state, action permission, and idempotency on the server. Keep the Food tab's UI separate from the existing Room `WebsitePaymentsLedger` while sharing only common provider/audit primitives.
- Existing manual food payment API: reject orders with an active/unknown QR reservation unless an explicit audited override flow is added.

## State and scenario matrix

| Scenario | Required result |
|---|---|
| Same guest reopens page / repeats create request | Return the same saved attempt; one provider create call. |
| Two tabs/cashier try same unpaid order | Atomic claim allows one active attempt; second receives conflict and current attempt status. |
| New order arrives after QR generated | Old QR amount/snapshot stays unchanged; new order remains unpaid/outside that QR. |
| Special price missing, amount changed, cancelled or already paid order | Reject QR creation or route later capture to review; never trust submitted total. |
| QR create times out or response cannot be saved | `create_unknown`; one provider call only; API/Dashboard reconciliation before a new attempt. |
| Guest closes app or network drops after scan | Webhook, guest refresh, or staff reconciliation fetches provider state; no client-only success. |
| `qr_code.credited` arrives before capture | Fetch current payment; show awaiting/authorized; do not mark paid yet. |
| Duplicate webhook or stale `failed`/`authorized` event after capture | Idempotently retain captured; do not repeat paid receipt/transition. |
| Wrong amount/currency/method/QR/environment/account or unmatched payment | No automatic order payment; create an actionable exception and retain provider evidence. |
| Authorized staff action is denied, or a test QR/payment is presented against a live attempt (or vice versa) | Server denies the action or marks evidence mismatched; UI hiding and client-selected mode are never authorization. |
| Exact capture after QR expiry/closure | Fetch current QR/payment and current order state; apply only if captured and still due at exact snapshot. Otherwise review/refund workflow. |
| Staff records cash/online while QR is active | Block by default until QR is safely closed/reconciled. Any approved override invalidates QR and raises later captures for review. |
| Multiple provider payments against one single-use QR | Apply at most one to bill; track other IDs and confirm Razorpay's automatic duplicate refund before resolution. |
| Refund pending/fails/is delayed/replayed | Keep bill paid; do not post adjustment until a processed refund is provider-verified; retries/replays are idempotent. |
| Partial refunds or multiple refunds | Reserve pending claims; total processed + pending cannot exceed captured amount; each refund ID posts once. |
| Refund Dashboard action without webhook | Audit user can manually fetch/reconcile payment's refund list; webhook is not the only recovery path. |
| Payout includes both booking and food QR collections | One payout header/bank receipt; payment-level source allocations share the payout and reconcile to its net evidence. |
| Payout delayed, held, partial, fee/tax variance or refund netted into payout | Keep receivable outstanding/variance visible; no fabricated bank receipt or payment allocation. |
| Webhook secret rotated, event duplicate/mutated, API outage | Verify using active/previous environment secrets according to existing booking policy; reject changed event bytes; retain retryable state and provide manual reconcile. |

## Payment Audit contents

The timeline should combine existing staff-entered cash/online/split actions and payment corrections with Razorpay attempts, QR creation/recovery, provider webhook deliveries, payment fetches, captures, manual confirmation, refund posting, exceptions, and settlement allocations. Record actor (staff or system), action/reason, order IDs, environment, QR/payment/refund/payout IDs, before/after status, exact amount in paise, timestamps, and idempotency key reference. Redact secrets and provider payload PII. Webhook delivery/audit rows are append-only; retries append attempt detail or update processing state without removing original evidence.

## Verification, rollout, and gates

1. **Account access check:** From the Razorpay dashboard shown by the user, verify Test-mode key access and successful test-key `POST /v1/payments/qr_codes`. If denied, ask Razorpay support to enable QR Code API for the merchant. Confirm the live QR API and webhook event entitlement before live rollout. Do not infer access from dashboard navigation alone.
2. **Test-mode end-to-end:** create fixed ₹1 / representative amount QRs, scan with a UPI test path, exercise QR created/credited/closed webhooks, check delayed/authorized state and payment fetch, close/expire QR and verify expiry recovery, and verify refund and duplicate behavior. Confirm webhook events arrive at the existing endpoint with correct mode secret.
3. **Mock/state-machine checks:** exercise all rows in the scenario matrix, including concurrent create claims, unknown create response, duplicate/out-of-order events, changed bills/manual-paid race, refund status/posting idempotency, and mixed-source payout allocation. Assert there is no false bank receipt and no duplicated paid or refund adjustment.
4. **Focused D1/API tests:** apply migrations to disposable D1; cover unique constraints, concurrency, signatures on raw bytes, API fetch errors, all permission gates, test/live isolation, R2/Pi exclusion, and account activity provenance.
5. **Staff pilot:** test only with a small set of food bills in Razorpay Test mode; show capture as staff-confirm-required. Compare one full settlement report/payment/fee/tax/refund breakdown against Goko before enabling payout allocation.
6. **Live rollout:** admin enables Razorpay QR only after all prior gates. Keep live auto-confirm off for the pilot, manually review every capture/refund/payout, then enable auto-confirm or refund auto-post separately after written sign-off. Keep rollback as disabling new QR creation; continue webhook/reconciliation recovery for existing attempts.

When implementation begins, update `docs/pages-and-ui.md`, `docs/auth-rbac.md`, `docs/api-map.md`, `docs/flows-food-kitchen.md`, and `docs/flows-accounts.md`, plus focused tests and migration notes in the same turn, as required by `AGENTS.md`. Run the repository's required full Vitest, TypeScript, diff-check, and production build for the eventual RBAC/API/UI implementation.

## Mock workflow review performed for this plan

Ran an in-memory Node assertion model (no network/provider calls and no repo test files added): **11 workflow groups passed**—fixed amount snapshot/idempotent request, unpaid/pricing readiness and order claims, unknown create no-retry, verified capture plus duplicate/stale event handling, mismatch review, manual-paid race, late capture reconciliation, second capture against single-use QR, refund review/auto-post idempotency, and mixed-source settlement allocation with one evidence-backed bank receipt.

These mocks validate the proposed transitions only; they are not application-code tests or Razorpay Test-mode evidence. The plan was updated with the two issues they surfaced: unknown provider QR creation remains unresolved rather than retried, and provider auto-expiry is reconciled by fetch rather than relying on a close webhook.

## Reviewed provider references

- [QR Code create/fetch/close/payment APIs](https://razorpay.com/docs/api/qr-codes/)
- [Fetch payments for a QR Code](https://razorpay.com/docs/api/qr-codes/gst/fetch-payments/?preferred-country=IN)
- [QR webhook events and signature handling](https://razorpay.com/docs/payments/qr-codes/subscribe-to-webhooks/)
- [UPI QR capabilities and duplicate behavior](https://razorpay.com/docs/payments/payment-methods/upi-qr/faqs/)
- [Razorpay settlement API](https://razorpay.com/docs/api/settlements/fetch-all/)
- [Payment fee/tax fields in QR payment response](https://razorpay.com/docs/api/qr-codes/gst/fetch-payments/?preferred-country=IN)
- [Razorpay refund behavior](https://razorpay.com/docs/payments/refunds/issue/)
