# Native booking quote and cancellation calculations

## Implemented scope

`src/lib/nativeBookingQuote.ts` implements internal server calculators, not public checkout or production refund submission. [Accepted-quote persistence](native-accepted-quotes.md) is now a separate internal owner-bound service; it is not yet a provisional PMS booking. Neither calculator reads credentials, calls Razorpay, changes inventory/bookings/accounts or enables payments. Both return `nativeCheckoutReady: false`.

## Quote workflow

1. A trusted server caller supplies server-selected unit keys, exactly one whole-rupee rate per unit per occupied night, civil arrival/departure dates, tax basis points (100 basis points = 1%), a published policy version and the accepted policy snapshot. Never bind guest-submitted rates, tax, policy, physical allocations or amounts directly to this function. Authoritative rate-plan loading and policy publishing are still outstanding.
2. Validate real dates, 1–30 nights, 1–4 unit entries, distinct unit keys, exact night coverage, integer nonnegative rates and bounded policy/tax inputs. A Double room must be represented once as a sellable unit, not once per physical guest slot; capacity/availability validation belongs to the upstream selector. Missing, repeated or extraneous nights fail closed.
3. Sum actual nightly rates across every selected unit. Match the reviewed plan/PMS whole-rupee convention: round tax half-up once on the subtotal; round the percentage advance upwards to a whole rupee. Integer arithmetic uses BigInt internally; outputs must fit JavaScript safe integers, including conversion to paise. Negative, fractional, non-finite, zero-total and overflowing results are rejected.
4. Full/property choices require the accepted policy to offer them. An advance choice with zero advance is rejected; use the explicitly offered property-payment choice instead. `dueNowPaise + dueAtPropertyPaise = totalPaise` for every accepted quote. No browser amount is trusted.
5. Return canonical unit/night ordering, copied policy/rates, accepted version, currency INR, subtotal/tax/total in whole rupees and payable/balance in exact paise. Changing the caller's settings/rates afterwards cannot alter this result. Use the [accepted-quote service](native-accepted-quotes.md) to persist/protect it against the owner's hold. A future provisional-booking/payment workflow must reference that original evidence before opening Checkout; recovery after release/expiry is not a fresh reservation. Persisted contracts must not be repriced from current settings.

No automatic discounts or tax-law defaults are inferred. Correct legal tax/rate-plan configuration remains a property responsibility; the calculator requires explicit tax basis points.

## Cancellation/refund amount workflow

1. Use the accepted cancellation policy snapshot and arrival date, not the current draft settings. Supply verified captured paise, processed refunds, and the sum of **pending plus unknown** durable refund claims. Guest assertions, bank screenshots and Checkout callbacks are not verified capture evidence.
2. Only provisional/received lifecycle calculations are accepted. Checked-in/completed stays require the existing authorized staff workflow.
3. Calculate the deadline from 12:00 IST on arrival minus accepted deadline hours. The exact deadline is eligible; one millisecond afterwards is not. A timely guest cancellation targets the configured percentage of original captured funds, rounded down to paise. Operational inability to fulfil targets all captured funds regardless of the guest deadline.
4. Subtract both processed and reserved claims from the target and cap the result at unclaimed verified capture. Do not apply the percentage repeatedly to the remaining balance. Claims exceeding capture fail closed for manual review.
5. Return eligibility, deadline, unclaimed funds and additional eligible refund paise. This does **not** reserve funds atomically, issue a refund, mark a refund processed or record a settlement. Concurrent requests must use an atomic durable refund claim before any provider POST. Unknown provider outcomes must retain that claim until reconciliation establishes the original result; only exact API-verified processed refunds affect final accounting.

## Verification and remaining gates

Final local regression on 17 September 2026: **97 files / 1,605 Vitest tests passed**, including the 20 new calculation cases, 39 native hold cases, 9 local D1/workerd cases and the existing gateway/configuration tests. Production build passed after fixing ES2017 BigInt-literal compatibility; source lint, diff checks and a separate post-build TypeScript check passed. Existing unrelated hook-dependency/image-optimization build warnings remain. No real gateway request, deployment, remote migration, commit or push occurred.

Twenty code-backed Vitest cases cover variable nightly rates, copied snapshots, missing/duplicate nights and units, invalid amounts/dates, disabled payment choices, overflow, deadline boundaries, reserved/processed claims, operational full refunds and staff-only lifecycles. Loops check money conservation across 10,100 advance combinations and refund bounds across 1,818 percentage/claim combinations. These are calculator tests, not merchant, browser or payment-fulfilment certification.

Still missing: published policy/rate-plan loading, accepted-quote linkage into provisional booking/payment fulfilment, category/online quotas and Pi ownership, provisional-booking/hold transfer, guest APIs/UI, capture evidence to fulfilment/accounting, production refund claim/submission/recovery, automated recovery, settlement receipt integration and real merchant/browser/deployed-D1 tests. Live checkout remains disabled. See [production release report](review-payment-production-readiness-2026-09-17.md).
