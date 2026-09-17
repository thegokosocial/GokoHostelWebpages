# Goko First-Party Booking, Payment, and Aiosell Plan

## 1. Objective

Build a native Goko booking experience at `/book`, selectable through the existing Management → Channel Manager → Configuration → Booking Engine URL field. The same field also supports an external booking engine such as Aiosell or StayFlexi.

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

The review example applies only while no capture is verified. If money was captured, preserve the actual `amountPaid` and `paymentMethod = online` even if fulfilment is under review. Never erase collected money to represent an operational exception. Native payments use `paid`/`partial`, never the OTA-specific `prepaid` status, so check-in rollback cannot erase a real gateway payment.

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

After acknowledgement, `BookingGateProvider` should open the destination selected by the saved Booking Engine URL, following the routing rules below.

### Booking destination controlled by the existing URL field

#### Current defect: empty configuration still redirects to StayFlexi

Repository inspection on 17 September 2026 found that the saved Booking Engine URL is not used by the public Book Now flow. `src/lib/site.ts` hard-codes `https://bookingengine.stayflexi.com/?hotel_id=30819`, and `BookingGateProvider.goBooking` opens that value directly. Therefore, leaving the admin field empty currently does not disable the old destination. The public buttons still use the hard-coded StayFlexi link. This finding is verified from source; the live site's deployed behavior must also be verified during implementation.

Fix this wiring as part of connecting the saved URL field:

- Resolve the saved value through the sanitized public booking configuration API before offering a reservation action.
- Remove the hard-coded StayFlexi destination and every fallback that silently restores it when configuration is empty or missing.
- Treat an empty value or absent configuration row as “Not configured”. Show a clearly labelled “Booking enquiry” action to `/booking-enquiry` and a WhatsApp alternative; do not show an active “Reserve My Spot” action that opens a provider.
- If configuration cannot be fetched because of a network/server error, show a retry action and enquiry/WhatsApp alternatives. Do not infer a provider destination from the error.
- Saving a new URL changes the destination without requiring a source-code change or redeployment. Clearing it removes the active booking destination after public configuration refresh.
- On rollout, preserve any explicitly saved valid URL. Leave blank records blank; do not backfill the old StayFlexi link automatically. Show the administrator how to select `/book` or enter their external guest booking URL.

Use the existing `channelConfig.bookingEngineUrl` field and the current authenticated `getConfig` / `saveConfig` actions. This is the single source of truth for the public Book Now destination; remove the hard-coded `site.bookingUrl` routing once this feature launches.

| Saved value | Active booking experience | Payment experience |
| --- | --- | --- |
| `/book` or the configured Goko site's `/book` URL | Native Goko booking page | Goko Razorpay checkout, subject to payment credentials and settings |
| Valid external HTTPS booking-engine URL | External Aiosell/StayFlexi/other booking engine | The external provider's payment flow |
| Empty | Booking unavailable; show Booking Enquiry / WhatsApp alternative | No new online checkout |

Treat same-origin `/book` links as internal navigation. External links open the saved provider destination after the existing eligibility acknowledgement. Reject unsafe schemes, protocol-relative URLs, and same-origin destinations other than `/book`; show a validation error before saving. Do not identify a provider by a partial hostname match or use the Aiosell API Base URL as a guest booking URL.

The configuration UI should show the resolved mode (“Goko booking”, “External booking engine”, or “Not configured”), a link preview, and a test/open action. Selecting the Goko link activates native booking entry points; Razorpay readiness is displayed separately. A URL does not provision Razorpay credentials. If credentials are missing or the gateway is unavailable, offer the mandatory outage pay-at-property fallback.

Expose only a small public booking configuration response containing the sanitized destination, resolved mode, and payment readiness. Never expose the Channel Manager configuration object, API password, webhook secret, or Razorpay secret through a public API. Refresh/invalidate cached public configuration after saving so all Book Now buttons and shared booking links use the current destination.

Use this destination consistently in the header, footer, room cards, mobile booking CTA, and general booking links. Direct access to `/book` must check the saved mode too: external mode routes the guest to the configured provider, and an empty destination offers the enquiry alternative. New native checkout requests must recheck the mode server-side.

Changing the URL affects new bookings only. Existing holds, captured payments, refunds, confirmation pages, and webhook/reconciliation processing continue against their original local booking/order. General booking links follow the saved destination; payment links tied to an existing booking retain that booking's payment workflow and cannot be redirected to another provider by a configuration change.

