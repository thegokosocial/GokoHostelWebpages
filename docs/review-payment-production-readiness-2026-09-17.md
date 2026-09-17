# Payment production-readiness review — 17 September 2026

## Decision: NO-GO for live guest payments

The implemented scope is booking destination/configuration, enquiry fallback and an isolated admin-only Razorpay test preview. It is not the full native booking/payment implementation. `/book` has no live room/date checkout, and `nativeCheckoutReady` remains false. Do not enable live payments based on these local results.

The review traced guest destination validation and fallback, settings revision/CAS, API role/runtime gates, provider validation, order creation/recovery, checkout claims, capture recording, refunds, webhook recovery, migration/schema consistency and sync exclusion. No deployment, live migration, real merchant API operation or money movement was performed. Unrelated repository changes were preserved; no commit or push was made during this review.

## Finding fixed

A signed capture/paid webhook could previously be marked processed while the provider API still returned authorization or an empty order-payment collection. This could suppress recovery when capture became visible later. Capture/paid events now remain retryable (HTTP 503) until verified capture exists for the exact payment/order. Two new route/service scenarios verify eventual recovery, including after new preview operations are disabled. Stale failure events still cannot erase verified capture.

## Mock workflow evidence

| Scenario | Result and evidence boundary |
| --- | --- |
| Missing, invalid or unavailable booking destination | Enquiry fallback; no resurrection of old external provider; source tests |
| Concurrent settings saves | Single-statement CAS rejects stale/missing revision; disposable SQLite tests |
| Concurrent/replayed order requests | One durable request owner performs one POST; mocked provider and actual SQLite |
| Order created remotely, response lost | Receipt/note/amount verification recovers original order; no second POST |
| Concurrent checkout opens / lost claim response | One claim; cannot reopen based on an empty API lookup |
| Browser offline after capture | Server reconciliation/webhook records authoritative capture, no PMS/bank side effects |
| Signed capture event before API capture visibility | Retryable until exact capture visible; empty/authorized evidence is insufficient |
| Forged signature, mismatched IDs/amount/currency | Rejected without inventing payment evidence |
| Duplicate/out-of-order events | Exact-byte authentication, digest replay checks and monotonic capture/refund evidence |
| Concurrent refund / lost refund response | One full test refund reservation/POST; unresolved results cannot trigger a second refund |
| Pending, failed, processed refunds | Explicit states; processed terminal; no automatic resubmission |
| Gateway outage, credential rotation, disabled preview | Unknown results retained; original credentials required; recovery remains available |
| Staff/manager/Pi access | Denied on every exposed test action; no provider/ledger side effects |
| SQL/schema/sync behavior | Exact migration in memory, constraints and Drizzle D1-result-shape emulation; no financial sync to Pi |

The 66 booking-plan simulations and 19 adversarial groups are specification-model checks, not evidence that native booking, settlement or production refunds are implemented. D1 adapter emulation is not actual Cloudflare concurrency testing. No browser end-to-end or real Razorpay sandbox certification is claimed.

## Required before live release

### Additional regression hardening

Further code-backed scenarios exposed refund-event acknowledgement without exact refund verification and stale refund collections masking a directly verified completion. Both are fixed: migration 0058 retains the exact refund ID; the adapter fetches the exact refund, validates ownership/amount/currency and keeps not-yet-visible outcomes retryable. Matching local reservations preserve processed state. Legacy missing IDs can be restored only by matching signed redelivery, otherwise manual review remains required. New tests cover external refunds, result mismatch, delayed visibility, concurrent duplicate delivery, retained unknown-refund/event recovery after SQLite ledger reopen, and full-page order-lookup ambiguity. This remains mocked provider/disposable SQLite evidence, not real D1 or merchant sandbox certification.

Validation after these 13 additional regression cases: 94 files / 1,530 tests pass, including 179 focused booking/payment tests. TypeScript, production build and diff checks pass; 66 specification simulations and 19 adversarial groups pass. Existing unrelated build hook/image warnings and the legacy ESLint configuration deprecation remain. No live release approval is implied.

### Outstanding delivery gates

Further production preparation added six local Miniflare/workerd D1 tests: application services use actual local D1 bindings, not hand-emulated statement results. Twenty concurrent callers verify one order/refund POST owner, one checkout claim, capture-event deduplication and one settings CAS owner; lost response and delayed evidence recovery also pass. Seven setup regressions additionally verify missing tables/columns/current webhook secret or shared test/live secrets cannot start a new order. The code now preflights all four gateway tables/columns and validates current webhook configuration before new operations. Full regression: **95 files / 1,543 tests passed**, including **192 focused booking/payment tests**. TypeScript and lint pass. The initial restricted runtime attempt failed with loopback `EPERM`; the unrestricted local rerun and full suite passed. This is local database/runtime evidence, with mocked Razorpay and Node-hosted service execution—not remote D1, browser or real merchant verification.

