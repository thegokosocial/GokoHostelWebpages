# Goko First-Party Booking, Payment, and Aiosell Plan

## 1. Objective

Build a native Goko booking experience at `/book` to replace the current StayFlexi redirect.

Guests will be able to:

- Choose check-in and check-out dates.
- Enter guest count.
- Select room types and quantities.
- Review live availability and a server-generated price quote.
- Pay the full amount, a configured advance percentage, or ₹0 at property.
- Receive a Goko booking reference and confirmation.

The booking must use the same operational model as admin-created offline and walk-in bookings:

- Same `bookings` table.
- Same pricing and tax calculation.
- Same inventory and bed assignment rules.
- Same admin Booking Dashboard.
- Same payment collection and reconciliation logic.
- Same Aiosell availability push.
- Same cancellation, audit, and notification workflows.

The public website must not call an admin-authenticated route directly. The admin API and public API should call the same server-side booking services.

## 2. Core architecture

```text
Admin UI ───────────────┐
                        ├── Shared booking services ── D1 database
Website /book ──────────┘             │
                                      ├── Room quote and inventory
                                      ├── Booking holds
                                      ├── Razorpay payment attempts
                                      ├── Bed assignment
                                      ├── Audit/history
                                      └── Existing Aiosell inventory push

Razorpay Checkout ── payment callback ──┐
Razorpay Webhook ────────────────────────┼── Payment reconciliation service
Admin retry/reconcile ───────────────────┘
```

### Source and platform values

Website bookings should be stored as:

```text
source:   website
platform: booking_engine
```

Recommended statuses:

```text
hold
received
checked_in
checked_out
cancelled
```

Do not add `payment_review` to the booking status field unless the existing dashboard status type and every status transition are updated together. Payment exceptions belong in the payment-attempt record and the existing booking `paymentStatus` field. The booking can remain in `hold` or `received` while its payment is marked `unknown`, `review`, or `captured_unfulfilled`.

Use the existing booking/payment semantics for compatibility with `src/lib/stayPayment.ts`:

```text
full online payment:    paymentStatus = paid,            paymentMethod = online
partial online payment: paymentStatus = partial,         paymentMethod = online
pay at property:        paymentStatus = pay_at_property, paymentMethod = ""
payment under review:   paymentStatus = payment_review,  paymentMethod = ""
```

When the guest later pays the balance, the existing admin collection workflow changes the payment method to `cash`, `online`, or `split` and updates the booking summary.

## 3. Guest-facing page

### Step 0: Existing eligibility gate

Keep the current “Before You Book” gate before `/book`.

It continues to show and collect acknowledgement of:

- Age restrictions.
- Solo/small-group restrictions.
- No children policy.
- Dorm allocation limitations.
- Check-in and check-out times.
- House rules.
- Terms and cancellation policy.

The current `BookingGateProvider` should navigate to `/book` instead of opening `site.bookingUrl`.

### Step 1: Search

The guest submits:

- Check-in date.
- Check-out date.
- Number of guests.

The server validates:

- Dates are valid calendar dates.
- Checkout is after check-in.
- Stay length meets the applicable minimum.
- Dates are inside the configured booking window.
- Dates are not stopped or closed for arrival/departure.
- Guest count is within the property limit.

The response includes room categories, quantities, nightly rates, restrictions, taxes, and availability.

### Step 2: Room selection

Display the existing Goko room categories as Booking.com-style cards:

- 12-bed mixed dorm.
- 6-bed female dorm.
- 8-bed luxury mixed dorm.

Each card shows:

- Existing gallery images.
- Description and amenities.
- Capacity.
- Available quantity.
- Price per night.
- Total price for the selected stay.
- Quantity selector.

Guests select room categories and quantities, not physical bed numbers. Physical bed assignment remains an internal operation.

The selection supports multiple room categories in one booking where inventory and capacity allow it.

### Step 3: Guest details

Collect:

- Full name.
- Email.
- Phone number.
- Nationality.
- Expected arrival time.
- Special requests.