Booking destination selection is independent of “Enable Channel Manager” and its auto-push settings. Selecting an external engine changes the guest destination; selecting Goko continues using the existing Aiosell inventory integration subject to those settings.

#### Help below the Booking Engine URL field

Add an always-visible help note directly below the field, headed **Choose your booking link**, with Goko shown first:

- **Goko booking — recommended:** enter `/book` or `https://www.gokohostel.com/book`. This opens our room/date selection and Goko payment flow. Add a “Use Goko booking” button that fills `/book`; it does not save until “Save Configuration” is clicked.
- **Aiosell or another provider:** paste the exact HTTPS guest booking-engine link supplied by that provider. Payments take place with that provider. Do not enter an API Base URL, webhook URL, or admin dashboard URL.
- **No link:** leave blank to offer booking enquiry and WhatsApp instead of online booking.
- **Payment setup:** using the Goko link requires the booking feature to be deployed. Configure advance payments, Razorpay readiness, and policies in Management → Booking Settings. Add an “Open Booking Settings” shortcut here.

Show the resolved destination and current mode below the help, plus “Preview booking page”. Label the native link as not yet available until `/book` is deployed; never imply that filling a URL installs the feature. Generate the full Goko example from the configured canonical site URL, rather than duplicating a domain constant.

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

If Razorpay is unavailable, pay-at-property must be offered for a configured native booking destination, independent of the normal pay-at-property toggle.

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

Use a guest page such as `/booking/[reference]` for confirmation, payment recovery, and cancellation. The `/api/booking/[reference]` route serves data to that page. Issue an unguessable guest access token, store its hash, and require it for private details and cancellation. A booking reference alone is not authorization. Recovery uses a private link sent to the booking email; keep tokens out of analytics events and referrer data.

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

Bind the key to a canonical request fingerprint; reject reuse with changed dates, room quantities, guest count, or payment choice. Idempotency lookup precedes current destination-mode checks so an existing booking can recover after configuration changes. New bookings must use the current mode.

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

Require the guest access token before returning guest identity, payment details, or allowing cancellation. A public reference-only response, if provided, must contain no private booking information.

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
Transition provisional booking from hold to received and consume hold
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

The final hold-consumption operation must be retry-safe and transition the existing provisional booking, rather than inserting a second booking. If the provider confirms payment but the local transaction fails, retain the payment attempt and send it to reconciliation; never discard the payment because the browser request failed.

The provisional booking is created before Razorpay Checkout so every provider order has a durable local owner. A failed, abandoned, or expired provisional booking is cancelled/expired by cleanup after its hold and reconciliation windows, without creating revenue.

### Hold implementation and concurrency

Bind the category hold to candidate physical sellable units internally, including both guest slots of a double unit, for every night in `[checkin, checkout)`. Guests continue to see categories only. Every local inventory writer—website, admin assignment/edit/move, room blocks, and inbound OTA assignment—must observe active holds through the shared availability/assignment guards. Count each hold once, and remove its reservation effect atomically when converting it to assignments.

Use guarded SQL and atomic D1 `batch()` statements for hold acquisition and conversion. Conflict detection must abort the whole operation; a zero-row conditional insert alone must not allow a partially successful multi-unit booking to commit. Reuse the existing guarded `assignBedToBooking` logic and extend its hold checks. Do not assume the D1 driver supports an interactive application transaction. [Cloudflare D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)

The local hold cannot guarantee availability on an external OTA before the confirmation push reaches Aiosell. Recheck all local assignments and newly ingested OTA reservations at conversion. A captured payment with an external inventory conflict enters `captured_unfulfilled`; it must receive an alternative approved by the guest or a full operational-failure refund, irrespective of the ordinary cancellation deadline.

Use the 15-minute hold for normal checkout. On an unresolved attempted payment, permit a bounded extension to 30 minutes from checkout creation, then release unconfirmed inventory while retaining the payment record and continuing provider reconciliation. Late capture follows Case J. Provider lookup failure never proves that money was not collected.

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

Respect the existing Channel Manager enable/auto-push switches. When push is enabled, queue/retry updates through the shared service. When disabled, keep the local booking but show “Inventory sync disabled — manual channel update required” to staff; never show a successful external-sync badge. Clearing the guest URL does not disable inventory updates for existing reservations.

### Cloudflare and Pi synchronization

The public booking request runs against the Cloudflare D1 deployment. Website bookings, bed assignments, payment summaries, online receipts, and the payment-attempt records required by the admin UI must be included in the existing Cloudflare/Pi synchronization allowlist and ID remapping rules.

