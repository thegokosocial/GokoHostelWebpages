# Website booking: implemented foundation

Implementation status: **native guest checkout supports Razorpay test and live** behind `GOKO_NATIVE_GUEST_CHECKOUT_ENABLED` + readiness (`nativeCheckoutReadiness.ts`, migrations **0059–0062**). Flip Test ↔ Live in Management → Booking Settings → Payments & Readiness (`gatewayEnvironment`). Live needs `RAZORPAY_LIVE_*` Worker secrets including webhook. Admin ₹1 preview ledger stays separate (`gateway_preview_*`, test-only).

The [deep review](review-website-booking-2026-09-17.md) records the initial six findings and their subsequent fixes. The expanded adversarial regression script exercises 19 model groups. Native guest checkout (test mode) is now implemented in code; production D1/env deploy and browser matrix remain release steps.

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
- **Payments & Readiness:** Test/Live selection (`gatewayEnvironment`), deployment-secret guidance, and dynamic readiness blockers from `evaluateNativeCheckoutReadiness`. Public `/book` checkout uses the selected mode’s Razorpay credentials when ready. **Website payments** lists recent native checkout attempts (`listWebsiteAttempts`) with Passed / Failed / Unknown / Orphan / In progress / Pay at property (stale `claimed`/`ready` rows whose booking is already cancelled show Failed, or Orphan if money was captured). Admin ₹1 preview panel remains available in test mode after `RAZORPAY_TEST_PREVIEW_ENABLED`.
- **Email Templates:** subject+body for confirmation / updated / cancelled (`booking_email_templates`). **Confirmation** is used by `sendBookingConfirmationEmail` on website booking create (placeholders like `{GUEST_NAME}`, `{BOOKING_ID}`). Updated and Cancelled are editable but not sent yet.
- **Text Templates:** SMS body drafts for the same three kinds (`booking_sms_templates`). Saved for later — **no SMS provider / send path** yet.

