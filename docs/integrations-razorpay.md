# Razorpay integration: authenticated test preview

## Status and safety boundary

The repository now contains a working **test-mode integration path**, not a live guest booking/payment launch. Management → Booking Settings → Payments & Readiness includes a fixed ₹1 simulated Standard Checkout, provider authentication check, durable test-order/payment/refund records, webhook inbox and manual recovery controls. API/network behaviour is verified using mocked Razorpay responses, disposable SQLite and local D1/workerd bindings, not a real merchant account.

Public `/book` remains an enquiry entry. Saving `/book`, selecting `live` in draft policies, configuring live credentials or enabling Channel Manager **cannot** enable guest payments. Test evidence never changes PMS bookings, inventory, guest receipts, bank balances or Aiosell. The test API does not accept a client-supplied price, booking ID, environment or credential. Existing walk-in/offline APIs are not exposed publicly.

This phase deliberately does not collect money before atomic native inventory and fulfilment exist. Live guest checkout, cancellation/excess/operational refund allocation, bank settlement accounting and automated reconciliation scheduling remain implementation/release gates in the [booking plan](plan-first-party-booking-and-payments.md).

## Official sources reviewed

Retrieved from Razorpay's official documentation on 17 September 2026:

- [Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/): server-created order, handler response, stored-order HMAC, authoritative capture verification and go-live checks.
- [Create an order](https://razorpay.com/docs/api/orders/create/) and [fetch orders](https://razorpay.com/docs/api/orders/fetch-all/): integer currency subunits, bounded unique receipt, receipt lookup and retry guidance.
- [Fetch payment](https://razorpay.com/docs/api/payments/fetch-with-id/) and [order payments](https://razorpay.com/docs/api/orders/fetch-payments/): capture and refunded-amount evidence.
- [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/): exact raw-body HMAC, previous secret for retries, duplicate event IDs and out-of-order delivery.
- [Create normal refund](https://razorpay.com/docs/api/refunds/create-normal/), [payment refunds](https://razorpay.com/docs/api/refunds/fetch-multiple-refund-payment/) and [fetch exact refund](https://razorpay.com/docs/api/refunds/fetch-with-id/): captured-payment eligibility, explicit amount, receipt and pending/processed/failed states.
- [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/): bound SQL and result shapes. Source queries use installed Drizzle; no new platform session/transaction API is introduced.

The adapter uses native `fetch` and Web Crypto; no new dependency was added. All requests target the fixed `https://api.razorpay.com/v1/` origin, use test-only Basic authentication, read credentials from Worker `env` via `getCloudflareContext()` with `process.env` fallback, send `Accept: application/json`, use `redirect: "manual"` (Workers `fetch` rejects `redirect: "error"`), disable caching and optional `AbortSignal.timeout(10s)`. HTTP `401`/`403` map to `RAZORPAY_REJECTED` with an admin-facing credential hint; other transport failures stay `RAZORPAY_UNAVAILABLE`. Provider messages/PII/credentials are not returned or logged.

## Setup for a later reviewed test deployment

No deployment, actual D1 migration, merchant API operation or payment/refund was performed in this implementation turn.

1. Read the local maintainer instructions before migration/deployment. Review and apply `migrations/0057_razorpay_test_preview.sql` and `migrations/0058_razorpay_webhook_refund_id.sql` in order to the intended non-production/test database. These add four isolated tables and exact refund identity for webhook recovery; they change no existing booking/account records.
2. Provide `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET` and `RAZORPAY_TEST_WEBHOOK_SECRET` as deployment secrets. They are never accepted/saved by settings APIs or committed. An optional `RAZORPAY_TEST_ACCOUNT_ID` enforces the expected webhook account; configure it for sandbox end-to-end verification.
3. Set `RAZORPAY_TEST_PREVIEW_ENABLED=true` to permit new simulated orders, checkout claims and test refunds. Default is disabled. Every new operation additionally requires a current test webhook secret distinct from current/previous live secrets, and a query preflight of all four gateway tables/columns (including migration 0058) before any provider POST or checkout claim. Missing schema/configuration fails closed; no order/refund is posted. Turning the flag off blocks new operations but preserves provider/API reconciliation and webhook recovery with original credentials.
4. In Razorpay **Test mode only**, register the intended test deployment's `/api/webhooks/razorpay` URL. Subscribe to `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed` and `refund.failed`. Do not register this path as a live-payment processor.
5. For secret rotation, retain `RAZORPAY_TEST_WEBHOOK_SECRET_PREVIOUS` while older provider events can be retried. Test and live webhook secrets must be distinct, including previous secrets. Restore historical test API keys for existing test attempts before recovery; keys/accounts are not silently swapped.
6. Configure automatic capture in Razorpay's Test-mode Dashboard, or manually capture approved test payments there; this preview does not invoke the Capture API. Log in as an administrator, open the Payments panel, check test API connectivity, create/open a simulated order, then reconcile capture and refund. `authorized` is never recorded as captured. Real provider sandbox/browser verification remains required; local mocks are not a replacement.

The Pi migrator may create these empty tables when applying the common SQL migration set, but their rows are not synchronized, and every exposed gateway API/service rejects Pi operations. No test or live financial ownership is delegated to Pi.

## Workflows

### Creation and lost responses

The browser saves a UUID request key before POSTing. The server inserts a test attempt with a unique request key, original public test key ID, unique receipt and fixed `100` paise before creating an order. Only the inserting owner makes the POST. Duplicate/concurrent requests return the same saved attempt.

Any unknown POST outcome—including timeout, malformed response, provider refusal or failure to save the returned order—remains `order_unknown`; it is not converted to definitive failure. A retry does not perform another POST. Reconcile queries orders by the original receipt and verifies exact receipt, amount, attempt note and account key before attaching a single match. Zero/multiple matches remain unresolved. A crash before the remote POST also requires reviewed recovery; the absence of a lookup match is not treated as permission to POST again.

### One-use checkout and browser loss

Opening Checkout first atomically claims `checkout_started_at` if there is no previous claim or payment evidence. Only one claimant receives Checkout options. A lost claim response, a closed/blocked modal or an empty payment lookup cannot release the claim or reopen the same order. SDK retries are disabled. A failed payment must be verified before a fresh, explicit test request is started.

The admin panel enables all Standard Checkout methods enabled on the Razorpay test account (`card`, `upi`, `netbanking`, `wallet`, `emi`, `paylater`). An expandable runbook documents Test-mode paths: domestic cards `4111 1111 1111 1111` / `5267 3181 8797 5449` with OTP `1234`, UPI `success@razorpay` / `failure@razorpay`, and mock Success/Failure pages for netbanking/wallet. After any failure, use **Start fresh ₹1 test** — the same order cannot reopen Checkout.

When Razorpay emits `payment.failed`, the Checkout handler surfaces sanitized `error.code` / `error.reason` / `error.description` to the operator (for example authentication failures). Reconcile and snapshot load attach optional `error_code`, `error_reason` and `error_description` from a fresh `/v1/payments/:id` fetch for failed rows; these are not persisted in D1. The `RAZORPAY_TEST_PREVIEW_ENABLED` setup note is hidden once preview creation is already enabled on the Worker.

The success handler sends order/payment/signature IDs to the authenticated server. HMAC uses the **stored order ID**, not a trusted browser order. After signature verification the server fetches the payment and validates ID, original order, INR amount and coherent capture/refund fields. `authorized` is not collected money. Captured evidence and refund amounts are monotonic; stale failure/authorization cannot erase capture.

If the browser loses connectivity or disappears, order reconciliation and webhooks can fetch and record the capture. Recovery by saved request key (`getTestRequest`) does not create an order and remains available when new preview creation is disabled. The recovery panel is independent of draft validity/environment, so corrupt/stale policies cannot hide the test ledger. Empty/stale order-payment collections trigger direct lookup for already-known payments/refunds rather than discarding their evidence. No guest confirmation, inventory claim or bank credit is invented. Recovery state is retained server-side; browser storage contains a test request key, never gateway/admin secrets.

### Webhooks and outages

The endpoint bounds actual request bytes to 64 KiB, validates required event/signature headers, verifies HMAC on exact bytes before JSON parsing and validates account/payload identifiers. It persists a SHA-256 digest plus minimal resource IDs and processing state—not raw card/guest PII. Identical event IDs are deduplicated; changed bytes under a saved event ID are rejected.

Processing fetches current provider evidence rather than trusting payload status/order. A non-2xx response is returned until supported-event processing is complete. A `payment.captured` event requires verified capture for its exact payment; `order.paid` requires verified capture on its saved order. Empty/authorized API evidence cannot permanently acknowledge these events: they remain retryable until capture becomes visible, including with new tests disabled. Transient database/API failures and unmatched events remain retryable; the admin ledger exposes saved-event retry. Lost order responses can be recovered from a valid order attempt note or by reconciling the saved attempt before replay. Signature failures are not payment failures and cannot write capture evidence.

Unsupported signed test events are marked `ignored`; notably settlement events do **not** create bank receipts. This preview has no scheduled reconciliation job or queue consumer. Do not rely on provider retries indefinitely: retained unmatched/failed events require admin review, and automated jobs/alerts are a live-release gate.

Refund events persist the exact refund ID and fetch `/v1/refunds/:id`, validating ID, owning payment, INR and fixed amount. `refund.processed` remains retryable while that API result is absent/pending/failed; a stale `refund.failed` event may accept a verified terminal processed result but cannot downgrade it. Direct verified results update matching local reservations, and a stale collection cannot erase completion. External refund verification never invents a local refund reservation. Retained legacy events without refund identity require manual review or an authenticated byte-identical redelivery; only that verified redelivery may backfill the missing ID. Collection lookups at the full 100-item bound remain ambiguous for orders, payments and refunds.

### Refunds and lost responses

Only a verified captured, not externally refunded **test** payment is eligible. The preview supports one full `100`-paise claim per payment. A unique payment-owned reservation and receipt are saved before the remote POST; concurrent/repeated requests cannot create a second refund. Client amounts are rejected.

An unknown refund result remains reserved. Reconciliation fetches the original payment's refunds, matches exact receipt, refund note, payment, INR amount and provider ID, and records `pending`, `processed` or `failed`. A pending request is not a completed refund. `processed` is terminal. No automatic POST retry or second claim is allowed, including after verified failure; reviewed manual provider recovery is required in this preview. General partial/incremental refund allocation in the specification model is not yet a production workflow.

## Settings concurrency

`getSettings` returns an opaque revision of the exact saved draft. `saveSettings` must supply it. The server validates and merges partial updates, then performs a single-statement compare-and-set against the raw saved value (or a unique insert for absence). A stale/missing revision or intervening write returns 409 `BOOKING_SETTINGS_CONFLICT`, without overwriting the saved draft. The UI blocks saving and offers reload; unsaved edits must be reviewed after reload. Older save clients must adopt the returned revision.

Corrupt/incompatible saved drafts still return 409 `BOOKING_SETTINGS_INVALID` and require reviewed repair, not automatic default activation. These remain draft preferences, not published financial policy snapshots.

## Validation and limits

The preceding hold milestone passed **96 Vitest files / 1,585 tests**, including **234 focused booking/payment tests** (87 Razorpay preview, 9 local D1/workerd, 39 native hold, 74 routing/configuration and 25 persistence/CAS checks), TypeScript, diff checks and production build. The next milestone adds 20 [internal quote/refund calculation tests](native-booking-quotes-and-refunds.md); its final validation is recorded there. The 66 original workflow simulations and 19 adversarial probe groups passed in the preceding gateway review. Existing unrelated hook-dependency/image-optimization lint warnings remain. Other test-suite additions from concurrent repository work are included in the full regression count; unrelated changes were preserved. The [internal native hold primitive](native-inventory-hold-foundation.md), quote and cancellation calculators are not connected to Razorpay or public checkout.

Focused tests cover real route/service/Drizzle queries on the exact migration in disposable SQLite, provider-response mocks, independent Node HMAC verification and D1-adapter SQL/result-shape emulation. They exercise concurrent/replayed requests and checkout claims, lost order/refund responses, browser-free capture recovery, stale events, forged/mismatched evidence, per-payment refund ownership, disabled preview, Pi/RBAC denial, body limits, schema/default consistency and settings conflicts.

`src/__tests__/razorpay-d1-runtime.test.ts` additionally runs the application services with installed Drizzle and actual local Miniflare/workerd D1 bindings. It applies the two repository migrations to a disposable local database and tests 20-way races for order request ownership, checkout claims, refunds, duplicate capture events and draft CAS, plus lost-response/delayed-evidence recovery. Razorpay remains mocked. The fixture compatibility date matches the current committed Worker configuration; it does not execute the complete OpenNext application inside workerd or verify remote replica/edge behaviour. Run `npx vitest run src/__tests__/razorpay-d1-runtime.test.ts` with permission to open loopback sockets; restricted sandboxes may fail with `listen EPERM`, which is not a passed/skipped release check. No remote deployment or merchant operation occurs.

Local D1 binding tests and statement emulation are not deployed Cloudflare concurrency certification. Browser/real Razorpay sandbox, atomic native holds across all writers, guest recovery/authentication, operational/excess refunds, notification delivery, staff payment permissions and settlement accounting must pass their own end-to-end/release checks before live payments are enabled. The public readiness flag remains `false`.