Provider webhook processing remains Cloudflare-side because Razorpay must reach the public deployment. The Pi must receive the resulting booking/payment summary through the existing sync flow so staff see the same booking and balance on either deployment. Raw provider payloads should be retained only where needed for reconciliation and should not be copied into guest-facing responses.

Cloudflare owns gateway attempts, webhook events, refund operations, and settlement results. Replicate display data to Pi with explicit ownership rules; do not let a stale Pi update overwrite provider-backed payment totals through generic last-write-wins sync. Balance collection must reconcile unresolved gateway attempts first. Display last-sync time and block gateway/refund operations when Pi has no live Cloudflare connection.

## 7. Payment settings

### Tab placement: Management → Booking Settings

Add a `bookingSettings` Management tab immediately after Channel Manager in the existing tab bar and mobile dropdown. This tab configures native Goko bookings; operational booking/payment exceptions remain in the existing Bookings page.

Use three sections inside the tab:

| Section | Configuration |
| --- | --- |
| Booking & Policies | Advance percentage, full-payment option, normal pay-at-property availability, mandatory outage fallback, hold/reconciliation timings, guest/group limits, arrival information, cancellation deadline and refund percentage |
| Rooms & Rates | Publish existing room content, map each guest category to existing dorms, sellable unit type and active rate plan, choose display order, amenities and eligibility rules, validate rates/restrictions for all stay nights |
| Payments & Readiness | Razorpay test/live environment, public key identifier display, server-secret readiness, receiving bank for settlements, webhook URL, last verified webhook, capture policy, provider lookup check, and setup instructions |

Reuse the existing Website CMS for room descriptions/photos and the existing Inventory/Channel Manager tools for rates. Booking Settings references those records instead of maintaining another catalogue or nightly price list. Missing or ambiguous category/unit/rate mappings block publishing that category.

Add a status summary: saved booking destination, native/external mode, native page availability, payment environment, credentials ready/missing, room/rate mapping readiness, and Aiosell connection/auto-push state. Include shortcuts back to Channel Manager and the existing rate/content editors. Aiosell disabled/unavailable must be visible to the administrator but does not change the guest URL automatically.

### Gateway credentials and setup

Use Razorpay Standard Checkout with automatic capture configured in the Razorpay dashboard. The settings page displays the public key identifier and server credential readiness. API secret and webhook secret are provisioned through deployment secrets, never ordinary settings rows, synced tables, client bundles, exports, or the existing Channel Manager `getConfig` response.

Use separate test/live secret sets: `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, `RAZORPAY_TEST_WEBHOOK_SECRET`, and the matching `RAZORPAY_LIVE_*` names. Store the selected environment on each order/attempt so changing the default cannot change how an outstanding payment is verified or refunded. The UI cannot return existing secrets; it provides the deployment setup instructions and readiness checks. Credential rotation retains the verification configuration needed for older webhook retries until that retry window ends.

Show the canonical webhook URL `https://www.gokohostel.com/api/webhooks/razorpay`, generated from the site URL, with a copy button and guidance for registering it separately in test and live dashboards. Check API authentication with a non-charging provider lookup. Indicate that webhook readiness requires an actual verified event; saving settings alone is insufficient.

Test mode is available only in development/staging or an authenticated test preview. Public production checkout requires live credentials. If unavailable, show pay-at-property; never record a test payment as actual money received. Previewing readiness does not perform a charge or refund.

### Access and documentation requirements

Booking Settings is admin-only in both UI and its `/api/admin/booking-settings` route. Use explicit actions `getSettings`, `saveSettings`, and `checkGatewayReadiness`; reject non-admin calls server-side. Editing gateway configuration is Cloudflare-side; Pi displays a summary/shortcut and does not edit deployment secrets or initiate provider operations offline.

Separate Bookings payment actions from ordinary booking entry: add shared-catalog permissions `canViewBookingPayments`, `canReconcileBookingPayments`, and `canRefundBookingPayments`. Keep existing booking/check-in/checkout permissions and compatibility aliases. Viewing exceptions requires view access; repair/retry actions require reconciliation access; money-returning actions require refund access. Admin bypass remains as defined by the project. The page gate alone never authorizes a mutation.

When implemented, update `permissionCatalog.ts`, shared authorization/action maps, Management tab types/gates, and matching tests together. Update `docs/pages-and-ui.md`, `docs/auth-rbac.md`, `docs/api-map.md`, and the applicable booking/account flow and onboarding documents in the same implementation turn. These are proposed changes; this plan does not claim the current permission matrix or API actions already include them.