Do not collect or expose internal bed IDs. ID documents remain part of the existing self-check-in workflow unless a separate product decision adds document collection during booking.

### Step 4: Quote and payment choice

Show:

- Room subtotal.
- Number of nights.
- Tax.
- Gross total.
- Required advance.
- Balance due at property.
- Cancellation/refund policy.
- Payment status that will be recorded.

Supported choices:

1. Full payment.
2. Configured partial advance, such as 50%.
3. Pay at property with ₹0 advance when enabled.

If Razorpay is unavailable, pay-at-property must be offered as a fallback when enabled.

### Step 5: Confirmation

The confirmation page shows:

- Goko booking reference.
- Guest name.
- Dates and number of nights.
- Room categories and quantities.
- Total amount.
- Amount paid.
- Balance due.
- Payment status.
- Cancellation deadline.
- Check-in/check-out times.
- WhatsApp and email contact options.

The confirmation page must be safe to refresh and reopen. It must not create another booking.

## 4. Shared server-side services

Refactor business logic currently embedded in `src/app/api/admin/bookings/route.ts` into shared server-side functions.

The public and admin wrappers should reuse these services:

```ts
getBookingAvailability(input)
createBookingQuote(input)
createBookingHold(input)
createBookingFromHold(input)
assignWebsiteBookingInventory(input)
confirmBookingPayment(input)
recordPayAtPropertyBooking(input)
cancelBookingWithRefundPolicy(input)
reconcileBookingPayment(input)
```

The admin route remains authenticated. Public routes add public-input validation, rate limiting, reference access controls, and idempotency checks.

The existing admin actions remain the operational contract: `createBooking`, `assignBeds`, `collectStayPayment`, `checkIn`, `checkOut`, and `cancelBooking`. The refactor moves their business logic into shared services; it does not create a second booking implementation for the website.

## 5. Public API design

### Availability

```text
GET /api/booking/availability
```

Inputs:

- `checkinDate`
- `checkoutDate`
- `guests`

Returns:

- Room categories.
- Available quantities.
- Rate plans and nightly rates.
- Restrictions.
- Tax percentage.
- Quote version/hash.

Availability is informational until checkout. It must be rechecked before creating a hold.

### Checkout preparation

```text
POST /api/booking/checkout
```

The request includes the room selection, guest details, payment choice, and an idempotency key.

The server:

1. Validates the request.
2. Recalculates the quote.
3. Rechecks inventory.
4. Creates a provisional local booking with `status = hold` and no collected revenue.
5. Creates a short-lived room-category hold linked to that booking.
6. Creates a Razorpay order if advance payment is required, storing the provider order ID against the provisional booking/payment attempt.
7. Returns the booking reference, hold expiry, quote, and Razorpay checkout parameters.

The endpoint must return the same result when retried with the same idempotency key.

### Payment verification

```text
POST /api/booking/payment/verify
```

The browser sends:

- Local booking reference.
- Server-created Razorpay order ID.
- Razorpay payment ID.
- Razorpay signature.

The server must verify that the returned order ID belongs to the local booking and must calculate the signature using the order ID stored on the server, not blindly trust the browser value.

### Razorpay webhook

```text
POST /api/webhooks/razorpay
```

The endpoint validates the Razorpay webhook signature using the raw request body, identifies the local booking from the Razorpay order/receipt/notes, and processes the event idempotently.

### Confirmation

```text
GET /api/booking/[reference]
```

Only return confirmation-safe fields. Avoid exposing payment secrets, internal IDs, private guest data, or staff notes.

### Cancellation

```text
POST /api/booking/[reference]/cancel
```

The endpoint applies the configured cancellation deadline and refund policy. It must be safe to retry.

## 6. Inventory and Aiosell workflow

### Confirmed website booking