Drafts live in the existing `settings` row `website_booking_settings_v1`. Email/SMS templates use separate settings keys (no migration). No schema migration is needed for draft settings; the test payment ledger separately requires repository migrations `0057_razorpay_test_preview.sql` and `0058_razorpay_webhook_refund_id.sql` (not applied live here). Settings and test evidence are excluded from sync. Secrets are not accepted/stored in D1. Secret names are `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, `RAZORPAY_TEST_WEBHOOK_SECRET` and corresponding `RAZORPAY_LIVE_*` names; metadata shows only public key/presence. The implemented `/api/webhooks/razorpay` path is **Test-mode-only** and must not be registered as a live processor. Exact capture/refund evidence must be visible before capture/processed-event acknowledgement; retained events are recoverable after new tests are disabled. See test setup/recovery guidance before any deployment.

## Follow-up safeguards

Only an absent booking-settings row receives defaults. Invalid JSON/types/ranges/unsupported fields return sanitized 409 `BOOKING_SETTINGS_INVALID`, preserve the row and require reviewed repair; there is no automatic reset. Valid partial edits preserve other preferences. `getSettings` now returns an edit revision, required for `saveSettings`; stale/missing revisions or intervening writes return 409 `BOOKING_SETTINGS_CONFLICT`. A single-statement compare-and-set protects concurrent administrators. The UI blocks further saving and offers reload; older save clients must adopt the revision contract. Published financial policies/snapshots remain pending.

Public routing uses `getGuestBookingConfig`, selecting only `booking_engine_url` and `api_base_url`. Integration passwords/webhook secrets are neither selected nor returned. Credential metadata rejects empty/malformed public key IDs and whitespace-only secrets, but remains a presence check, not proof of provider authentication. Saving a draft refreshes the UI's environment metadata; native checkout remains disabled.

The specification model now reserves each refund against a captured payment, allocates incremental excess/operational/cancellation targets without exceeding per-payment caps, rechecks capacity on failed retry, preserves processed results, calculates refund targets from integer captured paise, and treats an operationally unfulfillable booking as terminal. Unknown hold deadlines use creation time; unresolved/review payments cannot be collected again at the desk in the model. These are model invariants only, not implemented gateway/database workflows.

## Native page today

When readiness passes: Search → select → Review → payment choice → prepare checkout (hold + quote + provisional booking with minted `goko_booking_id`) → Razorpay or pay-at-property fulfil → `/booking/[reference]` + confirmation email (best-effort, deferred via `waitUntil`). Razorpay orders use receipt `gbk_*` and notes `{ goko_checkout_id, goko_booking_id }` (webhooks still route on checkout UUID). After order attach (and on `order_unknown`), `websiteCheckout` is snapshotted onto the booking so Admin shows Order ID before pay. Bookings dashboard / table search matches `goko_booking_id`. Fulfilment **releases** the hold then assigns held beds online first, then offline / same-dorm alternatives (`getAvailableBedsForRange` omits beds under other active native holds; `NATIVE_HOLD_CONFLICT` soft-fails so alts can run); only when all fail after capture → `captured_unfulfilled` (history `website_unfulfilled` with error hint, Unassigned for staff). `claimGuestCheckout` renews an **unexpired** hold lease (migration **0065**, still ≤900s); recovery-by-requestKey never renews; expired-before-claim leases are not extended. Active native holds lower Aiosell online availability for the hold window; `createNativeInventoryHold` (new insert), `releaseNativeInventoryHold`, and `cancelAbandonedWebsiteHolds` call `pushIfOtaChanged` (deferred after D1 commit where possible). Hold lease uses Admin `holdMinutes` (5–15, capped at 900s). Unpaid expired website holds are cancelled opportunistically on search/prepare. **Payment outcomes:** `payment.failed` / unpaid dismiss → `abandonUnpaidGuestCheckout` (release; fulfils only if Razorpay already captured — tab-close mid-pay keeps that path). Verify timeout / unclear capture → abandon with `uncertain: true` (always cancel+release; **never fulfil**; if captured, stamp `amountPaid` + history `website_orphan_capture` + `websiteCheckout` snapshot on cancelled booking for admin Razorpay refund). Success uses `disarmCheckoutLeaveGuard` + `location.replace` (no Leave-site flash); redirect only when checkout `fulfilled` / booking `received` (never on cancelled recover + bare `reference`). Fulfil/orphan merge `websiteCheckout` into `bookings.rawData` (Order/Payment IDs, env, amounts) for Booking detail **Website / Razorpay**. Admin `refundWebsiteOrphan` (`canDeleteBooking`) refunds capture via Razorpay on cancelled website bookings. Review UI: hold expired → **Recheck availability**; payment blocked → **Recheck payment readiness**. When readiness fails: payment disabled, WhatsApp enquiry available. Preview still blocks checkout writes.

Confirmation / manage at `/booking/[reference]` uses `GuestBookingManage` with enriched `publicSnapshot` (rooms, nights, tax, paid, due, `canCancel`, deadline). Guest stay changes use **Copy booking details** + in-card **WhatsApp** (site-wide float hidden on this route; public `canModify` is always false; `POST /api/guest-booking/amend` returns 403). Cancel remains a full button when `canCancel`. Staff edit website bookings via Admin **Edit Booking** (`source` manual or website): dates, persons, and beds can be saved together; stay-shape changes recalculate `amountBeforeTax` / `amountTax` / `amountTotal` (implying `nightlyRate` from the prior **before-tax** amount when it was 0) and leave online `amountPaid` unchanged so remaining due = total − paid (**Collect remaining** / guest **Due at property**). Guest confirmation surfaces `stayUpdatedAt` as an **Updated** badge when history has a stay-shape edit (dates/persons/beds/rate/total), and prefers live booking payment fields over the accepted quote. Hard **Delete booking** is allowed for **unpaid** website stays with `canDeleteBooking` (paid website bookings must cancel/refund first; same cascade as Records walk-in delete; finance history still blocks). My booking OTP: Admin **Booking & Policies → Require email OTP for My booking lookup** (`requireLookupOtp`, default **on**). When on, OTP verify for a website booking mints a fresh `guestAccessToken`. When off, reference + email alone returns the booking (and mint token if a checkout row exists).

### Guest self-serve amend (retired)

Migration **0063** columns and internal `prepareGuestAmend` / `fulfilGuestAmend` helpers remain for compatibility. The guest UI and public amend route no longer offer self-serve date/room changes — use WhatsApp (guest) or Admin Edit Booking (staff).
## Remaining implementation gates

Native guest checkout (test + live cutover) is wired: migrations **0059–0062**, public APIs, `/book` UI, webhook branch, confirmation email, Booking Settings Test↔Live flip. Production Worker secrets include Razorpay test/live credentials, `RAZORPAY_LIVE_WEBHOOK_SECRET`, and `GUEST_BOOKING_LOOKUP_SECRET`.

**Ops still required for live money (human):**
1. Register the Live webhook URL in the Razorpay **Live** dashboard (`/api/webhooks/razorpay`) with the live webhook secret and payment/refund events.
2. After a successful **Test** browser matrix, flip Booking Settings → Live → Save.
3. One small real live charge + cancel/refund check.

**Product gaps (not blocking test-mode launch):**
- Category/pool quotas beyond physical holds; Pi writer coordination.
- Staff payment RBAC UI (`canViewBookingPayments`) and bank settlement accounting.
- Dedicated hold-expiry cron (lazy expiry via read-time guards already works).
- Durable confirmation-email outbox with retries (fulfil path is best-effort today).

D1 **0059–0063** and `GOKO_NATIVE_*` env flags — apply **0063** with the Worker for guest amend. **0059–0062** already on production.

## Foundation validation (historical first phase, 17 September 2026)

- `npx vitest run`: 91 test files, 1,406 tests passed, including 67 focused foundation checks. The focused tests exercise real routing/validation/action-handler code with mocked database/authentication, not D1 payment/inventory integration.
- `npx tsc --noEmit`, `git diff --check`, and `git diff --cached --check`: passed.
- `npm run build`: passed. Existing unrelated hook-dependency and image-optimization lint warnings remain; no new warnings in the foundation files.
- Local production browser smoke check: `/book` rendered; mobile Book opened the eligibility gate; unavailable configuration showed Booking Enquiry and remained disabled before agreement. No actual reservation, terms acceptance, provider payment, or admin configuration save occurred during this check. The temporary preview was stopped afterward.