Add admin-configurable settings:

```text
website_booking_enabled
website_advance_percent
website_pay_at_property_enabled
website_hold_minutes
website_cancellation_deadline_hours
website_refund_percent
```

Derive `website_booking_enabled` from the saved Booking Engine URL resolving to native `/book`; do not add a second administrator-controlled enable switch that can disagree with the URL. Other payment and cancellation settings apply to native bookings only.

Recommended initial values:

```text
website_advance_percent: 50
website_pay_at_property_enabled: true
website_hold_minutes: 15
website_cancellation_deadline_hours: 48
website_refund_percent: 100
```

Treat the cancellation deadline and refund percentage above as editable draft values. Require the administrator to review and publish the guest-facing policy before enabling native checkout; do not silently activate a new refund promise during migration.

The advance percentage must be validated server-side between 0 and 100.

The system should support:

- 100% advance.
- 50% advance.
- Any other configured percentage.
- 0% advance.
- Explicit pay-at-property when enabled.
- Automatic pay-at-property fallback when Razorpay cannot be reached.

The normal pay-at-property toggle controls whether ₹0 advance is offered while online payments are healthy. The outage fallback is always available for a configured native booking destination, as requested. Do not treat a customer's declined payment as a gateway outage; the fallback endpoint verifies provider readiness on the server. If an earlier attempt is unresolved, reconcile it before inviting another charge. A subsequent capture against a booking already confirmed for pay-at-property credits that same booking and reduces its balance.

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

Preserve provider-reported amounts, fees, taxes on fees, and settlements in integer paise in gateway records; they may contain fractional rupees. The existing booking summaries keep their current integer-rupee convention. Compute the advance as `ceil(totalRupees × advancePercent / 100)`, capped at the total, then create the exact paise order. Sum the actual rate for each selected unit on each night before applying the configured tax; never multiply only the arrival-day rate across the stay. Snapshot prices, terms version, advance choice, and cancellation policy on the provisional booking so later settings changes cannot alter its agreement.