```text
Guest selects room type and quantity
        ↓
Local availability check
        ↓
Temporary hold
        ↓
Payment confirmation or pay-at-property selection
        ↓
Create local website booking and consume hold
        ↓
Select and assign available online beds/units in the same transaction
        ↓
Update local inventory
        ↓
Call existing Aiosell inventory push
        ↓
Booking appears in Admin Bookings
```

Website bookings should use:

```text
inventoryPool: online
```

The website must not create a separate Aiosell reservation that could duplicate the local booking. GokoWeb remains the direct-booking source of truth and pushes the changed availability using the same Aiosell push path used by admin-created bookings.

Temporary holds and confirmed bed assignments are different states. A hold prevents another GokoWeb checkout from taking the same room-category inventory, but it is not yet a confirmed booking and should not create revenue or an Aiosell reservation. Confirmed assignments use `inventoryPool: online` and follow the existing Aiosell push path.

The final hold-consumption operation must be retry-safe. If the provider confirms payment but the local transaction fails, retain the payment attempt and send it to reconciliation; never discard the payment because the browser request failed.

The provisional booking is created before Razorpay Checkout so every provider order has a durable local owner. A failed, abandoned, or expired provisional booking is cancelled/expired by cleanup after its hold and reconciliation windows, without creating revenue.

### Assignment failure

If the selected room type cannot be assigned after the final availability check:

- Do not confirm the booking.
- If payment was not captured, release the hold and do not mark payment as received.
- If payment was captured, keep the payment attempt as `captured_unfulfilled`, retain all provider IDs, and begin refund/escalation handling. Do not pretend the payment failed.
- Return a clear availability-changed message to the guest.
- Notify staff when a captured payment cannot be matched to inventory.

### Admin assignment

Staff can later move or reassign beds using the existing admin booking dashboard. Bed changes must use the existing inventory update and Aiosell push behavior.

### Aiosell push failure

The local booking and bed assignment must not be rolled back solely because the external Aiosell push times out or returns an error after the database commit.

1. Keep the local website booking confirmed.
2. Store the affected dorms/dates and the Aiosell push error in the existing sync-log/retry pattern.
3. Mark inventory synchronization as pending/failed for admin visibility.
4. Retry with the existing Aiosell inventory API using the latest local inventory, not a stale client payload.
5. Alert staff when retries are exhausted or when local and Aiosell availability remain mismatched.
6. Do not take a second payment or create a second booking during a push retry.

The same rule applies to cancellation: release local inventory first, then retry the Aiosell availability push until the external state catches up.

### Cloudflare and Pi synchronization

The public booking request runs against the Cloudflare D1 deployment. Website bookings, bed assignments, payment summaries, online receipts, and the payment-attempt records required by the admin UI must be included in the existing Cloudflare/Pi synchronization allowlist and ID remapping rules.

Provider webhook processing remains Cloudflare-side because Razorpay must reach the public deployment. The Pi must receive the resulting booking/payment summary through the existing sync flow so staff see the same booking and balance on either deployment. Raw provider payloads should be retained only where needed for reconciliation and should not be copied into guest-facing responses.

## 7. Payment settings

Add admin-configurable settings:

```text
website_booking_enabled
website_advance_percent
website_pay_at_property_enabled
website_hold_minutes
website_cancellation_deadline_hours
website_refund_percent
```

Recommended initial values:

```text
website_advance_percent: 50
website_pay_at_property_enabled: true
website_hold_minutes: 15
website_cancellation_deadline_hours: 48
website_refund_percent: 100
```

The advance percentage must be validated server-side between 0 and 100.

The system should support:

- 100% advance.
- 50% advance.
- Any other configured percentage.
- 0% advance.
- Explicit pay-at-property when enabled.
- Automatic pay-at-property fallback when Razorpay cannot be reached.

Do not use `pay_at_property` as `paymentMethod` unless the existing `isStayPayMethod` and collection UI are deliberately extended. The compatible default is `paymentStatus = pay_at_property` with an empty `paymentMethod` until staff collects the balance.

## 8. Payment data model

Keep the booking summary fields on `bookings`:

