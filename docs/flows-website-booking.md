# Website booking: implemented foundation

Implementation status: **partial; native reservations and Razorpay payments are not implemented or launch-ready.** The full target and recovery workflows remain in [the reviewed plan](plan-first-party-booking-and-payments.md). Do not treat the specification's 66 mock scenarios as production checkout tests.

The [deep review](review-website-booking-2026-09-17.md) records the initial six findings and their subsequent fixes. The expanded adversarial regression script now exercises 19 groups, including repeated captures, per-payment caps, odd paise, and refund/hold transitions. Passing model tests still do not certify the unimplemented native payment flow.

## Destination workflow

1. An administrator opens Management → Channel Manager → Configuration.
2. Set Booking Engine URL to `/book` or `https://www.gokohostel.com/book` for Goko. The **Use Goko booking** button fills the field; it does not save.
3. For Aiosell, StayFlexi, or another provider, enter the complete public HTTPS **guest** engine link, including the hotel query where required. The API Base URL is not a booking engine link. The backend rejects that exact configured API endpoint as a destination.
4. Save Configuration. Existing valid external URLs are retained; blank records are never backfilled with StayFlexi.
5. Website Book Now buttons retain the eligibility/terms gate. Opening the gate fetches `/api/booking/config` without caching. Missing or unavailable configuration labels the action **Booking enquiry**, with retry for a client network failure. Guest routing is independent of Enable Channel Manager and inventory auto-push switches.
6. Continuing navigates in the same tab to `/api/booking/destination`. That route rereads the saved link and returns a non-cacheable 303. This avoids async popup blocking and stale cached provider destinations. Native and enquiry relative paths resolve against the canonical Goko origin, never a request Host header.
7. Empty, invalid historical configuration, or a database failure goes to `/booking-enquiry`. It cannot restore the old hard-coded StayFlexi link. A separately configured external engine handles its own booking/payment flow.

Unsafe schemes, protocol-relative URLs, credentials embedded in links, malformed/control-character links, empty authorities, trailing-dot hostnames, local/IP destinations (including `.localhost`), and Goko same-origin paths other than exact `/book` are rejected with 400 before saving. API base comparisons account for trailing dots in the integration configuration. Native URLs must be the canonical `www` origin; noncanonical apex/ports/query/fragment variants are rejected with a corrective message. External HTTPS provider URLs are administrator-selected, not an open redirect from a public query parameter.

Public configuration returns only destination/mode, `configurationAvailable`, and `nativeCheckoutReady: false`, never Channel Manager credentials. Database failures or invalid historical links return 503 from the configuration API so the gate offers Retry plus enquiry/WhatsApp; the destination redirect still safely routes to enquiry. No bookings, provider orders, payment attempts, inventory holds, refunds, or bank receipts are changed by switching links.

## Booking Settings location and ownership

Management → **Booking Settings**, immediately after Channel Manager on desktop and in the mobile dropdown. Administrator role only, enforced server-side as well as in the UI. Hidden on Pi; API returns 403 there. No manager/staff permission alias grants access.

Sections:

- **Booking & Policies:** draft advance/full-payment/pay-at-property preferences, bounded hold/review windows, cancellation deadline/refund percentage and policy text. Values are validated by a shared strict Zod schema. Defaults are 50% advance, 15-minute hold, 30-minute maximum review window, 48-hour deadline, and 100% eligible refund. These values are drafts only and do not create guest-facing refund promises.
- **Rooms & Rates:** links to existing Inventory, Website CMS and Channel Manager; no second rate catalogue. Native guest-category publishing/mapping remains pending.
- **Payments & Readiness:** test/live selection and deployment-secret setup guidance. The configuration check reports presence and matching key-ID environment only; it does **not** authenticate with Razorpay, verify webhooks, or make a payment. Checkout remains disabled even when all credentials are present.

Drafts live in the existing `settings` row `website_booking_settings_v1`. No schema migration is needed for this foundation. It is deliberately absent from `SYNCABLE_SETTINGS`; Pi cannot replicate or overwrite it. Secrets are not accepted by the schema or stored in D1. Secret names are `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, `RAZORPAY_TEST_WEBHOOK_SECRET` and the corresponding `RAZORPAY_LIVE_*` names. Metadata shows only the public key ID and booleans for secret presence. Do not register the planned `/api/webhooks/razorpay` path until the actual webhook implementation exists.

## Follow-up safeguards

Only an absent booking-settings row receives defaults. Invalid JSON, invalid types/ranges, or unsupported stored fields return sanitized 409 `BOOKING_SETTINGS_INVALID` for load/save/readiness. The stored row is preserved, the UI blocks editing and offers load retry, and no defaults/readiness are activated. An invalid persisted draft requires reviewed maintenance repair; there is deliberately no automatic reset. Valid partial updates merge with existing preferences rather than resetting unrelated policies/environment. Concurrent administrators should coordinate draft edits: optimistic version locking is not implemented yet and must be addressed before shared published financial-policy workflows.

Public routing uses `getGuestBookingConfig`, selecting only `booking_engine_url` and `api_base_url`. Integration passwords/webhook secrets are neither selected nor returned. Credential metadata rejects empty/malformed public key IDs and whitespace-only secrets, but remains a presence check, not proof of provider authentication. Saving a draft refreshes the UI's environment metadata; native checkout remains disabled.

The specification model now reserves each refund against a captured payment, allocates incremental excess/operational/cancellation targets without exceeding per-payment caps, rechecks capacity on failed retry, preserves processed results, calculates refund targets from integer captured paise, and treats an operationally unfulfillable booking as terminal. Unknown hold deadlines use creation time; unresolved/review payments cannot be collected again at the desk in the model. These are model invariants only, not implemented gateway/database workflows.

## Native page today

`/book` is a safe, branded entry page describing the current limitations and linking directly to enquiry/WhatsApp and existing dorm information. It does not display invented availability or prices, request a card/payment, or claim to confirm a booking. Booking Enquiry also no longer promises instant confirmation from an unconfigured provider.

## Remaining implementation gates

- Shared nightly pricing, sellable-unit mapping and atomic multi-unit/night hold guards across native, admin, blocks and OTA writers.
- Provisional website bookings in the existing PMS, token-protected confirmation/recovery and cancellation routes.
- Razorpay order creation, verified captures, durable raw webhook inbox, idempotent reconciliation, expiry and late-capture handling.
- Refund ledger, excess/operational refunds, settlement-vs-capture accounting, notification delivery, Pi ownership rules and staff payment permissions/UI.
- Gateway health check, reviewed/published policy, actual availability/checkout UI and outage pay-at-property workflow.
- Real SQLite/D1 lifecycle tests, payment-provider sandbox/end-to-end tests and release checks from the plan. The foundation tests cover routing/configuration only.

No live configuration, deployment, migration, or real payment has been performed for this foundation.

## Validation (17 September 2026)

- `npx vitest run`: 91 test files, 1,406 tests passed, including 67 focused foundation checks. The focused tests exercise real routing/validation/action-handler code with mocked database/authentication, not D1 payment/inventory integration.
- `npx tsc --noEmit`, `git diff --check`, and `git diff --cached --check`: passed.
- `npm run build`: passed. Existing unrelated hook-dependency and image-optimization lint warnings remain; no new warnings in the foundation files.
- Local production browser smoke check: `/book` rendered; mobile Book opened the eligibility gate; unavailable configuration showed Booking Enquiry and remained disabled before agreement. No actual reservation, terms acceptance, provider payment, or admin configuration save occurred during this check. The temporary preview was stopped afterward.