Allow multiple provider attempts and partial refunds per booking. Store refund requests/results as separate rows linked to the captured payment, with a unique refund-operation key, amount, provider refund ID, and pending/processed/failed status. Store webhook events separately by environment plus `x-razorpay-event-id`; marking an event processed happens only after its local change commits. [Razorpay webhook validation and delivery order](https://razorpay.com/docs/webhooks/validate-test/)

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
          ├── ORDER_CREATE_FAILED
          │     └── PAY_AT_PROPERTY_FALLBACK
          └── PAYMENT_UNKNOWN

PAYMENT_CAPTURED
    └── BOOKING_CONFIRMED
          ├── REFUND_NOT_REQUIRED
          ├── REFUND_PENDING
          ├── REFUNDED_PARTIAL
          └── REFUNDED_FULL

PAYMENT_CAPTURED
    └── CAPTURED_UNFULFILLED
          ├── BOOKING_CONFIRMED_AFTER_RECOVERY
          └── OPERATIONAL_FAILURE_REFUND

Settlement tracking runs separately: PENDING → SETTLED or EXCEPTION.
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
3. Offer the mandatory outage pay-at-property fallback when the native destination is configured.
4. If selected, confirm with `amountPaid = 0`, `paymentStatus = pay_at_property`, and an empty `paymentMethod` until the desk collects cash, online, or split payment.
5. An order-creation timeout is an unknown result, not proof that no provider order exists. Store that state and block blind order recreation until it is resolved. A pay-at-property conversion reuses the same provisional booking; any later capture must be credited to it once.

### Case D: Money debited, browser shows failure or disconnects

This is an ambiguous result and must not immediately cancel the booking.

1. Keep the booking in `hold`; mark its payment attempt `payment_review` or `payment_unknown`, without adding a new booking lifecycle status.
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
7. Record the captured amount on the booking and gateway payment attempt. Create the bank receipt only when a verified settlement/credit reaches the configured bank, using the existing settlement receipt workflow.
8. If settlement receipt creation fails, keep the booking confirmed and mark the receipt/reconciliation task pending; never reverse a captured payment or create a duplicate booking.
9. A retry/reconciliation job checks unresolved orders so a delayed webhook cannot leave a captured payment unnoticed.

### Case E2: Razorpay captured the payment, but settlement has not reached Goko's bank account

This is different from a payment that the provider cannot find.

1. Keep the booking confirmed when the payment is captured and the amount/order match.
2. Set `settlementStatus = pending`.
3. Do not ask the guest to pay again.
4. Do not automatically refund merely because the bank statement is delayed.
5. Reconcile provider settlement reports against the configured Goko receiving account.
6. Alert staff only after the provider's expected settlement window has passed or a settlement exception is reported.
7. Track later refunds, disputes, or reversals separately. A stale failed/authorized event must not downgrade a verified capture. Contact the guest and staff before changing an affected reservation.

### Case F: Browser sends a false or tampered success response

1. Verify the signature using the server-stored Razorpay order ID and server secret.
2. Verify the payment belongs to the local order.
3. Verify the amount equals the expected advance.
4. Fetch the provider payment and verify currency, captured state, amount, environment, and order ownership. A valid checkout signature can accompany authorization; it is not proof of capture.
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
2. Fetch the provider payment; mark captured only when the provider confirms capture and the expected currency/amount/order match. Otherwise keep the attempt pending and let webhook/reconciliation resolve it.
3. Confirm the booking only after verified capture; otherwise display payment-pending and continue reconciliation.
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
2. If lower, do not confirm it as a guest-selected advance; compare it with the advance amount fixed on the original order and route the mismatch to review.
3. If higher, do not silently apply the excess.
4. Place the payment in review and refund or manually reconcile the difference.

Any amount/currency/environment mismatch enters review. Do not reinterpret an unexpected amount as a guest-selected deposit: compare against the immutable order quote. Two independently captured attempts are distinct money movements; record both and refund the excess through a unique refund operation instead of discarding one as a duplicate webhook.

### Case M: Customer's bank shows debit, but Razorpay reports failed or no payment

1. Keep the local attempt unresolved until provider lookup and webhook retry windows expire.
2. Do not fulfil the booking from a bank screenshot or customer statement alone.
3. Tell the guest that the transaction is being checked and do not request a second payment yet.
4. If Razorpay never records a captured payment, release the hold after the reconciliation window.
5. Give the guest the local booking reference and Razorpay order ID for support.
6. Escalate to Razorpay/bank support if the customer remains debited after the provider's stated reversal window.

### Case N: Payment captured but the confirmation response fails

1. The server or webhook has already confirmed the payment.
2. The guest reopens `/booking/[reference]` with the private access link sent by email or another configured confirmation channel.
3. A browser retry returns the existing booking and never creates another one.
4. If payment was captured but no booking was created, reconciliation repairs or creates the local booking only after verifying inventory and idempotency data.

### Case O: Payment captured after the guest cancelled

Guest cancellation and hold expiry have different meanings. Store the closure reason (`guest_cancelled` or `hold_expired`) on the provisional booking.

1. A late capture after explicit guest cancellation never reopens or assigns the booking.
2. Record the captured money against the original booking and request a full refund through a unique operation.
3. A late capture after hold expiry may recover the same provisional booking only if the original category/unit inventory is available and the guest has not explicitly cancelled; otherwise refund the captured amount in full.
4. A duplicate late event cannot trigger another refund.

### Case P: Late capture after the property has already collected the balance

1. Preserve the existing `received`, `checked_in`, or `checked_out` state; payment reconciliation cannot move an active stay backwards to a new reservation.
2. Calculate total collected across gateway payments and actual desk cash/online collections.
3. Record the distinct captured payment even when the stay was already paid.
4. If collected funds exceed the agreed total, refund the excess against the captured gateway payment using a unique operation linked to that payment.
5. Keep the original collections and refund history intact. Guest balance is zero; an excess payment is not a negative amount still due.

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

- Retry provider lookup using the stored Razorpay order ID.
- Reprocess a verified webhook event.
- Confirm a captured payment after inventory review.
- Mark a failed attempt as expired.
- Start/refire a refund.
- Add an internal resolution note.

Automated reconciliation should periodically inspect unresolved `payment_unknown`, `payment_review`, and `payment_pending` records. It should stay quiet when no actionable mismatch exists and notify staff only for captured-but-unfulfilled, refund-failed, or persistently unresolved cases.

Use a scheduled Cloudflare job every five minutes for bounded expiry/reconciliation work, reusing the current scheduled-job authentication and dispatch pattern. Attempt immediate verification on callback, then scheduled retries with backoff; after 24 hours unresolved provider results require staff review. Retain records and accept valid late events after that window. The 30-minute inventory-hold limit is independent of payment-record retention.

The guest page polls status briefly, then shows “Payment being checked” with its recovery link and support contact. Closing the browser must not stop reconciliation. Handle out-of-order webhooks without regressing confirmed states. Return webhook success only after durable event storage; retry processing failed stored events and never mark an event processed before its booking/payment changes commit.

### Bank settlement accounting

The current online receipt helper requires a real active receiving bank and feeds bank reconciliation. Posting the gross captured amount there immediately would falsely claim a bank credit before settlement. Use captured amounts for guest payment/balance summaries, and the existing `platform_settlement` receipt pattern for the actual net bank settlement, once per settlement ID. Map the contributing payments, fees, fee tax, refunds, and adjustments to that settlement; never count capture and settlement twice as revenue or bank receipts. Staff may record a verified settlement manually if automated settlement data is unavailable, with the same uniqueness checks and audit trail.

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

Refund eligibility uses the policy snapshot accepted at booking and the property's 12:00 IST check-in time. Calculate against actual captured funds less processed/pending refund claims, cap it at the unrefunded captured amount, and show the guest the amount before confirmation. Refund state is distinct from cancellation state. Update `amountRefunded` only when the provider verifies the refund as processed; a pending request is not a completed refund. Ordinary eligible cancellations use the configured percentage; operational inability to fulfil a captured booking returns the full captured amount.

Guest self-cancellation applies to provisional/received bookings before check-in. Checked-in or checked-out stays use the existing authorized staff cancellation/checkout workflow. An API timeout during refund creation leaves an `unknown` refund claim that continues reserving that amount; reconcile it before retrying so a lost response cannot cause a second refund. A confirmed failed request can be retried under the provider's idempotent-refund contract.

### Cancellation after deadline

- Allow the guest to cancel and release inventory after clearly showing that no automatic refund applies. Offer a staff-review request for exceptions.
- Do not refund automatically after the deadline.
- Keep paid/refunded amounts unchanged until a refund is verified.

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

Provisional website holds are labelled “Awaiting payment”, separate from confirmed Received bookings; block check-in and ordinary assignment actions until fulfilment. Detailed gateway records and repair/refund controls follow the payment permissions above. A failed browser response cannot turn a captured payment into an unpaid stay at the desk.

## 14. Data and migration changes

Add:

1. Room-selection records for category, unit type, rate plan, quantity, per-night quoted rates, policy snapshot, and internal temporary hold reservations.
2. Payment-attempt records.
3. Separate refund-operation, webhook-event, settlement-link, and reconciliation records with uniqueness constraints.
4. Website booking settings.
5. Guest access-token hashes and idempotency records where existing tables cannot safely provide them.

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
- Release unresolved unconfirmed holds only under the bounded hold policy; retain every money record and process later captures through recovery/refund.
- Never assign a different room category automatically after payment without an explicit policy.

## 16. Test plan

### Booking page

- Channel Manager help lists `/book`, the canonical Goko URL, external guest-engine links, and empty-link behavior, with working settings/preview shortcuts.
- Booking Settings appears after Channel Manager on desktop and mobile, and non-admin API/UI access is rejected.
- Readiness checks never expose secrets or initiate a payment; production rejects test-mode checkout.
- Guest private details/cancellation require the access token, even when the booking reference is known.
- Saving `/book` or the canonical Goko `/book` URL activates native booking entry points.
- Saving an external booking-engine URL activates that destination and its payment flow.
- Clearing the URL disables new checkout and offers enquiry/WhatsApp.
- Empty or missing configuration never opens the former hard-coded StayFlexi URL from any desktop/mobile Book Now entry point.
- A failed public configuration request shows retry/enquiry options and never activates an old provider fallback.
- Unsafe URLs are rejected; the public configuration never includes integration secrets.
- Configuration changes propagate to all Book Now entry points and direct `/book` access.
- Changing destination during an existing payment does not interrupt verification, confirmation, reconciliation, or refunds.
- Goko mode with missing Razorpay credentials offers the configured pay-at-property fallback.
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
- Local holds are observed by website, admin, block, and OTA assignment writers; multi-unit conflicts roll back the complete operation.
- Hold conversion does not create a second booking or subtract availability twice.
- Aiosell timeout queues a retry without cancelling a captured local booking.
- Expired holds release inventory within the configured bound; late capture still reconciles.

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
- A later capture on a pay-at-property booking updates that same booking's balance.
- Two different captured payments are recorded separately and excess payment is refunded once.
- A delayed authorized/failed event cannot regress a captured state.
- Missing rates on any stay night block the category; nightly rate changes and double-unit occupancy are priced correctly.

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
- Captured payment changes the guest balance but does not prematurely create a bank credit.
- Each verified net settlement creates exactly one bank receipt, even if receipt creation initially fails.
- Refund requests do not increase `amountRefunded` until provider processing is verified.
- Payment view, reconciliation, and refund permissions are enforced by action APIs as well as UI controls.
- Cloudflare/Pi sync cannot replace a captured payment total with a stale unpaid summary.

## 17. Acceptance criteria

The feature is ready when:

- The Book Now flow opens the saved Booking Engine URL after the eligibility gate, activating native or external booking as configured.
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
3. Add Management → Booking Settings, Channel Manager URL help, gateway readiness/setup guidance, proposed action permissions, and the matching handbook updates/tests.
4. Build the availability and quote API.
5. Build `/book` room selection and guest details.
6. Add temporary holds and concurrency-safe inventory assignment.
7. Add pay-at-property booking path.
8. Add Razorpay Orders API and Checkout integration.
9. Add signature verification and webhook processing.
10. Add payment reconciliation and admin exception handling.
11. Add cancellation/refund processing.
12. Connect all Book Now entry points to the saved Booking Engine URL and implement native/external/empty routing, public configuration sanitization, and in-progress payment continuity.
13. Run payment, inventory, Aiosell, and failure-mode tests in Razorpay test mode.
14. Launch with pay-at-property fallback enabled and monitor unresolved payments.

## 19. Final review and implementation handoff

Further implementation on 17 September 2026 adds revision-protected draft saves and an **admin-only Razorpay test integration** (fixed ₹1 simulated Checkout, API verification, durable test evidence/refund/webhook recovery). This is isolated from PMS/accounting and disabled for new tests by default. Public/native/live payments are still blocked; atomic native holds/fulfilment, guest recovery, general refunds, automated reconciliation, notifications and settlement remain delivery gates. See [implemented test workflows and official references](integrations-razorpay.md). No deployment/migration or real gateway transaction occurred here.

This is the target feature plan, reviewed against the repository on 17 September 2026. **Implementation is partial:** saved-link wiring, sanitized public configuration, link validation/help, an admin-only Booking Settings tab with draft policy configuration, and a branded `/book` enquiry entry page are implemented. The hard-coded StayFlexi destination has been removed from active routing. Native date/room availability, provisional reservations, Razorpay checkout/webhooks/reconciliation/refunds/settlements, policy publishing and payment permissions still require implementation; native checkout is explicitly disabled. See [implemented foundation and remaining gates](flows-website-booking.md). Do not call this feature launch-ready based on the specification mock scenarios.

Configuration ownership is explicit: Channel Manager owns the guest destination; Booking Settings owns native policies and mapping/readiness configuration; deployment secrets own gateway credentials; existing Inventory/CMS editors own rate and content data. Existing bookings and outstanding payments keep their original workflow when the destination changes.

The review separates capture from bank settlement, payment state from booking lifecycle, temporary holds from confirmed assignments, and guest references from authorization. Browser/network failures, duplicate/out-of-order events, expired holds, double captures, pending refunds, provider outages, and failed Aiosell pushes all have recovery paths above.

During implementation, keep source, action permissions, tests, and handbook documents synchronized under the repository maintenance rule. For RBAC/API/UI changes, run `npx vitest run`, `npx tsc --noEmit`, `git diff --check`, and `npm run build`; report any failing check before claiming the feature complete. Read the local maintainer instructions before deployment, migrations, Pi, CMS, or R2 work. This documentation-only revision does not change deployed behavior or provision credentials.

## 20. Executable mock validation

The scenario model is `scripts/mock-website-booking-plan.mjs`. Run it with:

```sh
node scripts/mock-website-booking-plan.mjs
```

Validation on 17 September 2026: **66 scenarios passed, 0 failed**. Each named scenario uses assertions. One scenario exercises all six orderings of authorized/captured/failed provider events. No real payment, database, website, deployment, or external service is accessed.

Follow-up adversarial review corrected six reproduced defects and now passes **19 probe groups with zero findings**. The model additionally checks incremental, per-payment refund reservations, retries and conflicting replays, integer-paise targets, creation-relative unknown-payment deadlines, unresolved desk-payment blocking, and terminal operational-refund decisions. Application validation passes **1,433 tests**, TypeScript, diff checks and production build. These results validate the configuration foundation and independent model only, not native money handling. Invalid saved drafts require reviewed repair; optimistic locking for concurrent admin edits and real D1/Razorpay/browser verification remain implementation gates. See the [detailed follow-up review](review-website-booking-2026-09-17.md).

| Mocked workflow | Checked result |
| --- | --- |
| Native/external/empty links | Correct mode selection; no former provider fallback; existing payment recovery survives switching/clearing the URL |
| Rates and deposits | Per-night rates, tax, upward rounding of percentage advance, missing-rate rejection, and 0%/50%/100% behavior |
| Booking and inventory | One provisional booking per request, conflicting idempotency keys rejected, unit capacities, overlapping nights, multi-unit conflict, and bounded expiry |
| Payment interruptions | Unknown payment remains recoverable; a trusted later capture confirms or queues an operational refund |
| Response authenticity | Stored-order HMAC check, wrong order/currency/environment rejection, and untrusted browser response rejection |
| Event ordering and duplicates | Callback/webhook arrival order, duplicated event/payment IDs, and stale authorized/failed events do not regress a capture |
| Late capture | Free-inventory recovery, sold-inventory refund, explicit cancellation refund, same pay-at-property booking credit, and excess refund after desk cash collection |
| Refunds | Accepted policy snapshot, after-deadline cancellation, pending versus processed amounts, unknown-result retry protection, and per-payment late-capture claims |
| Accounting | Capture does not invent bank credit; verified net settlement produces one bank receipt; online advance plus cash balance is handled as split collection |
| Aiosell errors | Confirmed local booking survives push failure; disabled auto-push is explicitly marked for manual channel update |
| Access | Settings remain admin-only; payment view/reconciliation permissions do not grant refund permission; a known reference is not guest authorization |

The mocks exposed and resolved additional specification gaps: idempotency-key payload conflicts, disabled Aiosell auto-push, guest cancellation versus hold expiry, unknown refund results, unconditional confirmation after an authorized callback, and late capture after cash collection/check-in.

**Implementation assessment:** ready to start implementation using the delivery order above. These are in-memory specification mocks, not tests of the current site or proof of real database concurrency. Implementation must replace the mocked transitions with the shared services and verify actual D1 atomicity under concurrent requests, Cloudflare/Pi ownership rules, real Razorpay test-mode orders/capture/refunds/webhooks, settlement receipt integration, notifications/recovery links, RBAC/API/UI checks, and browser flows before launch.
# Native implementation milestone — 17 September 2026

Implemented [durable accepted quotes](native-accepted-quotes.md) (0060): one immutable retained quote per owned hold, canonical validated copied rates/policy, active-hold/date guards at the SQL write boundary, concurrent identical/competing acceptance and recovery after disable/release/expiry. The existing PMS creation route is still not shared/atomic for native fulfilment; quote persistence alone does not resolve guest payment, quota/Pi, refund/recovery or settlement gates. No live migration or deployment occurred.

Implemented [internal server quote/refund calculations](native-booking-quotes-and-refunds.md): exact night coverage, whole-rupee tax/advance rounding, safe paise conversion, copied accepted policies, 12:00 IST cancellation boundaries and captured-minus-processed/reserved refund limits. No guest route, accepted-contract persistence, production refund request or fulfilment wiring is enabled. These calculations do not remove the remaining release gates.

Follow-up implementation added internal hold-aware advisory selection, read-only owner recovery, incomplete-schema/guard preflight and orphaned-Double rejection. Committed-insert/lost-response recovery is tested without another reservation; actual local D1 verifies selection/recovery and missing-guard refusal. Full regression now passes 96 files / 1,585 tests, including 39 native hold tests and 9 local D1 tests. This does not complete the native guest availability/quote, fulfilment or live money workflows.

Started the [internal physical hold primitive](native-inventory-hold-foundation.md): immutable owner-bound retries, maximum 15-minute leases, all-or-nothing multi-unit selection and same-database assignment/block SQL guards. No public route, guest checkout, booking fulfilment or money/account mutation is connected. Creation remains default-disabled; Pi is rejected. Aggregate quotas/unassigned OTA writers, shared availability/Aiosell accounting, Pi coordination, atomic fulfilment, production refunds/recovery/settlements and real merchant/browser/deployed-D1 verification remain launch blockers.

Validation: 96 Vitest files / 1,566 tests passed, including 22 new native hold tests and 7 local D1/workerd tests. Twenty-way last-unit and duplicate-request races, double-room completeness, partial-allocation rollback, owner-only release, expired/released retry and assignment/block exclusion pass. D1 preflight availability and Razorpay are mocked; database constraints execute against actual local D1. Production build and source lint passed. An overlapping TypeScript/build run encountered generated-file churn; TypeScript was rerun after the build. These are local implementation checks, not production certification.
