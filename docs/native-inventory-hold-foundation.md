# Native inventory hold foundation

## Implemented scope — internal only

`src/lib/nativeInventoryHold.ts` and repository migration `0059_native_inventory_hold_primitive.sql` start the native booking implementation. This is a **physical-unit reservation primitive**, not the completed category/quota booking service. No guest API, page action, payment operation or permission is enabled by this work. `nativeCheckoutReady` remains false.

Creation is Cloudflare-owned, rejects Pi, and requires `GOKO_NATIVE_HOLD_INTERNAL_ENABLED=true`; default is disabled. This flag enables internal service calls only, never public checkout. No migration has been applied remotely or on Pi. Read maintainer instructions before any actual migration/deployment.

## Workflow

1. An internal caller provides a UUID request key, a cryptographically generated 256-bit owner token (64 lower-case hex characters), server-selected bed IDs and civil stay dates. Do not accept arbitrary guest-selected physical IDs in a future public API. No amount, gateway credential or booking confirmation is accepted.
2. Validate real calendar dates, an arrival within the next 365 days, a 1–30-night stay, and 1–4 distinct positive physical IDs. Hash the owner token and canonical sorted allocation/dates; never store/return the raw token.
3. Before new work, recover the existing request for the correct owner. Changed selections under that key are rejected; disabling creation, expiry or release cannot cause a new reservation or renew expiry via recovery. Wrong ownership yields no hold data. Guest checkout `claimGuestCheckout` may renew an **unexpired** held lease by bumping `created_at`+`expires_at` together (migration **0065**, still ≤900s); expired/released holds are not extended.
4. Reuse the existing server booking picker to reject unavailable, offline or blocked selections. Require complete Double units rather than partial occupancy slots.
5. Insert the entire selected allocation in **one SQL statement**. Database triggers recheck conflicting assigned beds, active blocks and unexpired native holds. One conflicting bed aborts the complete insert; there is no partial reservation. Unique request keys deduplicate retries/concurrent owners.
6. The hold is valid for at most 900 seconds from its current `created_at` (original create or claim renew). Database guards use the database clock; expiry stops consuming physical allocation without deleting recovery evidence. No cleanup job is required to free expired physical reservations. Released/expired requests cannot silently become fresh holds.
7. Owner-authenticated release is idempotent, including when new creation is disabled. It never deletes recovery evidence. No fulfilment operation exists yet; **do not release then assign as a payment fulfilment sequence**—the later implementation must transfer ownership atomically.

### Read-only recovery and hold-aware selection

`getNativeInventoryHold({ requestKey, ownerToken })` reads the original request without inserting, renewing or releasing anything. It requires UUID/256-bit-token validation and the matching owner hash in the query; unknown requests and incorrect owners both return 404. It works after creation is disabled and returns original released/expired evidence. A storage failure returns a sanitized 503; retain the original request key and token rather than creating a replacement. A committed-insert/lost-response scenario is tested through the actual SQLite-backed service.

`getNativeSelectionAvailability({ checkinDate, checkoutDate })` is an internal, opt-in, Cloudflare-only advisory selector. It reuses the existing booking picker and complete sellable-unit grouping, excludes overlapping active native holds using database-clock expiry, and returns only unit key, dorm, type, capacity and physical IDs—never picker guest data, owner hashes or tokens. Physical IDs remain internal, not a public guest contract. Orphaned Double slots are rejected both by selection and creation. Exclusive checkout dates allow adjacent stays; release/expiry restore selection without deleting evidence.

Before new holds or advisory selection, query every hold column and check that all six required trigger names are installed on their expected tables. Missing schema/guards and picker failures fail closed with sanitized 503 responses. These checks detect incomplete setup, not arbitrary alteration of trigger bodies; reviewed migration integrity remains an operational prerequisite. Recovery/release do not require creation opt-in or new-operation preflight. No published quote or money operation is introduced.

Selection is not a reservation promise: concurrent writes can change it, and existing atomic insert guards remain authoritative for physical overlaps. Active holds reduce Aiosell online availability (`getDateAwareAvailability` / bulk snapshot) and trigger `pushIfOtaChanged` on new insert, owner release, and abandoned-hold cancel. Category/pool quotas and admin-picker hold display remain separate gates.

## Shared writer guards

Migration 0059 installs insert/update guards on `booking_bed_assignments` and `bed_blocks` in the same database. These reject overlap with active native holds regardless of which SQL caller writes the assignment/block. Hold allocation, identity, owner and stay dates are immutable; released holds cannot be resurrected. Migration **0065** allows lease renewal (`created_at`/`expires_at` only) while `state` stays `held`.

The table lacks sync columns and is absent from Cloudflare/Pi sync allowlists. The common Pi migrator may create an empty copy and its guards, but the hold service rejects Pi and native hold rows are not transferred. **Separate-database Pi writers are not coordinated by these triggers.** Offline/Pi policy remains a public-release gate.

## Tested and not yet implemented

The monetary layer now includes [quote/cancellation calculations](native-booking-quotes-and-refunds.md) and [protected accepted-quote persistence](native-accepted-quotes.md). Authoritative published rate/policy loading, provisional PMS booking linkage and payment/fulfilment integration remain required. No payment is connected to these holds.

Code-backed SQLite tests exercise 20-way last-unit races, same-key recovery, committed insert/lost response, read-only owner recovery after disable/release/expiry, altered selections/ownership, atomic multi-unit failure, complete/orphaned doubles, online-only selection, assignment/block conflicts, adjacent stays, expiry without deletion, immutable release, missing guards/schema, wrong-table trigger placement, sanitized picker failures, bad inputs and default/Pi denial. Local D1/workerd tests apply the actual migration and verify hold races, conflicting independent assignment/block writes, hold-aware selection, owner recovery and incomplete guard deployment. Picker data is stubbed in these tests; they do not certify end-to-end authoritative quote/quota behaviour.

Still required: aggregate availability/picker/PMS integration of holds; atomic category/pool ceilings and unassigned OTA capacity; shared block/override/deletion race policy; published price/tax/rate-plan/cancellation snapshots; provisional bookings and atomic hold-to-assignment transfer; secure guest recovery and bot/rate limits; bounded unknown-payment extension; capture-after-expiry/refund decisions; durable Aiosell inventory delivery; explicit Pi/offline coordination. Public APIs/UI, production refunds, automated recovery and settlement accounting follow those integrations.

This milestone is **not** a claim that holds are safe to expose to guests, that a successful payment fulfils a booking, or that native/live payments are production-ready. See the [full plan](plan-first-party-booking-and-payments.md) and [production release report](review-payment-production-readiness-2026-09-17.md).