- `amountTotal`.
- `amountPaid`.
- `paymentStatus`.
- `paymentMethod`.
- `amountRefunded`.
- `currency`.

Add a payment-attempt table rather than storing every payment attempt in the booking row.

Recommended fields:

```text
id
booking_id
idempotency_key
provider
provider_order_id
provider_payment_id
provider_refund_id
amount_expected
amount_received
currency
status
signature_verified
webhook_verified
provider_payment_status
settlement_status
failure_code
failure_message
raw_event_hash
created_at
updated_at
captured_at
refunded_at
```

Use rupees in the Goko database, and convert to paise only at the Razorpay boundary. Razorpay Orders API amounts are currency subunits, and refunds can only be initiated for captured payments. [Razorpay Orders API](https://razorpay.com/docs/api/orders/create/) [Razorpay Refunds API](https://razorpay.com/docs/api/refunds/)

## 9. Payment state machine

```text
NOT_REQUIRED
    └── PAY_AT_PROPERTY_CONFIRMED

REQUIRED
    └── ORDER_CREATE_PENDING
          ├── ORDER_CREATED
          │     ├── PAYMENT_PENDING
          │     │     ├── PAYMENT_CAPTURED
          │     │     ├── PAYMENT_FAILED
          │     │     ├── PAYMENT_CANCELLED
          │     │     └── PAYMENT_UNKNOWN
          │     └── ORDER_CREATE_FAILED
          │           └── PAY_AT_PROPERTY_FALLBACK
          └── PAYMENT_UNKNOWN

PAYMENT_CAPTURED
    └── BOOKING_CONFIRMED
          ├── REFUND_NOT_REQUIRED
          ├── REFUND_PENDING
          ├── REFUNDED_PARTIAL
          └── REFUNDED_FULL
```

Important invariants:

- Browser success is not payment proof.
- A verified payment response is not enough to trust an arbitrary booking/order relationship; the order must belong to the local booking.
- `captured` means Razorpay accepted/captured the payment; it is not the same as the money already being settled into Goko's bank account.
- Settlement delay or bank-credit delay must not automatically cancel a valid captured booking.
- A webhook is not processed twice.
- A booking is not marked paid twice.
- A refund is not issued twice for the same cancellation event.
- An ambiguous payment is never silently treated as failed.
- An expired hold must not be fulfilled without a fresh availability check.

## 10. Detailed payment failure workflows

### Case A: Guest never opens Razorpay

1. Local hold is created.
2. Razorpay order exists but no payment is attempted.
3. Guest leaves or closes the page.
4. Hold expires.
5. Booking remains unconfirmed or is cancelled as an expired hold.
6. Inventory is released.
7. No payment or revenue is recorded.

### Case B: Payment fails normally

1. Razorpay reports failed payment.
2. Store the failed payment attempt.
3. Keep the hold alive until its expiry.
4. Allow the guest to retry payment or select pay-at-property.
5. Never create a paid booking.

### Case C: Razorpay order creation fails

1. The local service receives an error or timeout creating the order.
2. Do not show a Razorpay button.
3. Offer pay-at-property if enabled.
4. If selected, confirm with `amountPaid = 0`, `paymentStatus = pay_at_property`, and an empty `paymentMethod` until the desk collects cash, online, or split payment.
5. If fallback is disabled, release the hold and show a retry message.

### Case D: Money debited, browser shows failure or disconnects

This is an ambiguous result and must not immediately cancel the booking.

1. Keep the local booking/hold and payment attempt in `payment_review` or `payment_unknown`.
2. Do not ask the guest to create a second booking immediately.
3. Search for the order/payment through the Razorpay API using the server-stored order ID.
4. Wait for the webhook if the payment is not immediately queryable.
5. If Razorpay reports the payment as captured:
   - Confirm the booking if inventory is still valid.
   - If inventory is no longer valid, keep the payment as `captured_unfulfilled` and initiate the defined refund/escalation workflow.
6. If failed or absent after the configured reconciliation window:
   - Release the hold.
   - Tell the guest the payment was not confirmed.
   - Provide a support path for a bank-debit dispute.
7. Never tell the guest to pay again until the first attempt is resolved or explicitly expired.

### Case E: Money credited, but success response never reaches GokoWeb

1. Razorpay webhook is the recovery path.
2. Webhook identifies the local order.
3. Server verifies the event signature.
4. Payment is recorded idempotently.
5. Booking is confirmed if inventory is valid.
6. Confirmation becomes available from the booking reference.
7. Create the single online room receipt using the existing `guest_receipts`/room-account workflow.
8. If receipt creation fails, keep the booking confirmed and mark the receipt/reconciliation task pending; never reverse a captured payment or create a duplicate booking.
9. A retry/reconciliation job checks unresolved orders so a delayed webhook cannot leave a captured payment unnoticed.

### Case E2: Razorpay captured the payment, but settlement has not reached Goko's bank account

This is different from a payment that the provider cannot find.

1. Keep the booking confirmed when the payment is captured and the amount/order match.
2. Set `settlementStatus = pending`.
3. Do not ask the guest to pay again.
4. Do not automatically refund merely because the bank statement is delayed.
5. Reconcile provider settlement reports against the configured Goko receiving account.
6. Alert staff only after the provider's expected settlement window has passed or a settlement exception is reported.
7. If Razorpay later marks the payment reversed, failed, or refunded, route it to payment review and contact the guest before changing the reservation.

### Case F: Browser sends a false or tampered success response

1. Verify the signature using the server-stored Razorpay order ID and server secret.
2. Verify the payment belongs to the local order.
3. Verify the amount equals the expected advance.
4. Verify the payment state is captured or otherwise approved according to the configured capture policy.
5. Reject mismatched, invalid, or tampered responses.
6. Do not confirm the booking.
7. Log the attempt without storing unnecessary sensitive data.
8. Do not retry fulfilment from the rejected response.

Razorpay explicitly requires signature verification before fulfilment; client-reported success must not be trusted on its own. [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)

### Case G: Webhook arrives before browser response

1. Process the webhook first.
2. Confirm the booking and mark the payment captured.
3. When the browser response later arrives, return the already-confirmed result.
4. Do not create a second payment record or booking.

### Case H: Browser response arrives before webhook

1. Verify the browser response server-side.
2. Mark payment as verified/captured.
3. Confirm the booking.
4. When the webhook arrives, treat it as a duplicate state update.
5. Store the event as processed and return success.

### Case I: Duplicate callback or double-click

Use idempotency at multiple levels:

- Checkout request.
- Razorpay order creation.
- Browser verification.
- Webhook event hash/ID.
- Booking confirmation.
- Refund request.

Every retry must return the existing result rather than creating another booking or payment.

### Case J: Payment captured after the hold expires

1. Detect that the hold expired before fulfilment.
2. Query current inventory.
3. If inventory is still available, confirm and assign.
4. If inventory is unavailable, keep the booking in its normal `hold`/`received` lifecycle and mark the payment attempt `captured_unfulfilled` / `payment_review`.
5. Do not assign a different room type without guest/staff approval.
6. Initiate a refund or manual resolution according to policy.

### Case K: Payment is authorized but not captured

1. Do not treat authorization as collected revenue.
2. Query Razorpay payment status.
3. Wait for capture or failure according to the payment policy.
4. If capture does not occur, mark the attempt failed/expired and release the hold.

### Case L: Razorpay credits an amount different from the quote

1. Compare captured amount with the server-generated expected amount.
2. If lower, do not confirm as fully paid; use the configured partial-payment rules only if the amount matches an allowed advance.
3. If higher, do not silently apply the excess.
4. Place the payment in review and refund or manually reconcile the difference.

### Case M: Customer's bank shows debit, but Razorpay reports failed or no payment

1. Keep the local attempt unresolved until provider lookup and webhook retry windows expire.
2. Do not fulfil the booking from a bank screenshot or customer statement alone.
3. Tell the guest that the transaction is being checked and do not request a second payment yet.
4. If Razorpay never records a captured payment, release the hold after the reconciliation window.
5. Give the guest the local booking reference and Razorpay order ID for support.
6. Escalate to Razorpay/bank support if the customer remains debited after the provider's stated reversal window.

### Case N: Payment captured but the confirmation response fails

1. The server or webhook has already confirmed the payment.
2. The guest reopens the confirmation using `/api/booking/[reference]` or the emailed/WhatsApp reference.
3. A browser retry returns the existing booking and never creates another one.
4. If payment was captured but no booking was created, reconciliation repairs or creates the local booking only after verifying inventory and idempotency data.

## 11. Reconciliation workflow

Create an admin payment-reconciliation view or section inside the existing Booking Dashboard.

Show:

- Local booking reference.
- Expected amount.
- Razorpay order ID.
- Razorpay payment ID.
- Local payment state.
- Provider payment state.
- Webhook received time.
- Provider settlement status and settlement reference.
- Inventory/booking state.
- Refund state.
- Last reconciliation attempt.
- Error reason.

Staff actions:

- Retry provider lookup.
- Reprocess a verified webhook event.
- Re-run provider lookup using the stored Razorpay order ID.
- Confirm a captured payment after inventory review.
- Mark a failed attempt as expired.
- Start/refire a refund.
- Add an internal resolution note.

Automated reconciliation should periodically inspect unresolved `payment_unknown`, `payment_review`, and `payment_pending` records. It should stay quiet when no actionable mismatch exists and notify staff only for captured-but-unfulfilled, refund-failed, or persistently unresolved cases.

## 12. Cancellation and refund workflow

### Guest cancellation before deadline

1. Validate booking reference and cancellation authorization.
2. Check configured deadline.
3. Calculate refundable amount.
4. Cancel the local booking.
5. Release bed assignments.
6. Push updated availability to Aiosell.
7. Create a refund request for captured Razorpay payments.
8. Store the refund ID and status.
9. Notify the guest.

### Cancellation after deadline

- Reject automatic cancellation, or route it to staff review.
- Do not refund automatically.
- Keep the booking and payment records unchanged until staff acts.

### Refund failure

1. Keep the booking cancelled if inventory has already been released.
2. Set refund state to `refund_pending` or `refund_failed`.
3. Keep the provider payment and refund IDs.
4. Notify staff.
5. Allow a retry using the same cancellation/refund idempotency key.

### Pay-at-property cancellation

No Razorpay refund is needed. Cancel the booking, release inventory, and push the availability update.

## 13. Admin booking workflow

Website bookings should appear in the existing Admin Bookings screen with a `Website` source badge.

Staff can:

- Open booking details.
- View selected room categories and quantities.
- View advance paid and balance due.
- Assign, move, or unassign beds.
- Check in the guest.
- Collect the remaining balance.
- Cancel the booking.
- View payment attempts and webhook history.
- Retry reconciliation.
- Process or retry eligible refunds.
- Check out using existing booking workflows.

Existing admin actions such as `createBooking`, `assignBeds`, `collectStayPayment`, `checkIn`, `checkOut`, and `cancelBooking` should remain the operational actions. The website flow should create records compatible with these actions.

## 14. Data and migration changes

Add:

1. Room-selection records for category, rate plan, quantity, and quoted rate.
2. Payment-attempt records.
3. Refund and reconciliation fields.
4. Website booking settings.
5. Idempotency/event-processing records where existing tables cannot safely provide them.

Do not create a second booking table or a second payment-ledger model.

Existing booking summary fields remain authoritative for admin reporting:

- Total amount.
- Amount paid.
- Amount refunded.
- Payment method.
- Payment status.

## 15. Security and reliability requirements

- Razorpay key secret exists only in Cloudflare secrets/server environment.
- Only the public Razorpay key is sent to the browser.
- Verify payment signatures server-side.
- Verify webhook signatures against the raw request body.
- Never trust client totals, room availability, payment amount, booking IDs, or payment status.
- Use server-generated booking references.
- Use idempotency keys on all money-changing operations.
- Log provider IDs and state transitions, not card data or unnecessary personal data.
- Rate-limit public availability and checkout endpoints.
- Do not reveal whether arbitrary booking references exist.
- Never release inventory before resolving an ambiguous captured payment.
- Never assign a different room category automatically after payment without an explicit policy.

## 16. Test plan

### Booking page

- Valid one-night and multi-night stays.
- Invalid and reversed dates.
- Minimum/maximum stay restrictions.
- Stop-sell and close-on-arrival/departure dates.
- One room type and multiple room types.
- Quantity greater than available inventory.
- Female dorm rules.
- Mobile, keyboard, loading, and error states.

### Inventory and Aiosell

- Last available unit booked concurrently by two guests.
- Website booking automatically assigned to online inventory.
- Aiosell push after confirmation.
- Aiosell push after cancellation.
- Aiosell push after hold expiry.
- Admin bed move updates local and Aiosell inventory.
- Existing OTA/channel-manager booking behavior remains unchanged.

### Payment

- 100% advance.
- 50% advance.
- 0% advance.
- Explicit pay-at-property.
- Razorpay order creation timeout.
- Razorpay checkout script unavailable.
- Payment declined.
- Payment debited but browser disconnected.
- Captured payment with delayed webhook.
- Webhook before browser callback.
- Browser callback before webhook.
- Invalid signature.
- Wrong order ID.
- Wrong amount.
- Duplicate callback.
- Duplicate webhook.
- Authorized but uncaptured payment.
- Captured payment after hold expiry.
- Captured payment with inventory no longer available.

### Cancellation and reconciliation

- Cancellation before deadline.
- Cancellation after deadline.
- Full refund.
- Partial refund.
- Refund failure and retry.
- Duplicate refund request.
- Pay-at-property cancellation.
- Captured-but-unfulfilled payment appears in reconciliation.
- Captured-but-not-yet-settled payment is visible without being incorrectly marked as failed.
- Customer-debited/provider-failed payment remains unresolved until the provider lookup window expires.
- Failed payment does not create revenue.
- Successful payment creates exactly one online room receipt, even if receipt creation initially fails.

## 17. Acceptance criteria

The feature is ready when:

- The Book Now flow opens the native `/book` page after the eligibility gate.
- Website bookings appear in the existing Admin Bookings screen.
- Website and admin bookings use the same pricing and inventory services.
- Physical bed IDs are never exposed to guests.
- Confirmed website bookings reduce Aiosell availability through the existing push workflow.
- Full, partial, and zero-advance payments work.
- Pay-at-property fallback works when Razorpay is unavailable.
- A browser/network failure cannot create a duplicate booking.
- Money-debited-but-unknown outcomes enter reconciliation instead of being silently discarded.
- False or tampered payment responses cannot confirm a booking.
- Delayed and duplicate webhooks are handled safely.
- Captured payments are never left without a visible admin resolution path.
- Refunds are idempotent and traceable to the booking and Razorpay payment.
- Admin staff can collect balances, assign beds, cancel bookings, and resolve payment exceptions using the existing workflows.

## 18. Recommended delivery order

1. Extract shared booking, pricing, availability, assignment, and Aiosell services.
2. Add room-selection and payment-attempt data structures.
3. Add website booking settings in Admin.
4. Build the availability and quote API.
5. Build `/book` room selection and guest details.
6. Add temporary holds and concurrency-safe inventory assignment.
7. Add pay-at-property booking path.
8. Add Razorpay Orders API and Checkout integration.
9. Add signature verification and webhook processing.
10. Add payment reconciliation and admin exception handling.
11. Add cancellation/refund processing.
12. Replace the StayFlexi redirect.
13. Run payment, inventory, Aiosell, and failure-mode tests in Razorpay test mode.
14. Launch with pay-at-property fallback enabled and monitor unresolved payments.