1. Implement guest room/date selection, authoritative server quotes, immutable price/tax/policy snapshots and expiring inventory holds. Coordinate **all** booking writers (website, walk-in/admin, Aiosell) against the same capacity; test last-bed races.
2. Implement guest-bound payment attempts and secure status recovery. Verify capture server-side and fulfil a booking once, with durable idempotency across retries/crashes. Keep pending/authorized/captured/fulfilled/settled distinct.
3. Implement operational, excess and cancellation refund allocation with per-payment caps and reserved unknown outcomes. Test capture after hold expiry and duplicate distinct captures; never silently charge again after a timeout.
4. Implement automated reconciliation, durable Aiosell/notification delivery and operator alerts. Test API/webhook/D1 outages, restart recovery and exhausted provider retries. One-time admin test controls are not the guest recovery workflow.
5. Implement bank settlement accounting separately from capture, including fees, taxes, net credits, reversals and unmatched settlement review. A captured payment is not a bank receipt.
6. Implement required live/staff payment permissions, audit and operational review controls; maintain API enforcement and synchronized handbook/tests.
7. Validate an isolated Cloudflare staging environment with real D1 concurrency and Razorpay **Test mode**. Exercise real browser reload/network loss, callbacks, signed webhooks, refunds and secret rotation. Use no live credentials or real charges for this stage.
8. Review live account capture configuration, webhook separation, monitoring, rollout/rollback and refund/settlement runbooks. Require explicit evidence-backed release approval before enabling guest payments.

See [Razorpay integration and local validation](integrations-razorpay.md) and the [full booking plan](plan-first-party-booking-and-payments.md). Passing the local checks only qualifies the implemented test scope for further staging verification.
# Native implementation milestone — 17 September 2026

Next dependency implemented: [durable owner-bound accepted quotes](native-accepted-quotes.md), backed by migration 0060 and protected against concurrent repricing, post-expiry/release acceptance, mutation/deletion and corrupt computed evidence on recovery. Committed SQL insert/response-loss recovery is tested. Final local validation: **98 files / 1,624 tests passed**, with 18 accepted-quote and 10 actual local D1/workerd cases; TypeScript, source lint, production build and diff checks pass. This is internal contract persistence, not guest checkout or atomic PMS fulfilment. The full feature request remains incomplete and all outstanding release gates remain explicit.

Next milestone: added [internal quote and cancellation-refund calculators](native-booking-quotes-and-refunds.md), with 20 new code-backed tests and exhaustive advance/refund-bound loops. Quote input requires exact per-unit/night server rates and accepted policy/version; refund amounts subtract processed and pending/unknown claims from original capture. No provider request, inventory/account write, accepted-contract persistence or guest API was added. The first build caught BigInt-literal incompatibility with the repository's ES2017 TypeScript target; constructors replaced literals without changing the project-wide target. The final validation results are recorded in the quote workflow document. Launch blockers remain unchanged.

Follow-up: implemented internal hold-aware advisory selection, read-only owner recovery, schema/expected-table trigger preflight and orphaned-Double refusal. New evidence covers committed insert/lost response, disabled/released/expired recovery, missing guards, wrong-table guards and picker/schema errors. Full regression: **96 files / 1,585 tests passed**, including **234 focused booking/payment tests** (87 gateway, 9 local D1, 39 native, 74 routing/configuration, 25 persistence/CAS). Build and source lint pass; TypeScript is checked after build. No public guest endpoint, real charge, production migration, deployment, commit or push was performed. The remaining launch blockers below are unchanged; the selector is advisory and not shared PMS/quota accounting.

Started the [internal physical hold primitive](native-inventory-hold-foundation.md): immutable owner-bound retries, maximum 15-minute leases, all-or-nothing multi-unit selection and same-database assignment/block SQL guards. No public route, guest checkout, booking fulfilment or money/account mutation is connected. Creation remains default-disabled; Pi is rejected. Aggregate quotas/unassigned OTA writers, shared availability/Aiosell accounting, Pi coordination, atomic fulfilment, production refunds/recovery/settlements and real merchant/browser/deployed-D1 verification remain launch blockers.

Validation: 96 Vitest files / 1,566 tests passed, including 22 new native hold tests and 7 local D1/workerd tests. Twenty-way last-unit and duplicate-request races, double-room completeness, partial-allocation rollback, owner-only release, expired/released retry and assignment/block exclusion pass. D1 preflight availability and Razorpay are mocked; database constraints execute against actual local D1. Production build and source lint passed. An overlapping TypeScript/build run encountered generated-file churn; TypeScript was rerun after the build. These are local implementation checks, not production certification.
# Guest browsing follow-up — payments still disabled

Homepage and `/book` now have visible date/party search, advisory online availability, eligible configured nightly rates, quantity/rate-plan selection, estimated PMS-tax totals and a stay-review screen. My booking implements short-lived email verification for read-only existing PMS details; activation needs migration 0061, a private lookup secret, verified email delivery and edge abuse limits. A gated local-only sample preview supports UI review. These additions do not fulfil native reservations or send confirmed-booking emails: transactional fulfilment/outbox, quota/Pi coordination and the payment/refund/settlement release gates below remain unchanged. See [current guest UI workflows](guest-booking-ui.md).
